package handlers

import (
	"errors"
	"fmt"
	"maps"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"alexithymia-backend/internal/database"
	"alexithymia-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	exportFormat     = "alq-export"
	exportVersion    = 2
	minImportVersion = 1
)

type ExportDocument struct {
	Format        string               `json:"format"`
	Version       int                  `json:"version"`
	ExportedAt    time.Time            `json:"exported_at"`
	User          ExportUser           `json:"user"`
	Relationships []ExportRelationship `json:"relationships"`
	Journal       *ExportJournal       `json:"journal,omitempty"`
}

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

type ExportJournal struct {
	Entries []ExportJournalEntry `json:"entries"`
}

type ExportJournalEntry struct {
	ClientID      string                 `json:"client_id"`
	Kind          string                 `json:"kind"`
	Day           string                 `json:"day"`
	At            time.Time              `json:"at"`
	SchemaVersion int                    `json:"schema_version"`
	Payload       map[string]interface{} `json:"payload"`
	Mentions      []ExportJournalMention `json:"mentions,omitempty"`
	SupersededAt  *time.Time             `json:"superseded_at,omitempty"`
	Supersedes    string                 `json:"supersedes,omitempty"`
}

type ExportJournalMention struct {
	Relationship string `json:"relationship,omitempty"`
	Ref          int    `json:"ref"`
	Label        string `json:"label"`
}

type ImportResult struct {
	DryRun                bool `json:"dry_run"`
	RelationshipsCreated  int  `json:"relationships_created"`
	SnapshotsCreated      int  `json:"snapshots_created"`
	SnapshotsSkipped      int  `json:"snapshots_skipped"`
	JournalEntriesCreated int  `json:"journal_entries_created"`
	JournalEntriesSkipped int  `json:"journal_entries_skipped"`
}

type MetaResponse struct {
	DBBackend          string        `json:"db_backend"`
	RelationshipCount  int64         `json:"relationship_count"`
	SnapshotCount      int64         `json:"snapshot_count"`
	OldestSnapshotDate aggregateTime `json:"oldest_snapshot_date"`
	JournalEntryCount  int64         `json:"journal_entry_count"`
	OldestJournalDay   *string       `json:"oldest_journal_day"`
}

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

	names := make(map[uint]string, len(relationships))
	for _, relationship := range relationships {
		names[relationship.ID] = relationship.Name

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

	journal, err := exportJournal(userID, names)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to export"})
		return
	}
	document.Journal = journal

	c.JSON(http.StatusOK, document)
}

func exportJournal(userID uint, names map[uint]string) (*ExportJournal, error) {
	var entries []models.JournalEntry
	err := database.DB.Preload("Mentions").
		Where("user_id = ?", userID).
		Order("day ASC").Order("at ASC").Order("id ASC").
		Find(&entries).Error
	if err != nil {
		return nil, err
	}

	clientIDs := make(map[uint]string, len(entries))
	for _, entry := range entries {
		clientIDs[entry.ID] = entry.ClientID
	}

	journal := &ExportJournal{Entries: make([]ExportJournalEntry, 0, len(entries))}
	for _, entry := range entries {
		row := ExportJournalEntry{
			ClientID:      entry.ClientID,
			Kind:          entry.Kind,
			Day:           entry.Day,
			At:            entry.At,
			SchemaVersion: entry.SchemaVersion,
			Payload:       entry.Payload,
			SupersededAt:  entry.SupersededAt,
		}
		if entry.SupersedesID != nil {
			row.Supersedes = clientIDs[*entry.SupersedesID]
		}

		mentions := append([]models.JournalMention(nil), entry.Mentions...)
		sort.Slice(mentions, func(i, j int) bool {
			if mentions[i].Ref != mentions[j].Ref {
				return mentions[i].Ref < mentions[j].Ref
			}
			return mentions[i].ID < mentions[j].ID
		})
		for _, mention := range mentions {
			exported := ExportJournalMention{Ref: mention.Ref, Label: mention.Label}
			if mention.RelationshipID != nil {
				exported.Relationship = names[*mention.RelationshipID]
			}
			row.Mentions = append(row.Mentions, exported)
		}

		journal.Entries = append(journal.Entries, row)
	}

	return journal, nil
}

var errDryRun = errors.New("dry run")

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
	if document.Version < minImportVersion || document.Version > exportVersion {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
			"unsupported export version %d, this server reads versions %d to %d",
			document.Version, minImportVersion, exportVersion)})
		return
	}
	if document.Version < 2 && document.Journal != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
			"version %d has no journal block, but this file has one", document.Version)})
		return
	}

	prepared, err := prepareImport(document)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result := ImportResult{DryRun: dryRun}
	err = database.DB.Transaction(func(tx *gorm.DB) error {
		people := newImportPeople(tx, userID)

		if err := applyImport(tx, userID, people, prepared.Relationships, &result); err != nil {
			return err
		}
		if err := applyJournal(tx, userID, people, prepared.Journal, &result); err != nil {
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

type preparedJournalEntry struct {
	Entry      models.JournalEntry
	Mentions   []preparedJournalMention
	Supersedes string
}

type preparedJournalMention struct {
	Relationship string
	Label        string
	Ref          int
}

type preparedDocument struct {
	Relationships []preparedRelationship
	Journal       []preparedJournalEntry
}

func prepareImport(document ExportDocument) (preparedDocument, error) {
	relationships, err := prepareRelationships(document)
	if err != nil {
		return preparedDocument{}, err
	}
	journal, err := prepareJournal(document.Journal)
	if err != nil {
		return preparedDocument{}, err
	}
	return preparedDocument{Relationships: relationships, Journal: journal}, nil
}

func prepareRelationships(document ExportDocument) ([]preparedRelationship, error) {
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

func checkinTriggerRefs(kind string, payload map[string]interface{}) []string {
	if kind != kindCheckin {
		return nil
	}
	var typed checkinPayload
	if err := decodePayload(payload, kindCheckin, &typed); err != nil {
		return nil
	}

	var refs []string
	for _, feeling := range typed.Feelings {
		for _, about := range feeling.About {
			if about.Kind == aboutTrigger {
				refs = append(refs, strings.TrimSpace(about.Trigger))
			}
		}
	}
	return refs
}

func prepareJournal(journal *ExportJournal) ([]preparedJournalEntry, error) {
	if journal == nil {
		return nil, nil
	}

	type reference struct {
		where   string
		trigger string
	}

	prepared := make([]preparedJournalEntry, 0, len(journal.Entries))
	seen := map[string]bool{}
	triggers := map[string]bool{}
	var references []reference

	for index, source := range journal.Entries {
		where := fmt.Sprintf("journal entry %d", index+1)

		if err := validateClientID("client_id", source.ClientID); err != nil {
			return nil, fmt.Errorf("%s: %w", where, err)
		}
		if seen[source.ClientID] {
			return nil, fmt.Errorf("%s: client_id %s appears twice in the file", where, source.ClientID)
		}
		seen[source.ClientID] = true

		if err := validateJournalKind(source.Kind); err != nil {
			return nil, fmt.Errorf("%s: %w", where, err)
		}
		if source.At.IsZero() {
			return nil, fmt.Errorf("%s: at is required", where)
		}
		if err := validateDay(source.Day, source.At.UTC()); err != nil {
			return nil, fmt.Errorf("%s: %w", where, err)
		}

		// Absent means "the only version there is", exactly as the write path reads it.
		schemaVersion := source.SchemaVersion
		if schemaVersion == 0 {
			schemaVersion = journalSchemaVersion
		}
		if schemaVersion != journalSchemaVersion {
			return nil, fmt.Errorf("%s: schema_version must be %d", where, journalSchemaVersion)
		}

		mentions := make([]preparedJournalMention, 0, len(source.Mentions))
		for position, mention := range source.Mentions {
			label := strings.TrimSpace(mention.Label)
			if utf8.RuneCountInString(label) > maxTagLength {
				return nil, fmt.Errorf("%s: mention %d label exceeds %d characters: %s",
					where, position, maxTagLength, label)
			}
			mentions = append(mentions, preparedJournalMention{
				Relationship: strings.TrimSpace(mention.Relationship),
				Label:        label,
				Ref:          mention.Ref,
			})
		}

		mergedInto, err := validateJournalPayload(source.Kind, source.Payload, source.ClientID, len(mentions))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", where, err)
		}

		if source.Kind == kindTrigger {
			triggers[source.ClientID] = true
		}
		if mergedInto != "" {
			references = append(references, reference{where: where, trigger: mergedInto})
		}
		for _, id := range checkinTriggerRefs(source.Kind, source.Payload) {
			references = append(references, reference{where: where, trigger: id})
		}

		prepared = append(prepared, preparedJournalEntry{
			Entry: models.JournalEntry{
				ClientID:      source.ClientID,
				Kind:          source.Kind,
				Day:           source.Day,
				At:            source.At.UTC(),
				SchemaVersion: schemaVersion,
				Payload:       source.Payload,
				SupersededAt:  source.SupersededAt,
			},
			Mentions:   mentions,
			Supersedes: strings.TrimSpace(source.Supersedes),
		})
	}

	for _, reference := range references {
		if !triggers[reference.trigger] {
			return nil, fmt.Errorf("%s names a trigger this file does not contain: %s",
				reference.where, reference.trigger)
		}
	}

	return prepared, nil
}

func applyImport(tx *gorm.DB, userID uint, people *importPeople, prepared []preparedRelationship, result *ImportResult) error {
	for _, entry := range prepared {
		relationship, created, err := people.resolve(entry.Name)
		if err != nil {
			return err
		}
		if created {
			result.RelationshipsCreated++
		}

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

func findOrCreateForImport(tx *gorm.DB, userID uint, name string) (*models.Relationship, bool, error) {
	var existing int64
	err := tx.Model(&models.Relationship{}).
		Where("user_id = ? AND name = ?", userID, name).
		Count(&existing).Error
	if err != nil {
		return nil, false, err
	}

	relationship, err := database.FindOrCreateRelationship(tx, userID, name)
	if err != nil {
		return nil, false, err
	}
	return relationship, existing == 0, nil
}

type importPeople struct {
	tx     *gorm.DB
	userID uint
	seen   map[string]*models.Relationship
}

func newImportPeople(tx *gorm.DB, userID uint) *importPeople {
	return &importPeople{tx: tx, userID: userID, seen: map[string]*models.Relationship{}}
}

func (people *importPeople) resolve(name string) (*models.Relationship, bool, error) {
	if known, ok := people.seen[name]; ok {
		return known, false, nil
	}

	relationship, created, err := findOrCreateForImport(people.tx, people.userID, name)
	if err != nil {
		return nil, false, err
	}
	people.seen[name] = relationship
	return relationship, created, nil
}

func applyJournal(tx *gorm.DB, userID uint, people *importPeople, prepared []preparedJournalEntry, result *ImportResult) error {
	if len(prepared) == 0 {
		return nil
	}

	var owned []models.JournalEntry
	err := tx.Unscoped().
		Select("id", "client_id").
		Where("user_id = ?", userID).
		Find(&owned).Error
	if err != nil {
		return err
	}
	byClientID := make(map[string]uint, len(owned)+len(prepared))
	for _, row := range owned {
		byClientID[row.ClientID] = row.ID
	}

	type correction struct {
		entryID    uint
		supersedes string
	}
	var corrections []correction

	for _, source := range prepared {
		if _, held := byClientID[source.Entry.ClientID]; held {
			result.JournalEntriesSkipped++
			continue
		}

		row := source.Entry
		row.UserID = userID
		row.Mentions = make([]models.JournalMention, 0, len(source.Mentions))
		for _, mention := range source.Mentions {
			written := models.JournalMention{Ref: mention.Ref, Label: mention.Label}
			if mention.Relationship != "" {
				relationship, created, err := people.resolve(mention.Relationship)
				if err != nil {
					return err
				}
				if created {
					result.RelationshipsCreated++
				}
				written.RelationshipID = &relationship.ID
				if written.Label == "" {
					written.Label = relationship.Name
				}
			}
			row.Mentions = append(row.Mentions, written)
		}

		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		byClientID[row.ClientID] = row.ID
		result.JournalEntriesCreated++

		if source.Supersedes != "" {
			corrections = append(corrections, correction{entryID: row.ID, supersedes: source.Supersedes})
		}
	}

	for _, link := range corrections {
		target, known := byClientID[link.supersedes]
		if !known {
			continue
		}
		err := tx.Model(&models.JournalEntry{}).
			Where("id = ? AND user_id = ?", link.entryID, userID).
			Update("supersedes_id", target).Error
		if err != nil {
			return err
		}
	}

	return nil
}

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

	err = database.DB.Model(&models.AnalysisSubject{}).
		Select("MIN(date)").
		Where("user_id = ?", userID).
		Scan(&meta.OldestSnapshotDate).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read metadata"})
		return
	}

	err = database.DB.Model(&models.JournalEntry{}).
		Where("user_id = ?", userID).Count(&meta.JournalEntryCount).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read metadata"})
		return
	}

	err = database.DB.Model(&models.JournalEntry{}).
		Select("MIN(day)").
		Where("user_id = ?", userID).
		Scan(&meta.OldestJournalDay).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read metadata"})
		return
	}

	c.JSON(http.StatusOK, meta)
}
