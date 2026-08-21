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

// Relationship is the person a stack of snapshots is about. Before it existed a "stack"
// was an emergent client-side grouping of snapshots sharing an exact name string, which
// meant a stack could not be renamed and two different people with the same name merged
// silently. Uniqueness of (UserID, Name) is enforced in the handlers rather than by a DB
// constraint: soft deletes would need a partial unique index, and those are spelled
// differently on SQLite and Postgres.
type Relationship struct {
	gorm.Model
	UserID uint   `gorm:"index;not null" json:"user_id"`
	Name   string `gorm:"not null" json:"name"`
	// CadenceDays is an opt-in check-in rhythm: nil (the default) means no reminders at
	// all. Nothing on the server acts on it — there is no scheduler, no email, and no push.
	// Due-ness is computed in the browser from the latest snapshot's date, which is what
	// keeps "nothing leaves this machine" true.
	CadenceDays *int `json:"cadence_days"`
}

type AnalysisSubject struct {
	gorm.Model
	UserID uint `json:"user_id"`
	// RelationshipID is nullable only so AutoMigrate can add the column to an existing
	// table. The startup backfill populates every legacy row and find-or-create sets it on
	// every write, so a row reaching a client without one would be a server bug.
	RelationshipID *uint `gorm:"index" json:"relationship_id"`
	// Relationship is declared purely so GORM emits a real foreign key on engines that can
	// take one. It is never read or written through — always nil, so GORM skips it on save,
	// and `json:"-"` keeps the wire shape unchanged.
	Relationship *Relationship `gorm:"foreignKey:RelationshipID" json:"-"`
	// Name stays denormalized for this phase: it keeps rollback trivial and old clients
	// working. Rename and merge sync it across every snapshot in the same transaction.
	Name string `gorm:"not null" json:"name"`
	// Kind is "full" or "pulse". A pulse is a real version, not a lesser one — it is
	// recorded only so the timeline can draw it more quietly. The column default is what
	// makes every pre-Phase-5 row read back as "full" instead of an empty string.
	Kind        string         `gorm:"default:'full'" json:"kind"`
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

// RefreshToken is the long-lived half of a session, and the reason an expired access token
// is no longer something the user has to see.
//
// The access token stays short and stateless — the server can keep verifying it with
// nothing but the signing key. What was missing was any way to get a new one without the
// password, so a 24-hour token expiring meant "Invalid or expired token" and a trip back to
// the sign-in screen, on a phone that had been signed in for weeks.
//
// Only the SHA-256 of the token is stored. The value is a bearer credential with a
// two-month life, so a leaked table would otherwise be every account it names; there is
// nothing to reverse, because the token is 32 random bytes rather than a password, which is
// also why a plain unsalted digest is the right cost here.
//
// Rotation is what keeps the long life honest: every refresh revokes the row it consumed
// and issues a new one. Presenting an already-revoked token is then either a replay or a
// theft, and both are answered the same way — every token the user holds is revoked and the
// next request has to sign in.
type RefreshToken struct {
	gorm.Model
	UserID    uint      `gorm:"index;not null" json:"user_id"`
	TokenHash string    `gorm:"uniqueIndex;not null" json:"-"`
	ExpiresAt time.Time `gorm:"index;not null" json:"expires_at"`
	// RevokedAt is set on rotation, on sign-out, and on reuse detection. A revoked row is
	// kept rather than deleted: it is the only thing that makes a replay detectable.
	RevokedAt *time.Time `json:"revoked_at"`
}
