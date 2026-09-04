package domain

var FeelingIDs = []string{
	"joy",
	"excitement",
	"pleasure",
	"rapport",
	"gratitude",
	"pride",
	"curiosity",
	"calm",
	"neutral",
	"unclear",
	"tiredness",
	"boredom",
	"longing",
	"loneliness",
	"sadness",
	"shame",
	"irritation",
	"stress",
	"anxiety",
	"overwhelm",
	"anger",
	// Appended with the EmotionGuesser integration (2026-09-04): the Geneva Emotion Wheel
	// families the list above had no word for. Ids only, as ever — the labels, glosses and
	// coordinates are the frontend's.
	"amusement",
	"affection",
	"admiration",
	"relief",
	"compassion",
	"regret",
	"disappointment",
	"disgust",
	"contempt",
}

// TriggerRoles are the two halves a trigger can be: who or what a feeling was about when it
// was not a person (an entity), or what happened with it (an interaction). A trigger written
// before roles existed carries none, and the server never requires one.
var TriggerRoles = []string{"entity", "interaction"}

var RitualQuestionIDs = []string{
	// Core, always asked, in this order.
	"slept_well",
	"moved_body",
	"daylight",
	"with_people",
	"ate_regularly",
	// Optional, off by default.
	"alcohol",
	"caffeine_late",
	"in_pain",
	"worked_late",
	"time_alone",
	"conflict",
	"cycle",
	"water",
}

var JournalKinds = []string{"checkin", "ritual", "person_fact", "trigger"}

// IsFeelingID reports whether id is one of the known feelings.
func IsFeelingID(id string) bool { return containsID(FeelingIDs, id) }

// IsRitualQuestionID reports whether id is one of the known ritual questions, core or
// optional.
func IsRitualQuestionID(id string) bool { return containsID(RitualQuestionIDs, id) }

// IsJournalKind reports whether kind is one of the known entry kinds.
func IsJournalKind(kind string) bool { return containsID(JournalKinds, kind) }

// IsTriggerRole reports whether role is one of the two trigger halves.
func IsTriggerRole(role string) bool { return containsID(TriggerRoles, role) }

func containsID(ids []string, id string) bool {
	for _, known := range ids {
		if known == id {
			return true
		}
	}
	return false
}
