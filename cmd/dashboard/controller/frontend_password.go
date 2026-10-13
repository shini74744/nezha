package controller

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

// #nosec G101 -- Public cookie name only; the credential is a runtime HMAC, not this identifier.
const frontendPasswordCookie = "nz-frontend-auth"

type frontendPasswordForm struct {
	Password string `form:"password" json:"password"`
	Next     string `form:"next" json:"next"`
}

func frontendPasswordRequired() bool {
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	return frontendPasswordRequiredLocked(time.Now())
}
func frontendPasswordRequiredLocked(now time.Time) bool {
	return singleton.Conf != nil && singleton.Conf.FrontendPasswordHash != "" && singleton.Conf.FrontendPasswordSchedule.ActiveAt(now)
}

func frontendPasswordSignature() string {
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	return frontendSignature(singleton.Conf.JWTSecretKey, singleton.Conf.FrontendPasswordHash)
}
func frontendSignature(secret, hash string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte("nezha-frontend-password:" + hash))
	return hex.EncodeToString(mac.Sum(nil))
}

func validFrontendPasswordCookie(c *gin.Context) bool {
	value, err := c.Cookie(frontendPasswordCookie)
	if err != nil {
		return false
	}
	expected := frontendPasswordSignature()
	return hmac.Equal([]byte(value), []byte(expected))
}
func frontendPasswordGate() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !frontendPasswordRequired() {
			c.Next()
			return
		}
		if _, authorized := c.Get(model.CtxKeyAuthorizedUser); authorized {
			c.Next()
			return
		}
		if validFrontendPasswordCookie(c) {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusUnauthorized, model.CommonResponse[any]{
			Success: false,
			Error:   "frontend password required",
		})
	}
}

func frontendPasswordLogin(c *gin.Context) {
	var form frontendPasswordForm
	if err := c.ShouldBind(&form); err != nil {
		writeFrontendPasswordFailure(c, "/", "请输入前台密码")
		return
	}
	settingsMutationMu.Lock()
	passwordHash, secret := singleton.Conf.FrontendPasswordHash, singleton.Conf.JWTSecretKey
	required := frontendPasswordRequiredLocked(time.Now())
	settingsMutationMu.Unlock()
	if !required {
		// Do not grant a credential that remains usable when the protected window begins.
		finishFrontendPasswordSuccess(c, sanitizeFrontendNext(form.Next))
		return
	}
	if bcrypt.CompareHashAndPassword(
		[]byte(passwordHash),
		[]byte(form.Password),
	) != nil {
		writeFrontendPasswordFailure(c, sanitizeFrontendNext(form.Next), "密码错误")
		return
	}
	settingsMutationMu.Lock()
	changed := passwordHash != singleton.Conf.FrontendPasswordHash || secret != singleton.Conf.JWTSecretKey
	settingsMutationMu.Unlock()
	if changed {
		writeFrontendPasswordFailure(c, sanitizeFrontendNext(form.Next), "访问设置已更新，请重试")
		return
	}
	writeFrontendPasswordSuccessWithSignature(c, sanitizeFrontendNext(form.Next), frontendSignature(secret, passwordHash))
}
func writeFrontendPasswordSuccess(c *gin.Context, next string) {
	writeFrontendPasswordSuccessWithSignature(c, next, frontendPasswordSignature())
}
func writeFrontendPasswordSuccessWithSignature(c *gin.Context, next, signature string) {
	secure := c.Request.URL.Scheme == "https" || c.Request.TLS != nil ||
		strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		frontendPasswordCookie,
		signature,
		30*24*60*60,
		"/",
		"",
		secure,
		true,
	)
	finishFrontendPasswordSuccess(c, next)
}
func finishFrontendPasswordSuccess(c *gin.Context, next string) {
	if wantsHTML(c) {
		c.Redirect(http.StatusSeeOther, next)
		return
	}
	c.JSON(http.StatusOK, model.CommonResponse[any]{Success: true})
}

func writeFrontendPasswordFailure(c *gin.Context, next, message string) {
	if wantsHTML(c) {
		serveFrontendPasswordPage(c, next, message, http.StatusUnauthorized)
		return
	}
	c.JSON(http.StatusUnauthorized, model.CommonResponse[any]{
		Success: false,
		Error:   "invalid frontend password",
	})
}

func wantsHTML(c *gin.Context) bool {
	return strings.Contains(c.GetHeader("Accept"), "text/html") ||
		strings.Contains(c.GetHeader("Content-Type"), "application/x-www-form-urlencoded")
}
func sanitizeFrontendNext(next string) string {
	next = strings.TrimSpace(next)
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
		return "/"
	}
	if strings.HasPrefix(next, "/dashboard") || strings.HasPrefix(next, "/api/") {
		return "/"
	}
	return next
}

func serveFrontendPasswordPage(c *gin.Context, next, message string, status int) {
	settingsMutationMu.Lock()
	site := singleton.Conf.SiteName
	settingsMutationMu.Unlock()
	serveAccessPasswordPage(c, accessPasswordPage{Next: sanitizeFrontendNext(next), Message: message, Site: site}, status)
}
