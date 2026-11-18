package controller

import (
	"html"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Both entry gates use this exact template so responsive, error, and dark states stay aligned.
type accessPasswordPage struct {
	Backend                   bool
	Paper                     bool
	Next, Message, CSRF, Site string
	Disabled                  bool
	Failures, BanMinutes      int
}

func serveAccessPasswordPage(c *gin.Context, page accessPasswordPage, status int) {
	title, description, action, button := "前台访问密码", "输入访问密码后查看监控页面。", "/api/v1/frontend-auth", "进入前台"
	context, placeholder := "监控访问", "请输入前台访问密码"
	nextNote, backLink := "", ""
	pageClass := ""
	if page.Paper && !page.Backend {
		pageClass = "paper"
		context = "纸间 · 监控访问"
	}
	if page.Backend {
		title, description, action, button = "后台访问验证", "请输入管理员设置的后台访问密码。", "/api/v1/backend-auth", "验证并继续"
		context, placeholder = "后台管理", "请输入后台访问密码"
		nextNote = `<p class="next-note">尚未登录账号时，验证后将进入账号登录页。</p>`
		backLink = `<footer class="card-footer"><a class="back-link" href="/"><span aria-hidden="true">←</span> 返回前台</a></footer>`
	}
	if page.Disabled {
		title, description = "验证暂不可用", "请查看下方提示，稍后重试。"
		if status == http.StatusTooManyRequests {
			title, description = "访问暂时受限", "请等待限制解除后再试。"
		}
		nextNote = ""
	}
	site := "哪吒监控"
	if page.Site != "" {
		site = page.Site
	}
	escape := html.EscapeString
	message, describedBy, invalid := "", "access-description", ""
	if page.Message != "" {
		message = `<div id="access-message" class="message" role="alert">` + escape(page.Message) + `</div>`
		describedBy += " access-message"
		if status == http.StatusUnauthorized {
			invalid = ` aria-invalid="true"`
		}
	}
	form := `<form method="post" action="` + action + `"><input type="hidden" name="next" value="` + escape(page.Next) + `">`
	if page.CSRF != "" {
		form += `<input type="hidden" name="csrf" value="` + escape(page.CSRF) + `">`
	}
	form += `<label for="access-password">访问密码</label><div class="input-shell"><svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/></svg><input id="access-password" type="password" name="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" maxlength="72" placeholder="` + escape(placeholder) + `" aria-describedby="` + describedBy + `"` + invalid + ` autofocus required></div><button class="primary" type="submit"><span>` + button + `</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></form>`
	if page.Disabled {
		form = `<a class="primary retry" href="` + escape(page.Next) + `">刷新重试</a>`
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
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;padding:32px 20px;display:grid;place-items:center;
font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#17282a;
background:radial-gradient(ellipse at 15% 0%,rgba(20,184,166,.12),transparent 52%),radial-gradient(ellipse at 95% 100%,rgba(59,130,246,.07),transparent 50%),#f4f7f8}
.card{width:min(100%,432px);min-width:0;padding:32px;background:rgba(255,255,255,.96);border:1px solid #dfe8e7;border-radius:24px;
box-shadow:0 24px 70px -28px rgba(15,42,41,.26),0 2px 8px rgba(15,42,41,.03)}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:28px;min-width:0}
.brand-mark{display:grid;place-items:center;width:44px;height:44px;flex:none;background:#e7f5f1;color:#0f766e;border:1px solid #d0eae3;border-radius:14px}
.brand-mark svg{width:24px;height:24px}.brand-copy{min-width:0}
.site{margin:0;font-size:14px;line-height:1.5;font-weight:650;overflow-wrap:anywhere}
.context{margin:2px 0 0;font-size:12px;line-height:1.5;color:#647777}
h1{margin:0;font-size:26px;line-height:1.35;letter-spacing:-.5px}
.description{margin:10px 0 24px;font-size:14px;line-height:1.7;color:#596d6c;overflow-wrap:anywhere}
label{display:block;margin-bottom:9px;font-size:14px;line-height:1.5;font-weight:600}
.input-shell{position:relative}.input-icon{position:absolute;left:14px;top:15px;width:18px;height:18px;color:#758886;pointer-events:none}
input[type=password]{width:100%;min-width:0;height:48px;padding:0 14px 0 42px;border:1px solid #cddbd8;border-radius:12px;background:#fbfdfc;color:#17282a;font:inherit;font-size:16px;transition:border-color .15s,box-shadow .15s}
input::placeholder{color:#82938f}input:hover{border-color:#91aca5}
input:focus-visible{outline:none;border-color:#0f766e;box-shadow:0 0 0 3px rgba(15,118,110,.12)}
input[aria-invalid=true]{border-color:#d75c50}
.primary{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:48px;margin-top:16px;padding:12px 16px;border:1px solid transparent;border-radius:12px;
background:#0f766e;color:#fff;font:inherit;font-size:15px;font-weight:650;line-height:1.5;text-align:center;text-decoration:none;cursor:pointer;transition:background .15s}
.primary svg{width:18px;height:18px;flex:none}.primary:hover{background:#115e59}.primary:active{background:#134e4a}
button:focus-visible,a:focus-visible{outline:3px solid #2a9d90;outline-offset:3px}
.next-note{margin:14px 0 0;color:#6a7e79;font-size:12px;line-height:1.75}
.card-footer{margin-top:24px;padding-top:14px;border-top:1px solid #e8eeec}
.back-link{display:flex;align-items:center;justify-content:center;gap:7px;min-height:40px;border-radius:8px;color:#56726b;text-decoration:none;font-size:14px}
.back-link:hover{color:#0f766e;background:#f0f7f4}
.message{margin:0 0 20px;padding:12px 14px;border:1px solid #f3c8c1;border-radius:12px;background:#fff4f2;color:#a1382d;font-size:14px;line-height:1.7;overflow-wrap:anywhere}
@media(prefers-color-scheme:dark){
body{color:#eaf3ef;background:radial-gradient(ellipse at 10% 0%,rgba(20,184,166,.10),transparent 50%),radial-gradient(ellipse at 95% 100%,rgba(59,130,246,.06),transparent 48%),#111817}
.card{background:#1b2523;border-color:#31413b;box-shadow:0 24px 80px -26px rgba(0,0,0,.55)}
.brand-mark{background:#173b33;color:#7edec1;border-color:#2b5145}.context{color:#91a69e}
.description{color:#acbdb5}input[type=password]{background:#141e1b;color:#eff7f2;border-color:#43564c}
.input-icon{color:#95aba1}input::placeholder{color:#81988d}input:hover{border-color:#708c7d}
input:focus-visible{border-color:#70d5b7;box-shadow:0 0 0 3px rgba(112,213,183,.13)}
input[aria-invalid=true]{border-color:#dd8b7f}.primary{background:#7edec1;color:#102e24}.primary:hover{background:#a1e9d2}.primary:active{background:#6bceb0}
.next-note{color:#94aaa0}.card-footer{border-color:#32423a}.back-link{color:#b3c9bd}.back-link:hover{color:#9ce7cb;background:#23372e}
.message{background:#38221e;border-color:#694037;color:#f0b4a7}
}
@media(max-width:480px){body{padding:20px 16px}.card{padding:26px 22px;border-radius:20px}.brand{margin-bottom:24px}h1{font-size:24px}}
@media(max-height:640px){body{align-items:start;padding-top:24px;padding-bottom:24px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
` + paperAccessCSS + `</style></head><body class="` + pageClass + `"><main class="card" aria-labelledby="access-title"><div class="brand"><span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 20 6v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8.5 11.5 2.5 2.5 4.5-5"/></svg></span><div class="brand-copy"><p class="site">` + escape(site) + `</p><p class="context">` + context + `</p></div></div><h1 id="access-title">` + title + `</h1>
<p id="access-description" class="description">` + escape(description) + `</p>` + message + form + nextNote + backLink + `</main></body></html>`)
}
