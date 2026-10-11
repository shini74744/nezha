package terminalsession

import (
	"errors"
	"io"
	"sync"
)

var ErrAttached = errors.New("会话已在其他窗口打开，请先断开原窗口")
var ErrClosed = errors.New("会话已结束")

const HistoryLimit = 256 * 1024

type Attachment struct {
	Output chan []byte
	Done   chan struct{}
}
type Bridge struct {
	mu      sync.Mutex
	input   chan []byte
	done    chan struct{}
	pending []byte
	history []byte
	viewer  *Attachment
	closed  bool
}

func New() *Bridge                      { return &Bridge{input: make(chan []byte, 8), done: make(chan struct{})} }
func (b *Bridge) Done() <-chan struct{} { return b.done }
func (b *Bridge) Attach() (*Attachment, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return nil, ErrClosed
	}
	if b.viewer != nil {
		return nil, ErrAttached
	}
	a := &Attachment{Output: make(chan []byte, 64), Done: make(chan struct{})}
	if len(b.history) > 0 {
		a.Output <- append([]byte(nil), b.history...)
	}
	b.viewer = a
	return a, nil
}
func (b *Bridge) Detach(a *Attachment) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.viewer == a {
		b.viewer = nil
		close(a.Done)
	}
}
func (b *Bridge) Attached() bool { b.mu.Lock(); defer b.mu.Unlock(); return b.viewer != nil }
func (b *Bridge) Send(a *Attachment, p []byte) error {
	b.mu.Lock()
	valid := !b.closed && (a == nil || b.viewer == a)
	b.mu.Unlock()
	if !valid {
		return ErrClosed
	}
	data := append([]byte(nil), p...)
	if a == nil {
		select {
		case <-b.done:
			return ErrClosed
		case b.input <- data:
			return nil
		}
	}
	select {
	case <-b.done:
		return ErrClosed
	case <-a.Done:
		return ErrClosed
	case b.input <- data:
		return nil
	}
}
func (b *Bridge) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if len(b.pending) == 0 {
		select {
		case <-b.done:
			return 0, io.EOF
		case b.pending = <-b.input:
		}
	}
	n := copy(p, b.pending)
	b.pending = b.pending[n:]
	return n, nil
}
func (b *Bridge) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return 0, io.ErrClosedPipe
	}
	if len(p) >= HistoryLimit {
		b.history = append(b.history[:0], p[len(p)-HistoryLimit:]...)
	} else {
		overflow := len(b.history) + len(p) - HistoryLimit
		if overflow > 0 {
			copy(b.history, b.history[overflow:])
			b.history = b.history[:len(b.history)-overflow]
		}
		b.history = append(b.history, p...)
	}
	for remaining := p; b.viewer != nil && len(remaining) > 0; {
		n := len(remaining)
		if n > 16384 {
			n = 16384
		}
		select {
		case b.viewer.Output <- append([]byte(nil), remaining[:n]...):
			remaining = remaining[n:]
		default:
			close(b.viewer.Done)
			b.viewer = nil
		}
	}
	return len(p), nil
}
func (b *Bridge) Close() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.closed {
		b.closed = true
		close(b.done)
		if b.viewer != nil {
			close(b.viewer.Done)
			b.viewer = nil
		}
		b.history = nil
	}
	return nil
}
