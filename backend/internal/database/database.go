package database

import (
	"fmt"
	"log"
	"os"

	"alexithymia-backend/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func Connect() {
	var err error

	if os.Getenv("DB_HOST") == "" {
		log.Println("No DB_HOST provided, falling back to local SQLite database: alexithymia.db")
		DB, err = gorm.Open(sqlite.Open("alexithymia.db"), &gorm.Config{})
		if err != nil {
			log.Fatalf("Failed to connect to local SQLite database: %v", err)
		}
	} else {
		dsn := fmt.Sprintf(
			"host=%s user=%s password=%s dbname=%s port=%s sslmode=disable TimeZone=UTC",
			os.Getenv("DB_HOST"),
			os.Getenv("DB_USER"),
			os.Getenv("DB_PASSWORD"),
			os.Getenv("DB_NAME"),
			os.Getenv("DB_PORT"),
		)
		DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err != nil {
			log.Fatalf("Failed to connect to postgres database: %v", err)
		}
	}

	log.Println("Database connection established")

	log.Println("Running migrations...")
	err = DB.AutoMigrate(&models.User{}, &models.AnalysisSubject{})
	if err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}
	log.Println("Database migrated")
}
