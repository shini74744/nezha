package sshlogin

import (
	"net/netip"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Port is the local listening port; SourcePort belongs to the remote client.
type Event struct {
	ID         string `json:"id"`
	Time       int64  `json:"time"`
	Username   string `json:"username"`
	SourceIP   string `json:"source_ip"`
	SourcePort uint16 `json:"source_port"`
	Port       uint16 `json:"port"`
	Method     string `json:"method"`
	Success    bool   `json:"success"`
	Reason     string `json:"reason"`
}

var openSSH = regexp.MustCompile(`^(Accepted|Failed) ([a-zA-Z0-9_/-]{1,64}) for (invalid user )?(.{1,256}?) from (\S+) port ([0-9]{1,5})(?: ssh2(?:[: ].*)?)?$`)
var dropbearPassword = regexp.MustCompile(`^(Password auth succeeded|Bad password attempt) for '(.{1,256}?)' from (.+):([0-9]{1,5})$`)
var dropbearKey = regexp.MustCompile(`^Pubkey auth succeeded for '(.{1,256}?)' with key \S+ from (.+):([0-9]{1,5})$`)

// Parse consumes the message field of a trusted sshd or Dropbear record.
// Passwords, public keys, fingerprints and arbitrary log tails are not retained.
func Parse(message string, at time.Time) (Event, bool) {
	if len(message) > 16384 || !utf8.ValidString(message) {
		return Event{}, false
	}
	e := Event{Time: at.UnixMilli()}
	message = strings.TrimSpace(message)
	if m := openSSH.FindStringSubmatch(message); m != nil {
		e.Success = m[1] == "Accepted"
		e.Method = m[2]
		e.Username = m[4]
		e.SourceIP = m[5]
		p, err := strconv.ParseUint(m[6], 10, 16)
		if err != nil {
			return Event{}, false
		}
		e.SourcePort = uint16(p)
		if !e.Success {
			e.Reason = "认证失败"
			if m[3] != "" {
				e.Reason = "账号不存在"
			}
		}
	} else if m := dropbearPassword.FindStringSubmatch(message); m != nil {
		e.Success = m[1] == "Password auth succeeded"
		e.Method = "password"
		e.Username = m[2]
		e.SourceIP = m[3]
		p, err := strconv.ParseUint(m[4], 10, 16)
		if err != nil {
			return Event{}, false
		}
		e.SourcePort = uint16(p)
		if !e.Success {
			e.Reason = "密码认证失败"
		}
	} else if m := dropbearKey.FindStringSubmatch(message); m != nil {
		e.Success = true
		e.Method = "publickey"
		e.Username = m[1]
		e.SourceIP = m[2]
		p, _ := strconv.ParseUint(m[3], 10, 16)
		e.SourcePort = uint16(p)
	} else {
		return Event{}, false
	}
	addr, err := netip.ParseAddr(strings.Trim(e.SourceIP, "[]"))
	if err != nil || addr.Zone() != "" || addr.IsUnspecified() || e.SourcePort == 0 {
		return Event{}, false
	}
	e.SourceIP = addr.Unmap().String()
	if utf8.RuneCountInString(e.Username) > 128 || strings.IndexFunc(e.Username, unicode.IsControl) >= 0 {
		return Event{}, false
	}
	return e, true
}
