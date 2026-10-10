package controller

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/json"
	jwt "github.com/appleboy/gin-jwt/v2"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/idcodec"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/pquerna/otp/totp"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const totpTestPassword = "test-password-only"

func totpControllerFixture(t *testing.T) (*model.User, *gin.Engine) {
	t.Helper()
	t.Cleanup(setupJWTSessionTest(t))
	old := singleton.TOTPCipher
	t.Cleanup(func() { singleton.TOTPCipher = old })
	block, err := aes.NewCipher(bytes.Repeat([]byte{7}, 32))
	require.NoError(t, err)
	singleton.TOTPCipher, err = cipher.NewGCM(block)
	require.NoError(t, err)
	hash, err := bcrypt.GenerateFromPassword([]byte(totpTestPassword), bcrypt.MinCost)
	require.NoError(t, err)
	require.NoError(t, singleton.DB.Model(&model.User{}).Where("id = ?", 100).UpdateColumn("password", string(hash)).Error)
	var user model.User
	require.NoError(t, singleton.DB.First(&user, 100).Error)
	singleton.Conf.JWTSecretKey = jwtSessionTestMasterKey
	mw, err := jwt.New(initParams())
	require.NoError(t, err)
	require.NoError(t, mw.MiddlewareInit())
	r := gin.New()
	r.POST("/api/v1/login", mw.LoginHandler)
	claims, err := issueJWTSession(newCtxForUser(0, "", "test"), &user, 1)
	require.NoError(t, err)
	require.NoError(t, singleton.DB.Model(&model.JWTSession{}).Where("key_id = ?", claims[jwtClaimKeyID]).UpdateColumn("key_id", "current-browser").Error)
	_, err = issueJWTSession(newCtxForUser(0, "", "other"), &user, 1)
	require.NoError(t, err)
	return &user, r
}
func totpContext(t *testing.T, user *model.User, password, code string) *gin.Context {
	t.Helper()
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	body, _ := json.Marshal(totpForm{Password: password, Code: code})
	ctx.Request = httptest.NewRequest("POST", "/api/v1/profile/totp", bytes.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set(model.CtxKeyAuthorizedUser, user)
	ctx.Set(jwtClaimKeyID, "current-browser")
	return ctx
}
func enableControllerTOTP(t *testing.T, user *model.User) string {
	t.Helper()
	result, err := beginTOTP(totpContext(t, user, totpTestPassword, ""))
	require.NoError(t, err)
	require.NoError(t, singleton.DB.First(user, user.ID).Error)
	code, err := totp.GenerateCode(result.Secret, time.Now())
	require.NoError(t, err)
	codes, err := confirmTOTP(totpContext(t, user, totpTestPassword, code))
	require.NoError(t, err)
	require.Len(t, codes.RecoveryCodes, 10)
	require.NoError(t, singleton.DB.First(user, user.ID).Error)
	require.True(t, user.TOTPEnabled)
	// The binding code is intentionally consumed. Tests reset only this fixture
	// to avoid sleeping for a production-length 30-second time step.
	require.NoError(t, singleton.DB.Model(user).UpdateColumn("totp_last_step", 0).Error)
	require.NoError(t, singleton.DB.First(user, user.ID).Error)
	return result.Secret
}
func loginTOTPTest(t *testing.T, r *gin.Engine, password, code string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	body, _ := json.Marshal(model.LoginRequest{Username: "victim", Password: password, Code: code})
	req := httptest.NewRequest("POST", "/api/v1/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var response map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
	return w, response
}
func TestTOTPPasswordLoginCannotIssueSessionWithoutFactor(t *testing.T) {
	user, r := totpControllerFixture(t)
	secret := enableControllerTOTP(t, user)
	var before int64
	require.NoError(t, singleton.DB.Model(&model.JWTSession{}).Count(&before).Error)
	for _, item := range []struct{ pw, code, want string }{
		{"wrong-password", "", "ApiErrorUnauthorized"},
		{totpTestPassword, "", "ApiErrorTOTPRequired"},
		{totpTestPassword, "bad-code", "ApiErrorTOTPInvalid"},
	} {
		w, response := loginTOTPTest(t, r, item.pw, item.code)
		require.NotEqual(t, true, response["success"])
		require.Equal(t, item.want, response["error"])
		require.Empty(t, w.Result().Cookies(), "no authentication cookie before factor proof")
	}
	var after int64
	require.NoError(t, singleton.DB.Model(&model.JWTSession{}).Count(&after).Error)
	require.Equal(t, before, after)
	code, err := totp.GenerateCode(secret, time.Now())
	require.NoError(t, err)
	w, response := loginTOTPTest(t, r, totpTestPassword, code)
	require.Equal(t, true, response["success"])
	var loginCookie bool
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == "nz-jwt" && cookie.Value != "" {
			loginCookie = true
		}
	}
	require.True(t, loginCookie)
	_, response = loginTOTPTest(t, r, totpTestPassword, code)
	require.Equal(t, "ApiErrorTOTPInvalid", response["error"])
}
func TestTOTPEnrollmentRevokesOtherSessionsKeepsCaller(t *testing.T) {
	user, _ := totpControllerFixture(t)
	var oldVersion = user.TokenVersion
	enableControllerTOTP(t, user)
	require.Equal(t, oldVersion+1, user.TokenVersion)
	var sessions []model.JWTSession
	require.NoError(t, singleton.DB.Find(&sessions).Error)
	for _, session := range sessions {
		if session.KeyID == "current-browser" {
			require.Nil(t, session.RevokedAt)
			require.Equal(t, user.TokenVersion, session.TokenVersion)
		} else {
			require.NotNil(t, session.RevokedAt)
		}
	}
}
func TestTOTPCancelAndWrongPasswordCannotChangeFactor(t *testing.T) {
	user, _ := totpControllerFixture(t)
	_, err := beginTOTP(totpContext(t, user, "wrong-password", ""))
	require.Error(t, err)
	result, err := beginTOTP(totpContext(t, user, totpTestPassword, ""))
	require.NoError(t, err)
	require.NoError(t, singleton.DB.First(user, user.ID).Error)
	_, err = cancelTOTP(totpContext(t, user, totpTestPassword, ""))
	require.NoError(t, err)
	require.NoError(t, singleton.DB.First(user, user.ID).Error)
	require.Empty(t, user.TOTPPending)
	code, err := totp.GenerateCode(result.Secret, time.Now())
	require.NoError(t, err)
	_, err = confirmTOTP(totpContext(t, user, totpTestPassword, code))
	require.Error(t, err)
	require.False(t, user.TOTPEnabled)
}
func TestTOTPRecoveryRegenerationDisableAndNormalLogin(t *testing.T) {
	user, r := totpControllerFixture(t)
	secret := enableControllerTOTP(t, user)
	code, err := totp.GenerateCode(secret, time.Now())
	require.NoError(t, err)
	fresh, err := regenerateTOTPRecovery(totpContext(t, user, totpTestPassword, code))
	require.NoError(t, err)
	require.Len(t, fresh.RecoveryCodes, 10)
	require.NoError(t, singleton.DB.First(user, user.ID).Error)
	_, response := loginTOTPTest(t, r, totpTestPassword, fresh.RecoveryCodes[0])
	require.Equal(t, true, response["success"])
	_, response = loginTOTPTest(t, r, totpTestPassword, fresh.RecoveryCodes[0])
	require.Equal(t, "ApiErrorTOTPInvalid", response["error"])
	require.NoError(t, singleton.DB.First(user, user.ID).Error)
	_, err = disableTOTP(totpContext(t, user, totpTestPassword, fresh.RecoveryCodes[1]))
	require.NoError(t, err)
	require.NoError(t, singleton.DB.First(user, user.ID).Error)
	require.False(t, user.TOTPEnabled)
	require.Empty(t, user.TOTPSecret)
	require.Empty(t, user.TOTPRecovery)
	_, response = loginTOTPTest(t, r, totpTestPassword, "")
	require.Equal(t, true, response["success"])
}
func TestTOTPOAuthSessionIssuerDoesNotRequireFactor(t *testing.T) {
	user, _ := totpControllerFixture(t)
	enableControllerTOTP(t, user)
	// OAuth callback invokes this issuer directly, not the password authenticator.
	claims, err := issueJWTSession(newCtxForUser(0, "", "oauth"), user, 1)
	require.NoError(t, err)
	require.NotEmpty(t, claims[jwtClaimKeyID])
}
func TestTOTPSetupRoutesRequireJWTAndCSRF(t *testing.T) {
	user, _ := totpControllerFixture(t)
	_ = user
	mw, err := jwt.New(initParams())
	require.NoError(t, err)
	require.NoError(t, mw.MiddlewareInit())
	r := gin.New()
	auth := r.Group("/api/v1", mw.MiddlewareFunc(), csrfMiddleware())
	auth.POST("/profile/totp/setup", restPATForbiddenMiddleware(), commonHandler(beginTOTP))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/v1/profile/totp/setup", strings.NewReader("{}")))
	require.NotContains(t, w.Body.String(), "qr_code")
	var count int64
	require.NoError(t, singleton.DB.Model(&model.User{}).Where("totp_pending <> ''").Count(&count).Error)
	require.Zero(t, count)
	token, _, err := mw.TokenGenerator(map[string]interface{}{jwtClaimUserID: mustEncodeTOTPUser(t), jwtClaimKeyID: "current-browser"})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/profile/totp/setup", strings.NewReader("{}"))
	req.AddCookie(&http.Cookie{Name: "nz-jwt", Value: token})
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusForbidden, w.Code)
}

func mustEncodeTOTPUser(t *testing.T) string {
	t.Helper()
	encoded, err := idcodec.Encode(100)
	require.NoError(t, err)
	return encoded
}

func TestTOTPSetupRejectsPATAndOversizedBody(t *testing.T) {
	user, _ := totpControllerFixture(t)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(apiTokenCtxKey, &model.APIToken{}); c.Next() })
	r.POST("/profile/totp/setup", restPATForbiddenMiddleware(), commonHandler(beginTOTP))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/profile/totp/setup", strings.NewReader("{}")))
	require.Equal(t, http.StatusForbidden, w.Code)
	require.NotContains(t, w.Body.String(), "qr_code")
	ctx := totpContext(t, user, totpTestPassword, "")
	ctx.Request.Body = http.NoBody
	ctx.Request = httptest.NewRequest(http.MethodPost, "/profile/totp/setup", strings.NewReader(`{"password":"`+strings.Repeat("x", 20<<10)+`"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	_, err := beginTOTP(ctx)
	require.Error(t, err)
	var fresh model.User
	require.NoError(t, singleton.DB.First(&fresh, user.ID).Error)
	require.Empty(t, fresh.TOTPPending)
}

func totpPolicyContext(t *testing.T, user *model.User, password, code string, passwordEnabled, githubEnabled *bool) *gin.Context {
	c := totpContext(t, user, password, code)
	body, _ := json.Marshal(totpForm{Password: password, Code: code, PasswordEnabled: passwordEnabled, GitHubEnabled: githubEnabled})
	c.Request = httptest.NewRequest("POST", "/api/v1/profile/totp/policy", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	return c
}

func TestTOTPIndependentLoginPolicies(t *testing.T) {
	for _, pw := range []bool{false, true} {
		for _, gh := range []bool{false, true} {
			name := map[bool]string{false: "password-off", true: "password-on"}[pw] + "/" + map[bool]string{false: "github-off", true: "github-on"}[gh]
			t.Run(name, func(t *testing.T) {
				user, r := totpControllerFixture(t)
				enableControllerTOTP(t, user)
				codes, hashes, err := singleton.NewTOTPRecovery(user.ID)
				require.NoError(t, err)
				require.NoError(t, singleton.DB.Model(user).UpdateColumn("totp_recovery", hashes).Error)
				before := user.TokenVersion
				secret := user.TOTPSecret
				_, err = updateTOTPLoginPolicy(totpPolicyContext(t, user, "wrong", codes[0], &pw, &gh))
				require.Error(t, err)
				_, err = updateTOTPLoginPolicy(totpPolicyContext(t, user, totpTestPassword, "", &pw, &gh))
				require.Error(t, err)
				result, err := updateTOTPLoginPolicy(totpPolicyContext(t, user, totpTestPassword, codes[0], &pw, &gh))
				require.NoError(t, err)
				require.True(t, result.Enabled, "both off must retain binding")
				require.Equal(t, pw, result.PasswordEnabled)
				require.Equal(t, gh, result.GitHubEnabled)
				require.Equal(t, 9, result.RecoveryRemaining)
				require.NoError(t, singleton.DB.First(user, user.ID).Error)
				require.Equal(t, secret, user.TOTPSecret)
				require.Equal(t, before+1, user.TokenVersion)
				var current model.JWTSession
				require.NoError(t, singleton.DB.Where("key_id = ?", "current-browser").First(&current).Error)
				require.Nil(t, current.RevokedAt)
				require.Equal(t, user.TokenVersion, current.TokenVersion)
				_, response := loginTOTPTest(t, r, "wrong", "")
				require.Equal(t, "ApiErrorUnauthorized", response["error"])
				_, response = loginTOTPTest(t, r, totpTestPassword, "")
				if pw {
					require.Equal(t, "ApiErrorTOTPRequired", response["error"])
					_, response = loginTOTPTest(t, r, totpTestPassword, codes[1])
				}
				require.Equal(t, true, response["success"])
				require.NoError(t, singleton.DB.First(user, user.ID).Error)
				// Turning password MFA off must never re-enable an account that rejects password login.
				require.NoError(t, singleton.DB.Model(user).UpdateColumn("reject_password", true).Error)
				_, response = loginTOTPTest(t, r, totpTestPassword, codes[2])
				require.Equal(t, "ApiErrorUnauthorized", response["error"])
				// A still-bound factor is required even when both login switches are off.
				_, err = disableTOTP(totpContext(t, user, totpTestPassword, ""))
				require.Error(t, err)
			})
		}
	}
}

func TestTOTPPolicyMissingFieldsAndUnboundRejected(t *testing.T) {
	user, _ := totpControllerFixture(t)
	off := false
	_, err := updateTOTPLoginPolicy(totpPolicyContext(t, user, totpTestPassword, "", &off, &off))
	require.Error(t, err)
	enableControllerTOTP(t, user)
	codes, hashes, err := singleton.NewTOTPRecovery(user.ID)
	require.NoError(t, err)
	require.NoError(t, singleton.DB.Model(user).UpdateColumn("totp_recovery", hashes).Error)
	for _, fields := range [][2]*bool{{nil, &off}, {&off, nil}, {nil, nil}} {
		_, err = updateTOTPLoginPolicy(totpPolicyContext(t, user, totpTestPassword, codes[0], fields[0], fields[1]))
		require.Error(t, err)
	}
	require.NoError(t, singleton.DB.First(user, user.ID).Error)
	require.False(t, user.TOTPPasswordDisabled)
	require.Equal(t, 10, singleton.TOTPRecoveryCount(user.TOTPRecovery))
	// Old cached clients using the GitHub-only endpoint cannot overwrite the new password policy.
	require.NoError(t, singleton.DB.Model(user).UpdateColumn("totp_password_disabled", true).Error)
	result, err := updateTOTPGitHub(totpPolicyContext(t, user, totpTestPassword, codes[0], nil, &off))
	require.NoError(t, err)
	require.False(t, result.PasswordEnabled)
}

func TestTOTPPolicyMigrationPreservesExistingPasswordProtection(t *testing.T) {
	user, _ := totpControllerFixture(t)
	enableControllerTOTP(t, user)
	secret := user.TOTPSecret
	require.NoError(t, singleton.DB.Migrator().DropColumn(&model.User{}, "TOTPPasswordDisabled"))
	require.NoError(t, singleton.DB.AutoMigrate(&model.User{}))
	require.NoError(t, singleton.DB.First(user, user.ID).Error)
	require.True(t, userTOTPStatus(user).PasswordEnabled)
	require.Equal(t, secret, user.TOTPSecret)
}
