# 原生美化功能（二开）
## 范围
- 默认主题的原生美化在 user-dist 运行，不套用到其他主题；哆啦 A 梦使用独立的美化配置，切换主题不会覆盖另一主题的设置。
- 「美化设置 → 全站显示」是独立的全站布局设置，不受主题选择或“启用内置美化”总开关控制；作用范围见下方“全站显示设置”说明。
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

## 背景载入效果（阿里预览）

- 在“背景图片与视频 → 载入效果”中，电脑端与手机端分别选择载入方式和淡入时长。支持中心展开、整体淡入、轻微放大淡入、上／下／左／右渐显、直接显示；时长范围 0～10 秒（0 为无动画）。旧配置默认中心展开、1.2 秒。
- 图片下载并解码完成、视频首帧可显示后才播放效果；普通、分时和地区背景共用对应设备的设置。手机背景地址留空时仍使用手机载入设置。动画只影响背景，不移动页面内容；修改设置不打断已经开始的动画。
- 更换背景时保留已显示的画面，等新资源就绪并完成过渡后再移除旧层；加载失败继续尝试后备资源，过期加载结果不会覆盖当前背景。
- 图片只使用一个实际显示的图片节点，避免随机接口因 CSS 背景和隐藏图片分别加载而产生重复请求。
- 保留随机、设备、地区、分时选择和默认静音/Logo 声音控制；视频循环不重复播放入场动画。系统设置“减少动态效果”时使用短淡入。
- 此轮为阿里预览，尚未推送 GitHub 或发布 Release。

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

## 可展开的问候与时钟设置（2026-09-26）

- 默认主题美化设置各功能默认折叠，点击标题展开；开关独立，折叠不会卸载编辑器或清除草稿。
- 分时段问候保留原有七组共 70 条文案。可增删时段和问候语、调整顺序，最多 32 个时段、每时段 256 条文案。
- 按访客本地时间匹配 HH:mm，开始包含、结束不包含；跨午夜有效，起止相同表示全天，重叠按列表先后优先。
- 空白文案跳过；无匹配或匹配时段没有有效文案则回退到主题原问候语。单条文案可重复显示，不会因防重复逻辑变空。
- 时钟可设置小时、分钟、秒钟各自的起始与结束色（#RRGGBB），支持原生选色和渐变预览。默认颜色与旧版一致。
- 新字段向后兼容仅有 enabled 的配置；后端保存时校验时间和颜色。其他主题仍不加载这些效果。

## 独立速率设置（2026-09-26）

- “网络速率与颜色”保留总开关，内设“单台服务器卡片速率”和“网络概览卡片速率”两个二级折叠项。
- 两组分别启用/关闭，分别设置 Mbps/Gbps 转换、上下行颜色、高速率动画；不影响累计流量或流量规则。
- 单卡保留原 bits/color/animation 字段，新增 cardEnabled；概览使用 overviewEnabled/overviewBits/overviewColor/overviewAnimation。
- 旧配置缺少概览字段时，从原共享选项继承；显式独立值（包括 false）在刷新、保存、再次读取时保持不变。总开关关闭仍控制两组。
- 前后台采用一致的兼容读取；后端清单验证新增布尔字段。29 项功能数量及默认主题限制不变。

## 访问统计图片：仅电脑端自适应（2026-09-26）

- 电脑端在顶部按钮下方预留独立区域，统计图跟随顶部内容右边缘，而非浏览器边缘。
- 宽度为顶部内容可用宽度的 24%，不超过已配置 desktopWidth；高度按 desktopWidth/desktopHeight 比例缩放。
- desktopRight/desktopTop 为相对该图片区的偏移，保留原值；桌面背景图右上对齐，不拉伸。
- 手机端仍使用原有小于 768px 分界、顶部居中加偏移、固定宽高和滚动隐藏规则，不占新增布局空间。
- 窗口缩放、跨手机/电脑分界和路由挂载时重新定位；开关关闭时移除图片、占位和监听器。

## Visitor IP configuration
- The visitor IP editor exposes 1–8 browser JSON IP APIs, an optional metadata fallback, query/fallback timeouts, up to16 named HTTP detection nodes and initial/manual detection timeouts (100–10000ms).
- Old saved configs are merged with manifest defaults; existing cache/position values and enabled flags are preserved.
- Initial detection races configured nodes; clicking cycles their configured order. Network detection can be disabled independently.
- Region visibility affects desktop/mobile; ASN, organization and browser downlink remain desktop-only to preserve the mobile layout. ASN prefixes are stripped from organization text to honor the ASN toggle.
- Cache entries include their configured query sources; changing sources invalidates old cache. Duration0 disables cache reads/writes.
- APIs need CORS and compatible JSON fields. These URLs are public client configuration, not a place for secrets/internal endpoints. Detection measures browser HTTP duration, not ICMP or bandwidth.
- Frontend and backend validate URL schemes/credentials, node names/duplicates, list bounds, integer timeout limits; manifest copies stay synchronized.

## Independent network peak cut and mascot selection
- Network peak cut is now a separate feature `peakCut` with `enabled`, `desktop`, and `mobile` switches. It no longer depends on background/region/schedule selection. It sets the initial chart state; visitors may still toggle the chart locally.
- Old configs without `peakCut` inherit the previous background/peak switch state, with desktop selected and mobile off. The old background field is retained only for compatibility and no longer appears in the background editor.
- The existing `live2d` feature gains a provider selector: `live2d` (default, preserves existing models/tools) or `sakana`. Only one mounts at a time.
- Sakana Widget 3.1.0 is pinned and bundled, including built-in character images and CSS; no runtime CDN script dependency. Choose Chisato/Takina, 120–400px size, controls and automatic motion. Automatic motion respects reduced-motion preference.
- Close, config changes and unmount dispose the widget, observer and animation. The owned outer host survives Sakana's internal mount-element replacement so cleanup removes it completely.
- Upstream: https://github.com/dsrkafuu/sakana-widget ; MIT license included at `/licenses/sakana-widget-LICENSE.txt`.

- Sakana position follows the original mascot slot: fixed bottom-left (`left:0; bottom:0`, z-index9990), not bottom-right. Provider switching changes the widget, not its side.
- Mobile visibility also follows the original Live2D guard: screens narrower than768px load neither widget; Sakana returns before importing its package. Desktop placement and mobile absence are covered by browser tests.

## Custom Sakana characters
- Under mascot provider Sakana, add up to16 custom characters with a name and HTTP(S) image URL. Transparent PNG/WebP direct links are recommended. No upload endpoint is added.
- Select a built-in or custom default character. Deleting the selected custom character resets selection to Chisato; existing Live2D settings stay intact.
- The runtime includes only the currently configured characters in the toolbar cycle, reuses bounded registration slots, and clears custom image references on disposal. Deleted roles cannot reappear from the package registry.
- Broken image URLs fall back to Chisato. External image hosts must permit hotlinking; HTTPS pages should use HTTPS image URLs.
- Existing desktop bottom-left position and original mobile hiding guard are unchanged.

### Sakana 自定义图片缩放
自定义图片使用完整等比例显示，避免横图被原版 cover 裁切。每个 customCharacters 项可选 scale (25–200，默认100)，后台提供数字、滑块、恢复100%；旧三字段配置仍兼容。缩放使用独立图层，保留弹簧动画变换、内置角色原样及手机隐藏，静止放大时为左边缘预留空间。图片URL与缩放值随美化配置保存。

### 卡片透明效果与角色折叠

默认前台的背景设置分别提供白天（亮色）与黑夜（暗色）的卡片不透明度和模糊值，跟随主题切换而非时段切换。不透明度范围 0–1（1 为不透明），模糊范围 0–30px。旧 blur/opacity 配置在缺少相应新字段时沿用到两种模式；新字段 lightBlur/lightOpacity/darkBlur/darkOpacity 可独立保存，包括数值 0。关闭背景或没有可用背景时不覆盖原有卡片样式。

自定义 Sakana 角色进入设置时默认折叠，点击角色名称展开；一次展开一项。新添加的角色自动展开，折叠不会删除尚未保存的内容，最终仍须点击“保存美化设置”。


## 2026-10-03 前台显示与开关回归

- 排序菜单改为紧凑弹层，移除占位勾选图标并缩小按钮间距；保留原排序指标、顺序、默认排序及键盘操作。
- 白天模式增强卡片文字、流量和日期的可读性；服务器名称保留动态色相及离线红色变化，使用较深颜色。黑夜原色值不变；上下行网速动画与发光特效保留。
- 版权保持左右单行，IP 详情保留原居中悬浮布局；根据实际遮挡缩小对应一侧版权，空间足够时恢复，不增加标题或独立查看区。
- IP 详情必须同时满足 WebSocket 已连接、已收到服务器列表数据、当前到达页底，才延迟 300ms 显示。连接中/首次数据到达前不显示；向上滚动、列表展开或页面高度变化离开页底时隐藏。原手机隐藏规则不变。
- 底部访客 IP 条在页脚进入视野时隐藏，离开后恢复，避免与版权和详情叠加。
- 单项美化关闭只撤销对应效果；总开关关闭或全部功能关闭，恢复默认主题的非美化显示，保留用户选择的亮色/暗色模式。背景关闭时移除卡片透明样式，名称关闭时移除专用色彩，版权关闭时恢复默认页脚。
- 增加加载/刷新、页面高度变化、名称渐变、版权碰撞、独立开关、旧配置迁移和角色折叠回归测试。测试使用模拟数据，不提交线上配置、数据库或部署备份。


## 全站显示设置（2026-10-05）

入口为后台「美化设置 → 全站显示」，不在「系统设置」中，也不需要点击下方主题配置的保存按钮。两个开关都采用 **开启拆分、关闭合并** 的含义，修改后自动保存；加载和保存期间禁用开关，失败时保留原状态并提示重试。

| 开关 | 开启 | 关闭 |
| --- | --- | --- |
| 统计显示拆分 | 统计按钮显示“流量统计 / 在线率”二级菜单，一次查看一类；再次点击已选项收起 | 统计按钮直接一起显示两类内容，再次点击收起，不显示分类菜单 |
| 详细网络拆分 | 详细图表与网络监控分开查看 | 网络监控显示在详细图表下方，也保留原网络入口 |

- 统计拆分覆盖默认、哆啦 A 梦，以及通过共享统计入口接入的 Nazhua、Aobobo、Nezha-Pixel、Nezha-ASCII。独立社区主题使用统计弹窗，不修改其原有导航或排序实现。
- 详细网络拆分适用于默认和哆啦 A 梦的原生服务器详情页，包括在线与离线详情；不向独立社区主题的自有详情页注入网络图表。合并模式复用同一个网络组件，在详细 / 网络入口间切换保留时间范围和削峰选择，避免重复轮询。
- 全站开关不写入任一主题的美化配置。切换“设置主题”不会切换这两个值，关闭主题美化总开关也不会停用这些布局设置。
- 管理员接口为 `GET/PATCH /api/v1/setting/display`，字段为 `statistics_split`、`detail_network_split`；PATCH 只更新提交的字段，未提交项及其他系统配置保持不变。
- 兼容旧配置：未设置 `statistics_split` 时默认拆分；`detail_network_split` 是已有 `show_network_in_detail` 的反向表达，不额外写入同名磁盘字段。原合并开关为 true 时新拆分开关显示关闭；未设置原字段时保持原有分开显示。
- 默认和哆啦 A 梦会定期重新读取显示设置；独立社区主题在页面加载时读取统计拆分状态。保存后刷新前台即可确认最新状态。
- 这两个开关只控制内容如何显示，不改动流量配额、监控任务、计算结果或权限。

## 统计 / 排序菜单滚动稳定性（2026-10-05）

- 默认和哆啦 A 梦的工具栏菜单使用非模态弹层，不锁定页面滚动，不给 body 添加滚动条补偿间距。修复打开菜单时右侧滚动条消失、背景及内容宽度变化导致的闪动。
- 排序项仍为默认、名称、运行时间、系统、CPU、内存、磁盘、上传、下载、上传总量、下载总量；原排序算法与方向按钮不变。从其他指标切回默认时恢复原默认顺序，再次选择当前指标只关闭菜单。
- 保留点击按钮开关、点击外部关闭、Esc 关闭与键盘选择。菜单高度受可用视口限制，长列表在菜单内部滚动；手机触控行高不小于 44px。
- 排序修复不修改全局 Select 组件，不改变其他表单或模态窗口的滚动行为。
- 回归覆盖真实非覆盖式滚动条、重复开关、外部滚动、键盘末项选择、手机触控及默认 / 哆啦 A 梦布局。详见 [统计视图与回归说明](STATISTICS_VIEWS.md)。

## 2026-10-05 后台白天模式可读性

- 后台美化启用且配置了背景图片时，白天模式使用单层浅色半透明衬底，去掉整页背景模糊，保留壁纸细节；服务器列表、DDNS、防火墙和各设置页共享，不改字体或背景地址。
- 2026-10-10 阿里预览修复：白天模式浅色衬底由页面最外层统一绘制，短页面空白区、长页面和页脚连续覆盖，不再出现上下截断。主背景不透明度严格采用保存值（包含 0），取消原先 64% / 78% 的隐式下限；默认 48%。正文和输入框边界同步加深，卡片、弹层、导航仍分别保留至少 82%、96%、72% 的可读性保护与局部模糊，整页不叠加模糊。用户主动设置极低主背景不透明度时，应配合壁纸检查文字对比度。
- 手机端固定背景使用视口大小的独立背景层，避免长表单把 cover 壁纸拉伸到整页高度；明确选择滚动背景时仍保留滚动行为。
- 手机端设置菜单连续两列四行排列，不再继承电脑端的强制换行空位；保持至少 44px 点击高度。电脑端仍为原来的两行菜单。
- 上述保护只在渲染时生效，不回写用户保存的配置。关闭后台美化、关闭背景图片或清空地址时不生效；夜间模式和所有前台主题保持原样。
- 回归：`frontend/admin/src/test/dashboard-light-contrast.test.tsx` 与 `frontend/admin/tests/e2e/dashboard-light-contrast.spec.ts`。浏览器测试使用模拟 API 数据，可通过 `E2E_DASHBOARD_BACKGROUND` 指定本地背景图片；默认以纯黑背景检查浅色衬底的最坏情况。


## 后台与前台日夜模式独立保存

- 后台使用浏览器本地键 `nezha-dashboard-theme`，默认前台继续使用 `vite-ui-theme`，哆啦 A 梦继续使用 `doraemon-ui-theme`。
- 切换后台亮色、暗色或跟随系统不会修改任何前台主题；修改前台也不会覆盖后台。后台首次使用独立键时默认跟随系统，不复制无法区分来源的旧共享值；选定后刷新仍保留。
- 首屏加载与运行时使用同一后台键，避免加载时先读前台模式。选择跟随系统后会响应系统主题变化；明确选择亮色/暗色后不再跟随。
- 旧版本已覆盖的前台偏好无法自动推断还原，如有需要请在前台重新选定一次。

## 防火墙页说明

认证防火墙与已删除服务器的长说明移入分类标签右侧的小问号。鼠标悬停、键盘或手机点击可查看；切换分类时同步换为当前分类说明。说明浮层不锁定页面滚动，不执行放行、卸载或其他节点操作。


## 后台全局滚动稳定性

- 后台普通操作菜单默认使用非模态模式：打开主题、头像或安装命令菜单时不再锁定整页滚动，不移除右侧滚动条；菜单外部点击、Esc、键盘选择保持可用。
- 后台根页面使用稳定滚动条预留区域。选择框、编辑弹窗、删除确认框、手机抽屉仍保留原来的滚动锁和模态行为，但不再重复添加滚动条宽度补偿，避免正文、固定元素和背景横向闪动。
- 不支持 `scrollbar-gutter: stable` 的旧浏览器保留组件库原有补偿机制；不以强制开放底层滚动换取宽度稳定。
- 仅修改后台公共组件与样式，前台主题和线上配置不变。回归入口：`frontend/admin/tests/e2e/dashboard-scroll-stability.spec.ts`；使用模拟 API 和真实占宽滚动条，检查各后台页面、嵌套弹层、明暗模式、重复开关、手机导航及关闭后滚动恢复。


## 节点连通性（前台）

服务器详情的“详情 / 网络”旁增加“连通性”，默认主题、Doraemon、在线和离线详情共用。沿用现有 Card、TabSwitch、按钮与背景透明度样式，支持明暗模式、手机布局以及简中/繁中/英文（其他语言回退英文）。和“详细网络拆分”独立：网络合并开启时，连通性页不混入原网络历史图表。

- **请求来源**：面板通过已有 gRPC Task 通道给所选节点下发 HTTP GET，实际探测由该节点的 Agent 执行。浏览器只访问面板接口，不访问目标站点；不通过 SSH，不执行 shell，不用面板本机替代离线节点检测。
- **权限**：管理员或节点所属用户发起，访客只读缓存。访客直接显示应用检测结果，不显示顶部“节点连通性”说明、检测操作和进度卡片；管理员及节点所属用户保留完整控制卡片。读取失败时仍提供重新加载，不会触发节点检测。遵循节点可见性、前台密码、ForceAuth、PAT 节点白名单；读取需 server:read、发起需 service:write，cookie 会话 POST 保留 CSRF 校验。
- **目标**：内置 102 个 HTTPS 检测点，覆盖中国、美国、日本、韩国、英国、德国、法国、加拿大、澳大利亚、印度、巴西、俄罗斯、新加坡、马来西亚、印度尼西亚共 15 个国家及全球分组。中国 12、美国 36、日本 7、全球 11，其余国家各 3。应用和地址清单见 `service/connectivity/catalog.json`，地区元数据见 `regions.json`。按节点上报的国家码排序（不是访客所在地）：中国 → 美国 → 全球 → 其他；美国 → 全球 → 其他；其他支持国家 → 美国 → 全球 → 其他；未知地区 → 美国 → 全球 → 其他。组内遵循管理员保存顺序。分类不保证请求落到该国机房，CDN 可能就近响应。
- **图标与布局**：102 个应用图标随前端打包，同源加载或内联，不热链第三方图标服务。素材来源见 `frontend/user/src/assets/connectivity/sources.json`；品牌及商标归各自权利人。地区使用国旗/地球标识。卡片约 56px 高，左侧图标，中间名称和三个采样圆点，右侧延迟。前台不显示应用网址；手机单列、平板双列、大屏三列、宽屏四列，损坏图标回退通用图形。
- **结果与队列**：地区交错调度，每个应用优先完成第一轮尝试，再补足第二、三轮；超时算一次实际尝试。收到样本立即更新。排队、检测中、下一轮采样等卡片文字静默，不挤占紧凑卡片；圆点、延迟及实际异常仍显示。耗时为有效响应样本中位数，包含 DNS/TLS/轻量读取，不是 ICMP Ping。HTTP 403/429/5xx 为已连通但网站返回错误；DNS/TLS/超时/拒绝/Agent 禁用/离线分别显示，不把失败当成 0ms。可达不代表账号可用、解锁或整站可用。
- **资源限制**：同节点共享一个批次及完成后 60 秒冷却，整批或单卡重测均适用；最多 4 个节点批次同时执行，每批最多 12 个并发等待。每个已开始的尝试等待 Agent 3 秒，整批最长 2 分钟；迟到回包丢弃。旧 Agent 无强制取消协议，已发出的请求仍按其原生超时收尾（自有 Agent 当前为 30 秒），因此底层收尾请求可能超过 12 个。内置 102 项最多 306 次，自定义上限 120 项最多 360 次，单卡最多 3 次。离线节点不新发起；退出页面不取消或重复发起。
- **缓存**：按节点 ID + UUID + 所属用户隔离，内存最多 512 个节点。完整和单卡检测完成后存储到 SQLite `connectivity_records`，重启可恢复最新结果。默认只保留一天，每分钟清理过期记录，读取时立即过滤过期样本；单卡更新不会延长其他卡片旧样本的有效期。可配置保留 1–30 天；原始 URL 只作私有缓存身份，不返回访客。节点转移、删除、UUID 改变后不展示旧身份结果。
- **兼容性**：复用既有 HTTP GET 任务/回包，不增加 Agent 协议或远程命令权限，现有支持 HTTP 监控的 Agent 可运行基础检测。遵循 Agent 禁用探测与出口/代理配置；此版不强制区分 IPv4/IPv6，不提供精确 DNS/TLS 分阶段耗时。
- **隔离**：一次性任务使用独立编号和结果通道，绑定回报节点与会话；迟到/重复/跨节点回包不会写入服务监控历史或触发告警；访客结果不输出原始 Agent 错误、内部 IP 或证书明细。

接口：GET `/api/v1/server/:id/connectivity` 只读，不启动检测；POST 同路径启动整批；POST `/api/v1/server/:id/connectivity/:target` 只重测指定的已配置且启用项目（空请求体，无查询参数）。管理员/节点所属用户可点应用卡片或用键盘 Enter/Space 重测，访客卡片只读。
## 连通性卡片设置（2026-10-06）

- 后台管理员头像菜单：“系统设置”下方新增“卡片设置”；设置导航也提供同名入口，地址为 `/dashboard/settings/cards`。普通用户不显示管理入口且 API 拒绝访问。
- 默认使用 102 项内置检测点，上限 120。已有自定义清单原样保留；“补充内置检测点”经确认只追加缺少的 ID，保留现有名称、地址、图标、开关及顺序。“恢复默认”是单独的显式覆盖操作。可新增、编辑、启停、删除。拖动把手支持鼠标/触摸/笔，键盘上下键也能排序；只调整同地区内部顺序，跨地区不移动。搜索期间禁用拖动，清除搜索后可排序。
- 编辑先存入页面草稿，点击“保存配置”才全站生效。重新加载会确认放弃草稿；保存失败保留草稿，修订号冲突拒绝覆盖其他页面的更新。配置持久化到私有 `connectivity_config`，通用设置保存不覆盖它；公共设置接口不输出完整检测 URL。
- GET/PUT `/api/v1/setting/connectivity` 仅管理员且需 `admin:all` 权限；cookie 写入需 CSRF。保存不发起任何 DNS/HTTP 检测，不修改节点、密钥、主题等其他设置。
- 自定义地址只允许 HTTPS/443 公网域名，拒绝显式 IP、内部域名后缀、用户凭据、片段和非法格式；内置 Cloudflare 公网 IP 仅按原 ID + 原地址兼容。图标可选 102 个内置品牌、地球，或导入自定义 HTTPS 图标地址后保存。
- **检测地址安全边界**：检测地址的校验是输入格式检查，并非 DNS 钉扎或完整的出站 SSRF 防护（图标导入另使用下述下载防护）。检测域名由目标 Agent 自行解析，必须由可信管理员配置可信站点，不可写入密钥、私密链接或可能解析到内网的域名；节点自身出站防火墙仍需保留。
- 正在执行的检测批次冻结清单，配置修改不把任务切换到新地址。完成后读缓存按最新清单排序；改名/图标/排序保留结果，新增或修改 URL 的项目显示待检测，移除或禁用的项目不再展示。原冷却时间保留，防止靠编辑清单绕过频率限制。全部关闭时显示“暂无检测点”且不能发起空检测。
- 测试覆盖清单校验、配置原子回滚与重启持久化、并发修订冲突、权限、Agent 任务地址绑定、队列冻结/冷却，以及前台紧凑卡片和后台桌面/手机编辑排序流程。

- 自定义图标由管理员复用受保护的 `/api/v1/logo/fetch`（image 模式）和 `/api/v1/logo/store` 导入。限制 2 MiB，支持 PNG/JPEG/WebP/GIF/ICO 及安全 SVG；抓取验证公网 IP、DNS 钉扎及每跳重定向，不允许探测内网。图片缓存到面板 `data/logos`，备份时应连同此目录保留。配置只接受内置 ID 或已存在的同源内容哈希资源，禁止直接保存外站图标 URL/data URI。
- 原始图标网址仅作为管理员编辑元数据保存，不下发给访客；访客只请求同源缓存图片。源站改变图片后需再次点击“使用图标地址”手动导入。导入失败保留原图标，未导入的新地址不能保存；损坏/丢失的图标回退为默认地球。请勿使用含密钥或私密信息的链接。
- 前台仍不显示应用检测网址。状态文字仅在实际超出卡片可用宽度时缓慢左右往返滚动，首尾停留；短文字保持静止。悬停或键盘聚焦暂停，离开视口暂停；系统开启“减少动态效果”时关闭动画，允许手动横向滚动查看全文。完整状态同时保留在 title。应用卡片默认高度约 56px，减少上下留白，保持图标与延迟居中、名称/采样点/状态两行显示；滚动文字不撑高卡片。

### 连通性分类与自动检测

- “卡片设置”是通用设置入口，当前“连通性”分类包含自动检测设置和检测点清单。
- 自动检测默认开启，每 2 小时一次、保存 1 天。管理员可独立保存自动开关、1–24 小时检测间隔和 1–30 天保留时间，保存在 SQLite `connectivity_policies`；GET/PUT `/api/v1/setting/connectivity/automation` 受 admin:all、管理员与 CSRF 保护，修订号防止并发覆盖。
- 只调度在线、开启连通性的节点，15 秒调度一次、每次最多启动一台，并遵循全局并发上限。启动时按节点 ID 分散调度，已有完整记录按持久化完成时间计算下次时间，避免重启重复跑。关闭自动开关会停止后续自动尝试，不影响手动权限。
- 节点编辑“套餐配置”中的“连通性”默认开启：关闭后前台在线/离线详情都隐藏连通性入口，GET/POST 同时拒绝，自动调度跳过，已开始的批次不再派发新的节点任务。旧版编辑客户端未提交该字段时不重置原值。
- 前台访客始终只读最新缓存，打开网页不会启动检测。后台周期自动执行仍来自目标 Agent，不使用访问者或面板的网络。

### 详情与列表切换

- 详情页先显示概要和标签，图表、网络与连通性模块分别后台加载，不等待其他模块返回。
- 已打开的服务器列表通过 React Activity 保留卡片 DOM 和筛选/布局状态。进入详情时暂停隐藏列表的副作用，返回时恢复原列表与滚动位置，同时刷新数据；直接打开详情不会预先创建全量隐藏列表。
- 测试入口：`server-list-return.spec.ts` 使用 120 台模拟节点、慢接口、CPU 降速及手机/桌面两种主题，验证原 DOM 复用及重复往返滚动恢复。

## Background settings hierarchy and Logo isolation (2026-10-09 preview)

- Background settings use six initially collapsed sub-sections: addresses,
  schedules, regional selection, card transparency, video/related options,
  and **load effects last**. Sections retain mounted fields, so collapse or
  temporary tab switching does not discard unsaved edits.
- Background reveal masks/transforms/opacity stay on background media layers.
  The Logo wrapper is stable across video sound-controller availability changes;
  an overlay sound button does not remount the Logo image. Broken external Logo
  images fall back once to the bundled icon without a retry loop.
- Mobile BGP timeline arrows share the protocol/count row; their former separate
  row no longer creates a gap. Desktop timeline controls retain their layout.

### Mobile sponsor spacing (preview3)

When the sponsor feature is enabled at <=640px, the native/legacy footer's extra
bottom padding is removed and its reserved sponsor space reduced by 16px.
The existing main padding and safe-area reservation keep the copyright above
the fixed sponsor strip. Desktop placement and mobile fast-fling visibility
logic are unchanged. Disabling sponsor removes this scoped CSS.

## 原生布局组件（2026-10-09）

本节取代上文历史版本中赞助条、统计图片的浮动定位说明。

- 桌面赞助胶囊由服务器工具栏直接渲染，在视图／分组与排序控件间自适应居中。手机赞助条由页脚直接渲染，紧贴版权并跟随页面自然滚动；保留原有横向贴边和到底后的底边位置，不增加左右／底部留白。赞助条透明表面、模糊与阴影按旧版实际显示保留；不再挂到 body 后用滚动事件重算屏幕坐标。
- 缩小、停留、淡出、悬停／键盘聚焦暂停仍保留；桌面“仅首页”和电脑／手机显示开关独立。旧 desktopTop 保留兼容，不再控制赞助条布局；mobileBottomThreshold 继续用于页脚入场阈值。手机保留从底部淡入的视觉效果，几何位置仍由页脚布局决定。
- 访问统计图片由页头原生组件所有，但恢复组件化前的位置：电脑固定于屏幕右上角，手机保持原来的居中偏移和遮挡避让。宽高、顶部／右侧距离及滚动隐藏阈值沿用旧配置，桌面滚动时恢复缩放淡出；不占用导航行宽度。
- 语录由原生组件渲染，恢复页面最上方绝对定位及 10px 留白，不挤压页头。渐变时钟直接使用正在显示的小时／分钟／秒钟，颜色和分隔符沿用旧效果，不再扫描全页面寻找数字。访客信息由独立组件管理，关闭／换配置时中止请求，页脚避让通过布局引用完成。
- 雪花、爱心、碎片、鼠标星星和返回顶部由 React 管理；瞬时粒子有数量上限及到期清理，装饰不拦截操作。侧边图片保留拖动并支持键盘方向键。
- 连线／樱花仍使用本地绘制引擎，但只绘制 React 所有的 canvas。Live2D／Sakana 保留原渲染引擎，由组件提供容器和清理作用域；动态加载晚到时不会在关闭后重建。
- 字体、保护开关、统计 SDK 由独立组件生命周期控制；背景、流量、网速、名称、版权等已有原生组件沿用。外部图片、视频、字体、位置 API 和模型服务仍可能不可用，组件化不代表把这些资源全部内置。
- 不修改任意用户自定义代码、不改变节点数据、检测次数或后端停机流程。已纳入 `custom-2026.10.09.3` 的源码和 Linux／Windows 安装包，阿里同步更新。

## 2026-10-10 分组标签紧凑化（阿里预览）

- 默认和哆啦 A 梦主题共用 34px 高的分组控件、13px 字号及轻量选中底色，标签最小宽度 44px；宽屏与原视图按钮并排，手机端（不超过 640px）独占一行，长名称及多分组横向滑动，不截断名称或挤压其他按钮。
- 支持点击、触控、键盘 Enter / 空格；鼠标滚轮可横移溢出分组，Ctrl+滚轮保留浏览器缩放。每个主题由页面保存自己的已选分组，加载占位状态不重置选择；分组实际删除后回退「全部」。不改变服务器分组、排序或检测配置。
- 回归：`navigation-and-footer.test.tsx`、`Server.test.tsx` 与 `group-switch-compact.spec.ts` 覆盖日夜主题、320/390/1440px、筛选、刷新、滚动和触控。

## 2026-10-10 赞助条首次显示边界（阿里预览）

- 桌面赞助条继续在分组与排序之间的剩余区域居中；分组增加时自然向右让位，不改为整页固定居中。
- 图片或字体到达、窗口缩窄时，安全适配在 ResizeObserver 中同步写入；完成首次测量前不显示，槽位横向限制防止短暂越界。适配只测量固定的紧凑排版，内层以独立 transform 从大到小收缩，不再动画字号、行高和图片尺寸，避免适配反向抵消动画及像素跳动。正常空间保留原 42px 紧凑尺寸，窄槽位保留至少约 10.7% 的可见收缩；原缩小时长、停留、悬停暂停、淡出时序及手机端页脚赞助条不变。
- 回归 `sponsor-first-paint.spec.ts` 模拟 Logo 分批慢加载、分组延迟到达、三档桌面宽度及日夜主题，逐帧检查分组、排序与赞助槽位边界；`sponsor-motion.spec.ts` 进一步检查前 400ms 已开始收缩、宽度全程不反弹、字号／行高／Logo 布局尺寸恒定、悬停暂停、减少动画偏好及独立主题隔离。

### 分组浏览与独立周期流量（2026-10-10 阿里预览）

- 分组控件固定保留“全部”，最多展示 3 个分组标签；更多分组可悬停滚轮横向浏览，手机保留触摸滑动。长名称在标签省略，完整名称可通过菜单查看。
- 从单个分组点击“全部”先恢复全部；已选中“全部”时再次点击打开与统计工具一致的非模态小菜单，选择后关闭，不锁定页面滚动，支持键盘与 Escape。
- “周期流量”使用只读 `/api/v1/server-traffic` 返回的套餐周期起止、计费方向、计费用量和上传／下载明细；日期为北京时间。不会把服务器运行以来的累计流量当成本期流量，也不合并不同服务器的周期。
- 无限流量仍显示本期用量与双向明细，不制造百分比；未设置配额单独标示。配置错误、缺失或加载失败不会显示为 0 或无限流量。部分历史／估算数据有简短标识。
- 沿用后台现有套餐重置日和历史账本，不修改周期计算、监控规则、账户权限或已存数据。原“流量统计”继续来自监控规则的 `cycle_transfer_stats`，两者为独立视图。
- 新视图按当前分组及服务器筛选显示，打开后每 30 秒更新；切换或关闭时中止未完成请求。默认与 Doraemon 主题使用相同逻辑，选择分别保存。

## 2026-10-10 GitHub 源码同步

上述改动的源码、测试与文档已同步至 `main`，并纳入 custom-2026.10.10.2 的 Linux／Windows 安装包，包括赞助条平滑缩放修复。历史验收记录保留；其中“阿里预览”和“GitHub 未推送”仅描述当时状态。
