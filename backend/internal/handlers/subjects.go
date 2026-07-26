package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"alexithymia-backend/internal/database"
	"alexithymia-backend/internal/domain"
	"alexithymia-backend/internal/models"

	"github.com/gin-gonic/gin"
)

const (
	maxTags       = 12
	maxTagLength  = 40
	maxGuideScale = 3 // guide answers are scale indices: 0=Never … 3=Constantly
	dateLayout    = "2006-01-02"
)

type CreateSubjectInput struct {
	Name         string                    `json:"name" binding:"required"`
	Description  string                    `json:"description"`
	Date         string                    `json:"date"`
	Stats        map[string]int            `json:"stats"`
	Tags         []string                  `json:"tags"`
	Uncertain    []string                  `json:"uncertain"`
	GuideAnswers map[string]map[string]int `json:"guide_answers"`
}

// UpdateSubjectInput uses pointers so an absent field is distinguishable from an
// empty one: nil means "leave unchanged", a present value means "write this".
// This is what stops a client that omits `description` from erasing the note.
type UpdateSubjectInput struct {
	Name         *string                    `json:"name"`
	Description  *string                    `json:"description"`
	Date         *string                    `json:"date"` // nil = unchanged; "" = clear to null; value = parsed strictly
	Stats        *map[string]int            `json:"stats"`
	Tags         *[]string                  `json:"tags"`
	Uncertain    *[]string                  `json:"uncertain"`
	GuideAnswers *map[string]map[string]int `json:"guide_answers"`
}

// validateStats enforces the seven-category contract and the 0-100 range.
// Missing keys are legal — an absent key means "not scored", so nothing is zero-filled.
func validateStats(stats map[string]int) error {
	for k, v := range stats {
		if !domain.IsCategoryID(k) {
			return fmt.Errorf("unknown stats key: %s", k)
		}
		if v < 0 || v > 100 {
			return fmt.Errorf("stats.%s must be between 0 and 100", k)
		}
	}
	return nil
}

// validateTags enforces the context-capsule limits and returns the normalized
// (trimmed) list to store. A nil or empty slice is valid.
func validateTags(tags []string) ([]string, error) {
	if len(tags) > maxTags {
		return nil, fmt.Errorf("too many tags, maximum is %d", maxTags)
	}
	if tags == nil {
		return nil, nil
	}
	normalized := make([]string, 0, len(tags))
	for _, t := range tags {
		trimmed := strings.TrimSpace(t)
		if trimmed == "" {
			return nil, fmt.Errorf("tags must not be empty")
		}
		if len(trimmed) > maxTagLength {
			return nil, fmt.Errorf("tag exceeds %d characters: %s", maxTagLength, trimmed)
		}
		normalized = append(normalized, trimmed)
	}
	return normalized, nil
}

// validateUncertain checks the "unsure" flags against the seven ids and against the
// stats they annotate: you cannot be unsure about a category you did not score.
// It is called with the stats the row will actually end up with.
func validateUncertain(uncertain []string, stats map[string]int) error {
	for _, id := range uncertain {
		if !domain.IsCategoryID(id) {
			return fmt.Errorf("unknown category id in uncertain: %s", id)
		}
		if _, scored := stats[id]; !scored {
			return fmt.Errorf("cannot mark %s uncertain: it has no score", id)
		}
	}
	return nil
}

// validateGuideAnswers checks the guided-scoring record: known category ids, integer
// metric-index keys, and answers within the scale. The number of metrics per category
// is frontend-owned, so the index is only checked for being a non-negative integer.
func validateGuideAnswers(guideAnswers map[string]map[string]int) error {
	for categoryID, answers := range guideAnswers {
		if !domain.IsCategoryID(categoryID) {
			return fmt.Errorf("unknown category id in guide_answers: %s", categoryID)
		}
		for metricIndex, answer := range answers {
			if i, err := strconv.Atoi(metricIndex); err != nil || i < 0 {
				return fmt.Errorf("guide_answers.%s has a non-index key: %s", categoryID, metricIndex)
			}
			if answer < 0 || answer > maxGuideScale {
				return fmt.Errorf("guide_answers.%s.%s must be between 0 and %d", categoryID, metricIndex, maxGuideScale)
			}
		}
	}
	return nil
}

// parseSubjectDate parses the wire format strictly; a malformed value is an error
// rather than a silently discarded one.
func parseSubjectDate(date string) (*time.Time, error) {
	parsed, err := time.Parse(dateLayout, date)
	if err != nil {
		return nil, fmt.Errorf("invalid date, expected YYYY-MM-DD")
	}
	return &parsed, nil
}

func CreateSubject(c *gin.Context) {
	var input CreateSubjectInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in context"})
		return
	}

	// Trimmed server-side so "Alex " and "Alex" cannot split into two stacks.
	name := strings.TrimSpace(input.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	if err := validateStats(input.Stats); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tags, err := validateTags(input.Tags)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validateUncertain(input.Uncertain, input.Stats); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validateGuideAnswers(input.GuideAnswers); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var dateParsed *time.Time
	if input.Date != "" {
		parsed, err := parseSubjectDate(input.Date)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		dateParsed = parsed
	}

	subject := models.AnalysisSubject{
		UserID:       userID.(uint),
		Name:         name,
		Description:  input.Description,
		Date:         dateParsed,
		Stats:        input.Stats,
		Tags:         tags,
		Uncertain:    input.Uncertain,
		GuideAnswers: input.GuideAnswers,
	}

	if err := database.DB.Create(&subject).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create subject"})
		return
	}

	c.JSON(http.StatusCreated, subject)
}

func GetSubjects(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in context"})
		return
	}

	var subjects []models.AnalysisSubject
	if err := database.DB.Where("user_id = ?", userID).Find(&subjects).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch subjects"})
		return
	}

	c.JSON(http.StatusOK, subjects)
}

func UpdateSubject(c *gin.Context) {
	id := c.Param("id")
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in context"})
		return
	}

	var input UpdateSubjectInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var subject models.AnalysisSubject
	if err := database.DB.Where("id = ? AND user_id = ?", id, userID).First(&subject).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subject not found"})
		return
	}

	// Only fields present in the request body are assigned.
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
			return
		}
		subject.Name = name
	}

	if input.Description != nil {
		subject.Description = *input.Description
	}

	if input.Stats != nil {
		if err := validateStats(*input.Stats); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		subject.Stats = *input.Stats
	}

	if input.Tags != nil {
		tags, err := validateTags(*input.Tags)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		subject.Tags = tags
	}

	if input.Uncertain != nil {
		subject.Uncertain = *input.Uncertain
	}

	if input.GuideAnswers != nil {
		if err := validateGuideAnswers(*input.GuideAnswers); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		subject.GuideAnswers = *input.GuideAnswers
	}

	// Checked against the row's final stats, not the request's: sending stats that drop a
	// category the row is still unsure about is an inconsistency worth reporting.
	if err := validateUncertain(subject.Uncertain, subject.Stats); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Date != nil {
		if *input.Date == "" {
			subject.Date = nil
		} else {
			parsed, err := parseSubjectDate(*input.Date)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			subject.Date = parsed
		}
	}

	if err := database.DB.Save(&subject).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update subject"})
		return
	}

	c.JSON(http.StatusOK, subject)
}

func DeleteSubject(c *gin.Context) {
	id := c.Param("id")
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in context"})
		return
	}

	result := database.DB.Where("id = ? AND user_id = ?", id, userID).Delete(&models.AnalysisSubject{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete subject"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Subject not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Subject deleted"})
}
