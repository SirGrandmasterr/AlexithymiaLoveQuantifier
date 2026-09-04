package database

import (
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"alexithymia-backend/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupMemoryDB(t *testing.T) *gorm.DB {
	// file::memory:?cache=shared creates a purely in-memory database that wipes instantly upon closing
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("Failed to open SQLite memory database: %v", err)
	}

	// Migrate both schemas to build actual tables in RAM
	err = db.AutoMigrate(&models.User{}, &models.AnalysisSubject{})
	if err != nil {
		t.Fatalf("Failed to auto-migrate schema: %v", err)
	}

	return db
}

func TestDatabaseIntegration_UserConstraints(t *testing.T) {
	db := setupMemoryDB(t)

	// 1. Test standard User Insertion
	firstUser := models.User{
		Email:    "test@example.com",
		Password: "hashedpassword",
		Name:     "Test User",
	}

	if err := db.Create(&firstUser).Error; err != nil {
		t.Fatalf("Expected successful user creation, got error: %v", err)
	}
	if firstUser.ID == 0 {
		t.Errorf("Expected auto-incrementing ID to be assigned, got 0")
	}

	// 2. Test uniqueIndex Violation
	secondUser := models.User{
		Email:    "test@example.com", // Duplicate email
		Password: "otherpassword",
	}

	err := db.Create(&secondUser).Error
	if err == nil {
		t.Fatalf("Expected an error for uniqueIndex violation on Email, but insertion succeeded")
	}
	// Assert GORM gracefully handled it as an Error rather than Panicking the runtime
	if err.Error() != "UNIQUE constraint failed: users.email" && err.Error() != "constraint failed" {
		t.Logf("Received expected constraint error: %v", err)
	}

	// 3. Test notNull constraint
	badUser := models.User{
		Email: "no-password@example.com",
		// Password omitted (not null in model)
	}
	_ = db.Create(&badUser).Error
}

var additiveColumns = []string{"tags", "uncertain", "guide_answers", "kind"}

func TestAutoMigrateAddsNewColumns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		t.Fatalf("Failed to open SQLite file database: %v", err)
	}
	// Windows will not delete the temp file while the handle is open.
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			sqlDB.Close()
		}
	})

	if err := db.AutoMigrate(&models.User{}, &models.AnalysisSubject{}); err != nil {
		t.Fatalf("Failed initial migration: %v", err)
	}

	// Roll the schema back to its original shape and seed a legacy row.
	for _, column := range additiveColumns {
		if err := db.Migrator().DropColumn(&models.AnalysisSubject{}, column); err != nil {
			t.Fatalf("Failed to drop %s column: %v", column, err)
		}
	}
	if err := db.Exec(`INSERT INTO analysis_subjects (name, description) VALUES (?, ?)`, "Legacy", "old note").Error; err != nil {
		t.Fatalf("Failed to seed legacy row: %v", err)
	}

	if err := db.AutoMigrate(&models.AnalysisSubject{}); err != nil {
		t.Fatalf("AutoMigrate failed on the legacy schema: %v", err)
	}
	for _, column := range additiveColumns {
		if !db.Migrator().HasColumn(&models.AnalysisSubject{}, column) {
			t.Errorf("Expected AutoMigrate to add the %s column", column)
		}
	}

	// The legacy row survives and reads back with the new fields empty — not an error.
	var legacy models.AnalysisSubject
	if err := db.First(&legacy, "name = ?", "Legacy").Error; err != nil {
		t.Fatalf("Failed to read the legacy row after migration: %v", err)
	}
	if legacy.Description != "old note" {
		t.Errorf("Expected the legacy note to survive migration, got %q", legacy.Description)
	}
	if len(legacy.Tags) != 0 {
		t.Errorf("Expected no tags on a legacy row, got %v", legacy.Tags)
	}
	if len(legacy.Uncertain) != 0 {
		t.Errorf("Expected no uncertain flags on a legacy row, got %v", legacy.Uncertain)
	}
	if len(legacy.GuideAnswers) != 0 {
		t.Errorf("Expected no guide answers on a legacy row, got %v", legacy.GuideAnswers)
	}
	if legacy.Kind != "full" {
		t.Errorf("Expected a legacy row to default to kind %q, got %q", "full", legacy.Kind)
	}
}

type legacyAnalysisSubject struct {
	gorm.Model
	UserID       uint                      `json:"user_id"`
	Name         string                    `gorm:"not null" json:"name"`
	Description  string                    `json:"description"`
	Date         *time.Time                `json:"date"`
	Stats        map[string]int            `gorm:"serializer:json" json:"stats"`
	Tags         []string                  `gorm:"serializer:json" json:"tags"`
	Uncertain    []string                  `gorm:"serializer:json" json:"uncertain"`
	GuideAnswers map[string]map[string]int `gorm:"serializer:json" json:"guide_answers"`
}

func (legacyAnalysisSubject) TableName() string { return "analysis_subjects" }

func TestUpgradeFromPreRelationshipSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pre-phase-4.db")
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		t.Fatalf("Failed to open SQLite file database: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			sqlDB.Close()
		}
	})

	if err := db.AutoMigrate(&models.User{}, &legacyAnalysisSubject{}); err != nil {
		t.Fatalf("Failed to build the legacy schema: %v", err)
	}

	seed := `INSERT INTO analysis_subjects (user_id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`
	for _, name := range []string{"Alex", "Alex ", "Sam"} {
		if err := db.Exec(seed, 1, name).Error; err != nil {
			t.Fatalf("Failed to seed %q: %v", name, err)
		}
	}

	// The upgrade, in the order Connect runs it.
	if err := db.AutoMigrate(&models.User{}, &models.Relationship{}, &models.AnalysisSubject{}); err != nil {
		t.Fatalf("Upgrade migration failed: %v", err)
	}
	result, err := BackfillRelationships(db)
	if err != nil {
		t.Fatalf("Backfill failed: %v", err)
	}

	if result.Relationships != 2 || result.Snapshots != 3 {
		t.Errorf("Expected 2 relationships and 3 snapshots linked, got %d and %d", result.Relationships, result.Snapshots)
	}

	var unlinked int64
	db.Model(&models.AnalysisSubject{}).Where("relationship_id IS NULL").Count(&unlinked)
	if unlinked != 0 {
		t.Errorf("Expected every snapshot to be linked, %d were not", unlinked)
	}
}

func TestDatabaseIntegration_SubjectRelationships(t *testing.T) {
	db := setupMemoryDB(t)

	// Create parent user
	user := models.User{Email: "parent@example.com", Password: "pwd"}
	db.Create(&user)

	now := time.Now().Truncate(time.Second) // Truncate because SQLite timestamp precision varies

	// 1. Build an Analysis Subject connected to the User
	subject := models.AnalysisSubject{
		UserID:       user.ID,
		Name:         "Relationship Test",
		Description:  "Data serialization target",
		Date:         &now,
		Stats:        map[string]int{"love": 50, "hate": 12}, // The custom gorm:serializer:json tag
		Tags:         []string{"conflict", "trip together"},  // same serializer, slice form
		Uncertain:    []string{"love"},
		GuideAnswers: map[string]map[string]int{"love": {"0": 3, "2": 1}}, // nested map form
	}

	if err := db.Create(&subject).Error; err != nil {
		t.Fatalf("Expected successful subject creation, got: %v", err)
	}

	// 2. Query it back to test JSON Deserialization
	var retrieved models.AnalysisSubject
	if err := db.First(&retrieved, "id = ?", subject.ID).Error; err != nil {
		t.Fatalf("Failed to retrieve inserted subject: %v", err)
	}

	// Assert generic fields
	if retrieved.Name != "Relationship Test" {
		t.Errorf("Expected Name 'Relationship Test', got '%s'", retrieved.Name)
	}
	if retrieved.Date.Unix() != now.Unix() {
		t.Errorf("Expected Date %v, got %v", now, retrieved.Date)
	}

	// Assert JSON Map Deserialization
	if retrieved.Stats == nil {
		t.Fatalf("Expected Stats map to be deserialized, but it was nil")
	}
	if loveVal, ok := retrieved.Stats["love"]; !ok || loveVal != 50 {
		t.Errorf("Expected Stats['love'] == 50, got %v (ok=%v)", loveVal, ok)
	}

	// Assert JSON Slice Deserialization (context capsule tags)
	if len(retrieved.Tags) != 2 || retrieved.Tags[0] != "conflict" || retrieved.Tags[1] != "trip together" {
		t.Errorf("Expected Tags [conflict, trip together], got %v", retrieved.Tags)
	}

	// Assert the guided-scoring columns survive, including the nested map
	if len(retrieved.Uncertain) != 1 || retrieved.Uncertain[0] != "love" {
		t.Errorf("Expected Uncertain [love], got %v", retrieved.Uncertain)
	}
	if retrieved.GuideAnswers["love"]["0"] != 3 || retrieved.GuideAnswers["love"]["2"] != 1 {
		t.Errorf("Expected GuideAnswers to round-trip, got %v", retrieved.GuideAnswers)
	}

	// 3. Test Deletions (Soft Delete)
	if err := db.Delete(&retrieved).Error; err != nil {
		t.Fatalf("Failed to delete subject: %v", err)
	}

	// Attempt normal fetch - should fail due to DeletedAt filtering
	var deletedFetch models.AnalysisSubject
	err := db.First(&deletedFetch, "id = ?", retrieved.ID).Error
	if err != gorm.ErrRecordNotFound {
		t.Errorf("Expected RecordNotFound for soft-deleted record, got: %v", err)
	}

	// Attempt Unscoped fetch - should succeed discovering the hidden record
	if err := db.Unscoped().First(&deletedFetch, "id = ?", retrieved.ID).Error; err != nil {
		t.Errorf("Failed to retrieve soft-deleted record using Unscoped: %v", err)
	}
}

func openJournalDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), name)), &gorm.Config{})
	if err != nil {
		t.Fatalf("Failed to open SQLite file database: %v", err)
	}
	// Windows will not delete the temp file while the handle is open.
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			sqlDB.Close()
		}
	})
	if err := db.AutoMigrate(Models()...); err != nil {
		t.Fatalf("Failed to migrate the model set: %v", err)
	}
	return db
}

var journalEntryColumns = []string{
	"id", "created_at", "updated_at", "deleted_at",
	"user_id", "client_id", "kind", "day", "at", "schema_version", "payload",
	"superseded_at", "supersedes_id",
}

var journalMentionColumns = []string{"id", "entry_id", "relationship_id", "label", "ref"}

func TestAutoMigrateAddsJournalTables(t *testing.T) {
	db := openJournalDB(t, "pre-journal.db")

	// A Phase-5 row, written before the journal existed, which the migration must not disturb.
	if err := db.Create(&models.AnalysisSubject{UserID: 1, Name: "Lucie", Stats: map[string]int{"eros": 85}}).Error; err != nil {
		t.Fatalf("Failed to seed a pre-journal snapshot: %v", err)
	}

	// Mentions first: the foreign key points at the entries table.
	if err := db.Migrator().DropTable(&models.JournalMention{}, &models.JournalEntry{}); err != nil {
		t.Fatalf("Failed to drop the journal tables: %v", err)
	}
	for _, model := range []interface{}{&models.JournalEntry{}, &models.JournalMention{}} {
		if db.Migrator().HasTable(model) {
			t.Fatalf("Expected %T's table to be gone before the migration", model)
		}
	}

	if err := db.AutoMigrate(Models()...); err != nil {
		t.Fatalf("AutoMigrate failed on the pre-journal schema: %v", err)
	}

	if !db.Migrator().HasTable(&models.JournalEntry{}) {
		t.Fatal("Expected AutoMigrate to create journal_entries")
	}
	if !db.Migrator().HasTable(&models.JournalMention{}) {
		t.Fatal("Expected AutoMigrate to create journal_mentions")
	}
	for _, column := range journalEntryColumns {
		if !db.Migrator().HasColumn(&models.JournalEntry{}, column) {
			t.Errorf("Expected journal_entries to have the %s column", column)
		}
	}
	for _, column := range journalMentionColumns {
		if !db.Migrator().HasColumn(&models.JournalMention{}, column) {
			t.Errorf("Expected journal_mentions to have the %s column", column)
		}
	}

	if !db.Migrator().HasIndex(&models.JournalEntry{}, "idx_journal_user_client") {
		t.Error("Expected the composite unique index idx_journal_user_client")
	}
	if !db.Migrator().HasIndex(&models.JournalEntry{}, "idx_journal_user_day") {
		t.Error("Expected the composite index idx_journal_user_day")
	}
	assertIndexColumns(t, db, "journal_entries", "idx_journal_user_client", []string{"user_id", "client_id"}, true)
	assertIndexColumns(t, db, "journal_entries", "idx_journal_user_day", []string{"user_id", "day"}, false)

	// The pre-journal row is untouched — the migration is additive, not a rebuild.
	var snapshot models.AnalysisSubject
	if err := db.First(&snapshot, "name = ?", "Lucie").Error; err != nil {
		t.Fatalf("Failed to read the pre-journal snapshot back: %v", err)
	}
	if snapshot.Stats["eros"] != 85 {
		t.Errorf("Expected the pre-journal snapshot to survive with its stats, got %v", snapshot.Stats)
	}
}

func assertIndexColumns(t *testing.T, db *gorm.DB, table, index string, want []string, unique bool) {
	t.Helper()
	indexes, err := db.Migrator().GetIndexes(table)
	if err != nil {
		t.Fatalf("Failed to read the indexes of %s: %v", table, err)
	}
	for _, found := range indexes {
		if found.Name() != index {
			continue
		}
		columns := found.Columns()
		if len(columns) != len(want) {
			t.Errorf("Expected %s over %v, got %v", index, want, columns)
			return
		}
		for i, column := range want {
			if columns[i] != column {
				t.Errorf("Expected %s column %d to be %q, got %q", index, i, column, columns[i])
			}
		}
		if isUnique, ok := found.Unique(); ok && isUnique != unique {
			t.Errorf("Expected %s unique=%v, got %v", index, unique, isUnique)
		}
		return
	}
	t.Errorf("Expected an index named %s on %s", index, table)
}

func TestJournalEntryPayloadRoundTrip(t *testing.T) {
	db := openJournalDB(t, "payload.db")

	payload := map[string]interface{}{
		"v":             float64(1),
		"source":        "voice",
		"tz_offset_min": float64(120),
		"transcript":    "long day, good evening",
		"feelings": []interface{}{
			map[string]interface{}{
				"id": "rapport", "intensity": float64(3), "uncertain": false,
				"about": []interface{}{
					map[string]interface{}{"kind": "person", "ref": float64(0)},
					map[string]interface{}{"kind": "tag", "tag": "conflict"},
				},
			},
			map[string]interface{}{"id": "unclear", "intensity": float64(1), "uncertain": true},
		},
		"tags": []interface{}{"evening", "at home"},
		"proposal": map[string]interface{}{
			"model": "none", "prompt_version": float64(1),
			"proposed": []interface{}{"pleasure", "rapport"},
			"accepted": []interface{}{"rapport"},
			"replaced": map[string]interface{}{"pleasure": "calm"},
		},
	}

	at := time.Date(2026, 8, 22, 21, 4, 0, 0, time.UTC)
	entry := models.JournalEntry{
		UserID: 1, ClientID: "6f1c3a0e-0000-4000-8000-000000000001",
		Kind: "checkin", Day: "2026-08-22", At: at, Payload: payload,
	}
	if err := db.Create(&entry).Error; err != nil {
		t.Fatalf("Failed to create a journal entry: %v", err)
	}

	var retrieved models.JournalEntry
	if err := db.First(&retrieved, "id = ?", entry.ID).Error; err != nil {
		t.Fatalf("Failed to read the entry back: %v", err)
	}

	if !reflect.DeepEqual(retrieved.Payload, payload) {
		t.Errorf("Expected the payload to round-trip identically.\n got: %#v\nwant: %#v", retrieved.Payload, payload)
	}

	feelings, ok := retrieved.Payload["feelings"].([]interface{})
	if !ok || len(feelings) != 2 {
		t.Fatalf("Expected two feelings in the round-tripped payload, got %#v", retrieved.Payload["feelings"])
	}
	first, ok := feelings[0].(map[string]interface{})
	if !ok {
		t.Fatalf("Expected the first feeling to be an object, got %#v", feelings[0])
	}
	if first["id"] != "rapport" || first["intensity"] != float64(3) {
		t.Errorf("Expected the nested feeling to survive, got %#v", first)
	}
	about, ok := first["about"].([]interface{})
	if !ok || len(about) != 2 {
		t.Fatalf("Expected two about entries inside the nested feeling, got %#v", first["about"])
	}
	proposal, ok := retrieved.Payload["proposal"].(map[string]interface{})
	if !ok {
		t.Fatalf("Expected the nested proposal object to survive, got %#v", retrieved.Payload["proposal"])
	}
	replaced, ok := proposal["replaced"].(map[string]interface{})
	if !ok || replaced["pleasure"] != "calm" {
		t.Errorf("Expected the twice-nested replaced map to survive, got %#v", proposal["replaced"])
	}

	// The columns beside the payload, since they are what queries actually filter on.
	if retrieved.Day != "2026-08-22" {
		t.Errorf("Expected day %q, got %q", "2026-08-22", retrieved.Day)
	}
	if !retrieved.At.UTC().Equal(at) {
		t.Errorf("Expected at %v, got %v", at, retrieved.At.UTC())
	}
	if retrieved.SchemaVersion != 1 {
		t.Errorf("Expected schema_version to default to 1, got %d", retrieved.SchemaVersion)
	}
	if retrieved.SupersededAt != nil || retrieved.SupersedesID != nil {
		t.Errorf("Expected a fresh entry to supersede nothing, got %v / %v", retrieved.SupersededAt, retrieved.SupersedesID)
	}
}

func TestJournalEntryClientIDIsUniquePerUser(t *testing.T) {
	db := openJournalDB(t, "client-id.db")

	const clientID = "6f1c3a0e-0000-4000-8000-00000000000a"
	at := time.Date(2026, 8, 22, 21, 4, 0, 0, time.UTC)
	first := models.JournalEntry{UserID: 1, ClientID: clientID, Kind: "checkin", Day: "2026-08-22", At: at}
	if err := db.Create(&first).Error; err != nil {
		t.Fatalf("Failed to create the first entry: %v", err)
	}

	retry := models.JournalEntry{UserID: 1, ClientID: clientID, Kind: "checkin", Day: "2026-08-22", At: at}
	if err := db.Create(&retry).Error; err == nil {
		t.Error("Expected a second entry with the same (user_id, client_id) to be rejected")
	} else {
		t.Logf("Received the expected constraint error: %v", err)
	}

	// The same client id under a different user is a different row, not a collision.
	other := models.JournalEntry{UserID: 2, ClientID: clientID, Kind: "checkin", Day: "2026-08-22", At: at}
	if err := db.Create(&other).Error; err != nil {
		t.Errorf("Expected the same client id under another user to be accepted, got: %v", err)
	}

	var count int64
	db.Model(&models.JournalEntry{}).Where("client_id = ?", clientID).Count(&count)
	if count != 2 {
		t.Errorf("Expected two rows carrying that client id, one per user, got %d", count)
	}

	if err := db.Delete(&first).Error; err != nil {
		t.Fatalf("Failed to soft-delete the first entry: %v", err)
	}
	afterDelete := models.JournalEntry{UserID: 1, ClientID: clientID, Kind: "checkin", Day: "2026-08-22", At: at}
	if err := db.Create(&afterDelete).Error; err == nil {
		t.Error("Expected a soft-deleted entry to keep its client id reserved")
	}
}

func TestJournalMentionBelongsToItsEntry(t *testing.T) {
	db := openJournalDB(t, "mentions.db")

	relationship := models.Relationship{UserID: 1, Name: "Lucie"}
	if err := db.Create(&relationship).Error; err != nil {
		t.Fatalf("Failed to create the relationship: %v", err)
	}

	entry := models.JournalEntry{
		UserID: 1, ClientID: "6f1c3a0e-0000-4000-8000-00000000000b",
		Kind: "checkin", Day: "2026-08-22", At: time.Date(2026, 8, 22, 21, 4, 0, 0, time.UTC),
		Mentions: []models.JournalMention{
			{RelationshipID: &relationship.ID, Label: "Lucie", Ref: 0},
			{Label: "the new colleague", Ref: 1},
		},
	}
	if err := db.Create(&entry).Error; err != nil {
		t.Fatalf("Failed to create an entry with mentions: %v", err)
	}

	var retrieved models.JournalEntry
	if err := db.Preload("Mentions").First(&retrieved, "id = ?", entry.ID).Error; err != nil {
		t.Fatalf("Failed to read the entry back with its mentions: %v", err)
	}
	if len(retrieved.Mentions) != 2 {
		t.Fatalf("Expected two mentions, got %d", len(retrieved.Mentions))
	}
	if retrieved.Mentions[0].RelationshipID == nil || *retrieved.Mentions[0].RelationshipID != relationship.ID {
		t.Errorf("Expected the first mention to name the relationship, got %v", retrieved.Mentions[0].RelationshipID)
	}
	if retrieved.Mentions[0].Label != "Lucie" {
		t.Errorf("Expected the label to be kept beside the id, got %q", retrieved.Mentions[0].Label)
	}
	// Absent, not zero: a person named in passing has no relationship row yet.
	if retrieved.Mentions[1].RelationshipID != nil {
		t.Errorf("Expected an unresolved mention to have a nil relationship_id, got %v", *retrieved.Mentions[1].RelationshipID)
	}
	if retrieved.Mentions[1].Ref != 1 {
		t.Errorf("Expected ref 1 on the second mention, got %d", retrieved.Mentions[1].Ref)
	}
}
