package utls_test

import (
	"context"
	"crypto/x509"
	"github.com/nezhahq/agent/pkg/util"
	utlsx "github.com/nezhahq/agent/pkg/utls"
	utls "github.com/refraction-networking/utls"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// A peer accepts TCP but never completes TLS. Cancellation must close its socket,
// and it must not hold a lock needed by unrelated destinations.
func stalledTLS(t *testing.T) (string, <-chan net.Conn, <-chan struct{}) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	accepted := make(chan net.Conn, 1)
	closed := make(chan struct{})
	t.Cleanup(func() { listener.Close() })
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			close(closed)
			return
		}
		accepted <- conn
		io.Copy(io.Discard, conn)
		conn.Close()
		close(closed)
	}()
	return "https://" + listener.Addr().String(), accepted, closed
}
func localUTLSClient(roots *x509.CertPool) *http.Client {
	return &http.Client{Transport: utlsx.NewUTLSHTTPRoundTripperWithProxy(
		utls.HelloChrome_Auto, &utls.Config{RootCAs: roots}, &http.Transport{}, nil, util.BrowserHeaders()),
		Timeout: 2 * time.Second}
}
func TestSlowTLSDoesNotBlockAnotherDestination(t *testing.T) {
	fast := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) }))
	defer fast.Close()
	roots := x509.NewCertPool()
	roots.AddCert(fast.Certificate())
	client := localUTLSClient(roots)
	slowURL, accepted, _ := stalledTLS(t)
	slowCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(slowCtx, "GET", slowURL, nil)
	slowDone := make(chan struct{})
	go func() {
		defer close(slowDone)
		resp, _ := client.Do(req)
		if resp != nil {
			resp.Body.Close()
		}
	}()
	conn := <-accepted
	defer func() { conn.Close(); cancel(); <-slowDone }()
	fastCtx, stop := context.WithTimeout(context.Background(), 700*time.Millisecond)
	defer stop()
	fastReq, _ := http.NewRequestWithContext(fastCtx, "GET", fast.URL, nil)
	started := time.Now()
	resp, err := client.Do(fastReq)
	if err != nil {
		t.Fatalf("unrelated fast HTTPS blocked behind stalled TLS: %v", err)
	}
	defer resp.Body.Close()
	if _, err = io.Copy(io.Discard, resp.Body); err != nil {
		t.Fatal(err)
	}
	t.Logf("fast destination completed in %s while other handshake stalled", time.Since(started))
}
func TestTLSCancellationClosesStalledHandshake(t *testing.T) {
	client := localUTLSClient(nil)
	url, accepted, closed := stalledTLS(t)
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	done := make(chan error, 1)
	go func() {
		resp, err := client.Do(req)
		if resp != nil {
			resp.Body.Close()
		}
		done <- err
	}()
	conn := <-accepted
	defer conn.Close()
	if err := <-done; err == nil {
		t.Fatal("stalled TLS unexpectedly succeeded")
	}
	select {
	case <-closed:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("cancelled request left TLS socket and handshake running")
	}
}
