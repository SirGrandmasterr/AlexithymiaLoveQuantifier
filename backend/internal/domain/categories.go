package domain

// CategoryIDs is the stable stats-key contract shared with the frontend
// (CATEGORIES in src/components/Dashboard.jsx). IDs only — all prose,
// colors, and metrics remain frontend-owned by design.
var CategoryIDs = []string{"eros", "ludus", "storge", "pragma", "mania", "agape", "selflessness"}

// IsCategoryID reports whether id is one of the seven known stats keys.
func IsCategoryID(id string) bool {
	for _, c := range CategoryIDs {
		if c == id {
			return true
		}
	}
	return false
}
