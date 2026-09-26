package controller

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/service/singleton"
)

var settingsMutationMu sync.Mutex

// Appearance writes are isolated from server identity, credentials and agent settings.
type appearanceDocument struct {
	Version  int                       `json:"version"`
	Enabled  bool                      `json:"enabled"`
	Features map[string]map[string]any `json:"features"`
}
type appearanceForm struct {
	Revision string          `json:"revision"`
	Config   json.RawMessage `json:"config"`
	// Only supplied when replacing inspected legacy custom code during migration.
	ExpectedCustomCode  *string `json:"expected_custom_code"`
	RemainingCustomCode *string `json:"remaining_custom_code"`
}

func appearanceRevision(config, code string) string {
	sum := sha256.Sum256([]byte(config + "\x00" + code))
	return hex.EncodeToString(sum[:])
}
func appearanceState() map[string]any {
	config := singleton.Conf.AppearanceConfig
	if config == "" {
		config = `{"version":1,"enabled":false,"features":{}}`
	}
	return map[string]any{
		"config":           json.RawMessage(config),
		"custom_code":      singleton.Conf.CustomCode,
		"current_template": singleton.Conf.UserTemplate,
		"revision":         appearanceRevision(singleton.Conf.AppearanceConfig, singleton.Conf.CustomCode),
	}
}
func getAppearance(c *gin.Context) (any, error) {
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	return appearanceState(), nil
}
func validateAppearance(raw []byte) (string, error) {
	if len(raw) == 0 || len(raw) > 128<<10 {
		return "", errors.New("appearance config must be 1-131072 bytes")
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
	if doc.Version != 1 || doc.Features == nil {
		return "", errors.New("invalid appearance schema version or features")
	}
	allowed := map[string]bool{}
	for _, key := range []string{"branding", "dark", "runtime", "greeting", "clock", "background", "video", "sponsor", "visitorIP", "footerIP", "quote", "counter", "font", "traffic", "speed", "nameColor", "links", "hideControls", "protection", "footer", "sideImage", "network", "snow", "fragments", "heart", "sakura", "stars", "live2d", "analytics", "peakCut"} {
		allowed[key] = true
	}
	for key, feature := range doc.Features {
		if !allowed[key] {
			return "", errors.New("unknown appearance feature: " + key)
		}
		if feature == nil {
			return "", errors.New("invalid appearance feature: " + key)
		}
		if _, ok := feature["enabled"].(bool); !ok {
			return "", errors.New("feature enabled must be boolean: " + key)
		}
	}
	var envelope map[string]any
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return "", err
	}
	if _, ok := envelope["enabled"].(bool); !ok {
		return "", errors.New("appearance enabled must be boolean")
	}
	if err := validateAppearanceFields(doc.Features); err != nil {
		return "", err
	}
	normalized, err := json.Marshal(doc)
	return string(normalized), err
}
func updateAppearance(c *gin.Context) (any, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var form appearanceForm
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, err
	}
	next, err := validateAppearance(form.Config)
	if err != nil {
		return nil, err
	}
	if (form.ExpectedCustomCode == nil) != (form.RemainingCustomCode == nil) {
		return nil, errors.New("both migration code fields are required")
	}
	settingsMutationMu.Lock()
	defer settingsMutationMu.Unlock()
	if err := saveNativeAppearance(&singleton.Conf.AppearanceConfig, &singleton.Conf.CustomCode, &singleton.Conf.AppearanceLegacyCode, form, next, singleton.Conf.Save); err != nil {
		return nil, err
	}
	return appearanceState(), nil
}
func saveNativeAppearance(config, code, archive *string, form appearanceForm, next string, save func() error) error {
	if form.Revision != appearanceRevision(*config, *code) {
		return errors.New("appearance changed; reload settings")
	}
	nextCode, nextArchive := *code, *archive
	if form.ExpectedCustomCode != nil {
		if *form.ExpectedCustomCode != *code {
			return errors.New("custom code changed; migration cancelled")
		}
		if len(*form.RemainingCustomCode) > 1<<20 {
			return errors.New("custom code exceeds 1 MiB")
		}
		nextCode = *form.RemainingCustomCode
		if nextCode != *code {
			if *archive != "" {
				return errors.New("legacy code has already been archived; refusing to overwrite backup")
			}
			nextArchive = *code
		}
	}
	if *config == next && *code == nextCode {
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
