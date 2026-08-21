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

// Models is every table AutoMigrate owns, in dependency order. The migrate command reads
// the same list, so `make migrate-check` can only ever disagree with the server about
// schema shape if the models themselves changed.
func Models() []interface{} {
	return []interface{}{&models.User{}, &models.Relationship{}, &models.AnalysisSubject{}, &models.RefreshToken{}}
}

// Open dials the configured database and sets DB, without touching the schema. Split out
// from Connect so the migrate command can inspect a live database — `-check` must be able
// to report drift without creating the very columns it is checking for.
func Open() (*gorm.DB, error) {
	var db *gorm.DB
	var err error

	if os.Getenv("DB_HOST") == "" {
		log.Println("No DB_HOST provided, falling back to local SQLite database: alexithymia.db")
		db, err = gorm.Open(sqlite.Open("alexithymia.db"), &gorm.Config{})
		if err != nil {
			return nil, fmt.Errorf("connect to local SQLite database: %w", err)
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
		db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err != nil {
			return nil, fmt.Errorf("connect to postgres database: %w", err)
		}
	}

	DB = db
	log.Println("Database connection established")
	return db, nil
}

// Migrate brings the schema up to the models and links any legacy rows. It is what the
// server runs on boot and what `make migrate` runs standalone — one code path, so a
// migration cannot succeed under one and fail under the other.
func Migrate(db *gorm.DB) error {
	log.Println("Running migrations...")
	if err := db.AutoMigrate(Models()...); err != nil {
		return fmt.Errorf("migrate database: %w", err)
	}
	log.Println("Database migrated")

	// Idempotent, so it runs on every boot: the first one after upgrading links the
	// existing snapshots, every one after that reports zero. Back up the database before
	// the first run — see docs/09-deployment.md.
	result, err := BackfillRelationships(db)
	if err != nil {
		return fmt.Errorf("backfill relationships: %w", err)
	}
	log.Printf("backfill: %d relationships, %d snapshots linked", result.Relationships, result.Snapshots)
	return nil
}

func Connect() {
	db, err := Open()
	if err != nil {
		log.Fatalf("Failed to %v", err)
	}
	if err := Migrate(db); err != nil {
		log.Fatalf("Failed to %v", err)
	}
}
