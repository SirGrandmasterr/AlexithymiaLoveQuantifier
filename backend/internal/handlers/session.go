package handlers

import (
	"errors"
	"net/http"
	"time"

	"alexithymia-backend/internal/auth"
	"alexithymia-backend/internal/database"
	"alexithymia-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Session issuing and renewal.
//
// The problem this solves is a user-visible one. An access token lives 24 hours and nothing
// could renew it, so every client eventually met "Invalid or expired token" — the web app
// dropped to the landing page mid-task and the Android app, which is resumed rather than
// reloaded for weeks at a time, met it constantly. The token was not wrong; the absence of a
// renewal path was.
//
// The shape is the standard one: a short stateless access token for every request, and a
// long opaque refresh token, stored hashed, that buys a new pair. What it explicitly is not
// is the literal reading of "reuse the last login data" — storing the password on the device
// and replaying it. A refresh token is that idea with the two properties a stored password
// can never have: the server can revoke it, and rotation makes a stolen copy detectable.

// sessionPayload is what /api/login and /api/refresh both answer with. `expires_in` is
// seconds, so a client can renew *before* a request fails rather than after — the
// difference between a session that never visibly expires and one that recovers loudly.
type sessionPayload struct {
	Token        string `json:"token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

// issueSession mints an access/refresh pair and records the refresh half.
//
// Expired rows for this user are swept here rather than by a scheduler: the table only
// grows through this function, so the cheapest correct place to bound it is the moment it
// grows. A sweep failure is logged into the error return of nothing — it is deliberately
// ignored, because failing a valid sign-in over housekeeping would be the worse bug.
func issueSession(db *gorm.DB, userID uint) (sessionPayload, error) {
	accessToken, err := auth.GenerateToken(userID)
	if err != nil {
		return sessionPayload{}, err
	}

	refreshToken, err := auth.NewRefreshToken()
	if err != nil {
		return sessionPayload{}, err
	}

	record := models.RefreshToken{
		UserID:    userID,
		TokenHash: auth.HashRefreshToken(refreshToken),
		ExpiresAt: time.Now().Add(auth.RefreshTokenTTL),
	}
	if err := db.Create(&record).Error; err != nil {
		return sessionPayload{}, err
	}

	db.Where("user_id = ? AND expires_at < ?", userID, time.Now()).Delete(&models.RefreshToken{})

	return sessionPayload{
		Token:        accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    int(auth.AccessTokenTTL.Seconds()),
	}, nil
}

// revokeAllForUser is the answer to a replayed token: the client that presented it and the
// one that legitimately rotated past it cannot be told apart, so neither is trusted.
func revokeAllForUser(db *gorm.DB, userID uint) {
	now := time.Now()
	db.Model(&models.RefreshToken{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Update("revoked_at", now)
}

type refreshInput struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

// Refresh exchanges a refresh token for a new pair, rotating the one it consumed.
//
// It is a public route by necessity: the access token it is being asked to replace is, in
// the ordinary case, already expired. That makes the refresh token the only credential
// presented, which is why every failure below answers 401 with the same sentence — a
// caller guessing at tokens learns nothing about which guess was closer.
func Refresh(c *gin.Context) {
	var input refreshInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var record models.RefreshToken
	err := database.DB.Where("token_hash = ?", auth.HashRefreshToken(input.RefreshToken)).First(&record).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Session expired. Please sign in again."})
		} else {
			// A database blip is not a rejected session. Saying 401 here would sign every
			// client out over an outage — the same distinction AuthMiddleware draws.
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify session"})
		}
		return
	}

	// A revoked row that is presented again is a token used twice: either a replay of one
	// this client already rotated past, or a stolen copy racing the real client. Both mean
	// the family is compromised.
	if record.RevokedAt != nil {
		revokeAllForUser(database.DB, record.UserID)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Session expired. Please sign in again."})
		return
	}

	if time.Now().After(record.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Session expired. Please sign in again."})
		return
	}

	// The same check AuthMiddleware makes, for the same reason: a session outlives the
	// account behind it when a volume is dropped or a user deleted, and renewing it would
	// hand out a token that names nobody.
	var user models.User
	if err := database.DB.Select("id").First(&user, record.UserID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Session expired. Please sign in again."})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify session"})
		}
		return
	}

	// Claim the token before spending it, in one conditional UPDATE.
	//
	// The read above is not enough on its own: two requests carrying the same token can both
	// pass it and both go on to issue a session, which is precisely the reuse this design
	// exists to catch. `revoked_at IS NULL` in the WHERE clause makes the claim atomic, so
	// exactly one caller can ever rotate a given token — and the loser is treated as what it
	// is indistinguishable from, a replay.
	claim := database.DB.Model(&models.RefreshToken{}).
		Where("id = ? AND revoked_at IS NULL", record.ID).
		Update("revoked_at", time.Now())
	if claim.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to renew session"})
		return
	}
	if claim.RowsAffected == 0 {
		revokeAllForUser(database.DB, record.UserID)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Session expired. Please sign in again."})
		return
	}

	payload, err := issueSession(database.DB, record.UserID)
	if err != nil {
		// The consumed token is already dead, so this session cannot be recovered — but
		// nothing has been handed out either, and the client's next step is to sign in.
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to renew session"})
		return
	}

	c.JSON(http.StatusOK, payload)
}

// Logout revokes one refresh token, so signing out on a phone cannot be undone by a
// two-month-old credential still sitting in its storage.
//
// Public, and deliberately quiet: it answers 204 whether or not the token existed. There is
// nothing useful a caller could do with the difference, and the client's next step — clear
// local state — is the same either way, including when it is offline and this never arrives.
func Logout(c *gin.Context) {
	var input refreshInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.Status(http.StatusNoContent)
		return
	}

	now := time.Now()
	database.DB.Model(&models.RefreshToken{}).
		Where("token_hash = ? AND revoked_at IS NULL", auth.HashRefreshToken(input.RefreshToken)).
		Update("revoked_at", now)

	c.Status(http.StatusNoContent)
}
