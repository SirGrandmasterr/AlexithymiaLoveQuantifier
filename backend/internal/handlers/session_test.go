package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"alexithymia-backend/internal/auth"
	"alexithymia-backend/internal/database"
	"alexithymia-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// postJSON routes one request through a fresh router carrying just the handler under test.
func postJSON(t *testing.T, path string, handler gin.HandlerFunc, body any) *httptest.ResponseRecorder {
	t.Helper()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST(path, handler)

	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}

	req, _ := http.NewRequest(http.MethodPost, path, bytes.NewReader(encoded))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func decodeSession(t *testing.T, w *httptest.ResponseRecorder) sessionPayload {
	t.Helper()

	var payload sessionPayload
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode session payload from %q: %v", w.Body.String(), err)
	}
	return payload
}

func signedUpUser(t *testing.T, db *gorm.DB, email, password string) models.User {
	t.Helper()

	t.Setenv("JWT_SECRET", "test-secret-for-sessions")
	if err := auth.LoadSecret(); err != nil {
		t.Fatalf("LoadSecret: %v", err)
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}

	user := models.User{Email: email, Password: hash}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return user
}

const testPassword = "correct horse battery"

func loginFor(t *testing.T, email string) sessionPayload {
	t.Helper()

	w := postJSON(t, "/api/login", Login, AuthInput{Email: email, Password: testPassword})
	if w.Code != http.StatusOK {
		t.Fatalf("login: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	return decodeSession(t, w)
}

func TestLogin_IssuesARefreshTokenStoredOnlyAsAHash(t *testing.T) {
	db := setupSQLiteDB(t)
	signedUpUser(t, db, "login@example.com", testPassword)

	session := loginFor(t, "login@example.com")
	if session.Token == "" || session.RefreshToken == "" {
		t.Fatalf("expected both halves of a session, got %+v", session)
	}
	if session.ExpiresIn != int(auth.AccessTokenTTL.Seconds()) {
		t.Errorf("expires_in = %d, want %d", session.ExpiresIn, int(auth.AccessTokenTTL.Seconds()))
	}

	var stored models.RefreshToken
	if err := db.First(&stored).Error; err != nil {
		t.Fatalf("expected a stored refresh token: %v", err)
	}
	if stored.TokenHash == session.RefreshToken {
		t.Error("the refresh token was stored verbatim; a leaked table would be every account in it")
	}
	if stored.TokenHash != auth.HashRefreshToken(session.RefreshToken) {
		t.Error("stored hash does not match the issued token")
	}
	if !stored.ExpiresAt.After(time.Now()) {
		t.Error("stored refresh token is already expired")
	}
}

func TestRefresh_RotatesAndRetiresTheTokenItConsumed(t *testing.T) {
	db := setupSQLiteDB(t)
	user := signedUpUser(t, db, "rotate@example.com", testPassword)

	first := loginFor(t, "rotate@example.com")

	w := postJSON(t, "/api/refresh", Refresh, refreshInput{RefreshToken: first.RefreshToken})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	second := decodeSession(t, w)
	if second.RefreshToken == first.RefreshToken {
		t.Fatal("refresh returned the same token; nothing was rotated")
	}
	if second.Token == "" {
		t.Fatal("refresh returned no access token")
	}

	var consumed models.RefreshToken
	if err := db.Where("token_hash = ?", auth.HashRefreshToken(first.RefreshToken)).First(&consumed).Error; err != nil {
		t.Fatalf("consumed row should still exist: %v", err)
	}
	if consumed.RevokedAt == nil {
		t.Error("the consumed refresh token was left usable")
	}

	claims, err := auth.ValidateToken(second.Token)
	if err != nil {
		t.Fatalf("renewed access token does not validate: %v", err)
	}
	if claims.UserID != user.ID {
		t.Errorf("renewed token names user %d, want %d", claims.UserID, user.ID)
	}
}

func TestRefresh_ReplayRevokesEveryTokenTheUserHolds(t *testing.T) {
	db := setupSQLiteDB(t)
	signedUpUser(t, db, "replay@example.com", testPassword)

	first := loginFor(t, "replay@example.com")
	second := decodeSession(t, postJSON(t, "/api/refresh", Refresh, refreshInput{RefreshToken: first.RefreshToken}))

	// The stolen copy, presented after the real client has already rotated past it.
	replay := postJSON(t, "/api/refresh", Refresh, refreshInput{RefreshToken: first.RefreshToken})
	if replay.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for a replayed token, got %d", replay.Code)
	}

	// Neither holder can be told from the other, so neither keeps its session.
	after := postJSON(t, "/api/refresh", Refresh, refreshInput{RefreshToken: second.RefreshToken})
	if after.Code != http.StatusUnauthorized {
		t.Fatalf("expected the whole family to be revoked, got %d for the live token", after.Code)
	}

	var live int64
	db.Model(&models.RefreshToken{}).Where("revoked_at IS NULL").Count(&live)
	if live != 0 {
		t.Errorf("%d refresh tokens survived reuse detection, want 0", live)
	}
}

func TestRefresh_RejectsAnExpiredToken(t *testing.T) {
	db := setupSQLiteDB(t)
	signedUpUser(t, db, "stale@example.com", testPassword)

	session := loginFor(t, "stale@example.com")

	db.Model(&models.RefreshToken{}).
		Where("token_hash = ?", auth.HashRefreshToken(session.RefreshToken)).
		Update("expires_at", time.Now().Add(-time.Minute))

	w := postJSON(t, "/api/refresh", Refresh, refreshInput{RefreshToken: session.RefreshToken})
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for an expired refresh token, got %d", w.Code)
	}
}

func TestRefresh_RejectsAnUnknownToken(t *testing.T) {
	setupSQLiteDB(t)

	w := postJSON(t, "/api/refresh", Refresh, refreshInput{RefreshToken: "not-a-token-anyone-issued"})
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestRefresh_RejectsATokenWhoseUserIsGone(t *testing.T) {
	db := setupSQLiteDB(t)
	user := signedUpUser(t, db, "ghost@example.com", testPassword)

	session := loginFor(t, "ghost@example.com")

	if err := db.Unscoped().Delete(&models.User{}, user.ID).Error; err != nil {
		t.Fatalf("delete user: %v", err)
	}

	w := postJSON(t, "/api/refresh", Refresh, refreshInput{RefreshToken: session.RefreshToken})
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for a token naming a deleted account, got %d", w.Code)
	}
}

func TestLogout_EndsTheSessionForGood(t *testing.T) {
	db := setupSQLiteDB(t)
	signedUpUser(t, db, "bye@example.com", testPassword)

	session := loginFor(t, "bye@example.com")

	w := postJSON(t, "/api/logout", Logout, refreshInput{RefreshToken: session.RefreshToken})
	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// Signing out on a phone must not be undoable by a two-month-old credential still
	// sitting in its storage.
	after := postJSON(t, "/api/refresh", Refresh, refreshInput{RefreshToken: session.RefreshToken})
	if after.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 after logout, got %d", after.Code)
	}

	var live int64
	db.Model(&models.RefreshToken{}).Where("revoked_at IS NULL").Count(&live)
	if live != 0 {
		t.Errorf("%d refresh tokens still live after logout, want 0", live)
	}
}

// Housekeeping, asserted because it is the only bound on a table that otherwise only grows.
func TestIssueSession_SweepsExpiredRowsForTheUser(t *testing.T) {
	db := setupSQLiteDB(t)
	user := signedUpUser(t, db, "sweep@example.com", testPassword)

	if err := db.Create(&models.RefreshToken{
		UserID:    user.ID,
		TokenHash: "long-dead",
		ExpiresAt: time.Now().Add(-auth.RefreshTokenTTL),
	}).Error; err != nil {
		t.Fatalf("seed expired token: %v", err)
	}

	if _, err := issueSession(database.DB, user.ID); err != nil {
		t.Fatalf("issueSession: %v", err)
	}

	var remaining int64
	db.Model(&models.RefreshToken{}).Where("token_hash = ?", "long-dead").Count(&remaining)
	if remaining != 0 {
		t.Error("an expired refresh token survived the sweep")
	}
}
