// Command migrate applies — or merely checks — the database schema, using the exact same
// AutoMigrate call the server makes on boot.
//
// The server migrating itself is convenient but invisible: a schema that failed to move
// shows up as a 500 from some unrelated endpoint, hours later, with an error message about
// a column rather than about a migration. This command makes the step addressable on its
// own, so it can run before the server (`make migrate`), and so CI or a deploy can ask
// "does this database match the models?" without writing to it (`make migrate-check`).
//
// Connection settings come from the same DB_* environment variables as the server; with
// DB_HOST unset both fall back to the local SQLite file.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"alexithymia-backend/internal/database"

	"gorm.io/gorm"
)

func main() {
	check := flag.Bool("check", false, "report schema drift and exit non-zero; never writes")
	flag.Parse()

	log.SetFlags(0)

	db, err := database.Open()
	if err != nil {
		log.Fatalf("migrate: %v", err)
	}

	if *check {
		drift, err := findDrift(db)
		if err != nil {
			log.Fatalf("migrate: check schema: %v", err)
		}
		if len(drift) > 0 {
			fmt.Fprintf(os.Stderr, "migrate: schema is behind the models:\n  %s\n", strings.Join(drift, "\n  "))
			fmt.Fprintln(os.Stderr, "run 'make migrate' to apply")
			os.Exit(1)
		}
		fmt.Println("migrate: schema is up to date")
		return
	}

	if err := database.Migrate(db); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	fmt.Println("migrate: done")
}

// findDrift lists tables and columns the models declare but the database does not have.
//
// It is deliberately one-directional: a column in the database with no field behind it is
// left over from a removed field, which AutoMigrate never drops either, and reporting it
// would make `-check` fail on every database that has ever been rolled back. Type and
// nullability changes are also out of scope — AutoMigrate's own handling of those differs
// per engine, so a check that claimed to cover them would be lying.
func findDrift(db *gorm.DB) ([]string, error) {
	migrator := db.Migrator()
	var drift []string

	for _, model := range database.Models() {
		stmt := &gorm.Statement{DB: db}
		if err := stmt.Parse(model); err != nil {
			return nil, fmt.Errorf("parse model %T: %w", model, err)
		}
		table := stmt.Schema.Table

		if !migrator.HasTable(model) {
			drift = append(drift, fmt.Sprintf("missing table %q", table))
			continue
		}

		for _, field := range stmt.Schema.Fields {
			// Fields with no DBName are associations (AnalysisSubject.Relationship),
			// not columns of this table.
			if field.DBName == "" {
				continue
			}
			if !migrator.HasColumn(model, field.DBName) {
				drift = append(drift, fmt.Sprintf("missing column %s.%s", table, field.DBName))
			}
		}
	}

	return drift, nil
}
