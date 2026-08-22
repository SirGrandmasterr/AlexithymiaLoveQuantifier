package handlers

import (
	"encoding/json"
	"net/http"
	"reflect"
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

// The Vault's "your data" paragraph has to be able to say how much journal there is.
func TestGetMetaCountsJournal(t *testing.T) {
	db := setupSQLiteDB(t)
	seedStack(t, db, 1, "Alex", "2026-03-01")

	seedEntry(t, db, 1, kindCheckin, "2026-08-20", "2026-08-20T09:00:00Z")
	seedEntry(t, db, 1, kindCheckin, "2026-07-02", "2026-07-02T09:00:00Z")
	superseded := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T09:00:00Z")
	deleted := seedEntry(t, db, 1, kindCheckin, "2026-08-22", "2026-08-22T09:00:00Z")
	// Another user's older day must not set this user's span.
	seedEntry(t, db, 2, kindCheckin, "2020-01-01", "2020-01-01T09:00:00Z")

	db.Model(&superseded).Update("superseded_at", superseded.At)
	db.Delete(&models.JournalEntry{}, deleted.ID)

	w := call(t, http.MethodGet, "/meta", 1, "", vaultRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var meta MetaResponse
	if err := json.Unmarshal(w.Body.Bytes(), &meta); err != nil {
		t.Fatalf("Failed to parse: %v", err)
	}

	// Three: two current, one superseded. The superseded row is still stored and still
	// exported, so it still counts; the soft-deleted one does not.
	if meta.JournalEntryCount != 3 {
		t.Errorf("Expected 3 journal entries for this user, got %d", meta.JournalEntryCount)
	}
	if meta.OldestJournalDay == nil {
		t.Fatal("Expected an oldest journal day")
	}
	if *meta.OldestJournalDay != "2026-07-02" {
		t.Errorf("Expected the oldest day to be 2026-07-02, got %q", *meta.OldestJournalDay)
	}

	// The point of the *string: MIN() over a varchar(10) is a string on both engines, so
	// there is nothing for an aggregate to mistype and no aggregateTime needed (trap 10a).
	// If this ever comes back as a timestamp, `day` stopped being text.
	if !strings.Contains(w.Body.String(), `"oldest_journal_day":"2026-07-02"`) {
		t.Errorf("Expected the day to serialize as a bare YYYY-MM-DD string, got %s", w.Body.String())
	}
}

func TestGetMetaWithAnEmptyJournal(t *testing.T) {
	db := setupSQLiteDB(t)
	seedStack(t, db, 1, "Alex", "2026-03-01")

	w := call(t, http.MethodGet, "/meta", 1, "", vaultRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var meta MetaResponse
	if err := json.Unmarshal(w.Body.Bytes(), &meta); err != nil {
		t.Fatalf("Failed to parse: %v", err)
	}
	if meta.JournalEntryCount != 0 {
		t.Errorf("Expected no journal entries, got %d", meta.JournalEntryCount)
	}
	if meta.OldestJournalDay != nil {
		t.Errorf("Expected no oldest day on an empty journal, got %q", *meta.OldestJournalDay)
	}
	if !strings.Contains(w.Body.String(), `"oldest_journal_day":null`) {
		t.Errorf("Expected an absent span to be null rather than an empty string, got %s", w.Body.String())
	}
}

// The client ids the journal seed writes, named so an assertion can say which row it means.
// Real ones are UUIDs a client minted; these are the same shape, chosen to be readable.
const (
	seedTriggerWork     = "aaaaaaaa-0000-4000-8000-000000000001"
	seedTriggerDeadline = "aaaaaaaa-0000-4000-8000-000000000002"
	seedTriggerMerged   = "aaaaaaaa-0000-4000-8000-000000000003"
	seedCheckinFirst    = "bbbbbbbb-0000-4000-8000-000000000001"
	seedCheckinFixed    = "bbbbbbbb-0000-4000-8000-000000000002"
	seedCheckinPlain    = "bbbbbbbb-0000-4000-8000-000000000003"
	seedRitualNight     = "cccccccc-0000-4000-8000-000000000001"
	seedFactAboutLucie  = "dddddddd-0000-4000-8000-000000000001"
)

// seedJournal writes the eight rows a full journal has to survive: two triggers and the
// correction that merged one into the other, a check-in naming a person, a tag and a
// trigger, the correction that replaced it, a plain check-in, a nightly ritual, and a fact
// about a person. Written straight to the database, the way seedEntry does, so the seed can
// lay out shapes the write path builds over several requests.
func seedJournal(t *testing.T, db *gorm.DB, userID uint) *models.Relationship {
	t.Helper()

	lucie := models.Relationship{UserID: userID, Name: "Lucie"}
	if err := db.Create(&lucie).Error; err != nil {
		t.Fatalf("Failed to seed relationship: %v", err)
	}

	at := func(value string) time.Time {
		instant, err := time.Parse(time.RFC3339, value)
		if err != nil {
			t.Fatalf("Bad seed instant %q: %v", value, err)
		}
		return instant.UTC()
	}
	write := func(entry models.JournalEntry) models.JournalEntry {
		entry.UserID = userID
		entry.SchemaVersion = 1
		if err := db.Create(&entry).Error; err != nil {
			t.Fatalf("Failed to seed journal entry %s: %v", entry.ClientID, err)
		}
		return entry
	}
	supersede := func(older models.JournalEntry, newer models.JournalEntry) {
		// Stamped with the replacing statement's own instant, the way CreateJournalEntry
		// does it, so the pair reads as one event in the file.
		err := db.Model(&models.JournalEntry{}).Where("id = ?", older.ID).
			Update("superseded_at", newer.At).Error
		if err != nil {
			t.Fatalf("Failed to supersede %s: %v", older.ClientID, err)
		}
	}

	work := write(models.JournalEntry{
		ClientID: seedTriggerWork, Kind: kindTrigger,
		Day: "2026-08-19", At: at("2026-08-19T09:00:00Z"),
		Payload: map[string]interface{}{
			"v": float64(1), "label": "work", "merged_into": nil,
			"created_from": seedCheckinFirst,
		},
	})
	write(models.JournalEntry{
		ClientID: seedTriggerDeadline, Kind: kindTrigger,
		Day: "2026-08-19", At: at("2026-08-19T09:05:00Z"),
		Payload: map[string]interface{}{"v": float64(1), "label": "deadline", "merged_into": nil},
	})
	merged := write(models.JournalEntry{
		ClientID: seedTriggerMerged, Kind: kindTrigger,
		Day: "2026-08-20", At: at("2026-08-20T18:00:00Z"), SupersedesID: &work.ID,
		Payload: map[string]interface{}{
			"v": float64(1), "label": "work", "merged_into": seedTriggerDeadline,
		},
	})
	supersede(work, merged)

	first := write(models.JournalEntry{
		ClientID: seedCheckinFirst, Kind: kindCheckin,
		Day: "2026-08-21", At: at("2026-08-21T16:42:10Z"),
		Payload: map[string]interface{}{
			"v": float64(1), "source": "typed", "tz_offset_min": float64(120),
			"transcript": "A long day, and Lucie made it better.",
			"tags":       []interface{}{"work"},
			"feelings": []interface{}{
				map[string]interface{}{
					"id": "rapport", "intensity": float64(3), "uncertain": false,
					"about": []interface{}{
						map[string]interface{}{"kind": "person", "ref": float64(0)},
					},
				},
				map[string]interface{}{
					"id": "stress", "intensity": float64(2), "uncertain": true,
					"about": []interface{}{
						map[string]interface{}{"kind": "trigger", "trigger": seedTriggerDeadline},
						map[string]interface{}{"kind": "tag", "tag": "conflict"},
					},
				},
			},
		},
		Mentions: []models.JournalMention{{RelationshipID: &lucie.ID, Ref: 0, Label: "Lucie"}},
	})
	// The correction names the *superseded* trigger, which is what makes it worth having
	// here: the file carries that row too, so the reference still resolves on the way back.
	fixed := write(models.JournalEntry{
		ClientID: seedCheckinFixed, Kind: kindCheckin,
		Day: "2026-08-21", At: at("2026-08-21T17:05:00Z"), SupersedesID: &first.ID,
		Payload: map[string]interface{}{
			"v": float64(1), "source": "chips",
			"feelings": []interface{}{
				map[string]interface{}{
					"id": "irritation", "intensity": float64(1), "uncertain": false,
					"about": []interface{}{
						map[string]interface{}{"kind": "trigger", "trigger": seedTriggerWork},
					},
				},
			},
		},
	})
	supersede(first, fixed)

	write(models.JournalEntry{
		ClientID: seedCheckinPlain, Kind: kindCheckin,
		Day: "2026-08-22", At: at("2026-08-22T08:15:00Z"),
		Payload: map[string]interface{}{
			"v": float64(1), "source": "chips",
			"feelings": []interface{}{
				map[string]interface{}{"id": "calm", "intensity": float64(2), "uncertain": false},
			},
		},
	})
	write(models.JournalEntry{
		ClientID: seedRitualNight, Kind: kindRitual,
		Day: "2026-08-22", At: at("2026-08-22T22:30:00Z"),
		Payload: map[string]interface{}{
			"v": float64(1),
			"question_set": map[string]interface{}{
				"version": float64(1),
				"asked":   []interface{}{"slept_well", "moved_body", "daylight", "ate_regularly"},
			},
			// ate_regularly is absent from answers: asked and skipped, which is not false.
			"answers": map[string]interface{}{
				"slept_well": true, "moved_body": false, "daylight": true,
			},
			"day_word": map[string]interface{}{"id": "calm", "uncertain": false},
		},
	})
	write(models.JournalEntry{
		ClientID: seedFactAboutLucie, Kind: kindPersonFact,
		Day: "2026-08-22", At: at("2026-08-22T22:31:00Z"),
		Payload:  map[string]interface{}{"v": float64(1), "text": "moved to Lyon", "source": "typed"},
		Mentions: []models.JournalMention{{RelationshipID: &lucie.ID, Ref: 0, Label: "Lucie"}},
	})

	return &lucie
}

// journalOf fails rather than nil-panics when a version 2 export has no journal block at
// all, which is the failure every test below would otherwise report as a crash.
func journalOf(t *testing.T, document ExportDocument) *ExportJournal {
	t.Helper()
	if document.Journal == nil {
		t.Fatal("Expected a journal block in a version 2 export")
	}
	return document.Journal
}

func journalByClientID(t *testing.T, journal *ExportJournal) map[string]ExportJournalEntry {
	t.Helper()
	indexed := make(map[string]ExportJournalEntry, len(journal.Entries))
	for _, entry := range journal.Entries {
		indexed[entry.ClientID] = entry
	}
	return indexed
}

// stamp compares instants as text. time.Time carries a location and a monotonic reading
// that reflect.DeepEqual notices and nobody means, so the round trip is asserted on what the
// file actually says.
func stamp(at *time.Time) string {
	if at == nil {
		return "—"
	}
	return at.UTC().Format(time.RFC3339Nano)
}

func TestExportCarriesTheWholeJournal(t *testing.T) {
	db := setupSQLiteDB(t)
	db.Create(&models.User{Email: "vault@example.com", Password: "x"})
	seedJournal(t, db, 1)
	// Another user's journal must not appear in this one's file.
	db.Create(&models.User{Email: "other@example.com", Password: "x"})
	seedEntry(t, db, 2, kindCheckin, "2026-08-21", "2026-08-21T10:00:00Z")

	document := exportFor(t, 1)
	if document.Version != 2 {
		t.Fatalf("Expected the document to be version 2, got %d", document.Version)
	}
	journal := journalOf(t, document)

	// Eight rows, in day/at order, superseded ones included: an export is what is there,
	// not what is current.
	expected := []string{
		seedTriggerWork, seedTriggerDeadline, seedTriggerMerged,
		seedCheckinFirst, seedCheckinFixed,
		seedCheckinPlain, seedRitualNight, seedFactAboutLucie,
	}
	if len(journal.Entries) != len(expected) {
		t.Fatalf("Expected %d entries, got %d", len(expected), len(journal.Entries))
	}
	for i, clientID := range expected {
		if journal.Entries[i].ClientID != clientID {
			t.Errorf("Entry %d: expected %s, got %s", i, clientID, journal.Entries[i].ClientID)
		}
	}

	entries := journalByClientID(t, journal)

	// The mention names the person, not a row id — the same shape as everything else here.
	checkin := entries[seedCheckinFirst]
	if len(checkin.Mentions) != 1 {
		t.Fatalf("Expected one mention on the check-in, got %d", len(checkin.Mentions))
	}
	if checkin.Mentions[0].Relationship != "Lucie" || checkin.Mentions[0].Label != "Lucie" ||
		checkin.Mentions[0].Ref != 0 {
		t.Errorf("Expected the mention to name Lucie at ref 0, got %+v", checkin.Mentions[0])
	}
	if checkin.Day != "2026-08-21" || checkin.SchemaVersion != 1 {
		t.Errorf("Expected 2026-08-21 at schema version 1, got %s / %d", checkin.Day, checkin.SchemaVersion)
	}
	if checkin.Payload["transcript"] != "A long day, and Lucie made it better." {
		t.Errorf("Expected the transcript in the JSON, got %v", checkin.Payload["transcript"])
	}

	// The correction pair: one row stamped, the other pointing back by client id.
	if checkin.SupersededAt == nil {
		t.Error("Expected the replaced check-in to carry superseded_at")
	}
	if entries[seedCheckinFixed].Supersedes != seedCheckinFirst {
		t.Errorf("Expected the correction to name %s, got %q", seedCheckinFirst, entries[seedCheckinFixed].Supersedes)
	}
	if entries[seedTriggerMerged].Payload["merged_into"] != seedTriggerDeadline {
		t.Errorf("Expected the merge to name the surviving trigger, got %v",
			entries[seedTriggerMerged].Payload["merged_into"])
	}

	// No row id, anywhere in the journal half.
	raw := journalJSON(t, journal)
	for _, forbidden := range []string{`"ID"`, `"entry_id"`, `"relationship_id"`, `"supersedes_id"`, `"user_id"`} {
		if strings.Contains(raw, forbidden) {
			t.Errorf("Journal block carries %s, which is a row id:\n%s", forbidden, raw)
		}
	}
}

func journalJSON(t *testing.T, journal *ExportJournal) string {
	t.Helper()
	encoded, err := json.Marshal(journal)
	if err != nil {
		t.Fatalf("Failed to re-encode the journal: %v", err)
	}
	return string(encoded)
}

// TestExportImportJournalRoundTrip is the promise for the journal half: take it all out of
// one account, put it into an empty one, and every entry, mention, payload key and
// correction link is the same on the other side.
func TestExportImportJournalRoundTrip(t *testing.T) {
	db := setupSQLiteDB(t)
	db.Create(&models.User{Email: "source@example.com", Password: "x"})
	db.Create(&models.User{Email: "target@example.com", Password: "x"})
	seedJournal(t, db, 1)

	document := exportFor(t, 1)
	body, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("Failed to re-encode the export: %v", err)
	}

	w := call(t, http.MethodPost, "/import", 2, string(body), vaultRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	var result ImportResult
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.JournalEntriesCreated != 8 || result.JournalEntriesSkipped != 0 {
		t.Fatalf("Expected 8 journal entries created and none skipped, got %+v", result)
	}

	original := journalOf(t, document)
	copied := journalOf(t, exportFor(t, 2))
	if len(copied.Entries) != len(original.Entries) {
		t.Fatalf("Expected %d entries back, got %d", len(original.Entries), len(copied.Entries))
	}

	indexed := journalByClientID(t, copied)
	for position, want := range original.Entries {
		if copied.Entries[position].ClientID != want.ClientID {
			t.Errorf("Entry %d: order changed, expected %s got %s",
				position, want.ClientID, copied.Entries[position].ClientID)
		}

		got, ok := indexed[want.ClientID]
		if !ok {
			t.Errorf("%s: lost in the round trip", want.ClientID)
			continue
		}
		if got.Kind != want.Kind || got.Day != want.Day || got.SchemaVersion != want.SchemaVersion {
			t.Errorf("%s: expected %s/%s/v%d, got %s/%s/v%d", want.ClientID,
				want.Kind, want.Day, want.SchemaVersion, got.Kind, got.Day, got.SchemaVersion)
		}
		if stamp(&got.At) != stamp(&want.At) {
			t.Errorf("%s: at was %s, came back %s", want.ClientID, stamp(&want.At), stamp(&got.At))
		}
		if !reflect.DeepEqual(got.Payload, want.Payload) {
			t.Errorf("%s: payload changed\n got  %#v\n want %#v", want.ClientID, got.Payload, want.Payload)
		}
		if !reflect.DeepEqual(got.Mentions, want.Mentions) {
			t.Errorf("%s: mentions changed\n got  %#v\n want %#v", want.ClientID, got.Mentions, want.Mentions)
		}
		if got.Supersedes != want.Supersedes {
			t.Errorf("%s: supersedes was %q, came back %q", want.ClientID, want.Supersedes, got.Supersedes)
		}
		if stamp(got.SupersededAt) != stamp(want.SupersededAt) {
			t.Errorf("%s: superseded_at was %s, came back %s",
				want.ClientID, stamp(want.SupersededAt), stamp(got.SupersededAt))
		}
	}

	// The link is a real column on the other side, not just a string in a file: the reads
	// have to see the same current journal they saw before.
	var current int64
	db.Model(&models.JournalEntry{}).
		Where("user_id = ? AND superseded_at IS NULL", 2).Count(&current)
	if current != 6 {
		t.Errorf("Expected 6 current entries after the round trip, got %d", current)
	}
	var correction models.JournalEntry
	db.Where("user_id = ? AND client_id = ?", 2, seedCheckinFixed).First(&correction)
	var replaced models.JournalEntry
	db.Where("user_id = ? AND client_id = ?", 2, seedCheckinFirst).First(&replaced)
	if correction.SupersedesID == nil || *correction.SupersedesID != replaced.ID {
		t.Errorf("Expected supersedes_id to be remapped onto the imported row %d, got %v",
			replaced.ID, correction.SupersedesID)
	}
}

// TestReimportSkipsJournalEntriesByClientID: the journal has an identity the snapshot lacks,
// so its duplicate check is exact rather than a comparison of content.
func TestReimportSkipsJournalEntriesByClientID(t *testing.T) {
	db := setupSQLiteDB(t)
	db.Create(&models.User{Email: "source@example.com", Password: "x"})
	seedJournal(t, db, 1)

	document := exportFor(t, 1)
	body, _ := json.Marshal(document)

	var before int64
	db.Model(&models.JournalEntry{}).Where("user_id = ?", 1).Count(&before)

	w := call(t, http.MethodPost, "/import", 1, string(body), vaultRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	var result ImportResult
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.JournalEntriesCreated != 0 || result.JournalEntriesSkipped != 8 {
		t.Errorf("Expected all eight entries skipped, got %+v", result)
	}

	var after int64
	db.Model(&models.JournalEntry{}).Where("user_id = ?", 1).Count(&after)
	if after != before {
		t.Errorf("Expected the entry count to be unchanged at %d, got %d", before, after)
	}
	var mentions int64
	db.Model(&models.JournalMention{}).Count(&mentions)
	if mentions != 2 {
		t.Errorf("Expected the two mentions to be unchanged, got %d", mentions)
	}
}

// A version 1 file is what every export before Phase 6 produced. It has no journal block,
// and refusing it because the server now writes version 2 would throw away a file for no
// gain — so the version check reads a range, not one number.
func TestImportStillReadsAVersionOneFile(t *testing.T) {
	db := setupSQLiteDB(t)

	body := `{"format":"alq-export","version":1,"relationships":[
		{"name":"Alex","cadence_days":30,"snapshots":[
			{"date":"2026-01-10","kind":"full","stats":{"eros":40,"mania":70},
			 "description":"rough month","tags":["conflict"],"uncertain":["mania"]}
		]}]}`

	w := call(t, http.MethodPost, "/import", 1, body, vaultRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	var result ImportResult
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.RelationshipsCreated != 1 || result.SnapshotsCreated != 1 {
		t.Errorf("Expected the relationship and its snapshot, got %+v", result)
	}
	if result.JournalEntriesCreated != 0 || result.JournalEntriesSkipped != 0 {
		t.Errorf("Expected a version 1 file to touch no journal rows, got %+v", result)
	}

	var entries int64
	db.Model(&models.JournalEntry{}).Count(&entries)
	if entries != 0 {
		t.Errorf("Expected no journal rows from a version 1 file, got %d", entries)
	}
}

// The other half of the version rule: a file that calls itself version 1 and carries a
// journal is describing itself wrongly, and neither reading it nor dropping it silently is
// honest.
func TestImportRejectsAJournalInAVersionOneFile(t *testing.T) {
	setupSQLiteDB(t)

	body := `{"format":"alq-export","version":1,"relationships":[],
		"journal":{"entries":[]}}`

	w := call(t, http.MethodPost, "/import", 1, body, vaultRoutes)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 but got %d (body: %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "version 1 has no journal block") {
		t.Errorf("Expected the error to say which version, got %s", w.Body.String())
	}
}

// Invariant 2b, in the journal's half of the file: a name resolves through the same
// find-or-create everything else uses, so two entries naming one person land on one row.
func TestImportJournalMentionCreatesTheRelationshipOnce(t *testing.T) {
	db := setupSQLiteDB(t)

	body := `{"format":"alq-export","version":2,"relationships":[],"journal":{"entries":[
		{"client_id":"eeeeeeee-0000-4000-8000-000000000001","kind":"checkin",
		 "day":"2026-08-21","at":"2026-08-21T16:42:10Z","schema_version":1,
		 "payload":{"v":1,"source":"typed","feelings":[
			{"id":"rapport","intensity":3,"uncertain":false,
			 "about":[{"kind":"person","ref":0}]}]},
		 "mentions":[{"relationship":"Mara","ref":0,"label":"Mara"}]},
		{"client_id":"eeeeeeee-0000-4000-8000-000000000002","kind":"checkin",
		 "day":"2026-08-22","at":"2026-08-22T09:00:00Z","schema_version":1,
		 "payload":{"v":1,"source":"chips","feelings":[
			{"id":"calm","intensity":2,"uncertain":false,
			 "about":[{"kind":"person","ref":0}]}]},
		 "mentions":[{"relationship":"  Mara  ","ref":0,"label":""}]}
	]}}`

	w := call(t, http.MethodPost, "/import", 1, body, vaultRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	var result ImportResult
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.JournalEntriesCreated != 2 || result.RelationshipsCreated != 1 {
		t.Errorf("Expected two entries and one new person, got %+v", result)
	}

	var people int64
	db.Model(&models.Relationship{}).Where("user_id = ?", 1).Count(&people)
	if people != 1 {
		t.Errorf("Expected Mara to be created once, got %d relationships", people)
	}

	// An empty label takes the resolved name, exactly as the write path fills it.
	var mentions []models.JournalMention
	db.Order("id ASC").Find(&mentions)
	if len(mentions) != 2 {
		t.Fatalf("Expected two mentions, got %d", len(mentions))
	}
	for _, mention := range mentions {
		if mention.Label != "Mara" || mention.RelationshipID == nil {
			t.Errorf("Expected every mention to resolve to Mara, got %+v", mention)
		}
	}

	// Importing the same file again adds nothing: the client ids are already taken.
	w = call(t, http.MethodPost, "/import", 1, body, vaultRoutes)
	json.Unmarshal(w.Body.Bytes(), &result)
	if result.JournalEntriesCreated != 0 || result.JournalEntriesSkipped != 2 {
		t.Errorf("Expected the second run to skip both, got %+v", result)
	}
	db.Model(&models.Relationship{}).Where("user_id = ?", 1).Count(&people)
	if people != 1 {
		t.Errorf("Expected Mara to still be one row, got %d", people)
	}
}

// A trigger is referenced by client id inside an opaque payload, so nothing but this check
// stands between a stored feeling and a word nobody can look up.
func TestImportRejectsATriggerTheFileDoesNotContain(t *testing.T) {
	db := setupSQLiteDB(t)

	missing := "ffffffff-0000-4000-8000-000000000009"
	body := `{"format":"alq-export","version":2,"relationships":[
		{"name":"Alex","cadence_days":null,"snapshots":[]}],"journal":{"entries":[
		{"client_id":"eeeeeeee-0000-4000-8000-000000000001","kind":"checkin",
		 "day":"2026-08-21","at":"2026-08-21T16:42:10Z","schema_version":1,
		 "payload":{"v":1,"source":"typed","feelings":[
			{"id":"stress","intensity":2,"uncertain":false,
			 "about":[{"kind":"trigger","trigger":"` + missing + `"}]}]}}
	]}}`

	w := call(t, http.MethodPost, "/import", 1, body, vaultRoutes)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 but got %d (body: %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), missing) {
		t.Errorf("Expected the error to name the trigger, got %s", w.Body.String())
	}

	// Validation runs before the transaction opens, so the relationship the file also
	// carries is not written either — the file is rejected whole.
	for _, model := range []interface{}{&models.JournalEntry{}, &models.JournalMention{}, &models.Relationship{}} {
		var written int64
		db.Model(model).Count(&written)
		if written != 0 {
			t.Errorf("Expected nothing written on a rejected import, found %d of %T", written, model)
		}
	}
}
