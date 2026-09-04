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

const (
	kindCheckin    = "checkin"
	kindRitual     = "ritual"
	kindPersonFact = "person_fact"
	kindTrigger    = "trigger"

	// The `about` kinds inside a check-in payload: what a feeling is attached to.
	aboutPerson  = "person"
	aboutTag     = "tag"
	aboutTrigger = "trigger"

	journalSchemaVersion = 1

	maxFeelings         = 5
	maxFeelingIntensity = 3
	maxTranscriptRunes  = 4000
	maxPersonFactRunes  = 120
	// A trigger label is a tag by another name, so it borrows the tag limit rather than
	// inventing a second one.
	maxTriggerLabelRunes = maxTagLength
	// The words behind a feeling, quoted from the transcript by the model (the
	// EmotionGuesser integration). A quotation, so it is capped and never filtered —
	// mirrors MAX_QUOTE_LENGTH in src/constants/journal.js.
	maxQuoteRunes = 300

	maxFutureSkew = 24 * time.Hour
	maxDaySkew    = 36 * time.Hour
)

var clientIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type JournalMentionInput struct {
	Ref            int    `json:"ref"`
	RelationshipID *uint  `json:"relationship_id"`
	Name           string `json:"name"`
	Label          string `json:"label"`
}

type JournalTriggerInput struct {
	Trigger  string `json:"trigger"`
	Label    string `json:"label"`
	ClientID string `json:"client_id"`
	// Role is which half of a trigger a new one is (domain.TriggerRoles), or empty. Only
	// read when minting; an existing trigger keeps the role it was minted with.
	Role string `json:"role"`
}

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

func validateClientID(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", field)
	}
	if !clientIDPattern.MatchString(value) {
		return fmt.Errorf("%s must be a UUID", field)
	}
	return nil
}

func validateJournalKind(kind string) error {
	if !domain.IsJournalKind(kind) {
		return fmt.Errorf("unknown kind: %s", kind)
	}
	return nil
}

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

func parseDayString(field, day string) (time.Time, error) {
	parsed, err := time.Parse(dateLayout, day)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid %s, expected YYYY-MM-DD", field)
	}
	if parsed.Format(dateLayout) != day {
		return time.Time{}, fmt.Errorf("invalid %s, expected YYYY-MM-DD", field)
	}
	return parsed, nil
}

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

func validatePayloadVersion(v *float64) error {
	if v == nil || *v != journalSchemaVersion {
		return fmt.Errorf("payload.v must be %d", journalSchemaVersion)
	}
	return nil
}

type checkinPayload struct {
	V          *float64 `json:"v"`
	Transcript string   `json:"transcript"`
	Tags       []string `json:"tags"`
	Feelings   []struct {
		ID        string `json:"id"`
		Intensity *int   `json:"intensity"`
		Uncertain *bool  `json:"uncertain"`
		Quote     string `json:"quote"`
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
		if feeling.Intensity != nil && (*feeling.Intensity < 1 || *feeling.Intensity > maxFeelingIntensity) {
			return fmt.Errorf("feelings[%d].intensity must be between 1 and %d", i, maxFeelingIntensity)
		}
		// Capped, not filtered: it is the user's own words, quoted (§5.4's transcript
		// carve-out applies to a piece of the transcript as much as to the whole).
		if utf8.RuneCountInString(feeling.Quote) > maxQuoteRunes {
			return fmt.Errorf("feelings[%d].quote exceeds %d characters", i, maxQuoteRunes)
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
	Role       *string  `json:"role"`
}

// validateTriggerRole accepts an absent or empty role (a trigger written before roles
// existed) and one of domain.TriggerRoles; anything else names itself in the error.
func validateTriggerRole(field, role string) error {
	if role == "" || domain.IsTriggerRole(role) {
		return nil
	}
	return fmt.Errorf("%s must be one of %s, got %q", field, strings.Join(domain.TriggerRoles, " or "), role)
}

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

	if typed.Role != nil {
		if err := validateTriggerRole("role", *typed.Role); err != nil {
			return "", err
		}
	}

	if typed.MergedInto == nil || *typed.MergedInto == "" {
		return "", nil
	}
	if *typed.MergedInto == clientID {
		return "", fmt.Errorf("merged_into must not name this trigger")
	}
	return *typed.MergedInto, nil
}

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
			if err := validateTriggerRole(fmt.Sprintf("triggers[%d].role", i), strings.TrimSpace(trigger.Role)); err != nil {
				return err
			}
			listed[minted] = true
		default:
			return fmt.Errorf("triggers[%d] needs trigger, or label and client_id", i)
		}
	}

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

func isDuplicateClientID(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "UNIQUE constraint failed") ||
		strings.Contains(message, "duplicate key value violates unique constraint")
}

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
				if owned[0].SupersededAt != nil {
					return notFound("triggers[%d] names no trigger of yours: %s", i, minted)
				}
				continue
			}

			label := strings.TrimSpace(trigger.Label)
			payload := map[string]interface{}{
				"v":            float64(journalSchemaVersion),
				"label":        label,
				"merged_into":  nil,
				"created_from": input.ClientID,
			}
			// Absent stays absent (invariant 14): a trigger minted with no role reads as an
			// entity, and writing that word for it would record a choice nobody made.
			if role := strings.TrimSpace(trigger.Role); role != "" {
				payload["role"] = role
			}
			created := models.JournalEntry{
				UserID:        userID,
				ClientID:      minted,
				Kind:          kindTrigger,
				Day:           input.Day,
				At:            at,
				SchemaVersion: journalSchemaVersion,
				Payload:       payload,
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

		if mergedInto != "" {
			found, err := findOwnedTrigger(tx, userID, mergedInto)
			if err != nil {
				return err
			}
			if found == nil {
				return badRequest("unknown trigger in merged_into: %s", mergedInto)
			}
		}

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

	if replayed {
		c.JSON(http.StatusOK, entry)
		return
	}
	c.JSON(http.StatusCreated, entry)
}

const journalDefaultWindowDays = 31

func parseJournalRange(c *gin.Context) (string, string, error) {
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
		mentioned := database.DB.Model(&models.JournalMention{}).
			Select("entry_id").
			Where("relationship_id = ?", relationshipID)
		query = query.Where("id IN (?)", mentioned)
	}

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

		var mentioned []uint
		err := tx.Model(&models.JournalMention{}).
			Where("relationship_id = ?", relationshipID).
			Distinct().Pluck("entry_id", &mentioned).Error
		if err != nil {
			return err
		}

		var factIDs, survivingIDs []uint
		if len(mentioned) > 0 {
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

type JournalDay struct {
	Day      string `json:"day"`
	Checkins int    `json:"checkins"`
	Ritual   bool   `json:"ritual"`
	People   int    `json:"people"`
}

type journalDayRow struct {
	Day      string
	Checkins int
	Rituals  int
	People   int
}

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
