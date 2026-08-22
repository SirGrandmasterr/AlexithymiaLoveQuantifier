package main

import (
	"alexithymia-backend/internal/auth"
	"alexithymia-backend/internal/database"
	"alexithymia-backend/internal/handlers"
	"log"

	"github.com/gin-gonic/gin"
)

func main() {
	// Before anything else: an unset JWT_SECRET is not a degraded mode, it is an open
	// door. Refusing to start is the only honest response — and the Vault page tells
	// users their data is private, which would be a lie above forgeable tokens.
	if err := auth.LoadSecret(); err != nil {
		log.Fatal(err)
	}

	// Initialize database connection
	database.Connect()

	r := gin.Default()

	// Enable CORS for cross-subdomain and mobile client access
	r.Use(handlers.CORSMiddleware())

	// Public routes
	r.POST("/api/signup", handlers.Signup)
	r.POST("/api/login", handlers.Login)
	// Both are public because the access token they concern is, by the time they are
	// called, expired. The refresh token is the credential; see internal/handlers/session.go.
	r.POST("/api/refresh", handlers.Refresh)
	r.POST("/api/logout", handlers.Logout)

	// Serve uploaded files statically
	r.Static("/uploads", "./uploads")

	// Protected routes
	protected := r.Group("/api")
	protected.Use(handlers.AuthMiddleware())
	{
		protected.GET("/me", handlers.GetUserProfile)
		protected.PUT("/me", handlers.UpdateUserProfile)
		protected.POST("/upload", handlers.UploadProfilePicture)
		protected.GET("/subjects", handlers.GetSubjects)
		protected.POST("/subjects", handlers.CreateSubject)
		protected.PUT("/subjects/:id", handlers.UpdateSubject)
		protected.DELETE("/subjects/:id", handlers.DeleteSubject)

		// The stack as a whole: rename and merge act on every version at once, and
		// DELETE here removes the entire history rather than one version.
		protected.GET("/relationships", handlers.GetRelationships)
		protected.PATCH("/relationships/:id", handlers.UpdateRelationship)
		protected.POST("/relationships/:id/merge", handlers.MergeRelationship)
		protected.DELETE("/relationships/:id", handlers.DeleteRelationship)

		// The emotional journal: one append-only write path. A correction is a POST
		// carrying supersedes_id, which is why there is no PUT here.
		protected.POST("/journal/entries", handlers.CreateJournalEntry)
		protected.GET("/journal/entries", handlers.GetJournalEntries)
		protected.DELETE("/journal/entries/:id", handlers.DeleteJournalEntry)
		protected.GET("/journal/days", handlers.GetJournalDays)
		// Everything the journal holds *about* one person, removed in one action (§10.6).
		// Not a relationship route: it leaves the relationship and its snapshots alone.
		protected.DELETE("/journal/people/:id", handlers.DeleteJournalPerson)

		// The vault: take everything out, put everything back, and see what is stored.
		protected.GET("/export", handlers.ExportVault)
		protected.POST("/import", handlers.ImportVault)
		protected.GET("/meta", handlers.GetMeta)
	}

	log.Println("Server starting on port 8080...")
	r.Run(":8080")
}
