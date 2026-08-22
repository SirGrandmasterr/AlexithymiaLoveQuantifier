package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"alexithymia-backend/internal/database"
	"alexithymia-backend/internal/domain"
	"alexithymia-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// The journal's handlers: one write path, two reads, and a delete.
//
// The write is one endpoint that creates a check-in, a nightly ritual, a fact about a person
// or a trigger, and does the whole job — resolving mentions, minting triggers, linking
// corrections — inside a single transaction that either commits whole or writes nothing.
// The reads never resolve a correction chain: they filter `superseded_at IS NULL` and see
// only what is current, which is the entire point of stamping that column on the write.
//
// The shape of the validation follows subjects.go: small pure helpers above the handler,
// each returning an error written for a human, each testable without a database. The shape
// of the transaction follows relationships.go: nothing writes a response inside the
// closure, because a response sent from inside it would leave the transaction to commit
// around an error the caller has already been told about.

const (
	// The entry kinds, as switch labels. domain.JournalKinds owns the vocabulary; these
	// are only how this file spells its cases.
	kindCheckin    = "checkin"
	kindRitual     = "ritual"
	kindPersonFact = "person_fact"
	kindTrigger    = "trigger"

	// The `about` kinds inside a check-in payload: what a feeling is attached to.
	aboutPerson  = "person"
	aboutTag     = "tag"
	aboutTrigger = "trigger"

	// journalSchemaVersion is the only payload format this server can validate. A newer
	// one is rejected rather than stored unchecked — the alternative is a row nothing has
	// ever looked at.
	journalSchemaVersion = 1

	maxFeelings         = 5
	maxFeelingIntensity = 3
	maxTranscriptRunes  = 4000
	maxPersonFactRunes  = 120
	// A trigger label is a tag by another name, so it borrows the tag limit rather than
	// inventing a second one.
	maxTriggerLabelRunes = maxTagLength

	// How far into the future an entry may claim to have happened. A device with a wrong
	// clock or a time zone off by one still lands inside this; a year 3000 timestamp does
	// not.
	maxFutureSkew = 24 * time.Hour
	// How far `at` may sit from the civil day the client assigned it to. §6.5: a rollover
	// hour and a time zone, not a typo.
	maxDaySkew = 36 * time.Hour
)

// clientIDPattern is the UUID shape §7.2 requires of a client id. It is deliberately
// indifferent to version and variant nibbles: the server does not care which UUID flavour
// a client mints, only that ids cannot collide by accident.
var clientIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// JournalMentionInput is one person named by an entry. Exactly one of RelationshipID and
// Name is filled: an id when the client knows who this is, a name when it does not, which
// is the same compatibility contract POST /api/subjects offers.
type JournalMentionInput struct {
	Ref            int    `json:"ref"`
	RelationshipID *uint  `json:"relationship_id"`
	Name           string `json:"name"`
	Label          string `json:"label"`
}

// JournalTriggerInput is one trigger an entry leans on. Either Trigger names an existing
// trigger entry by its client id, or Label plus ClientID mint a new one in the same
// transaction — find-or-create, applied to things that are not people.
type JournalTriggerInput struct {
	Trigger  string `json:"trigger"`
	Label    string `json:"label"`
	ClientID string `json:"client_id"`
}

// CreateJournalEntryInput is the whole write. There is no update counterpart on purpose: a
// journal row is a statement made at a moment, and changing it is a new statement, which
// is what SupersedesID is for.
type CreateJournalEntryInput struct {
	ClientID      string                 `json:"client_id"`
	Kind          string                 `json:"kind"`
	At            string                 `json:"at"`
	Day           string                 `json:"day"`
	SchemaVersion int                    `json:"schema_version"`
	Payload       map[string]interface{} `json:"payload"`
	Mentions      []JournalMentionInput  `json:"mentions"`
	Triggers      []JournalTriggerInput  `json:"triggers"`
	SupersedesID  *uint                  `json:"supersedes_id"`
}

// journalError carries a status and a message out of the transaction closure so the
// response is written outside it, the way relationships.go's sentinel errors do. There are
// more than two failure modes here and each names a different field, so a type beats a list
// of sentinels.
type journalError struct {
	status  int
	message string
}

func (e journalError) Error() string { return e.message }

func badRequest(format string, args ...interface{}) journalError {
	return journalError{status: http.StatusBadRequest, message: fmt.Sprintf(format, args...)}
}

func notFound(format string, args ...interface{}) journalError {
	return journalError{status: http.StatusNotFound, message: fmt.Sprintf(format, args...)}
}

// validateClientID enforces the UUID shape on any of the three places a client id arrives:
// the entry's own, a referenced trigger's, and a minted trigger's.
func validateClientID(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", field)
	}
	if !clientIDPattern.MatchString(value) {
		return fmt.Errorf("%s must be a UUID", field)
	}
	return nil
}

// validateJournalKind rejects anything outside domain.JournalKinds. Unlike normalizeKind
// there is no default: an entry that does not say what it is cannot be read back.
func validateJournalKind(kind string) error {
	if !domain.IsJournalKind(kind) {
		return fmt.Errorf("unknown kind: %s", kind)
	}
	return nil
}

// parseJournalAt reads the instant. RFC 3339 with an offset on the wire, UTC in the column;
// the offset the client was in is the payload's business (tz_offset_min), not the row's.
func parseJournalAt(at string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339, at)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid at, expected RFC 3339 with an offset")
	}
	if parsed.After(time.Now().Add(maxFutureSkew)) {
		return time.Time{}, fmt.Errorf("at must not be more than 24 hours in the future")
	}
	return parsed.UTC(), nil
}

// parseDayString reads a civil day in the one wire format the app uses everywhere, naming
// the field it failed on. Both the write path and the read range go through it, so the
// format the endpoint accepts cannot drift between them.
func parseDayString(field, day string) (time.Time, error) {
	parsed, err := time.Parse(dateLayout, day)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid %s, expected YYYY-MM-DD", field)
	}
	// time.Parse rejects most malformed values on its own, but the round trip is what pins
	// the shape: it is the difference between "strictly YYYY-MM-DD" and "whatever parses".
	if parsed.Format(dateLayout) != day {
		return time.Time{}, fmt.Errorf("invalid %s, expected YYYY-MM-DD", field)
	}
	return parsed, nil
}

// validateDay checks the civil day the client assigned the entry to.
//
// The day is an interval and `at` is an instant, so "within 36 hours" needs an anchor. It
// is the day's midpoint, not its midnight: an entry made at 03:00 local on the following
// morning belongs to the previous day (the rollover hour) and can be another 14 hours away
// in UTC (the time zone), so a window measured from midnight rejects a legitimate 03:59
// check-in in Alaska while a window measured from noon accepts every rollover-plus-offset
// combination with hours to spare — and still rejects a day three days from `at`.
func validateDay(day string, at time.Time) error {
	parsed, err := parseDayString("day", day)
	if err != nil {
		return err
	}
	midpoint := parsed.Add(12 * time.Hour)
	skew := at.Sub(midpoint)
	if skew < 0 {
		skew = -skew
	}
	if skew > maxDaySkew {
		return fmt.Errorf("day must be within 36 hours of at")
	}
	return nil
}

// decodePayload reads the known keys of a payload into a typed shape and leaves the map
// alone. Unknown keys are kept because the map is what gets stored — a newer client may
// write a field this server has never heard of, and dropping it silently is the
// description-wipe mistake in a new form. Only what the struct names is validated.
func decodePayload(payload map[string]interface{}, kind string, target interface{}) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("%s payload is not valid JSON", kind)
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return fmt.Errorf("%s payload is malformed: %v", kind, err)
	}
	return nil
}

// validatePayloadVersion enforces `v == 1`. It is a pointer in every payload struct so an
// absent `v` is distinguishable from a zero one and reports the same honest message.
func validatePayloadVersion(v *float64) error {
	if v == nil || *v != journalSchemaVersion {
		return fmt.Errorf("payload.v must be %d", journalSchemaVersion)
	}
	return nil
}

// checkinPayload names every key of a check-in this server validates. Everything else in
// the map — source, tz_offset_min, note, language, transcript_kept, anything a later
// client adds — travels through untouched.
type checkinPayload struct {
	V          *float64 `json:"v"`
	Transcript string   `json:"transcript"`
	Tags       []string `json:"tags"`
	Feelings   []struct {
		ID        string `json:"id"`
		Intensity *int   `json:"intensity"`
		Uncertain *bool  `json:"uncertain"`
		About     []struct {
			Kind    string `json:"kind"`
			Ref     *int   `json:"ref"`
			Tag     string `json:"tag"`
			Trigger string `json:"trigger"`
		} `json:"about"`
	} `json:"feelings"`
	Proposal *struct {
		Proposed []string `json:"proposed"`
		Accepted []string `json:"accepted"`
	} `json:"proposal"`
}

// validateCheckinPayload applies the check-in row of §6.5. mentionCount is what an
// `about.ref` has to index — a feeling cannot be about a person the entry never named.
//
// It normalizes `tags` in place, so the values checked are the values stored (Recipe 8).
func validateCheckinPayload(payload map[string]interface{}, mentionCount int) error {
	var typed checkinPayload
	if err := decodePayload(payload, kindCheckin, &typed); err != nil {
		return err
	}
	if err := validatePayloadVersion(typed.V); err != nil {
		return err
	}

	if utf8.RuneCountInString(typed.Transcript) > maxTranscriptRunes {
		return fmt.Errorf("transcript exceeds %d characters", maxTranscriptRunes)
	}

	if _, present := payload["tags"]; present {
		tags, err := validateTags(typed.Tags)
		if err != nil {
			return err
		}
		payload["tags"] = tags
	}

	if len(typed.Feelings) > maxFeelings {
		return fmt.Errorf("too many feelings, maximum is %d", maxFeelings)
	}
	for i, feeling := range typed.Feelings {
		if !domain.IsFeelingID(feeling.ID) {
			return fmt.Errorf("unknown feeling id: %s", feeling.ID)
		}
		// Absent is allowed; zero is not the same thing (invariant 14). A2 required an
		// intensity on every feeling, and A8 found the case that cannot supply one: the
		// ritual's closing card is a single tap on a single word, so there is no strength
		// in it to record, and writing a middle number would be the app authoring a value
		// the user did not (invariant 15). §6.5 asks for "intensity 1–3", which is a range
		// for a value that is present — the frontend reader has always read an absent one
		// as null rather than as zero.
		if feeling.Intensity != nil && (*feeling.Intensity < 1 || *feeling.Intensity > maxFeelingIntensity) {
			return fmt.Errorf("feelings[%d].intensity must be between 1 and %d", i, maxFeelingIntensity)
		}
		for j, about := range feeling.About {
			switch about.Kind {
			case aboutPerson:
				if about.Ref == nil || *about.Ref < 0 || *about.Ref >= mentionCount {
					return fmt.Errorf("feelings[%d].about[%d] names no mention", i, j)
				}
			case aboutTag:
				tag := strings.TrimSpace(about.Tag)
				if tag == "" {
					return fmt.Errorf("feelings[%d].about[%d] needs a tag", i, j)
				}
				if utf8.RuneCountInString(tag) > maxTagLength {
					return fmt.Errorf("tag exceeds %d characters: %s", maxTagLength, tag)
				}
			case aboutTrigger:
				// Which triggers exist is validateTriggerRefs' question; here it is only
				// that the reference is not blank.
				if strings.TrimSpace(about.Trigger) == "" {
					return fmt.Errorf("feelings[%d].about[%d] needs a trigger", i, j)
				}
			default:
				return fmt.Errorf("unknown about kind: %s", about.Kind)
			}
		}
	}

	if typed.Proposal != nil {
		for _, id := range append(append([]string{}, typed.Proposal.Proposed...), typed.Proposal.Accepted...) {
			if !domain.IsFeelingID(id) {
				return fmt.Errorf("unknown feeling id: %s", id)
			}
		}
	}

	return nil
}

// ritualPayload names the keys of a nightly ritual this server validates. `answers` stays
// a map of interface{} so a non-boolean can be reported as such rather than as a decoder
// error.
type ritualPayload struct {
	V           *float64 `json:"v"`
	QuestionSet *struct {
		Asked []string `json:"asked"`
	} `json:"question_set"`
	Answers map[string]interface{} `json:"answers"`
	DayWord *struct {
		ID string `json:"id"`
	} `json:"day_word"`
}

// validateRitualPayload applies the ritual row of §6.5.
//
// A question that was asked and skipped is absent from `answers` — not false, and not an
// error. Nothing here requires a key to be present, and nothing writes one that is not.
func validateRitualPayload(payload map[string]interface{}) error {
	var typed ritualPayload
	if err := decodePayload(payload, kindRitual, &typed); err != nil {
		return err
	}
	if err := validatePayloadVersion(typed.V); err != nil {
		return err
	}

	if typed.QuestionSet != nil {
		for _, id := range typed.QuestionSet.Asked {
			if !domain.IsRitualQuestionID(id) {
				return fmt.Errorf("unknown ritual question: %s", id)
			}
		}
	}

	for id, answer := range typed.Answers {
		if !domain.IsRitualQuestionID(id) {
			return fmt.Errorf("unknown ritual question: %s", id)
		}
		if _, ok := answer.(bool); !ok {
			return fmt.Errorf("answers.%s must be true or false", id)
		}
	}

	if typed.DayWord != nil && !domain.IsFeelingID(typed.DayWord.ID) {
		return fmt.Errorf("unknown feeling id: %s", typed.DayWord.ID)
	}

	return nil
}

type personFactPayload struct {
	V    *float64 `json:"v"`
	Text string   `json:"text"`
}

// validatePersonFactPayload applies the person_fact row of §6.5: exactly one mention,
// because a fact is about one person, and a short text, because a fact is not a diary.
func validatePersonFactPayload(payload map[string]interface{}, mentionCount int) error {
	var typed personFactPayload
	if err := decodePayload(payload, kindPersonFact, &typed); err != nil {
		return err
	}
	if err := validatePayloadVersion(typed.V); err != nil {
		return err
	}
	if mentionCount != 1 {
		return fmt.Errorf("person_fact needs exactly one mention")
	}
	if utf8.RuneCountInString(typed.Text) > maxPersonFactRunes {
		return fmt.Errorf("text exceeds %d characters", maxPersonFactRunes)
	}
	return nil
}

type triggerPayload struct {
	V          *float64 `json:"v"`
	Label      string   `json:"label"`
	MergedInto *string  `json:"merged_into"`
}

// validateTriggerPayload applies the trigger row of §6.5 and returns the trigger this one
// was merged into, if any, so the handler can check inside the transaction that it is one
// of the caller's — the half of the rule that needs a database.
func validateTriggerPayload(payload map[string]interface{}, clientID string) (string, error) {
	var typed triggerPayload
	if err := decodePayload(payload, kindTrigger, &typed); err != nil {
		return "", err
	}
	if err := validatePayloadVersion(typed.V); err != nil {
		return "", err
	}

	label := strings.TrimSpace(typed.Label)
	if label == "" {
		return "", fmt.Errorf("label is required")
	}
	if utf8.RuneCountInString(label) > maxTriggerLabelRunes {
		return "", fmt.Errorf("label exceeds %d characters: %s", maxTriggerLabelRunes, label)
	}
	payload["label"] = label

	if typed.MergedInto == nil || *typed.MergedInto == "" {
		return "", nil
	}
	if *typed.MergedInto == clientID {
		return "", fmt.Errorf("merged_into must not name this trigger")
	}
	return *typed.MergedInto, nil
}

// validateMentions checks the people an entry names and returns them normalized, so the
// values checked are the values stored. Each mention carries an id or a name and never
// both: two ways of saying who this is would let one contradict the other, and the server
// would have to guess which the user meant.
//
// Mentions are numbered from zero, the way `about.ref` addresses them, so an error message
// and a payload reference point at the same row.
func validateMentions(mentions []JournalMentionInput) ([]JournalMentionInput, error) {
	if mentions == nil {
		return nil, nil
	}
	normalized := make([]JournalMentionInput, 0, len(mentions))
	for i, mention := range mentions {
		name := strings.TrimSpace(mention.Name)
		hasID := mention.RelationshipID != nil
		switch {
		case !hasID && name == "":
			return nil, fmt.Errorf("mention %d needs relationship_id or name", i)
		case hasID && name != "":
			return nil, fmt.Errorf("mention %d has relationship_id and name, not both", i)
		}

		label := strings.TrimSpace(mention.Label)
		if utf8.RuneCountInString(label) > maxTagLength {
			return nil, fmt.Errorf("mention %d label exceeds %d characters: %s", i, maxTagLength, label)
		}

		normalized = append(normalized, JournalMentionInput{
			Ref:            mention.Ref,
			RelationshipID: mention.RelationshipID,
			Name:           name,
			Label:          label,
		})
	}
	return normalized, nil
}

// validateTriggerRefs checks the two halves of §6.5's last row: that every entry in
// `triggers[]` is well formed — either a reference to an existing trigger or a new one
// carrying a label and a client id — and that a feeling may only be about a trigger the
// request listed. Whether a referenced trigger is really the caller's is a database
// question, answered inside the transaction.
func validateTriggerRefs(payload map[string]interface{}, triggers []JournalTriggerInput) error {
	listed := make(map[string]bool, len(triggers))
	for i, trigger := range triggers {
		referenced := strings.TrimSpace(trigger.Trigger)
		label := strings.TrimSpace(trigger.Label)
		minted := strings.TrimSpace(trigger.ClientID)

		switch {
		case referenced != "" && (label != "" || minted != ""):
			return fmt.Errorf("triggers[%d] names an existing trigger and a new one, not both", i)
		case referenced != "":
			if err := validateClientID(fmt.Sprintf("triggers[%d].trigger", i), referenced); err != nil {
				return err
			}
			listed[referenced] = true
		case label != "" || minted != "":
			if err := validateClientID(fmt.Sprintf("triggers[%d].client_id", i), minted); err != nil {
				return err
			}
			if label == "" {
				return fmt.Errorf("triggers[%d] needs a label", i)
			}
			if utf8.RuneCountInString(label) > maxTriggerLabelRunes {
				return fmt.Errorf("triggers[%d].label exceeds %d characters: %s", i, maxTriggerLabelRunes, label)
			}
			listed[minted] = true
		default:
			return fmt.Errorf("triggers[%d] needs trigger, or label and client_id", i)
		}
	}

	// Only a check-in has `about`s, so only a check-in is decoded here — reading a ritual
	// as one would report a malformed check-in for a payload that is nothing of the kind.
	if _, present := payload["feelings"]; !present {
		return nil
	}
	var typed checkinPayload
	if err := decodePayload(payload, kindCheckin, &typed); err != nil {
		return err
	}
	for _, feeling := range typed.Feelings {
		for _, about := range feeling.About {
			if about.Kind != aboutTrigger {
				continue
			}
			if !listed[strings.TrimSpace(about.Trigger)] {
				return fmt.Errorf("unlisted trigger: %s", strings.TrimSpace(about.Trigger))
			}
		}
	}

	return nil
}

// validateJournalPayload dispatches to the helper for the kind. A payload is required:
// an entry with nothing in it is a row nobody can read.
func validateJournalPayload(kind string, payload map[string]interface{}, clientID string, mentionCount int) (string, error) {
	if payload == nil {
		return "", fmt.Errorf("payload is required")
	}
	switch kind {
	case kindCheckin:
		return "", validateCheckinPayload(payload, mentionCount)
	case kindRitual:
		return "", validateRitualPayload(payload)
	case kindPersonFact:
		return "", validatePersonFactPayload(payload, mentionCount)
	case kindTrigger:
		return validateTriggerPayload(payload, clientID)
	}
	return "", fmt.Errorf("unknown kind: %s", kind)
}

// isDuplicateClientID reports whether an insert failed on the (user_id, client_id) unique
// index. It happens when the id is held by a soft-deleted entry: the idempotency lookup
// runs under GORM's default scope and does not see it, which is deliberate — a retried
// POST after a delete should conflict, not resurrect the row (§6.2).
func isDuplicateClientID(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "UNIQUE constraint failed") ||
		strings.Contains(message, "duplicate key value violates unique constraint")
}

// findOwnedTrigger loads one of the caller's live triggers by its client id. Live means
// neither soft-deleted (GORM's default scope) nor superseded — a renamed or merged trigger
// is not something a new entry may attach itself to.
func findOwnedTrigger(tx *gorm.DB, userID uint, clientID string) (*models.JournalEntry, error) {
	var found []models.JournalEntry
	err := tx.Where("user_id = ? AND client_id = ? AND kind = ? AND superseded_at IS NULL",
		userID, clientID, kindTrigger).
		Limit(1).Find(&found).Error
	if err != nil {
		return nil, err
	}
	if len(found) == 0 {
		return nil, nil
	}
	return &found[0], nil
}

// CreateJournalEntry writes one entry, its mentions and any trigger it invents, in one
// transaction. The order inside the closure is fixed by what depends on what: the
// idempotency check first so a retry costs one query, the correction next so a request
// that cannot be linked writes nothing, the triggers before the entry that references
// them, and the mentions with the entry itself.
func CreateJournalEntry(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		return
	}

	var input CreateJournalEntryInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validateClientID("client_id", input.ClientID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validateJournalKind(input.Kind); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	at, err := parseJournalAt(input.At)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validateDay(input.Day, at); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Absent means "the only version there is". Anything else the server cannot check.
	schemaVersion := input.SchemaVersion
	if schemaVersion == 0 {
		schemaVersion = journalSchemaVersion
	}
	if schemaVersion != journalSchemaVersion {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("schema_version must be %d", journalSchemaVersion)})
		return
	}

	mentions, err := validateMentions(input.Mentions)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	mergedInto, err := validateJournalPayload(input.Kind, input.Payload, input.ClientID, len(mentions))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validateTriggerRefs(input.Payload, input.Triggers); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	entry := models.JournalEntry{
		UserID:        userID,
		ClientID:      input.ClientID,
		Kind:          input.Kind,
		Day:           input.Day,
		At:            at,
		SchemaVersion: schemaVersion,
		Payload:       input.Payload,
		SupersedesID:  input.SupersedesID,
	}

	replayed := false

	err = database.DB.Transaction(func(tx *gorm.DB) error {
		// 1. Idempotency. A client that retries blindly — which is what the offline
		// outbox does — gets the row it already wrote and no second one.
		var existing []models.JournalEntry
		err := tx.Preload("Mentions").
			Where("user_id = ? AND client_id = ?", userID, input.ClientID).
			Limit(1).Find(&existing).Error
		if err != nil {
			return err
		}
		if len(existing) == 1 {
			entry = existing[0]
			replayed = true
			return nil
		}

		// 2. The correction, if this entry is one. Both halves happen here so a request
		// whose target is not the caller's leaves nothing behind.
		if input.SupersedesID != nil {
			var superseded models.JournalEntry
			err := tx.Where("id = ? AND user_id = ?", *input.SupersedesID, userID).
				First(&superseded).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return notFound("supersedes_id names no entry of yours")
			}
			if err != nil {
				return err
			}
			if superseded.SupersededAt != nil {
				return journalError{
					status:  http.StatusConflict,
					message: "that entry has already been superseded",
				}
			}
			// Stamped with the replacing statement's own instant, not the wall clock, so
			// the pair reads consistently in an export: this row stopped being current at
			// the moment the next one was made.
			if err := tx.Model(&superseded).Update("superseded_at", at).Error; err != nil {
				return err
			}
		}

		// 3. The triggers, before the entry that references them.
		for i, trigger := range input.Triggers {
			referenced := strings.TrimSpace(trigger.Trigger)
			if referenced != "" {
				found, err := findOwnedTrigger(tx, userID, referenced)
				if err != nil {
					return err
				}
				if found == nil {
					return notFound("triggers[%d] names no trigger of yours: %s", i, referenced)
				}
				continue
			}

			// Find-or-create, the same shape person resolution takes: a client that
			// mints a trigger and then names it twice creates it once.
			minted := strings.TrimSpace(trigger.ClientID)
			var owned []models.JournalEntry
			err := tx.Where("user_id = ? AND client_id = ?", userID, minted).
				Limit(1).Find(&owned).Error
			if err != nil {
				return err
			}
			if len(owned) == 1 {
				if owned[0].Kind != kindTrigger {
					return badRequest("triggers[%d].client_id already names a %s entry", i, owned[0].Kind)
				}
				// Live, on the same terms findOwnedTrigger applies to the referenced
				// branch above. Without this the two ways of naming a trigger disagree:
				// `{"trigger": id}` is a 404 for a renamed or merged-away row while
				// `{"label": …, "client_id": id}` quietly attached the check-in to it, and
				// a retried write is the one place a client can send the second shape with
				// an id the vocabulary has since moved on from.
				if owned[0].SupersededAt != nil {
					return notFound("triggers[%d] names no trigger of yours: %s", i, minted)
				}
				continue
			}

			label := strings.TrimSpace(trigger.Label)
			created := models.JournalEntry{
				UserID:        userID,
				ClientID:      minted,
				Kind:          kindTrigger,
				Day:           input.Day,
				At:            at,
				SchemaVersion: journalSchemaVersion,
				// Numbers are float64 throughout: JSON has one number type, so this is
				// what the row reads back as and what a comparison has to match.
				Payload: map[string]interface{}{
					"v":            float64(journalSchemaVersion),
					"label":        label,
					"merged_into":  nil,
					"created_from": input.ClientID,
				},
			}
			if err := tx.Create(&created).Error; err != nil {
				if isDuplicateClientID(err) {
					return journalError{
						status:  http.StatusConflict,
						message: fmt.Sprintf("triggers[%d].client_id is already in use", i),
					}
				}
				return err
			}
		}

		// The half of validateTriggerPayload that needs a database: a merge may only
		// point at a trigger the caller still has.
		if mergedInto != "" {
			found, err := findOwnedTrigger(tx, userID, mergedInto)
			if err != nil {
				return err
			}
			if found == nil {
				return badRequest("unknown trigger in merged_into: %s", mergedInto)
			}
		}

		// 4. The people. An id must be the caller's; a name resolves through the same
		// find-or-create the snapshot path and the backfill use, so a journal entry and a
		// snapshot naming the same person land on the same relationship.
		rows := make([]models.JournalMention, 0, len(mentions))
		for i, mention := range mentions {
			row := models.JournalMention{Ref: mention.Ref, Label: mention.Label}

			if mention.RelationshipID != nil {
				var owned []models.Relationship
				err := tx.Where("id = ? AND user_id = ?", *mention.RelationshipID, userID).
					Limit(1).Find(&owned).Error
				if err != nil {
					return err
				}
				if len(owned) == 0 {
					return notFound("mention %d names no relationship of yours", i)
				}
				row.RelationshipID = mention.RelationshipID
				if row.Label == "" {
					row.Label = owned[0].Name
				}
				rows = append(rows, row)
				continue
			}

			relationship, err := database.FindOrCreateRelationship(tx, userID, mention.Name)
			if err != nil {
				return err
			}
			row.RelationshipID = &relationship.ID
			if row.Label == "" {
				row.Label = relationship.Name
			}
			rows = append(rows, row)
		}
		entry.Mentions = rows

		// 5. The entry and its mentions, in one Create — the association carries the
		// foreign key, so there is no window in which an entry exists unmentioned.
		if err := tx.Create(&entry).Error; err != nil {
			if isDuplicateClientID(err) {
				return journalError{
					status:  http.StatusConflict,
					message: "client_id is already in use",
				}
			}
			return err
		}
		return nil
	})

	var handled journalError
	switch {
	case errors.As(err, &handled):
		c.JSON(handled.status, gin.H{"error": handled.message})
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create journal entry"})
		return
	}

	// 6. The row as stored, so the client can stop guessing what the server made of it:
	// its id, its timestamps, and every mention with the relationship it resolved to.
	if replayed {
		c.JSON(http.StatusOK, entry)
		return
	}
	c.JSON(http.StatusCreated, entry)
}

// journalDefaultWindowDays is how much of the journal a caller that names no range gets:
// the last 31 days, inclusive of both ends. A month view asks for the month it is drawing;
// this is only what a caller who asked for nothing in particular receives.
const journalDefaultWindowDays = 31

// parseJournalRange reads the from/to window both read endpoints share. Either end may be
// omitted — `to` defaults to today and `from` to 30 days before `to`, which is the 31-day
// window §7.1 specifies — but a value that is present is strictly YYYY-MM-DD or a 400.
//
// "Today" here is the server's UTC day, which is the only day the server knows: `day` is a
// civil day the client chose, with its own rollover hour and time zone applied. A client
// that cares which days it gets sends both ends, and every screen in the app does.
func parseJournalRange(c *gin.Context) (string, string, error) {
	// The parsed value is kept, not re-derived: `from`'s default is counted back from it,
	// and re-parsing `to` there would be a second error branch for a string this function
	// either just validated or formatted itself — one no input can reach and no test can
	// cover, which reads as a real failure mode to whoever comes next.
	end := time.Now().UTC()
	to := c.Query("to")
	if to == "" {
		to = end.Format(dateLayout)
	} else {
		parsed, err := parseDayString("to", to)
		if err != nil {
			return "", "", err
		}
		end = parsed
	}

	from := c.Query("from")
	if from == "" {
		from = end.AddDate(0, 0, -(journalDefaultWindowDays - 1)).Format(dateLayout)
	} else if _, err := parseDayString("from", from); err != nil {
		return "", "", err
	}

	return from, to, nil
}

// GetJournalEntries returns the entries that are current — not deleted, not superseded — in
// a day range, newest last.
//
// The range compares strings, which is the whole reason `day` is a varchar: a lexical
// comparison of YYYY-MM-DD is a chronological one, on both engines, with no aggregate to
// mistype (trap 10a). Both ends are inclusive.
func GetJournalEntries(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		return
	}

	from, to, err := parseJournalRange(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// superseded_at IS NULL is what lets a reader stay a reader: a correction stamped the
	// row it replaced at write time, so nothing here walks a chain to find out what is
	// current.
	query := database.DB.
		Preload("Mentions").
		Where("user_id = ? AND superseded_at IS NULL AND day >= ? AND day <= ?", userID, from, to)

	if kind := c.Query("kind"); kind != "" {
		if err := validateJournalKind(kind); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		query = query.Where("kind = ?", kind)
	}

	if raw := c.Query("relationship_id"); raw != "" {
		relationshipID, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "relationship_id must be a number"})
			return
		}
		// A subquery rather than a join, so an entry that mentions one person twice is
		// still one row. It needs no ownership check of its own: the outer query is already
		// scoped to this user, so somebody else's relationship simply matches nothing.
		mentioned := database.DB.Model(&models.JournalMention{}).
			Select("entry_id").
			Where("relationship_id = ?", relationshipID)
		query = query.Where("id IN (?)", mentioned)
	}

	// day first because that is the unit the journal is read in, `at` inside it, and id to
	// break a tie between two entries stamped the same instant — without it the order is
	// the engine's whim and the day graph would redraw itself differently on a refresh.
	entries := []models.JournalEntry{}
	err = query.
		Order("day ASC").
		Order("at ASC").
		Order("id ASC").
		Find(&entries).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch journal entries"})
		return
	}

	c.JSON(http.StatusOK, entries)
}

// DeleteJournalEntry soft-deletes one entry, exactly as DeleteSubject does: scoped by owner,
// and `RowsAffected == 0` is a 404 whether the id is unknown, already deleted, or somebody
// else's.
//
// The mentions stay. They carry no soft delete of their own because they have no life of
// their own — they belong to a row that is itself recoverable, and every read that counts
// them joins through the entry, so a deleted entry's mentions stop counting without any
// row being destroyed.
func DeleteJournalEntry(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		return
	}

	result := database.DB.
		Where("id = ? AND user_id = ?", c.Param("id"), userID).
		Delete(&models.JournalEntry{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete journal entry"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Journal entry not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Journal entry deleted"})
}

// DeleteJournalPerson removes everything the journal holds *about* one person: the facts
// the user confirmed, soft-deleted, and every mention of them detached from the person.
//
// This is §10.6's action, and it is the journal's rather than the relationship's. Deleting
// the relationship is a different thing with a different dialog on the dashboard: it takes
// the snapshots and leaves the journal alone. This takes the journal and leaves the
// relationship, the snapshots and the entries themselves alone.
//
// **The check-ins survive.** A check-in is the user's own record of a day, and removing a
// third party from the journal should not rewrite it — the same rule DeleteRelationship
// already follows for its own mentions. What goes is the link: relationship_id becomes
// NULL, the mention keeps its Label, and the entry still reads as it did on the day, with
// the name as it was said. A fact is the exception, because a fact *is* a statement about
// that person and there is nothing left of it once the person is taken out.
//
// The two counts are disjoint by construction and the dialog states both before the fact:
// facts_deleted counts entries that go, mentions_detached counts links on entries that
// stay. Nothing is reported twice.
//
// One endpoint rather than a loop of deletes from the client, because the two halves belong
// in one transaction. A run that removed three facts and then failed to detach would leave
// the user having asked for one thing and been given half of it, with no way to tell which
// half.
func DeleteJournalPerson(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		return
	}

	relationshipID, ok := parseRelationshipID(c)
	if !ok {
		return
	}

	var factsDeleted, mentionsDetached int64
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		// The relationship must be the caller's. A miss is 404, never 403 (invariant 7).
		if _, err := findOwnedRelationship(tx, relationshipID, userID); err != nil {
			return err
		}

		// Every entry that names this person, by id. Two steps rather than one join: the
		// mention table answers "which entries", and the entry table answers "which of
		// those are the caller's" — which is where the user scope lives, so it cannot be
		// lost inside a join condition.
		var mentioned []uint
		err := tx.Model(&models.JournalMention{}).
			Where("relationship_id = ?", relationshipID).
			Distinct().Pluck("entry_id", &mentioned).Error
		if err != nil {
			return err
		}

		var factIDs, survivingIDs []uint
		if len(mentioned) > 0 {
			// The soft-delete scope is doing real work in both of these: an entry the user
			// already withdrew is not counted and not counted again.
			err = tx.Model(&models.JournalEntry{}).
				Where("user_id = ? AND kind = ? AND id IN ?", userID, kindPersonFact, mentioned).
				Pluck("id", &factIDs).Error
			if err != nil {
				return err
			}
			err = tx.Model(&models.JournalEntry{}).
				Where("user_id = ? AND kind <> ? AND id IN ?", userID, kindPersonFact, mentioned).
				Pluck("id", &survivingIDs).Error
			if err != nil {
				return err
			}
		}

		// **What is acted on and what is counted are two different sets, deliberately.**
		//
		// Every fact goes and every mention is detached, superseded rows included: those
		// rows are still statements about this person and they are still in the export, so
		// leaving them would make "removed from the journal" narrower than it sounds.
		//
		// The two numbers, though, are the ones the dialog stated *before* it acted — and
		// it got them by counting what `GET /api/journal/entries` returned, which excludes
		// superseded rows. Counting a different set here would tell a user who has ever
		// renamed or merged something that two facts go and then take four. So both counts
		// are taken over the entries the journal **shows**, which is what the sentence
		// promised. `DeleteRelationship`'s `mentions_detached` and the `mention_count` on
		// the relationship summary are scoped the same way, for the same reason.
		if len(factIDs) > 0 {
			err = tx.Model(&models.JournalEntry{}).
				Where("id IN ? AND superseded_at IS NULL", factIDs).
				Count(&factsDeleted).Error
			if err != nil {
				return err
			}
			if err := tx.Where("id IN ?", factIDs).Delete(&models.JournalEntry{}).Error; err != nil {
				return err
			}
		}

		// Counted before the update, and only on the entries that stay — a fact's own
		// mention is not part of this number, which is what keeps the two disjoint.
		if len(survivingIDs) > 0 {
			err = tx.Model(&models.JournalMention{}).
				Joins("JOIN journal_entries ON journal_entries.id = journal_mentions.entry_id"+
					" AND journal_entries.superseded_at IS NULL").
				Where("journal_mentions.relationship_id = ? AND journal_mentions.entry_id IN ?",
					relationshipID, survivingIDs).
				Count(&mentionsDetached).Error
			if err != nil {
				return err
			}
		}

		// Detached on both sets. A deleted fact's mention is unreachable through any read —
		// the entry is gone from every query — but leaving a row pointing at the person
		// would make "removed from the journal" narrower than it sounds.
		owned := append(append([]uint{}, factIDs...), survivingIDs...)
		if len(owned) > 0 {
			err = tx.Model(&models.JournalMention{}).
				Where("relationship_id = ? AND entry_id IN ?", relationshipID, owned).
				Update("relationship_id", nil).Error
			if err != nil {
				return err
			}
		}

		return nil
	})

	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Relationship not found"})
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove this person from the journal"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":           "Person removed from the journal",
		"facts_deleted":     factsDeleted,
		"mentions_detached": mentionsDetached,
	})
}

// JournalDay is one civil day's worth of counts, for the month view: enough to draw which
// days have something on them without fetching the days themselves.
type JournalDay struct {
	Day      string `json:"day"`
	Checkins int    `json:"checkins"`
	Ritual   bool   `json:"ritual"`
	People   int    `json:"people"`
}

// journalDayRow is what the grouped query scans into. `rituals` is a count on the way out of
// SQL and a bool on the way into JSON: the question the month view asks is whether the
// ritual happened, and a number would invite a reader to draw "how many", which is the kind
// of scoreboard this app does not keep.
type journalDayRow struct {
	Day      string
	Checkins int
	Rituals  int
	People   int
}

// GetJournalDays counts each day in a range: how many check-ins, whether the ritual
// happened, and how many distinct people were named.
//
// One grouped query over `day` — a varchar(10), so GROUP BY and the range comparison are
// string operations that behave the same on SQLite and Postgres. Grouping over a timestamp
// instead is trap 10a, and it is the reason the column is text in the first place.
//
// The join to mentions makes an entry appear once per person it names, which would inflate a
// plain COUNT — an entry naming two people would count as two check-ins. COUNT(DISTINCT id)
// per kind is what makes the counts immune to that fan-out; the CASE yields NULL for the
// other kinds, and COUNT skips NULLs.
func GetJournalDays(c *gin.Context) {
	userID, ok := currentUserID(c)
	if !ok {
		return
	}

	from, to, err := parseJournalRange(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rows := []journalDayRow{}
	err = database.DB.
		Model(&models.JournalEntry{}).
		Select(`journal_entries.day AS day,
		        COUNT(DISTINCT CASE WHEN journal_entries.kind = ? THEN journal_entries.id END) AS checkins,
		        COUNT(DISTINCT CASE WHEN journal_entries.kind = ? THEN journal_entries.id END) AS rituals,
		        COUNT(DISTINCT journal_mentions.relationship_id) AS people`, kindCheckin, kindRitual).
		Joins(`LEFT JOIN journal_mentions ON journal_mentions.entry_id = journal_entries.id`).
		Where(`journal_entries.user_id = ? AND journal_entries.superseded_at IS NULL
		       AND journal_entries.day >= ? AND journal_entries.day <= ?`, userID, from, to).
		Group("journal_entries.day").
		Order("journal_entries.day ASC").
		Scan(&rows).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch journal days"})
		return
	}

	days := make([]JournalDay, 0, len(rows))
	for _, row := range rows {
		days = append(days, JournalDay{
			Day:      row.Day,
			Checkins: row.Checkins,
			Ritual:   row.Rituals > 0,
			People:   row.People,
		})
	}

	c.JSON(http.StatusOK, days)
}
