//go:build !linux

package sshlogin

import "context"

func Run(ctx context.Context, identity string, exchange Exchange) {}
