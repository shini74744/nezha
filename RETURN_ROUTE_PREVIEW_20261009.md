# 2026-10-09 阿里预览验证记录

## 范围

- 仅接入 NextTrace 回程检测，不执行 NodeQuality/NetQuality 全量脚本，不加入硬件、带宽、IP 质量等检测。
- 详情页 BGP 与流媒体之间增加“回程”；后台卡片设置增加独立策略；节点编辑增加独立开关。
- 默认北京、上海、广州三网九个目标，支持逐跳明细、有效响应平均 RTT、历史记录和已上报协议族。自动检测初始关闭。
- 复用现有 Agent 命令通道，不升级 Agent。检测节点需 Linux root、支持的架构及命令执行权限；首次使用下载固定版本 NextTrace tiny 并校验 SHA-256。
- 背景设置分级折叠，载入效果放到最底部；载入动画只作用于背景；稳定 Logo DOM 并为失效图片提供回退。
- 手机 BGP 快照箭头并入协议/路径数量行，桌面布局保持原样。

## 发布边界

仅部署阿里，不提交、不推送 GitHub，不发布 Release。构建机及远端 main 均仍为 `bab735372edb9bc9012079f587e5f300f72124f7`。保留原有未提交变更。

- 版本：`custom-2026.10.09-return-route-preview1`
- 程序 SHA-256：`f94c7d297e3cc7ef7302ce4fc62c01257b6a94ed76ab512daaf399de9c911d00`
- 证据目录：`/srv/nezha-builder/background-settings-20261009`
- 阿里部署记录：`/opt/nezha/backups/return-route-20261009`
- 可恢复备份：`/opt/nezha/backups/update-20261008T173010Z-43839`

## 构建与测试

- 前台 786 项 / 88 文件、后台 247 项 / 49 文件单元测试通过；两端 TypeScript 检查通过。
- 后端 `go test -p 1 -count=1 -timeout=10m ./...` 全包通过。
- networkinsight、rpc、controller、model 竞态检测均通过。
- 两个前台主题、后台和嵌入式 Linux 程序生产构建通过。
- NextTrace 固定版本真实探测通过：6.84 秒，18 跳到达；另有 JSON 多路径、平均值、错误状态、权限、策略修订、过期策略、历史和脱敏测试。
- 实际构建程序部署集成测试通过：原生启动、登录、加密命令、真实 gRPC 模拟 Agent 回程上报、历史持久化、访客脱敏、正常停止，以及两次强制终止后的启动恢复与 SQLite 完整性。
- 浏览器合计覆盖 142 个用例：141 通过，1 个依赖缺失私人旧配置样本的旧迁移用例跳过。覆盖默认/Doraemon、亮/暗、320/390/768/1440、背景图片/视频与 8 种效果、Logo 稳定性、后台折叠与草稿、四项开关、回程、BGP 快照/触控/缩放等。
- 浏览器分段记录：`final-ui.log` 的前 58 项（57 通过、1 跳过），`switches.log` 补齐并复测全部 6 个开关用例，`resumed-ui.log` 剩余 83 项通过。不能把这些称作一次未中断的执行。

## 执行中遇到的测试环境问题

- 构建机内存 4 GB，同时运行竞态测试、编译和浏览器造成 OOM，任务进程中断；阿里不受影响。改为串行并限制 Go 内存后重跑相应用例和构建，均通过。
- 首轮后端测试因工具默认 umask 077 导致既有降权子进程测试不能执行临时助手；使用项目构建要求的 umask 022 完整重跑通过，未修改程序以绕过测试。
- 线上只读验证器最初错误期待未认证响应含 success=false；实际既有协议为 error=ApiErrorUnauthorized。修正验证器断言后鉴权检查通过，未修改线上鉴权行为。

## 阿里部署核对

- 管理脚本依次确认：停止新上报、处理已接收数据、写入及关闭数据库、进程退出、备份、启动并等待 HTTP 就绪；没有强制结束生产进程。
- 119 个节点的身份信息、用户、监控任务、定时任务、配置和终端密钥指纹保持一致，TSDB 目录未替换。
- SQLite integrity=ok，节点记录时间继续推进；运行程序 SHA 与构建产物一致，服务 active/running、NRestarts=0、开机启用且 Restart=always。
- 线上 57 个前台与 12 个后台 JS/CSS 的内容 SHA 与本次构建完全一致。
- 访客回程只读、管理设置拒绝未认证读取；WebSocket 连续 3 帧均 119 节点且时间推进，新独立开关字段完整。

## 验证边界

- 浏览器为构建机 Chromium 与手机视口/触控模拟，不代表真实 iOS/Safari 硬件验证。
- 未在用户的全部生产节点上主动触发九点检测。真实 NextTrace 探测在构建机验证，完整上报链路在隔离集成环境验证。
- Linux 为本次实际构建和运行平台；不宣称本轮新增回程探测支持 Windows 节点。

## 线上浏览器复核

- `live-qa.log` 最终 `LIVE_BACKGROUND_RETURN_ROUTE_PASS`；1440/390/320 均验证实际线上背景配置、Logo 正常显示且无背景动画继承、回程访客只读、磁盘标题切换、后台六组折叠菜单及末尾载入效果。
- 通过浏览器响应替换验证图片/视频延迟准备、电脑 left/2.4s 与手机 zoom/0.7s 独立配置。仅测试上下文替换，无生产设置写入，记录 writes=[]、page errors=[]；无页面水平溢出。
- 实际保存配置为电脑 center/1.2s、手机直接显示，本轮没有替用户修改这些选项。实际移动端背景源有一次失败后自动换源成功。
- 线上已有部分第三方图片、字体、统计/外链组件请求失败（ORB、DNS、源站限制），不等于应用 JS 报错；未扩大范围去替换用户自定义地址。Logo 已正常显示，可回退内置图标。
- 视觉检查覆盖实际线上手机页、窄屏后台展开状态，以及默认/Doraemon 的回程截图。保持既有控件风格、手机单列/桌面分列、独立折叠内容，不增加新的样式体系。
- 本轮自建 Vite、传输服务及浏览器进程已退出；18475–18479、18765 无遗留监听。保留构建和回滚证据，不清理用户运行数据。

## Preview3: footer and return-route comparison (2026-10-09)

Changes:
- Compact mobile copyright/sponsor gap; move family/NextTrace controls into return
  header; destination-only weighted RTT on each card; per-hop network category.
- Add read-only comparison of two completed snapshots, protocol-family switch,
  target compatibility guards, TTL/ECMP differences and signed destination RTT
  delta. Open comparison freezes its data; viewer/server/IP-visibility change
  remounts it so an old privileged session cannot survive permission downgrade.
- No new detection task, Agent upgrade, policy change, DB schema migration,
  Git commit/push or Release publication.

Pre-deployment verification:
- User frontend: 90 files / 798 tests passed.
- Both related Go packages passed (networkinsight and dashboard controller).
- Browser acceptance: 37/37 (default/Doraemon, light/dark, 320/390/1440 return UI
  and comparison, 320/390/454/640 footer and desktop sponsor behavior).
- Additional permission-downgrade comparison test: 1/1 passed.
- TypeScript builds passed; scoped lint has no errors (existing style/index
  warnings are not converted into unrelated source changes).
- Evidence: /srv/nezha-builder/footer-route-polish-20261009.

Deployment:
- Built version: custom-2026.10.09-return-route-preview3.
- Binary SHA256: 6b6a8a3168bee1a8d3feecb0f219a9cc0d47d7c4c13291076026b338a8b06d07.
- Real binary lifecycle integration passed: login, encrypted commands, normal
  shutdown/restart, two crash recoveries, Agent reports and SQLite integrity.
- Ali manager confirmed admission closed → reports persisted/storage closed →
  exited before binary replacement. No forced termination.
- Backup: /opt/nezha/backups/update-20261009T043626Z-48786.
- Preservation checks passed for 119 server identities, users/services/crons,
  config and key hashes, SQLite permissions, TSDB inode, and all three network
  policies. Return auto policy remains enabled / 6 hours / 1 day.
- Active/running, NRestarts=0, enabled, Restart=always; HTTP 200; report timestamps
  advanced. 57 public + 12 admin assets match build SHA256; three WS frames each
  contain 119 nodes and advance. Anonymous admin settings remain denied.
- Git HEAD unchanged at bab735372edb9bc9012079f587e5f300f72124f7; no commit/push.

Live acceptance:
- Real saved node 63: three completed snapshots and both IPv4/IPv6 available.
  Desktop 1440 and mobile-UA/touch contexts 390/320/454 passed read-only UI checks.
- All visible IPv4 card RTTs match the API's destination sample-weighted mean;
  targets remain absent and response-local comparison groups are present.
- Two different history selections, comparison cards, expandable hop rows,
  bounded scrolling, Escape, no horizontal overflow, footer rapid-fling visibility
  and copyright/sponsor gap [0,12]px passed. No page errors or write requests.
- Live frontend assets/API/WS and screenshots reviewed after deployment.
- Limitation: some external sponsor logos failed to load from the build browser;
  those URLs/content were not altered. Tests verify footer geometry independently
  with controlled fixtures. Mobile evidence is browser emulation, not physical
  iOS/Android device testing.
- Temporary Vite servers and binary transfer listener were stopped. Backups,
  release binary and QA evidence are retained; no production data cleanup.

## preview4 增量（已部署阿里并验收）

- 回程详情右上角“单独检测”；当前配置的目标 ID／协议族限定，不接受自定义地址／命令。单项／整组／自动复用节点级队列；后台配置改变时拒绝复用旧任务。
- 单项保存新快照，标明单项重测；其他有效结果携带原 tested_at，不覆盖历史，不延长过期项目的保留时间。
- BGP 快照对比：前缀、观测数量、有序 AS 路径、ASN 及样本差；排除补充连线，保守处理失败、旧摘要、截断和权限隐藏。手机竖排／电脑并排，打开期间冻结数据，权限降级关闭旧弹窗。
- CN2 判断边界不放宽；详情明确缺失 TTL、多路径、跨境信息或混合 163 等具体证据。真实 AS36002 样本尚不足以确认商业 GIA／GT。
- 本轮仅部署阿里，不推送 GitHub。

验收结果：
- User 全量单元测试 91 文件／804 项通过，最终格式整理后相关 18 项复测通过；TypeScript、两套主题与管理端构建通过。
- 82 项相关浏览器回归通过（两套主题、明暗、320/390/768/1440 像素按场景覆盖）；范围包括单项、BGP/回程比较、权限、IPv6、快照滚动、紧凑间距。手机为浏览器模拟，不是物理 iPhone/Safari 测试。
- networkinsight/controller Go 测试通过；Return 并发 race 检查通过。
- 实际发布程序验证正常停机、两次异常退出恢复、Agent 回程任务（包含单项与重复请求）、自动时钟周期及 SQLite 完整性通过。
- 阿里版本 custom-2026.10.09-return-route-preview4，SHA256 57204b2f7edd9b182d667481060fea23581244878b4451d569fe50d72cf8bf1f。
- 119 节点、身份、配置、密钥、TSDB 目录、检测策略前后保持一致，上报继续推进。旧程序及数据备份 /opt/nezha/backups/update-20261009T051553Z-49222。
- 线上 57 个前台／12 个管理端静态资源哈希一致；WebSocket 帧持续推进，访客不可发起检测或获取管理设置。1440/390/320/454 像素线上只读验收通过，未触发测试 POST。
- 构建机临时 Vite 与传输服务已停止；未提交或推送 GitHub。
