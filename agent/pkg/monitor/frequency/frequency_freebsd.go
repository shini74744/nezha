package frequency

import (
	"context"
	"golang.org/x/sys/unix"
)

func read(ctx context.Context) Reading { return readBSD(ctx, unix.SysctlUint32) }
