package panelbackup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type idleConn struct{ net.Conn }

func (c idleConn) Read(p []byte) (int, error) {
	_ = c.SetReadDeadline(time.Now().Add(45 * time.Second))
	return c.Conn.Read(p)
}
func (c idleConn) Write(p []byte) (int, error) {
	_ = c.SetWriteDeadline(time.Now().Add(45 * time.Second))
	return c.Conn.Write(p)
}

type remote struct {
	client *sftp.Client
	ssh    *ssh.Client
	stop   func() bool
	conn   net.Conn
}

func (r *remote) Close() { r.stop(); _ = r.client.Close(); _ = r.ssh.Close(); _ = r.conn.Close() }
func connect(ctx context.Context, t Target, secret string, trustFirst bool, allowed ...string) (*remote, string, error) {
	var auth ssh.AuthMethod
	if t.AuthType == "key" {
		signer, e := ssh.ParsePrivateKey([]byte(secret))
		if e != nil {
			return nil, "", errors.New("私钥格式错误或需要密码，请使用专用的无密码私钥")
		}
		auth = ssh.PublicKeys(signer)
	} else {
		auth = ssh.Password(secret)
	}
	fingerprint := ""
	config := &ssh.ClientConfig{User: t.User, Auth: []ssh.AuthMethod{auth}, Timeout: 15 * time.Second, HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
		fingerprint = ssh.FingerprintSHA256(key)
		if len(allowed) > 0 {
			for _, fp := range allowed {
				if fp == fingerprint {
					return nil
				}
			}
			return errors.New("SSH 指纹与 Agent 上报不一致，已停止对接")
		}
		if fingerprint != t.Fingerprint && !(trustFirst && t.Fingerprint == "") {
			return errors.New("服务器指纹发生变化，已停止连接，请核实后重新对接")
		}
		return nil
	}}
	address := net.JoinHostPort(t.Host, strconv.Itoa(t.Port))
	conn, err := (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, "", fmt.Errorf("连接备份服务器失败: %w", err)
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	cc, ch, req, err := ssh.NewClientConn(idleConn{conn}, address, config)
	if err != nil {
		stop()
		_ = conn.Close()
		return nil, fingerprint, fmt.Errorf("SSH 登录失败: %w", err)
	}
	client := ssh.NewClient(cc, ch, req)
	fs, err := sftp.NewClient(client, sftp.MaxPacket(32768))
	if err != nil {
		stop()
		_ = client.Close()
		_ = conn.Close()
		return nil, fingerprint, fmt.Errorf("SFTP 不可用: %w", err)
	}
	return &remote{fs, client, stop, conn}, fingerprint, nil
}
func safeError(err error, secret string) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if secret != "" {
		message = strings.ReplaceAll(message, secret, "[已隐藏]")
	}
	if len(message) > 1000 {
		message = message[:1000]
	}
	return message
}

// Probe uses first-use host trust only on this explicit connection-test action.
// Saved targets always require an exact pinned host key.
func Probe(ctx context.Context, t Target, secret string) (string, error) {
	r, fp, err := connect(ctx, t, secret, true)
	if err != nil {
		return fp, errors.New(safeError(err, secret))
	}
	defer r.Close()
	info, err := r.client.Stat(t.Directory)
	if err != nil && !os.IsNotExist(err) {
		return fp, fmt.Errorf("无法访问备份目录: %w", err)
	}
	if err == nil && !info.IsDir() {
		return fp, errors.New("备份路径不是目录")
	}
	return fp, nil
}

type countWriter struct {
	w     io.Writer
	count func(int)
}

func (w countWriter) Write(p []byte) (int, error) { n, e := w.w.Write(p); w.count(n); return n, e }
func Transfer(ctx context.Context, t Target, secret, installation string, snap *Snapshot, round uint64, report func(Delivery)) (result Delivery, err error) {
	result = Delivery{TargetID: t.ID, Name: t.Name, State: "running", Phase: "connecting", TotalBytes: snap.Total}
	now := time.Now()
	result.StartedAt = &now
	defer func() {
		if err != nil {
			err = errors.New(safeError(err, secret))
		}
	}()
	report(result)
	r, _, err := connect(ctx, t, secret, false)
	if err != nil {
		return result, err
	}
	defer r.Close()
	base := path.Join(t.Directory, "ddnezha-"+installation)
	if err = r.client.MkdirAll(base); err != nil {
		return result, fmt.Errorf("创建备份目录失败: %w", err)
	}
	if err = r.client.Chmod(base, 0700); err != nil {
		return result, fmt.Errorf("设置备份目录权限失败: %w", err)
	}
	file := fmt.Sprintf("backup-%s-%06d.tar.gz", snap.At.UTC().Format("20060102T150405.000000000Z"), round)
	if snap.Password != "" {
		file += ".age"
	}
	final := path.Join(base, file)
	partial := final + ".partial"
	f, err := r.client.OpenFile(partial, os.O_CREATE|os.O_EXCL|os.O_WRONLY)
	if err != nil {
		return result, fmt.Errorf("创建备份文件失败（请检查权限和磁盘空间）: %w", err)
	}
	committed := false
	finalCreated := false
	checksumCreated := false
	defer func() {
		_ = f.Close()
		if cleanupErr := r.client.Remove(partial); cleanupErr != nil && !os.IsNotExist(cleanupErr) {
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			if retry, _, e := connect(cleanupCtx, t, secret, false); e == nil {
				_ = retry.client.Remove(partial)
				retry.Close()
			}
			cancel()
		}
		if !committed {
			if finalCreated {
				_ = r.client.Remove(final)
			}
			if checksumCreated {
				_ = r.client.Remove(final + ".sha256")
			}
		}
	}()
	if err = f.Chmod(0600); err != nil {
		return result, err
	}
	result.Phase = "transferring"
	report(result)
	sum := sha256.New()
	last := time.Time{}
	sentAt := time.Now()
	progress := func(force bool) {
		if force || time.Since(last) > time.Second {
			last = time.Now()
			seconds := time.Since(sentAt).Seconds()
			if seconds > 0 {
				result.BytesPerSecond = int64(float64(result.SentBytes) / seconds)
			}
			report(result)
		}
	}
	writer := countWriter{io.MultiWriter(f, sum), func(n int) { result.SentBytes += int64(n); progress(false) }}
	err = snap.Write(ctx, writer, func(n int64) { result.ProcessedBytes = n; progress(false) })
	if err != nil {
		return result, fmt.Errorf("传输失败（请检查网络、目录权限和剩余空间）: %w", err)
	}
	if _, ok := r.client.HasExtension("fsync@openssh.com"); ok {
		if err = f.Sync(); err != nil {
			return result, fmt.Errorf("备份文件写入磁盘失败: %w", err)
		}
	}
	if err = f.Close(); err != nil {
		return result, err
	}
	result.SHA256 = hex.EncodeToString(sum.Sum(nil))
	result.Phase = "verifying"
	result.BytesPerSecond = 0
	report(result)
	check, err := r.client.Open(partial)
	if err != nil {
		return result, err
	}
	hash := sha256.New()
	_, err = io.Copy(hash, countingReader{contextReader{ctx, check}, func(n int) { result.VerifiedBytes += int64(n); progress(false) }})
	ce := check.Close()
	if err == nil {
		err = ce
	}
	if err != nil {
		return result, fmt.Errorf("读取远端备份校验失败: %w", err)
	}
	if hex.EncodeToString(hash.Sum(nil)) != result.SHA256 || result.VerifiedBytes != result.SentBytes {
		return result, errors.New("远端备份校验不一致，文件未标记为成功，请重试")
	}
	if err = r.client.Rename(partial, final); err != nil {
		return result, fmt.Errorf("提交备份文件失败: %w", err)
	}
	finalCreated = true
	side, err := r.client.OpenFile(final+".sha256", os.O_CREATE|os.O_EXCL|os.O_WRONLY)
	if err != nil {
		return result, err
	}
	checksumCreated = true
	if err = side.Chmod(0600); err == nil {
		_, err = io.WriteString(side, result.SHA256+"  "+file+"\n")
	}
	ce = side.Close()
	if err == nil {
		err = ce
	}
	if err != nil {
		return result, err
	}
	committed = true
	result.Archive = final
	result.State = "success"
	result.Phase = "completed"
	result.BytesPerSecond = 0
	done := time.Now()
	result.FinishedAt = &done
	report(result)
	return result, nil
}

func ProbeTrusted(ctx context.Context, t Target, secret string, allowed []string) (string, error) {
	if len(allowed) == 0 {
		return "", errors.New("缺少可信 SSH 指纹")
	}
	r, fp, err := connect(ctx, t, secret, false, allowed...)
	if err != nil {
		return fp, errors.New(safeError(err, secret))
	}
	defer r.Close()
	info, err := r.client.Stat(t.Directory)
	if err != nil {
		return fp, err
	}
	if !info.IsDir() {
		return fp, errors.New("备份路径不是目录")
	}
	return fp, nil
}
