package models

import (
	"time"

	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	Email          string `gorm:"uniqueIndex;not null" json:"email"`
	Password       string `gorm:"not null" json:"-"`
	Name           string `json:"name"`
	Age            int    `json:"age"`
	MBTIType       string `json:"mbti_type"`
	ProfilePicture string `json:"profile_picture"`
}

type AnalysisSubject struct {
	gorm.Model
	UserID      uint           `json:"user_id"`
	Name        string         `gorm:"not null" json:"name"`
	Description string         `json:"description"` // the snapshot note
	Date        *time.Time     `json:"date"`
	Stats       map[string]int `gorm:"serializer:json" json:"stats"`
	Tags        []string       `gorm:"serializer:json" json:"tags"` // context chips

	// Uncertain lists the category ids the user flagged "unsure" about. Every id must
	// also be present in Stats — you cannot be unsure about a score you did not give.
	Uncertain []string `gorm:"serializer:json" json:"uncertain"`
	// GuideAnswers records the guided-scoring answers that informed a score:
	// category id -> metric index (stringified, JSON keys are strings) -> scale index 0..3.
	GuideAnswers map[string]map[string]int `gorm:"serializer:json" json:"guide_answers"`
}
