package controller

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestReplacementRequiresExplicitFullScope(t *testing.T) {
	for _, payload := range []string{
		`{"uuid":"fixture","confirmed":true}`,
		`{"uuid":"fixture","confirmed":false,"reset_scope":"full_node_v1"}`,
		`{"uuid":"fixture","confirmed":true,"reset_scope":"unknown"}`,
	} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", "/", strings.NewReader(payload))
		c.Request.Header.Set("Content-Type", "application/json")
		value, err := createServerReplacement(c)
		require.ErrorContains(t, err, "确认")
		require.Nil(t, value)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	}
}
