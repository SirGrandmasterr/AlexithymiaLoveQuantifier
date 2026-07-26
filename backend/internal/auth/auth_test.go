package auth

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// This package was previously untestable: jwtKey was captured at package init, so no test
// could set JWT_SECRET from inside a test function. LoadSecret re-reads it, which is what
// makes everything below possible.

func TestLoadSecretRejectsAnEmptyKey(t *testing.T) {
	t.Setenv("JWT_SECRET", "")

	err := LoadSecret()
	if !errors.Is(err, ErrNoSecret) {
		t.Fatalf("Expected ErrNoSecret for an unset JWT_SECRET, got %v", err)
	}

	// The message has to be actionable — this is the last thing an operator sees before
	// the process exits.
	if len(err.Error()) < 40 {
		t.Errorf("Expected an explanatory error, got %q", err.Error())
	}
}

func TestLoadSecretAcceptsAKey(t *testing.T) {
	t.Setenv("JWT_SECRET", "a-real-secret")

	if err := LoadSecret(); err != nil {
		t.Fatalf("Expected a set JWT_SECRET to load, got %v", err)
	}
}

func TestTokenRoundTrip(t *testing.T) {
	t.Setenv("JWT_SECRET", "a-real-secret")
	if err := LoadSecret(); err != nil {
		t.Fatalf("LoadSecret failed: %v", err)
	}

	token, err := GenerateToken(42)
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	claims, err := ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken rejected a token it just signed: %v", err)
	}
	if claims.UserID != 42 {
		t.Errorf("Expected user id 42, got %d", claims.UserID)
	}
	if claims.ExpiresAt == nil || time.Until(claims.ExpiresAt.Time) < 23*time.Hour {
		t.Errorf("Expected roughly 24 hours of validity, got %v", claims.ExpiresAt)
	}
}

func TestTokenSignedWithAnotherSecretIsRejected(t *testing.T) {
	t.Setenv("JWT_SECRET", "the-real-secret")
	if err := LoadSecret(); err != nil {
		t.Fatalf("LoadSecret failed: %v", err)
	}
	token, err := GenerateToken(1)
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	t.Setenv("JWT_SECRET", "a-different-secret")
	if err := LoadSecret(); err != nil {
		t.Fatalf("LoadSecret failed: %v", err)
	}

	if _, err := ValidateToken(token); err == nil {
		t.Fatal("Expected a token signed with another secret to be rejected")
	}
}

func TestExpiredTokenIsRejected(t *testing.T) {
	t.Setenv("JWT_SECRET", "a-real-secret")
	if err := LoadSecret(); err != nil {
		t.Fatalf("LoadSecret failed: %v", err)
	}

	// Signed with the right key, but already past its expiry.
	expired := jwt.NewWithClaims(jwt.SigningMethodHS256, &Claims{
		UserID: 1,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Minute)),
		},
	})
	signed, err := expired.SignedString(jwtKey)
	if err != nil {
		t.Fatalf("Failed to sign the expired token: %v", err)
	}

	if _, err := ValidateToken(signed); err == nil {
		t.Fatal("Expected an expired token to be rejected")
	}
}

// TestForgedClaimsAreRejected is the attack the signature exists to stop: keep a valid
// signature, swap the payload for one naming a different user.
func TestForgedClaimsAreRejected(t *testing.T) {
	t.Setenv("JWT_SECRET", "a-real-secret")
	if err := LoadSecret(); err != nil {
		t.Fatalf("LoadSecret failed: %v", err)
	}
	token, err := GenerateToken(1)
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("Expected a three-part JWT, got %d parts", len(parts))
	}
	forgedClaims := fmt.Sprintf(`{"user_id":999,"exp":%d}`, time.Now().Add(time.Hour).Unix())
	forged := parts[0] + "." + base64.RawURLEncoding.EncodeToString([]byte(forgedClaims)) + "." + parts[2]

	if claims, err := ValidateToken(forged); err == nil {
		t.Fatalf("Expected forged claims to be rejected, but got user id %d", claims.UserID)
	}
}

func TestPasswordHashing(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword failed: %v", err)
	}
	if hash == "correct horse battery staple" {
		t.Fatal("Expected the password to be hashed, not stored")
	}
	if !CheckPasswordHash("correct horse battery staple", hash) {
		t.Error("Expected the correct password to verify")
	}
	if CheckPasswordHash("wrong password", hash) {
		t.Error("Expected a wrong password to be rejected")
	}
}
