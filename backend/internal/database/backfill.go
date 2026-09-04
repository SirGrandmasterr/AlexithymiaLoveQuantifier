package database

import (
	"alexithymia-backend/internal/models"

	"gorm.io/gorm"
)

type BackfillResult struct {
	Relationships int
	Snapshots     int
}

// nameGroup is one distinct (user, trimmed name) pair still waiting for a relationship.
type nameGroup struct {
	UserID uint
	Name   string
}

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

				linked := tx.Unscoped().
					Model(&models.AnalysisSubject{}).
					Where("user_id = ? AND TRIM(name) = ? AND relationship_id IS NULL", group.UserID, group.Name).
					UpdateColumns(map[string]interface{}{
						"relationship_id": relationship.ID,
						"name":            group.Name,
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

func findOrCreateRelationship(tx *gorm.DB, userID uint, name string) (*models.Relationship, bool, error) {
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

func FindOrCreateRelationship(tx *gorm.DB, userID uint, name string) (*models.Relationship, error) {
	relationship, _, err := findOrCreateRelationship(tx, userID, name)
	return relationship, err
}
