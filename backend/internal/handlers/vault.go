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

// The export document is the app's promise that the data is yours: a complete, readable
// file you can keep, diff, or feed back in. It is deliberately id-free and
// human-inspectable — a row's identity is its relationship name plus its date, which is
// also what makes re-importing the same file a no-op.
//
// The journal is the one part with an identity of its own. A check-in carries the client id
// it was written with, so its duplicate check is exact rather than a comparison of content,
// and the two references it makes — a person, a trigger — travel as a name and as that same
// client id. Nothing in this file is a database row id, in either half.

const (
	exportFormat = "alq-export"
	// Version 2 adds the journal block. It is a whole-document version, not a per-section
	// one: a reader that has never heard of a journal has no way to skip it safely, which
	// is why a version 2 file into a pre-Phase-6 server is refused rather than partially
	// understood.
	exportVersion = 2
	// minImportVersion is the oldest document this server still reads. A version 1 file
	// predates the journal and simply has no journal block — there is nothing to translate,
	// so refusing it would throw away a file for no gain.
	minImportVersion = 1
)

type ExportDocument struct {
	Format        string               `json:"format"`
	Version       int                  `json:"version"`
	ExportedAt    time.Time            `json:"exported_at"`
	User          ExportUser           `json:"user"`
	Relationships []ExportRelationship `json:"relationships"`
	// Journal is absent from a version 1 document and present in every version 2 one, even
	// when it holds nothing. A pointer is what tells those two cases apart on the way back
	// in: "this file predates the journal" and "this file has a journal with nothing in it"
	// are different statements, and only one of them would be a surprise.
	Journal *ExportJournal `json:"journal,omitempty"`
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

// ExportJournal is the whole journal, not the current view of it. The reads filter
// `superseded_at IS NULL` because they answer "what is true now"; an export answers "what is
// there", and a record that quietly dropped what its author corrected would not be one.
type ExportJournal struct {
	Entries []ExportJournalEntry `json:"entries"`
}

// ExportJournalEntry is one row in the document's vocabulary. Everything the column stores
// travels except the row id, the timestamps GORM keeps, and the one thing that is a row id
// by another name — `supersedes_id`, which leaves as the client id it points at.
type ExportJournalEntry struct {
	ClientID      string                 `json:"client_id"`
	Kind          string                 `json:"kind"`
	Day           string                 `json:"day"`
	At            time.Time              `json:"at"`
	SchemaVersion int                    `json:"schema_version"`
	Payload       map[string]interface{} `json:"payload"`
	Mentions      []ExportJournalMention `json:"mentions,omitempty"`
	// SupersededAt and Supersedes are the two halves of a correction. Both are exported so
	// the pair reads as one event in the file, and so an import puts back a journal whose
	// reads return exactly what they returned before.
	SupersededAt *time.Time `json:"superseded_at,omitempty"`
	Supersedes   string     `json:"supersedes,omitempty"`
}

// ExportJournalMention names the person by name, like every other reference in this
// document. `relationship` is absent when the mention points at someone the user has since
// deleted: the entry and its `label` — the name as it was said, which is a quotation —
// survive, and the person does not come back on the way in.
type ExportJournalMention struct {
	Relationship string `json:"relationship,omitempty"`
	Ref          int    `json:"ref"`
	Label        string `json:"label"`
}

type ImportResult struct {
	DryRun               bool `json:"dry_run"`
	RelationshipsCreated int  `json:"relationships_created"`
	SnapshotsCreated     int  `json:"snapshots_created"`
	SnapshotsSkipped     int  `json:"snapshots_skipped"`
	// The journal counts a skip differently from a snapshot: a snapshot is skipped because
	// something that looks like it is already stored, a journal entry because the very same
	// entry is, by the id it was written with.
	JournalEntriesCreated int `json:"journal_entries_created"`
	JournalEntriesSkipped int `json:"journal_entries_skipped"`
}

type MetaResponse struct {
	DBBackend          string        `json:"db_backend"`
	RelationshipCount  int64         `json:"relationship_count"`
	SnapshotCount      int64         `json:"snapshot_count"`
	OldestSnapshotDate aggregateTime `json:"oldest_snapshot_date"`
	JournalEntryCount  int64         `json:"journal_entry_count"`
	// OldestJournalDay is a plain *string, not an aggregateTime, and that is not an
	// oversight — see the comment beside the query in GetMeta.
	OldestJournalDay *string `json:"oldest_journal_day"`
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

	// The same live relationships the document lists are what a mention resolves against,
	// so the two halves of the file cannot name different sets of people.
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

// exportJournal reads every journal row this user has — every kind, superseded ones
// included — and renders it in the document's id-free vocabulary.
//
// Soft-deleted rows still drop out, through GORM's default scope, for the same reason they
// do everywhere else in this file: an export is what you have, not what you once had.
func exportJournal(userID uint, names map[uint]string) (*ExportJournal, error) {
	var entries []models.JournalEntry
	err := database.DB.Preload("Mentions").
		Where("user_id = ?", userID).
		Order("day ASC").Order("at ASC").Order("id ASC").
		Find(&entries).Error
	if err != nil {
		return nil, err
	}

	// A correction is a row id in the column and a client id in the file, so the whole set
	// has to be in hand before any single row can be written out.
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
			// A miss here means the row this one corrected was deleted before the export
			// was taken. The correction still stands on its own; a link pointing at nothing
			// would not, so it is left out rather than written as an id no reader can
			// resolve.
			row.Supersedes = clientIDs[*entry.SupersedesID]
		}

		// Preload hands the association back in whatever order the engine likes. `ref` is
		// how the payload addresses a mention, so `ref` is what the file is ordered on —
		// otherwise two exports of the same database could differ.
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
				// Absent from `names` means the relationship is soft-deleted. The label
				// stays and the name does not: putting the person back would contradict the
				// delete the user asked for.
				exported.Relationship = names[*mention.RelationshipID]
			}
			row.Mentions = append(row.Mentions, exported)
		}

		journal.Entries = append(journal.Entries, row)
	}

	return journal, nil
}

// errDryRun aborts the import transaction after doing all the work, so a dry run and a real
// run walk exactly the same code. Reporting what a *different* code path would have done is
// how preview features start lying.
var errDryRun = errors.New("dry run")

// ImportVault reads an export document back in. It is idempotent, in two different ways
// because the two halves have different notions of identity: a snapshot whose relationship,
// date and stats all match one already stored is skipped as a probable duplicate, while a
// journal entry is skipped when its client id is already taken — which is not a guess.
// Either way, importing the same file twice changes nothing.
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
	// A file that calls itself version 1 and carries a journal is describing itself wrongly,
	// and there is no reading of it that is not a guess. Importing the block anyway would
	// contradict the version; dropping it silently is the description-wipe mistake in a new
	// form. Say so instead (invariant 13).
	if document.Version < 2 && document.Journal != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf(
			"version %d has no journal block, but this file has one", document.Version)})
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
		// One resolver for both halves, so a name that appears as a relationship and then
		// in four hundred mentions is looked up once and counted once.
		people := newImportPeople(tx, userID)

		if err := applyImport(tx, userID, people, prepared.Relationships, &result); err != nil {
			return err
		}
		// After the relationships, so a mention naming someone the file also lists as a
		// relationship lands on the row that already carries their cadence and snapshots
		// rather than racing it into existence.
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

// preparedJournalEntry is one validated journal row plus the two things the file states by
// name and by client id rather than by row id, and which therefore cannot be resolved until
// something has a database in front of it.
type preparedJournalEntry struct {
	Entry      models.JournalEntry
	Mentions   []preparedJournalMention
	Supersedes string
}

// preparedJournalMention is one person an entry named. Relationship is empty when the file
// says the mention is detached — someone the user deleted before the export was taken.
type preparedJournalMention struct {
	Relationship string
	Label        string
	Ref          int
}

// preparedDocument is the whole validated file. The two halves stay separate because they
// are written in a fixed order and counted separately, and because a version 1 file has
// only the first of them.
type preparedDocument struct {
	Relationships []preparedRelationship
	Journal       []preparedJournalEntry
}

// prepareImport validates the whole document and converts it into rows, without touching
// the database. Errors name the relationship and the position within it, because "invalid
// date" alone is useless against a file with hundreds of snapshots.
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

// checkinTriggerRefs lists the triggers a check-in's feelings say they are about. It decodes
// through the same payload struct the write path uses, so the two cannot drift on where a
// reference lives.
func checkinTriggerRefs(kind string, payload map[string]interface{}) []string {
	if kind != kindCheckin {
		return nil
	}
	var typed checkinPayload
	if err := decodePayload(payload, kindCheckin, &typed); err != nil {
		// Unreachable in practice: validateCheckinPayload decoded this same map a moment
		// ago and would have reported the failure with a better message.
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

// prepareJournal validates the journal block and turns it into rows, without touching the
// database. Like the snapshots above, one bad value rejects the file whole: a journal that
// half-applied would leave the user unable to tell which half.
//
// It reads the file twice because a reference may point forwards. A check-in names a trigger
// by client id and nothing requires the trigger to be listed first — file order is the
// export's business, not the reader's — so which ids name triggers is only known once every
// row has been read.
func prepareJournal(journal *ExportJournal) ([]preparedJournalEntry, error) {
	if journal == nil {
		return nil, nil
	}

	// reference is one trigger id an entry leans on, carried with the entry that named it
	// so the error can say which row points at nothing.
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
		// Deliberately not the write path's future-skew check: a file is a record of what
		// already happened, and the clock that matters is the one it was written on.
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

	// The second read. An export always carries the trigger a check-in names — triggers are
	// entries like any other and nothing filters them out — so a miss means the file was
	// edited, truncated, or written by something that does not understand what it wrote.
	// Naming the id is the whole point: the alternative is a stored feeling attached to a
	// word nobody can look up.
	for _, reference := range references {
		if !triggers[reference.trigger] {
			return nil, fmt.Errorf("%s names a trigger this file does not contain: %s",
				reference.where, reference.trigger)
		}
	}

	return prepared, nil
}

// applyImport writes the prepared rows, counting what it did. Relationships resolve through
// the same find-or-create the create endpoint uses, so an import merges into the stacks the
// user already has rather than shadowing them.
func applyImport(tx *gorm.DB, userID uint, people *importPeople, prepared []preparedRelationship, result *ImportResult) error {
	for _, entry := range prepared {
		relationship, created, err := people.resolve(entry.Name)
		if err != nil {
			return err
		}
		if created {
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

// findOrCreateForImport wraps database.FindOrCreateRelationship with the "was it new?"
// answer `relationships_created` needs. Both halves of an import resolve people through
// here — the snapshot half once per relationship in the file, the journal half once per
// distinct name — so the two cannot disagree about what counts as the same person.
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

// importPeople resolves names to relationships once each for the life of one import.
//
// Without it the journal half re-resolves per *mention*: two queries for every mention of
// every entry, so a three-thousand-entry file naming the same handful of people pays
// thousands of round trips to learn the same few ids. The cache is scoped to the one
// transaction and the one user, and it is keyed on the trimmed name — the same key
// FindOrCreateRelationship resolves on — so it cannot answer for a name that would have
// resolved differently.
type importPeople struct {
	tx     *gorm.DB
	userID uint
	seen   map[string]*models.Relationship
}

func newImportPeople(tx *gorm.DB, userID uint) *importPeople {
	return &importPeople{tx: tx, userID: userID, seen: map[string]*models.Relationship{}}
}

// resolve returns the relationship for name, creating it on first sight. `created` is true
// only on the call that created it, so a caller counting new relationships counts each once
// however many entries name it.
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

// applyJournal writes the journal rows the file brought that this user does not already
// have. Identity is the client id, not the content: a journal entry has a stable identity a
// snapshot lacks, so its duplicate check is exact and a re-import is a true no-op.
//
// **The order the file lists entries in does not matter, and that is the choice.** A
// check-in points at a trigger by client id *inside its payload*, which is opaque to SQL —
// there is no database link that needs the trigger row to exist first, so importing them in
// any order produces the same rows. The one real link is `supersedes_id`, and it is resolved
// in a second pass over the client ids this import can see, which is immune to file order
// too. Sorting triggers to the front would have been the other answer; it would only have
// worked for triggers, and it would have quietly broken the day a second reference of this
// kind appeared. Rows are still inserted in the order the file lists them, so two runs over
// the same file lay them out identically.
func applyJournal(tx *gorm.DB, userID uint, people *importPeople, prepared []preparedJournalEntry, result *ImportResult) error {
	if len(prepared) == 0 {
		return nil
	}

	// Unscoped on purpose. A soft-deleted row still holds its (user_id, client_id) slot, so
	// an import that could not see it would collide with the unique index instead of
	// skipping — and re-importing a file must not resurrect an entry the user deleted,
	// which is the same answer the write path gives a retried POST (§6.2).
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

	// correction is one supersedes link, held back until every row the file brought has an
	// id — the second pass that makes the import order-independent.
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
			// An absent name is a mention whose person was already deleted when the export
			// was taken. Find-or-create would put them back, which is not what the file
			// says happened; the label — the name as it was said — carries the meaning on
			// its own.
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
			// The row this one corrected is neither in the file nor already here: it was
			// deleted before the export was taken, which is why the export could not name
			// it either. The correction still stands on its own; a link to a row that does
			// not exist would not.
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

	// Every journal row that is still stored, superseded ones included: a correction does
	// not remove the statement it replaces, the export carries both, and this number
	// answers "how much of my data is here", not "how many entries are current".
	err = database.DB.Model(&models.JournalEntry{}).
		Where("user_id = ?", userID).Count(&meta.JournalEntryCount).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read metadata"})
		return
	}

	// The counterpart to the caveat above, and the one place it does *not* apply: `day` is
	// a varchar(10), so MIN() over it is a string on both engines and there is nothing for
	// the aggregate to mistype. A plain *string scans it; aggregateTime would be solving a
	// problem that only exists for time columns (trap 10a). This is the reason `day` is
	// text and not a date.
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
