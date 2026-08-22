package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"alexithymia-backend/internal/database"
	"alexithymia-backend/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// These tests run against a real in-memory SQLite database rather than sqlmock. Rename and
// merge are multi-statement transactions whose whole point is what the rows look like
// afterwards; asserting on the SQL that produced them would only restate the handler.

// setupSQLiteDB gives each test its own empty database and points the global at it.
func setupSQLiteDB(t *testing.T) *gorm.DB {
	t.Helper()

	// A distinct DSN per test keeps the shared cache from leaking rows between them.
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

	// The server's own list, so a table added to the schema cannot be missing from the
	// tests that exercise it — which is exactly how models.RefreshToken would have been
	// left out here.
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatalf("Failed to migrate schema: %v", err)
	}

	database.DB = db
	return db
}

// seedStack creates a relationship with one snapshot per supplied date, mirroring what the
// create endpoint would have produced.
func seedStack(t *testing.T, db *gorm.DB, userID uint, name string, dates ...string) *models.Relationship {
	t.Helper()

	relationship := models.Relationship{UserID: userID, Name: name}
	if err := db.Create(&relationship).Error; err != nil {
		t.Fatalf("Failed to seed relationship %q: %v", name, err)
	}

	for _, date := range dates {
		parsed, err := time.Parse(dateLayout, date)
		if err != nil {
			t.Fatalf("Bad seed date %q: %v", date, err)
		}
		subject := models.AnalysisSubject{
			UserID:         userID,
			RelationshipID: &relationship.ID,
			Name:           name,
			Date:           &parsed,
			Stats:          map[string]int{"eros": 50},
		}
		if err := db.Create(&subject).Error; err != nil {
			t.Fatalf("Failed to seed snapshot for %q: %v", name, err)
		}
	}

	return &relationship
}

// call routes one request through a handler with the given user authenticated.
func call(t *testing.T, method, path string, userID uint, body string, register func(*gin.Engine)) *httptest.ResponseRecorder {
	t.Helper()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if userID != 0 {
			c.Set("userID", userID)
		}
		c.Next()
	})
	register(r)

	var req *http.Request
	if body == "" {
		req, _ = http.NewRequest(method, path, nil)
	} else {
		req, _ = http.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
	}

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func relationshipRoutes(r *gin.Engine) {
	r.GET("/relationships", GetRelationships)
	r.PATCH("/relationships/:id", UpdateRelationship)
	r.POST("/relationships/:id/merge", MergeRelationship)
	r.DELETE("/relationships/:id", DeleteRelationship)
}

func TestGetRelationships(t *testing.T) {
	db := setupSQLiteDB(t)
	seedStack(t, db, 1, "Alex", "2026-01-10", "2026-03-01")
	seedStack(t, db, 1, "Sam", "2026-05-20")
	seedStack(t, db, 1, "Undated")
	seedStack(t, db, 2, "Someone Else's", "2026-06-01")

	w := call(t, http.MethodGet, "/relationships", 1, "", relationshipRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var summaries []RelationshipSummary
	if err := json.Unmarshal(w.Body.Bytes(), &summaries); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if len(summaries) != 3 {
		t.Fatalf("Expected the user's 3 relationships, got %d: %+v", len(summaries), summaries)
	}

	// Most recent first, and a relationship with nothing dated sorts last rather than top.
	if summaries[0].Name != "Sam" || summaries[1].Name != "Alex" || summaries[2].Name != "Undated" {
		t.Errorf("Expected [Sam Alex Undated], got %s, %s, %s", summaries[0].Name, summaries[1].Name, summaries[2].Name)
	}
	if summaries[1].SnapshotCount != 2 {
		t.Errorf("Expected Alex to report 2 snapshots, got %d", summaries[1].SnapshotCount)
	}
	if summaries[1].LatestDate.Time == nil || summaries[1].LatestDate.Time.Format(dateLayout) != "2026-03-01" {
		t.Errorf("Expected Alex's latest date to be 2026-03-01, got %v", summaries[1].LatestDate.Time)
	}
	// An emptied stack still appears, honestly reporting zero — otherwise it could never
	// be deleted.
	if summaries[2].SnapshotCount != 0 || summaries[2].LatestDate.Time != nil {
		t.Errorf("Expected the undated stack to report 0 snapshots and no date, got %+v", summaries[2])
	}
}

func TestRenameRelationship(t *testing.T) {
	db := setupSQLiteDB(t)
	alex := seedStack(t, db, 1, "Alex", "2026-01-10", "2026-03-01")

	w := call(t, http.MethodPatch, "/relationships/"+itoa(alex.ID), 1, `{"name":"  Alexandra  "}`, relationshipRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var summary RelationshipSummary
	if err := json.Unmarshal(w.Body.Bytes(), &summary); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if summary.Name != "Alexandra" {
		t.Errorf("Expected the trimmed name back, got %q", summary.Name)
	}
	if summary.SnapshotCount != 2 {
		t.Errorf("Expected the response to carry the snapshot count, got %d", summary.SnapshotCount)
	}

	// Every version follows the rename — this is the thing that was impossible before.
	var stale int64
	db.Model(&models.AnalysisSubject{}).Where("name <> ?", "Alexandra").Count(&stale)
	if stale != 0 {
		t.Errorf("Expected every snapshot to carry the new name, %d still do not", stale)
	}
}

func TestRenameRelationshipCollisionIs409(t *testing.T) {
	db := setupSQLiteDB(t)
	alex := seedStack(t, db, 1, "Alex", "2026-01-10")
	seedStack(t, db, 1, "Sam", "2026-02-10")

	w := call(t, http.MethodPatch, "/relationships/"+itoa(alex.ID), 1, `{"name":"Sam"}`, relationshipRoutes)
	if w.Code != http.StatusConflict {
		t.Fatalf("Expected 409 but got %d (body: %s)", w.Code, w.Body.String())
	}

	// The rejected rename must not have partially applied.
	var reloaded models.Relationship
	db.First(&reloaded, alex.ID)
	if reloaded.Name != "Alex" {
		t.Errorf("Expected the failed rename to roll back, got %q", reloaded.Name)
	}
}

func TestRenameRelationshipToItsOwnNameSucceeds(t *testing.T) {
	db := setupSQLiteDB(t)
	alex := seedStack(t, db, 1, "Alex", "2026-01-10")

	// A name only collides with *another* relationship, never with itself.
	w := call(t, http.MethodPatch, "/relationships/"+itoa(alex.ID), 1, `{"name":"Alex"}`, relationshipRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestRenameRelationshipRejectsEmptyName(t *testing.T) {
	db := setupSQLiteDB(t)
	alex := seedStack(t, db, 1, "Alex", "2026-01-10")

	w := call(t, http.MethodPatch, "/relationships/"+itoa(alex.ID), 1, `{"name":"   "}`, relationshipRoutes)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 but got %d (body: %s)", w.Code, w.Body.String())
	}
}

// TestSetCadence covers the three-way distinction the raw-map decoding exists for: absent,
// null, and a number.
func TestSetCadence(t *testing.T) {
	db := setupSQLiteDB(t)
	alex := seedStack(t, db, 1, "Alex", "2026-01-10")

	patch := func(body string) *httptest.ResponseRecorder {
		return call(t, http.MethodPatch, "/relationships/"+itoa(alex.ID), 1, body, relationshipRoutes)
	}
	reload := func() models.Relationship {
		var reloaded models.Relationship
		db.First(&reloaded, alex.ID)
		return reloaded
	}

	// Default is off — no rhythm until the user asks for one.
	if reload().CadenceDays != nil {
		t.Fatalf("Expected no cadence by default, got %v", reload().CadenceDays)
	}

	w := patch(`{"cadence_days":30}`)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	if got := reload().CadenceDays; got == nil || *got != 30 {
		t.Errorf("Expected a 30-day cadence, got %v", got)
	}
	var summary RelationshipSummary
	json.Unmarshal(w.Body.Bytes(), &summary)
	if summary.CadenceDays == nil || *summary.CadenceDays != 30 {
		t.Errorf("Expected the response to carry the cadence, got %+v", summary)
	}

	// A body about something else leaves the rhythm alone.
	if w := patch(`{"name":"Alexandra"}`); w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	if got := reload().CadenceDays; got == nil || *got != 30 {
		t.Errorf("Expected an absent cadence_days to leave it unchanged, got %v", got)
	}

	// Explicit null turns reminders off.
	if w := patch(`{"cadence_days":null}`); w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	if got := reload().CadenceDays; got != nil {
		t.Errorf("Expected null to turn reminders off, got %v", got)
	}
}

func TestCadenceBounds(t *testing.T) {
	db := setupSQLiteDB(t)
	alex := seedStack(t, db, 1, "Alex", "2026-01-10")

	for _, body := range []string{
		`{"cadence_days":6}`,
		`{"cadence_days":366}`,
		`{"cadence_days":0}`,
		`{"cadence_days":-30}`,
		`{"cadence_days":"monthly"}`,
	} {
		w := call(t, http.MethodPatch, "/relationships/"+itoa(alex.ID), 1, body, relationshipRoutes)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: expected 400 but got %d (body: %s)", body, w.Code, w.Body.String())
		}
	}

	// Both ends of the allowed range are accepted.
	for _, body := range []string{`{"cadence_days":7}`, `{"cadence_days":365}`} {
		w := call(t, http.MethodPatch, "/relationships/"+itoa(alex.ID), 1, body, relationshipRoutes)
		if w.Code != http.StatusOK {
			t.Errorf("%s: expected 200 but got %d (body: %s)", body, w.Code, w.Body.String())
		}
	}
}

func TestMergeRelationships(t *testing.T) {
	db := setupSQLiteDB(t)
	target := seedStack(t, db, 1, "Alex", "2026-03-01")
	source := seedStack(t, db, 1, "Alex M", "2026-01-10", "2026-02-05")

	body := `{"source_id":` + itoa(source.ID) + `}`
	w := call(t, http.MethodPost, "/relationships/"+itoa(target.ID)+"/merge", 1, body, relationshipRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var summary RelationshipSummary
	if err := json.Unmarshal(w.Body.Bytes(), &summary); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if summary.SnapshotCount != 3 {
		t.Errorf("Expected the merged stack to hold all 3 snapshots, got %d", summary.SnapshotCount)
	}

	// Every moved snapshot takes the target's name with it.
	var moved []models.AnalysisSubject
	db.Where("relationship_id = ?", target.ID).Find(&moved)
	if len(moved) != 3 {
		t.Fatalf("Expected 3 snapshots on the target, got %d", len(moved))
	}
	for _, subject := range moved {
		if subject.Name != "Alex" {
			t.Errorf("Expected moved snapshot %d to be renamed to Alex, got %q", subject.ID, subject.Name)
		}
	}

	// The source is retired, and nothing still points at it.
	var stillThere models.Relationship
	if err := db.First(&stillThere, source.ID).Error; err != gorm.ErrRecordNotFound {
		t.Errorf("Expected the source relationship to be soft-deleted, got %v", err)
	}
	var orphans int64
	db.Unscoped().Model(&models.AnalysisSubject{}).Where("relationship_id = ?", source.ID).Count(&orphans)
	if orphans != 0 {
		t.Errorf("Expected no snapshots left on the source, found %d", orphans)
	}
}

func TestMergeRelationshipIntoItselfIs400(t *testing.T) {
	db := setupSQLiteDB(t)
	alex := seedStack(t, db, 1, "Alex", "2026-01-10")

	body := `{"source_id":` + itoa(alex.ID) + `}`
	w := call(t, http.MethodPost, "/relationships/"+itoa(alex.ID)+"/merge", 1, body, relationshipRoutes)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 but got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestDeleteRelationshipRemovesItsSnapshots(t *testing.T) {
	db := setupSQLiteDB(t)
	alex := seedStack(t, db, 1, "Alex", "2026-01-10", "2026-02-05")
	sam := seedStack(t, db, 1, "Sam", "2026-03-01")

	w := call(t, http.MethodDelete, "/relationships/"+itoa(alex.ID), 1, "", relationshipRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var remaining []models.AnalysisSubject
	db.Find(&remaining)
	if len(remaining) != 1 || remaining[0].Name != "Sam" {
		t.Errorf("Expected only Sam's snapshot to survive, got %+v", remaining)
	}

	// Soft deletes, so a database backup is still the real undo.
	var softDeleted int64
	db.Unscoped().Model(&models.AnalysisSubject{}).Where("relationship_id = ?", alex.ID).Count(&softDeleted)
	if softDeleted != 2 {
		t.Errorf("Expected Alex's 2 snapshots to still exist as soft-deleted rows, got %d", softDeleted)
	}

	// The untouched stack is genuinely untouched.
	var samStill models.Relationship
	if err := db.First(&samStill, sam.ID).Error; err != nil {
		t.Errorf("Expected Sam's relationship to survive, got %v", err)
	}
}

// TestRelationshipRoutesRejectOtherUsers walks every mutating route with a relationship
// that belongs to somebody else. All of them answer 404 — whether it exists is not this
// user's business — and none of them change anything.
func TestRelationshipRoutesRejectOtherUsers(t *testing.T) {
	db := setupSQLiteDB(t)
	theirs := seedStack(t, db, 2, "Theirs", "2026-01-10")
	mine := seedStack(t, db, 1, "Mine", "2026-02-10")

	cases := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"rename", http.MethodPatch, "/relationships/" + itoa(theirs.ID), `{"name":"Hijacked"}`},
		{"merge into theirs", http.MethodPost, "/relationships/" + itoa(theirs.ID) + "/merge", `{"source_id":` + itoa(mine.ID) + `}`},
		{"merge theirs into mine", http.MethodPost, "/relationships/" + itoa(mine.ID) + "/merge", `{"source_id":` + itoa(theirs.ID) + `}`},
		{"delete", http.MethodDelete, "/relationships/" + itoa(theirs.ID), ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := call(t, tc.method, tc.path, 1, tc.body, relationshipRoutes)
			if w.Code != http.StatusNotFound {
				t.Fatalf("Expected 404 but got %d (body: %s)", w.Code, w.Body.String())
			}
		})
	}

	var untouched models.Relationship
	if err := db.First(&untouched, theirs.ID).Error; err != nil {
		t.Fatalf("Expected the other user's relationship to survive: %v", err)
	}
	if untouched.Name != "Theirs" {
		t.Errorf("Expected the other user's name to be untouched, got %q", untouched.Name)
	}
	var theirSubjects int64
	db.Model(&models.AnalysisSubject{}).Where("relationship_id = ?", theirs.ID).Count(&theirSubjects)
	if theirSubjects != 1 {
		t.Errorf("Expected the other user's snapshot to survive, found %d", theirSubjects)
	}
}

func TestRelationshipRoutesRequireAuth(t *testing.T) {
	setupSQLiteDB(t)

	cases := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/relationships", ""},
		{http.MethodPatch, "/relationships/1", `{"name":"Alex"}`},
		{http.MethodPost, "/relationships/1/merge", `{"source_id":2}`},
		{http.MethodDelete, "/relationships/1", ""},
	}

	for _, tc := range cases {
		w := call(t, tc.method, tc.path, 0, tc.body, relationshipRoutes)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: expected 401 but got %d", tc.method, tc.path, w.Code)
		}
	}
}

// TestCreateSubjectReusesRelationshipByName is the compatibility contract from the client's
// side: a caller that knows nothing about relationships still lands its snapshot in the
// right stack, whitespace and all.
func TestCreateSubjectReusesRelationshipByName(t *testing.T) {
	db := setupSQLiteDB(t)

	post := func(body string) models.AnalysisSubject {
		t.Helper()
		w := call(t, http.MethodPost, "/subjects", 1, body, func(r *gin.Engine) {
			r.POST("/subjects", CreateSubject)
		})
		if w.Code != http.StatusCreated {
			t.Fatalf("Expected 201 but got %d (body: %s)", w.Code, w.Body.String())
		}
		var created models.AnalysisSubject
		if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
			t.Fatalf("Failed to parse response: %v", err)
		}
		return created
	}

	first := post(`{"name":"Alex","stats":{"eros":50}}`)
	second := post(`{"name":"  Alex  ","stats":{"eros":60}}`)
	third := post(`{"name":"Sam","stats":{"eros":10}}`)

	if first.RelationshipID == nil || second.RelationshipID == nil {
		t.Fatalf("Expected both snapshots to carry a relationship_id")
	}
	if *first.RelationshipID != *second.RelationshipID {
		t.Errorf("Expected a differently-whitespaced name to reuse the relationship, got %d and %d",
			*first.RelationshipID, *second.RelationshipID)
	}
	if *third.RelationshipID == *first.RelationshipID {
		t.Errorf("Expected a novel name to get its own relationship")
	}

	var count int64
	db.Model(&models.Relationship{}).Count(&count)
	if count != 2 {
		t.Errorf("Expected exactly 2 relationships, got %d", count)
	}
}

// TestGetSubjectsOrdersByDate proves the ORDER BY against a real engine rather than
// against the SQL string: newest first, undated last.
func TestGetSubjectsOrdersByDate(t *testing.T) {
	db := setupSQLiteDB(t)
	relationship := seedStack(t, db, 1, "Alex", "2026-01-10", "2026-05-01", "2026-03-01")
	undated := models.AnalysisSubject{UserID: 1, RelationshipID: &relationship.ID, Name: "Alex"}
	if err := db.Create(&undated).Error; err != nil {
		t.Fatalf("Failed to seed the undated snapshot: %v", err)
	}

	w := call(t, http.MethodGet, "/subjects", 1, "", func(r *gin.Engine) {
		r.GET("/subjects", GetSubjects)
	})
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var subjects []models.AnalysisSubject
	if err := json.Unmarshal(w.Body.Bytes(), &subjects); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if len(subjects) != 4 {
		t.Fatalf("Expected 4 snapshots, got %d", len(subjects))
	}

	want := []string{"2026-05-01", "2026-03-01", "2026-01-10"}
	for i, date := range want {
		if subjects[i].Date == nil || subjects[i].Date.Format(dateLayout) != date {
			t.Errorf("Position %d: expected %s, got %v", i, date, subjects[i].Date)
		}
	}
	if subjects[3].Date != nil {
		t.Errorf("Expected the undated snapshot last, got %v", subjects[3].Date)
	}
}

// TestAggregateTimeScan pins the formats MAX(date) actually comes back as. Both are real:
// the "+00:00" spelling is what glebarez/sqlite writes today, and the RFC 3339 "Z" spelling
// is what sits in databases written by the driver's earlier versions. A wrong layout here
// fails only once a relationship has a dated snapshot, so it is worth asserting directly.
func TestAggregateTimeScan(t *testing.T) {
	cases := []struct {
		name  string
		value interface{}
		want  string
	}{
		{"sqlite today", "2026-03-01 00:00:00+00:00", "2026-03-01"},
		{"sqlite legacy rfc3339", "2026-02-23T00:00:00Z", "2026-02-23"},
		{"postgres time.Time", time.Date(2026, 4, 4, 12, 0, 0, 0, time.UTC), "2026-04-04"},
		{"byte slice", []byte("2026-05-05 00:00:00+00:00"), "2026-05-05"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var scanned aggregateTime
			if err := scanned.Scan(tc.value); err != nil {
				t.Fatalf("Scan failed: %v", err)
			}
			if scanned.Time == nil || scanned.Time.Format(dateLayout) != tc.want {
				t.Errorf("Expected %s, got %v", tc.want, scanned.Time)
			}
		})
	}

	// A relationship with no dated snapshot scans NULL, and serializes as JSON null
	// rather than a zero timestamp.
	var empty aggregateTime
	if err := empty.Scan(nil); err != nil {
		t.Fatalf("Scan(nil) failed: %v", err)
	}
	if empty.Time != nil {
		t.Errorf("Expected nil for a NULL aggregate, got %v", empty.Time)
	}
	encoded, err := json.Marshal(RelationshipSummary{ID: 1, Name: "Alex"})
	if err != nil {
		t.Fatalf("Failed to encode: %v", err)
	}
	if !bytes.Contains(encoded, []byte(`"latest_date":null`)) {
		t.Errorf("Expected latest_date to encode as null, got %s", encoded)
	}
}

// itoa keeps the URL building above readable.
func itoa(id uint) string {
	return strconv.FormatUint(uint64(id), 10)
}

// A mention left pointing at a retired relationship is the stranded row the merge handler
// exists to prevent — the same reason it already moves soft-deleted snapshots.
func TestMergeMovesJournalMentions(t *testing.T) {
	db := setupSQLiteDB(t)
	target := seedStack(t, db, 1, "Lucie M", "2026-03-01")
	source := seedStack(t, db, 1, "Lucie", "2026-01-10")

	live := seedEntry(t, db, 1, kindCheckin, "2026-08-20", "2026-08-20T09:00:00Z", source.ID)
	onDeleted := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T09:00:00Z", source.ID)
	untouched := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T10:00:00Z", target.ID)

	// A mention on a soft-deleted entry has to move too: the entry is recoverable, so a
	// mention left behind would come back pointing at a relationship that no longer exists.
	db.Delete(&models.JournalEntry{}, onDeleted.ID)

	w := call(t, http.MethodPost, fmt.Sprintf("/relationships/%d/merge", target.ID), 1,
		fmt.Sprintf(`{"source_id":%d}`, source.ID), relationshipRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var merged MergeRelationshipResponse
	if err := json.Unmarshal(w.Body.Bytes(), &merged); err != nil {
		t.Fatalf("Failed to parse the merge response: %v", err)
	}
	if merged.MentionsMoved != 2 {
		t.Errorf("Expected mentions_moved 2 (one live, one on a soft-deleted entry), got %d", merged.MentionsMoved)
	}
	// The summary is still there, embedded, so an existing client reads the same shape.
	if merged.Name != "Lucie M" || merged.ID != target.ID {
		t.Errorf("Expected the target's summary in the response, got %+v", merged.RelationshipSummary)
	}

	var pointingAtSource int64
	db.Model(&models.JournalMention{}).Where("relationship_id = ?", source.ID).Count(&pointingAtSource)
	if pointingAtSource != 0 {
		t.Errorf("Expected nothing left pointing at the retired relationship, found %d", pointingAtSource)
	}
	var pointingAtTarget int64
	db.Model(&models.JournalMention{}).Where("relationship_id = ?", target.ID).Count(&pointingAtTarget)
	if pointingAtTarget != 3 {
		t.Errorf("Expected all three mentions on the target, found %d", pointingAtTarget)
	}

	// The label is a quotation of what was said that day and is not rewritten by a merge.
	var moved models.JournalMention
	db.Where("entry_id = ?", live.ID).First(&moved)
	if moved.Label != "seeded" {
		t.Errorf("Expected the mention's label to survive the merge, got %q", moved.Label)
	}
	if untouched.ID == 0 {
		t.Error("Expected the seeded target entry to exist")
	}
}

func TestMergeReportsZeroMentionsWhenThereAreNone(t *testing.T) {
	db := setupSQLiteDB(t)
	target := seedStack(t, db, 1, "Lucie M", "2026-03-01")
	source := seedStack(t, db, 1, "Lucie", "2026-01-10")

	w := call(t, http.MethodPost, fmt.Sprintf("/relationships/%d/merge", target.ID), 1,
		fmt.Sprintf(`{"source_id":%d}`, source.ID), relationshipRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var merged MergeRelationshipResponse
	if err := json.Unmarshal(w.Body.Bytes(), &merged); err != nil {
		t.Fatalf("Failed to parse the merge response: %v", err)
	}
	if merged.MentionsMoved != 0 {
		t.Errorf("Expected mentions_moved 0, got %d", merged.MentionsMoved)
	}
	if !strings.Contains(w.Body.String(), `"mentions_moved":0`) {
		t.Errorf("Expected the field present and zero rather than omitted, got %s", w.Body.String())
	}
}

// Deleting a person does not rewrite the user's own record of a day.
func TestDeleteRelationshipDetachesMentions(t *testing.T) {
	db := setupSQLiteDB(t)
	lucie := seedStack(t, db, 1, "Lucie", "2026-01-10", "2026-03-01")
	other := seedStack(t, db, 1, "Noor", "2026-02-01")

	first := seedEntry(t, db, 1, kindCheckin, "2026-08-20", "2026-08-20T09:00:00Z", lucie.ID)
	second := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T09:00:00Z", lucie.ID, other.ID)

	w := call(t, http.MethodDelete, fmt.Sprintf("/relationships/%d", lucie.ID), 1, "", relationshipRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var body struct {
		Message          string `json:"message"`
		SnapshotsDeleted int64  `json:"snapshots_deleted"`
		MentionsDetached int64  `json:"mentions_detached"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("Failed to parse the delete response: %v", err)
	}
	if body.SnapshotsDeleted != 2 {
		t.Errorf("Expected 2 snapshots deleted, got %d", body.SnapshotsDeleted)
	}
	if body.MentionsDetached != 2 {
		t.Errorf("Expected the dialog's count of 2 mentions, got %d", body.MentionsDetached)
	}

	// The entries survive, and so do their labels — a check-in about a deleted person still
	// reads as it did the day it was made.
	var entries []models.JournalEntry
	if err := db.Preload("Mentions").Where("user_id = ?", 1).Order("id ASC").Find(&entries).Error; err != nil {
		t.Fatalf("Failed to read the entries back: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("Expected both entries to survive, found %d", len(entries))
	}
	if entries[0].ID != first.ID || entries[1].ID != second.ID {
		t.Errorf("Expected the same two entries, got %d and %d", entries[0].ID, entries[1].ID)
	}
	for _, entry := range entries {
		for _, mention := range entry.Mentions {
			if mention.Label != "seeded" {
				t.Errorf("Expected the label to survive the delete, got %q", mention.Label)
			}
		}
	}

	// relationship_id is left exactly as it was: the relationship is soft-deleted, so every
	// join through it drops out on its own and nothing had to be rewritten.
	var stillPointing int64
	db.Model(&models.JournalMention{}).Where("relationship_id = ?", lucie.ID).Count(&stillPointing)
	if stillPointing != 2 {
		t.Errorf("Expected the mentions to keep their relationship_id, found %d", stillPointing)
	}

	// And the read path stops offering them under that person, because the entries are
	// still there but the person is not.
	var remaining []models.Relationship
	db.Where("user_id = ?", 1).Find(&remaining)
	if len(remaining) != 1 || remaining[0].ID != other.ID {
		t.Errorf("Expected only Noor to remain, got %+v", remaining)
	}
}

// The two numbers the delete dialog depends on are the same number: `mention_count`, read
// when the dialog opens, and `mentions_detached`, returned when it is confirmed. Both count
// the entries the journal *shows*, so the sentence the user reads is true of what they see.
// Before this was pinned, the summary had no count at all and the response counted rows on
// entries the user had already deleted.
func TestMentionCountsCoverOnlyTheEntriesTheJournalShows(t *testing.T) {
	db := setupSQLiteDB(t)
	lucie := seedStack(t, db, 1, "Lucie", "2026-01-10", "2026-03-01")

	visible := seedEntry(t, db, 1, kindCheckin, "2026-08-20", "2026-08-20T09:00:00Z", lucie.ID)
	deleted := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T09:00:00Z", lucie.ID)
	superseded := seedEntry(t, db, 1, kindCheckin, "2026-08-22", "2026-08-22T09:00:00Z", lucie.ID)

	db.Delete(&models.JournalEntry{}, deleted.ID)
	if err := db.Model(&models.JournalEntry{}).Where("id = ?", superseded.ID).
		Update("superseded_at", time.Now().UTC()).Error; err != nil {
		t.Fatalf("Failed to supersede the seeded entry: %v", err)
	}

	// The snapshot count is the reason both aggregates are DISTINCT: two snapshots joined
	// against three mentions is six rows, and a plain COUNT would report six of each.
	w := call(t, http.MethodGet, "/relationships", 1, "", relationshipRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	var summaries []RelationshipSummary
	if err := json.Unmarshal(w.Body.Bytes(), &summaries); err != nil {
		t.Fatalf("Failed to parse the relationship list: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("Expected one relationship, got %d", len(summaries))
	}
	if summaries[0].SnapshotCount != 2 {
		t.Errorf("Expected 2 snapshots and not a product of the journal joins, got %d",
			summaries[0].SnapshotCount)
	}
	if summaries[0].MentionCount != 1 {
		t.Errorf("Expected mention_count 1 — the deleted and superseded entries do not count — got %d",
			summaries[0].MentionCount)
	}

	w = call(t, http.MethodDelete, fmt.Sprintf("/relationships/%d", lucie.ID), 1, "", relationshipRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	var body struct {
		MentionsDetached int64 `json:"mentions_detached"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("Failed to parse the delete response: %v", err)
	}
	if body.MentionsDetached != 1 {
		t.Errorf("Expected mentions_detached to agree with mention_count at 1, got %d",
			body.MentionsDetached)
	}
	if visible.ID == 0 {
		t.Error("Expected the visible entry to have been seeded")
	}
}
