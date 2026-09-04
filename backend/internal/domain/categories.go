package domain

var CategoryIDs = []string{"eros", "ludus", "storge", "pragma", "mania", "agape", "selflessness"}

func IsCategoryID(id string) bool { return containsID(CategoryIDs, id) }
