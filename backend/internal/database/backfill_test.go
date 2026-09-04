package database

import (
	"testing"

	"alexithymia-backend/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func setupBackfillDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("Failed to open SQLite memory database: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			sqlDB.Close()
		}
	})

	if err := db.AutoMigrate(&models.User{}, &models.Relationship{}, &models.AnalysisSubject{}); err != nil {
		t.Fatalf("Failed to migrate schema: %v", err)
	}
	return db
}

func seedLegacySubject(t *testing.T, db *gorm.DB, userID uint, name string, softDeleted bool) {
	t.Helper()

	statement := `INSERT INTO analysis_subjects (user_id, name, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`
	if softDeleted {
		statement = `INSERT INTO analysis_subjects (user_id, name, created_at, updated_at, deleted_at) VALUES (?, ?, datetime('now'), datetime('now'), datetime('now'))`
	}
	if err := db.Exec(statement, userID, name).Error; err != nil {
		t.Fatalf("Failed to seed legacy snapshot %q: %v", name, err)
	}
}

func TestBackfillGroupsByTrimmedNamePerUser(t *testing.T) {
	db := setupBackfillDB(t)

	seedLegacySubject(t, db, 1, "Alex", false)
	seedLegacySubject(t, db, 1, "  Alex  ", false) // same stack once trimmed
	seedLegacySubject(t, db, 1, "Sam", false)
	// Two people named Alex, one per user, must not collapse into one relationship.
	seedLegacySubject(t, db, 2, "Alex", false)

	result, err := BackfillRelationships(db)
	if err != nil {
		t.Fatalf("Backfill failed: %v", err)
	}
	if result.Relationships != 3 || result.Snapshots != 4 {
		t.Errorf("Expected 3 relationships and 4 snapshots linked, got %d and %d", result.Relationships, result.Snapshots)
	}

	var subjects []models.AnalysisSubject
	if err := db.Order("id").Find(&subjects).Error; err != nil {
		t.Fatalf("Failed to read back subjects: %v", err)
	}
	for _, subject := range subjects {
		if subject.RelationshipID == nil {
			t.Fatalf("Snapshot %d was left unlinked", subject.ID)
		}
	}

	// The two Alexes of user 1 share a relationship; user 2's Alex does not.
	if *subjects[0].RelationshipID != *subjects[1].RelationshipID {
		t.Errorf("Expected the trimmed duplicate to join the same stack")
	}
	if *subjects[2].RelationshipID == *subjects[0].RelationshipID {
		t.Errorf("Expected Sam to get its own relationship")
	}
	if *subjects[3].RelationshipID == *subjects[0].RelationshipID {
		t.Errorf("Expected another user's Alex to get its own relationship")
	}

	// The one-time name cleanup Phase 1 deferred.
	if subjects[1].Name != "Alex" {
		t.Errorf("Expected the stored name to be normalized to %q, got %q", "Alex", subjects[1].Name)
	}
}

// TestBackfillIsIdempotent is what makes running it on every boot safe.
func TestBackfillIsIdempotent(t *testing.T) {
	db := setupBackfillDB(t)

	seedLegacySubject(t, db, 1, "Alex", false)
	seedLegacySubject(t, db, 1, "Alex", false)
	seedLegacySubject(t, db, 1, "Sam", false)

	first, err := BackfillRelationships(db)
	if err != nil {
		t.Fatalf("First backfill failed: %v", err)
	}
	if first.Relationships != 2 || first.Snapshots != 3 {
		t.Fatalf("Expected 2 relationships and 3 snapshots on the first pass, got %d and %d", first.Relationships, first.Snapshots)
	}

	second, err := BackfillRelationships(db)
	if err != nil {
		t.Fatalf("Second backfill failed: %v", err)
	}
	if second.Relationships != 0 || second.Snapshots != 0 {
		t.Errorf("Expected the second pass to be a no-op, got %d relationships and %d snapshots", second.Relationships, second.Snapshots)
	}

	var relationships int64
	db.Model(&models.Relationship{}).Count(&relationships)
	if relationships != 2 {
		t.Errorf("Expected the second pass to create nothing, ending with 2 relationships, got %d", relationships)
	}
}

func TestBackfillIncludesSoftDeletedSnapshots(t *testing.T) {
	db := setupBackfillDB(t)

	seedLegacySubject(t, db, 1, "Alex", false)
	seedLegacySubject(t, db, 1, "Alex", true)

	result, err := BackfillRelationships(db)
	if err != nil {
		t.Fatalf("Backfill failed: %v", err)
	}
	if result.Relationships != 1 || result.Snapshots != 2 {
		t.Errorf("Expected 1 relationship and 2 snapshots linked, got %d and %d", result.Relationships, result.Snapshots)
	}

	var subjects []models.AnalysisSubject
	db.Unscoped().Order("id").Find(&subjects)
	if len(subjects) != 2 {
		t.Fatalf("Expected 2 rows including the deleted one, got %d", len(subjects))
	}
	if subjects[1].RelationshipID == nil || *subjects[0].RelationshipID != *subjects[1].RelationshipID {
		t.Errorf("Expected the soft-deleted snapshot to share its siblings' relationship")
	}
}

func TestBackfillReusesExistingRelationships(t *testing.T) {
	db := setupBackfillDB(t)

	existing := models.Relationship{UserID: 1, Name: "Alex"}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatalf("Failed to seed the existing relationship: %v", err)
	}
	linked := models.AnalysisSubject{UserID: 1, RelationshipID: &existing.ID, Name: "Alex"}
	if err := db.Create(&linked).Error; err != nil {
		t.Fatalf("Failed to seed the linked snapshot: %v", err)
	}
	seedLegacySubject(t, db, 1, "Alex", false)

	result, err := BackfillRelationships(db)
	if err != nil {
		t.Fatalf("Backfill failed: %v", err)
	}
	if result.Relationships != 0 {
		t.Errorf("Expected no new relationship for a name that already has one, got %d", result.Relationships)
	}
	if result.Snapshots != 1 {
		t.Errorf("Expected only the unlinked snapshot to be touched, got %d", result.Snapshots)
	}

	var count int64
	db.Model(&models.AnalysisSubject{}).Where("relationship_id = ?", existing.ID).Count(&count)
	if count != 2 {
		t.Errorf("Expected both snapshots on the existing relationship, got %d", count)
	}
}

func TestBackfillOnAnEmptyDatabase(t *testing.T) {
	db := setupBackfillDB(t)

	result, err := BackfillRelationships(db)
	if err != nil {
		t.Fatalf("Backfill failed on an empty database: %v", err)
	}
	if result.Relationships != 0 || result.Snapshots != 0 {
		t.Errorf("Expected zeros on an empty database, got %+v", result)
	}
}
