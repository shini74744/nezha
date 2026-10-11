// Package telegramauth verifies Mini Apps and stores short-lived capabilities.
package telegramauth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var ErrDenied = errors.New("Telegram authorization denied")

func Verify(raw, botToken string, owner int64, now time.Time) error {
	if len(raw) == 0 || len(raw) > 8192 || owner <= 0 {
		return ErrDenied
	}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return ErrDenied
	}
	fields := make([]string, 0, len(values))
	for key, v := range values {
		if len(v) != 1 || strings.ContainsAny(key, "\r\n=") || strings.ContainsAny(v[0], "\r\n") {
			return ErrDenied
		}
		if key != "hash" {
			fields = append(fields, key+"="+v[0])
		}
	}
	provided, err := hex.DecodeString(values.Get("hash"))
	if err != nil || len(provided) != sha256.Size {
		return ErrDenied
	}
	sort.Strings(fields)
	secret := hmac.New(sha256.New, []byte("WebAppData"))
	secret.Write([]byte(botToken))
	mac := hmac.New(sha256.New, secret.Sum(nil))
	mac.Write([]byte(strings.Join(fields, "\n")))
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return ErrDenied
	}
	stamp, err := strconv.ParseInt(values.Get("auth_date"), 10, 64)
	if err != nil || stamp < now.Add(-2*time.Minute).Unix() || stamp > now.Add(30*time.Second).Unix() {
		return ErrDenied
	}
	var user struct {
		ID    int64 `json:"id"`
		IsBot bool  `json:"is_bot"`
	}
	if json.Unmarshal([]byte(values.Get("user")), &user) != nil || user.ID != owner || user.IsBot {
		return ErrDenied
	}
	return nil
}

type entry[T any] struct {
	Value T
	Until time.Time
	Owner uint64
}

// Restart invalidates every outstanding link and session. Only hashes of
// random 256-bit credentials are retained, never dashboard JWTs or PATs.
type Store[T any] struct {
	mu      sync.Mutex
	entries map[[32]byte]entry[T]
}

func (s *Store[T]) Put(value T, owner uint64, until, now time.Time) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.entries == nil {
		s.entries = make(map[[32]byte]entry[T])
	}
	count := 0
	for key, item := range s.entries {
		if !now.Before(item.Until) {
			delete(s.entries, key)
		} else if item.Owner == owner {
			count++
		}
	}
	if len(s.entries) >= 1024 || count >= 8 {
		return "", ErrDenied
	}
	s.entries[sha256.Sum256([]byte(token))] = entry[T]{value, until, owner}
	return token, nil
}
func (s *Store[T]) Get(token string, now time.Time, consume bool) (T, bool) {
	var zero T
	if len(token) != 43 {
		return zero, false
	}
	key := sha256.Sum256([]byte(token))
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.entries[key]
	if !ok {
		return zero, false
	}
	if consume || !now.Before(item.Until) {
		delete(s.entries, key)
	}
	if !now.Before(item.Until) {
		return zero, false
	}
	return item.Value, true
}
