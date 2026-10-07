package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestBatchDeleteNotificationCapsRequestBody(t *testing.T) {
	body := append(bytes.Repeat([]byte{' '}, notificationBatchDeleteMaxBodyBytes+1), '[', ']')
	reader := &requestBodyReadCounter{Reader: bytes.NewReader(body)}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/batch-delete/notification", reader)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req

	_, err := batchDeleteNotification(c)
	if err == nil {
		t.Fatal("oversized request body was not rejected")
	}
	if reader.read != notificationBatchDeleteMaxBodyBytes+1 {
		t.Fatalf("body must stop at the cap plus one overflow byte: read=%d cap=%d", reader.read, notificationBatchDeleteMaxBodyBytes)
	}
}
