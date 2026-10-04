package controller

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"fmt"
	"html"
	"io"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/pkg/utils"
	"github.com/nezhahq/nezha/service/singleton"
)

//go:embed frontend-statistics.js
var frontendStatisticsJS []byte

const frontendStatisticsPath = "/__nezha/statistics.js"

var frontendStatisticsVersion = fmt.Sprintf("%x", sha256.Sum256(frontendStatisticsJS))[:16]

// Default and Doraemon have a native toolbar; independently bundled themes use
// an isolated, read-only launcher. Never inject into admin, data, or API pages.
func sharedStatisticsTheme(templateRoot string) bool {
	return fs.ValidPath(templateRoot) && strings.HasSuffix(templateRoot, "-dist") &&
		templateRoot != "admin-dist" && templateRoot != "user-dist" && templateRoot != "doraemon-dist"
}

func serveStatisticsHTML(c *gin.Context, templateRoot, name string, file io.ReadSeeker, status int) bool {
	if name != "index.html" || !sharedStatisticsTheme(templateRoot) ||
		strings.HasPrefix(c.Request.URL.Path, "/dashboard/") || status != http.StatusOK {
		return false
	}
	body, err := io.ReadAll(file)
	if err != nil {
		_, _ = file.Seek(0, io.SeekStart)
		return false
	}
	statisticsSplit := true
	settingsMutationMu.Lock()
	if singleton.Conf != nil {
		statisticsSplit = resolveOptionalBool(singleton.Conf.StatisticsSplit, true)
	}
	settingsMutationMu.Unlock()
	tag := []byte(`<script id="nezha-statistics-loader" defer src="` + frontendStatisticsPath +
		"?v=" + frontendStatisticsVersion + `" data-theme="` + html.EscapeString(templateRoot) + `" data-statistics-split="` + fmt.Sprint(statisticsSplit) + `"></script>`)
	if !bytes.Contains(body, []byte(`id="nezha-statistics-loader"`)) {
		lower := bytes.ToLower(body)
		if at := bytes.Index(lower, []byte("</head>")); at >= 0 {
			body = append(append(append([]byte{}, body[:at]...), tag...), body[at:]...)
		} else {
			body = append(body, tag...)
		}
	}
	c.Header("Cache-Control", "no-cache")
	http.ServeContent(utils.NewGinCustomWriter(c, status), c.Request, name, time.Time{}, bytes.NewReader(body))
	return true
}

func serveStatisticsScript(c *gin.Context) bool {
	if c.Request.URL.Path != frontendStatisticsPath {
		return false
	}
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		c.Status(http.StatusMethodNotAllowed)
		return true
	}
	c.Header("Cache-Control", "no-cache")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Type", "text/javascript; charset=utf-8")
	http.ServeContent(c.Writer, c.Request, "statistics.js", time.Time{}, bytes.NewReader(frontendStatisticsJS))
	return true
}
