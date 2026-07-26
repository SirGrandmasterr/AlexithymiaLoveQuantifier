package handlers

import (
	"errors"
	"net/http"
	"strings"

	"alexithymia-backend/internal/auth"
	"alexithymia-backend/internal/database"
	"alexithymia-backend/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization header format"})
			c.Abort()
			return
		}

		tokenString := parts[1]
		claims, err := auth.ValidateToken(tokenString)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			c.Abort()
			return
		}

		// A signature is not an account. A token stays valid for its full lifetime even
		// after the user row behind it is gone — a dropped volume, a `down -v`, a deleted
		// account — and every protected route then runs for a user id that names nobody.
		// The symptom is not an error page but a working-looking one: /me answered 404
		// ("failed to load profile data") and the list endpoints answered `[]`, neither of
		// which any client can act on, while the browser held a token it would keep sending
		// forever. 401 is the honest answer, and it is the one the frontend's response
		// interceptor already handles by clearing the token and returning to the landing
		// page.
		var user models.User
		if err := database.DB.Select("id").First(&user, claims.UserID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			} else {
				// A database that is down is not a failed login; saying 401 here would
				// sign every user out over a blip.
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify session"})
			}
			c.Abort()
			return
		}

		c.Set("userID", claims.UserID)
		c.Next()
	}
}
