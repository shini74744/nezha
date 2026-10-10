package controller

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type totpForm struct {
	Password        string `json:"password"`
	Code            string `json:"code"`
	GitHubEnabled   *bool  `json:"github_enabled,omitempty"`
	PasswordEnabled *bool  `json:"password_enabled,omitempty"`
}
type totpStatus struct {
	Enabled           bool `json:"enabled"`
	RecoveryRemaining int  `json:"recovery_remaining"`
	GitHubEnabled     bool `json:"github_enabled"`
	PasswordEnabled   bool `json:"password_enabled"`
}
type totpCodes struct {
	RecoveryCodes []string `json:"recovery_codes"`
}

func getTOTPStatus(c *gin.Context) (*totpStatus, error) {
	c.Header("Cache-Control", "no-store")
	user := c.MustGet(model.CtxKeyAuthorizedUser).(*model.User)
	return userTOTPStatus(user), nil
}
func totpCredentials(c *gin.Context) (*model.User, totpForm, error) {
	c.Header("Cache-Control", "no-store")
	var form totpForm
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, form, errors.New("请填写当前密码和验证码")
	}
	if len(form.Password) > 72 || len(form.Code) > 64 {
		return nil, form, errors.New("输入内容过长")
	}
	auth := c.MustGet(model.CtxKeyAuthorizedUser).(*model.User)
	var user model.User
	if err := singleton.DB.First(&user, auth.ID).Error; err != nil {
		return nil, form, errors.New("账号状态已变化，请重新登录")
	}
	if user.TokenVersion != auth.TokenVersion || c.GetString(jwtClaimKeyID) == "" {
		return nil, form, errors.New("请重新登录")
	}
	if bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(form.Password)) != nil {
		model.BlockIP(singleton.DB, c.GetString(model.CtxKeyRealIPStr), model.WAFBlockReasonTypeLoginFail, int64(user.ID))
		return nil, form, errors.New("当前密码不正确")
	}
	return &user, form, nil
}
func beginTOTP(c *gin.Context) (*singleton.TOTPSetup, error) {
	user, _, err := totpCredentials(c)
	if err != nil {
		return nil, err
	}
	if user.TOTPEnabled {
		return nil, errors.New("验证器已启用；更换前请先验证并关闭")
	}
	return singleton.BeginTOTP(user, time.Now())
}

// Rotate the account session epoch atomically with the factor change. Preserve
// only the verified caller's current browser session; concurrent password
// logins made before enrollment or a GitHub policy change become invalid.
func saveTOTPChange(c *gin.Context, user *model.User, updates map[string]any, pending bool) error {
	return singleton.DB.Transaction(func(tx *gorm.DB) error {
		query := tx.Model(&model.User{}).Where("id = ? AND token_version = ? AND password = ? AND totp_enabled = ?", user.ID, user.TokenVersion, user.Password, user.TOTPEnabled)
		if pending {
			query = query.Where("totp_pending = ? AND totp_pending_until > ?", user.TOTPPending, time.Now().Unix())
		} else {
			query = query.Where("totp_secret = ?", user.TOTPSecret)
		}
		updates["token_version"] = gorm.Expr("token_version + 1")
		updates["totp_attempts"] = 0
		updates["totp_window_start"] = 0
		result := query.UpdateColumns(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("账号状态已变化，请刷新后重试")
		}
		key := c.GetString(jwtClaimKeyID)
		if err := tx.Model(&model.JWTSession{}).Where("user_id = ? AND key_id <> ? AND revoked_at IS NULL", user.ID, key).Update("revoked_at", time.Now()).Error; err != nil {
			return err
		}
		result = tx.Model(&model.JWTSession{}).Where("user_id = ? AND key_id = ? AND revoked_at IS NULL", user.ID, key).Update("token_version", user.TokenVersion+1)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("当前会话已失效，请重新登录")
		}
		return nil
	})
}
func confirmTOTP(c *gin.Context) (*totpCodes, error) {
	user, form, err := totpCredentials(c)
	if err != nil {
		return nil, err
	}
	step, err := singleton.PendingTOTPStep(user, form.Code, time.Now())
	if err != nil {
		return nil, err
	}
	codes, hashes, err := singleton.NewTOTPRecovery(user.ID)
	if err != nil {
		return nil, err
	}
	err = saveTOTPChange(c, user, map[string]any{"totp_enabled": true, "totp_password_disabled": false, "totp_github": false, "totp_secret": user.TOTPPending, "totp_pending": "", "totp_pending_until": 0, "totp_last_step": step, "totp_recovery": hashes}, true)
	if err != nil {
		return nil, err
	}
	return &totpCodes{RecoveryCodes: codes}, nil
}
func disableTOTP(c *gin.Context) (any, error) {
	user, form, err := totpCredentials(c)
	if err != nil {
		return nil, err
	}
	if err = singleton.VerifyUserTOTP(singleton.DB, user, form.Code, time.Now()); err != nil {
		return nil, err
	}
	return nil, saveTOTPChange(c, user, map[string]any{"totp_enabled": false, "totp_github": false, "totp_password_disabled": false, "totp_secret": "", "totp_pending": "", "totp_pending_until": 0, "totp_last_step": 0, "totp_recovery": ""}, false)
}
func regenerateTOTPRecovery(c *gin.Context) (*totpCodes, error) {
	user, form, err := totpCredentials(c)
	if err != nil {
		return nil, err
	}
	if err = singleton.VerifyUserTOTP(singleton.DB, user, form.Code, time.Now()); err != nil {
		return nil, err
	}
	codes, hashes, err := singleton.NewTOTPRecovery(user.ID)
	if err != nil {
		return nil, err
	}
	if err = saveTOTPChange(c, user, map[string]any{"totp_recovery": hashes}, false); err != nil {
		return nil, err
	}
	return &totpCodes{RecoveryCodes: codes}, nil
}

func cancelTOTP(c *gin.Context) (any, error) {
	user, _, err := totpCredentials(c)
	if err != nil {
		return nil, err
	}
	if user.TOTPEnabled {
		return nil, errors.New("验证器已启用，请验证后关闭")
	}
	result := singleton.DB.Model(&model.User{}).Where("id = ? AND totp_enabled = ? AND token_version = ?", user.ID, false, user.TokenVersion).UpdateColumns(map[string]any{"totp_pending": "", "totp_pending_until": 0})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, errors.New("账号状态已变化，请刷新后重试")
	}
	return nil, nil
}

func userTOTPStatus(user *model.User) *totpStatus {
	return &totpStatus{Enabled: user.TOTPEnabled, PasswordEnabled: user.TOTPEnabled && !user.TOTPPasswordDisabled, GitHubEnabled: user.TOTPEnabled && user.TOTPGitHub, RecoveryRemaining: singleton.TOTPRecoveryCount(user.TOTPRecovery)}
}

// Keep the previous GitHub-only endpoint compatible with already-loaded clients.
func updateTOTPGitHub(c *gin.Context) (*totpStatus, error) {
	return updateTOTPPolicy(c, false)
}

func updateTOTPLoginPolicy(c *gin.Context) (*totpStatus, error) {
	return updateTOTPPolicy(c, true)
}

// Even when both login switches are off, changing or removing the stored factor
// still requires its proof. Turning login protection off does not erase the binding.
func updateTOTPPolicy(c *gin.Context, requirePasswordPolicy bool) (*totpStatus, error) {
	user, form, err := totpCredentials(c)
	if err != nil {
		return nil, err
	}
	if !user.TOTPEnabled {
		return nil, errors.New("请先绑定并启用身份验证器")
	}
	if form.GitHubEnabled == nil || (requirePasswordPolicy && form.PasswordEnabled == nil) {
		return nil, errors.New("请选择登录验证状态")
	}
	if err = singleton.VerifyUserTOTP(singleton.DB, user, form.Code, time.Now()); err != nil {
		return nil, err
	}
	updates := map[string]any{"totp_github": *form.GitHubEnabled}
	if requirePasswordPolicy {
		updates["totp_password_disabled"] = !*form.PasswordEnabled
	}
	if err = saveTOTPChange(c, user, updates, false); err != nil {
		return nil, err
	}
	if err = singleton.DB.First(user, user.ID).Error; err != nil {
		return nil, err
	}
	return userTOTPStatus(user), nil
}
