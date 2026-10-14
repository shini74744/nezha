package rpc

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"gopkg.in/yaml.v3"
)

// Opt-in real-binary integration. All listeners, credentials and config files
// belong to the test; no system service or production configuration is touched.
type credentialAgentFixtureRPC struct {
	pb.UnimplementedNezhaServiceServer
	tasks *NezhaHandler
}

func (f *credentialAgentFixtureRPC) ReportSystemInfo2(ctx context.Context, _ *pb.Host) (*pb.Uint64Receipt, error) {
	if _, err := (&authHandler{}).Check(ctx); err != nil {
		return nil, err
	}
	return &pb.Uint64Receipt{Data: 12345}, nil
}
func (f *credentialAgentFixtureRPC) ReportSystemInfo(ctx context.Context, _ *pb.Host) (*pb.Receipt, error) {
	if _, err := (&authHandler{}).Check(ctx); err != nil {
		return nil, err
	}
	return &pb.Receipt{Proced: true}, nil
}
func (f *credentialAgentFixtureRPC) ReportGeoIP(ctx context.Context, g *pb.GeoIP) (*pb.GeoIP, error) {
	if _, err := (&authHandler{}).Check(ctx); err != nil {
		return nil, err
	}
	return g, nil
}
func (f *credentialAgentFixtureRPC) ReportSystemState(stream pb.NezhaService_ReportSystemStateServer) error {
	for {
		if _, err := stream.Recv(); err != nil {
			return err
		}
		if _, err := (&authHandler{}).Check(stream.Context()); err != nil {
			return err
		}
		if err := stream.Send(&pb.Receipt{Proced: true}); err != nil {
			return err
		}
	}
}
func (f *credentialAgentFixtureRPC) RequestTask(stream pb.NezhaService_RequestTaskServer) error {
	return f.tasks.RequestTask(stream)
}

func TestAgentCredentialRealAgentTLSMigration(t *testing.T) {
	binary := os.Getenv("NEZHA_AGENT_INTEGRATION_BINARY")
	if binary == "" {
		t.Skip("set NEZHA_AGENT_INTEGRATION_BINARY to the project Agent binary")
	}
	require.True(t, filepath.IsAbs(binary))
	enableCredentialAuthFixture(t)
	sqlDB, err := singleton.DB.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	dir := t.TempDir()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "isolated-agent-fixture"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment | x509.KeyUsageCertSign, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, IsCA: true, BasicConstraintsValid: true, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	require.NoError(t, err)
	certificate := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	privateKey := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	tlsPair, err := tls.X509KeyPair(certificate, privateKey)
	require.NoError(t, err)
	caPath := filepath.Join(dir, "test-ca.pem")
	require.NoError(t, os.WriteFile(caPath, certificate, 0600))
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	rpcServer := grpc.NewServer(grpc.Creds(credentials.NewTLS(&tls.Config{Certificates: []tls.Certificate{tlsPair}, MinVersion: tls.VersionTLS12})))
	pb.RegisterNezhaServiceServer(rpcServer, &credentialAgentFixtureRPC{tasks: NewNezhaHandler()})
	stopped := make(chan struct{})
	go func() { defer close(stopped); _ = rpcServer.Serve(listener) }()
	t.Cleanup(func() { rpcServer.Stop(); <-stopped })
	configPath := filepath.Join(dir, "agent.yml")
	fixtureConfig := fmt.Sprintf("server: %s\nclient_secret: alice-global\nuuid: %s\ntls: true\ninsecure_tls: false\nreport_delay: 4\nip_report_period: 60\ndisable_auto_update: true\ndisable_force_update: true\ndisable_nat: true\ndisable_send_query: true\nskip_connection_count: true\nskip_procs_count: true\n", listener.Addr().String(), authHandshakeUUID)
	require.NoError(t, os.WriteFile(configPath, []byte(fixtureConfig), 0600))
	startAgent := func() func() {
		ctx, cancel := context.WithCancel(context.Background())
		cmd := exec.CommandContext(ctx, binary, "-c", configPath)
		cmd.Dir = dir
		for _, entry := range os.Environ() {
			if !strings.HasPrefix(entry, "NZ_") && !strings.HasPrefix(entry, "SSL_CERT_FILE=") {
				cmd.Env = append(cmd.Env, entry)
			}
		}
		cmd.Env = append(cmd.Env, "SSL_CERT_FILE="+caPath)
		logFile, err := os.OpenFile(filepath.Join(dir, "agent.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		require.NoError(t, err)
		cmd.Stdout = logFile
		cmd.Stderr = logFile
		require.NoError(t, cmd.Start())
		exited := make(chan error, 1)
		go func() { exited <- cmd.Wait(); _ = logFile.Close() }()
		done := false
		stop := func() {
			if done {
				return
			}
			done = true
			cancel()
			select {
			case <-exited:
			case <-time.After(5 * time.Second):
				t.Error("fixture Agent did not exit")
			}
		}
		t.Cleanup(stop)
		return stop
	}
	stopFirst := startAgent()
	server, ok := singleton.ServerShared.Get(11)
	require.True(t, ok)
	require.Eventually(t, func() bool { return server.GetTaskStream() != nil }, 30*time.Second, 100*time.Millisecond, "real Agent must authenticate on the isolated TLS listener")
	pair, err := singleton.IssueAgentCredential(authHandshakeUUID, 100, model.ServerOperationActor{ID: 100})
	require.NoError(t, err)
	require.NoError(t, singleton.RequestAgentCredentialMigration(pair.UUID, pair.Version))
	binding, ok := singleton.AgentCredentialByUUID(pair.UUID)
	require.True(t, ok)
	migrateAgentCredential(context.Background(), binding)
	binding, ok = singleton.AgentCredentialByUUID(pair.UUID)
	require.True(t, ok)
	require.NotZero(t, binding.VerifiedAt, "success requires reconnect under the dedicated key")
	require.False(t, binding.MigrationRequested)
	data, err := os.ReadFile(configPath)
	require.NoError(t, err)
	var persisted map[string]any
	require.NoError(t, yaml.Unmarshal(data, &persisted))
	require.True(t, persisted["client_secret"] == pair.Secret, "dedicated key must be saved, not just acknowledged")
	require.Equal(t, pair.UUID, persisted["uuid"])
	require.Equal(t, true, persisted["tls"])
	require.Equal(t, false, persisted["insecure_tls"])
	_, err = authCheckWithSecret("alice-global", pair.UUID)
	require.Error(t, err, "old shared key no longer authenticates this node")
	stopFirst()
	require.Eventually(t, func() bool { return server.GetTaskStream() == nil }, 5*time.Second, 50*time.Millisecond)
	stopSecond := startAgent()
	require.Eventually(t, func() bool { return server.GetTaskStream() != nil }, 30*time.Second, 100*time.Millisecond, "dedicated key must survive real process restart")
	stopSecond()
	t.Log("real Agent: TLS migration, persisted key, new-key reconnect, old-key rejection and process restart verified")
}
