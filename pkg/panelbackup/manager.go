package panelbackup

import (
	"context"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/nezhahq/nezha/pkg/backupspace"
	"gorm.io/gorm"
)

type Manager struct {
	db           *gorm.DB
	source       Source
	cipher       cipher.AEAD
	installation string
	mu           sync.Mutex
	active       *Run
	closed       bool
	pendingFinal *Run
	cancel       context.CancelFunc
	dirty        atomic.Uint64
	backed       atomic.Uint64
	stop         context.CancelFunc
	wg           sync.WaitGroup
	// Replaceable in integration tests; production always uses the same snapshot/transport.
	prepare  func(context.Context, Source, func(string)) (*Snapshot, error)
	transfer func(context.Context, Target, string, string, *Snapshot, uint64, func(Delivery)) (Delivery, error)
}
type Overview struct {
	TimeZone   string    `json:"time_zone"`
	Plan       Plan      `json:"plan"`
	Targets    []Target  `json:"targets"`
	Active     *Run      `json:"active"`
	ServerTime time.Time `json:"server_time"`
}
type History struct {
	Items    []Run `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"page_size"`
}

func New(db *gorm.DB, source Source) (*Manager, error) {
	if err := db.AutoMigrate(&Target{}, &Plan{}, &Run{}, &Delivery{}); err != nil {
		return nil, err
	}
	var existing int64
	if err := db.Model(&Target{}).Where("secret <> ''").Count(&existing).Error; err != nil {
		return nil, err
	}
	var encryptedPlans int64
	if err := db.Model(&Plan{}).Where("password <> ''").Count(&encryptedPlans).Error; err != nil {
		return nil, err
	}
	keyFile := filepath.Join(filepath.Dir(abs(source.Database)), "backup-credentials.key")
	c, err := LoadCipher(keyFile, existing+encryptedPlans > 0)
	if err != nil {
		return nil, err
	}
	key, err := os.ReadFile(keyFile) // #nosec G304 -- fixed credential-key filename alongside the configured database.
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(key)
	m := &Manager{db: db, source: source, cipher: c, installation: hex.EncodeToString(hash[:6]), prepare: Prepare, transfer: Transfer}
	now := time.Now()
	if err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Run{}).Where("state = ?", "running").Updates(map[string]any{"state": "interrupted", "phase": "interrupted", "finished_at": now, "error": "面板在备份完成前停止或重启，请重新备份"}).Error; err != nil {
			return err
		}
		return tx.Model(&Delivery{}).Where("state IN ?", []string{"running", "queued"}).Updates(map[string]any{"state": "interrupted", "phase": "interrupted", "finished_at": now, "error": "备份中断，目标文件未确认完成"}).Error
	}); err != nil {
		return nil, err
	}
	p := Plan{ID: 1}
	if err = db.First(&p, 1).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		p.Mode = "manual"
		p.IntervalMinutes = 60
		p.DailyTime = "03:00"
		p.TargetIDs = []uint64{}
		err = db.Create(&p).Error
	}
	if err != nil {
		return nil, err
	}
	if err = db.Model(&Target{}).Where("setup_state = ?", "installing").Updates(map[string]any{"setup_state": "interrupted", "setup_error": "面板已重启，安装结果尚未确认，请重新测试连接或重试对接", "setup_finished_at": time.Now()}).Error; err != nil {
		return nil, err
	}
	m.NotifyChange()
	return m, nil
}
func (m *Manager) NotifyChange() { m.dirty.Add(1) }
func (m *Manager) RunScheduler() {
	ctx, cancel := context.WithCancel(context.Background())
	m.stop = cancel
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		tick := time.NewTicker(15 * time.Second)
		defer tick.Stop()
		lastFiles := ""
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				signature := m.fileSignature()
				if signature != lastFiles {
					m.NotifyChange()
					lastFiles = signature
				}
				m.tick(time.Now())
			}
		}
	}()
}
func (m *Manager) Close() {
	if m.stop != nil {
		m.stop()
	}
	m.mu.Lock()
	m.closed = true
	if m.cancel != nil {
		m.cancel()
	}
	m.mu.Unlock()
	m.wg.Wait()
}
func (m *Manager) fileSignature() string {
	h := sha256.New()
	for _, root := range []string{m.source.DataDir, m.source.TSDBDir} {
		if root == "" {
			continue
		}
		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				if strings.HasPrefix(d.Name(), ".ddnz-backup-") || d.Name() == "snapshots" {
					return filepath.SkipDir
				}
				return nil
			}
			if abs(p) == abs(m.source.Database) || strings.HasPrefix(abs(p), abs(m.source.Database)+"-") {
				return nil
			}
			if info, e := d.Info(); e == nil {
				fmt.Fprintf(h, "%s:%d:%d;", p, info.Size(), info.ModTime().UnixNano())
			}
			return nil
		})
	}
	return hex.EncodeToString(h.Sum(nil))
}
func (m *Manager) tick(now time.Time) {
	m.mu.Lock()
	if m.pendingFinal != nil {
		if m.persistFinalLocked(m.pendingFinal) == nil {
			m.pendingFinal = nil
			m.active = nil
		}
		m.mu.Unlock()
		return
	}
	var p Plan
	if m.active != nil || m.db.First(&p, 1).Error != nil || p.Mode == "manual" {
		m.mu.Unlock()
		return
	}
	if p.NextAt != nil && now.Before(*p.NextAt) {
		m.mu.Unlock()
		return
	}
	if p.Mode == "realtime" && m.backed.Load() == m.dirty.Load() {
		next := m.nextTime(p, now)
		_ = m.db.Model(&Plan{}).Where("id = 1").Update("next_at", next).Error
		m.mu.Unlock()
		return
	}
	m.mu.Unlock()
	_, _ = m.Start("scheduled", nil, 0)
}
func (m *Manager) Overview() (Overview, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	view := Overview{ServerTime: time.Now(), Targets: []Target{}, TimeZone: m.location().String()}
	if err := m.db.First(&view.Plan, 1).Error; err != nil {
		return view, err
	}
	view.Plan.HasPassword = view.Plan.Password != ""
	if err := m.db.Order("id ASC").Find(&view.Targets).Error; err != nil {
		return view, err
	}
	for i := range view.Targets {
		view.Targets[i].HasSecret = view.Targets[i].Secret != ""
	}
	if m.active != nil {
		r := *m.active
		r.Deliveries = append([]Delivery(nil), m.active.Deliveries...)
		view.Active = &r
	}
	return view, nil
}
func (m *Manager) SavePlan(p Plan, password string) error {
	if err := ValidatePlan(p); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var old Plan
	if err := m.db.First(&old, 1).Error; err != nil {
		return err
	}
	p.ID = 1
	p.Password = old.Password
	p.UpdatedAt = time.Now()
	if password != "" {
		if len(password) < 12 || len(password) > 1024 {
			return errors.New("备份密码须为 12 至 1024 个字符")
		}
		var err error
		p.Password, err = seal(m.cipher, password)
		if err != nil {
			return err
		}
	}
	if p.Encrypt && p.Password == "" {
		return errors.New("请先设置备份密码")
	}
	var count int64
	if len(p.TargetIDs) > 0 {
		var selected []Target
		if err := m.db.Where("id IN ?", p.TargetIDs).Find(&selected).Error; err != nil {
			return err
		}
		for _, target := range selected {
			if target.Fingerprint == "" || target.Fingerprint == "SHA256:pending" {
				return errors.New("请先完成所选目标的对接并测试连接")
			}
		}

		if err := m.db.Model(&Target{}).Where("id IN ?", p.TargetIDs).Count(&count).Error; err != nil {
			return err
		}
		if int(count) != len(p.TargetIDs) {
			return errors.New("部分备份目标已删除，请重新选择")
		}
	}
	// Opening a page must never postpone a schedule. Only a schedule change resets it.
	p.NextAt = old.NextAt
	if p.Mode != old.Mode || p.IntervalMinutes != old.IntervalMinutes || p.DailyTime != old.DailyTime {
		p.NextAt = m.nextTime(p, time.Now())
	}
	if p.Mode == "manual" {
		p.NextAt = nil
	}
	return m.db.Save(&p).Error
}
func (m *Manager) ResolveInput(input TargetInput) (Target, string, error) {
	t := input.Target
	if t.Transport == "" {
		t.Transport = "sftp"
	}
	var secret string
	if input.ID != 0 {
		var old Target
		if err := m.db.First(&old, input.ID).Error; err != nil {
			return t, "", errors.New("备份目标不存在")
		}
		if old.Host == t.Host && old.Port == t.Port && old.User == t.User && old.AuthType == t.AuthType {
			var err error
			secret, err = unseal(m.cipher, old.Secret)
			if err != nil {
				return t, "", err
			}
		}
	}
	if t.AuthType == "key" && input.PrivateKey != "" {
		secret = input.PrivateKey
	}
	if t.AuthType == "password" && input.Password != "" {
		secret = input.Password
	}
	if secret == "" {
		return t, "", errors.New("请填写备份登录凭证")
	}
	return t, secret, nil
}
func (m *Manager) SaveTarget(input TargetInput) (Target, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	input.SetupState = ""
	input.SetupError = ""
	input.SetupStartedAt = nil
	input.SetupFinishedAt = nil
	if input.ID != 0 {
		var old Target
		if err := m.db.First(&old, input.ID).Error; err != nil {
			return Target{}, err
		}
		if old.SetupState == "installing" {
			return Target{}, errors.New("接收端正在安装，请等待完成")
		}
		input.SetupState = old.SetupState
		input.SetupError = old.SetupError
		input.SetupStartedAt = old.SetupStartedAt
		input.SetupFinishedAt = old.SetupFinishedAt
	}
	t, secret, err := m.ResolveInput(input)
	if err != nil {
		return t, err
	}
	if err = ValidateTarget(t); err != nil {
		return t, err
	}
	if t.Receiver && t.Fingerprint != "SHA256:pending" {
		t.SetupState = "success"
		t.SetupError = ""
	}
	t.Secret, err = seal(m.cipher, secret)
	if err != nil {
		return t, err
	}
	if m.active != nil {
		for _, d := range m.active.Deliveries {
			if d.TargetID == t.ID {
				return t, errors.New("此目标正在备份，请完成后再修改")
			}
		}
	}
	if t.ID == 0 {
		err = m.db.Create(&t).Error
	} else {
		err = m.db.Save(&t).Error
	}
	t.HasSecret = t.Secret != ""
	return t, err
}
func (m *Manager) DeleteTarget(id uint64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	var existing Target
	if err := m.db.First(&existing, id).Error; err != nil {
		return err
	}
	if existing.SetupState == "installing" {
		return errors.New("接收端正在安装，请等待完成")
	}
	if m.active != nil {
		for _, d := range m.active.Deliveries {
			if d.TargetID == id {
				return errors.New("此目标正在备份，请完成后再删除")
			}
		}
	}
	return m.db.Transaction(func(tx *gorm.DB) error {
		var p Plan
		if err := tx.First(&p, 1).Error; err != nil {
			return err
		}
		ids := []uint64{}
		for _, v := range p.TargetIDs {
			if v != id {
				ids = append(ids, v)
			}
		}
		p.TargetIDs = ids
		if len(ids) == 0 {
			p.Mode = "manual"
			p.NextAt = nil
		}
		if err := tx.Save(&p).Error; err != nil {
			return err
		}
		return tx.Delete(&Target{}, id).Error
	})
}
func (m *Manager) History(page, size int) (History, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 10
	}
	if size > 50 {
		size = 50
	}
	h := History{Page: page, PageSize: size, Items: []Run{}}
	if err := m.db.Model(&Run{}).Count(&h.Total).Error; err != nil {
		return h, err
	}
	err := m.db.Preload("Deliveries", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).Order("id DESC").Offset((page - 1) * size).Limit(size).Find(&h.Items).Error
	return h, err
}
func (m *Manager) Cancel(id uint64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active == nil || m.active.ID != id {
		return errors.New("该轮备份已结束")
	}
	if m.cancel == nil {
		return errors.New("备份文件已处理，正在保存记录，请稍候")
	}
	m.cancel()
	return nil
}
func (m *Manager) Start(trigger string, ids []uint64, retryOf uint64) (uint64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return 0, errors.New("面板正在停止，暂不能开始备份")
	}
	if m.active != nil {
		return 0, errors.New("已有备份正在进行，请等待完成")
	}
	var p Plan
	if err := m.db.First(&p, 1).Error; err != nil {
		return 0, err
	}
	if retryOf > 0 {
		var previous Run
		if err := m.db.Preload("Deliveries").First(&previous, retryOf).Error; err != nil {
			return 0, errors.New("备份轮次不存在")
		}
		failed := map[uint64]bool{}
		for _, d := range previous.Deliveries {
			if d.State != "success" {
				failed[d.TargetID] = true
			}
		}
		if len(ids) == 0 {
			for id := range failed {
				ids = append(ids, id)
			}
		} else {
			for _, id := range ids {
				if !failed[id] {
					return 0, errors.New("只能重试未完成的目标")
				}
			}
		}
		trigger = "retry"
	} else if len(ids) == 0 {
		ids = p.TargetIDs
	}
	if len(ids) == 0 {
		return 0, errors.New("请选择至少一台备份服务器")
	}
	check := p
	check.TargetIDs = ids
	if err := ValidatePlan(check); err != nil {
		return 0, err
	}
	var targets []Target
	if err := m.db.Where("id IN ?", ids).Order("id ASC").Find(&targets).Error; err != nil {
		return 0, err
	}
	for _, target := range targets {
		if target.SetupState == "installing" {
			return 0, errors.New("所选备份接收端正在安装，请等待完成")
		}
		if err := ValidateTarget(target); err != nil {
			return 0, err
		}
		if target.Fingerprint == "SHA256:pending" {
			return 0, errors.New("请先完成备份目标对接并测试连接")
		}
	}
	if len(targets) != len(ids) {
		return 0, errors.New("部分备份目标已删除，请重新选择")
	}
	password := ""
	var err error
	if p.Encrypt {
		password, err = unseal(m.cipher, p.Password)
		if err != nil {
			return 0, err
		}
		if password == "" {
			return 0, errors.New("尚未设置备份密码")
		}
	}
	run := Run{Trigger: trigger, RetryOf: retryOf, State: "running", Phase: "preparing", StartedAt: time.Now(), Encrypted: p.Encrypt}
	for _, t := range targets {
		run.Deliveries = append(run.Deliveries, Delivery{TargetID: t.ID, Name: t.Name, State: "queued", Phase: "waiting"})
	}
	if err = m.db.Create(&run).Error; err != nil {
		return 0, err
	}
	deadlineCtx, deadlineCancel := context.WithTimeout(context.Background(), 24*time.Hour)
	ctx, stopCause := context.WithCancelCause(deadlineCtx)
	cancel := func() { stopCause(context.Canceled); deadlineCancel() }
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if e := backupspace.Check(filepath.Dir(abs(m.source.Database)), 512*1024*1024); e != nil {
					stopCause(fmt.Errorf("面板磁盘空间不足，已停止备份: %w", e))
					return
				}
			}
		}
	}()
	m.cancel = cancel
	m.active = &run
	m.wg.Add(1)
	go m.execute(ctx, targets, password, m.dirty.Load())
	return run.ID, nil
}
func (m *Manager) execute(ctx context.Context, targets []Target, password string, generation uint64) {
	defer m.wg.Done()
	var snap *Snapshot
	var err error
	defer func() {
		if cause := context.Cause(ctx); cause != nil && cause != context.Canceled && cause != context.DeadlineExceeded {
			err = cause
		}
		if panicValue := recover(); panicValue != nil {
			err = errors.New("备份遇到异常，已停止本轮任务")
		}
		if snap != nil {
			if cleanupErr := snap.Close(); cleanupErr != nil {
				if err == nil {
					err = cleanupErr
				} else {
					err = fmt.Errorf("%v；清理快照失败: %v", err, cleanupErr)
				}
			}
		}
		m.finish(err, generation)
	}()
	snap, err = m.prepare(ctx, m.source, func(phase string) {
		m.mu.Lock()
		m.active.Phase = phase
		_ = m.db.Model(&Run{}).Where("id = ?", m.active.ID).Update("phase", phase).Error
		m.mu.Unlock()
	})
	if err != nil {
		return
	}
	snap.Password = password
	m.mu.Lock()
	m.active.SnapshotAt = &snap.At
	m.active.TotalBytes = snap.Total
	m.active.Phase = "transferring"
	runID := m.active.ID
	_ = m.db.Model(&Run{}).Where("id = ?", runID).Updates(map[string]any{"snapshot_at": snap.At, "total_bytes": snap.Total, "phase": "transferring"}).Error
	m.mu.Unlock()
	for i, t := range targets {
		if ctx.Err() != nil {
			err = ctx.Err()
			return
		}
		secret, secretErr := unseal(m.cipher, t.Secret)
		lastSave := time.Time{}
		report := func(value Delivery) {
			m.mu.Lock()
			defer m.mu.Unlock()
			original := m.active.Deliveries[i]
			value.ID = original.ID
			value.RunID = runID
			m.active.Deliveries[i] = value
			if time.Since(lastSave) > 5*time.Second || value.State != "running" {
				lastSave = time.Now()
				_ = m.db.Save(&value).Error
			}
		}
		var result Delivery
		var transferErr error
		if secretErr == nil {
			result, transferErr = m.transfer(ctx, t, secret, m.installation, snap, runID, report)
		} else {
			transferErr = secretErr
			result = Delivery{TargetID: t.ID, Name: t.Name}
		}
		if transferErr != nil {
			result.State = "failed"
			result.Phase = "failed"
			result.Error = transferErr.Error()
			done := time.Now()
			result.FinishedAt = &done
			result.BytesPerSecond = 0
		}
		report(result)
	}
}
func (m *Manager) persistFinalLocked(run *Run) error {
	return m.db.Transaction(func(tx *gorm.DB) error {
		for i := range run.Deliveries {
			if err := tx.Save(&run.Deliveries[i]).Error; err != nil {
				return err
			}
		}
		if err := tx.Omit("Deliveries").Save(run).Error; err != nil {
			return err
		}
		var p Plan
		if err := tx.First(&p, 1).Error; err != nil {
			return err
		}
		return tx.Model(&Plan{}).Where("id = 1").Update("next_at", m.nextTime(p, time.Now())).Error
	})
}
func (m *Manager) finish(fatal error, generation uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active == nil {
		return
	}
	now := time.Now()
	success := 0
	for i := range m.active.Deliveries {
		d := &m.active.Deliveries[i]
		if d.State == "success" {
			success++
			continue
		}
		if d.State == "queued" || d.State == "running" {
			d.State = "failed"
			d.Phase = "failed"
			d.FinishedAt = &now
			d.Error = "备份未完成"
			if fatal != nil {
				d.Error = fatal.Error()
			}
			if errors.Is(fatal, context.Canceled) {
				d.State = "cancelled"
				d.Error = "已取消本轮备份"
			}
			if errors.Is(fatal, context.DeadlineExceeded) {
				d.Error = "备份超过 24 小时，已停止，请检查网络和数据量"
			}
			if m.closed && fatal != nil {
				d.State = "interrupted"
				d.Error = "面板正在停止，本轮备份已中断"
			}
		}
	}
	m.active.FinishedAt = &now
	m.active.Phase = "completed"
	m.active.State = "success"
	if success == 0 {
		m.active.State = "failed"
	} else if success < len(m.active.Deliveries) {
		m.active.State = "partial"
	}
	if fatal != nil {
		m.active.Error = fatal.Error()
		if success == len(m.active.Deliveries) {
			m.active.State = "warning"
		}
	}
	if errors.Is(fatal, context.Canceled) {
		m.active.State = "cancelled"
		m.active.Error = "已取消本轮备份"
	}
	if m.closed && fatal != nil {
		m.active.State = "interrupted"
		m.active.Error = "面板正在停止，本轮备份已中断"
	}
	if success == len(m.active.Deliveries) && fatal == nil {
		m.backed.Store(generation)
	}
	m.cancel()
	m.cancel = nil
	if err := m.persistFinalLocked(m.active); err != nil {
		pending := *m.active
		pending.Deliveries = append([]Delivery(nil), m.active.Deliveries...)
		m.pendingFinal = &pending
		m.active.State = "warning"
		m.active.Phase = "recording"
		m.active.Error = "备份文件已处理，但记录暂时无法保存，正在重试：" + err.Error()
		return
	}
	m.active = nil
}

func (m *Manager) location() *time.Location {
	if m.source.Location != nil {
		return m.source.Location
	}
	return time.UTC
}
func (m *Manager) nextTime(p Plan, now time.Time) *time.Time {
	return NextTime(p, now.In(m.location()))
}
func (m *Manager) Target(id uint64) (Target, error) {
	var t Target
	err := m.db.First(&t, id).Error
	t.HasSecret = t.Secret != ""
	return t, err
}
func (m *Manager) BeginSetup(id uint64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active != nil {
		for _, d := range m.active.Deliveries {
			if d.TargetID == id {
				return errors.New("目标正在备份，请完成后再安装")
			}
		}
	}
	var t Target
	if err := m.db.First(&t, id).Error; err != nil {
		return err
	}
	if t.SetupState == "installing" {
		return errors.New("接收端正在安装，请等待完成")
	}
	return m.db.Model(&Target{}).Where("id = ?", id).Updates(map[string]any{"setup_state": "installing", "setup_error": "", "setup_started_at": time.Now(), "setup_finished_at": nil}).Error
}
func (m *Manager) FinishSetup(id uint64, fingerprint string, err error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	values := map[string]any{"setup_state": "success", "setup_error": "", "setup_finished_at": time.Now()}
	if err != nil {
		values["setup_state"] = "failed"
		values["setup_error"] = err.Error()
	} else {
		values["fingerprint"] = fingerprint
	}
	return m.db.Model(&Target{}).Where("id = ?", id).Updates(values).Error
}
