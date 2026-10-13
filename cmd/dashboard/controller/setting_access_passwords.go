package controller

import (
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"golang.org/x/crypto/bcrypt"
	"io"
	"net/http"
)

type accessPasswordSettings struct {
	FrontendSchedule model.AccessPasswordSchedule `json:"frontend_password_schedule"`
	BackendSchedule  model.AccessPasswordSchedule `json:"backend_password_schedule"`
	FrontendRequired bool                         `json:"frontend_password_required"`
	BackendRequired  bool                         `json:"backend_password_required"`
	Failures         int                          `json:"backend_password_failures"`
	BanMinutes       int                          `json:"backend_password_ban_minutes"`
}

func accessPasswordSettingsLocked() accessPasswordSettings {
	cfg := backendAccessConfigLocked()
	return accessPasswordSettings{FrontendRequired: singleton.Conf.FrontendPasswordHash != "", BackendRequired: cfg.Hash != "", Failures: cfg.Failures, BanMinutes: cfg.BanMinutes, FrontendSchedule: singleton.Conf.FrontendPasswordSchedule.WithDefaults(), BackendSchedule: cfg.Schedule.WithDefaults()}
}
func getAccessPasswordSettings(c *gin.Context) (any, error) {
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	return accessPasswordSettingsLocked(), nil
}
func updateAccessPasswordSettings(c *gin.Context) (any, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	var form struct {
		FrontendSchedule *model.AccessPasswordSchedule `json:"frontend_password_schedule"`
		BackendSchedule  *model.AccessPasswordSchedule `json:"backend_password_schedule"`
		Frontend         *string                       `json:"frontend_password"`
		ClearFrontend    bool                          `json:"clear_frontend_password"`
		Backend          *string                       `json:"backend_password"`
		ClearBackend     bool                          `json:"clear_backend_password"`
		Failures         *int                          `json:"backend_password_failures"`
		BanMinutes       *int                          `json:"backend_password_ban_minutes"`
	}
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&form); err != nil {
		return nil, err
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		return nil, errors.New("unexpected trailing JSON")
	}
	if form.Frontend == nil && form.Backend == nil && !form.ClearFrontend && !form.ClearBackend && form.Failures == nil && form.BanMinutes == nil && form.FrontendSchedule == nil && form.BackendSchedule == nil {
		return nil, errors.New("请选择要修改的访问设置")
	}
	if form.Failures != nil && (*form.Failures < 1 || *form.Failures > 100) {
		return nil, errors.New("错误次数应为 1–100 次")
	}
	if form.BanMinutes != nil && (*form.BanMinutes < 1 || *form.BanMinutes > 10080) {
		return nil, errors.New("封禁时长应为 1–10080 分钟")
	}
	for _, schedule := range []*model.AccessPasswordSchedule{form.FrontendSchedule, form.BackendSchedule} {
		if schedule != nil {
			if err := schedule.Validate(); err != nil {
				return nil, err
			}
			*schedule = schedule.WithDefaults()
		}
	}
	hash := func(password *string, clear bool) (string, error) {
		if clear && password != nil && *password != "" {
			return "", errors.New("设置新密码与清除密码不能同时选择")
		}
		if password == nil || *password == "" {
			return "", nil
		}
		if len(*password) > 72 {
			return "", errors.New("密码最多 72 字节")
		}
		value, err := bcrypt.GenerateFromPassword([]byte(*password), bcrypt.DefaultCost)
		return string(value), err
	}
	front, err := hash(form.Frontend, form.ClearFrontend)
	if err != nil {
		return nil, err
	}
	back, err := hash(form.Backend, form.ClearBackend)
	if err != nil {
		return nil, err
	}
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	conf := singleton.Conf
	oldFrontSchedule, oldBackSchedule := conf.FrontendPasswordSchedule, conf.BackendPasswordSchedule
	oldFront, oldBack, oldFailures, oldMinutes := conf.FrontendPasswordHash, conf.BackendPasswordHash, conf.BackendPasswordFailures, conf.BackendPasswordBanMinutes
	if form.ClearFrontend {
		conf.FrontendPasswordHash = ""
	} else if front != "" {
		conf.FrontendPasswordHash = front
	}
	if form.ClearBackend {
		conf.BackendPasswordHash = ""
	} else if back != "" {
		conf.BackendPasswordHash = back
	}
	if form.Failures != nil {
		conf.BackendPasswordFailures = *form.Failures
	}
	if form.BanMinutes != nil {
		conf.BackendPasswordBanMinutes = *form.BanMinutes
	}
	if form.FrontendSchedule != nil {
		conf.FrontendPasswordSchedule = *form.FrontendSchedule
	}
	if form.BackendSchedule != nil {
		conf.BackendPasswordSchedule = *form.BackendSchedule
	}
	if err := conf.Save(); err != nil {
		conf.FrontendPasswordSchedule, conf.BackendPasswordSchedule = oldFrontSchedule, oldBackSchedule
		conf.FrontendPasswordHash, conf.BackendPasswordHash, conf.BackendPasswordFailures, conf.BackendPasswordBanMinutes = oldFront, oldBack, oldFailures, oldMinutes
		return nil, err
	}
	// Keep the saving browser usable after enabling or rotating the entry password.
	if back != "" {
		writeBackendCookie(c, backendAccessConfigLocked())
	}
	if form.ClearBackend {
		c.SetSameSite(http.SameSiteLaxMode)
		c.SetCookie(backendPasswordCookie, "", -1, "/", "", accessCookieSecure(c), true)
	}
	return accessPasswordSettingsLocked(), nil
}
