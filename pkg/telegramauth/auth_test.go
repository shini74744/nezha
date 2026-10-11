package telegramauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"github.com/stretchr/testify/require"
	"net/url"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func signed(v url.Values, token string) string {
	var fields []string
	for key := range v {
		if key != "hash" {
			fields = append(fields, key+"="+v.Get(key))
		}
	}
	sort.Strings(fields)
	key := hmac.New(sha256.New, []byte("WebAppData"))
	key.Write([]byte(token))
	mac := hmac.New(sha256.New, key.Sum(nil))
	mac.Write([]byte(strings.Join(fields, "\n")))
	v.Set("hash", hex.EncodeToString(mac.Sum(nil)))
	return v.Encode()
}
func TestVerifyTelegramIdentityAdversarial(t *testing.T) {
	now := time.Unix(1800000000, 0)
	const bot = "123:fixture_token"
	valid := url.Values{"user": {`{"id":12345678,"first_name":"测试"}`}, "auth_date": {"1800000000"}, "query_id": {"query-fixture"}}
	good := signed(valid, bot)
	require.NoError(t, Verify(good, bot, 12345678, now))
	for _, raw := range []string{"", good + "&user=x", strings.Replace(good, "12345678", "99999999", 1), good + "&auth_date=1800000000", good + "&hash=aa", good + "%zz", strings.Repeat("x", 8193)} {
		require.Error(t, Verify(raw, bot, 12345678, now), raw)
	}
	require.Error(t, Verify(good, "999:other_token", 12345678, now))
	require.Error(t, Verify(good, bot, 87654321, now))
	require.Error(t, Verify(good, bot, 12345678, now.Add(121*time.Second)))
	require.Error(t, Verify(good, bot, 12345678, now.Add(-31*time.Second)))
	valid.Set("user", `{"id":12345678,"is_bot":true}`)
	require.Error(t, Verify(signed(valid, bot), bot, 12345678, now))
	valid.Set("user", `{"id":87654321}`)
	require.Error(t, Verify(signed(valid, bot), bot, 12345678, now))
}
func TestStoreOneTimeExpiryLimitsAndConcurrency(t *testing.T) {
	var store Store[string]
	now := time.Now()
	token, err := store.Put("one", 1, now.Add(time.Minute), now)
	require.NoError(t, err)
	var successes atomic.Int32
	var wg sync.WaitGroup
	for range 30 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, ok := store.Get(token, now, true); ok {
				successes.Add(1)
			}
		}()
	}
	wg.Wait()
	require.EqualValues(t, 1, successes.Load())
	expired, err := store.Put("old", 1, now, now)
	require.NoError(t, err)
	_, ok := store.Get(expired, now, false)
	require.False(t, ok)
	for range 8 {
		_, err = store.Put("session", 2, now.Add(time.Minute), now)
		require.NoError(t, err)
	}
	_, err = store.Put("overflow", 2, now.Add(time.Minute), now)
	require.Error(t, err)
	_, err = store.Put("other", 3, now.Add(time.Minute), now)
	require.NoError(t, err)
	_, err = store.Put("collected", 2, now.Add(3*time.Minute), now.Add(2*time.Minute))
	require.NoError(t, err)
}
