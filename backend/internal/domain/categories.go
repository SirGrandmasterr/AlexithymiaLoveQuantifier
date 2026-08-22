package domain

// CategoryIDs is the stable stats-key contract shared with the frontend
// (CATEGORIES in src/components/Dashboard.jsx). IDs only — all prose,
// colors, and metrics remain frontend-owned by design.
var CategoryIDs = []string{"eros", "ludus", "storge", "pragma", "mania", "agape", "selflessness"}

// IsCategoryID reports whether id is one of the seven known stats keys.
//
// Through containsID (journal.go), which is the same loop this function used to spell out
// and which now answers for four id vocabularies in this package. The comparison is exact
// and case-sensitive on purpose — see that function.
func IsCategoryID(id string) bool { return containsID(CategoryIDs, id) }
