package singleton

import (
	"encoding/base32"
	"encoding/json"
	"github.com/nezhahq/nezha/model"
	"github.com/pquerna/otp/totp"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func setupTOTPTest(t *testing.T) (*model.User, time.Time) {
	t.Helper()
	oldDB, oldCipher := DB, TOTPCipher
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "test.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	sql, err := db.DB()
	require.NoError(t, err)
	sql.SetMaxOpenConns(1)
	DB = db
	t.Cleanup(func() { sql.Close(); DB = oldDB; TOTPCipher = oldCipher })
	require.NoError(t, DB.AutoMigrate(&model.User{}))
	require.NoError(t, initTOTPCipher(filepath.Join(t.TempDir(), "sqlite.db")))
	user := &model.User{Username: "tester", Password: "test-hash"}
	require.NoError(t, DB.Create(user).Error)
	return user, time.Unix(1800000010, 0)
}
func enrollTOTPTest(t *testing.T, user *model.User, now time.Time) string {
	t.Helper()
	setup, err := BeginTOTP(user, now)
	require.NoError(t, err)
	require.NoError(t, DB.First(user, user.ID).Error)
	require.NotContains(t, user.TOTPPending, setup.Secret)
	require.NoError(t, DB.Model(user).UpdateColumns(map[string]any{"totp_secret": user.TOTPPending, "totp_pending": "", "totp_enabled": true}).Error)
	require.NoError(t, DB.First(user, user.ID).Error)
	return setup.Secret
}
func TestTOTPReferenceVectorAndWindow(t *testing.T) {
	// RFC 6238 Appendix B SHA-1 vector 94287082 truncated to the configured 6 digits.
	secret := base32.StdEncoding.EncodeToString([]byte("12345678901234567890"))
	step, ok := MatchTOTPStep(secret, "287082", time.Unix(59, 0), 0)
	require.True(t, ok)
	require.Equal(t, int64(1), step)
	_, ok = MatchTOTPStep(secret, "287082", time.Unix(60, 0), 0)
	require.True(t, ok)
	_, ok = MatchTOTPStep(secret, "287082", time.Unix(90, 0), 0)
	require.False(t, ok)
	_, ok = MatchTOTPStep(secret, "287082", time.Unix(59, 0), 1)
	require.False(t, ok)
	for _, code := range []string{"", "12345", "1234567", "abcdef", "１２３４５６"} {
		_, ok = MatchTOTPStep(secret, code, time.Unix(59, 0), 0)
		require.False(t, ok)
	}
}
func TestTOTPEncryptionIsOwnerBoundAndKeyLossFailsClosed(t *testing.T) {
	user, _ := setupTOTPTest(t)
	encrypted, err := encryptTOTP(user.ID, "test-secret")
	require.NoError(t, err)
	plain, err := decryptTOTP(user.ID, encrypted)
	require.NoError(t, err)
	require.Equal(t, "test-secret", plain)
	_, err = decryptTOTP(user.ID+1, encrypted)
	require.Error(t, err)
	_, err = decryptTOTP(user.ID, encrypted[:len(encrypted)-4]+"AAAA")
	require.Error(t, err)
	require.NoError(t, DB.Model(user).UpdateColumn("totp_secret", encrypted).Error)
	err = initTOTPCipher(filepath.Join(t.TempDir(), "sqlite.db"))
	require.ErrorContains(t, err, "totp.key")
}
func TestTOTPEnrollmentExpiryAndReplace(t *testing.T) {
	user, now := setupTOTPTest(t)
	one, err := BeginTOTP(user, now)
	require.NoError(t, err)
	two, err := BeginTOTP(user, now)
	require.NoError(t, err)
	require.NotEqual(t, one.Secret, two.Secret)
	require.NoError(t, DB.First(user, user.ID).Error)
	require.False(t, user.TOTPEnabled)
	code, err := totp.GenerateCode(two.Secret, now)
	require.NoError(t, err)
	_, err = PendingTOTPStep(user, code, now)
	require.NoError(t, err)
	_, err = PendingTOTPStep(user, code, now.Add(10*time.Minute))
	require.Error(t, err)
}
func TestTOTPReplayAtomicAndPersisted(t *testing.T) {
	user, now := setupTOTPTest(t)
	secret := enrollTOTPTest(t, user, now)
	code, err := totp.GenerateCode(secret, now)
	require.NoError(t, err)
	var wins atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if VerifyUserTOTP(DB, user, code, now) == nil {
				wins.Add(1)
			}
		}()
	}
	wg.Wait()
	require.Equal(t, int32(1), wins.Load())
	require.NoError(t, DB.First(user, user.ID).Error)
	require.ErrorIs(t, VerifyUserTOTP(DB, user, code, now), ErrTOTPInvalid)
	// Failed concurrent replays may exhaust the five-attempt window, depending
	// on where the successful transaction lands. Test reuse after that window;
	// do not assume another attempt is allowed just because the code changed.
	next := now.Add(5 * time.Minute)
	code, err = totp.GenerateCode(secret, next)
	require.NoError(t, err)
	require.NoError(t, VerifyUserTOTP(DB, user, code, next))
}
func TestTOTPRecoveryHashedAndSingleUse(t *testing.T) {
	user, now := setupTOTPTest(t)
	enrollTOTPTest(t, user, now)
	codes, hashes, err := NewTOTPRecovery(user.ID)
	require.NoError(t, err)
	require.Len(t, codes, 10)
	require.NotContains(t, hashes, codes[0])
	require.Equal(t, 10, TOTPRecoveryCount(hashes))
	require.NoError(t, DB.Model(user).UpdateColumn("totp_recovery", hashes).Error)
	require.NoError(t, DB.First(user, user.ID).Error)
	require.NoError(t, VerifyUserTOTP(DB, user, strings.ToLower(codes[0]), now))
	require.Error(t, VerifyUserTOTP(DB, user, codes[0], now))
	require.NoError(t, DB.First(user, user.ID).Error)
	require.Equal(t, 9, TOTPRecoveryCount(user.TOTPRecovery))
	require.Error(t, VerifyUserTOTP(DB, user, "not-a-valid-code", now))
}
func TestTOTPAccountThrottleAndRecoveryAfterWindow(t *testing.T) {
	user, now := setupTOTPTest(t)
	secret := enrollTOTPTest(t, user, now)
	for i := 0; i < 5; i++ {
		require.ErrorIs(t, VerifyUserTOTP(DB, user, "bad", now), ErrTOTPInvalid)
	}
	valid, err := totp.GenerateCode(secret, now)
	require.NoError(t, err)
	require.ErrorIs(t, VerifyUserTOTP(DB, user, valid, now), ErrTOTPLimited)
	later := now.Add(5 * time.Minute)
	valid, err = totp.GenerateCode(secret, later)
	require.NoError(t, err)
	require.NoError(t, VerifyUserTOTP(DB, user, valid, later))
	require.NoError(t, DB.First(user, user.ID).Error)
	require.Zero(t, user.TOTPAttempts)
}
func TestTOTPSecretsNotSerialized(t *testing.T) {
	data, err := json.Marshal(model.User{TOTPEnabled: true, TOTPSecret: "SECRET", TOTPPending: "PENDING", TOTPRecovery: "RECOVERY"})
	require.NoError(t, err)
	require.NotContains(t, string(data), "SECRET")
	require.NotContains(t, string(data), "PENDING")
	require.NotContains(t, string(data), "RECOVERY")
	require.Contains(t, string(data), "\"totp_enabled\":true")
}
