package controller

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/panelbackup"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func TestBackupRejectsServerRestrictedTokens(t *testing.T) {
	prior := singleton.BackupManager
	singleton.BackupManager = &panelbackup.Manager{}
	defer func() { singleton.BackupManager = prior }()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	token := &model.APIToken{}
	token.SetScopes([]string{model.ScopeAdminAll})
	token.SetServerIDs([]uint64{19})
	c.Set(model.CtxKeyAPIToken, token)
	_, err := backupManager(c)
	require.ErrorContains(t, err, "完整的管理员权限")
	token.SetServerIDs(nil)
	_, err = backupManager(c)
	require.NoError(t, err)
}
func TestBackupPayloadLimitAndSecretRedaction(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/api/v1/backup/targets", strings.NewReader(`{"name":"`+strings.Repeat("x", 129*1024)+`"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	var input panelbackup.TargetInput
	require.Error(t, backupBind(c, &input))
	raw, err := json.Marshal(panelbackup.Overview{Plan: panelbackup.Plan{Password: "private-encryption-password"}, Targets: []panelbackup.Target{{Secret: "private-login-secret"}}})
	require.NoError(t, err)
	require.False(t, bytes.Contains(raw, []byte("private-")))
}
