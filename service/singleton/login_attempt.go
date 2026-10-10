package singleton

import "strconv"

// A request-only secret. It is never part of JSON, database models or logs.
// Only the explicitly opted-in, currently authorized recipient may render it.
type LoginAttemptPassword struct {
	value     string
	truncated bool
}

func NewLoginAttemptPassword(value string) *LoginAttemptPassword {
	runes := []rune(value)
	truncated := len(runes) > 256
	if truncated {
		runes = runes[:256]
	}
	return &LoginAttemptPassword{value: string(runes), truncated: truncated}
}

func (*LoginAttemptPassword) String() string               { return "[redacted]" }
func (*LoginAttemptPassword) GoString() string             { return "[redacted]" }
func (*LoginAttemptPassword) MarshalJSON() ([]byte, error) { return []byte("null"), nil }

func (p *LoginAttemptPassword) display() string {
	if p.value == "" {
		return "（空）"
	}
	// Escape newlines/control/bidi characters to prevent forged notification fields.
	quoted := strconv.QuoteToGraphic(p.value)
	value := quoted[1 : len(quoted)-1]
	if p.truncated {
		value += "…（已截断）"
	}
	return value
}

func passwordLoginFailure(e LoginNotice) bool {
	return e.Method == "账号密码" && e.Reason > LoginSucceeded && e.Reason <= LoginInternalError
}
