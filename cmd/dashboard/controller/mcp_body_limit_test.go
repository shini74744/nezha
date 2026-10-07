package controller

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

// requestBodyReadCounter measures the underlying stream, including the one-byte
// lookahead MaxBytesReader uses to detect overflow, regardless of JSON decoder.
type requestBodyReadCounter struct {
	io.Reader
	read int64
}

func (r *requestBodyReadCounter) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	r.read += int64(n)
	return n, err
}

// H7 regression: the MCP endpoint must cap incoming JSON-RPC body size
// BEFORE decoding. Without this, a valid PAT can post a multi-GB body and
// the dashboard exhausts memory in ShouldBindJSON. We assert the body
// reader is wrapped in http.MaxBytesReader; the exact error path the
// decoder takes is irrelevant as long as the cap is enforced.
func TestMCPEndpoint_BodyIsCappedByMaxBytesReader(t *testing.T) {
	previousLimiter := mcpRateLimiterShared
	mcpRateLimiterShared = newMCPRateLimiter(10, 120)
	t.Cleanup(func() { mcpRateLimiterShared = previousLimiter })
	prevConf := singleton.Conf
	cfg := &model.Config{}
	cfg.SetMCPEnabled(true)
	singleton.Conf = &singleton.ConfigClass{Config: cfg}
	t.Cleanup(func() { singleton.Conf = prevConf })

	tok := &model.APIToken{ID: 1, ScopesCSV: "nezha:server:read"}
	// A valid JSON string larger than the limit forces the decoder to stream
	// past the cap, exercising MaxBytesReader in both standard and go_json builds.
	body := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":"` +
		strings.Repeat("x", mcpJSONRPCMaxBodyBytes+1024) + `"}`
	reader := &requestBodyReadCounter{Reader: bytes.NewBufferString(body)}
	req := httptest.NewRequest(http.MethodPost, "/mcp", reader)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	c.Set(apiTokenCtxKey, tok)
	c.Set(model.CtxKeyAPIToken, tok)

	mcpEndpoint(c)

	if reader.read != mcpJSONRPCMaxBodyBytes+1 {
		t.Fatalf("body must stop at the cap plus one overflow byte: read=%d cap=%d", reader.read, mcpJSONRPCMaxBodyBytes)
	}
	var response struct {
		Error  *struct{ Code int }
		Result json.RawMessage
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("invalid JSON-RPC response: %v", err)
	}
	if response.Error == nil || (response.Error.Code != rpcErrParse && response.Error.Code != rpcErrInvalidRequest) || len(response.Result) != 0 {
		t.Fatalf("oversized JSON-RPC envelope was not rejected: code=%d body=%s", w.Code, w.Body.String())
	}
}

func TestMCPEndpoint_AcceptsSmallBody(t *testing.T) {
	previousLimiter := mcpRateLimiterShared
	mcpRateLimiterShared = newMCPRateLimiter(10, 120)
	t.Cleanup(func() { mcpRateLimiterShared = previousLimiter })
	prevConf := singleton.Conf
	cfg := &model.Config{}
	cfg.SetMCPEnabled(true)
	singleton.Conf = &singleton.ConfigClass{Config: cfg}
	t.Cleanup(func() { singleton.Conf = prevConf })

	tok := &model.APIToken{ID: 1, ScopesCSV: "nezha:server:read"}
	body := `{"jsonrpc":"2.0","id":1,"method":"initialize"}`
	reader := &requestBodyReadCounter{Reader: bytes.NewBufferString(body)}
	req := httptest.NewRequest(http.MethodPost, "/mcp", reader)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	c.Set(apiTokenCtxKey, tok)
	c.Set(model.CtxKeyAPIToken, tok)

	mcpEndpoint(c)

	if w.Code != http.StatusOK {
		t.Fatalf("small valid body must succeed, got code=%d body=%s", w.Code, w.Body.String())
	}
}
