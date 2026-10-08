# 哪吒监控 · 非官方二次开发版

> [!IMPORTANT]
> **非官方版本声明**
>
> 本仓库基于 [哪吒监控（Nezha Monitoring）](https://github.com/nezhahq/nezha) 及其开源前端进行二次开发，不是从零开发的原创项目，也不是 NezhaHQ 官方发布版本。
> 上游项目及原作者不为本仓库的修改提供背书。功能、行为和更新节奏可能与官方版本不同；本仓库新增或修改功能的问题，请在 [本仓库 Issues](https://github.com/shini74744/nezha/issues) 反馈，不要直接向上游项目提交。

二开维护者：[shini74744](https://github.com/shini74744) · 本仓库：[shini74744/nezha](https://github.com/shini74744/nezha)。

## 安装与管理

Linux systemd 部署请使用[本仓库 Releases](https://github.com/shini74744/nezha/releases/latest) 和[面板管理说明](PANEL_MANAGEMENT.md)。`bash /opt/nezha/nezha.sh` 提供交互菜单，停止和重启显示实际停机阶段；更新只下载 `shini74744/nezha` 的校验安装包，不回退到官方版本。

## 二开新增功能

以下为本仓库在所基于的上游版本之上新增或扩展的主要功能；哪吒原有的基础监控、远程终端、告警和 DDNS 能力不属于本仓库原创。

- **前台原生美化设置**：在面板中配置背景图片 / 视频、分时背景、字体、问候语、渐变时钟、粒子与点击效果、Live2D / Sakana 等；支持桌面与手机端的相关独立选项。仅作用于默认前台主题，不强行套用到其他社区主题。
- **独立后台美化**：后台字体、背景、透明度、毛玻璃等单独配置，与前台美化分别保存。
- **服务器厂商 Logo 与图标库**：支持厂商分组、网站图标获取、图片地址、上传和本地托管；提供桌面 / 手机独立位置调整及实时卡片预览。
- **运营商与链接标签**：扩展运营商选择、线路图标和自定义徽章，服务器卡片可添加带名称的跳转链接。
- **套餐流量统计扩展**：按服务器配置流量配额、上传 / 下载 / 双向统计和每月重置日，展示套餐周期用量，支持无限流量与未设置配额的显示。
- **全站显示设置**：在「美化设置 → 全站显示」配置“统计显示拆分”和“详细网络拆分”，统一为开启拆分、关闭合并，修改自动保存；独立于主题美化总开关。统计拆分兼容默认、哆啦 A 梦及内置社区主题；详细与网络合并适用于默认和哆啦 A 梦的原生详情页。说明见 [APPEARANCE.md](APPEARANCE.md#全站显示设置2026-10-05) 和 [STATISTICS_VIEWS.md](STATISTICS_VIEWS.md)。
- **Telegram 可视化通知模块**：按离线 / 上线、资源告警 / 恢复、服务异常 / 恢复、IP 变更、DDNS 成功 / 失败、任务结果和证书等事件配置标题及展示字段，支持预览与单条模拟测试；可选系统指标、实时网速、TCP / UDP 连接数等内容。实际通知仍需配置对应规则、事件开关及通知组。
- **服务器到期通知**：读取服务器卡片中的购买日期、到期日期和付款周期；提醒天数与通知组可配置，未设置有效到期时间的服务器不通知。保留首次购买和原始到期日期，勾选自动续费时按日历周期计算最新到期日（不代表实际付款）；提供临近到期排序、剩余天数颜色提示、持久化发送记录和失败重试。
- **警报规则可视化编辑**：直接选择监控指标、阈值、服务器范围、通知组及触发任务，提供实时预览，并保留高级 JSON 编辑。支持多条件 AND、单位换算和旧规则兼容；切换指标前确认，检查上下限冲突，服务器选择数量与名单实时同步。
- **IP 变更历史与 DDNS 结果通知**：保存最近 7 次变更前的旧 IP 及变更时间，重启后保留；DDNS 可选择结果通知组，在记录更新重试结束后发送最终成功 / 失败结果。
- **普通隐藏与批量设置**：新增仅对未登录访客默认折叠的“普通隐藏”，访客可连续点击小鸡插画 5 下展开 / 收起；登录后不受普通隐藏影响。后台支持对选中服务器批量设置隐藏状态。普通隐藏不是权限保护，不能绕过“对游客隐藏”的访问限制。
- **UUID 快捷操作**：点击 UUID 按钮后，可选择复制 UUID 或复制携带该 UUID 的配套二开 Agent 安装命令。
- **防火墙与节点历史**：服务器标题旁提供操作历史，记录字段修改、分组、归属和系统 ID 变化。后台“防火墙”包含 Web 防火墙、认证防火墙和已删除服务器；区分已有/未登记 UUID 认证失败、UUID 缺失/格式不合法、删除后重连与疑似 UUID 冲突。删除清单立即留档，继续上报时突出标记；正常新 UUID 携带有效密钥仍自动注册。服务器删除先尝试标准 Agent 卸载，再删记录并拉黑 UUID；管理员可二次确认“放行 UUID”，保留删除历史且仍要求有效密钥。已删除节点可逐台开启“重连自动卸载”（默认关闭），验证身份后立即尝试，之后每隔 1 分钟检查，仍可连接命令通道时重试，每轮最多 3 次；次数用尽仍可连接则红框提醒并停止，离线不冒充卸载成功，保留操作历史。记录范围、冲突判定边界、系统兼容和 PAT 权限见 [FIREWALL.md](FIREWALL.md)。

## 调整与优化

- **卡片与 Logo 布局**：在现有卡片空间内调整 Logo，提供无页面背景的桌面 / 手机卡片预览；电脑端离线卡片顶部空间不足时，Logo 可使用左侧空白并按可用空间缩小，不挤动其他信息。
- **手机端账单展示**：固定到期信息的位置，将价格放在到期信息后面，减少是否填写价格造成的布局差异。
- **日期与计费周期**：账单开始 / 结束时间支持选择和编辑时、分、秒，统一按北京时间（UTC+8）填写、展示和进行日历周期计算，不受浏览器时区影响；明确带时区的旧数据保留实际时间含义。中文界面的周期显示为“年”等中文名称。
- **警报计算与兼容性**：检测窗口按秒显示和编辑，底层 `duration` 仍保留采样次数（每次约 3 秒），不改变旧规则实际时长；总网速按上传加下载计算。资源告警沿用窗口内异常采样超过 70% 的规则，离线告警要求窗口内采样全部离线。
- **通知内容与单位**：离线恢复使用“服务器上线”标题，成对事件归在同一设置组；网速支持从 B/s 换算为 Mbps，避免直接显示原始数字。
- **后台操作体验**：调整排序、公开备注、时间显示、统一留白、主题列表和移动端表格横向滚动；Logo 等编辑区域默认折叠，部分说明改为小问号帮助。
- **链接标签兼容性**：未填写协议时默认使用 HTTPS，明确填写 HTTP 时保留 HTTP；拒绝不安全的协议和包含账号密码的 URL。
- **交互稳定性**：装饰爱心不再拦截鼠标点击，改善小鸡连续点击的触发；减少浏览器自动翻译改动页面节点引发的异常。默认和哆啦 A 梦的统计、排序菜单打开时不再锁定页面滚动或隐藏右侧滚动条，避免页面宽度变化引起闪动；保留紧凑外观、键盘操作和手机触控。

美化功能范围与配置说明见 [APPEARANCE.md](APPEARANCE.md)。

<details>
<summary>开发者说明：源码目录、构建与测试（点击展开）</summary>

### 源码目录

- 后端：`cmd/`、`model/`、`service/` 等目录。
- 管理后台：`frontend/admin/`，包含排序、公开备注、时间格式、统一留白、移动端表格滚动和主题列表修复。
- 默认前台：`frontend/user/`，包含原生美化功能；其他社区主题不应用默认主题美化。
- 美化接口和配置说明：[APPEARANCE.md](APPEARANCE.md)。

### 从源码构建

Linux 构建依赖：Go 1.26.8、C/C++ 编译工具、Node.js 24、npm、Corepack、rsync、curl、unzip、yq v4、swag v1.16.6。
默认前台使用 package.json 固定的 pnpm 版本，后台使用 npm lockfile。
自行准备合法授权的 GeoIP country.mmdb，不要把生产配置、数据库、证书或访问令牌提交到仓库。

```bash
GEOIP_DB=/path/to/country.mmdb VERSION=custom-$(git rev-parse --short HEAD) bash script/build-custom.sh
```

产物为 `dist/dashboard`。脚本会编译本仓库的两套前端、保留原有社区主题，再嵌入后端。
仅运行上游 `fetch-frontends.sh` 会下载上游界面；构建此二开版请使用上述 `build-custom.sh`。
自有发布使用 `custom-*` 标签和校验过的安装包，不使用官方 `v*` 发布资产。Linux 安装、停机、重启、更新和故障恢复说明见 [面板管理与发布](PANEL_MANAGEMENT.md)。Windows x64 原生程序、密钥权限和运行方式见 [Windows 部署说明](docs/windows-deployment.md)。
测试方法和目录说明见 [frontend/README.md](frontend/README.md)。图片库安全升级与 Windows 并发快照复核见 [2026-10-08 增量回归记录](docs/image-snapshot-regression-20261008.md)。x/crypto 升级与 OpenPGP 防引入检查见 [依赖维护回归记录](docs/crypto-dependency-regression-20261008.md)。

</details>

## 原项目与作者

本仓库的后端、管理后台和默认前台分别基于以下开源项目，感谢原作者与所有贡献者：

| 组成部分 | 原作者 / 维护团队 | 原项目地址 |
| --- | --- | --- |
| 哪吒监控后端 | [naiba](https://github.com/naiba)、[NezhaHQ](https://github.com/nezhahq) 及贡献者 | [nezhahq/nezha](https://github.com/nezhahq/nezha)（原地址 [naiba/nezha](https://github.com/naiba/nezha)） |
| 管理后台 | [NezhaHQ](https://github.com/nezhahq) 及贡献者 | [nezhahq/admin-frontend](https://github.com/nezhahq/admin-frontend) |
| 默认前台 | [hamster1963](https://github.com/hamster1963) 及贡献者 | [hamster1963/nezha-dash-v2](https://github.com/hamster1963/nezha-dash-v2) |

官方文档：[nezha.wiki](https://nezha.wiki/)。官方文档介绍的是上游版本，本仓库二开功能请以本仓库说明和实际实现为准。

## 鸣谢

- 感谢哪吒监控原作者、NezhaHQ 团队、hamster1963 以及上游项目的所有贡献者，提供监控核心、管理后台与默认前台。
- 感谢 [熊大](https://xio.ng/) 为上游哪吒监控设计 Logo。
- 感谢社区主题作者：[karllao / Nezha-Pixel](https://github.com/karllao/nezha-pixel)、[hi2shark / Nazhua](https://github.com/hi2shark/nazhua)、[hi2shark / Aobobo](https://github.com/hi2shark/aobobo)、[hamster1963 / Nezha-ASCII](https://github.com/hamster1963/nezha-ascii)。社区主题来源见 [主题配置](service/singleton/frontend-templates.yaml)。
- 感谢本项目使用的开源依赖、提交问题与改进建议、参与测试的所有朋友。

## 许可证与版权

本仓库沿用 [Apache License 2.0](LICENSE)，保留上游版权和许可证声明；管理后台与默认前台的许可证分别见 [frontend/admin/LICENSE](frontend/admin/LICENSE) 和 [frontend/user/LICENSE](frontend/user/LICENSE)。
上游代码、第三方依赖、社区主题及图片等素材的权利与许可，以各自项目和文件中的声明为准；二次开发不改变原作者的署名与归属。

### DDNS 可视化配置与统一设置导航

- 动态域名解析采用紧凑列表，窄屏自动切换卡片；支持按名称、域名或 ID 搜索、按提供商筛选和批量删除。过滤后清空旧选择，避免误删隐藏项。
- 编辑器分为基本配置、解析记录、提供商配置、通知与重试。IPv4 / IPv6 对应 A / AAAA，域名支持换行或中英文逗号输入、预览和去重；中文域名由后端转换。沿用现有后端规则，不支持 `*` 泛域名。
- Cloudflare、腾讯云 DNSPod、HE.net、Webhook、Dummy 显示各自的配置项。密钥及 Webhook 请求头不回显，编辑时留空保留已保存值；保存失败保留当前草稿，关闭取消后重新打开读取当前配置。最大重试次数为 1–10。
- 保存配置不会立即更新 DNS；需要在服务器编辑中启用 DDNS 并关联配置。协议标识表示启用状态，不代表最近更新成功。删除仅移除面板 DDNS 配置，不主动删除提供商中的 DNS 记录。
- 八个设置页面复用同一导航布局；保留原背景、字体、主题样式。桌面五列、手机两列，浏览器前进/后退同步选中项，切换长短页面不再因不同边距或页面高度改变导航位置。
- 回归入口：`frontend/admin/tests/e2e/settings-layout.spec.ts`、`ddns-visual-editor.spec.ts`、`src/test/ddns-editor.test.ts` 及 `cmd/dashboard/controller/ddns_visual_editor_test.go`。浏览器测试使用模拟 API；控制器测试使用隔离数据库，不操作真实 DNS。

- 网络概览上传/下载圆形图标与文字在速率框内统一垂直居中，不使用上下偏移；随字体字号缩放；默认显示及内置美化均生效，保留原单位、颜色、发光分级与手机纵向排列。回归入口：`frontend/admin/tests/e2e/speed-alignment.spec.ts`（隔离前台预览 `https://127.0.0.1:18476`）和 `frontend/user/src/test/speed-alignment.test.tsx`。
