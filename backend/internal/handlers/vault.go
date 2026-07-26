package handlers

import (
	"errors"
	"fmt"
	"maps"
	"net/http"
	"strings"
	"time"

	"alexithymia-backend/internal/database"
	"alexithymia-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// The export document is the app's promise that the data is yours: a complete, readable
// file you can keep, diff, or feed back in. It is deliberately id-free and
// human-inspectable — a row's identity is its relationship name plus its date, which is
// also what makes re-importing the same file a no-op.

const (
	exportFormat  = "alq-export"
	exportVersion = 1
)

type ExportDocument struct {
	Format        string               `json:"format"`
	Version       int                  `json:"version"`
	ExportedAt    time.Time            `json:"exported_at"`
	User          ExportUser           `json:"user"`
	Relationships []ExportRelationship `json:"relationships"`
}

// ExportUser carries the profile facts, never the credential. There is no Password field
// here at all — an omitted tag could be added back by accident, a missing field cannot.
type ExportUser struct {
	Email    string `json:"email"`
	Name     string `json:"name,omitempty"`
	Age      int    `json:"age,omitempty"`
	MBTIType string `json:"mbti_type,omitempty"`
}

type ExportRelationship struct {
	Name        string           `json:"name"`
	CadenceDays *int             `json:"cadence_days"`
	Snapshots   []ExportSnapshot `json:"snapshots"`
}

// ExportSnapshot omits the denormalized name (the relationship above carries it) and the
// internal ids. `date` stays present even when null — an undated snapshot is a fact worth
// stating — while the optional content fields drop out entirely, so a legacy database
// exports cleanly instead of a wall of nulls.
type ExportSnapshot struct {
	Date         *string                   `json:"date"`
	Kind         string                    `json:"kind"`
	Stats        map[string]int            `json:"stats,omitempty"`
	Description  string                    `json:"description,omitempty"`
	Tags         []string                  `json:"tags,omitempty"`
	Uncertain    []string                  `json:"uncertain,omitempty"`
	GuideAnswers map[string]map[string]int `json:"guide_answers,omitempty"`
	CreatedAt    time.Time                 `json:"created_at"`
}

type ImportResult struct {
	DryRun               bool `json:"dry_run"`
	RelationshipsCreated int  `json:"relationships_created"`
	SnapshotsCreated     int  `json:"snapshots_created"`
	SnapshotsSkipped     int  `json:"snapshots_skipped"`
}

type MetaResponse struct {
	DBBackend          string        `json:"db_backend"`
	RelationshipCount  int64         `json:"relationship_count"`
	SnapshotCount      int64         `json:"snapshot_count"`
	OldestSnapshotDate aggregateTime `json:"oldest_snapshot_date"`
}

// dateString renders a stored date in the wire format, so an export can be posted straight
// back to the import (or to POST /api/subjects) without reformatting.
func dateString(date *time.Time) *string {
	if date == nil {
		return nil
	}
	formatted := date.Format(dateLayout)
	return &formatted
}

// ExportVault returns everything the signed-in user has, in one document.
func ExportVault(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		return
	}

	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	var relationships []models.Relationship
	if err := database.DB.Where("user_id = ?", userID).Order("name ASC").Find(&relationships).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to export"})
		return
	}

	// Soft-deleted rows are excluded by GORM's default scope: an export is what you have,
	// not what you once had.
	var subjects []models.AnalysisSubject
	err := database.DB.Where("user_id = ?", userID).
		Order("date IS NULL").Order("date ASC").Order("id ASC").
		Find(&subjects).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to export"})
		return
	}

	byRelationship := map[uint][]ExportSnapshot{}
	for _, subject := range subjects {
		if subject.RelationshipID == nil {
			continue // unlinked rows are a server bug; do not invent a home for them
		}
		byRelationship[*subject.RelationshipID] = append(byRelationship[*subject.RelationshipID], ExportSnapshot{
			Date:         dateString(subject.Date),
			Kind:         subject.Kind,
			Stats:        subject.Stats,
			Description:  subject.Description,
			Tags:         subject.Tags,
			Uncertain:    subject.Uncertain,
			GuideAnswers: subject.GuideAnswers,
			CreatedAt:    subject.CreatedAt,
		})
	}

	document := ExportDocument{
		Format:     exportFormat,
		Version:    exportVersion,
		ExportedAt: time.Now().UTC(),
		User: ExportUser{
			Email:    user.Email,
			Name:     user.Name,
			Age:      user.Age,
			MBTIType: user.MBTIType,
		},
		Relationships: make([]ExportRelationship, 0, len(relationships)),
	}

	for _, relationship := range relationships {
		snapshots := byRelationship[relationship.ID]
		if snapshots == nil {
			snapshots = []ExportSnapshot{}
		}
		document.Relationships = append(document.Relationships, ExportRelationship{
			Name:        relationship.Name,
			CadenceDays: relationship.CadenceDays,
			Snapshots:   snapshots,
		})
	}

	c.JSON(http.StatusOK, document)
}

// errDryRun aborts the import transaction after doing all the work, so a dry run and a real
// run walk exactly the same code. Reporting what a *different* code path would have done is
// how preview features start lying.
var errDryRun = errors.New("dry run")

// ImportVault reads an export document back in. It is idempotent: a snapshot whose
// relationship, date and stats all match one already stored is skipped rather than
// duplicated, so importing the same file twice changes nothing.
func ImportVault(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		return
	}
	dryRun := c.Query("dry_run") == "true"

	var document ExportDocument
	if err := c.ShouldBindJSON(&document); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if document.Format != exportFormat {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
			"unrecognized format %q, expected %q", document.Format, exportFormat)})
		return
	}
	if document.Version != exportVersion {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
			"unsupported export version %d, this server reads version %d", document.Version, exportVersion)})
		return
	}

	// Everything is validated before anything is written, so a file with one bad value is
	// rejected whole rather than half-applied. Import is not a validation bypass: it runs
	// the same checks the create endpoint does.
	prepared, err := prepareImport(document)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result := ImportResult{DryRun: dryRun}
	err = database.DB.Transaction(func(tx *gorm.DB) error {
		if err := applyImport(tx, userID, prepared, &result); err != nil {
			return err
		}
		if dryRun {
			return errDryRun
		}
		return nil
	})
	if err != nil && !errors.Is(err, errDryRun) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to import"})
		return
	}

	c.JSON(http.StatusOK, result)
}

// preparedRelationship is one validated relationship and its snapshots, ready to write.
type preparedRelationship struct {
	Name        string
	CadenceDays *int
	Snapshots   []models.AnalysisSubject
}

// prepareImport validates the whole document and converts it into rows, without touching
// the database. Errors name the relationship and the position within it, because "invalid
// date" alone is useless against a file with hundreds of snapshots.
func prepareImport(document ExportDocument) ([]preparedRelationship, error) {
	prepared := make([]preparedRelationship, 0, len(document.Relationships))
	seenNames := map[string]bool{}

	for _, source := range document.Relationships {
		name := strings.TrimSpace(source.Name)
		if name == "" {
			return nil, errors.New("every relationship needs a name")
		}
		if seenNames[name] {
			return nil, fmt.Errorf("relationship %q appears twice in the file", name)
		}
		seenNames[name] = true

		if source.CadenceDays != nil {
			days := *source.CadenceDays
			if days < minCadenceDays || days > maxCadenceDays {
				return nil, fmt.Errorf("%s: cadence_days must be between %d and %d, or null",
					name, minCadenceDays, maxCadenceDays)
			}
		}

		entry := preparedRelationship{
			Name:        name,
			CadenceDays: source.CadenceDays,
			Snapshots:   make([]models.AnalysisSubject, 0, len(source.Snapshots)),
		}

		for index, snapshot := range source.Snapshots {
			where := fmt.Sprintf("%s, snapshot %d", name, index+1)

			if err := validateStats(snapshot.Stats); err != nil {
				return nil, fmt.Errorf("%s: %w", where, err)
			}
			tags, err := validateTags(snapshot.Tags)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", where, err)
			}
			if err := validateUncertain(snapshot.Uncertain, snapshot.Stats); err != nil {
				return nil, fmt.Errorf("%s: %w", where, err)
			}
			if err := validateGuideAnswers(snapshot.GuideAnswers); err != nil {
				return nil, fmt.Errorf("%s: %w", where, err)
			}
			kind, err := normalizeKind(snapshot.Kind)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", where, err)
			}

			var date *time.Time
			if snapshot.Date != nil && *snapshot.Date != "" {
				parsed, err := parseSubjectDate(*snapshot.Date)
				if err != nil {
					return nil, fmt.Errorf("%s: %w", where, err)
				}
				date = parsed
			}

			entry.Snapshots = append(entry.Snapshots, models.AnalysisSubject{
				Name:         name,
				Kind:         kind,
				Date:         date,
				Stats:        snapshot.Stats,
				Description:  snapshot.Description,
				Tags:         tags,
				Uncertain:    snapshot.Uncertain,
				GuideAnswers: snapshot.GuideAnswers,
			})
		}

		prepared = append(prepared, entry)
	}

	return prepared, nil
}

// applyImport writes the prepared rows, counting what it did. Relationships resolve through
// the same find-or-create the create endpoint uses, so an import merges into the stacks the
// user already has rather than shadowing them.
func applyImport(tx *gorm.DB, userID uint, prepared []preparedRelationship, result *ImportResult) error {
	for _, entry := range prepared {
		var existingCount int64
		err := tx.Model(&models.Relationship{}).
			Where("user_id = ? AND name = ?", userID, entry.Name).
			Count(&existingCount).Error
		if err != nil {
			return err
		}

		relationship, err := database.FindOrCreateRelationship(tx, userID, entry.Name)
		if err != nil {
			return err
		}
		if existingCount == 0 {
			result.RelationshipsCreated++
		}

		// A cadence in the file only fills a gap; it never overwrites a rhythm the user has
		// since chosen on this machine.
		if entry.CadenceDays != nil && relationship.CadenceDays == nil {
			if err := tx.Model(relationship).Update("cadence_days", entry.CadenceDays).Error; err != nil {
				return err
			}
		}

		var existing []models.AnalysisSubject
		err = tx.Where("user_id = ? AND relationship_id = ?", userID, relationship.ID).
			Find(&existing).Error
		if err != nil {
			return err
		}

		for _, incoming := range entry.Snapshots {
			if isDuplicateSnapshot(incoming, existing) {
				result.SnapshotsSkipped++
				continue
			}

			row := incoming
			row.UserID = userID
			row.RelationshipID = &relationship.ID
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
			// Added to the comparison set so duplicates *within one file* are caught too.
			existing = append(existing, row)
			result.SnapshotsCreated++
		}
	}

	return nil
}

// isDuplicateSnapshot decides identity by date and scores together. Date alone would reject
// two genuine readings taken the same day; scores alone would reject an unchanged
// relationship snapshotted months apart, which is exactly the signal this app exists to
// record.
func isDuplicateSnapshot(incoming models.AnalysisSubject, existing []models.AnalysisSubject) bool {
	for _, candidate := range existing {
		if !sameDay(candidate.Date, incoming.Date) {
			continue
		}
		if maps.Equal(candidate.Stats, incoming.Stats) {
			return true
		}
	}
	return false
}

func sameDay(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Format(dateLayout) == b.Format(dateLayout)
}

// GetMeta backs the Vault page's "where your data lives" section. Counts and a backend
// name, nothing configuration-shaped: no DSN, no paths, no secrets.
func GetMeta(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		return
	}

	var meta MetaResponse
	meta.DBBackend = database.DB.Dialector.Name()

	err := database.DB.Model(&models.Relationship{}).
		Where("user_id = ?", userID).Count(&meta.RelationshipCount).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read metadata"})
		return
	}

	err = database.DB.Model(&models.AnalysisSubject{}).
		Where("user_id = ?", userID).Count(&meta.SnapshotCount).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read metadata"})
		return
	}

	// Same aggregate-typing caveat as latest_date: MIN() drops the column's declared type,
	// so SQLite hands back a string and Postgres a timestamp.
	err = database.DB.Model(&models.AnalysisSubject{}).
		Select("MIN(date)").
		Where("user_id = ?", userID).
		Scan(&meta.OldestSnapshotDate).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read metadata"})
		return
	}

	c.JSON(http.StatusOK, meta)
}
