package domain

import (
	"strings"
	"testing"
)

func TestFeelingIDsAreTheKnownTwentyOne(t *testing.T) {
	if len(FeelingIDs) != 21 {
		t.Fatalf("Expected 21 feeling ids, got %d — removing one is forbidden, and adding one belongs in src/constants/journal.js too", len(FeelingIDs))
	}
	// The one this app exists for: something is there and cannot be named.
	if !IsFeelingID("unclear") {
		t.Error("Expected \"unclear\" to be a feeling id")
	}
	for _, id := range FeelingIDs {
		if !IsFeelingID(id) {
			t.Errorf("Expected IsFeelingID(%q) to be true", id)
		}
	}
	assertRejectsTheUsualSuspects(t, "IsFeelingID", IsFeelingID, FeelingIDs[0])
}

func TestRitualQuestionIDsCoverCoreAndOptional(t *testing.T) {
	if len(RitualQuestionIDs) != 13 {
		t.Fatalf("Expected 13 ritual question ids (5 core + 8 optional), got %d", len(RitualQuestionIDs))
	}
	for _, id := range RitualQuestionIDs {
		if !IsRitualQuestionID(id) {
			t.Errorf("Expected IsRitualQuestionID(%q) to be true", id)
		}
	}
	for _, id := range []string{"slept_well", "ate_regularly", "alcohol", "cycle", "water"} {
		if !IsRitualQuestionID(id) {
			t.Errorf("Expected %q to be a ritual question id", id)
		}
	}
	assertRejectsTheUsualSuspects(t, "IsRitualQuestionID", IsRitualQuestionID, RitualQuestionIDs[0])
}

func TestJournalKindsAreTheFourEntryKinds(t *testing.T) {
	expected := []string{"checkin", "ritual", "person_fact", "trigger"}
	if len(JournalKinds) != len(expected) {
		t.Fatalf("Expected %d journal kinds, got %d", len(expected), len(JournalKinds))
	}
	for _, kind := range expected {
		if !IsJournalKind(kind) {
			t.Errorf("Expected IsJournalKind(%q) to be true", kind)
		}
	}
	assertRejectsTheUsualSuspects(t, "IsJournalKind", IsJournalKind, expected[0])
}

func assertRejectsTheUsualSuspects(t *testing.T, name string, is func(string) bool, valid string) {
	t.Helper()
	capitalised := strings.ToUpper(valid[:1]) + valid[1:]
	for _, id := range []string{"", "not_a_real_id", strings.ToUpper(valid), capitalised, " " + valid, valid + " "} {
		if is(id) {
			t.Errorf("Expected %s(%q) to be false", name, id)
		}
	}
}
