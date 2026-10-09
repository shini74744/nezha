# 连通性小资源检测验收（2026-10-09）

版本：`custom-2026.10.09-connectivity-warm-preview1`。仅阿里预览部署，不提交、不推送 GitHub。

## 修改范围

- 110 个内置站点统一使用站点图标、官方 CDN 小资源或极小诊断接口；25 个地址更新，其余 85 个保留已有小资源。名称、地区、顺序不变。
- YouTube 使用 `https://yt3.ggpht.com/favicon.ico`，与核查的 ip.skk.moe 资源一致。
- 每项先预热两次，不生成小点、不计入平均值或历史。服务器正式测 3 次，本地正式测 5 次，保留有效响应的平均值；失败不当成 0 ms。
- 服务器仍使用现有 Agent GET 及响应体完成耗时，浏览器仍用不带凭据、不缓存、无 Referer 的 no-CORS HEAD。无需升级 Agent，不能把数字当作 ICMP RTT 或流媒体解锁结果。
- 单项重测、取消本地检测、并发限制、身份/权限、桌面悬停与手机无悬停行为保留。整批服务器预算从两分钟调整为三分钟，覆盖预热请求。
- 保存的旧内置 URL 按确切值升级；真正自定义的地址不改。不会把管理员私有路径或查询参数发送给访客。
- BGP、回程、流媒体解锁目标未修改。

## 验证

- 前端 TypeScript 与默认／Doraemon／管理端发布构建通过。
- 前端全量单元测试：92 文件、916 用例通过。
- Go：connectivity、rpc、dashboard/controller 包通过；connectivity 全包及 RPC/controller 连通性用例竞态检查通过。
- 浏览器连通性：163 用例全部通过，覆盖两套主题、浅深色、320／390／768／1440 布局、访客／管理员、三／五样本、平均值、取消、单项重测和预热排除。
- 真实发布包集成测试通过：正常启动、登录、加密命令、优雅重启、两次异常退出恢复、Agent 上报及 SQLite 完整性。
- 已成功获取的小资源最大 38,554 字节。HTTP GET 核验中 ChatGPT、Takealot、iFood 从构建机返回 403；真实浏览器 HEAD 中 107／110 收到响应，Takealot、CBC、Maybank 在该网络下被限制或请求失败。可达性依赖网络和第三方策略，不能保证所有网络均通过。
- no-CORS 的响应不可读，浏览器收到响应不等于 HTTP 2xx，更不等于账号或流媒体解锁。

测试工具注意：Playwright 启用拦截时会将所有以 `/favicon.ico` 结尾的请求当作浏览器图标自动取消。模拟测试仅对 fixture HEAD 添加测试查询参数，保留原生 fetch／取消／重定向；真实地址审计在关闭路由拦截后进行。生产包不包含该测试参数或测试代码。

## 证据

构建机证据目录：`/srv/nezha-builder/connectivity-warm-20261009`；完整浏览器日志：`/srv/nezha-builder/qa-responsive-warm-resources-final-20261009.log`。
程序 SHA-256：`d8cb23ba4022630e091830d1a591f4582c87b91af43c6b392d792d1a571b9063`。
部署后验收记录保存在同目录及阿里 `/opt/nezha/backups/connectivity-warm-20261009`，不包含凭据明文。

## 阿里部署确认

按管理脚本完成停止接收上报、处理已接收数据、写入并关闭数据库、退出、备份和启动；切换流程约 55 秒。
119 个节点身份、用户／服务／任务数量、配置文件、密钥、TSDB 目录及三类检测策略保持一致。
SQLite quick_check 为 ok，新进程与安装包哈希一致，systemd active/running、enabled、Restart=always、NRestarts=0。
快照时间继续推进；线上 110 个检测点的主机与新目录匹配，仍为服务器 3 个正式样本；访客无发起服务器检测权限。
57 个前台及 12 个管理端 JS/CSS 文件与构建产物哈希逐一一致，WebSocket 三帧均持续返回 119 节点且时间递增。
回滚备份：`/opt/nezha/backups/update-20261009T060616Z-49908`。Git HEAD 保持 `bab735372edb9bc9012079f587e5f300f72124f7`，未提交、未推送 GitHub。

线上 320／390／1440 宽度只读验收通过：各显示 110 个站点，无横向溢出、页面脚本错误或意外写操作。
