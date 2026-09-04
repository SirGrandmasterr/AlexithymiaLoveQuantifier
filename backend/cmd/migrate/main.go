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
