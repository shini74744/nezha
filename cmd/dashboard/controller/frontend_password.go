package controller

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"html"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

const frontendPasswordCookie = "nz-frontend-auth"

type frontendPasswordForm struct {
	Password string `form:"password" json:"password"`
	Next     string `form:"next" json:"next"`
}

func frontendPasswordRequired() bool {
	return singleton.Conf != nil && singleton.Conf.FrontendPasswordHash != ""
}

func frontendPasswordSignature() string {
	mac := hmac.New(sha256.New, []byte(singleton.Conf.JWTSecretKey))
	_, _ = mac.Write([]byte("nezha-frontend-password:" + singleton.Conf.FrontendPasswordHash))
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
	if !frontendPasswordRequired() {
		writeFrontendPasswordSuccess(c, sanitizeFrontendNext(form.Next))
		return
	}
	if bcrypt.CompareHashAndPassword(
		[]byte(singleton.Conf.FrontendPasswordHash),
		[]byte(form.Password),
	) != nil {
		writeFrontendPasswordFailure(c, sanitizeFrontendNext(form.Next), "密码错误")
		return
	}
	writeFrontendPasswordSuccess(c, sanitizeFrontendNext(form.Next))
}
func writeFrontendPasswordSuccess(c *gin.Context, next string) {
	secure := c.Request.URL.Scheme == "https" || c.Request.TLS != nil ||
		strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		frontendPasswordCookie,
		frontendPasswordSignature(),
		30*24*60*60,
		"/",
		"",
		secure,
		true,
	)
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
	next = sanitizeFrontendNext(next)
	errorHTML := ""
	if message != "" {
		errorHTML = `<div class="error">` + html.EscapeString(message) + `</div>`
	}
	siteName := "哪吒监控"
	if singleton.Conf != nil && singleton.Conf.SiteName != "" {
		siteName = singleton.Conf.SiteName
	}
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Header("Cache-Control", "no-store")
	c.Status(status)
	_, _ = c.Writer.WriteString(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>` + html.EscapeString(siteName) + `</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;
font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f5f5f5;color:#171717}
.card{width:min(92vw,380px);background:#fff;border:1px solid #e5e5e5;border-radius:16px;
padding:28px;box-shadow:0 18px 45px rgba(0,0,0,.08)}
h1{font-size:22px;margin:0 0 8px}p{color:#666;margin:0 0 22px}
input{width:100%;height:44px;border:1px solid #d4d4d4;border-radius:9px;padding:0 12px;
font-size:16px}button{width:100%;height:44px;margin-top:14px;border:0;border-radius:9px;
background:#171717;color:white;font-size:15px;font-weight:600;cursor:pointer}
.error{margin:0 0 12px;padding:9px 11px;border-radius:8px;background:#fee2e2;color:#b91c1c}
</style></head><body><main class="card"><h1>` + html.EscapeString(siteName) + `</h1>
<p>请输入前台访问密码</p>` + errorHTML + `
<form method="post" action="/api/v1/frontend-auth">
<input type="hidden" name="next" value="` + html.EscapeString(next) + `">
<input type="password" name="password" autocomplete="current-password" autofocus required>
<button type="submit">进入前台</button></form></main></body></html>`)
}
