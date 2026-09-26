# 原生美化功能（二开）
## 范围
- 只在默认前台主题 user-dist 运行；其他主题不加载，配置保留。
- 后台设置第二行的“美化设置”独立保存，不修改服务器身份、Agent 密钥或其他设置。
- 旧自定义代码迁移只接受已核对的 SHA-256，并在替换前归档；不再执行外部 jm/xjs 脚本。
- 根据用户最新要求，删除梅花落和底部波浪；樱花、雪花、星星等保留。
## 29 个配置组
branding, dark, runtime, greeting, clock, background, video, sponsor, visitorIP,
footerIP, quote, counter, font, traffic, speed, nameColor, links, hideControls,
protection, footer, sideImage, network, snow, fragments, heart, sakura, stars,
live2d, analytics。
参数和默认值以 resource/appearance/manifest.json 为准，前后台使用同一份清单。
原脚本的域名锁和域名跳转已移除；模型、图片、视频、字体、访客位置及统计接口仍依赖对应外部服务。
## 源码位置（GMHK33D5）
- 后端：/srv/nezha-builder/repo
- 管理前端：/srv/nezha-builder/admin-frontend-src
- 默认前台：/srv/nezha-builder/user-frontend-src（基础 v2.4.2 / e0e90ac）
- 来源核对与转换工具：/srv/nezha-builder/beautification-reference
- jm 基线：07738cc3023094e06c6e6b39478c9f9bc43866c8
- xjs 基线：9e4394a2c8dac8a89af671e827d3bb403bcbaa81
- 保留 Live2D 和 Font Awesome 的许可证及本地静态资源。
## 安全与测试
- API：管理员 GET/PATCH /api/v1/setting/appearance；修订号冲突拒绝覆盖。
- 后端校验已知功能、参数类型、URL、范围；归档不进入公共接口。
- 配置原子写入，保留 JWT 和前台密码的磁盘持久化；环境变量密钥不落盘。
- 163 项前台单元测试、10 项后台浏览器测试、后端全量测试通过。
- 原生效果生命周期、手机、SPA、Live2D 模型与工具、配置保存重启、最终打包页面另行回归。
- 本次只撤销后台服务器页特殊全宽布局，保留时间显示修复和原有服务器管理功能。
## 重建与发布
先构建两个前端，再通过 /srv/nezha-builder/build.sh 用 Go 1.26.8 打包。
完成清单工具 complete-manifest.mjs 会过滤已移除的两项；不要重跑非幂等的 integrate-native.mjs。
live-custom-code.snapshot.json、配置备份和 smoke 测试数据库不应提交到公共仓库。
生产升级前先备份 app、完整 data 和 systemd 服务文件，校验 ID/UUID 及其他配置未改变。

## 2026-09-26 背景重构与独立后台美化
- 前台桌面/手机背景改为每行一个图片或视频 URL；无后缀地址先探测图片，再尝试视频。
- 分时规则支持时区、跨午夜、排序和独立移动端列表；特殊地区支持 JSON 字段路径、ASN/运营商关键词、国家代码与优先级。
- 运营商请求失败保留普通/分时背景；背景声音由独立按钮控制，默认静音。
- 旧 night*、chinaMedia 配置按兼容规则迁移，其他 29 个前台功能参数保留。
- 后台第二行“后台美化设置”独立保存：字体、背景、透明度/毛玻璃、动画小人、品牌、点击/返回顶部、Ping/TCPing/Ping0 与时区转换。
- 后台配置清单 resource/appearance/dashboard-manifest.json；接口 GET/PATCH /api/v1/setting/dashboard-appearance。
- 导入旧代码仅解析静态 NZ_DASHBOARD_CONFIG，不执行脚本；原代码存于私有 dashboard_appearance_legacy_code；修订冲突拒绝覆盖。
- 根据用户提供的配置保留 MiSans、背景/Logo/头像 URL、各透明度、玻璃碎片20、点击文字、返回顶部及两个工具脚本功能；不再加载这两个外部脚本。
- 前台 removeChild 错误已通过模拟翻译替换文本节点复现。前后台 React 根节点使用 translate=no，保留内置语言切换，避免外部翻译破坏节点身份。
- 清单生成顺序：complete-manifest.mjs（基础）→ upgrade-background-manifest.mjs → dashboard-manifest.mjs。不要只运行第一个脚本覆盖新字段。
- 新测试：background-policy/background-runtime、dashboard-appearance、native-stability；保留 layout-time 和原生功能回归。

## 2026-09-26 GitHub 源码同步
- 本仓库现已包含 frontend/admin 和 frontend/user，不再依赖构建机外部源码目录。
- 上述 GMHK33D5 绝对路径和阶段性测试记录属于开发历史；其他机器使用 README 中的构建命令。
- 当前后台所有页面与导航共用宽度和少量左右留白，替代之前服务器页单独加宽的实现；手机表格允许内部横向滚动。
- 设置缓存按登录用户/角色区分，恢复登录后完整主题列表；当前主题及其他美化参数不自动变更。
- 截图输出改用 test-results，通用美化测试从清单构造数据，不提交生产配置副本。
