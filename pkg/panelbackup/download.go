package panelbackup

import (
	"archive/tar"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"sync"
	"time"

	"github.com/nezhahq/nezha/pkg/backupformat"
)

type Download struct {
	Name   string
	Size   int64
	m      *Manager
	r      *remote
	parts  []Delivery
	bundle []byte
	readme []byte
	once   sync.Once
}

func (d *Download) Close() {
	d.once.Do(func() {
		d.r.Close()
		d.m.archiveMu.Lock()
		for _, p := range d.parts {
			d.m.leases[p.ID]--
			if d.m.leases[p.ID] == 0 {
				delete(d.m.leases, p.ID)
			}
		}
		d.m.downloads--
		d.m.archiveMu.Unlock()
	})
}
func tarSize(n int64) int64 { return 512 + ((n+511)/512)*512 }
func (m *Manager) OpenDownload(ctx context.Context, id uint64) (*Download, error) {
	if !m.archiveMu.TryLock() {
		return nil, errors.New("正在整理备份文件，请稍后下载")
	}
	if m.downloads >= 2 {
		m.archiveMu.Unlock()
		return nil, errors.New("已有两个文件正在下载，请稍后重试")
	}
	var last Delivery
	err := m.db.Omit("FileIndex").First(&last, id).Error
	var t Target
	if err == nil {
		err = m.db.First(&t, last.TargetID).Error
	}
	var parts []Delivery
	if err == nil {
		parts, err = m.chain(last)
	}
	if err == nil {
		for _, p := range parts {
			if _, err = archivePath(t, m.installation, p); err != nil {
				break
			}
		}
	}
	if err != nil {
		m.archiveMu.Unlock()
		return nil, fmt.Errorf("备份暂不可下载，请检查目标连接及保留状态: %w", err)
	}
	for _, p := range parts {
		m.leases[p.ID]++
	}
	m.downloads++
	m.archiveMu.Unlock()
	release := func() {
		m.archiveMu.Lock()
		defer m.archiveMu.Unlock()
		for _, p := range parts {
			m.leases[p.ID]--
			if m.leases[p.ID] == 0 {
				delete(m.leases, p.ID)
			}
		}
		m.downloads--
	}
	secret, err := unseal(m.cipher, t.Secret)
	if err != nil {
		release()
		return nil, err
	}
	r, _, err := connect(ctx, t, secret, false)
	if err != nil {
		release()
		return nil, errors.New(safeError(err, secret))
	}
	d := &Download{m: m, r: r, parts: parts, Name: path.Base(last.Archive), Size: last.SentBytes}
	for _, p := range parts {
		if err = checkArchive(r, t, m.installation, p); err != nil {
			d.Close()
			return nil, fmt.Errorf("备份文件无法读取或校验: %w", err)
		}
	}
	if len(parts) > 1 {
		d.Name = fmt.Sprintf("ddnezha-restore-%d-%d.tar", last.RunID, last.TargetID)
		b := backupformat.Bundle{Format: 1}
		d.Size = 1024
		for _, p := range parts {
			b.Archives = append(b.Archives, backupformat.Archive{Name: path.Base(p.Archive), SHA256: p.SHA256, Size: p.SentBytes})
			d.Size += tarSize(p.SentBytes)
		}
		d.bundle, err = json.MarshalIndent(b, "", "  ")
		if err != nil {
			d.Close()
			return nil, err
		}
		d.readme = []byte("DDnezha 增量备份恢复包\n\n此包包含按顺序恢复所需的全部备份，原有加密保持不变。\n请先解开外层 .tar 包到独立目录，再使用 DDnezha 恢复工具：\n\n  ddnezha-backup-restore -bundle ./bundle.json -output ./restored\n\n输出目录必须不存在。加密备份会提示输入备份密码。工具会校验每份文件，依次应用新增、修改和删除。\n请勿仅解压最后一个增量包，也不要覆盖正在运行的面板目录。\n\n工具和文档：https://github.com/shini74744/nezha/blob/main/docs/data-backup.md\n")
		d.Size += tarSize(int64(len(d.bundle))) + tarSize(int64(len(d.readme)))
	}
	return d, nil
}

// Keep the final chunk until its checksum passes so a corrupt source cannot
// produce a seemingly complete Content-Length download.
func copyVerified(ctx context.Context, w io.Writer, r io.Reader, n int64, want string) error {
	if n < 0 || !backupformat.ValidHash(want) {
		return errors.New("备份校验信息无效")
	}
	h := sha256.New()
	tail := int64(64 << 10)
	if n < tail {
		tail = n
	}
	if _, err := io.CopyN(io.MultiWriter(w, h), contextReader{ctx, r}, n-tail); err != nil {
		return err
	}
	b := make([]byte, int(tail))
	if _, err := io.ReadFull(contextReader{ctx, r}, b); err != nil {
		return err
	}
	_, _ = h.Write(b)
	if hex.EncodeToString(h.Sum(nil)) != want {
		return errors.New("下载校验失败，文件可能已损坏")
	}
	var extra [1]byte
	if count, err := r.Read(extra[:]); count != 0 || err != io.EOF {
		return errors.New("备份文件大小发生变化")
	}
	nwrite, err := w.Write(b)
	if err == nil && nwrite != len(b) {
		err = io.ErrShortWrite
	}
	return err
}
func (d *Download) Write(ctx context.Context, w io.Writer) error {
	if len(d.parts) == 1 {
		f, err := d.r.client.Open(d.parts[0].Archive)
		if err != nil {
			return err
		}
		defer f.Close()
		return copyVerified(ctx, w, f, d.parts[0].SentBytes, d.parts[0].SHA256)
	}
	out := tar.NewWriter(w)
	for _, p := range d.parts {
		if err := out.WriteHeader(&tar.Header{Name: path.Base(p.Archive), Size: p.SentBytes, Mode: 0600, ModTime: time.Unix(0, 0), Format: tar.FormatUSTAR}); err != nil {
			return err
		}
		f, err := d.r.client.Open(p.Archive)
		if err != nil {
			return err
		}
		err = copyVerified(ctx, out, f, p.SentBytes, p.SHA256)
		ce := f.Close()
		if err == nil {
			err = ce
		}
		if err != nil {
			return err
		}
	}
	for _, f := range []struct {
		name string
		body []byte
	}{{"bundle.json", d.bundle}, {"README.txt", d.readme}} {
		if err := out.WriteHeader(&tar.Header{Name: f.name, Size: int64(len(f.body)), Mode: 0600, ModTime: time.Unix(0, 0), Format: tar.FormatUSTAR}); err != nil {
			return err
		}
		if _, err := out.Write(f.body); err != nil {
			return err
		}
	}
	return out.Close()
}
