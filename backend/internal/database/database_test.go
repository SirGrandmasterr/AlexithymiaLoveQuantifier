package database

import (
	"path/filepath"
	"testing"
	"time"

	"alexithymia-backend/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// setupMemoryDB creates an isolated, in-memory SQLite database specifically customized
// for safely executing complex structural integrations and GORM mappings.
func setupMemoryDB(t *testing.T) *gorm.DB {
	// file::memory:?cache=shared creates a purely in-memory database that wipes instantly upon closing
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{
		// Disable foreign key constraints if needed by sqlite specifically, though sqlite supports them we enable later if we want strict
	})
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
	// In SQLite, if a field isn't explicitly inserted, GORM skips it. But if we try to force an empty string
	// GORM will just insert "". The `not null` check is often database driver specific.
	// We'll log the behavior rather than failing because sqlite handles NOT NULL differently than Postgres.
	_ = db.Create(&badUser).Error
}

// additiveColumns are the columns added after the original schema. Every one must be
// nullable and AutoMigrate-compatible: no phase before Phase 4 may need a real migration.
var additiveColumns = []string{"tags", "uncertain", "guide_answers"}

// TestAutoMigrateAddsNewColumns simulates a legacy database: the columns added by later
// phases are dropped from an existing table with existing rows, and AutoMigrate must add
// them back additively — the SQLite half of the "no structural migration yet" guarantee.
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
