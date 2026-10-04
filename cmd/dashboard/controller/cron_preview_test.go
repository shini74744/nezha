package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCronPreviewUsesSchedulerSemantics(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Shanghai")
	require.NoError(t, err)
	now := time.Date(2026, 10, 4, 2, 59, 59, 0, loc)
	daily, err := previewCronSchedule("0 0 3 * * *", now, loc)
	require.NoError(t, err)
	require.Equal(t, "Asia/Shanghai", daily.Timezone)
	require.Len(t, daily.Next, 5)
	require.Equal(t, "2026-10-04T03:00:00+08:00", daily.Next[0])
	require.Equal(t, "2026-10-05T03:00:00+08:00", daily.Next[1])
	weekly, err := previewCronSchedule("0 0 3 * * 1,5", now, loc)
	require.NoError(t, err)
	require.Equal(t, "2026-10-05T03:00:00+08:00", weekly.Next[0])
	require.Equal(t, "2026-10-09T03:00:00+08:00", weekly.Next[1])
	monthly, err := previewCronSchedule("0 0 3 31 * *", now, loc)
	require.NoError(t, err)
	require.Equal(t, "2026-10-31T03:00:00+08:00", monthly.Next[0])
	require.Equal(t, "2026-12-31T03:00:00+08:00", monthly.Next[1])
	explicit, err := previewCronSchedule("CRON_TZ=UTC 0 0 3 * * *", now, loc)
	require.NoError(t, err)
	require.Equal(t, "UTC", explicit.Timezone)
	require.Equal(t, "2026-10-04T03:00:00Z", explicit.Next[0])
	interval, err := previewCronSchedule("@every 90m", now, loc)
	require.NoError(t, err)
	require.Equal(t, "2026-10-04T04:29:59+08:00", interval.Next[0])
	_, err = previewCronSchedule("@weekly", now, loc)
	require.NoError(t, err)
	for _, spec := range []string{"", "0 3 * * *", "0 0 25 * * *", strings.Repeat("*", 513)} {
		_, err := previewCronSchedule(spec, now, loc)
		require.Error(t, err)
	}
	never, err := previewCronSchedule("0 0 3 31 2 *", now, loc)
	require.NoError(t, err)
	require.Empty(t, never.Next)
}

func TestCronPreviewRejectsOversizedBody(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/", strings.NewReader(`{"scheduler":"`+strings.Repeat("x", 5000)+`"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	_, err := previewCron(c)
	require.Error(t, err)
	require.Equal(t, "no-store", c.Writer.Header().Get("Cache-Control"))
}
