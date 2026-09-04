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

type Relationship struct {
	gorm.Model
	UserID      uint   `gorm:"index;not null" json:"user_id"`
	Name        string `gorm:"not null" json:"name"`
	CadenceDays *int   `json:"cadence_days"`
}

type AnalysisSubject struct {
	gorm.Model
	UserID         uint           `json:"user_id"`
	RelationshipID *uint          `gorm:"index" json:"relationship_id"`
	Relationship   *Relationship  `gorm:"foreignKey:RelationshipID" json:"-"`
	Name           string         `gorm:"not null" json:"name"`
	Kind           string         `gorm:"default:'full'" json:"kind"`
	Description    string         `json:"description"` // the snapshot note
	Date           *time.Time     `json:"date"`
	Stats          map[string]int `gorm:"serializer:json" json:"stats"`
	Tags           []string       `gorm:"serializer:json" json:"tags"` // context chips

	Uncertain    []string                  `gorm:"serializer:json" json:"uncertain"`
	GuideAnswers map[string]map[string]int `gorm:"serializer:json" json:"guide_answers"`
}

type RefreshToken struct {
	gorm.Model
	UserID    uint       `gorm:"index;not null" json:"user_id"`
	TokenHash string     `gorm:"uniqueIndex;not null" json:"-"`
	ExpiresAt time.Time  `gorm:"index;not null" json:"expires_at"`
	RevokedAt *time.Time `json:"revoked_at"`
}

type JournalEntry struct {
	gorm.Model
	UserID   uint      `gorm:"index;not null;uniqueIndex:idx_journal_user_client,priority:1;index:idx_journal_user_day,priority:1" json:"user_id"`
	ClientID string    `gorm:"type:varchar(36);not null;default:'';uniqueIndex:idx_journal_user_client,priority:2" json:"client_id"`
	Kind     string    `gorm:"type:varchar(16);not null;default:'checkin';index" json:"kind"`
	Day      string    `gorm:"type:varchar(10);not null;default:'';index:idx_journal_user_day,priority:2" json:"day"`
	At       time.Time `gorm:"index;not null" json:"at"`
	// SchemaVersion is the payload format. Readers switch on it, so a v1 row stays
	// readable after a v2 exists.
	SchemaVersion int                    `gorm:"not null;default:1" json:"schema_version"`
	Payload       map[string]interface{} `gorm:"serializer:json" json:"payload"`
	SupersededAt  *time.Time             `gorm:"index" json:"superseded_at"`
	SupersedesID  *uint                  `gorm:"index" json:"supersedes_id"`

	Mentions []JournalMention `gorm:"foreignKey:EntryID" json:"mentions"`
}

type JournalMention struct {
	ID             uint   `gorm:"primarykey" json:"ID"`
	EntryID        uint   `gorm:"index;not null" json:"entry_id"`
	RelationshipID *uint  `gorm:"index" json:"relationship_id"`
	Label          string `gorm:"not null;default:''" json:"label"`
	Ref            int    `gorm:"not null;default:0" json:"ref"`
}
