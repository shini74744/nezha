package sshsecurity

import _ "embed"

// Script is versioned with the Agent; never execute a moving remote URL.
//
//go:embed fail2ban-ssh.sh
var Script []byte
