package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"alexithymia-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Like relationships_test.go, these run against real SQLite: export and import are about
// what ends up in (and comes out of) the database, and a round-trip assertion is only
// meaningful against a real engine.

func vaultRoutes(r *gin.Engine) {
	r.GET("/export", ExportVault)
	r.POST("/import", ImportVault)
	r.GET("/meta", GetMeta)
}

// seedRichStack creates a relationship whose snapshots exercise every optional field, so a
// round-trip that drops one is visible.
func seedRichStack(t *testing.T, db *gorm.DB, userID uint) *models.Relationship {
	t.Helper()

	cadence := 30
	relationship := models.Relationship{UserID: userID, Name: "Alex", CadenceDays: &cadence}
	if err := db.Create(&relationship).Error; err != nil {
		t.Fatalf("Failed to seed relationship: %v", err)
	}

	dated, err := time.Parse(dateLayout, "2026-01-10")
	if err != nil {
		t.Fatalf("Bad seed date: %v", err)
	}
	rows := []models.AnalysisSubject{
		{
			UserID: userID, RelationshipID: &relationship.ID, Name: "Alex", Kind: KindFull,
			Date: &dated, Stats: map[string]int{"eros": 40, "mania": 70},
			Description: "rough month", Tags: []string{"conflict", "distance"},
			Uncertain: []string{"mania"}, GuideAnswers: map[string]map[string]int{"eros": {"0": 2}},
		},
		{
			// A pulse, and an undated one — both shapes the export has to survive.
			UserID: userID, RelationshipID: &relationship.ID, Name: "Alex", Kind: KindPulse,
			Stats: map[string]int{"eros": 45},
		},
	}
	for i := range rows {
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatalf("Failed to seed snapshot: %v", err)
		}
	}

	return &relationship
}

func exportFor(t *testing.T, userID uint) ExportDocument {
	t.Helper()

	w := call(t, http.MethodGet, "/export", userID, "", vaultRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	var document ExportDocument
	if err := json.Unmarshal(w.Body.Bytes(), &document); err != nil {
		t.Fatalf("Failed to parse the export: %v", err)
	}
	return document
}

func TestExportShape(t *testing.T) {
	db := setupSQLiteDB(t)
	if err := db.Create(&models.User{Email: "vault@example.com", Password: "$2a$14$hashed", Name: "Jane"}).Error; err != nil {
		t.Fatalf("Failed to seed user: %v", err)
	}
	seedRichStack(t, db, 1)
	seedStack(t, db, 2, "Not Mine", "2026-02-02")

	w := call(t, http.MethodGet, "/export", 1, "", vaultRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	// Asserted on the raw bytes, not the parsed struct: a password could only leak by
	// appearing in the payload, and a struct-level check would miss a field added later.
	raw := w.Body.String()
	for _, forbidden := range []string{"password", "Password", "$2a$"} {
		if strings.Contains(raw, forbidden) {
			t.Errorf("Export payload contains %q:\n%s", forbidden, raw)
		}
	}
	if strings.Contains(raw, "Not Mine") {
		t.Error("Export leaked another user's relationship")
	}

	var document ExportDocument
	if err := json.Unmarshal(w.Body.Bytes(), &document); err != nil {
		t.Fatalf("Failed to parse the export: %v", err)
	}
	if document.Format != exportFormat || document.Version != exportVersion {
		t.Errorf("Expected format %q version %d, got %q/%d", exportFormat, exportVersion, document.Format, document.Version)
	}
	if document.User.Email != "vault@example.com" || document.User.Name != "Jane" {
		t.Errorf("Expected the profile facts, got %+v", document.User)
	}
	if len(document.Relationships) != 1 {
		t.Fatalf("Expected 1 relationship, got %d", len(document.Relationships))
	}

	alex := document.Relationships[0]
	if alex.CadenceDays == nil || *alex.CadenceDays != 30 {
		t.Errorf("Expected the cadence to be exported, got %v", alex.CadenceDays)
	}
	if len(alex.Snapshots) != 2 {
		t.Fatalf("Expected 2 snapshots, got %d", len(alex.Snapshots))
	}
	if alex.Snapshots[0].Date == nil || *alex.Snapshots[0].Date != "2026-01-10" {
		t.Errorf("Expected a YYYY-MM-DD date, got %v", alex.Snapshots[0].Date)
	}
	if alex.Snapshots[0].Description != "rough month" || len(alex.Snapshots[0].Tags) != 2 {
		t.Errorf("Expected the context capsule to survive, got %+v", alex.Snapshots[0])
	}
	// Undated last, and a pulse stays a pulse.
	if alex.Snapshots[1].Date != nil || alex.Snapshots[1].Kind != KindPulse {
		t.Errorf("Expected the undated pulse last, got %+v", alex.Snapshots[1])
	}
}

// TestExportImportRoundTrip is the promise the Vault page makes: take everything out of one
// account, put it into an empty one, and nothing is lost.
func TestExportImportRoundTrip(t *testing.T) {
	db := setupSQLiteDB(t)
	db.Create(&models.User{Email: "source@example.com", Password: "x"})
	db.Create(&models.User{Email: "target@example.com", Password: "x"})
	seedRichStack(t, db, 1)
	seedStack(t, db, 1, "Sam", "2026-03-03", "2026-04-04")

	document := exportFor(t, 1)
	body, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("Failed to re-encode the export: %v", err)
	}

	// Into user 2, who has nothing.
	w := call(t, http.MethodPost, "/import", 2, string(body), vaultRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	var result ImportResult
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.RelationshipsCreated != 2 || result.SnapshotsCreated != 4 || result.SnapshotsSkipped != 0 {
		t.Fatalf("Expected 2 relationships and 4 snapshots created, got %+v", result)
	}

	// The second account's export must now match the first's, relationship for
	// relationship and field for field.
	roundTripped := exportFor(t, 2)
	if len(roundTripped.Relationships) != len(document.Relationships) {
		t.Fatalf("Expected %d relationships back, got %d", len(document.Relationships), len(roundTripped.Relationships))
	}
	for i, original := range document.Relationships {
		copy := roundTripped.Relationships[i]
		if copy.Name != original.Name {
			t.Errorf("Relationship %d: expected %q, got %q", i, original.Name, copy.Name)
		}
		if (copy.CadenceDays == nil) != (original.CadenceDays == nil) {
			t.Errorf("%s: cadence survived as %v, was %v", original.Name, copy.CadenceDays, original.CadenceDays)
		}
		if len(copy.Snapshots) != len(original.Snapshots) {
			t.Fatalf("%s: expected %d snapshots, got %d", original.Name, len(original.Snapshots), len(copy.Snapshots))
		}
		for j, snapshot := range original.Snapshots {
			got := copy.Snapshots[j]
			if got.Kind != snapshot.Kind || got.Description != snapshot.Description {
				t.Errorf("%s snapshot %d: expected kind %q / note %q, got %q / %q",
					original.Name, j, snapshot.Kind, snapshot.Description, got.Kind, got.Description)
			}
			if len(got.Stats) != len(snapshot.Stats) || len(got.Tags) != len(snapshot.Tags) ||
				len(got.Uncertain) != len(snapshot.Uncertain) || len(got.GuideAnswers) != len(snapshot.GuideAnswers) {
				t.Errorf("%s snapshot %d: fields lost in the round trip\n got  %+v\n want %+v",
					original.Name, j, got, snapshot)
			}
		}
	}
}

func TestReimportIsANoOp(t *testing.T) {
	db := setupSQLiteDB(t)
	db.Create(&models.User{Email: "source@example.com", Password: "x"})
	seedRichStack(t, db, 1)

	document := exportFor(t, 1)
	body, _ := json.Marshal(document)

	// Back into the *same* account: everything is already there.
	w := call(t, http.MethodPost, "/import", 1, string(body), vaultRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	var result ImportResult
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.SnapshotsCreated != 0 || result.SnapshotsSkipped != 2 || result.RelationshipsCreated != 0 {
		t.Errorf("Expected everything skipped, got %+v", result)
	}

	var snapshots int64
	db.Model(&models.AnalysisSubject{}).Where("user_id = ?", 1).Count(&snapshots)
	if snapshots != 2 {
		t.Errorf("Expected the snapshot count to be unchanged at 2, got %d", snapshots)
	}
}

func TestImportDryRunWritesNothing(t *testing.T) {
	db := setupSQLiteDB(t)
	db.Create(&models.User{Email: "source@example.com", Password: "x"})
	db.Create(&models.User{Email: "target@example.com", Password: "x"})
	seedRichStack(t, db, 1)

	document := exportFor(t, 1)
	body, _ := json.Marshal(document)

	w := call(t, http.MethodPost, "/import?dry_run=true", 2, string(body), vaultRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	var preview ImportResult
	json.Unmarshal(w.Body.Bytes(), &preview)
	if !preview.DryRun {
		t.Error("Expected the response to say it was a dry run")
	}
	if preview.RelationshipsCreated != 1 || preview.SnapshotsCreated != 2 {
		t.Errorf("Expected the preview to report 1 relationship and 2 snapshots, got %+v", preview)
	}

	var written int64
	db.Model(&models.AnalysisSubject{}).Where("user_id = ?", 2).Count(&written)
	if written != 0 {
		t.Errorf("Expected a dry run to write nothing, found %d snapshots", written)
	}
	db.Model(&models.Relationship{}).Where("user_id = ?", 2).Count(&written)
	if written != 0 {
		t.Errorf("Expected a dry run to write nothing, found %d relationships", written)
	}

	// And the real run then reports exactly what the preview promised.
	w = call(t, http.MethodPost, "/import", 2, string(body), vaultRoutes)
	var real ImportResult
	json.Unmarshal(w.Body.Bytes(), &real)
	if real.RelationshipsCreated != preview.RelationshipsCreated || real.SnapshotsCreated != preview.SnapshotsCreated {
		t.Errorf("Dry run promised %+v, real run did %+v", preview, real)
	}
}

func TestImportRejectsBadDataWholesale(t *testing.T) {
	cases := []struct {
		name          string
		body          string
		expectedError string
	}{
		{
			name:          "unknown format",
			body:          `{"format":"something-else","version":1,"relationships":[]}`,
			expectedError: "unrecognized format",
		},
		{
			name:          "unsupported version",
			body:          `{"format":"alq-export","version":99,"relationships":[]}`,
			expectedError: "unsupported export version",
		},
		{
			name: "bad stats value",
			body: `{"format":"alq-export","version":1,"relationships":[
				{"name":"Alex","snapshots":[
					{"date":"2026-01-01","stats":{"eros":40}},
					{"date":"2026-02-01","stats":{"eros":140}}
				]}]}`,
			expectedError: "stats.eros must be between 0 and 100",
		},
		{
			name: "unknown category",
			body: `{"format":"alq-export","version":1,"relationships":[
				{"name":"Alex","snapshots":[{"date":"2026-01-01","stats":{"love":40}}]}]}`,
			expectedError: "unknown stats key: love",
		},
		{
			name: "bad kind",
			body: `{"format":"alq-export","version":1,"relationships":[
				{"name":"Alex","snapshots":[{"date":"2026-01-01","kind":"guess"}]}]}`,
			// Also asserts the position prefix: "invalid kind" alone is useless against a
			// file with hundreds of snapshots.
			expectedError: `Alex, snapshot 1: kind must be`,
		},
		{
			name: "cadence out of range",
			body: `{"format":"alq-export","version":1,"relationships":[
				{"name":"Alex","cadence_days":3,"snapshots":[]}]}`,
			expectedError: "cadence_days must be between 7 and 365",
		},
		{
			name: "nameless relationship",
			body: `{"format":"alq-export","version":1,"relationships":[
				{"name":"   ","snapshots":[]}]}`,
			expectedError: "every relationship needs a name",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db := setupSQLiteDB(t)

			w := call(t, http.MethodPost, "/import", 1, tc.body, vaultRoutes)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("Expected 400 but got %d (body: %s)", w.Code, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), tc.expectedError) {
				t.Errorf("Expected an error containing %q, got %s", tc.expectedError, w.Body.String())
			}

			// Validation runs before any write, so one bad value rejects the file whole
			// rather than leaving half of it applied.
			var written int64
			db.Model(&models.AnalysisSubject{}).Count(&written)
			if written != 0 {
				t.Errorf("Expected nothing written on a rejected import, found %d snapshots", written)
			}
			db.Model(&models.Relationship{}).Count(&written)
			if written != 0 {
				t.Errorf("Expected nothing written on a rejected import, found %d relationships", written)
			}
		})
	}
}

// TestImportMergesIntoExistingStacks proves an import is not a shadow copy: it lands in the
// relationships the user already has.
func TestImportMergesIntoExistingStacks(t *testing.T) {
	db := setupSQLiteDB(t)
	existing := seedStack(t, db, 1, "Alex", "2026-01-10")

	body := `{"format":"alq-export","version":1,"relationships":[
		{"name":"  Alex  ","snapshots":[{"date":"2026-05-05","stats":{"eros":80}}]}]}`
	w := call(t, http.MethodPost, "/import", 1, body, vaultRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	var result ImportResult
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.RelationshipsCreated != 0 || result.SnapshotsCreated != 1 {
		t.Errorf("Expected the snapshot to join the existing stack, got %+v", result)
	}

	var count int64
	db.Model(&models.AnalysisSubject{}).Where("relationship_id = ?", existing.ID).Count(&count)
	if count != 2 {
		t.Errorf("Expected 2 snapshots on the existing relationship, got %d", count)
	}
}

// TestImportKeepsALocalCadence: the file describes the past, the app holds the present.
func TestImportKeepsALocalCadence(t *testing.T) {
	db := setupSQLiteDB(t)
	local := 90
	relationship := models.Relationship{UserID: 1, Name: "Alex", CadenceDays: &local}
	db.Create(&relationship)

	body := `{"format":"alq-export","version":1,"relationships":[
		{"name":"Alex","cadence_days":30,"snapshots":[]}]}`
	if w := call(t, http.MethodPost, "/import", 1, body, vaultRoutes); w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var reloaded models.Relationship
	db.First(&reloaded, relationship.ID)
	if reloaded.CadenceDays == nil || *reloaded.CadenceDays != 90 {
		t.Errorf("Expected the rhythm chosen here to win, got %v", reloaded.CadenceDays)
	}

	// But a relationship with no rhythm set does take the file's.
	db.Create(&models.Relationship{UserID: 1, Name: "Sam"})
	body = `{"format":"alq-export","version":1,"relationships":[
		{"name":"Sam","cadence_days":30,"snapshots":[]}]}`
	if w := call(t, http.MethodPost, "/import", 1, body, vaultRoutes); w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d", w.Code)
	}
	var sam models.Relationship
	db.Where("name = ?", "Sam").First(&sam)
	if sam.CadenceDays == nil || *sam.CadenceDays != 30 {
		t.Errorf("Expected an unset rhythm to take the file's, got %v", sam.CadenceDays)
	}
}

func TestImportRequiresAuth(t *testing.T) {
	setupSQLiteDB(t)

	body := `{"format":"alq-export","version":1,"relationships":[]}`
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodGet, "/export", ""},
		{http.MethodPost, "/import", body},
		{http.MethodGet, "/meta", ""},
	} {
		if w := call(t, tc.method, tc.path, 0, tc.body, vaultRoutes); w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: expected 401 but got %d", tc.method, tc.path, w.Code)
		}
	}
}

func TestGetMeta(t *testing.T) {
	db := setupSQLiteDB(t)
	seedStack(t, db, 1, "Alex", "2026-03-01", "2025-11-20")
	seedStack(t, db, 1, "Sam", "2026-04-04")
	seedStack(t, db, 2, "Theirs", "2020-01-01")

	w := call(t, http.MethodGet, "/meta", 1, "", vaultRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var meta MetaResponse
	if err := json.Unmarshal(w.Body.Bytes(), &meta); err != nil {
		t.Fatalf("Failed to parse: %v", err)
	}
	if meta.DBBackend != "sqlite" {
		t.Errorf("Expected the backend named in plain terms, got %q", meta.DBBackend)
	}
	if meta.RelationshipCount != 2 || meta.SnapshotCount != 3 {
		t.Errorf("Expected 2 relationships and 3 snapshots for this user, got %d and %d",
			meta.RelationshipCount, meta.SnapshotCount)
	}
	// Scoped to the caller: the other user's older snapshot must not set the span.
	if meta.OldestSnapshotDate.Time == nil || meta.OldestSnapshotDate.Time.Format(dateLayout) != "2025-11-20" {
		t.Errorf("Expected the oldest date to be 2025-11-20, got %v", meta.OldestSnapshotDate.Time)
	}

	// No configuration detail leaks through this endpoint.
	for _, forbidden := range []string{"password", "dsn", "host", "JWT"} {
		if strings.Contains(strings.ToLower(w.Body.String()), strings.ToLower(forbidden)) {
			t.Errorf("Meta payload leaked %q: %s", forbidden, w.Body.String())
		}
	}
}
