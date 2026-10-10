package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

var publishLoginNotice = singleton.PublishLoginNotice

// Fixed outcomes only; no request bodies, errors, tokens or second-factor codes.
func loginNotice(c *gin.Context, uid uint64, account, method string, reason singleton.LoginNoticeReason) {
	publishLoginNotice(singleton.LoginNotice{UserID: uid, Account: account, Method: method,
		IP: c.GetString(model.CtxKeyRealIPStr), Reason: reason})
}

// This helper is only used for failed password-login requests. The event is
// transient; delivery requires an explicit recipient opt-in and current access.
func passwordLoginFailureNotice(c *gin.Context, uid uint64, account, password string, reason singleton.LoginNoticeReason) {
	event := singleton.LoginNotice{UserID: uid, Account: account, Method: "账号密码", IP: c.GetString(model.CtxKeyRealIPStr), Reason: reason}
	if reason != singleton.LoginSucceeded {
		event.AttemptedPassword = singleton.NewLoginAttemptPassword(password)
	}
	publishLoginNotice(event)
}
