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

	// Public routes
	r.POST("/api/signup", handlers.Signup)
	r.POST("/api/login", handlers.Login)

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

		// The vault: take everything out, put everything back, and see what is stored.
		protected.GET("/export", handlers.ExportVault)
		protected.POST("/import", handlers.ImportVault)
		protected.GET("/meta", handlers.GetMeta)
	}

	log.Println("Server starting on port 8080...")
	r.Run(":8080")
}
