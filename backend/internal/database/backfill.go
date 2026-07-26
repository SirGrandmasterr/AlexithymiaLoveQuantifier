package database

import (
	"alexithymia-backend/internal/models"

	"gorm.io/gorm"
)

// BackfillResult is what one backfill pass did. On an already-migrated database both
// numbers are zero, which is how the log line proves the pass was a no-op.
type BackfillResult struct {
	Relationships int
	Snapshots     int
}

// nameGroup is one distinct (user, trimmed name) pair still waiting for a relationship.
type nameGroup struct {
	UserID uint
	Name   string
}

// BackfillRelationships gives every snapshot a Relationship, reproducing the grouping the
// frontend used to compute client-side: one relationship per (user_id, TRIM(name)).
//
// It is idempotent — rows that already carry a relationship_id are filtered out, so it is
// safe to run on every boot and a second pass reports zero. Soft-deleted snapshots are
// included so a restored row stays attached to the same relationship as its siblings.
//
// One transaction per user bounds the blast radius of a failure: a partial run leaves the
// unprocessed users exactly as they were, and the next boot picks them up.
//
// Note on TRIM: SQL TRIM removes spaces, while the handlers use Go's strings.TrimSpace,
// which also removes tabs and newlines. Every name written since Phase 1 is already
// trimmed, so the two only diverge on pre-Phase-1 rows whose name had a tab in it.
func BackfillRelationships(db *gorm.DB) (BackfillResult, error) {
	var result BackfillResult

	var groups []nameGroup
	err := db.Unscoped().
		Model(&models.AnalysisSubject{}).
		Select("user_id AS user_id, TRIM(name) AS name").
		Where("relationship_id IS NULL").
		Group("user_id, TRIM(name)").
		Scan(&groups).Error
	if err != nil {
		return result, err
	}
	if len(groups) == 0 {
		return result, nil
	}

	byUser := map[uint][]nameGroup{}
	order := []uint{}
	for _, group := range groups {
		if _, seen := byUser[group.UserID]; !seen {
			order = append(order, group.UserID)
		}
		byUser[group.UserID] = append(byUser[group.UserID], group)
	}

	for _, userID := range order {
		err := db.Transaction(func(tx *gorm.DB) error {
			for _, group := range byUser[userID] {
				relationship, created, err := findOrCreateRelationship(tx, group.UserID, group.Name)
				if err != nil {
					return err
				}
				if created {
					result.Relationships++
				}

				// UpdateColumns rather than Updates: a mechanical backfill should not make
				// every snapshot in the database look freshly edited.
				linked := tx.Unscoped().
					Model(&models.AnalysisSubject{}).
					Where("user_id = ? AND TRIM(name) = ? AND relationship_id IS NULL", group.UserID, group.Name).
					UpdateColumns(map[string]interface{}{
						"relationship_id": relationship.ID,
						// The one-time name cleanup Phase 1 deferred: rows written before
						// server-side trimming keep an untrimmed name until now.
						"name": group.Name,
					})
				if linked.Error != nil {
					return linked.Error
				}
				result.Snapshots += int(linked.RowsAffected)
			}
			return nil
		})
		if err != nil {
			return result, err
		}
	}

	return result, nil
}

// findOrCreateRelationship resolves a user's relationship by exact (already trimmed) name,
// creating it the first time that name is used. The bool reports whether it was created.
//
// This lives here rather than in handlers because the backfill and the write path must
// resolve names identically — two different rules would split a stack in half.
func findOrCreateRelationship(tx *gorm.DB, userID uint, name string) (*models.Relationship, bool, error) {
	// Limit(1).Find rather than First: a miss is the normal case here — every new name goes
	// through it — and First would log each one as a red "record not found", which reads
	// like a failing migration to anyone watching the boot log.
	var found []models.Relationship
	err := tx.Where("user_id = ? AND name = ?", userID, name).Limit(1).Find(&found).Error
	if err != nil {
		return nil, false, err
	}
	if len(found) == 1 {
		return &found[0], false, nil
	}

	relationship := models.Relationship{UserID: userID, Name: name}
	if err := tx.Create(&relationship).Error; err != nil {
		return nil, false, err
	}
	return &relationship, true, nil
}

// FindOrCreateRelationship is the write path's entry point to the same resolution rule the
// backfill uses. Comparison is exact after trimming, so "Alex" and "alex" are two people —
// the policy documented since Phase 1.
func FindOrCreateRelationship(tx *gorm.DB, userID uint, name string) (*models.Relationship, error) {
	relationship, _, err := findOrCreateRelationship(tx, userID, name)
	return relationship, err
}
