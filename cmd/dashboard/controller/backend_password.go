package controller

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// #nosec G101 -- Public cookie name only; credentials are expiring, purpose/IP/password-bound HMACs.
const backendPasswordCookie = "nz-backend-auth"
const backendAccessHeader = "X-Nezha-Backend-Access"

var backendAttemptLocks [64]sync.Mutex
var backendPasswordWorkers = make(chan struct{}, 2)

type backendAccessConfig struct {
	Hash, Secret, Site   string
	Failures, BanMinutes int
	Schedule             model.AccessPasswordSchedule
}

func currentBackendAccessConfig() backendAccessConfig {
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	return backendAccessConfigLocked()
}
func backendAccessConfigLocked() backendAccessConfig {
	cfg := backendAccessConfig{Failures: 1, BanMinutes: 15}
	if singleton.Conf == nil {
		return cfg
	}
	cfg.Schedule = singleton.Conf.BackendPasswordSchedule
	cfg.Hash, cfg.Secret, cfg.Site = singleton.Conf.BackendPasswordHash, singleton.Conf.JWTSecretKey, singleton.Conf.SiteName
	if n := singleton.Conf.BackendPasswordFailures; n >= 1 && n <= 100 {
		cfg.Failures = n
	}
	if n := singleton.Conf.BackendPasswordBanMinutes; n >= 1 && n <= 10080 {
		cfg.BanMinutes = n
	}
	return cfg
}
func backendPasswordRequiredAt(cfg backendAccessConfig, now time.Time) bool {
	return cfg.Hash != "" && cfg.Schedule.ActiveAt(now)
}
func backendClientIP(c *gin.Context) string {
	ip := c.GetString(model.CtxKeyRealIPStr)
	if ip == "" {
		ip = c.RemoteIP()
	} // Never trust arbitrary X-Forwarded-For as a fallback.
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return ""
	}
	return addr.Unmap().String()
}
func accessCookieSecure(c *gin.Context) bool {
	return c.Request.TLS != nil || c.Request.URL.Scheme == "https" || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
}
func backendSign(c *gin.Context, cfg backendAccessConfig, purpose, expiry string) string {
	mac := hmac.New(sha256.New, []byte(cfg.Secret))
	_, _ = mac.Write([]byte("nezha-backend:" + purpose + ":" + cfg.Hash + ":" + backendClientIP(c) + ":" + expiry))
	return hex.EncodeToString(mac.Sum(nil))
}
func issueBackendToken(c *gin.Context, cfg backendAccessConfig, purpose string, ttl time.Duration) string {
	expiry := strconv.FormatInt(time.Now().Add(ttl).Unix(), 10)
	return expiry + "." + backendSign(c, cfg, purpose, expiry)
}
func validBackendToken(c *gin.Context, cfg backendAccessConfig, token, purpose string, ttl time.Duration) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 2 || cfg.Secret == "" || backendClientIP(c) == "" {
		return false
	}
	expiry, err := strconv.ParseInt(parts[0], 10, 64)
	now := time.Now().Unix()
	return err == nil && expiry > now && expiry <= now+int64(ttl.Seconds()) &&
		hmac.Equal([]byte(parts[1]), []byte(backendSign(c, cfg, purpose, parts[0])))
}
func validBackendCookie(c *gin.Context, cfg backendAccessConfig) bool {
	value, err := c.Cookie(backendPasswordCookie)
	return err == nil && validBackendToken(c, cfg, value, "access", 8*time.Hour)
}
func writeBackendCookie(c *gin.Context, cfg backendAccessConfig) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(backendPasswordCookie, issueBackendToken(c, cfg, "access", 8*time.Hour), 8*60*60, "/", "", accessCookieSecure(c), true)
}
func backendCredentialVersion(cfg backendAccessConfig) string {
	hash := sha256.Sum256([]byte(cfg.Hash))
	return hex.EncodeToString(hash[:])
}
func backendAttempt(c *gin.Context, cfg backendAccessConfig) (model.BackendAccessAttempt, error) {
	ip := backendClientIP(c)
	if ip == "" || singleton.DB == nil {
		return model.BackendAccessAttempt{}, errors.New("backend access unavailable")
	}
	var row model.BackendAccessAttempt
	err := singleton.DB.Where("ip = ?", ip).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = nil
	}
	if row.CredentialVersion != backendCredentialVersion(cfg) || row.ExpiresAt <= time.Now().Unix() {
		row = model.BackendAccessAttempt{IP: ip, CredentialVersion: backendCredentialVersion(cfg)}
	}
	return row, err
}
func sanitizeBackendNext(next string) string {
	u, err := url.Parse(next)
	if err != nil || u.IsAbs() || u.Host != "" || strings.ContainsAny(next, "\\\r\n") || !strings.HasPrefix(u.Path, "/dashboard/") {
		return "/dashboard/"
	}
	return u.RequestURI()
}
func backendFailure(c *gin.Context, cfg backendAccessConfig, next, message string, status int, retry int64) {
	code := "required"
	if status == http.StatusTooManyRequests {
		code = "blocked"
	}
	if status == http.StatusServiceUnavailable {
		code = "unavailable"
	}
	c.Header(backendAccessHeader, code)
	c.Header("Cache-Control", "no-store")
	if retry > 0 {
		c.Header("Retry-After", strconv.FormatInt(retry, 10))
	}
	if wantsHTML(c) || strings.HasPrefix(c.Request.URL.Path, "/dashboard") {
		serveAccessPasswordPage(c, accessPasswordPage{Backend: true, Next: sanitizeBackendNext(next), Message: message, Site: cfg.Site,
			Disabled: status == http.StatusTooManyRequests || status == http.StatusServiceUnavailable,
			CSRF:     issueBackendToken(c, cfg, "form", 20*time.Minute), Failures: cfg.Failures, BanMinutes: cfg.BanMinutes}, status)
	} else {
		c.JSON(status, model.CommonResponse[any]{Success: false, Error: "backend password " + code})
	}
	c.Abort()
}

// Enforce a ban even for an already-unlocked browser on that IP.
func checkBackendAccess(c *gin.Context, cfg backendAccessConfig, next string) bool {
	if cfg.Hash == "" {
		return true
	}
	row, err := backendAttempt(c, cfg)
	if err != nil {
		backendFailure(c, cfg, next, "访问验证暂不可用，请稍后再试", http.StatusServiceUnavailable, 5)
		return false
	}
	if seconds := row.BannedUntil - time.Now().Unix(); seconds > 0 {
		backendFailure(c, cfg, next, fmt.Sprintf("此 IP 已暂时禁止访问后台，约 %d 分钟后可重试。", (seconds+59)/60), http.StatusTooManyRequests, seconds)
		return false
	}
	if !backendPasswordRequiredAt(cfg, time.Now()) || validBackendCookie(c, cfg) {
		return true
	}
	backendFailure(c, cfg, next, "", http.StatusForbidden, 0)
	return false
}
func backendPasswordGate() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Exemption relies on an authenticated PAT, never an Authorization header alone.
		if APITokenFromContext(c) != nil {
			c.Next()
			return
		}
		// These two identity endpoints are also used by the public frontend.
		if (c.Request.Method == http.MethodGet && c.FullPath() == "/api/v1/profile") ||
			(c.Request.Method == http.MethodPost && c.FullPath() == "/api/v1/refresh-token") {
			c.Next()
			return
		}
		if checkBackendAccess(c, currentBackendAccessConfig(), "/dashboard/") {
			c.Next()
		}
	}
}
func backendPasswordLogin(c *gin.Context) {
	cfg := currentBackendAccessConfig()
	if !backendPasswordRequiredAt(cfg, time.Now()) {
		if !checkBackendAccess(c, cfg, "/dashboard/") {
			return
		}
		// An unprotected time window must never mint a password-verification cookie.
		if wantsHTML(c) {
			c.Redirect(http.StatusSeeOther, "/dashboard/")
		} else {
			c.JSON(http.StatusOK, model.CommonResponse[any]{Success: true})
		}
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	var form struct {
		Password string `form:"password" json:"password"`
		Next     string `form:"next" json:"next"`
		CSRF     string `form:"csrf" json:"csrf"`
	}
	if err := c.ShouldBind(&form); err != nil {
		backendFailure(c, cfg, "/dashboard/", "请求无效，请刷新后重试", http.StatusBadRequest, 0)
		return
	}
	next := sanitizeBackendNext(form.Next)
	origin := c.GetHeader("Origin")
	if origin != "" {
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || !strings.EqualFold(u.Host, c.Request.Host) {
			backendFailure(c, cfg, next, "请求来源无效，请刷新后重试", http.StatusForbidden, 0)
			return
		}
	}
	if c.GetHeader("Sec-Fetch-Site") == "cross-site" || !validBackendToken(c, cfg, form.CSRF, "form", 20*time.Minute) {
		backendFailure(c, cfg, next, "验证页面已过期，请刷新后重试", http.StatusForbidden, 0)
		return
	}
	if len(form.Password) == 0 || len(form.Password) > 72 {
		backendFailure(c, cfg, next, "请输入密码（最多 72 字节）", http.StatusBadRequest, 0)
		return
	}
	select {
	case backendPasswordWorkers <- struct{}{}:
		defer func() { <-backendPasswordWorkers }()
	default:
		backendFailure(c, cfg, next, "验证繁忙，请稍后再试", http.StatusServiceUnavailable, 2)
		return
	}
	shard := sha256.Sum256([]byte(backendClientIP(c)))
	lock := &backendAttemptLocks[int(shard[0])%len(backendAttemptLocks)]
	lock.Lock()
	defer lock.Unlock()
	row, err := backendAttempt(c, cfg)
	if err != nil {
		backendFailure(c, cfg, next, "访问验证暂不可用，请稍后再试", http.StatusServiceUnavailable, 5)
		return
	}
	if row.BannedUntil > time.Now().Unix() {
		backendFailure(c, cfg, next, "此 IP 已暂时禁止访问后台，请等待封禁到期。", http.StatusTooManyRequests, row.BannedUntil-time.Now().Unix())
		return
	}
	correct := bcrypt.CompareHashAndPassword([]byte(cfg.Hash), []byte(form.Password)) == nil
	// A concurrently saved password must not issue a cookie for the superseded value.
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	if backendAccessConfigLocked() != cfg {
		backendFailure(c, cfg, next, "访问设置已更新，请刷新后重试", http.StatusConflict, 0)
		return
	}
	if !backendPasswordRequiredAt(cfg, time.Now()) {
		if wantsHTML(c) {
			c.Redirect(http.StatusSeeOther, next)
		} else {
			c.JSON(http.StatusOK, model.CommonResponse[any]{Success: true})
		}
		return
	}
	if correct {
		if err := singleton.DB.Where("ip = ?", row.IP).Delete(&model.BackendAccessAttempt{}).Error; err != nil {
			backendFailure(c, cfg, next, "访问验证暂不可用，请稍后再试", http.StatusServiceUnavailable, 5)
			return
		}
		writeBackendCookie(c, cfg)
		if wantsHTML(c) {
			c.Redirect(http.StatusSeeOther, next)
		} else {
			c.JSON(http.StatusOK, model.CommonResponse[any]{Success: true})
		}
		return
	}
	now := time.Now().Unix()
	row.Failures++
	row.ExpiresAt = now + 15*60 // Consecutive failures expire after 15 minutes without an attempt.
	if row.Failures >= cfg.Failures {
		row.BannedUntil = now + int64(cfg.BanMinutes)*60
		row.ExpiresAt = row.BannedUntil
	}
	err = singleton.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("expires_at <= ?", now).Delete(&model.BackendAccessAttempt{}).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&model.BackendAccessAttempt{}).Count(&count).Error; err != nil {
			return err
		}
		if count >= 10000 {
			var exists int64
			if err := tx.Model(&model.BackendAccessAttempt{}).Where("ip = ?", row.IP).Count(&exists).Error; err != nil {
				return err
			}
			if exists == 0 {
				return errors.New("backend attempt capacity reached")
			}
		}
		return tx.Save(&row).Error
	})
	if err != nil {
		backendFailure(c, cfg, next, "访问验证暂不可用，请稍后再试", http.StatusServiceUnavailable, 5)
		return
	}
	if row.BannedUntil > now {
		backendFailure(c, cfg, next, fmt.Sprintf("密码错误，已封禁此 IP 的后台访问 %d 分钟。", cfg.BanMinutes), http.StatusTooManyRequests, row.BannedUntil-now)
	} else {
		backendFailure(c, cfg, next, fmt.Sprintf("密码错误，再输错 %d 次将封禁此 IP。", cfg.Failures-row.Failures), http.StatusUnauthorized, 0)
	}
}
