package domain

// The journal's closed vocabularies, on the precedent of categories.go: IDs only. Labels,
// glosses, the two axes the day graph draws on, and colours are frontend-owned and live in
// src/constants/journal.js — the server has no opinion about what a feeling is called.
//
// The rule these lists live under: an id is permanent. Adding one is two edits in two
// languages and no schema change, because a payload that lacks a key already means "not
// present". Removing one is forbidden — a retired id is marked `retired: true` in the
// frontend constant, so the UI stops offering it while the server keeps accepting it for
// the rows already written and for an import of them. An id that stops validating orphans
// every entry that used it.

// FeelingIDs is the feeling vocabulary, in the order the frontend lays it out. `unclear`
// is a first-class member rather than an absence: "something is there and I cannot name
// it" is an answer, and for this app it is the answer that matters most.
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

// RitualQuestionIDs is every question the nightly ritual can ask: the five core questions
// it always asks, then the optional ones the user can turn on. Which are core and which are
// optional is a frontend decision; the server only cares that an answered question is one
// it knows, so both sets sit in one list.
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

// JournalKinds is the set of entry kinds. A new kind is how the journal extends: it brings
// its own payload shape and needs no column.
var JournalKinds = []string{"checkin", "ritual", "person_fact", "trigger"}

// IsFeelingID reports whether id is one of the known feelings.
func IsFeelingID(id string) bool { return containsID(FeelingIDs, id) }

// IsRitualQuestionID reports whether id is one of the known ritual questions, core or
// optional.
func IsRitualQuestionID(id string) bool { return containsID(RitualQuestionIDs, id) }

// IsJournalKind reports whether kind is one of the known entry kinds.
func IsJournalKind(kind string) bool { return containsID(JournalKinds, kind) }

// containsID compares exactly. Ids are lowercase snake_case by convention and matching is
// case-sensitive on purpose: "Calm" is not a feeling, it is a client bug, and accepting it
// would put two spellings of one id in the stored data.
func containsID(ids []string, id string) bool {
	for _, known := range ids {
		if known == id {
			return true
		}
	}
	return false
}
