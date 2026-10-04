package controller

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func setupTerminalCommands(t *testing.T) {
	cleanup := setupAPITokenTest(t)
	old := singleton.TerminalCommandCipher
	block, err := aes.NewCipher(make([]byte, 32))
	require.NoError(t, err)
	singleton.TerminalCommandCipher, err = cipher.NewGCM(block)
	require.NoError(t, err)
	require.NoError(t, singleton.DB.AutoMigrate(&model.TerminalCommand{}))
	t.Cleanup(func() { singleton.TerminalCommandCipher = old; cleanup() })
}
func commandContext(uid, id, version uint64, body any) *gin.Context {
	c := ctxAsUser(uid, model.RoleAdmin)
	c.Params = gin.Params{{Key: "id", Value: strconv.FormatUint(id, 10)}}
	if body != nil {
		bindJSON(c, body)
	}
	c.Request.URL.RawQuery = "version=" + strconv.FormatUint(version, 10)
	return c
}
func TestTerminalCommandsOwnerEncryptionCRUD(t *testing.T) {
	setupTerminalCommands(t)
	created, err := createTerminalCommand(commandContext(7, 0, 0, map[string]any{"name": "出口命令", "command": "curl ip.sb", "user_id": 8, "id": 99}))
	require.NoError(t, err)
	var stored model.TerminalCommand
	require.NoError(t, singleton.DB.First(&stored, created.ID).Error)
	require.Equal(t, uint64(7), stored.UserID)
	require.NotEqual(t, uint64(99), stored.ID)
	require.NotContains(t, stored.Ciphertext, "curl")
	raw, _ := json.Marshal(stored)
	require.NotContains(t, string(raw), stored.Ciphertext)
	own := commandContext(7, 0, 0, nil)
	rows, err := listTerminalCommands(own)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "curl ip.sb", rows[0].Command)
	require.Equal(t, "no-store", own.Writer.Header().Get("Cache-Control"))
	others, err := listTerminalCommands(commandContext(8, 0, 0, nil))
	require.NoError(t, err)
	require.Empty(t, others)
	form := model.TerminalCommandForm{Name: "编辑后", Command: "df -h", Version: 1}
	_, err = updateTerminalCommand(commandContext(8, created.ID, 0, form))
	require.Error(t, err)
	_, err = deleteTerminalCommand(commandContext(8, created.ID, 1, nil))
	require.Error(t, err)
	updated, err := updateTerminalCommand(commandContext(7, created.ID, 0, form))
	require.NoError(t, err)
	require.Equal(t, uint64(2), updated.Version)
	_, err = updateTerminalCommand(commandContext(7, created.ID, 0, form))
	require.Error(t, err)
	_, err = deleteTerminalCommand(commandContext(7, created.ID, 1, nil))
	require.Error(t, err)
	_, err = deleteTerminalCommand(commandContext(7, created.ID, 2, nil))
	require.NoError(t, err)
	rows, err = listTerminalCommands(commandContext(7, 0, 0, nil))
	require.NoError(t, err)
	require.Empty(t, rows)
}
func TestTerminalCommandsValidationLimitAndAuth(t *testing.T) {
	setupTerminalCommands(t)
	for _, command := range []string{"", " ", "ls\n", "ls\r", "a\x1bb", "a\tb", "a\x00b", strings.Repeat("x", 8193)} {
		_, err := createTerminalCommand(commandContext(7, 0, 0, model.TerminalCommandForm{Name: "test", Command: command}))
		require.Error(t, err)
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/", nil)
	_, err := listTerminalCommands(c)
	require.Error(t, err)
	for i := 0; i < 100; i++ {
		_, err = createTerminalCommand(commandContext(7, 0, 0, model.TerminalCommandForm{Name: "test", Command: "true"}))
		require.NoError(t, err)
	}
	_, err = createTerminalCommand(commandContext(7, 0, 0, model.TerminalCommandForm{Name: "test", Command: "true"}))
	require.ErrorContains(t, err, "100")
	_, err = createTerminalCommand(commandContext(8, 0, 0, model.TerminalCommandForm{Name: "test", Command: "true"}))
	require.NoError(t, err)
}
