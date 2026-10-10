package controller

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/nezhahq/nezha/service/singleton"
	"github.com/pquerna/otp/totp"
	"github.com/stretchr/testify/require"
)

func captureLoginNotices(t *testing.T) *[]singleton.LoginNotice {
	t.Helper()
	old := publishLoginNotice
	notices := []singleton.LoginNotice{}
	publishLoginNotice = func(e singleton.LoginNotice) { notices = append(notices, e) }
	t.Cleanup(func() { publishLoginNotice = old })
	return &notices
}
func TestLoginNoticePasswordFailureAndFinalFactorOnly(t *testing.T) {
	user, r := totpControllerFixture(t)
	secret := enableControllerTOTP(t, user)
	notices := captureLoginNotices(t)
	_, res := loginTOTPTest(t, r, "never-send-this-password", "")
	require.Equal(t, "ApiErrorUnauthorized", res["error"])
	require.Len(t, *notices, 1)
	require.Equal(t, singleton.LoginBadPassword, (*notices)[0].Reason)
	require.NotNil(t, (*notices)[0].AttemptedPassword)
	_, res = loginTOTPTest(t, r, totpTestPassword, "")
	require.Equal(t, "ApiErrorTOTPRequired", res["error"])
	require.Len(t, *notices, 1, "normal challenge is not failure or success")
	_, _ = loginTOTPTest(t, r, totpTestPassword, "never-send-this-factor")
	require.Len(t, *notices, 2)
	require.Equal(t, singleton.LoginBadFactor, (*notices)[1].Reason)
	require.NotNil(t, (*notices)[1].AttemptedPassword)
	code, err := totp.GenerateCode(secret, time.Now())
	require.NoError(t, err)
	_, res = loginTOTPTest(t, r, totpTestPassword, code)
	require.Equal(t, true, res["success"])
	require.Len(t, *notices, 3)
	require.Equal(t, singleton.LoginSucceeded, (*notices)[2].Reason)
	require.Nil(t, (*notices)[2].AttemptedPassword)
	raw, err := json.Marshal(notices)
	require.NoError(t, err)
	for _, forbidden := range []string{"never-send-this-password", "never-send-this-factor", code, totpTestPassword, secret} {
		require.NotContains(t, string(raw), forbidden)
	}
}
func TestLoginNoticeUnknownAccountPublicResponseUnchanged(t *testing.T) {
	_, r := totpControllerFixture(t)
	notices := captureLoginNotices(t)
	req := httptest.NewRequest("POST", "/api/v1/login", strings.NewReader(`{"username":"nonexistent-user","password":"private-input"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Contains(t, w.Body.String(), "ApiErrorUnauthorized")
	require.NotContains(t, w.Body.String(), "不存在")
	require.Len(t, *notices, 1)
	require.Equal(t, singleton.LoginUnknownAccount, (*notices)[0].Reason)
	require.Equal(t, "nonexistent-user", (*notices)[0].Account)
	require.NotNil(t, (*notices)[0].AttemptedPassword)
}
func TestLoginNoticeOAuthWaitsForFinalFactor(t *testing.T) {
	user, secret, r, _ := oauthTOTPFixture(t)
	notices := captureLoginNotices(t)
	cookies := beginOAuthChallengeTest(t, user)
	require.Empty(t, *notices)
	require.Contains(t, oauthVerifyRequest(r, cookies, "private-factor", true).Body.String(), "ApiErrorTOTPInvalid")
	require.Len(t, *notices, 1)
	require.Equal(t, singleton.LoginBadFactor, (*notices)[0].Reason)
	require.Nil(t, (*notices)[0].AttemptedPassword)
	code, err := totp.GenerateCode(secret, time.Now())
	require.NoError(t, err)
	require.Contains(t, oauthVerifyRequest(r, cookies, code, true).Body.String(), "\"success\":true")
	require.Len(t, *notices, 2)
	require.Equal(t, singleton.LoginSucceeded, (*notices)[1].Reason)
	raw, _ := json.Marshal(notices)
	require.NotContains(t, string(raw), code)
	require.NotContains(t, string(raw), "private-factor")
}
