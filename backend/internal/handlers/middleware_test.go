package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"alexithymia-backend/internal/auth"
	"alexithymia-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// callProtected routes a request through the real AuthMiddleware — the other handler tests
// stub the middleware out by setting userID directly, so this is the only place the header
// parsing and the account check are actually exercised.
func callProtected(t *testing.T, authHeader string) *httptest.ResponseRecorder {
	t.Helper()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(AuthMiddleware())
	r.GET("/protected", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"userID": c.GetUint("userID")})
	})

	req, _ := http.NewRequest(http.MethodGet, "/protected", nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// tokenFor signs a real token for userID, whether or not that user exists.
func tokenFor(t *testing.T, userID uint) string {
	t.Helper()

	t.Setenv("JWT_SECRET", "test-secret-for-middleware")
	if err := auth.LoadSecret(); err != nil {
		t.Fatalf("LoadSecret: %v", err)
	}
	token, err := auth.GenerateToken(userID)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	return token
}

func TestAuthMiddleware_AcceptsTokenForExistingUser(t *testing.T) {
	db := setupSQLiteDB(t)
	user := models.User{Email: "present@example.com", Password: "hash"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}

	w := callProtected(t, "Bearer "+tokenFor(t, user.ID))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for a live account, got %d: %s", w.Code, w.Body.String())
	}
}

// The regression this file exists for: a token that is perfectly valid but names a user row
// that no longer exists — a dropped volume, a `docker compose down -v`, a deleted account.
// Before, the token sailed through and /me answered 404 while the list endpoints answered
// `[]`, leaving the browser holding a token it would keep sending forever. 401 is what the
// frontend's response interceptor watches for.
func TestAuthMiddleware_RejectsTokenForDeletedUser(t *testing.T) {
	setupSQLiteDB(t) // migrated, but with no users in it

	w := callProtected(t, "Bearer "+tokenFor(t, 1))

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for a token naming no user, got %d: %s", w.Code, w.Body.String())
	}
}

// A soft-deleted user is deleted: gorm.Model's default scope hides the row, and the session
// should end with it rather than continuing against an account the user closed.
func TestAuthMiddleware_RejectsTokenForSoftDeletedUser(t *testing.T) {
	db := setupSQLiteDB(t)
	user := models.User{Email: "gone@example.com", Password: "hash"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if err := db.Delete(&user).Error; err != nil {
		t.Fatalf("soft-delete user: %v", err)
	}

	w := callProtected(t, "Bearer "+tokenFor(t, user.ID))

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for a soft-deleted account, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthMiddleware_RejectsMalformedHeaders(t *testing.T) {
	setupSQLiteDB(t)
	valid := tokenFor(t, 1)

	cases := []struct {
		name   string
		header string
	}{
		{"absent", ""},
		{"no scheme", valid},
		{"wrong scheme", "Basic " + valid},
		{"too many parts", "Bearer " + valid + " extra"},
		{"garbage token", "Bearer not-a-jwt"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if w := callProtected(t, tc.header); w.Code != http.StatusUnauthorized {
				t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}
