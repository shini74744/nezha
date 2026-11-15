package panelbackup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/nezhahq/nezha/pkg/backupformat"
	"gorm.io/gorm"
)

func (s *Snapshot) HashFiles(ctx context.Context) error {
	s.Kind = "full"
	s.Index = make([]backupformat.File, 0, len(s.Entries))
	for i := range s.Entries {
		e := &s.Entries[i]
		f, err := os.Open(e.file)
		if err != nil {
			return err
		}
		h := sha256.New()
		n, err := io.Copy(h, contextReader{ctx, f})
		closeErr := f.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		if n != e.Size {
			return errors.New("快照文件大小发生变化，请重试")
		}
		e.SHA256 = hex.EncodeToString(h.Sum(nil))
		s.Index = append(s.Index, backupformat.File{Name: e.Name, Size: e.Size, SHA256: e.SHA256})
	}
	return nil
}
func sinkKey(t Target, installation string) string {
	b, _ := json.Marshal([]any{t.Host, t.Port, t.User, path.Clean(t.Directory), t.Fingerprint, installation})
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func compatibility(p Plan) string {
	// Hash the encrypted credential, never a low-cost hash of the password.
	value := "plain"
	if p.Encrypt {
		value = "encrypted:" + p.Password
	}
	h := sha256.Sum256([]byte(value))
	return hex.EncodeToString(h[:])
}
func deltaSnapshot(s *Snapshot, previous Delivery) (*Snapshot, error) {
	var before []backupformat.File
	if err := json.Unmarshal([]byte(previous.FileIndex), &before); err != nil {
		return nil, err
	}
	old := map[string]backupformat.File{}
	for _, f := range before {
		if !backupformat.ValidDataPath(f.Name) || !backupformat.ValidHash(f.SHA256) || f.Size < 0 {
			return nil, errors.New("基础备份索引无效")
		}
		if _, ok := old[f.Name]; ok {
			return nil, errors.New("基础备份索引重复")
		}
		old[f.Name] = f
	}
	out := *s
	out.Kind = "incremental"
	out.Entries = nil
	out.Total = 0
	out.Deleted = nil
	out.ParentID = previous.ID
	out.Depth = previous.Depth + 1
	out.Parent = &backupformat.Archive{Name: path.Base(previous.Archive), SHA256: previous.SHA256, Size: previous.SentBytes}
	for _, e := range s.Entries {
		oldEntry, ok := old[e.Name]
		if !ok || oldEntry.SHA256 != e.SHA256 || oldEntry.Size != e.Size {
			out.Entries = append(out.Entries, e)
			out.Total += e.Size
		}
		delete(old, e.Name)
	}
	for name := range old {
		out.Deleted = append(out.Deleted, name)
	}
	sort.Strings(out.Deleted)
	return &out, nil
}
func (m *Manager) chain(last Delivery) ([]Delivery, error) {
	chain := []Delivery{}
	seen := map[uint64]bool{}
	for {
		if seen[last.ID] || len(chain) >= 32 || last.State != "success" || last.PrunedAt != nil || !backupformat.ValidHash(last.SHA256) {
			return nil, errors.New("备份依赖不完整，请重新创建全量备份")
		}
		seen[last.ID] = true
		chain = append(chain, last)
		if last.ParentID == 0 {
			break
		}
		var parent Delivery
		if err := m.db.Omit("FileIndex").First(&parent, last.ParentID).Error; err != nil {
			return nil, errors.New("基础备份记录不存在")
		}
		if parent.TargetID != last.TargetID || parent.Sink != last.Sink || parent.Compatibility != last.Compatibility {
			return nil, errors.New("备份依赖不匹配")
		}
		last = parent
	}
	for i, j := 0, len(chain)-1; i < j; i, j = i+1, j-1 {
		chain[i], chain[j] = chain[j], chain[i]
	}
	return chain, nil
}
func archivePath(t Target, installation string, d Delivery) (string, error) {
	expected := path.Join(t.Directory, "ddnezha-"+installation, path.Base(d.Archive))
	if d.Archive != expected || !backupformat.ValidArchive(path.Base(d.Archive)) || !backupformat.ValidHash(d.SHA256) {
		return "", errors.New("备份文件路径或校验记录无效")
	}
	if d.Sink != "" && d.Sink != sinkKey(t, installation) {
		return "", errors.New("备份机器的连接或目录已更改，请恢复原连接后下载")
	}
	return expected, nil
}
func checkArchive(r *remote, t Target, installation string, d Delivery) error {
	file, err := archivePath(t, installation, d)
	if err != nil {
		return err
	}
	info, err := r.client.Lstat(file)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != d.SentBytes {
		return errors.New("备份文件大小不符")
	}
	side, err := r.client.Open(file + ".sha256")
	if err != nil {
		return err
	}
	body, err := io.ReadAll(io.LimitReader(side, 1024))
	ce := side.Close()
	if err == nil {
		err = ce
	}
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(body)) != d.SHA256+"  "+path.Base(file) {
		return errors.New("备份校验文件不匹配")
	}
	return nil
}
func (m *Manager) selectSnapshot(ctx context.Context, t Target, secret string, s *Snapshot, p Plan) (*Snapshot, error) {
	if p.BackupType != "incremental" {
		return s, nil
	}
	m.archiveMu.Lock()
	defer m.archiveMu.Unlock()
	var previous Delivery
	e := m.db.Where("target_id = ? AND sink = ? AND compatibility = ? AND state = ? AND pruned_at IS NULL AND file_index <> ''",
		t.ID, sinkKey(t, m.installation), compatibility(p), "success").Order("id DESC").First(&previous).Error
	if errors.Is(e, gorm.ErrRecordNotFound) {
		return s, nil
	}
	if e != nil {
		return nil, e
	}
	limit := t.RetainCount
	if limit < 1 {
		limit = 15
	}
	if limit > 30 {
		limit = 30
	}
	if previous.Depth+1 >= limit {
		return s, nil
	}
	chain, e := m.chain(previous)
	if e != nil {
		return s, nil
	}
	r, _, e := connect(ctx, t, secret, false)
	if e != nil {
		return nil, e
	}
	defer r.Close()
	for _, d := range chain {
		if e = checkArchive(r, t, m.installation, d); e != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			if os.IsNotExist(e) {
				return s, nil
			}
			return nil, fmt.Errorf("基础备份无法校验，请检查目标文件或改用全量备份: %w", e)
		}
	}
	next, e := deltaSnapshot(s, previous)
	if e != nil {
		return nil, e
	}
	return next, nil
}

// prune only removes this panel's recorded, verified archives. Dependencies and
// active download leases are retained even when older than the requested count.
func (m *Manager) prune(ctx context.Context, t Target, secret string, newID uint64) error {
	m.archiveMu.Lock()
	defer m.archiveMu.Unlock()
	var rows []Delivery
	if err := m.db.Omit("FileIndex").Where("target_id = ? AND sink = ? AND state = ? AND pruned_at IS NULL", t.ID, sinkKey(t, m.installation), "success").Order("id DESC").Find(&rows).Error; err != nil {
		return err
	}
	if len(rows) == 0 || rows[0].ID != newID {
		return errors.New("新备份记录尚未确认，未清理旧文件")
	}
	n := t.RetainCount
	if n < 1 {
		n = 15
	}
	if len(rows) <= n {
		return nil
	}
	keep := map[uint64]bool{}
	for i, d := range rows {
		if i < n || m.leases[d.ID] > 0 {
			chain, err := m.chain(d)
			if err != nil {
				return err
			}
			for _, part := range chain {
				keep[part.ID] = true
			}
		}
	}
	r, _, err := connect(ctx, t, secret, false)
	if err != nil {
		return err
	}
	defer r.Close()
	// Delete newest orphan children first, leaving their ancestors if interrupted.
	for _, d := range rows {
		if keep[d.ID] {
			continue
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		file, err := archivePath(t, m.installation, d)
		if err != nil {
			return err
		}
		err = checkArchive(r, t, m.installation, d)
		if err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("旧备份校验失败，未清理: %w", err)
		}
		if err == nil {
			if err = r.client.Remove(file); err != nil {
				return fmt.Errorf("新备份已完成，旧备份清理失败；请检查权限或更新接收端: %w", err)
			}
		} else {
			// Only an absent archive is safe to mark removed; a missing sidecar is not.
			if _, e := r.client.Lstat(file); !os.IsNotExist(e) {
				return errors.New("旧备份缺少校验文件，未清理")
			}
		}
		sideErr := r.client.Remove(file + ".sha256")
		now := time.Now()
		if err = m.db.Model(&Delivery{}).Where("id = ?", d.ID).Updates(map[string]any{"pruned_at": now, "file_index": ""}).Error; err != nil {
			return err
		}
		if sideErr != nil && !os.IsNotExist(sideErr) {
			return fmt.Errorf("旧备份已清理，校验文件清理失败: %w", sideErr)
		}
	}
	return nil
}
