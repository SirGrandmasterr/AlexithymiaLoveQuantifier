package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"alexithymia-backend/internal/database"
	"alexithymia-backend/internal/models"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Most of these run against a real in-memory SQLite database rather than sqlmock, for the
// reason relationships_test.go gives: the endpoint's whole point is what the rows look like
// afterwards — one relationship, one entry, one mention, and nothing at all when a step
// fails. Two tests near the bottom use sqlmock, where the statement shape is the subject.

// The ids these tests use. Real UUIDs, because the endpoint requires the shape.
const (
	entryOne     = "6f1c3a0e-1111-4111-8111-111111111111"
	entryTwo     = "6f1c3a0e-2222-4222-8222-222222222222"
	entryThree   = "6f1c3a0e-3333-4333-8333-333333333333"
	triggerWork  = "0b7e0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	triggerMove  = "0b7e0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	triggerOther = "0b7e0000-cccc-4ccc-8ccc-cccccccccccc"

	// The design document's own example instant, and the civil day it belongs to. A fixed
	// pair in the past stays valid forever: the only rules are that `at` is not far in the
	// future and that `day` is near it.
	atExample  = "2026-08-21T18:42:10+02:00"
	dayExample = "2026-08-21"
)

func journalRoutes(r *gin.Engine) {
	r.POST("/journal/entries", CreateJournalEntry)
	r.GET("/journal/entries", GetJournalEntries)
	r.DELETE("/journal/entries/:id", DeleteJournalEntry)
	r.GET("/journal/days", GetJournalDays)
	r.DELETE("/journal/people/:id", DeleteJournalPerson)
}

// postJournal sends one entry and returns the recorder, leaving the status assertion to
// the caller — half these tests are about a status that is not 201.
func postJournal(t *testing.T, userID uint, body string) *httptest.ResponseRecorder {
	t.Helper()
	return call(t, http.MethodPost, "/journal/entries", userID, body, journalRoutes)
}

// createJournal posts an entry, insists on 201, and hands back the row the server echoed.
func createJournal(t *testing.T, userID uint, body string) models.JournalEntry {
	t.Helper()
	w := postJournal(t, userID, body)
	if w.Code != http.StatusCreated {
		t.Fatalf("Expected 201 but got %d (body: %s)", w.Code, w.Body.String())
	}
	var created models.JournalEntry
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	return created
}

// countEntries is the "and nothing was written" assertion every failure case makes.
func countEntries(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var n int64
	if err := db.Model(&models.JournalEntry{}).Count(&n).Error; err != nil {
		t.Fatalf("Failed to count entries: %v", err)
	}
	return n
}

func countMentions(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var n int64
	if err := db.Model(&models.JournalMention{}).Count(&n).Error; err != nil {
		t.Fatalf("Failed to count mentions: %v", err)
	}
	return n
}

// seedTrigger writes a trigger entry the way the endpoint would have.
func seedTrigger(t *testing.T, db *gorm.DB, userID uint, clientID, label string) models.JournalEntry {
	t.Helper()
	at, err := time.Parse(time.RFC3339, atExample)
	if err != nil {
		t.Fatalf("Bad seed instant: %v", err)
	}
	trigger := models.JournalEntry{
		UserID:        userID,
		ClientID:      clientID,
		Kind:          kindTrigger,
		Day:           dayExample,
		At:            at.UTC(),
		SchemaVersion: 1,
		Payload: map[string]interface{}{
			"v": float64(1), "label": label, "merged_into": nil,
		},
	}
	if err := db.Create(&trigger).Error; err != nil {
		t.Fatalf("Failed to seed trigger %q: %v", label, err)
	}
	return trigger
}

// checkinBody builds a check-in around whatever mentions, feelings and triggers a test
// needs, so each test states only the part it is about.
func checkinBody(clientID, feelings, mentions, triggers string) string {
	return fmt.Sprintf(`{
		"client_id": %q, "kind": "checkin",
		"at": %q, "day": %q, "schema_version": 1,
		"payload": { "v": 1, "source": "typed", "tz_offset_min": 120, "feelings": [%s] },
		"mentions": [%s],
		"triggers": [%s]
	}`, clientID, atExample, dayExample, feelings, mentions, triggers)
}

func TestCreateJournalEntryWithMentionByRelationshipID(t *testing.T) {
	db := setupSQLiteDB(t)
	lucie := seedStack(t, db, 1, "Lucie", "2026-01-10")

	created := createJournal(t, 1, checkinBody(entryOne,
		`{"id":"rapport","intensity":3,"uncertain":false,"about":[{"kind":"person","ref":0}]}`,
		fmt.Sprintf(`{"ref":0,"relationship_id":%d,"label":"Lucie"}`, lucie.ID),
		``))

	if created.ID == 0 {
		t.Error("Expected the echoed row to carry its ID")
	}
	if created.CreatedAt.IsZero() {
		t.Error("Expected the echoed row to carry its CreatedAt")
	}
	if created.At.UTC().Format(time.RFC3339) != "2026-08-21T16:42:10Z" {
		t.Errorf("Expected at to be stored UTC, got %s", created.At.UTC().Format(time.RFC3339))
	}
	if len(created.Mentions) != 1 {
		t.Fatalf("Expected one mention, got %d", len(created.Mentions))
	}
	if created.Mentions[0].RelationshipID == nil || *created.Mentions[0].RelationshipID != lucie.ID {
		t.Errorf("Expected the mention to resolve to %d, got %v", lucie.ID, created.Mentions[0].RelationshipID)
	}
	if created.Mentions[0].EntryID != created.ID {
		t.Errorf("Expected the mention to belong to entry %d, got %d", created.ID, created.Mentions[0].EntryID)
	}
	if n := countEntries(t, db); n != 1 {
		t.Errorf("Expected exactly one entry, found %d", n)
	}
}

// The compatibility contract from §7.2: a client that knows nothing about relationship ids
// still lands its mention on the right person, and says the name twice without creating
// two of them.
func TestCreateJournalEntryResolvesMentionByName(t *testing.T) {
	db := setupSQLiteDB(t)

	first := createJournal(t, 1, checkinBody(entryOne,
		`{"id":"rapport","intensity":3,"about":[{"kind":"person","ref":0}]}`,
		`{"ref":0,"name":"Lucie"}`, ``))
	second := createJournal(t, 1, checkinBody(entryTwo,
		`{"id":"pleasure","intensity":2}`,
		`{"ref":0,"name":"  Lucie  "}`, ``))

	if first.Mentions[0].RelationshipID == nil {
		t.Fatal("Expected the first mention to resolve to a relationship")
	}
	if second.Mentions[0].RelationshipID == nil {
		t.Fatal("Expected the second mention to resolve to a relationship")
	}
	if *first.Mentions[0].RelationshipID != *second.Mentions[0].RelationshipID {
		t.Errorf("Expected both mentions on relationship %d, got %d and %d",
			*first.Mentions[0].RelationshipID, *first.Mentions[0].RelationshipID, *second.Mentions[0].RelationshipID)
	}
	// The label defaults to the resolved name, so a mention is never a nameless row.
	if first.Mentions[0].Label != "Lucie" {
		t.Errorf("Expected the mention label to default to the resolved name, got %q", first.Mentions[0].Label)
	}

	var relationships int64
	db.Model(&models.Relationship{}).Where("user_id = ?", 1).Count(&relationships)
	if relationships != 1 {
		t.Errorf("Expected find-or-create to make exactly one relationship, found %d", relationships)
	}
}

// A snapshot and a journal entry naming the same person must land on the same relationship
// — the same function resolves both (invariant 2b).
func TestCreateJournalEntryShareRelationshipWithSnapshots(t *testing.T) {
	db := setupSQLiteDB(t)
	alex := seedStack(t, db, 1, "Alex", "2026-01-10")

	created := createJournal(t, 1, checkinBody(entryOne, `{"id":"calm","intensity":1}`,
		`{"ref":0,"name":"Alex"}`, ``))

	if created.Mentions[0].RelationshipID == nil || *created.Mentions[0].RelationshipID != alex.ID {
		t.Errorf("Expected the mention to reuse relationship %d, got %v", alex.ID, created.Mentions[0].RelationshipID)
	}
}

// The ritual's day word is a check-in with no intensity in it, and the server takes it.
//
// A2 required an intensity on every feeling; A8 found the one writer that cannot supply one.
// The closing card is a single tap on a single word (§3.2) — there is no strength in it to
// record, and a middle number invented here would be the application authoring a value the
// user did not (invariant 15). Absent is not zero, and the reader has always read it as null.
func TestCreateJournalEntryAcceptsAFeelingWithNoIntensity(t *testing.T) {
	setupSQLiteDB(t)

	body := fmt.Sprintf(`{
		"client_id": %q, "kind": "checkin", "at": %q, "day": %q, "schema_version": 1,
		"payload": {
			"v": 1, "source": "ritual_word", "tz_offset_min": 120,
			"feelings": [{"id":"calm","about":[]}]
		}
	}`, entryOne, atExample, dayExample)

	created := createJournal(t, 1, body)

	feelings, ok := created.Payload["feelings"].([]interface{})
	if !ok || len(feelings) != 1 {
		t.Fatalf("Expected one feeling in the stored payload, got %v", created.Payload["feelings"])
	}
	if _, present := feelings[0].(map[string]interface{})["intensity"]; present {
		t.Error("Expected no intensity key on the stored feeling; absence must survive the round trip")
	}
}

// A skipped question is absent from `answers` — not false. Nothing here writes the key and
// nothing rejects the payload for its absence (invariant 14).
func TestCreateJournalEntryRitualKeepsASkippedQuestionAbsent(t *testing.T) {
	db := setupSQLiteDB(t)

	body := fmt.Sprintf(`{
		"client_id": %q, "kind": "ritual", "at": %q, "day": %q, "schema_version": 1,
		"payload": {
			"v": 1,
			"question_set": { "version": 1, "asked": ["slept_well","moved_body","daylight","with_people","ate_regularly","alcohol"] },
			"answers": { "slept_well": true, "moved_body": false, "daylight": true, "with_people": true, "alcohol": false },
			"day_word": { "id": "calm", "uncertain": false },
			"rollover_hour": 4, "duration_ms": 38000
		}
	}`, entryOne, atExample, dayExample)

	created := createJournal(t, 1, body)

	answers, ok := created.Payload["answers"].(map[string]interface{})
	if !ok {
		t.Fatalf("Expected answers to survive as an object, got %T", created.Payload["answers"])
	}
	if _, present := answers["ate_regularly"]; present {
		t.Error("Expected the skipped question to stay absent from the echoed answers")
	}
	if answers["moved_body"] != false {
		t.Errorf("Expected an answered false to stay false, got %v", answers["moved_body"])
	}

	var stored models.JournalEntry
	if err := db.First(&stored, created.ID).Error; err != nil {
		t.Fatalf("Failed to read the entry back: %v", err)
	}
	storedAnswers := stored.Payload["answers"].(map[string]interface{})
	if _, present := storedAnswers["ate_regularly"]; present {
		t.Error("Expected the skipped question to stay absent in the stored row")
	}
	if len(storedAnswers) != 5 {
		t.Errorf("Expected five answers stored, got %d", len(storedAnswers))
	}
}

func TestCreateJournalEntryPersonFact(t *testing.T) {
	db := setupSQLiteDB(t)
	lucie := seedStack(t, db, 1, "Lucie", "2026-01-10")

	body := fmt.Sprintf(`{
		"client_id": %q, "kind": "person_fact", "at": %q, "day": %q, "schema_version": 1,
		"payload": { "v": 1, "text": "moved to Lyon", "source": "voice", "from_entry_client_id": %q },
		"mentions": [{"ref":0,"relationship_id":%d,"label":"Lucie"}]
	}`, entryOne, atExample, dayExample, entryTwo, lucie.ID)

	created := createJournal(t, 1, body)
	if created.Kind != kindPersonFact {
		t.Errorf("Expected kind person_fact, got %q", created.Kind)
	}
	if len(created.Mentions) != 1 {
		t.Fatalf("Expected exactly one mention, got %d", len(created.Mentions))
	}

	// Two mentions, or none, is not a fact about one person.
	for _, mentions := range []string{``, fmt.Sprintf(`{"ref":0,"relationship_id":%d},{"ref":1,"name":"Noor"}`, lucie.ID)} {
		w := postJournal(t, 1, fmt.Sprintf(`{
			"client_id": %q, "kind": "person_fact", "at": %q, "day": %q,
			"payload": { "v": 1, "text": "moved to Lyon" }, "mentions": [%s]
		}`, entryThree, atExample, dayExample, mentions))
		if w.Code != http.StatusBadRequest {
			t.Errorf("Expected 400 for %d mentions but got %d (body: %s)", len(mentions), w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), "person_fact needs exactly one mention") {
			t.Errorf("Expected the message to name the rule, got %s", w.Body.String())
		}
	}
}

// The trigger is minted and referenced in one request, so the entry that leans on it can
// never exist without it.
func TestCreateJournalEntryMintsATriggerInTheSameRequest(t *testing.T) {
	db := setupSQLiteDB(t)

	created := createJournal(t, 1, checkinBody(entryOne,
		fmt.Sprintf(`{"id":"stress","intensity":2,"about":[{"kind":"trigger","trigger":%q}]}`, triggerWork),
		``,
		fmt.Sprintf(`{"label":"my job","client_id":%q}`, triggerWork)))

	if created.Kind != kindCheckin {
		t.Errorf("Expected the echoed row to be the check-in, got %q", created.Kind)
	}

	var trigger models.JournalEntry
	err := db.Where("user_id = ? AND client_id = ?", 1, triggerWork).First(&trigger).Error
	if err != nil {
		t.Fatalf("Expected the trigger to have been created: %v", err)
	}
	if trigger.Kind != kindTrigger {
		t.Errorf("Expected kind trigger, got %q", trigger.Kind)
	}
	if trigger.Payload["label"] != "my job" {
		t.Errorf("Expected the label to be stored, got %v", trigger.Payload["label"])
	}
	if trigger.Payload["created_from"] != entryOne {
		t.Errorf("Expected created_from to name the entry that minted it, got %v", trigger.Payload["created_from"])
	}
	if trigger.Day != dayExample || !trigger.At.Equal(created.At) {
		t.Errorf("Expected the trigger to share the entry's moment, got %s / %s", trigger.Day, trigger.At)
	}
	if n := countEntries(t, db); n != 2 {
		t.Errorf("Expected the trigger and the check-in, found %d entries", n)
	}

	// Naming the same new trigger again resolves to the one that exists — find-or-create,
	// applied to things that are not people.
	createJournal(t, 1, checkinBody(entryTwo,
		fmt.Sprintf(`{"id":"stress","intensity":1,"about":[{"kind":"trigger","trigger":%q}]}`, triggerWork),
		``,
		fmt.Sprintf(`{"label":"my job","client_id":%q}`, triggerWork)))
	if n := countEntries(t, db); n != 3 {
		t.Errorf("Expected no second trigger row, found %d entries", n)
	}
}

func TestCreateJournalEntryReferencesAnExistingTrigger(t *testing.T) {
	db := setupSQLiteDB(t)
	seedTrigger(t, db, 1, triggerWork, "work")

	created := createJournal(t, 1, checkinBody(entryOne,
		fmt.Sprintf(`{"id":"stress","intensity":2,"about":[{"kind":"trigger","trigger":%q}]}`, triggerWork),
		``,
		fmt.Sprintf(`{"trigger":%q}`, triggerWork)))

	if created.ID == 0 {
		t.Error("Expected the check-in to be created")
	}
	if n := countEntries(t, db); n != 2 {
		t.Errorf("Expected the seeded trigger and the check-in, found %d entries", n)
	}
}

// A trigger belonging to somebody else is 404 for the whole request, and the rollback is
// what the entry count proves.
func TestCreateJournalEntryRejectsAnotherUsersTrigger(t *testing.T) {
	db := setupSQLiteDB(t)
	seedTrigger(t, db, 2, triggerOther, "their work")
	before := countEntries(t, db)

	w := postJournal(t, 1, checkinBody(entryOne,
		fmt.Sprintf(`{"id":"stress","intensity":2,"about":[{"kind":"trigger","trigger":%q}]}`, triggerOther),
		``,
		fmt.Sprintf(`{"trigger":%q}`, triggerOther)))

	if w.Code != http.StatusNotFound {
		t.Errorf("Expected 404 but got %d (body: %s)", w.Code, w.Body.String())
	}
	if after := countEntries(t, db); after != before {
		t.Errorf("Expected nothing written, entry count went from %d to %d", before, after)
	}
	var theirs models.JournalEntry
	if err := db.Where("client_id = ?", triggerOther).First(&theirs).Error; err != nil {
		t.Fatalf("Expected the other user's trigger to survive: %v", err)
	}
	if theirs.UserID != 2 {
		t.Errorf("Expected the trigger to still belong to user 2, got %d", theirs.UserID)
	}
}

// A superseded trigger is not live, so a new entry may not attach itself to one.
//
// **Both shapes, because they used to disagree.** `{"trigger": id}` went through
// findOwnedTrigger and was refused; `{"label": …, "client_id": id}` went through
// find-or-create, matched on (user_id, client_id) alone, and quietly attached the check-in
// to a trigger that had been renamed or merged away. The id is the same id in both, so the
// answer has to be too.
func TestCreateJournalEntryRejectsASupersededTrigger(t *testing.T) {
	db := setupSQLiteDB(t)
	retired := seedTrigger(t, db, 1, triggerWork, "work")
	stamp := time.Now().UTC()
	db.Model(&retired).Update("superseded_at", stamp)

	w := postJournal(t, 1, checkinBody(entryOne, `{"id":"calm","intensity":1}`, ``,
		fmt.Sprintf(`{"trigger":%q}`, triggerWork)))
	if w.Code != http.StatusNotFound {
		t.Errorf("Expected 404 for a superseded trigger but got %d (body: %s)", w.Code, w.Body.String())
	}

	w = postJournal(t, 1, checkinBody(entryTwo, `{"id":"calm","intensity":1}`, ``,
		fmt.Sprintf(`{"label":"work","client_id":%q}`, triggerWork)))
	if w.Code != http.StatusNotFound {
		t.Errorf("Expected 404 for a superseded trigger sent through the mint path but got %d (body: %s)",
			w.Code, w.Body.String())
	}

	// And nothing was written on the way to either refusal.
	var checkins int64
	db.Model(&models.JournalEntry{}).Where("kind = ?", kindCheckin).Count(&checkins)
	if checkins != 0 {
		t.Errorf("Expected no check-in to survive a refused trigger, found %d", checkins)
	}
}

// A relationship belonging to somebody else is 404 for the whole request, and the entry it
// would have hung off never exists.
func TestCreateJournalEntryRejectsAnotherUsersRelationship(t *testing.T) {
	db := setupSQLiteDB(t)
	theirs := seedStack(t, db, 2, "Lucie", "2026-01-10")

	w := postJournal(t, 1, checkinBody(entryOne,
		`{"id":"rapport","intensity":3,"about":[{"kind":"person","ref":0}]}`,
		fmt.Sprintf(`{"ref":0,"relationship_id":%d}`, theirs.ID), ``))

	if w.Code != http.StatusNotFound {
		t.Errorf("Expected 404 but got %d (body: %s)", w.Code, w.Body.String())
	}
	if n := countEntries(t, db); n != 0 {
		t.Errorf("Expected nothing written, found %d entries", n)
	}
	if n := countMentions(t, db); n != 0 {
		t.Errorf("Expected no mentions written, found %d", n)
	}
}

// The retry the offline outbox depends on: the same client_id twice is 200 with the row
// already stored, not 201 and not 409.
func TestCreateJournalEntryIsIdempotent(t *testing.T) {
	db := setupSQLiteDB(t)

	body := checkinBody(entryOne, `{"id":"rapport","intensity":3,"about":[{"kind":"person","ref":0}]}`,
		`{"ref":0,"name":"Lucie"}`, ``)

	first := createJournal(t, 1, body)

	second := postJournal(t, 1, body)
	if second.Code != http.StatusOK {
		t.Fatalf("Expected 200 on the retry but got %d (body: %s)", second.Code, second.Body.String())
	}
	var replayed models.JournalEntry
	if err := json.Unmarshal(second.Body.Bytes(), &replayed); err != nil {
		t.Fatalf("Failed to parse the replayed row: %v", err)
	}
	if replayed.ID != first.ID {
		t.Errorf("Expected the retry to return entry %d, got %d", first.ID, replayed.ID)
	}
	if len(replayed.Mentions) != 1 || replayed.Mentions[0].RelationshipID == nil {
		t.Errorf("Expected the replayed row to carry its resolved mention, got %+v", replayed.Mentions)
	}

	if n := countEntries(t, db); n != 1 {
		t.Errorf("Expected one entry after the retry, found %d", n)
	}
	if n := countMentions(t, db); n != 1 {
		t.Errorf("Expected one mention after the retry, found %d", n)
	}
	var relationships int64
	db.Model(&models.Relationship{}).Count(&relationships)
	if relationships != 1 {
		t.Errorf("Expected one relationship after the retry, found %d", relationships)
	}
}

// Client ids are unique per user, not globally: two people's offline queues can mint the
// same uuid and neither is told about the other.
func TestCreateJournalEntryClientIDIsScopedToTheUser(t *testing.T) {
	db := setupSQLiteDB(t)
	body := checkinBody(entryOne, `{"id":"calm","intensity":1}`, ``, ``)

	createJournal(t, 1, body)
	createJournal(t, 2, body)

	if n := countEntries(t, db); n != 2 {
		t.Errorf("Expected both users' entries, found %d", n)
	}
}

func TestCreateJournalEntrySupersedes(t *testing.T) {
	db := setupSQLiteDB(t)

	original := createJournal(t, 1, checkinBody(entryOne, `{"id":"stress","intensity":2}`, ``, ``))

	correction := fmt.Sprintf(`{
		"client_id": %q, "kind": "checkin", "at": %q, "day": %q, "schema_version": 1,
		"payload": { "v": 1, "source": "typed", "feelings": [{"id":"irritation","intensity":2}] },
		"supersedes_id": %d
	}`, entryTwo, atExample, dayExample, original.ID)

	created := createJournal(t, 1, correction)
	if created.SupersedesID == nil || *created.SupersedesID != original.ID {
		t.Errorf("Expected the correction to point at %d, got %v", original.ID, created.SupersedesID)
	}

	var stamped models.JournalEntry
	if err := db.First(&stamped, original.ID).Error; err != nil {
		t.Fatalf("Failed to read the superseded entry: %v", err)
	}
	if stamped.SupersededAt == nil {
		t.Fatal("Expected superseded_at to be stamped on the original")
	}
	if !stamped.SupersededAt.Equal(created.At) {
		t.Errorf("Expected the stamp to be the correction's own instant %s, got %s", created.At, *stamped.SupersededAt)
	}

	// A second correction of the same row is a conflict: two statements each claiming to
	// replace the same one leave a reader no way to say which is current.
	again := fmt.Sprintf(`{
		"client_id": %q, "kind": "checkin", "at": %q, "day": %q,
		"payload": { "v": 1, "feelings": [{"id":"anger","intensity":1}] },
		"supersedes_id": %d
	}`, entryThree, atExample, dayExample, original.ID)
	w := postJournal(t, 1, again)
	if w.Code != http.StatusConflict {
		t.Errorf("Expected 409 on a second supersede but got %d (body: %s)", w.Code, w.Body.String())
	}
	if n := countEntries(t, db); n != 2 {
		t.Errorf("Expected the rejected correction to write nothing, found %d entries", n)
	}
}

func TestCreateJournalEntryRejectsAnotherUsersSupersedesID(t *testing.T) {
	db := setupSQLiteDB(t)
	theirs := createJournal(t, 2, checkinBody(entryOne, `{"id":"calm","intensity":1}`, ``, ``))

	w := postJournal(t, 1, fmt.Sprintf(`{
		"client_id": %q, "kind": "checkin", "at": %q, "day": %q,
		"payload": { "v": 1, "feelings": [{"id":"calm","intensity":1}] },
		"supersedes_id": %d
	}`, entryTwo, atExample, dayExample, theirs.ID))

	if w.Code != http.StatusNotFound {
		t.Errorf("Expected 404 but got %d (body: %s)", w.Code, w.Body.String())
	}
	if n := countEntries(t, db); n != 1 {
		t.Errorf("Expected nothing written, found %d entries", n)
	}
	var untouched models.JournalEntry
	db.First(&untouched, theirs.ID)
	if untouched.SupersededAt != nil {
		t.Error("Expected the other user's entry to be left alone")
	}
}

// A merge is a correction whose payload names the trigger that survives.
func TestCreateJournalEntryTriggerMergeCorrection(t *testing.T) {
	db := setupSQLiteDB(t)
	retiring := seedTrigger(t, db, 1, triggerWork, "my job")
	seedTrigger(t, db, 1, triggerMove, "work")

	merge := fmt.Sprintf(`{
		"client_id": %q, "kind": "trigger", "at": %q, "day": %q, "schema_version": 1,
		"payload": { "v": 1, "label": "my job", "merged_into": %q },
		"supersedes_id": %d
	}`, entryOne, atExample, dayExample, triggerMove, retiring.ID)

	created := createJournal(t, 1, merge)
	if created.Payload["merged_into"] != triggerMove {
		t.Errorf("Expected merged_into to survive, got %v", created.Payload["merged_into"])
	}

	var stamped models.JournalEntry
	db.First(&stamped, retiring.ID)
	if stamped.SupersededAt == nil {
		t.Error("Expected the merged-away trigger to be superseded")
	}

	// A merge into a trigger that is not the caller's names nothing it may point at.
	seedTrigger(t, db, 2, triggerOther, "their work")
	w := postJournal(t, 1, fmt.Sprintf(`{
		"client_id": %q, "kind": "trigger", "at": %q, "day": %q,
		"payload": { "v": 1, "label": "work", "merged_into": %q }
	}`, entryTwo, atExample, dayExample, triggerOther))
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 but got %d (body: %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "unknown trigger in merged_into") {
		t.Errorf("Expected the message to name merged_into, got %s", w.Body.String())
	}

	// And a trigger cannot be merged into itself.
	w = postJournal(t, 1, fmt.Sprintf(`{
		"client_id": %q, "kind": "trigger", "at": %q, "day": %q,
		"payload": { "v": 1, "label": "work", "merged_into": %q }
	}`, entryThree, atExample, dayExample, entryThree))
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for a self-merge but got %d (body: %s)", w.Code, w.Body.String())
	}
}

// A newer client may write a field this server has never heard of. Dropping it silently is
// the description-wipe bug in a new form, so the whole payload is stored as sent.
func TestCreateJournalEntryKeepsUnknownPayloadKeys(t *testing.T) {
	db := setupSQLiteDB(t)

	body := fmt.Sprintf(`{
		"client_id": %q, "kind": "checkin", "at": %q, "day": %q, "schema_version": 1,
		"payload": {
			"v": 1, "source": "typed", "weather": "rain",
			"feelings": [{"id":"calm","intensity":1,"invented_by_a_later_client":{"deep":[1,"two"]}}],
			"tags": ["  quiet evening  "]
		}
	}`, entryOne, atExample, dayExample)

	created := createJournal(t, 1, body)

	var stored models.JournalEntry
	if err := db.First(&stored, created.ID).Error; err != nil {
		t.Fatalf("Failed to read the entry back: %v", err)
	}
	if stored.Payload["weather"] != "rain" {
		t.Errorf("Expected the unknown top-level key to survive, got %v", stored.Payload["weather"])
	}
	feelings, ok := stored.Payload["feelings"].([]interface{})
	if !ok || len(feelings) != 1 {
		t.Fatalf("Expected one feeling back, got %v", stored.Payload["feelings"])
	}
	feeling := feelings[0].(map[string]interface{})
	nested, ok := feeling["invented_by_a_later_client"].(map[string]interface{})
	if !ok {
		t.Fatalf("Expected the unknown nested key to survive, got %v", feeling["invented_by_a_later_client"])
	}
	if deep, ok := nested["deep"].([]interface{}); !ok || len(deep) != 2 || deep[0] != float64(1) {
		t.Errorf("Expected the nested value to survive intact, got %v", nested["deep"])
	}
	// A known key is stored as it was validated: trimmed.
	tags := stored.Payload["tags"].([]interface{})
	if tags[0] != "quiet evening" {
		t.Errorf("Expected the tag to be stored trimmed, got %q", tags[0])
	}
}

// Every rule from §6.5 that answers 400, and the message it answers with.
func TestCreateJournalEntryValidation(t *testing.T) {
	setupSQLiteDB(t)

	futureAt := time.Now().Add(48 * time.Hour).UTC()

	cases := []struct {
		name          string
		body          string
		expectedError string
	}{
		{
			name:          "Unknown Feeling ID",
			body:          checkinBody(entryOne, `{"id":"bliss","intensity":2}`, ``, ``),
			expectedError: "unknown feeling id: bliss",
		},
		{
			name:          "Intensity Out Of Range",
			body:          checkinBody(entryOne, `{"id":"calm","intensity":4}`, ``, ``),
			expectedError: "feelings[0].intensity must be between 1 and 3",
		},
		{
			// Zero is a value, and it is not one of the three. Only *absence* is allowed.
			name:          "Intensity Of Zero",
			body:          checkinBody(entryOne, `{"id":"calm","intensity":0}`, ``, ``),
			expectedError: "feelings[0].intensity must be between 1 and 3",
		},
		{
			name:          "More Than Five Feelings",
			body:          checkinBody(entryOne, `{"id":"calm","intensity":1},{"id":"joy","intensity":1},{"id":"pride","intensity":1},{"id":"anger","intensity":1},{"id":"shame","intensity":1},{"id":"stress","intensity":1}`, ``, ``),
			expectedError: "too many feelings, maximum is 5",
		},
		{
			name:          "About Ref Names No Mention",
			body:          checkinBody(entryOne, `{"id":"calm","intensity":1,"about":[{"kind":"person","ref":2}]}`, `{"ref":0,"name":"Lucie"}`, ``),
			expectedError: "feelings[0].about[0] names no mention",
		},
		{
			name:          "Unknown About Kind",
			body:          checkinBody(entryOne, `{"id":"calm","intensity":1,"about":[{"kind":"place","ref":0}]}`, ``, ``),
			expectedError: "unknown about kind: place",
		},
		{
			name:          "Trigger Not Listed In Triggers",
			body:          checkinBody(entryOne, fmt.Sprintf(`{"id":"stress","intensity":2,"about":[{"kind":"trigger","trigger":%q}]}`, triggerWork), ``, ``),
			expectedError: "unlisted trigger: " + triggerWork,
		},
		{
			name:          "Unknown Ritual Question In Answers",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"ritual","at":%q,"day":%q,"payload":{"v":1,"answers":{"hydrated":true}}}`, entryOne, atExample, dayExample),
			expectedError: "unknown ritual question: hydrated",
		},
		{
			name:          "Unknown Ritual Question In Asked",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"ritual","at":%q,"day":%q,"payload":{"v":1,"question_set":{"asked":["hydrated"]}}}`, entryOne, atExample, dayExample),
			expectedError: "unknown ritual question: hydrated",
		},
		{
			name:          "Ritual Answer Is Not A Boolean",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"ritual","at":%q,"day":%q,"payload":{"v":1,"answers":{"slept_well":3}}}`, entryOne, atExample, dayExample),
			expectedError: "answers.slept_well must be true or false",
		},
		{
			name:          "Ritual Day Word Is Not A Feeling",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"ritual","at":%q,"day":%q,"payload":{"v":1,"day_word":{"id":"bliss"}}}`, entryOne, atExample, dayExample),
			expectedError: "unknown feeling id: bliss",
		},
		{
			name:          "Day Three Days From At",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"checkin","at":%q,"day":"2026-08-24","payload":{"v":1}}`, entryOne, atExample),
			expectedError: "day must be within 36 hours of at",
		},
		{
			name:          "Day Is Not YYYY-MM-DD",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"checkin","at":%q,"day":"21/08/2026","payload":{"v":1}}`, entryOne, atExample),
			expectedError: "invalid day, expected YYYY-MM-DD",
		},
		{
			name: "At Two Days In The Future",
			body: fmt.Sprintf(`{"client_id":%q,"kind":"checkin","at":%q,"day":%q,"payload":{"v":1}}`,
				entryOne, futureAt.Format(time.RFC3339), futureAt.Format(dateLayout)),
			expectedError: "at must not be more than 24 hours in the future",
		},
		{
			name:          "At Is Not RFC 3339",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"checkin","at":"2026-08-21","day":%q,"payload":{"v":1}}`, entryOne, dayExample),
			expectedError: "invalid at, expected RFC 3339 with an offset",
		},
		{
			name:          "Mention With Neither ID Nor Name",
			body:          checkinBody(entryOne, `{"id":"calm","intensity":1}`, `{"ref":0,"name":"Lucie"},{"ref":1}`, ``),
			expectedError: "mention 1 needs relationship_id or name",
		},
		{
			name:          "Mention With Both ID And Name",
			body:          checkinBody(entryOne, `{"id":"calm","intensity":1}`, `{"ref":0,"relationship_id":1,"name":"Lucie"}`, ``),
			expectedError: "mention 0 has relationship_id and name, not both",
		},
		{
			name:          "Unknown Kind",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"dream","at":%q,"day":%q,"payload":{"v":1}}`, entryOne, atExample, dayExample),
			expectedError: "unknown kind: dream",
		},
		{
			name:          "Missing Client ID",
			body:          fmt.Sprintf(`{"kind":"checkin","at":%q,"day":%q,"payload":{"v":1}}`, atExample, dayExample),
			expectedError: "client_id is required",
		},
		{
			name:          "Client ID Is Not A UUID",
			body:          fmt.Sprintf(`{"client_id":"entry-1","kind":"checkin","at":%q,"day":%q,"payload":{"v":1}}`, atExample, dayExample),
			expectedError: "client_id must be a UUID",
		},
		{
			name:          "Payload Version Is Not One",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"checkin","at":%q,"day":%q,"payload":{"v":2}}`, entryOne, atExample, dayExample),
			expectedError: "payload.v must be 1",
		},
		{
			name:          "Schema Version Is Not One",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"checkin","at":%q,"day":%q,"schema_version":2,"payload":{"v":1}}`, entryOne, atExample, dayExample),
			expectedError: "schema_version must be 1",
		},
		{
			name:          "Payload Is Absent",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"checkin","at":%q,"day":%q}`, entryOne, atExample, dayExample),
			expectedError: "payload is required",
		},
		{
			name:          "Transcript Too Long",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"checkin","at":%q,"day":%q,"payload":{"v":1,"transcript":%q}}`, entryOne, atExample, dayExample, strings.Repeat("a", 4001)),
			expectedError: "transcript exceeds 4000 characters",
		},
		{
			name:          "Person Fact Text Too Long",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"person_fact","at":%q,"day":%q,"payload":{"v":1,"text":%q},"mentions":[{"ref":0,"name":"Lucie"}]}`, entryOne, atExample, dayExample, strings.Repeat("b", 121)),
			expectedError: "text exceeds 120 characters",
		},
		{
			name:          "Trigger Without A Label",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"trigger","at":%q,"day":%q,"payload":{"v":1,"label":"   "}}`, entryOne, atExample, dayExample),
			expectedError: "label is required",
		},
		{
			name:          "Trigger Label Too Long",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"trigger","at":%q,"day":%q,"payload":{"v":1,"label":%q}}`, entryOne, atExample, dayExample, strings.Repeat("c", 41)),
			expectedError: "label exceeds 40 characters",
		},
		{
			name:          "New Trigger Without A Label",
			body:          checkinBody(entryOne, `{"id":"calm","intensity":1}`, ``, fmt.Sprintf(`{"client_id":%q}`, triggerWork)),
			expectedError: "triggers[0] needs a label",
		},
		{
			name:          "Trigger Reference And Mint At Once",
			body:          checkinBody(entryOne, `{"id":"calm","intensity":1}`, ``, fmt.Sprintf(`{"trigger":%q,"label":"work","client_id":%q}`, triggerWork, triggerMove)),
			expectedError: "triggers[0] names an existing trigger and a new one, not both",
		},
		{
			name:          "Empty Trigger Entry",
			body:          checkinBody(entryOne, `{"id":"calm","intensity":1}`, ``, `{}`),
			expectedError: "triggers[0] needs trigger, or label and client_id",
		},
		{
			name:          "Too Many Tags",
			body:          fmt.Sprintf(`{"client_id":%q,"kind":"checkin","at":%q,"day":%q,"payload":{"v":1,"tags":["a","b","c","d","e","f","g","h","i","j","k","l","m"]}}`, entryOne, atExample, dayExample),
			expectedError: "too many tags, maximum is 12",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := postJournal(t, 1, tc.body)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("Expected 400 but got %d (body: %s)", w.Code, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), tc.expectedError) {
				t.Errorf("Expected an error containing %q but got %s", tc.expectedError, w.Body.String())
			}
		})
	}
}

func TestCreateJournalEntryRequiresAuth(t *testing.T) {
	setupSQLiteDB(t)

	w := postJournal(t, 0, checkinBody(entryOne, `{"id":"calm","intensity":1}`, ``, ``))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401 but got %d (body: %s)", w.Code, w.Body.String())
	}
}

// The one case the SQLite tests cannot reach: an entry whose client id is held by a
// soft-deleted row. The lookup runs under GORM's default scope and does not see it, so the
// insert conflicts — which is the intended answer, because a retry after a delete should
// not resurrect the row.
func TestCreateJournalEntryConflictsWithASoftDeletedClientID(t *testing.T) {
	db := setupSQLiteDB(t)
	created := createJournal(t, 1, checkinBody(entryOne, `{"id":"calm","intensity":1}`, ``, ``))
	db.Delete(&models.JournalEntry{}, created.ID)

	w := postJournal(t, 1, checkinBody(entryOne, `{"id":"calm","intensity":1}`, ``, ``))
	if w.Code != http.StatusConflict {
		t.Errorf("Expected 409 but got %d (body: %s)", w.Code, w.Body.String())
	}
}

// The statement shape, where sqlmock is the right tool: the column list is the contract
// between this handler and the migration A1 shipped.
func TestCreateJournalEntryInsertShape(t *testing.T) {
	mock, gormDB := setupMockDB(t)
	database.DB = gormDB

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "journal_entries" WHERE (user_id = $1 AND client_id = $2) AND "journal_entries"."deleted_at" IS NULL`)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "relationships" WHERE (id = $1 AND user_id = $2) AND "relationships"."deleted_at" IS NULL`)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "name"}).AddRow(5, 1, "Lucie"))
	mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO "journal_entries" ("created_at","updated_at","deleted_at","user_id","client_id","kind","day","at","schema_version","payload","superseded_at","supersedes_id") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING "id"`)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1, entryOne, kindCheckin, dayExample,
			sqlmock.AnyArg(), 1, sqlmock.AnyArg(), nil, nil).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(11))
	mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO "journal_mentions" ("entry_id","relationship_id","label","ref") VALUES ($1,$2,$3,$4) ON CONFLICT ("id") DO UPDATE SET "entry_id"="excluded"."entry_id" RETURNING "id"`)).
		WithArgs(11, 5, "Lucie", 0).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(3))
	mock.ExpectCommit()

	w := postJournal(t, 1, checkinBody(entryOne,
		`{"id":"rapport","intensity":3,"about":[{"kind":"person","ref":0}]}`,
		`{"ref":0,"relationship_id":5,"label":"Lucie"}`, ``))

	if w.Code != http.StatusCreated {
		t.Fatalf("Expected 201 but got %d (body: %s)", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("Unmet sqlmock expectations: %s", err)
	}
}

// A failure part-way through rolls the whole thing back, including the trigger that was
// already inserted.
func TestCreateJournalEntryRollsBackOnDatabaseError(t *testing.T) {
	mock, gormDB := setupMockDB(t)
	database.DB = gormDB

	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "journal_entries"`)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "journal_entries"`)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO "journal_entries"`)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(11))
	mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO "journal_entries"`)).
		WillReturnError(errors.New("db connection failed"))
	mock.ExpectRollback()

	w := postJournal(t, 1, checkinBody(entryOne,
		fmt.Sprintf(`{"id":"stress","intensity":2,"about":[{"kind":"trigger","trigger":%q}]}`, triggerWork),
		``,
		fmt.Sprintf(`{"label":"my job","client_id":%q}`, triggerWork)))

	if w.Code != http.StatusInternalServerError {
		t.Errorf("Expected 500 but got %d (body: %s)", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("Unmet sqlmock expectations: %s", err)
	}
}

// The validation helpers on their own, without a request around them — the cases a body
// cannot easily express.
func TestValidateDayAnchorsOnTheDaysMidpoint(t *testing.T) {
	// A check-in made at 03:59 local on the following morning belongs to the previous day
	// (the rollover hour) and, in Alaska, is 12:59 UTC on that following day. It is a
	// legitimate entry, not a typo.
	at, _ := time.Parse(time.RFC3339, "2026-08-22T03:59:00-09:00")
	if err := validateDay("2026-08-21", at.UTC()); err != nil {
		t.Errorf("Expected a rollover check-in at UTC-9 to be accepted, got %v", err)
	}

	// The other extreme: an entry just after midnight in Kiritimati, UTC+14.
	at, _ = time.Parse(time.RFC3339, "2026-08-21T00:01:00+14:00")
	if err := validateDay("2026-08-21", at.UTC()); err != nil {
		t.Errorf("Expected a just-past-midnight check-in at UTC+14 to be accepted, got %v", err)
	}

	// And a real mistake still fails.
	at, _ = time.Parse(time.RFC3339, atExample)
	if err := validateDay("2026-08-19", at.UTC()); err == nil {
		t.Error("Expected a day two days early to be rejected")
	}
}

func TestValidateMentionsNormalizes(t *testing.T) {
	id := uint(5)
	normalized, err := validateMentions([]JournalMentionInput{
		{Ref: 0, Name: "  Lucie  ", Label: "  Lucie  "},
		{Ref: 1, RelationshipID: &id},
	})
	if err != nil {
		t.Fatalf("Expected the mentions to validate, got %v", err)
	}
	if normalized[0].Name != "Lucie" || normalized[0].Label != "Lucie" {
		t.Errorf("Expected the name and label trimmed, got %q / %q", normalized[0].Name, normalized[0].Label)
	}
	if normalized[1].RelationshipID == nil || *normalized[1].RelationshipID != 5 {
		t.Errorf("Expected the id to survive, got %v", normalized[1].RelationshipID)
	}

	if _, err := validateMentions(nil); err != nil {
		t.Errorf("Expected no mentions to be valid, got %v", err)
	}
}

func TestValidateJournalKind(t *testing.T) {
	for _, kind := range []string{kindCheckin, kindRitual, kindPersonFact, kindTrigger} {
		if err := validateJournalKind(kind); err != nil {
			t.Errorf("Expected %q to be a kind, got %v", kind, err)
		}
	}
	if err := validateJournalKind(""); err == nil {
		t.Error("Expected an empty kind to be rejected — there is no default")
	}
}

// seedClientIDs hands out distinct, well-shaped client ids so a seeded row never trips the
// per-user unique index by accident.
var seedClientIDs int

func nextSeedClientID(t *testing.T) string {
	t.Helper()
	seedClientIDs++
	return fmt.Sprintf("%08d-0000-4000-8000-000000000000", seedClientIDs)
}

// seedEntry writes one entry straight to the database, bypassing the handler, so a read
// test can lay out exactly the rows it means to read back — including shapes the write path
// would refuse, like a row that is already superseded.
func seedEntry(t *testing.T, db *gorm.DB, userID uint, kind, day, at string, relationshipIDs ...uint) models.JournalEntry {
	t.Helper()
	instant, err := time.Parse(time.RFC3339, at)
	if err != nil {
		t.Fatalf("Bad seed instant %q: %v", at, err)
	}

	entry := models.JournalEntry{
		UserID:        userID,
		ClientID:      nextSeedClientID(t),
		Kind:          kind,
		Day:           day,
		At:            instant.UTC(),
		SchemaVersion: 1,
		Payload:       map[string]interface{}{"v": float64(1)},
	}
	for i, id := range relationshipIDs {
		relationshipID := id
		entry.Mentions = append(entry.Mentions, models.JournalMention{
			RelationshipID: &relationshipID,
			Ref:            i,
			Label:          "seeded",
		})
	}
	if err := db.Create(&entry).Error; err != nil {
		t.Fatalf("Failed to seed %s entry on %s: %v", kind, day, err)
	}
	return entry
}

func getJournal(t *testing.T, userID uint, path string) *httptest.ResponseRecorder {
	t.Helper()
	return call(t, http.MethodGet, path, userID, "", journalRoutes)
}

// readEntries insists on 200 and decodes the list.
func readEntries(t *testing.T, userID uint, path string) []models.JournalEntry {
	t.Helper()
	w := getJournal(t, userID, path)
	if w.Code != http.StatusOK {
		t.Fatalf("GET %s: expected 200 but got %d (body: %s)", path, w.Code, w.Body.String())
	}
	var entries []models.JournalEntry
	if err := json.Unmarshal(w.Body.Bytes(), &entries); err != nil {
		t.Fatalf("Failed to parse entries: %v", err)
	}
	return entries
}

func days(entries []models.JournalEntry) []string {
	out := make([]string, 0, len(entries))
	for _, entry := range entries {
		out = append(out, entry.Day)
	}
	return out
}

func TestGetJournalEntriesRangeIncludesBothBoundaries(t *testing.T) {
	db := setupSQLiteDB(t)
	for _, day := range []string{"2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"} {
		seedEntry(t, db, 1, kindCheckin, day, day+"T12:00:00Z")
	}

	entries := readEntries(t, 1, "/journal/entries?from=2026-08-19&to=2026-08-21")

	got := days(entries)
	want := []string{"2026-08-19", "2026-08-20", "2026-08-21"}
	if len(got) != len(want) {
		t.Fatalf("Expected %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("Expected %v, got %v", want, got)
			break
		}
	}
}

func TestGetJournalEntriesExcludesSupersededRows(t *testing.T) {
	db := setupSQLiteDB(t)
	original := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T09:00:00Z")
	correction := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T10:00:00Z")

	stamp := correction.At
	if err := db.Model(&original).Update("superseded_at", stamp).Error; err != nil {
		t.Fatalf("Failed to supersede the original: %v", err)
	}

	entries := readEntries(t, 1, "/journal/entries?from=2026-08-21&to=2026-08-21")
	if len(entries) != 1 {
		t.Fatalf("Expected only the correction, got %d entries", len(entries))
	}
	if entries[0].ID != correction.ID {
		t.Errorf("Expected entry %d, got %d", correction.ID, entries[0].ID)
	}
	// The superseded row is still there — it is not deleted, only no longer current.
	var stored int64
	db.Model(&models.JournalEntry{}).Where("user_id = ?", 1).Count(&stored)
	if stored != 2 {
		t.Errorf("Expected both rows to remain stored, found %d", stored)
	}
}

// The order is day, then at, then id — and the id tiebreaker is the one that stops two
// entries stamped the same instant from swapping places between refreshes.
func TestGetJournalEntriesOrdersByDayThenAtThenID(t *testing.T) {
	db := setupSQLiteDB(t)
	late := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T18:00:00Z")
	early := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T08:00:00Z")
	nextDay := seedEntry(t, db, 1, kindCheckin, "2026-08-22", "2026-08-22T07:00:00Z")
	tiedFirst := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T08:00:00Z")

	entries := readEntries(t, 1, "/journal/entries?from=2026-08-20&to=2026-08-23")

	want := []uint{early.ID, tiedFirst.ID, late.ID, nextDay.ID}
	if len(entries) != len(want) {
		t.Fatalf("Expected %d entries, got %d", len(want), len(entries))
	}
	for i, id := range want {
		if entries[i].ID != id {
			t.Fatalf("Expected order %v, got %v", want, func() []uint {
				ids := make([]uint, 0, len(entries))
				for _, e := range entries {
					ids = append(ids, e.ID)
				}
				return ids
			}())
		}
	}
}

func TestGetJournalEntriesFiltersByKind(t *testing.T) {
	db := setupSQLiteDB(t)
	seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T09:00:00Z")
	seedEntry(t, db, 1, kindRitual, "2026-08-21", "2026-08-21T22:00:00Z")
	trigger := seedEntry(t, db, 1, kindTrigger, "2026-08-21", "2026-08-21T09:30:00Z")

	entries := readEntries(t, 1, "/journal/entries?from=2026-08-21&to=2026-08-21&kind=trigger")
	if len(entries) != 1 || entries[0].ID != trigger.ID {
		t.Fatalf("Expected only the trigger, got %d entries", len(entries))
	}

	// The trigger vocabulary needs no endpoint of its own; this is the list.
	if entries[0].Kind != kindTrigger {
		t.Errorf("Expected kind trigger, got %q", entries[0].Kind)
	}

	w := getJournal(t, 1, "/journal/entries?kind=dream")
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for an unknown kind but got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestGetJournalEntriesFiltersByRelationship(t *testing.T) {
	db := setupSQLiteDB(t)
	lucie := seedStack(t, db, 1, "Lucie", "2026-01-10")
	noor := seedStack(t, db, 1, "Noor", "2026-01-11")
	theirs := seedStack(t, db, 2, "Someone", "2026-01-12")

	withLucie := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T09:00:00Z", lucie.ID)
	withBoth := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T10:00:00Z", lucie.ID, noor.ID)
	seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T11:00:00Z", noor.ID)
	seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T12:00:00Z")

	entries := readEntries(t, 1, fmt.Sprintf("/journal/entries?from=2026-08-21&to=2026-08-21&relationship_id=%d", lucie.ID))
	if len(entries) != 2 {
		t.Fatalf("Expected the two entries naming Lucie, got %d", len(entries))
	}
	if entries[0].ID != withLucie.ID || entries[1].ID != withBoth.ID {
		t.Errorf("Expected entries %d and %d, got %d and %d", withLucie.ID, withBoth.ID, entries[0].ID, entries[1].ID)
	}
	// An entry naming one person twice is still one row — the filter is a subquery, not a
	// join, so nothing is duplicated.
	if len(entries[1].Mentions) != 2 {
		t.Errorf("Expected the two-person entry to carry both mentions, got %d", len(entries[1].Mentions))
	}

	// Somebody else's relationship matches nothing, rather than reaching across users.
	other := readEntries(t, 1, fmt.Sprintf("/journal/entries?from=2026-08-21&to=2026-08-21&relationship_id=%d", theirs.ID))
	if len(other) != 0 {
		t.Errorf("Expected no entries for another user's relationship, got %d", len(other))
	}
	if body := getJournal(t, 1, fmt.Sprintf("/journal/entries?relationship_id=%d", theirs.ID)).Body.String(); body != "[]" {
		t.Errorf("Expected an empty list to serialize as [], got %s", body)
	}

	w := getJournal(t, 1, "/journal/entries?relationship_id=Lucie")
	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for a non-numeric relationship_id but got %d", w.Code)
	}
}

func TestGetJournalEntriesRejectsAMalformedRange(t *testing.T) {
	setupSQLiteDB(t)

	cases := []struct {
		path          string
		expectedError string
	}{
		{"/journal/entries?from=21-08-2026", "invalid from, expected YYYY-MM-DD"},
		{"/journal/entries?to=2026-8-21", "invalid to, expected YYYY-MM-DD"},
		{"/journal/entries?from=2026-02-30", "invalid from, expected YYYY-MM-DD"},
		{"/journal/entries?from=yesterday", "invalid from, expected YYYY-MM-DD"},
	}
	for _, tc := range cases {
		w := getJournal(t, 1, tc.path)
		if w.Code != http.StatusBadRequest {
			t.Errorf("GET %s: expected 400 but got %d", tc.path, w.Code)
			continue
		}
		if !strings.Contains(w.Body.String(), tc.expectedError) {
			t.Errorf("GET %s: expected %q, got %s", tc.path, tc.expectedError, w.Body.String())
		}
	}
}

// A caller that names no range gets the last 31 days, both ends included.
func TestGetJournalEntriesDefaultsToTheLastThirtyOneDays(t *testing.T) {
	db := setupSQLiteDB(t)
	today := time.Now().UTC()

	inside := today.AddDate(0, 0, -1)
	boundary := today.AddDate(0, 0, -(journalDefaultWindowDays - 1))
	outside := today.AddDate(0, 0, -journalDefaultWindowDays)

	seedEntry(t, db, 1, kindCheckin, today.Format(dateLayout), today.Format(time.RFC3339))
	seedEntry(t, db, 1, kindCheckin, inside.Format(dateLayout), inside.Format(time.RFC3339))
	seedEntry(t, db, 1, kindCheckin, boundary.Format(dateLayout), boundary.Format(time.RFC3339))
	seedEntry(t, db, 1, kindCheckin, outside.Format(dateLayout), outside.Format(time.RFC3339))

	entries := readEntries(t, 1, "/journal/entries")
	if len(entries) != 3 {
		t.Fatalf("Expected the three days inside the default window, got %d: %v", len(entries), days(entries))
	}
	if entries[0].Day != boundary.Format(dateLayout) {
		t.Errorf("Expected the window to include its 31st day back (%s), got %s",
			boundary.Format(dateLayout), entries[0].Day)
	}
	for _, entry := range entries {
		if entry.Day == outside.Format(dateLayout) {
			t.Errorf("Expected the day before the window (%s) to be excluded", outside.Format(dateLayout))
		}
	}
}

func TestGetJournalEntriesNeverReturnsAnotherUsersRows(t *testing.T) {
	db := setupSQLiteDB(t)
	seedEntry(t, db, 2, kindCheckin, "2026-08-21", "2026-08-21T09:00:00Z")
	mine := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T10:00:00Z")

	entries := readEntries(t, 1, "/journal/entries?from=2026-08-21&to=2026-08-21")
	if len(entries) != 1 || entries[0].ID != mine.ID {
		t.Fatalf("Expected only my entry, got %d entries", len(entries))
	}

	if w := getJournal(t, 0, "/journal/entries"); w.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401 without a user, got %d", w.Code)
	}
}

func TestDeleteJournalEntry(t *testing.T) {
	db := setupSQLiteDB(t)
	mine := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T09:00:00Z")
	theirs := seedEntry(t, db, 2, kindCheckin, "2026-08-21", "2026-08-21T09:00:00Z")

	del := func(userID uint, id uint) *httptest.ResponseRecorder {
		return call(t, http.MethodDelete, fmt.Sprintf("/journal/entries/%d", id), userID, "", journalRoutes)
	}

	w := del(1, mine.ID)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "Journal entry deleted") {
		t.Errorf("Expected the repo's delete message, got %s", w.Body.String())
	}

	// Soft, like every other delete in the app: gone from reads, still on disk.
	if entries := readEntries(t, 1, "/journal/entries?from=2026-08-21&to=2026-08-21"); len(entries) != 0 {
		t.Errorf("Expected the deleted entry to drop out of reads, got %d", len(entries))
	}
	var remaining int64
	db.Unscoped().Model(&models.JournalEntry{}).Where("id = ?", mine.ID).Count(&remaining)
	if remaining != 1 {
		t.Errorf("Expected the row to survive as a soft delete, found %d", remaining)
	}

	// Deleting it again reports 404 — RowsAffected is what the status is read from, so a
	// second delete genuinely means "nothing matched".
	if again := del(1, mine.ID); again.Code != http.StatusNotFound {
		t.Errorf("Expected 404 on a second delete but got %d", again.Code)
	}
	if other := del(1, theirs.ID); other.Code != http.StatusNotFound {
		t.Errorf("Expected 404 for another user's entry but got %d", other.Code)
	}
	var survivor models.JournalEntry
	if err := db.First(&survivor, theirs.ID).Error; err != nil {
		t.Errorf("Expected the other user's entry to survive: %v", err)
	}
	if missing := del(1, 9999); missing.Code != http.StatusNotFound {
		t.Errorf("Expected 404 for an unknown id but got %d", missing.Code)
	}
	if anon := call(t, http.MethodDelete, "/journal/entries/1", 0, "", journalRoutes); anon.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401 without a user, got %d", anon.Code)
	}
}

// §10.6, the one action that removes journal content about a third party. The facts go and
// the check-ins stay: a check-in is the user's own record of a day, and taking somebody out
// of the journal must not rewrite it.
func TestDeleteJournalPersonRemovesFactsAndDetachesMentions(t *testing.T) {
	db := setupSQLiteDB(t)
	lucie := seedStack(t, db, 1, "Lucie", "2026-01-10")
	noor := seedStack(t, db, 1, "Noor")

	checkin := seedEntry(t, db, 1, kindCheckin, "2026-08-20", "2026-08-20T09:00:00Z", lucie.ID)
	ritual := seedEntry(t, db, 1, kindRitual, "2026-08-20", "2026-08-20T22:30:00Z", lucie.ID)
	factOne := seedEntry(t, db, 1, kindPersonFact, "2026-08-19", "2026-08-19T09:00:00Z", lucie.ID)
	factTwo := seedEntry(t, db, 1, kindPersonFact, "2026-08-21", "2026-08-21T09:00:00Z", lucie.ID)
	elsewhere := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T10:00:00Z", noor.ID)

	w := call(t, http.MethodDelete, fmt.Sprintf("/journal/people/%d", lucie.ID), 1, "", journalRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	// The two counts the dialog stated, and they are disjoint: two facts go, two entries
	// stay and stop being linked. The facts' own mentions are in neither number.
	if !strings.Contains(w.Body.String(), `"facts_deleted":2`) {
		t.Errorf("Expected two facts deleted, got %s", w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"mentions_detached":2`) {
		t.Errorf("Expected two mentions detached, got %s", w.Body.String())
	}

	// The facts are gone from every read, and soft-deleted rather than erased.
	entries := readEntries(t, 1, "/journal/entries?from=2026-08-19&to=2026-08-21")
	for _, entry := range entries {
		if entry.ID == factOne.ID || entry.ID == factTwo.ID {
			t.Errorf("Expected fact %d to drop out of reads", entry.ID)
		}
	}
	if len(entries) != 3 {
		t.Fatalf("Expected the three non-fact entries to survive, got %d", len(entries))
	}
	var softDeleted int64
	db.Unscoped().Model(&models.JournalEntry{}).
		Where("id IN ? AND deleted_at IS NOT NULL", []uint{factOne.ID, factTwo.ID}).
		Count(&softDeleted)
	if softDeleted != 2 {
		t.Errorf("Expected both facts to survive as soft deletes, found %d", softDeleted)
	}

	// Every mention of Lucie is detached, on the entries that stayed *and* on the facts
	// that went — and each keeps its label, which is the name as it was said that day.
	var stillLinked int64
	db.Model(&models.JournalMention{}).Where("relationship_id = ?", lucie.ID).Count(&stillLinked)
	if stillLinked != 0 {
		t.Errorf("Expected no mention to still name Lucie, found %d", stillLinked)
	}
	for _, id := range []uint{checkin.ID, ritual.ID} {
		var mention models.JournalMention
		if err := db.Where("entry_id = ?", id).First(&mention).Error; err != nil {
			t.Fatalf("Expected entry %d to keep its mention row: %v", id, err)
		}
		if mention.RelationshipID != nil {
			t.Errorf("Expected entry %d's mention to be detached, got %v", id, *mention.RelationshipID)
		}
		if mention.Label != "seeded" {
			t.Errorf("Expected the label to survive, got %q", mention.Label)
		}
	}

	// Nobody else is touched: not another person's mention, and not the relationship or
	// its snapshots — deleting those is the dashboard's action, with its own dialog.
	var other models.JournalMention
	if err := db.Where("entry_id = ?", elsewhere.ID).First(&other).Error; err != nil {
		t.Fatalf("Expected Noor's mention to survive: %v", err)
	}
	if other.RelationshipID == nil || *other.RelationshipID != noor.ID {
		t.Errorf("Expected Noor's mention to still name Noor, got %v", other.RelationshipID)
	}
	if err := db.First(&models.Relationship{}, lucie.ID).Error; err != nil {
		t.Errorf("Expected the relationship itself to survive: %v", err)
	}
	var snapshots int64
	db.Model(&models.AnalysisSubject{}).Where("relationship_id = ?", lucie.ID).Count(&snapshots)
	if snapshots != 1 {
		t.Errorf("Expected the snapshot to survive, found %d", snapshots)
	}

	// Run again and there is nothing left to take: the numbers are what happened, not what
	// was asked for, so an already-emptied person reports zero rather than repeating itself.
	again := call(t, http.MethodDelete, fmt.Sprintf("/journal/people/%d", lucie.ID), 1, "", journalRoutes)
	if again.Code != http.StatusOK {
		t.Fatalf("Expected 200 on a second run but got %d", again.Code)
	}
	if !strings.Contains(again.Body.String(), `"facts_deleted":0`) ||
		!strings.Contains(again.Body.String(), `"mentions_detached":0`) {
		t.Errorf("Expected both counts to be zero the second time, got %s", again.Body.String())
	}
}

// The dialog states these two numbers *before* it acts, and it gets them by counting the
// entries `GET /api/journal/entries` returned — which excludes superseded rows. So this
// handler has to count the same set, or the promise and the outcome disagree for exactly
// the users who have renamed or merged something.
func TestDeleteJournalPersonCountsOnlyTheEntriesTheJournalShows(t *testing.T) {
	db := setupSQLiteDB(t)
	lucie := seedStack(t, db, 1, "Lucie", "2026-01-10")

	visible := seedEntry(t, db, 1, kindCheckin, "2026-08-20", "2026-08-20T09:00:00Z", lucie.ID)
	superseded := seedEntry(t, db, 1, kindCheckin, "2026-08-20", "2026-08-20T10:00:00Z", lucie.ID)
	fact := seedEntry(t, db, 1, kindPersonFact, "2026-08-19", "2026-08-19T09:00:00Z", lucie.ID)
	supersededFact := seedEntry(t, db, 1, kindPersonFact, "2026-08-19", "2026-08-19T10:00:00Z", lucie.ID)

	db.Model(&superseded).Update("superseded_at", visible.At)
	db.Model(&supersededFact).Update("superseded_at", visible.At)

	// What the dialog read a moment earlier: one check-in and one fact, not four rows.
	shown := readEntries(t, 1, "/journal/entries?from=2026-08-19&to=2026-08-20")
	if len(shown) != 2 {
		t.Fatalf("Expected the read path to show two entries, got %d", len(shown))
	}

	w := call(t, http.MethodDelete, fmt.Sprintf("/journal/people/%d", lucie.ID), 1, "", journalRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"facts_deleted":1`) {
		t.Errorf("Expected facts_deleted to count only the fact the journal shows, got %s", w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"mentions_detached":1`) {
		t.Errorf("Expected mentions_detached to count only the entry the journal shows, got %s", w.Body.String())
	}

	// The superseded rows are still detached from the person, though — "removed from the
	// journal" would be narrower than it sounds if a row nobody can reach kept the link.
	var stillLinked int64
	db.Model(&models.JournalMention{}).Where("relationship_id = ?", lucie.ID).Count(&stillLinked)
	if stillLinked != 0 {
		t.Errorf("Expected every mention detached including the superseded ones, found %d", stillLinked)
	}
	// And a superseded fact is soft-deleted with the rest: it is still a statement about
	// this person, and it is still in the export until it goes.
	var liveFacts int64
	db.Model(&models.JournalEntry{}).
		Where("kind = ? AND id IN ?", kindPersonFact, []uint{fact.ID, supersededFact.ID}).
		Count(&liveFacts)
	if liveFacts != 0 {
		t.Errorf("Expected both facts soft-deleted, found %d still live", liveFacts)
	}
}

func TestDeleteJournalPersonScopesToTheCaller(t *testing.T) {
	db := setupSQLiteDB(t)
	theirs := seedStack(t, db, 2, "Lucie")
	fact := seedEntry(t, db, 2, kindPersonFact, "2026-08-19", "2026-08-19T09:00:00Z", theirs.ID)

	// A miss is 404, never 403 — the answer must not tell user 1 that this id exists.
	w := call(t, http.MethodDelete, fmt.Sprintf("/journal/people/%d", theirs.ID), 1, "", journalRoutes)
	if w.Code != http.StatusNotFound {
		t.Errorf("Expected 404 for another user's person but got %d (body: %s)", w.Code, w.Body.String())
	}
	if err := db.First(&models.JournalEntry{}, fact.ID).Error; err != nil {
		t.Errorf("Expected the other user's fact to survive untouched: %v", err)
	}
	var mention models.JournalMention
	if err := db.Where("entry_id = ?", fact.ID).First(&mention).Error; err != nil {
		t.Fatalf("Expected the other user's mention to survive: %v", err)
	}
	if mention.RelationshipID == nil {
		t.Error("Expected the other user's mention to still be linked")
	}

	if missing := call(t, http.MethodDelete, "/journal/people/9999", 1, "", journalRoutes); missing.Code != http.StatusNotFound {
		t.Errorf("Expected 404 for an unknown id but got %d", missing.Code)
	}
	if garbage := call(t, http.MethodDelete, "/journal/people/nope", 1, "", journalRoutes); garbage.Code != http.StatusNotFound {
		t.Errorf("Expected 404 for a non-numeric id but got %d", garbage.Code)
	}
	if anon := call(t, http.MethodDelete, "/journal/people/1", 0, "", journalRoutes); anon.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401 without a user, got %d", anon.Code)
	}
}

func readDays(t *testing.T, userID uint, path string) []JournalDay {
	t.Helper()
	w := getJournal(t, userID, path)
	if w.Code != http.StatusOK {
		t.Fatalf("GET %s: expected 200 but got %d (body: %s)", path, w.Code, w.Body.String())
	}
	var result []JournalDay
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("Failed to parse days: %v", err)
	}
	return result
}

func TestGetJournalDays(t *testing.T) {
	db := setupSQLiteDB(t)
	lucie := seedStack(t, db, 1, "Lucie", "2026-01-10")
	noor := seedStack(t, db, 1, "Noor", "2026-01-11")

	// The 20th: two check-ins, one of which names two people and one of which names Lucie
	// again — so `people` must say 2, not 3, and `checkins` must say 2 despite the join.
	seedEntry(t, db, 1, kindCheckin, "2026-08-20", "2026-08-20T09:00:00Z", lucie.ID, noor.ID)
	seedEntry(t, db, 1, kindCheckin, "2026-08-20", "2026-08-20T18:00:00Z", lucie.ID)

	// The 21st: one check-in and the ritual.
	seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T09:00:00Z")
	seedEntry(t, db, 1, kindRitual, "2026-08-21", "2026-08-21T22:30:00Z")

	// Another user's day, and a day outside the range, neither of which may appear.
	seedEntry(t, db, 2, kindCheckin, "2026-08-20", "2026-08-20T09:00:00Z")
	seedEntry(t, db, 1, kindCheckin, "2026-08-25", "2026-08-25T09:00:00Z")

	result := readDays(t, 1, "/journal/days?from=2026-08-20&to=2026-08-21")
	if len(result) != 2 {
		t.Fatalf("Expected two days, got %d: %+v", len(result), result)
	}

	twentieth, twentyFirst := result[0], result[1]
	if twentieth.Day != "2026-08-20" || twentyFirst.Day != "2026-08-21" {
		t.Fatalf("Expected the days in order, got %s then %s", twentieth.Day, twentyFirst.Day)
	}
	if twentieth.Checkins != 2 {
		t.Errorf("Expected 2 check-ins on the 20th — the join to mentions must not inflate it — got %d", twentieth.Checkins)
	}
	if twentieth.People != 2 {
		t.Errorf("Expected 2 distinct people on the 20th, not 3 mentions, got %d", twentieth.People)
	}
	if twentieth.Ritual {
		t.Error("Expected ritual false on a day with no ritual entry")
	}
	if twentyFirst.Checkins != 1 {
		t.Errorf("Expected 1 check-in on the 21st — the ritual is not one — got %d", twentyFirst.Checkins)
	}
	if !twentyFirst.Ritual {
		t.Error("Expected ritual true on the day the ritual was done")
	}
	if twentyFirst.People != 0 {
		t.Errorf("Expected nobody named on the 21st, got %d", twentyFirst.People)
	}
}

func TestGetJournalDaysExcludesDeletedAndSupersededRows(t *testing.T) {
	db := setupSQLiteDB(t)
	lucie := seedStack(t, db, 1, "Lucie", "2026-01-10")

	kept := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T09:00:00Z", lucie.ID)
	deleted := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T10:00:00Z", lucie.ID)
	superseded := seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T11:00:00Z", lucie.ID)

	db.Delete(&models.JournalEntry{}, deleted.ID)
	db.Model(&superseded).Update("superseded_at", kept.At)

	result := readDays(t, 1, "/journal/days?from=2026-08-21&to=2026-08-21")
	if len(result) != 1 {
		t.Fatalf("Expected one day, got %d", len(result))
	}
	if result[0].Checkins != 1 {
		t.Errorf("Expected only the live, current entry to count, got %d", result[0].Checkins)
	}
	if result[0].People != 1 {
		t.Errorf("Expected one person from the one counted entry, got %d", result[0].People)
	}
}

func TestGetJournalDaysEmptyRange(t *testing.T) {
	db := setupSQLiteDB(t)
	seedEntry(t, db, 1, kindCheckin, "2026-08-21", "2026-08-21T09:00:00Z")

	w := getJournal(t, 1, "/journal/days?from=2026-09-01&to=2026-09-30")
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d", w.Code)
	}
	if body := w.Body.String(); body != "[]" {
		t.Errorf("Expected an empty range to serialize as [], got %s", body)
	}

	if bad := getJournal(t, 1, "/journal/days?from=not-a-day"); bad.Code != http.StatusBadRequest {
		t.Errorf("Expected 400 for a malformed range but got %d", bad.Code)
	}
	if anon := getJournal(t, 0, "/journal/days"); anon.Code != http.StatusUnauthorized {
		t.Errorf("Expected 401 without a user, got %d", anon.Code)
	}
}
