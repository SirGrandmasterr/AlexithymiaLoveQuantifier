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

type sessionPayload struct {
	Token        string `json:"token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

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

func revokeAllForUser(db *gorm.DB, userID uint) {
	now := time.Now()
	db.Model(&models.RefreshToken{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Update("revoked_at", now)
}

type refreshInput struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

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
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify session"})
		}
		return
	}

	if record.RevokedAt != nil {
		revokeAllForUser(database.DB, record.UserID)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Session expired. Please sign in again."})
		return
	}

	if time.Now().After(record.ExpiresAt) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Session expired. Please sign in again."})
		return
	}

	var user models.User
	if err := database.DB.Select("id").First(&user, record.UserID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Session expired. Please sign in again."})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify session"})
		}
		return
	}

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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to renew session"})
		return
	}

	c.JSON(http.StatusOK, payload)
}

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
