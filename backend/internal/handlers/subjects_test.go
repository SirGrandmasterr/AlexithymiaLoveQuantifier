package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"alexithymia-backend/internal/database"
	"alexithymia-backend/internal/models"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// validStats uses real category ids — arbitrary keys are rejected since Phase 1.
var validStats = map[string]int{"eros": 85, "mania": 60}

// setupMockDB initializes a mocked GORM DB and returns it along with the mock observer.
func setupMockDB(t *testing.T) (sqlmock.Sqlmock, *gorm.DB) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("Failed to create sqlmock: %v", err)
	}

	dialector := postgres.New(postgres.Config{
		Conn:       db,
		DriverName: "postgres",
	})

	gormDB, err := gorm.Open(dialector, &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("Failed to initialize gorm DB: %v", err)
	}

	return mock, gormDB
}

// expectFindOrCreateRelationship mocks the resolution the write path runs before it
// touches analysis_subjects. `found` picks between reusing an existing relationship and
// creating one; either way the write ends up pointing at relationship 7.
func expectFindOrCreateRelationship(mock sqlmock.Sqlmock, found bool) {
	lookup := mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "relationships"`))
	if found {
		lookup.WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "name"}).AddRow(7, 1, "Alex"))
		return
	}
	// An empty result set is what makes GORM's First report ErrRecordNotFound.
	lookup.WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "name"}))
	mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO "relationships"`)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(7))
}

// setupGinTestRouter sets up a Gin router with a given user ID injected into the context.
func setupGinTestRouter(handler gin.HandlerFunc, userID uint, authenticated bool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()

	r.Use(func(c *gin.Context) {
		if authenticated {
			c.Set("userID", userID)
		}
		c.Next()
	})

	return r
}

func TestCreateSubject(t *testing.T) {
	tests := []struct {
		name           string
		authenticated  bool
		userID         uint
		requestBody    interface{}
		mockBehavior   func(sqlmock.Sqlmock)
		expectedStatus int
		expectedError  string
	}{
		{
			name:          "Valid Request",
			authenticated: true,
			userID:        1,
			requestBody: CreateSubjectInput{
				Name:         "New Subject",
				Description:  "Test Description",
				Date:         "2023-10-25",
				Stats:        validStats,
				Tags:         []string{"conflict", "trip together"},
				Uncertain:    []string{"mania"},
				GuideAnswers: map[string]map[string]int{"eros": {"0": 2, "1": 3}},
			},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				expectFindOrCreateRelationship(mock, false)
				mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO "analysis_subjects" ("created_at","updated_at","deleted_at","user_id","relationship_id","name","kind","description","date","stats","tags","uncertain","guide_answers") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING "id"`)).
					WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1, 7, "New Subject", "full", "Test Description", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
					WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
				mock.ExpectCommit()
			},
			expectedStatus: http.StatusCreated,
		},
		{
			name:          "Name Is Trimmed Server-Side",
			authenticated: true,
			userID:        1,
			requestBody:   map[string]interface{}{"name": "  Alex  "},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				expectFindOrCreateRelationship(mock, false)
				mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO "analysis_subjects"`)).
					WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1, 7, "Alex", "full", "", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
					WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
				mock.ExpectCommit()
			},
			expectedStatus: http.StatusCreated,
		},
		{
			// The compatibility contract: a name-only client still lands in the right
			// stack, and reusing an existing name creates no second relationship.
			name:          "Existing Name Reuses Its Relationship",
			authenticated: true,
			userID:        1,
			requestBody:   map[string]interface{}{"name": "  Alex  "},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				expectFindOrCreateRelationship(mock, true)
				mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO "analysis_subjects"`)).
					WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1, 7, "Alex", "full", "", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
					WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
				mock.ExpectCommit()
			},
			expectedStatus: http.StatusCreated,
		},
		{
			name:          "Partial Stats Are Accepted",
			authenticated: true,
			userID:        1,
			requestBody:   map[string]interface{}{"name": "Alex", "stats": map[string]int{"storge": 40}},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				expectFindOrCreateRelationship(mock, false)
				mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO "analysis_subjects"`)).
					WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
				mock.ExpectCommit()
			},
			expectedStatus: http.StatusCreated,
		},
		{
			name:           "Whitespace-Only Name",
			authenticated:  true,
			userID:         1,
			requestBody:    map[string]interface{}{"name": "   "},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "name is required",
		},
		{
			name:           "Unknown Stats Key",
			authenticated:  true,
			userID:         1,
			requestBody:    map[string]interface{}{"name": "Alex", "stats": map[string]int{"love": 5}},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "unknown stats key: love",
		},
		{
			name:           "Stats Value Above Range",
			authenticated:  true,
			userID:         1,
			requestBody:    map[string]interface{}{"name": "Alex", "stats": map[string]int{"eros": 101}},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "stats.eros must be between 0 and 100",
		},
		{
			name:           "Stats Value Below Range",
			authenticated:  true,
			userID:         1,
			requestBody:    map[string]interface{}{"name": "Alex", "stats": map[string]int{"agape": -1}},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "stats.agape must be between 0 and 100",
		},
		{
			name:           "Malformed Date",
			authenticated:  true,
			userID:         1,
			requestBody:    map[string]interface{}{"name": "Alex", "date": "2026-13-45"},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "invalid date, expected YYYY-MM-DD",
		},
		{
			name:           "Too Many Tags",
			authenticated:  true,
			userID:         1,
			requestBody:    map[string]interface{}{"name": "Alex", "tags": make([]string, 13)},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "too many tags, maximum is 12",
		},
		{
			name:           "Blank Tag",
			authenticated:  true,
			userID:         1,
			requestBody:    map[string]interface{}{"name": "Alex", "tags": []string{"conflict", "   "}},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "tags must not be empty",
		},
		{
			name:           "Overlong Tag",
			authenticated:  true,
			userID:         1,
			requestBody:    map[string]interface{}{"name": "Alex", "tags": []string{strings.Repeat("x", 41)}},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "tag exceeds 40 characters",
		},
		{
			name:           "Unknown Uncertain Category",
			authenticated:  true,
			userID:         1,
			requestBody:    map[string]interface{}{"name": "Alex", "stats": validStats, "uncertain": []string{"nope"}},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "unknown category id in uncertain: nope",
		},
		{
			name:           "Uncertain About An Unscored Category",
			authenticated:  true,
			userID:         1,
			requestBody:    map[string]interface{}{"name": "Alex", "stats": map[string]int{"eros": 40}, "uncertain": []string{"ludus"}},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "cannot mark ludus uncertain: it has no score",
		},
		{
			name:           "Unknown Guide Answer Category",
			authenticated:  true,
			userID:         1,
			requestBody:    map[string]interface{}{"name": "Alex", "guide_answers": map[string]map[string]int{"nope": {"0": 1}}},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "unknown category id in guide_answers: nope",
		},
		{
			name:           "Guide Answer Above Scale",
			authenticated:  true,
			userID:         1,
			requestBody:    map[string]interface{}{"name": "Alex", "guide_answers": map[string]map[string]int{"eros": {"0": 4}}},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "guide_answers.eros.0 must be between 0 and 3",
		},
		{
			name:           "Guide Answer With A Non-Index Key",
			authenticated:  true,
			userID:         1,
			requestBody:    map[string]interface{}{"name": "Alex", "guide_answers": map[string]map[string]int{"eros": {"spark": 1}}},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "guide_answers.eros has a non-index key: spark",
		},
		{
			name:          "Unauthorized",
			authenticated: false,
			userID:        0,
			requestBody: CreateSubjectInput{
				Name: "New Subject",
			},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Missing Required Fields",
			authenticated:  true,
			userID:         1,
			requestBody:    map[string]interface{}{"description": "missing name"},
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:          "Database Error",
			authenticated: true,
			userID:        1,
			requestBody: CreateSubjectInput{
				Name: "New Subject",
			},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				expectFindOrCreateRelationship(mock, false)
				mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO "analysis_subjects"`)).
					WillReturnError(errors.New("db connection failed"))
				mock.ExpectRollback()
			},
			expectedStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock, gormDB := setupMockDB(t)
			database.DB = gormDB // Inject global mock

			tt.mockBehavior(mock)

			r := setupGinTestRouter(CreateSubject, tt.userID, tt.authenticated)
			r.POST("/subjects", CreateSubject)

			jsonBody, _ := json.Marshal(tt.requestBody)
			req, _ := http.NewRequest(http.MethodPost, "/subjects", bytes.NewBuffer(jsonBody))
			req.Header.Set("Content-Type", "application/json")

			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d but got %d (body: %s)", tt.expectedStatus, w.Code, w.Body.String())
			}

			if tt.expectedError != "" && !strings.Contains(w.Body.String(), tt.expectedError) {
				t.Errorf("Expected error containing %q but got %s", tt.expectedError, w.Body.String())
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("Unmet sqlmock expectations: %s", err)
			}
		})
	}
}

// TestCreateSubjectPersistsContext asserts the context capsule survives the round trip.
func TestCreateSubjectPersistsContext(t *testing.T) {
	mock, gormDB := setupMockDB(t)
	database.DB = gormDB

	mock.ExpectBegin()
	expectFindOrCreateRelationship(mock, false)
	mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO "analysis_subjects"`)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
	mock.ExpectCommit()

	r := setupGinTestRouter(CreateSubject, 1, true)
	r.POST("/subjects", CreateSubject)

	body := `{"name":"Alex","description":"rough month","date":"2026-02-20",
	          "stats":{"mania":70},"tags":["  conflict  ","distance"],
	          "uncertain":["mania"],"guide_answers":{"mania":{"0":3,"2":1}}}`
	req, _ := http.NewRequest(http.MethodPost, "/subjects", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("Expected 201 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var created models.AnalysisSubject
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if created.Description != "rough month" {
		t.Errorf("Expected description to be stored, got %q", created.Description)
	}
	if len(created.Tags) != 2 || created.Tags[0] != "conflict" || created.Tags[1] != "distance" {
		t.Errorf("Expected trimmed tags [conflict distance], got %v", created.Tags)
	}
	if created.Date == nil || created.Date.Format(dateLayout) != "2026-02-20" {
		t.Errorf("Expected date 2026-02-20, got %v", created.Date)
	}
	if len(created.Uncertain) != 1 || created.Uncertain[0] != "mania" {
		t.Errorf("Expected uncertain [mania], got %v", created.Uncertain)
	}
	if created.GuideAnswers["mania"]["0"] != 3 || created.GuideAnswers["mania"]["2"] != 1 {
		t.Errorf("Expected guide answers to round-trip, got %v", created.GuideAnswers)
	}
	if created.RelationshipID == nil || *created.RelationshipID != 7 {
		t.Errorf("Expected the response to carry its relationship_id, got %v", created.RelationshipID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("Unmet sqlmock expectations: %s", err)
	}
}

func TestGetSubjects(t *testing.T) {
	tests := []struct {
		name           string
		query          string
		authenticated  bool
		userID         uint
		mockBehavior   func(sqlmock.Sqlmock)
		expectedStatus int
		expectedLen    int
	}{
		{
			// The ORDER BY is asserted here because it is a contract with the client:
			// `date IS NULL` first is the portable spelling of NULLS LAST.
			name:          "Valid Request - Returns List Newest First",
			authenticated: true,
			userID:        1,
			mockBehavior: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "user_id", "name", "description"}).
					AddRow(1, 1, "Subject 1", "Desc 1").
					AddRow(2, 1, "Subject 2", "Desc 2")
				mock.ExpectQuery(regexp.QuoteMeta(`ORDER BY date IS NULL,date DESC,id DESC`)).
					WithArgs(1).
					WillReturnRows(rows)
			},
			expectedStatus: http.StatusOK,
			expectedLen:    2,
		},
		{
			name:          "Filtered By Relationship",
			query:         "?relationship_id=7",
			authenticated: true,
			userID:        1,
			mockBehavior: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "user_id", "relationship_id", "name"}).
					AddRow(1, 1, 7, "Alex")
				mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
					WithArgs(1, 7).
					WillReturnRows(rows)
			},
			expectedStatus: http.StatusOK,
			expectedLen:    1,
		},
		{
			name:           "Non-Numeric Relationship Filter",
			query:          "?relationship_id=alex",
			authenticated:  true,
			userID:         1,
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Unauthorized",
			authenticated:  false,
			userID:         0,
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusUnauthorized,
			expectedLen:    0, // Not applicable
		},
		{
			name:          "Database Error",
			authenticated: true,
			userID:        1,
			mockBehavior: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
					WithArgs(1).
					WillReturnError(errors.New("db retrieval error"))
			},
			expectedStatus: http.StatusInternalServerError,
			expectedLen:    0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock, gormDB := setupMockDB(t)
			database.DB = gormDB

			tt.mockBehavior(mock)

			r := setupGinTestRouter(GetSubjects, tt.userID, tt.authenticated)
			r.GET("/subjects", GetSubjects)

			req, _ := http.NewRequest(http.MethodGet, "/subjects"+tt.query, nil)

			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d but got %d", tt.expectedStatus, w.Code)
			}

			if w.Code == http.StatusOK {
				var response []models.AnalysisSubject
				if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
					t.Fatalf("Failed to parse response: %v", err)
				}
				if len(response) != tt.expectedLen {
					t.Errorf("Expected length %d but got %d", tt.expectedLen, len(response))
				}
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("Unmet sqlmock expectations: %s", err)
			}
		})
	}
}

func TestUpdateSubject(t *testing.T) {
	dateStr := "2023-11-01"
	parsedDate, _ := time.Parse(dateLayout, dateStr)

	tests := []struct {
		name           string
		subjectID      string
		authenticated  bool
		userID         uint
		requestBody    interface{}
		mockBehavior   func(sqlmock.Sqlmock)
		expectedStatus int
		expectedError  string
	}{
		{
			name:          "Valid Request",
			subjectID:     "1",
			authenticated: true,
			userID:        1,
			requestBody: map[string]interface{}{
				"name":          "Updated Subject",
				"description":   "Updated Desc",
				"date":          dateStr,
				"stats":         map[string]int{"eros": 10},
				"tags":          []string{"milestone"},
				"uncertain":     []string{"eros"},
				"guide_answers": map[string]map[string]int{"eros": {"0": 1}},
			},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				// Mocks for First()
				rows := sqlmock.NewRows([]string{"id", "user_id", "name"}).AddRow(1, 1, "Old Name")
				mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
					WithArgs("1", 1, 1). // id comes as string "1" from router param usually
					WillReturnRows(rows)

				// Mocks for Save(). The stored row carries no relationship_id, so this also
				// covers a legacy row being linked on its way through an edit.
				mock.ExpectBegin()
				expectFindOrCreateRelationship(mock, false)
				mock.ExpectExec(regexp.QuoteMeta(`UPDATE "analysis_subjects"`)).
					WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1, 7, "Updated Subject", sqlmock.AnyArg(), "Updated Desc", &parsedDate, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1).
					WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectCommit()
			},
			expectedStatus: http.StatusOK,
		},
		{
			// Renaming one version has always split it out of its stack. It still does —
			// but the split is now a relationship_id change instead of an emergent
			// consequence of two strings no longer matching.
			name:          "Renaming A Version Re-Resolves Its Relationship",
			subjectID:     "1",
			authenticated: true,
			userID:        1,
			requestBody:   map[string]interface{}{"name": "Sam"},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "user_id", "relationship_id", "name"}).AddRow(1, 1, 3, "Alex")
				mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
					WithArgs("1", 1, 1).
					WillReturnRows(rows)

				mock.ExpectBegin()
				expectFindOrCreateRelationship(mock, false)
				mock.ExpectExec(regexp.QuoteMeta(`UPDATE "analysis_subjects"`)).
					WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1, 7, "Sam", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1).
					WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectCommit()
			},
			expectedStatus: http.StatusOK,
		},
		{
			// Resending the same name — which the edit form does on every save — must not
			// churn the relationship.
			name:          "Resending The Same Name Keeps The Relationship",
			subjectID:     "1",
			authenticated: true,
			userID:        1,
			requestBody:   map[string]interface{}{"name": "  Alex  "},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "user_id", "relationship_id", "name"}).AddRow(1, 1, 3, "Alex")
				mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
					WithArgs("1", 1, 1).
					WillReturnRows(rows)

				mock.ExpectBegin()
				mock.ExpectExec(regexp.QuoteMeta(`UPDATE "analysis_subjects"`)).
					WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1, 3, "Alex", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1).
					WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectCommit()
			},
			expectedStatus: http.StatusOK,
		},
		{
			name:          "Not Found",
			subjectID:     "999",
			authenticated: true,
			userID:        1,
			requestBody:   map[string]interface{}{"name": "Update Subject"},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
					WithArgs("999", 1, 1).
					WillReturnError(gorm.ErrRecordNotFound)
			},
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "Invalid JSON",
			subjectID:      "1",
			authenticated:  true,
			userID:         1,
			requestBody:    "bad-json",
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:          "Unknown Stats Key",
			subjectID:     "1",
			authenticated: true,
			userID:        1,
			requestBody:   map[string]interface{}{"stats": map[string]int{"love": 5}},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "user_id", "name"}).AddRow(1, 1, "Old Name")
				mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
					WithArgs("1", 1, 1).
					WillReturnRows(rows)
			},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "unknown stats key: love",
		},
		{
			name:          "Malformed Date",
			subjectID:     "1",
			authenticated: true,
			userID:        1,
			requestBody:   map[string]interface{}{"date": "25-10-2023"},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "user_id", "name"}).AddRow(1, 1, "Old Name")
				mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
					WithArgs("1", 1, 1).
					WillReturnRows(rows)
			},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "invalid date, expected YYYY-MM-DD",
		},
		{
			name:          "Whitespace-Only Name",
			subjectID:     "1",
			authenticated: true,
			userID:        1,
			requestBody:   map[string]interface{}{"name": "  "},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "user_id", "name"}).AddRow(1, 1, "Old Name")
				mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
					WithArgs("1", 1, 1).
					WillReturnRows(rows)
			},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "name is required",
		},
		{
			name:          "Guide Answer Out Of Range",
			subjectID:     "1",
			authenticated: true,
			userID:        1,
			requestBody:   map[string]interface{}{"guide_answers": map[string]map[string]int{"storge": {"1": -1}}},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "user_id", "name"}).AddRow(1, 1, "Old Name")
				mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
					WithArgs("1", 1, 1).
					WillReturnRows(rows)
			},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "guide_answers.storge.1 must be between 0 and 3",
		},
		{
			// Uncertain is checked against the row's *resulting* stats, so dropping a
			// scored category while the row still flags it unsure is reported, not stored.
			name:          "Stats Update Orphans An Uncertain Flag",
			subjectID:     "1",
			authenticated: true,
			userID:        1,
			requestBody:   map[string]interface{}{"stats": map[string]int{"eros": 50}},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "user_id", "name", "stats", "uncertain"}).
					AddRow(1, 1, "Alex", `{"eros":50,"mania":70}`, `["mania"]`)
				mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
					WithArgs("1", 1, 1).
					WillReturnRows(rows)
			},
			expectedStatus: http.StatusBadRequest,
			expectedError:  "cannot mark mania uncertain: it has no score",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock, gormDB := setupMockDB(t)
			database.DB = gormDB

			tt.mockBehavior(mock)

			r := setupGinTestRouter(UpdateSubject, tt.userID, tt.authenticated)
			r.PUT("/subjects/:id", UpdateSubject)

			jsonBody, _ := json.Marshal(tt.requestBody)
			req, _ := http.NewRequest(http.MethodPut, "/subjects/"+tt.subjectID, bytes.NewBuffer(jsonBody))
			req.Header.Set("Content-Type", "application/json")

			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d but got %d (body: %s)", tt.expectedStatus, w.Code, w.Body.String())
			}

			if tt.expectedError != "" && !strings.Contains(w.Body.String(), tt.expectedError) {
				t.Errorf("Expected error containing %q but got %s", tt.expectedError, w.Body.String())
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("Unmet sqlmock expectations: %s", err)
			}
		})
	}
}

// TestUpdateSubjectPartialMerge is the regression guard for the description wipe:
// a body carrying only `stats` must leave name, description, date, and tags alone.
func TestUpdateSubjectPartialMerge(t *testing.T) {
	storedDate := time.Date(2026, 2, 20, 0, 0, 0, 0, time.UTC)

	mock, gormDB := setupMockDB(t)
	database.DB = gormDB

	rows := sqlmock.NewRows([]string{"id", "user_id", "relationship_id", "name", "description", "date", "stats", "tags", "uncertain", "guide_answers"}).
		AddRow(1, 1, 7, "Alex", "rough month", storedDate, `{"eros":85}`, `["conflict","distance"]`, `["eros"]`, `{"eros":{"0":2}}`)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
		WithArgs("1", 1, 1).
		WillReturnRows(rows)

	// The name is untouched and the row already has a relationship, so nothing is
	// re-resolved: an edit to the scores must not move the snapshot between stacks.
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "analysis_subjects"`)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1, 7, "Alex", sqlmock.AnyArg(), "rough month", &storedDate, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	r := setupGinTestRouter(UpdateSubject, 1, true)
	r.PUT("/subjects/:id", UpdateSubject)

	body := `{"stats":{"eros":90}}`
	req, _ := http.NewRequest(http.MethodPut, "/subjects/1", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var updated models.AnalysisSubject
	if err := json.Unmarshal(w.Body.Bytes(), &updated); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if updated.Name != "Alex" {
		t.Errorf("Expected name to survive, got %q", updated.Name)
	}
	if updated.Description != "rough month" {
		t.Errorf("Expected description to survive, got %q", updated.Description)
	}
	if len(updated.Tags) != 2 {
		t.Errorf("Expected tags to survive, got %v", updated.Tags)
	}
	if updated.Date == nil || !updated.Date.Equal(storedDate) {
		t.Errorf("Expected date to survive, got %v", updated.Date)
	}
	if updated.Stats["eros"] != 90 {
		t.Errorf("Expected stats to be updated, got %v", updated.Stats)
	}
	if len(updated.Uncertain) != 1 || updated.Uncertain[0] != "eros" {
		t.Errorf("Expected uncertain flags to survive, got %v", updated.Uncertain)
	}
	if updated.GuideAnswers["eros"]["0"] != 2 {
		t.Errorf("Expected guide answers to survive, got %v", updated.GuideAnswers)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("Unmet sqlmock expectations: %s", err)
	}
}

// TestUpdateSubjectExplicitClear proves an explicitly empty value still clears:
// absent means "unchanged", "" means "clear".
func TestUpdateSubjectExplicitClear(t *testing.T) {
	storedDate := time.Date(2026, 2, 20, 0, 0, 0, 0, time.UTC)

	mock, gormDB := setupMockDB(t)
	database.DB = gormDB

	rows := sqlmock.NewRows([]string{"id", "user_id", "relationship_id", "name", "description", "date", "tags"}).
		AddRow(1, 1, 7, "Alex", "rough month", storedDate, `["conflict"]`)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
		WithArgs("1", 1, 1).
		WillReturnRows(rows)

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "analysis_subjects"`)).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1, 7, "Alex", sqlmock.AnyArg(), "", nil, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	r := setupGinTestRouter(UpdateSubject, 1, true)
	r.PUT("/subjects/:id", UpdateSubject)

	body := `{"description":"","date":"","tags":[]}`
	req, _ := http.NewRequest(http.MethodPut, "/subjects/1", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var updated models.AnalysisSubject
	if err := json.Unmarshal(w.Body.Bytes(), &updated); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if updated.Description != "" {
		t.Errorf("Expected description cleared, got %q", updated.Description)
	}
	if updated.Date != nil {
		t.Errorf("Expected date cleared, got %v", updated.Date)
	}
	if len(updated.Tags) != 0 {
		t.Errorf("Expected tags cleared, got %v", updated.Tags)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("Unmet sqlmock expectations: %s", err)
	}
}

func TestDeleteSubject(t *testing.T) {
	tests := []struct {
		name           string
		subjectID      string
		authenticated  bool
		userID         uint
		mockBehavior   func(sqlmock.Sqlmock)
		expectedStatus int
	}{
		{
			name:          "Valid Request",
			subjectID:     "1",
			authenticated: true,
			userID:        1,
			mockBehavior: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				// GORM soft deletes by default if models have gorm.DeletedAt
				mock.ExpectExec(regexp.QuoteMeta(`UPDATE "analysis_subjects"`)).
					WithArgs(sqlmock.AnyArg(), "1", 1).
					WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectCommit()
			},
			expectedStatus: http.StatusOK,
		},
		{
			name:          "Not Found - Nothing Deleted",
			subjectID:     "999",
			authenticated: true,
			userID:        1,
			mockBehavior: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectExec(regexp.QuoteMeta(`UPDATE "analysis_subjects"`)).
					WithArgs(sqlmock.AnyArg(), "999", 1).
					WillReturnResult(sqlmock.NewResult(0, 0))
				mock.ExpectCommit()
			},
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "Unauthorized",
			subjectID:      "1",
			authenticated:  false,
			userID:         0,
			mockBehavior:   func(sqlmock.Sqlmock) {},
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:          "Database Error",
			subjectID:     "1",
			authenticated: true,
			userID:        1,
			mockBehavior: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectExec(regexp.QuoteMeta(`UPDATE "analysis_subjects"`)).
					WithArgs(sqlmock.AnyArg(), "1", 1).
					WillReturnError(errors.New("db delete error"))
				mock.ExpectRollback()
			},
			expectedStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock, gormDB := setupMockDB(t)
			database.DB = gormDB

			tt.mockBehavior(mock)

			r := setupGinTestRouter(DeleteSubject, tt.userID, tt.authenticated)
			r.DELETE("/subjects/:id", DeleteSubject)

			req, _ := http.NewRequest(http.MethodDelete, "/subjects/"+tt.subjectID, nil)

			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("Expected status %d but got %d", tt.expectedStatus, w.Code)
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("Unmet sqlmock expectations: %s", err)
			}
		})
	}
}
