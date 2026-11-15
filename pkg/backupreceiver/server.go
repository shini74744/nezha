package backupreceiver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type User struct {
	PublicKey string `json:"public_key"`
	Directory string `json:"directory"`
}
type Config struct {
	Listen string          `json:"listen"`
	Users  map[string]User `json:"users"`
}

func ReadConfig(file string) (Config, error) {
	var config Config
	data, err := os.ReadFile(file) // #nosec G304 -- local administrator-selected receiver config, never supplied by SFTP requests.
	if err != nil {
		return config, err
	}
	err = json.Unmarshal(data, &config)
	if err != nil {
		return config, err
	}
	if config.Listen == "" || len(config.Users) == 0 {
		return config, errors.New("备份接收端尚未配置")
	}
	return config, nil
}

type deadlineConn struct{ net.Conn }

func (c deadlineConn) Read(b []byte) (int, error) {
	_ = c.SetReadDeadline(time.Now().Add(2 * time.Minute))
	return c.Conn.Read(b)
}
func (c deadlineConn) Write(b []byte) (int, error) {
	_ = c.SetWriteDeadline(time.Now().Add(2 * time.Minute))
	return c.Conn.Write(b)
}
func Serve(ctx context.Context, listener net.Listener, hostKey ssh.Signer, load func() (Config, error)) error {
	defer listener.Close()
	stop := context.AfterFunc(ctx, func() { listener.Close() })
	defer stop()
	slots := make(chan struct{}, 16)
	var wg sync.WaitGroup
	defer wg.Wait()
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		select {
		case slots <- struct{}{}:
		default:
			_ = conn.Close()
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-slots }()
			defer conn.Close()
			cancelConnection := context.AfterFunc(ctx, func() { _ = conn.Close() })
			defer cancelConnection()
			_ = conn.SetDeadline(time.Now().Add(15 * time.Second))
			config := &ssh.ServerConfig{MaxAuthTries: 3, ServerVersion: "SSH-2.0-DDnezhaBackup",
				PublicKeyCallback: func(meta ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
					current, e := load()
					if e != nil {
						return nil, errors.New("backup configuration unavailable")
					}
					candidate, ok := current.Users[meta.User()]
					if !ok {
						return nil, errors.New("backup authentication failed")
					}
					expected, _, _, _, e := ssh.ParseAuthorizedKey([]byte(candidate.PublicKey))
					if e != nil || !bytes.Equal(key.Marshal(), expected.Marshal()) {
						return nil, errors.New("backup authentication failed")
					}
					return &ssh.Permissions{Extensions: map[string]string{"backup-directory": candidate.Directory}}, nil
				}}
			config.AddHostKey(hostKey)
			handshakeTimer := time.AfterFunc(15*time.Second, func() { _ = conn.Close() })
			defer handshakeTimer.Stop()
			connection, channels, requests, err := ssh.NewServerConn(deadlineConn{conn}, config)
			if err != nil {
				return
			}
			defer connection.Close()
			handshakeTimer.Stop()
			_ = conn.SetDeadline(time.Time{})
			go ssh.DiscardRequests(requests)
			// Accept one SFTP channel per authenticated connection, never shell/exec,
			// agent forwarding, TCP forwarding, or additional sessions.
			opened := false
			for incoming := range channels {
				if incoming.ChannelType() != "session" || opened {
					_ = incoming.Reject(ssh.Prohibited, "SFTP only")
					continue
				}
				opened = true
				channel, reqs, err := incoming.Accept()
				if err != nil {
					return
				}
				go func() {
					for extra := range channels {
						_ = extra.Reject(ssh.Prohibited, "SFTP only")
					}
				}()
				func() {
					defer channel.Close()
					for req := range reqs {
						var subsystem struct{ Name string }
						if req.Type != "subsystem" || ssh.Unmarshal(req.Payload, &subsystem) != nil || subsystem.Name != "sftp" {
							_ = req.Reply(false, nil)
							continue
						}
						filesystem, err := NewFilesystem(connection.Permissions.Extensions["backup-directory"], connection.User())
						if err != nil {
							_ = req.Reply(false, nil)
							return
						}
						defer filesystem.Close()
						_ = req.Reply(true, nil)
						go ssh.DiscardRequests(reqs)
						server := sftp.NewRequestServer(channel, filesystem.Handlers())
						defer server.Close()
						_ = server.Serve()
						return
					}
				}()
				// A completed backup does not keep a privileged authenticated session open.
				return
			}
		}()
	}
}
func ListenAddress(port int) (string, error) {
	if port < 1024 || port > 65535 {
		return "", fmt.Errorf("备份端口须为 1024 至 65535")
	}
	return net.JoinHostPort("", fmt.Sprint(port)), nil
}
