package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// jwtKey is read at package init so every handler shares one key. An empty key is the
// dangerous case: HS256 signs and verifies with it perfectly happily, so the application
// works normally while every token is forgeable by anyone. LoadSecret is what turns that
// into a refusal to start.
var jwtKey = []byte(os.Getenv("JWT_SECRET"))

// ErrNoSecret is returned when JWT_SECRET is unset or empty.
var ErrNoSecret = errors.New(
	"JWT_SECRET is not set: every token would be signed with an empty key and forgeable by " +
		"anyone. Set it before starting the server, e.g. JWT_SECRET=$(openssl rand -hex 32)")

// LoadSecret re-reads JWT_SECRET and reports whether this process can safely sign tokens.
// main calls it at startup and exits on failure.
//
// It re-reads rather than only inspecting the init-time value so a test can set the
// variable and call this — the package was previously untestable for exactly that reason.
func LoadSecret() error {
	jwtKey = []byte(os.Getenv("JWT_SECRET"))
	if len(jwtKey) == 0 {
		return ErrNoSecret
	}
	return nil
}

type Claims struct {
	UserID uint `json:"user_id"`
	jwt.RegisteredClaims
}

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func CheckPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// AccessTokenTTL is how long a signed access token is good for. It stays short precisely
// because it cannot be revoked: nothing is stored server-side, so the only bound on a
// stolen one is the clock. Renewal is the refresh token's job — see RefreshTokenTTL and
// models.RefreshToken — which is what lets this number stay small without the user ever
// meeting a sign-in screen because of it.
const AccessTokenTTL = 24 * time.Hour

// RefreshTokenTTL bounds a session that is never used. Two months is the point past which
// re-entering a password is not an interruption but a reassurance; a client opened once a
// week rotates long before it, and one that is not has stopped being a live session.
const RefreshTokenTTL = 60 * 24 * time.Hour

// NewRefreshToken mints an opaque refresh credential: 32 bytes from the system CSPRNG,
// base64url so it survives a JSON body and a URL unchanged.
//
// Deliberately not a JWT. A signed refresh token cannot be revoked without keeping state
// anyway, and it would carry claims a client could read; this one is a random string whose
// only meaning is the row it matches.
func NewRefreshToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("read random bytes for refresh token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// HashRefreshToken is the one-way mapping from a token to the value stored in the database.
//
// Plain SHA-256, no salt and no stretching, and that is correct here rather than a
// shortcut: the input is 32 uniformly random bytes, so there is no dictionary to run and no
// weak input to protect. It is also what keeps the lookup a single indexed equality — a
// bcrypt-style hash would force a scan comparing every row on every refresh.
func HashRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func GenerateToken(userID uint) (string, error) {
	expirationTime := time.Now().Add(AccessTokenTTL)
	claims := &Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtKey)
}

func ValidateToken(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return jwtKey, nil
	})

	if err != nil {
		return nil, err
	}

	if !token.Valid {
		return nil, errors.New("invalid token")
	}

	return claims, nil
}
