package controller

import (
	"github.com/gin-gonic/gin"
	"html"
)

// Both entry gates use this exact template so responsive, error, and dark states stay aligned.
type accessPasswordPage struct {
	Backend                   bool
	Next, Message, CSRF, Site string
	Disabled                  bool
	Failures, BanMinutes      int
}

func serveAccessPasswordPage(c *gin.Context, page accessPasswordPage, status int) {
	title, description, action, button := "前台访问密码", "输入访问密码后查看监控页面。", "/api/v1/frontend-auth", "进入前台"
	if page.Backend {
		title, description, action, button = "后台访问密码", "", "/api/v1/backend-auth", "继续登录"
	}
	site := "哪吒监控"
	if page.Site != "" {
		site = page.Site
	}
	escape := html.EscapeString
	descriptionHTML := ""
	if description != "" {
		descriptionHTML = `<p class="description">` + escape(description) + `</p>`
	}
	message := ""
	if page.Message != "" {
		message = `<div class="message" role="alert">` + escape(page.Message) + `</div>`
	}
	form := `<form method="post" action="` + action + `"><input type="hidden" name="next" value="` + escape(page.Next) + `">`
	if page.CSRF != "" {
		form += `<input type="hidden" name="csrf" value="` + escape(page.CSRF) + `">`
	}
	form += `<label for="access-password">访问密码</label><input id="access-password" type="password" name="password" autocomplete="current-password" maxlength="72" autofocus required><button type="submit">` + button + `</button></form>`
	if page.Disabled {
		form = `<a class="retry" href="` + escape(page.Next) + `">刷新重试</a>`
	}
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Header("Cache-Control", "no-store")
	c.Header("Vary", "Cookie")
	c.Header("X-Frame-Options", "DENY")
	c.Header("Referrer-Policy", "same-origin")
	c.Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
	c.Status(status)
	_, _ = c.Writer.WriteString(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">
<title>` + escape(title+" · "+site) + `</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100dvh;padding:20px;display:grid;place-items:center;
font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f5f5f5;color:#171717}
.card{width:min(100%,380px);min-width:0;background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:24px;box-shadow:0 18px 45px rgba(0,0,0,.08)}
.site{font-size:13px;color:#737373;margin:0 0 10px;overflow-wrap:anywhere}h1{font-size:22px;line-height:1.35;margin:0 0 8px}
.description{font-size:14px;line-height:1.6;color:#666;margin:0 0 20px}h1+form{margin-top:20px}
label{display:block;font-size:14px;font-weight:600;margin:0 0 8px}input[type=password]{width:100%;min-width:0;height:44px;border:1px solid #d4d4d4;
border-radius:9px;padding:0 12px;font:inherit;font-size:16px;background:#fff;color:#171717}
button,.retry{display:block;width:100%;min-height:44px;margin-top:14px;padding:11px 14px;border:0;border-radius:9px;background:#171717;
color:#fff;font:inherit;font-size:15px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none}
input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid #737373;outline-offset:3px}
.message{font-size:14px;line-height:1.6;margin:0 0 16px;padding:10px 12px;border:1px solid #fecaca;border-radius:9px;background:#fef2f2;color:#b91c1c;overflow-wrap:anywhere}
@media(prefers-color-scheme:dark){body{background:#171717;color:#fafafa}.card{background:#262626;border-color:#404040}.site,.description{color:#a3a3a3}
input[type=password]{background:#171717;color:#fafafa;border-color:#525252}button,.retry{background:#fafafa;color:#171717}.message{background:#450a0a;border-color:#7f1d1d;color:#fecaca}}
@media(max-width:360px){body{padding:16px}.card{padding:20px}}
</style></head><body><main class="card" aria-labelledby="access-title"><p class="site">` + escape(site) + `</p><h1 id="access-title">` + title + `</h1>
` + descriptionHTML + message + form + `</main></body></html>`)
}
