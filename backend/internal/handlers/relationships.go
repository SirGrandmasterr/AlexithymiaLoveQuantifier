package handlers

import (
	"bytes"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"alexithymia-backend/internal/database"
	"alexithymia-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RelationshipSummary is a relationship plus the two facts every screen wants about it.
// The `ID` casing follows gorm.Model's default JSON encoding, which the frontend already
// relies on for snapshots — one casing rule, however unusual, beats two.
type RelationshipSummary struct {
	ID          uint   `json:"ID"`
	Name        string `json:"name"`
	CadenceDays *int   `json:"cadence_days"`

	SnapshotCount int `json:"snapshot_count"`
	// MentionCount is how many journal entries the journal *shows* for this person — not
	// deleted and not superseded. It is here so the delete dialog can say what will happen
	// before it happens (Phase 6 §7.3), which is the only reason it exists, and it is
	// counted over exactly the entries a user could see so the sentence is true of what
	// they will observe. DeleteRelationship's `mentions_detached` is scoped identically.
	MentionCount int `json:"mention_count"`

	LatestDate aggregateTime `json:"latest_date"`
}

// Cadence bounds. Below a week a "rhythm" is really a nag; above a year it has stopped
// being a rhythm at all. nil, meaning no reminders, is always allowed and is the default.
const (
	minCadenceDays = 7
	maxCadenceDays = 365
)

// aggregateTime absorbs an engine difference that only shows up under an aggregate:
// MAX() drops the column's declared type, so Postgres hands back a time.Time while SQLite
// hands back the string it stored. A plain *time.Time field fails to scan on SQLite, and
// the failure is invisible until a relationship actually has a dated snapshot.
type aggregateTime struct {
	Time *time.Time
}

// sqliteTimeLayout is what glebarez/sqlite writes for a time.Time: "2026-03-01 00:00:00+00:00".
const sqliteTimeLayout = "2006-01-02 15:04:05-07:00"

func (a *aggregateTime) Scan(value interface{}) error {
	a.Time = nil
	switch typed := value.(type) {
	case nil:
		return nil
	case time.Time:
		a.Time = &typed
		return nil
	case []byte:
		return a.parse(string(typed))
	case string:
		return a.parse(typed)
	default:
		return fmt.Errorf("unsupported latest_date type %T", value)
	}
}

func (a *aggregateTime) parse(raw string) error {
	for _, layout := range []string{sqliteTimeLayout, time.RFC3339Nano, "2006-01-02 15:04:05", dateLayout} {
		if parsed, err := time.Parse(layout, raw); err == nil {
			a.Time = &parsed
			return nil
		}
	}
	return fmt.Errorf("unrecognized latest_date format: %s", raw)
}

// Value is never used — nothing writes an aggregate back — but GORM refuses to scan into a
// struct field that implements only half of the Valuer/Scanner pair.
func (a aggregateTime) Value() (driver.Value, error) {
	if a.Time == nil {
		return nil, nil
	}
	return *a.Time, nil
}

// MarshalJSON keeps the wire shape a plain nullable timestamp, so clients never see the
// wrapper.
func (a aggregateTime) MarshalJSON() ([]byte, error) {
	return json.Marshal(a.Time)
}

func (a *aggregateTime) UnmarshalJSON(data []byte) error {
	return json.Unmarshal(data, &a.Time)
}

type MergeRelationshipInput struct {
	SourceID uint `json:"source_id"`
}

// MergeRelationshipResponse is the target's summary plus what the merge had to move that a
// summary cannot show. The summary is embedded rather than nested so the response stays the
// shape every other relationship endpoint returns and a client that ignores the new field
// keeps working.
type MergeRelationshipResponse struct {
	RelationshipSummary
	MentionsMoved int64 `json:"mentions_moved"`
}

// currentUserID pulls the id the auth middleware stashed, reporting the 401 itself so the
// four handlers below do not each repeat it.
func currentUserID(c *gin.Context) (uint, bool) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in context"})
		return 0, false
	}
	return userID.(uint), true
}

// summaryQuery is the one grouped query behind every relationship response.
//
// The join is LEFT so a relationship whose last snapshot was deleted individually still
// appears, honestly reporting zero — hiding it would make it impossible to delete. The
// `deleted_at IS NULL` lives in the join condition rather than a WHERE so soft-deleted
// snapshots drop out of the count without dropping their relationship from the result.
//
// The journal is reached for `mention_count` (§7.3) through a **pre-aggregated subquery**,
// not through two more joins onto the raw tables. That is the whole of the interesting part.
// Joining `journal_mentions` here directly would multiply the rows — a person with 40
// snapshots and 2,000 mentions produces 80,000 before any COUNT collapses them — on the one
// query every screen in the app issues on load and after every mutation, and it would grow
// in both dimensions for the life of the account. `DISTINCT` would make the answer correct
// and the work quadratic anyway. Grouped first, the journal side contributes **one row per
// relationship**, so there is no product to collapse: `snapshot_count` stays a plain COUNT
// over the snapshot join, and the repeated mention count is folded back with MAX, which is
// exact because every repetition is the same number.
//
// The count is over the entries the journal *shows* — neither soft-deleted nor superseded —
// so that the number the delete dialog states matches what the user will observe change, and
// matches DeleteRelationship's `mentions_detached`.
const liveMentionCounts = `(SELECT journal_mentions.relationship_id AS relationship_id,
                                   COUNT(*) AS mention_count
                              FROM journal_mentions
                              JOIN journal_entries
                                ON journal_entries.id = journal_mentions.entry_id
                             WHERE journal_entries.deleted_at IS NULL
                               AND journal_entries.superseded_at IS NULL
                             GROUP BY journal_mentions.relationship_id)`

func summaryQuery(userID uint) *gorm.DB {
	return database.DB.
		Model(&models.Relationship{}).
		Select(`relationships.id AS id,
		        relationships.name AS name,
		        relationships.cadence_days AS cadence_days,
		        COUNT(analysis_subjects.id) AS snapshot_count,
		        COALESCE(MAX(journal_counts.mention_count), 0) AS mention_count,
		        MAX(analysis_subjects.date) AS latest_date`).
		Joins(`LEFT JOIN analysis_subjects
		       ON analysis_subjects.relationship_id = relationships.id
		       AND analysis_subjects.deleted_at IS NULL`).
		Joins(`LEFT JOIN `+liveMentionCounts+` AS journal_counts
		       ON journal_counts.relationship_id = relationships.id`).
		Where("relationships.user_id = ?", userID).
		Group("relationships.id, relationships.name")
}

// loadSummary re-reads one relationship through the same grouped query, so a rename or a
// merge answers with exactly the shape the list endpoint returns.
func loadSummary(userID, relationshipID uint) (RelationshipSummary, error) {
	var summary RelationshipSummary
	err := summaryQuery(userID).
		Where("relationships.id = ?", relationshipID).
		Scan(&summary).Error
	return summary, err
}

// findOwnedRelationship is the ownership check every mutating route runs. A relationship
// belonging to somebody else is reported as 404, not 403: whether it exists is not this
// user's business.
func findOwnedRelationship(tx *gorm.DB, relationshipID uint, userID uint) (*models.Relationship, error) {
	var relationship models.Relationship
	err := tx.Where("id = ? AND user_id = ?", relationshipID, userID).First(&relationship).Error
	if err != nil {
		return nil, err
	}
	return &relationship, nil
}

// parseRelationshipID reads the :id path parameter, answering 404 for anything that is not
// a positive integer — a garbage id names no relationship the user has.
func parseRelationshipID(c *gin.Context) (uint, bool) {
	parsed, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || parsed == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Relationship not found"})
		return 0, false
	}
	return uint(parsed), true
}

func GetRelationships(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		return
	}

	// Most recently touched first; a relationship with no dated snapshot sorts last rather
	// than to the top, matching how the snapshot list orders undated rows.
	//
	// The aggregate is repeated here instead of ordering by the `latest_date` alias:
	// Postgres only accepts an output alias standing alone in ORDER BY, never inside an
	// expression, so `latest_date IS NULL` fails with "column does not exist" there while
	// SQLite — what the tests run on — accepts it. Spelling out MAX(...) works on both.
	summaries := []RelationshipSummary{}
	err := summaryQuery(userID).
		Order("MAX(analysis_subjects.date) IS NULL").
		Order("MAX(analysis_subjects.date) DESC").
		Order("relationships.name ASC").
		Scan(&summaries).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch relationships"})
		return
	}

	c.JSON(http.StatusOK, summaries)
}

// UpdateRelationship applies a partial update to the stack as a whole: its name, its
// check-in rhythm, or both. Renaming here moves every version with it — the action that was
// impossible before relationships existed, when renaming a single snapshot split it out of
// its stack instead.
//
// The body is decoded into a raw map rather than a binding struct, breaking this file's own
// convention, because `cadence_days` has to distinguish three cases: absent (leave alone),
// `null` (turn reminders off), and a number. encoding/json collapses the first two into a
// nil pointer at every pointer depth — verified, not assumed — so presence can only be read
// from the keys themselves.
func UpdateRelationship(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		return
	}
	relationshipID, ok := parseRelationshipID(c)
	if !ok {
		return
	}

	var body map[string]json.RawMessage
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var newName *string
	if raw, present := body["name"]; present {
		var name string
		if err := json.Unmarshal(raw, &name); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name must be a string"})
			return
		}
		trimmed := strings.TrimSpace(name)
		if trimmed == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
			return
		}
		newName = &trimmed
	}

	var newCadence *int
	_, cadencePresent := body["cadence_days"]
	if cadencePresent && !isJSONNull(body["cadence_days"]) {
		var days int
		if err := json.Unmarshal(body["cadence_days"], &days); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cadence_days must be a whole number of days, or null"})
			return
		}
		if days < minCadenceDays || days > maxCadenceDays {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
				"cadence_days must be between %d and %d, or null to turn reminders off",
				minCadenceDays, maxCadenceDays)})
			return
		}
		newCadence = &days
	}

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		relationship, err := findOwnedRelationship(tx, relationshipID, userID)
		if err != nil {
			return err
		}

		if cadencePresent {
			if err := tx.Model(relationship).Update("cadence_days", newCadence).Error; err != nil {
				return err
			}
		}

		if newName == nil {
			return nil
		}
		name := *newName

		// Uniqueness lives here rather than in a DB constraint (see models.Relationship).
		// Renaming to the name it already has is a no-op, not a collision with itself.
		if relationship.Name != name {
			var collisions int64
			err = tx.Model(&models.Relationship{}).
				Where("user_id = ? AND name = ? AND id <> ?", userID, name, relationship.ID).
				Count(&collisions).Error
			if err != nil {
				return err
			}
			if collisions > 0 {
				return errNameTaken
			}
		}

		if err := tx.Model(relationship).Update("name", name).Error; err != nil {
			return err
		}

		// Unscoped so a soft-deleted snapshot does not keep a stale name: if it is ever
		// restored it should come back under the name its siblings carry.
		return tx.Unscoped().
			Model(&models.AnalysisSubject{}).
			Where("relationship_id = ? AND user_id = ?", relationship.ID, userID).
			UpdateColumn("name", name).Error
	})

	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Relationship not found"})
		return
	case errors.Is(err, errNameTaken):
		c.JSON(http.StatusConflict, gin.H{"error": "You already have a relationship with that name. Merge them instead."})
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update relationship"})
		return
	}

	summary, err := loadSummary(userID, relationshipID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update relationship"})
		return
	}
	c.JSON(http.StatusOK, summary)
}

// isJSONNull reports whether a raw value is the literal null, tolerating surrounding
// whitespace the decoder may have preserved.
func isJSONNull(raw json.RawMessage) bool {
	return bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}

// errNameTaken travels out of the rename transaction so the 409 is decided outside it.
var errNameTaken = errors.New("relationship name already in use")

// errSameRelationship guards the degenerate merge of a stack into itself.
var errSameRelationship = errors.New("cannot merge a relationship into itself")

// MergeRelationship moves every snapshot of the source into the target and retires the
// source. It is one-way: nothing records which snapshots came from where, which is why the
// UI states that plainly before asking for confirmation.
func MergeRelationship(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		return
	}
	targetID, ok := parseRelationshipID(c)
	if !ok {
		return
	}

	var input MergeRelationshipInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.SourceID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "source_id is required"})
		return
	}

	var mentionsMoved int64
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if input.SourceID == targetID {
			return errSameRelationship
		}

		// Both sides are checked, so a merge cannot be used to reach across users.
		target, err := findOwnedRelationship(tx, targetID, userID)
		if err != nil {
			return err
		}
		source, err := findOwnedRelationship(tx, input.SourceID, userID)
		if err != nil {
			return err
		}

		// Unscoped: soft-deleted snapshots move too, so the source is left with nothing
		// pointing at it and a later restore cannot resurrect a half-merged stack.
		err = tx.Unscoped().
			Model(&models.AnalysisSubject{}).
			Where("relationship_id = ? AND user_id = ?", source.ID, userID).
			UpdateColumns(map[string]interface{}{
				"relationship_id": target.ID,
				"name":            target.Name,
			}).Error
		if err != nil {
			return err
		}

		// Journal mentions move in the same transaction, for the same reason and with the
		// same reach as the snapshots above: a mention still pointing at a retired
		// relationship is the stranded row this handler exists to prevent. There is no
		// Unscoped() here because there is nothing to unscope — a mention has no soft
		// delete of its own, so this statement already moves the mentions of soft-deleted
		// entries, which is exactly what is wanted.
		//
		// Scoping by relationship_id alone is safe: findOwnedRelationship has already
		// proved the source is this user's, so every mention pointing at it is too.
		mentions := tx.Model(&models.JournalMention{}).
			Where("relationship_id = ?", source.ID).
			Update("relationship_id", target.ID)
		if mentions.Error != nil {
			return mentions.Error
		}
		mentionsMoved = mentions.RowsAffected

		return tx.Delete(source).Error
	})

	switch {
	case errors.Is(err, errSameRelationship):
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot merge a relationship into itself"})
		return
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Relationship not found"})
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to merge relationships"})
		return
	}

	summary, err := loadSummary(userID, targetID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to merge relationships"})
		return
	}
	c.JSON(http.StatusOK, MergeRelationshipResponse{
		RelationshipSummary: summary,
		MentionsMoved:       mentionsMoved,
	})
}

// DeleteRelationship removes the whole history — distinct from DELETE /subjects/:id, which
// removes one version. Both are soft deletes, so a database backup is still the real
// undo.
func DeleteRelationship(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		return
	}
	relationshipID, ok := parseRelationshipID(c)
	if !ok {
		return
	}

	var deleted int64
	var mentionsDetached int64
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		relationship, err := findOwnedRelationship(tx, relationshipID, userID)
		if err != nil {
			return err
		}

		subjects := tx.Where("relationship_id = ? AND user_id = ?", relationship.ID, userID).
			Delete(&models.AnalysisSubject{})
		if subjects.Error != nil {
			return subjects.Error
		}
		deleted = subjects.RowsAffected

		// The mentions are counted and then left exactly as they are. Deleting a person
		// should not rewrite the user's own record of a day: the entry stays, and its
		// mention keeps both its row and its `label` — the name as it was said, which is a
		// quotation and still reads correctly. Nothing is stranded by leaving
		// relationship_id in place either, because the relationship it names is
		// soft-deleted, so every join through it drops out on its own.
		//
		// The count is reported so the confirmation dialog can say what will happen before
		// it happens, which is the only reason this number exists — and it is counted over
		// the entries the journal *shows*, the same scope as `mention_count` on the summary
		// the dialog read a moment earlier. Counting rows on entries the user has already
		// deleted, or on statements a correction has superseded, would report a number
		// nothing on screen could account for.
		err = tx.Model(&models.JournalMention{}).
			Joins(`JOIN journal_entries ON journal_entries.id = journal_mentions.entry_id
			       AND journal_entries.deleted_at IS NULL
			       AND journal_entries.superseded_at IS NULL`).
			Where("journal_mentions.relationship_id = ?", relationship.ID).
			Count(&mentionsDetached).Error
		if err != nil {
			return err
		}

		return tx.Delete(relationship).Error
	})

	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Relationship not found"})
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete relationship"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":           "Relationship deleted",
		"snapshots_deleted": deleted,
		"mentions_detached": mentionsDetached,
	})
}
