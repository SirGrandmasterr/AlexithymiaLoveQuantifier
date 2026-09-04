package main

import (
	"alexithymia-backend/internal/auth"
	"alexithymia-backend/internal/database"
	"alexithymia-backend/internal/handlers"
	"log"

	"github.com/gin-gonic/gin"
)

func main() {
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

		protected.GET("/relationships", handlers.GetRelationships)
		protected.PATCH("/relationships/:id", handlers.UpdateRelationship)
		protected.POST("/relationships/:id/merge", handlers.MergeRelationship)
		protected.DELETE("/relationships/:id", handlers.DeleteRelationship)

		protected.POST("/journal/entries", handlers.CreateJournalEntry)
		protected.GET("/journal/entries", handlers.GetJournalEntries)
		protected.DELETE("/journal/entries/:id", handlers.DeleteJournalEntry)
		protected.GET("/journal/days", handlers.GetJournalDays)
		protected.DELETE("/journal/people/:id", handlers.DeleteJournalPerson)

		// The vault: take everything out, put everything back, and see what is stored.
		protected.GET("/export", handlers.ExportVault)
		protected.POST("/import", handlers.ImportVault)
		protected.GET("/meta", handlers.GetMeta)
	}

	log.Println("Server starting on port 8080...")
	r.Run(":8080")
}
