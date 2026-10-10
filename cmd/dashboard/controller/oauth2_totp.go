package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	jwt "github.com/appleboy/gin-jwt/v2"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/utils"
	"github.com/nezhahq/nezha/service/singleton"
)

const oauthTOTPCookie = "nz-o2-mfa"

var errOAuthTOTPExpired = errors.New("GitHub 验证已失效，请重新使用 GitHub 登录")

// This is not a login session and is never accepted by JWT/PAT middleware.
// Entries are short-lived, process-local and single-use; restarting fails closed.
type oauthTOTPChallenge struct {
	mu           sync.Mutex
	UserID       uint64
	TokenVersion uint64
	Expires      time.Time
	UA           string
	IP           string
	Used         bool
}

func oauthTOTPKey(token string) string {
	digest := sha256.Sum256([]byte(token))
	return "oauth-totp:" + hex.EncodeToString(digest[:])
}
func writeOAuthTOTPCookie(c *gin.Context, token string, maxAge int) {
	secure := c.Request.TLS != nil || c.Request.URL.Scheme == "https" || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(oauthTOTPCookie, token, maxAge, "/api/v1/oauth2", "", secure, true)
}

func beginOAuthTOTP(c *gin.Context, user *model.User) (any, error) {
	c.Header("Cache-Control", "no-store")
	if !user.TOTPEnabled || !user.TOTPGitHub || singleton.Cache == nil {
		return nil, errOAuthTOTPExpired
	}
	token, err := utils.GenerateRandomString(32)
	if err != nil {
		return nil, err
	}
	if old, err := c.Cookie(oauthTOTPCookie); err == nil {
		singleton.Cache.Delete(oauthTOTPKey(old))
	}
	singleton.Cache.Set(oauthTOTPKey(token), &oauthTOTPChallenge{
		UserID: user.ID, TokenVersion: user.TokenVersion, Expires: time.Now().Add(5 * time.Minute),
		UA: uaHash(c), IP: c.GetString(model.CtxKeyRealIPStr),
	}, 5*time.Minute)
	// A pending OAuth result must not be mistaken for a completed browser login.
	c.SetCookie("nz-jwt", "", -1, "/", "", false, false)
	writeOAuthTOTPCookie(c, token, 300)
	setCSRFCookie(c)
	c.Redirect(http.StatusFound, "/dashboard/login?oauth2_totp=1")
	return nil, errNoop
}

func verifyOAuthTOTP(jwtConfig *jwt.GinJWTMiddleware) func(*gin.Context) (*model.LoginResponse, error) {
	return func(c *gin.Context) (*model.LoginResponse, error) {
		c.Header("Cache-Control", "no-store")
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
		var form struct {
			Code string `json:"code"`
		}
		if err := c.ShouldBindJSON(&form); err != nil || len(form.Code) > 64 {
			return nil, singleton.ErrTOTPInvalid
		}
		token, err := c.Cookie(oauthTOTPCookie)
		if err != nil || len(token) != 32 || singleton.Cache == nil {
			return nil, errOAuthTOTPExpired
		}
		value, exists := singleton.Cache.Get(oauthTOTPKey(token))
		challenge, ok := value.(*oauthTOTPChallenge)
		if !exists || !ok {
			return nil, errOAuthTOTPExpired
		}
		challenge.mu.Lock()
		defer challenge.mu.Unlock()
		if challenge.Used || !time.Now().Before(challenge.Expires) || challenge.UA != uaHash(c) ||
			(!singleton.Conf.JWTIPChangeAllowed() && challenge.IP != c.GetString(model.CtxKeyRealIPStr)) {
			return nil, errOAuthTOTPExpired
		}
		var user model.User
		if err := singleton.DB.First(&user, challenge.UserID).Error; err != nil {
			return nil, errOAuthTOTPExpired
		}
		if !user.TOTPEnabled || !user.TOTPGitHub || user.TokenVersion != challenge.TokenVersion {
			return nil, errOAuthTOTPExpired
		}
		if err := singleton.VerifyUserTOTP(singleton.DB, &user, form.Code, time.Now()); err != nil {
			return nil, err
		}
		challenge.Used = true
		singleton.Cache.Delete(oauthTOTPKey(token))
		writeOAuthTOTPCookie(c, "", -1)
		claims, err := issueJWTSession(c, &user, singleton.Conf.JWTTimeout)
		if err != nil {
			return nil, err
		}
		signed, expire, err := jwtConfig.TokenGenerator(claims)
		if err != nil {
			return nil, err
		}
		jwtConfig.SetCookie(c, signed)
		setCSRFCookie(c)
		return &model.LoginResponse{Token: signed, Expire: expire.Format(time.RFC3339)}, nil
	}
}
