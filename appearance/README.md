# DDnezha 美化

| 目录 | 内容 |
| --- | --- |
| [site](site/) | 前台美化、背景、网络信息卡和挂件。[特效模块](site/modules/)按效果分文件。 |
| [cards](cards/) | 服务器卡片、毛玻璃反光、资源使用率和剩余天数进度条。 |
| [themes](themes/) | 纸间和哆啦 A 梦主题的组件、样式及随包素材。 |
| [admin](admin/) | 美化、卡片和图标设置页面及参数编辑器。 |
| [shared](shared/) | 前后台共用的字体和美化配置逻辑。 |
| [defaults](defaults/) | 前台、后台和纸间主题共用的公开默认值，由前端和 Go 面板共同读取。 |

图片、图标、赞助链接和请求接口由站点管理员在后台填写。文档与默认值使用保留域名，例如 `https://images.example.invalid/background.jpg`、`https://icons.example.invalid/logo.svg` 和 `https://api.example.invalid/region`。需要个人资源的效果可在填好地址后开启。

前端构建命令见[构建说明](../frontend/README.md)。面板读写设置的接口位于[后端控制器](../cmd/dashboard/controller/appearance.go)。
