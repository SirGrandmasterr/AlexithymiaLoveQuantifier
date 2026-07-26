package auth

import (
	"errors"
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

func GenerateToken(userID uint) (string, error) {
	expirationTime := time.Now().Add(24 * time.Hour)
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
