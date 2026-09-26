package controller

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	appearance "github.com/nezhahq/nezha/resource/appearance"
	"github.com/nezhahq/nezha/service/singleton"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type dashboardAppearanceForm struct {
	appearanceForm
	SourceCode *string `json:"source_code"`
}

func dashboardAppearanceState() map[string]any {
	c := singleton.Conf
	config := c.DashboardAppearanceConfig
	if config == "" {
		config = `{"version":1,"enabled":false,"features":{}}`
	}
	return map[string]any{"config": json.RawMessage(config), "custom_code": c.CustomCodeDashboard, "archived_code": c.DashboardAppearanceLegacyCode, "revision": appearanceRevision(c.DashboardAppearanceConfig, c.CustomCodeDashboard+"\x00"+c.DashboardAppearanceLegacyCode)}
}
func getDashboardAppearance(c *gin.Context) (any, error) {
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	return dashboardAppearanceState(), nil
}
func validateDashboardAppearance(raw []byte) (string, error) {
	if len(raw) == 0 || len(raw) > 128<<10 {
		return "", errors.New("dashboard config size is invalid")
	}
	var doc appearanceDocument
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&doc); err != nil {
		return "", err
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		return "", errors.New("unexpected trailing JSON")
	}
	var envelope map[string]any
	_ = json.Unmarshal(raw, &envelope)
	if _, ok := envelope["enabled"].(bool); !ok || doc.Version != 1 || doc.Features == nil {
		return "", errors.New("invalid dashboard appearance schema")
	}
	var defs []appearanceDefinition
	if err := json.Unmarshal(appearance.DashboardManifest, &defs); err != nil {
		return "", err
	}
	known := map[string]bool{}
	for _, d := range defs {
		known[d.Key] = true
		f, exists := doc.Features[d.Key]
		if !exists {
			continue
		}
		if f == nil {
			return "", errors.New("invalid dashboard feature")
		}
		if _, ok := f["enabled"].(bool); !ok {
			return "", errors.New("feature enabled must be boolean")
		}
		if err := validateAppearanceValue(d.Key, f, d.Defaults); err != nil {
			return "", err
		}
		for key, limit := range d.Constraints {
			if n, ok := f[key].(float64); ok && (n < limit[0] || n > limit[1]) {
				return "", fmt.Errorf("%s is outside allowed range", key)
			}
		}
		for key, item := range f {
			s, ok := item.(string)
			if !ok {
				continue
			}
			if key == "image" || key == "avatar" || key == "cssUrl" || key == "logo" {
				if s != "" {
					u, err := url.Parse(s)
					if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
						return "", fmt.Errorf("%s URL is invalid", key)
					}
				}
			}
			switch key {
			case "size", "color", "shadow", "position", "repeat", "attachment", "blur", "logoHeight", "backToTopBottom", "backToTopRight":
				if strings.ContainsAny(s, ";{}<>\r\n") || regexp.MustCompile("(?i)url\\s*\\(|expression\\s*\\(|@import").MatchString(s) {
					return "", fmt.Errorf("%s CSS value is invalid", key)
				}
			}
			if key == "timezone" {
				if s == "" {
					return "", errors.New("timezone is required")
				}
				if _, err := time.LoadLocation(s); err != nil {
					return "", errors.New("invalid timezone")
				}
			}
			if (key == "size" && d.Key == "font") || key == "blur" || key == "logoHeight" || key == "backToTopBottom" || key == "backToTopRight" {
				if !regexp.MustCompile("^[0-9]+(\\.[0-9]+)?(px|rem|em|vh|vw|%)$").MatchString(s) {
					return "", fmt.Errorf("%s requires a CSS length", key)
				}
			}
		}
		if n, ok := f["shatterCount"].(float64); ok && math.Trunc(n) != n {
			return "", errors.New("shatter count must be integer")
		}
		if d.Key == "background" {
			for key, choices := range map[string]string{"size": "cover|contain|auto", "attachment": "fixed|scroll|local", "repeat": "no-repeat|repeat|repeat-x|repeat-y|space|round"} {
				if value, ok := f[key].(string); ok && !strings.Contains("|"+choices+"|", "|"+value+"|") {
					return "", fmt.Errorf("invalid background %s", key)
				}
			}
		}
	}
	for key := range doc.Features {
		if !known[key] {
			return "", fmt.Errorf("unknown dashboard feature %s", key)
		}
	}
	normalized, err := json.Marshal(doc)
	return string(normalized), err
}
func updateDashboardAppearance(c *gin.Context) (any, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var form dashboardAppearanceForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, err
	}
	next, err := validateDashboardAppearance(form.Config)
	if err != nil {
		return nil, err
	}
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	conf := singleton.Conf
	err = saveDashboardAppearance(&conf.DashboardAppearanceConfig, &conf.CustomCodeDashboard, &conf.DashboardAppearanceLegacyCode, form, next, conf.Save)
	if err != nil {
		return nil, err
	}
	return dashboardAppearanceState(), nil
}
func saveDashboardAppearance(config, code, archive *string, form dashboardAppearanceForm, next string, save func() error) error {
	if form.Revision != appearanceRevision(*config, *code+"\x00"+*archive) {
		return errors.New("dashboard appearance changed; reload settings")
	}
	if (form.ExpectedCustomCode == nil) != (form.RemainingCustomCode == nil) {
		return errors.New("both migration fields are required")
	}
	nextCode, nextArchive := *code, *archive
	if form.ExpectedCustomCode != nil {
		if *form.ExpectedCustomCode != *code {
			return errors.New("dashboard custom code changed")
		}
		if len(*form.RemainingCustomCode) > 1<<20 {
			return errors.New("custom code too large")
		}
		nextCode = *form.RemainingCustomCode
		if nextCode != *code {
			if *archive != "" && *archive != *code {
				return errors.New("refusing to overwrite archived source")
			}
			nextArchive = *code
		}
	}
	if form.SourceCode != nil && *form.SourceCode != "" {
		if len(*form.SourceCode) > 1<<20 {
			return errors.New("source code too large")
		}
		if *code != "" && *form.SourceCode != *code {
			return errors.New("imported source differs from current custom code")
		}
		if nextArchive != "" && nextArchive != *form.SourceCode {
			return errors.New("refusing to overwrite archived source")
		}
		nextArchive = *form.SourceCode
	}
	if *config == next && *code == nextCode && *archive == nextArchive {
		return nil
	}
	oldConfig, oldCode, oldArchive := *config, *code, *archive
	*config, *code, *archive = next, nextCode, nextArchive
	if err := save(); err != nil {
		*config, *code, *archive = oldConfig, oldCode, oldArchive
		return err
	}
	return nil
}
