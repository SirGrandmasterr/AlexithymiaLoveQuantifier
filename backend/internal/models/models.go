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

// JournalEntry is one event in the emotional journal: a check-in, a nightly ritual, a fact
// the user confirmed about a person, or a trigger they named. Rows are append-only — a
// correction inserts a new row and stamps SupersededAt on the one it replaces, so readers
// filter on one column instead of walking a chain, and nothing a user said is rewritten by
// something they said later.
//
// The table exists before anything can write to it: the row shape is the part that is
// expensive to change once there is data, so it is settled first.
type JournalEntry struct {
	gorm.Model
	// UserID leads both composite indexes below. ClientID is unique per user rather than
	// globally, and every read of this table is scoped to one user, so user_id is the
	// first column of each index rather than an index of its own.
	UserID uint `gorm:"index;not null;uniqueIndex:idx_journal_user_client,priority:1;index:idx_journal_user_day,priority:1" json:"user_id"`
	// ClientID is minted by the client before the first write. It makes a retried POST
	// idempotent — an offline queue can send the same entry twice and get the same row —
	// and it is the identity an envelope scheme would bind the ciphertext to, were the
	// design in docs/13 ever confirmed. Unique per user, not globally.
	ClientID string `gorm:"type:varchar(36);not null;default:'';uniqueIndex:idx_journal_user_client,priority:2" json:"client_id"`
	// Kind is "checkin", "ritual", "person_fact" or "trigger" — domain.JournalKinds. The
	// column default is what stops a row ever scanning as an empty kind.
	Kind string `gorm:"type:varchar(16);not null;default:'checkin';index" json:"kind"`
	// Day is the local civil day the entry belongs to, YYYY-MM-DD, chosen by the client
	// with the rollover hour applied — an entry made at 02:00 belongs to the day before.
	// Stored as text on purpose: it is a partition key, not a timestamp, and a date column
	// would reintroduce the MAX()-typing trap that aggregateTime exists to absorb.
	Day string `gorm:"type:varchar(10);not null;default:'';index:idx_journal_user_day,priority:2" json:"day"`
	// At is the instant, UTC; the offset the client was in is inside the payload. It is a
	// value rather than a pointer because every entry has an instant by definition, and it
	// is a deliberate exception to the YYYY-MM-DD rule, which governs a snapshot's date of
	// state. A check-in is a moment, and a date would lose what the day graph draws.
	At time.Time `gorm:"index;not null" json:"at"`
	// SchemaVersion is the payload format. Readers switch on it, so a v1 row stays
	// readable after a v2 exists.
	SchemaVersion int `gorm:"not null;default:1" json:"schema_version"`
	// Payload is the self-describing record — the same JSON-in-text pattern as Stats and
	// GuideAnswers, and opaque to SQL for the same reason. Keys the server does not know
	// are kept, not dropped: a newer client may write a field an older server has never
	// heard of.
	Payload map[string]interface{} `gorm:"serializer:json" json:"payload"`
	// SupersededAt is set when a later row with supersedes_id = this.ID is inserted. A
	// reader wanting the current state filters on it; a reader wanting the history does
	// not.
	SupersededAt *time.Time `gorm:"index" json:"superseded_at"`
	SupersedesID *uint      `gorm:"index" json:"supersedes_id"`

	Mentions []JournalMention `gorm:"foreignKey:EntryID" json:"mentions"`
}

// JournalMention links an entry to a person. It is a table rather than a JSON array so that
// a merge can move it with one UPDATE and a relationship can count its mentions — the same
// reason relationship_id is a column on analysis_subjects and not a key inside stats.
type JournalMention struct {
	ID             uint  `gorm:"primarykey" json:"ID"`
	EntryID        uint  `gorm:"index;not null" json:"entry_id"`
	RelationshipID *uint `gorm:"index" json:"relationship_id"`
	// Label is the name as it was said that day, denormalized like AnalysisSubject.Name:
	// it survives a rename (which is fine — it is a quotation) and a relationship delete.
	Label string `gorm:"not null;default:''" json:"label"`
	// Ref is the position in the payload's people array, so a feeling's `about` can point
	// at a mention without repeating the name.
	Ref int `gorm:"not null;default:0" json:"ref"`
}
