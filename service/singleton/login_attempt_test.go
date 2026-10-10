package singleton

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
	"unicode/utf16"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
)

func TestLoginAttemptPasswordRedactionAndBounds(t *testing.T) {
	secret := NewLoginAttemptPassword("fixture-secret")
	e := LoginNotice{AttemptedPassword: secret}
	for _, raw := range []string{fmt.Sprintf("%v", secret), fmt.Sprintf("%#v", secret), fmt.Sprintf("%+v", e), fmt.Sprintf("%#v", e)} {
		require.NotContains(t, raw, "fixture-secret")
	}
	raw, err := json.Marshal(e)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "fixture-secret")
	raw, err = json.Marshal(secret)
	require.NoError(t, err)
	require.Equal(t, "null", string(raw))
	require.Equal(t, "111111", NewLoginAttemptPassword("111111").display())
	require.Equal(t, "（空）", NewLoginAttemptPassword("").display())
	require.Equal(t, "a\\n结果：伪造\\u202eb", NewLoginAttemptPassword("a\n结果：伪造\u202eb").display())
	long := NewLoginAttemptPassword(strings.Repeat("😀", 300))
	require.True(t, strings.HasSuffix(long.display(), "…（已截断）"))
	e = LoginNotice{Method: "账号密码", Reason: LoginBadPassword, AttemptedPassword: long}
	require.Less(t, len(utf16.Encode([]rune(telegramLoginText(e)))), 4096)
}

func TestTelegramLoginAttemptOptInOwnerBoundaryAndAlias(t *testing.T) {
	for _, tc := range []struct {
		name         string
		enabled      bool
		uid          uint64
		method       string
		reason       LoginNoticeReason
		wantPassword bool
	}{
		{"default", false, 1, "账号密码", LoginBadPassword, false},
		{"own", true, 1, "账号密码", LoginBadPassword, true},
		{"wrong-account", true, 0, "账号密码", LoginUnknownAccount, true},
		{"other-account", true, 10, "账号密码", LoginBadPassword, false},
		{"wrong-factor", true, 1, "账号密码", LoginBadFactor, true},
		{"success", true, 1, "账号密码", LoginSucceeded, false},
		{"oauth", true, 1, "GitHub", LoginBadFactor, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			n, _ := telegramTrafficFixture(t)
			n.UserID = 1
			n.TelegramMenu.LoginFailurePassword = tc.enabled
			require.NoError(t, DB.Save(n).Error)
			e := LoginNotice{UserID: tc.uid, Account: "real-account-name", Method: tc.method, Reason: tc.reason, At: time.Now(), AttemptedPassword: NewLoginAttemptPassword("fixture-secret")}
			sends := 0
			telegramSendLogin(context.Background(), e, func(target model.TelegramMenuTarget) *telegramAPI {
				api := newTelegramAPI(target)
				api.client.Transport = telegramRoundTrip(func(r *http.Request) (*http.Response, error) {
					sends++
					var body struct {
						Text string `json:"text"`
					}
					require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
					if tc.wantPassword {
						require.Contains(t, body.Text, "密码：fixture-secret")
					} else {
						require.NotContains(t, body.Text, "fixture-secret")
					}
					if tc.uid == 1 {
						require.Contains(t, body.Text, "账号：管理员")
						require.NotContains(t, body.Text, "real-account-name")
					} else {
						require.Contains(t, body.Text, "账号：real-account-name")
					}
					require.NotContains(t, body.Text, "不记录或发送")
					return telegramTestResponse(nil), nil
				})
				return api
			})
			require.Equal(t, 1, sends)
		})
	}
}

func TestTelegramLoginNoSecretAfterOptOutOrAccountRemoval(t *testing.T) {
	n, _ := telegramTrafficFixture(t)
	n.UserID = 1
	n.TelegramMenu.LoginFailurePassword = true
	require.NoError(t, DB.Save(n).Error)
	e := LoginNotice{UserID: 1, Account: "owner", Method: "账号密码", Reason: LoginBadPassword, At: time.Now(), AttemptedPassword: NewLoginAttemptPassword("fixture-secret")}
	n.TelegramMenu.LoginFailurePassword = false
	require.NoError(t, DB.Save(n).Error)
	sends := 0
	factory := func(target model.TelegramMenuTarget) *telegramAPI {
		api := newTelegramAPI(target)
		api.client.Transport = telegramRoundTrip(func(r *http.Request) (*http.Response, error) {
			sends++
			var body map[string]any
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			require.NotContains(t, body["text"], "fixture-secret")
			return telegramTestResponse(nil), nil
		})
		return api
	}
	telegramSendLogin(context.Background(), e, factory)
	require.Equal(t, 1, sends)
	require.NoError(t, DB.Delete(&model.User{}, 1).Error)
	telegramSendLogin(context.Background(), e, factory)
	require.Equal(t, 1, sends)
}
