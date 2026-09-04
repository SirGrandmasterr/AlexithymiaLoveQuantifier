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
}

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

func containsID(ids []string, id string) bool {
	for _, known := range ids {
		if known == id {
			return true
		}
	}
	return false
}
