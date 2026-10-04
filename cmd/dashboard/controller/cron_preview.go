package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/robfig/cron/v3"
)

type cronPreview struct {
	Timezone string   `json:"timezone"`
	Next     []string `json:"next"`
}

// Uses exactly the six-field/descriptor parser used by CronShared, without
// registering a job, persisting a task, or dispatching any command.
func previewCronSchedule(spec string, now time.Time, location *time.Location) (*cronPreview, error) {
	spec = strings.TrimSpace(spec)
	if spec == "" || len(spec) > 512 {
		return nil, errors.New("请输入 Cron 表达式（最多 512 字节）")
	}
	schedule, err := cron.NewParser(cron.Second | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor).Parse(spec)
	if err != nil {
		return nil, fmt.Errorf("Cron 表达式无效：%v", err)
	}
	if location == nil {
		location = time.Local
	}
	zone := location
	if s, ok := schedule.(*cron.SpecSchedule); ok && s.Location != time.Local {
		zone = s.Location
	}
	result := &cronPreview{Timezone: zone.String(), Next: []string{}}
	cursor := now.In(location)
	for i := 0; i < 5; i++ {
		cursor = schedule.Next(cursor)
		if cursor.IsZero() {
			break
		}
		result.Next = append(result.Next, cursor.In(zone).Format(time.RFC3339))
	}
	return result, nil
}

func previewCron(c *gin.Context) (*cronPreview, error) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var form struct {
		Scheduler string `json:"scheduler"`
	}
	if err := c.ShouldBindJSON(&form); err != nil {
		return nil, errors.New("预览请求格式无效或过长")
	}
	return previewCronSchedule(form.Scheduler, time.Now(), singleton.Loc)
}
