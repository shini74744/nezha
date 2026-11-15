package panelbackup

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path"
	"strings"
	"time"
)

type Target struct {
	SetupState      string     `json:"setup_state"`
	SetupError      string     `json:"setup_error"`
	SetupStartedAt  *time.Time `json:"setup_started_at"`
	SetupFinishedAt *time.Time `json:"setup_finished_at"`

	Receiver    bool   `json:"receiver"`
	ID          uint64 `json:"id" gorm:"primaryKey"`
	Name        string `json:"name"`
	Transport   string `json:"transport"`
	ServerID    uint64 `json:"server_id"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	User        string `json:"user"`
	Directory   string `json:"directory"`
	Fingerprint string `json:"fingerprint"`
	AuthType    string `json:"auth_type"`
	Secret      string `json:"-"`
	HasSecret   bool   `json:"has_secret" gorm:"-"`
}

func (Target) TableName() string { return "panel_backup_targets" }

type Plan struct {
	ID              uint64     `json:"-" gorm:"primaryKey"`
	Encrypt         bool       `json:"encrypt"`
	Password        string     `json:"-"`
	HasPassword     bool       `json:"has_password" gorm:"-"`
	Mode            string     `json:"mode"`
	IntervalMinutes int        `json:"interval_minutes"`
	DailyTime       string     `json:"daily_time"`
	TargetIDs       []uint64   `json:"target_ids" gorm:"serializer:json"`
	NextAt          *time.Time `json:"next_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func (Plan) TableName() string { return "panel_backup_plan" }

type Run struct {
	ID         uint64     `json:"id" gorm:"primaryKey"`
	Trigger    string     `json:"trigger"`
	RetryOf    uint64     `json:"retry_of"`
	State      string     `json:"state"`
	Phase      string     `json:"phase"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
	Encrypted  bool       `json:"encrypted"`
	SnapshotAt *time.Time `json:"snapshot_at"`
	TotalBytes int64      `json:"total_bytes"`
	Error      string     `json:"error"`
	Deliveries []Delivery `json:"deliveries" gorm:"foreignKey:RunID"`
}

func (Run) TableName() string { return "panel_backup_runs" }

type Delivery struct {
	ID             uint64     `json:"id" gorm:"primaryKey"`
	RunID          uint64     `json:"run_id" gorm:"index"`
	TargetID       uint64     `json:"target_id"`
	Name           string     `json:"name"`
	State          string     `json:"state"`
	Phase          string     `json:"phase"`
	StartedAt      *time.Time `json:"started_at"`
	FinishedAt     *time.Time `json:"finished_at"`
	ProcessedBytes int64      `json:"processed_bytes"`
	TotalBytes     int64      `json:"total_bytes"`
	SentBytes      int64      `json:"sent_bytes"`
	VerifiedBytes  int64      `json:"verified_bytes"`
	BytesPerSecond int64      `json:"bytes_per_second"`
	Archive        string     `json:"archive"`
	SHA256         string     `json:"sha256"`
	Error          string     `json:"error"`
}

func (Delivery) TableName() string { return "panel_backup_deliveries" }

type TargetInput struct {
	Target
	Password   string `json:"password"`
	PrivateKey string `json:"private_key"`
}

func ValidateTarget(t Target) error {
	if strings.TrimSpace(t.Name) == "" || len(t.Name) > 120 {
		return errors.New("请输入备份目标名称（最多 120 字）")
	}
	if t.Receiver && t.AuthType != "key" {
		return errors.New("DDnezha 备份接收端仅使用专用密钥登录")
	}
	if t.Receiver && (t.Port < 1024 || t.Port > 65535) {
		return errors.New("备份接收端端口须为 1024 至 65535")
	}
	if t.Transport != "sftp" {
		return errors.New("请选择传输方式")
	}
	if !path.IsAbs(t.Directory) || path.Clean(t.Directory) == "/" || strings.ContainsAny(t.Directory, "\x00\r\n\\") || len(t.Directory) > 1024 {
		return errors.New("备份目录须为独立的绝对路径，不能使用根目录")
	}
	for _, part := range strings.Split(t.Directory, "/") {
		if part == ".." {
			return errors.New("备份目录不能包含 ..")
		}
	}
	if strings.TrimSpace(t.Host) == "" || strings.ContainsAny(t.Host, "\x00\r\n /") || t.Port < 1 || t.Port > 65535 || strings.TrimSpace(t.User) == "" {
		return errors.New("请填写正确的服务器地址、端口和账号")
	}
	if t.AuthType != "password" && t.AuthType != "key" {
		return errors.New("请选择密码或私钥登录")
	}
	if !strings.HasPrefix(t.Fingerprint, "SHA256:") {
		return errors.New("请先测试连接并确认服务器指纹")
	}
	return nil
}
func ValidatePlan(p Plan) error {
	switch p.Mode {
	case "manual":
	case "interval", "realtime":
		if p.IntervalMinutes < 1 || p.IntervalMinutes > 43200 {
			return errors.New("备份间隔须为 1 至 43200 分钟")
		}
	case "daily":
		if _, err := time.Parse("15:04", p.DailyTime); err != nil {
			return errors.New("请选择每日备份时间")
		}
	default:
		return errors.New("请选择备份方式")
	}
	if p.Mode != "manual" && len(p.TargetIDs) == 0 {
		return errors.New("请选择至少一台备份服务器")
	}
	if len(p.TargetIDs) > 20 {
		return errors.New("每轮最多选择 20 台备份服务器")
	}
	seen := map[uint64]bool{}
	for _, id := range p.TargetIDs {
		if id == 0 || seen[id] {
			return errors.New("备份目标无效或重复")
		}
		seen[id] = true
	}
	return nil
}
func NextTime(p Plan, now time.Time) *time.Time {
	var next time.Time
	switch p.Mode {
	case "interval", "realtime":
		next = now.Add(time.Duration(p.IntervalMinutes) * time.Minute)
	case "daily":
		parsed, err := time.Parse("15:04", p.DailyTime)
		if err != nil {
			return nil
		}
		next = time.Date(now.Year(), now.Month(), now.Day(), parsed.Hour(), parsed.Minute(), 0, 0, now.Location())
		if !next.After(now) {
			next = next.AddDate(0, 0, 1)
		}
	default:
		return nil
	}
	return &next
}
func LoadCipher(file string, existing bool) (cipher.AEAD, error) {
	key, err := os.ReadFile(file)
	if os.IsNotExist(err) && !existing {
		key = make([]byte, 32)
		if _, err = rand.Read(key); err != nil {
			return nil, err
		}
		f, e := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return nil, e
		}
		_, err = f.Write(key)
		if err == nil {
			err = f.Sync()
		}
		ce := f.Close()
		if err == nil {
			err = ce
		}
	}
	if err != nil {
		return nil, fmt.Errorf("无法读取备份凭证密钥: %w", err)
	}
	if len(key) != 32 {
		return nil, errors.New("备份凭证密钥格式错误")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func seal(c cipher.AEAD, plain string) (string, error) {
	nonce := make([]byte, c.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(c.Seal(nonce, nonce, []byte(plain), []byte("ddnezha-backup:v1"))), nil
}
func unseal(c cipher.AEAD, encoded string) (string, error) {
	b, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(b) < c.NonceSize() {
		return "", errors.New("备份登录凭证损坏")
	}
	plain, err := c.Open(nil, b[:c.NonceSize()], b[c.NonceSize():], []byte("ddnezha-backup:v1"))
	if err != nil {
		return "", errors.New("无法解密备份登录凭证")
	}
	return string(plain), nil
}
