package main

import (
	"alexithymia-backend/internal/database"
	"alexithymia-backend/internal/handlers"
	"log"

	"github.com/gin-gonic/gin"
)

func main() {
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
	}

	log.Println("Server starting on port 8080...")
	r.Run(":8080")
}
