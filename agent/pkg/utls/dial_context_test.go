package utls

import (
	"context"
	"errors"
	tls "github.com/refraction-networking/utls"
	"io"
	"net"
	"testing"
	"time"
)

func TestDetachedHTTP1DialHonorsOriginatingRequest(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	accepted := make(chan net.Conn, 1)
	closed := make(chan struct{})
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		accepted <- conn
		io.Copy(io.Discard, conn)
		conn.Close()
		close(closed)
	}()
	rt := NewUTLSHTTPRoundTripperWithProxy(tls.HelloChrome_Auto, &tls.Config{}, nil, nil, nil).(*uTLSHTTPRoundTripperImpl)
	addr := listener.Addr().String()
	rt.setShouldConnectWithH1(addr)
	parent, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	detached := context.WithoutCancel(context.WithValue(parent, requestContextKey{}, parent))
	done := make(chan error, 1)
	go func() {
		conn, err := rt.dialOrGetTLSWithExpectedALPN(detached, addr, false)
		if conn != nil {
			conn.Close()
		}
		done <- err
	}()
	conn := <-accepted
	defer conn.Close()
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, context.Canceled) {
			t.Fatalf("unexpected result %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("HTTP/1 dial outlived request deadline")
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("HTTP/1 TLS socket not closed")
	}
}
