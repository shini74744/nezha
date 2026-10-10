package singleton

import (
	"bytes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
	"gorm.io/gorm"
)

var TOTPCipher cipher.AEAD
var ErrTOTPInvalid = errors.New("ApiErrorTOTPInvalid")
var ErrTOTPLimited = errors.New("ApiErrorTOTPLimited")

func initTOTPCipher(dbPath string) error {
	var count int64
	if err := DB.Model(&model.User{}).Where("totp_secret <> '' OR totp_pending <> ''").Count(&count).Error; err != nil {
		return err
	}
	aead, err := loadTerminalCommandCipher(filepath.Join(filepath.Dir(dbPath), "totp.key"), count > 0)
	if err != nil {
		return errors.New(strings.ReplaceAll(strings.ReplaceAll(err.Error(), "terminal command", "TOTP"), "terminal-commands.key", "totp.key"))
	}
	TOTPCipher = aead
	return nil
}

func totpAAD(uid uint64) []byte { return []byte("nezha-totp:v1:" + strconv.FormatUint(uid, 10)) }
func encryptTOTP(uid uint64, secret string) (string, error) {
	if TOTPCipher == nil {
		return "", errors.New("验证器加密服务未就绪")
	}
	nonce := make([]byte, TOTPCipher.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return "v1:" + base64.RawStdEncoding.EncodeToString(TOTPCipher.Seal(nonce, nonce, []byte(secret), totpAAD(uid))), nil
}
func decryptTOTP(uid uint64, encrypted string) (string, error) {
	if TOTPCipher == nil || !strings.HasPrefix(encrypted, "v1:") {
		return "", ErrTOTPInvalid
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(encrypted, "v1:"))
	n := TOTPCipher.NonceSize()
	if err != nil || len(raw) < n+TOTPCipher.Overhead() {
		return "", ErrTOTPInvalid
	}
	plain, err := TOTPCipher.Open(nil, raw[:n], raw[n:], totpAAD(uid))
	if err != nil {
		return "", ErrTOTPInvalid
	}
	return string(plain), nil
}

type TOTPSetup struct {
	Secret    string `json:"secret"`
	QRCode    string `json:"qr_code"`
	ExpiresAt int64  `json:"expires_at"`
}

// A fresh binding remains inactive until the authenticator proves possession.
// Secrets and QR codes stay on this origin; no external QR service is used.
func BeginTOTP(user *model.User, now time.Time) (*TOTPSetup, error) {
	key, err := totp.Generate(totp.GenerateOpts{Issuer: "Nezha", AccountName: user.Username, SecretSize: 20, Period: 30, Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1})
	if err != nil {
		return nil, err
	}
	encrypted, err := encryptTOTP(user.ID, key.Secret())
	if err != nil {
		return nil, err
	}
	img, err := key.Image(240, 240)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err = png.Encode(&buf, img); err != nil {
		return nil, err
	}
	expires := now.Add(10 * time.Minute).Unix()
	result := DB.Model(&model.User{}).Where("id = ? AND totp_enabled = ? AND password = ? AND token_version = ?", user.ID, false, user.Password, user.TokenVersion).
		UpdateColumns(map[string]any{"totp_pending": encrypted, "totp_pending_until": expires})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, errors.New("账号状态已变化，请刷新后重试")
	}
	return &TOTPSetup{Secret: key.Secret(), QRCode: "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes()), ExpiresAt: expires}, nil
}

// Persisted, per-account and shared across IPs/process restarts. Five attempts
// per five minutes; successful verification resets this budget.
func ClaimTOTPAttempt(db *gorm.DB, uid uint64, now time.Time) error {
	cutoff := now.Unix() - 300
	result := db.Model(&model.User{}).Where("id = ? AND (totp_window_start <= ? OR totp_attempts < 5)", uid, cutoff).
		UpdateColumns(map[string]any{
			"totp_attempts":     gorm.Expr("CASE WHEN totp_window_start <= ? THEN 1 ELSE totp_attempts + 1 END", cutoff),
			"totp_window_start": gorm.Expr("CASE WHEN totp_window_start <= ? THEN ? ELSE totp_window_start END", cutoff, now.Unix()),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTOTPLimited
	}
	return nil
}

func MatchTOTPStep(secret, code string, now time.Time, last int64) (int64, bool) {
	if len(code) != 6 {
		return 0, false
	}
	for _, c := range code {
		if c < '0' || c > '9' {
			return 0, false
		}
	}
	current := now.Unix() / 30
	// At most one time step of clock skew, and never reuse a consumed step.
	for _, step := range []int64{current, current - 1, current + 1} {
		if step <= last {
			continue
		}
		valid, err := totp.ValidateCustom(code, secret, time.Unix(step*30, 0), totp.ValidateOpts{Period: 30, Skew: 0, Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1})
		if err == nil && valid {
			return step, true
		}
	}
	return 0, false
}

func RecoveryDigest(uid uint64, code string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("nezha-totp-recovery:v1:%d:%s", uid, strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(code), "-", "")))))
	return hex.EncodeToString(sum[:])
}
func NewTOTPRecovery(uid uint64) ([]string, string, error) {
	codes := make([]string, 10)
	hashes := make([]string, 10)
	for i := range codes {
		raw := make([]byte, 16)
		if _, err := rand.Read(raw); err != nil {
			return nil, "", err
		}
		value := strings.ToUpper(hex.EncodeToString(raw))
		codes[i] = value[:8] + "-" + value[8:16] + "-" + value[16:24] + "-" + value[24:]
		hashes[i] = RecoveryDigest(uid, codes[i])
	}
	encoded, err := json.Marshal(hashes)
	return codes, string(encoded), err
}
func TOTPRecoveryCount(encoded string) int {
	var hashes []string
	if json.Unmarshal([]byte(encoded), &hashes) != nil {
		return 0
	}
	return len(hashes)
}

// Consume by conditional update: simultaneous requests cannot redeem a TOTP
// time step or recovery code twice. Return false on stale enrollment snapshots.
func VerifyUserTOTP(db *gorm.DB, user *model.User, code string, now time.Time) error {
	if !user.TOTPEnabled {
		return ErrTOTPInvalid
	}
	if err := ClaimTOTPAttempt(db, user.ID, now); err != nil {
		return err
	}
	code = strings.TrimSpace(code)
	update := map[string]any{"totp_attempts": 0, "totp_window_start": 0}
	query := db.Model(&model.User{}).Where("id = ? AND totp_enabled = ? AND totp_secret = ? AND token_version = ?", user.ID, true, user.TOTPSecret, user.TokenVersion)
	if len(code) == 6 {
		secret, err := decryptTOTP(user.ID, user.TOTPSecret)
		if err != nil {
			return err
		}
		step, ok := MatchTOTPStep(secret, code, now, user.TOTPLastStep)
		if !ok {
			return ErrTOTPInvalid
		}
		query = query.Where("totp_last_step = ?", user.TOTPLastStep)
		update["totp_last_step"] = step
	} else {
		normalized := strings.ReplaceAll(code, "-", "")
		if len(normalized) != 32 {
			return ErrTOTPInvalid
		}
		var hashes []string
		if json.Unmarshal([]byte(user.TOTPRecovery), &hashes) != nil {
			return ErrTOTPInvalid
		}
		match := -1
		digest := RecoveryDigest(user.ID, code)
		for i, hash := range hashes {
			if subtle.ConstantTimeCompare([]byte(hash), []byte(digest)) == 1 {
				match = i
			}
		}
		if match < 0 {
			return ErrTOTPInvalid
		}
		hashes = append(hashes[:match], hashes[match+1:]...)
		encoded, _ := json.Marshal(hashes)
		query = query.Where("totp_recovery = ?", user.TOTPRecovery)
		update["totp_recovery"] = string(encoded)
	}
	result := query.UpdateColumns(update)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTOTPInvalid
	}
	return nil
}

func PendingTOTPStep(user *model.User, code string, now time.Time) (int64, error) {
	if user.TOTPEnabled || user.TOTPPending == "" || now.Unix() >= user.TOTPPendingUntil {
		return 0, errors.New("绑定已失效，请重新开始")
	}
	if err := ClaimTOTPAttempt(DB, user.ID, now); err != nil {
		return 0, err
	}
	secret, err := decryptTOTP(user.ID, user.TOTPPending)
	if err != nil {
		return 0, err
	}
	step, ok := MatchTOTPStep(secret, strings.TrimSpace(code), now, 0)
	if !ok {
		return 0, ErrTOTPInvalid
	}
	return step, nil
}
