package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
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
	}{
		{
			name:          "Valid Request",
			authenticated: true,
			userID:        1,
			requestBody: CreateSubjectInput{
				Name:        "New Subject",
				Description: "Test Description",
				Date:        "2023-10-25",
				Stats:       map[string]int{"love": 5},
			},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectQuery(regexp.QuoteMeta(`INSERT INTO "analysis_subjects" ("created_at","updated_at","deleted_at","user_id","name","description","date","stats") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING "id"`)).
					WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1, "New Subject", "Test Description", sqlmock.AnyArg(), sqlmock.AnyArg()).
					WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
				mock.ExpectCommit()
			},
			expectedStatus: http.StatusCreated,
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
				t.Errorf("Expected status %d but got %d", tt.expectedStatus, w.Code)
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("Unmet sqlmock expectations: %s", err)
			}
		})
	}
}

func TestGetSubjects(t *testing.T) {
	tests := []struct {
		name           string
		authenticated  bool
		userID         uint
		mockBehavior   func(sqlmock.Sqlmock)
		expectedStatus int
		expectedLen    int
	}{
		{
			name:          "Valid Request - Returns List",
			authenticated: true,
			userID:        1,
			mockBehavior: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "user_id", "name", "description"}).
					AddRow(1, 1, "Subject 1", "Desc 1").
					AddRow(2, 1, "Subject 2", "Desc 2")
				mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
					WithArgs(1).
					WillReturnRows(rows)
			},
			expectedStatus: http.StatusOK,
			expectedLen:    2,
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

			req, _ := http.NewRequest(http.MethodGet, "/subjects", nil)

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
	parsedDate, _ := time.Parse("2006-01-02", dateStr)

	tests := []struct {
		name           string
		subjectID      string
		authenticated  bool
		userID         uint
		requestBody    interface{}
		mockBehavior   func(sqlmock.Sqlmock)
		expectedStatus int
	}{
		{
			name:          "Valid Request",
			subjectID:     "1",
			authenticated: true,
			userID:        1,
			requestBody: CreateSubjectInput{
				Name:        "Updated Subject",
				Description: "Updated Desc",
				Date:        dateStr,
				Stats:       map[string]int{"love": 10},
			},
			mockBehavior: func(mock sqlmock.Sqlmock) {
				// Mocks for First()
				rows := sqlmock.NewRows([]string{"id", "user_id", "name"}).AddRow(1, 1, "Old Name")
				mock.ExpectQuery(regexp.QuoteMeta(`SELECT * FROM "analysis_subjects"`)).
					WithArgs("1", 1, 1). // id comes as string "1" from router param usually
					WillReturnRows(rows)

				// Mocks for Save()
				mock.ExpectBegin()
				mock.ExpectExec(regexp.QuoteMeta(`UPDATE "analysis_subjects"`)).
					WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 1, "Updated Subject", "Updated Desc", &parsedDate, sqlmock.AnyArg(), 1).
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
			requestBody: CreateSubjectInput{
				Name: "Update Subject",
			},
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
				t.Errorf("Expected status %d but got %d", tt.expectedStatus, w.Code)
			}

			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("Unmet sqlmock expectations: %s", err)
			}
		})
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
