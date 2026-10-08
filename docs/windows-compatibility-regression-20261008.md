# Windows 服务端兼容修复与验收（2026-10-08）

## 修复范围

旧实现把 Linux 的 0600 模式检查直接用于 Windows：不仅测试失败，Windows 已有终端命令密钥再次加载也可能被拒绝，影响重启后读取快捷命令。

本次新增平台专用文件访问器：
- Windows 新建时原子设置私有 ACL：当前运行账号、SYSTEM、Administrators，禁止父目录权限继承。
- 旧文件先校验所有者，必要时在同一打开句柄上收紧 ACL，再读取；不更换密钥、不迁移密文或数据库。
- 拒绝其他所有者、重解析点、硬链接、无安全 ACL 能力的位置；读取期间禁止其他句柄写入或删除。
- Linux/macOS 保持原有私有权限检查，并用打开后的文件身份校验减少路径替换风险。
- 限制密钥读取长度；缺失而已有密文、损坏或超长密钥均报错，不覆盖或自动重建。
- 未修改前端、采样次数、通知策略、依赖版本或数据库结构。

## 测试结果

源码实现提交：39b9a8f1e02f00f61597cc7c86ef1393cf9c2198。
发行源码提交：301fa459806b1bdef21a7b290378f4d9593f6567；第二个提交仅调整 Windows 发布流水线与说明。

- [首轮全平台 CI](https://github.com/shini74744/nezha/actions/runs/37761251675)、[发行提交全平台 CI](https://github.com/shini74744/nezha/actions/runs/37762061117) 均成功：Windows/Linux/macOS 普通测试与构建、Linux race/quality、Agent 压测及汇总门禁全部通过。没有跳过原先失败的密钥加密/重启测试。
- Windows 原生系统为 Windows Server 2025 x64（windows-2025-vs2026）；新增权限/旧 ACL 迁移/文件替换防护及既有终端相关回归连续 10 轮通过。原有并发快照专项也重复 10 轮通过。
- 新增 deploymenttest 用真实面板可执行文件、隔离数据和中文/空格路径，验证初始化、登录、快捷命令加密保存及重启后解密、正常停止顺序、两次进程强制中断恢复、Agent 协议上报、SQLite 完整性、密钥字节保持不变。
- [正式 Windows 包流水线](https://github.com/shini74744/nezha/actions/runs/37762064339) 使用 go_json、Go 1.26.8、CGO 构建并测试最终 EXE，额外检查两套内置前端可访问。PE 导入仅含 KERNEL32 和 Windows UCRT API，不依赖额外的 MinGW libgcc/libwinpthread DLL。
- 构建机普通、go_json、go_json race/shuffle 各 2313 项通过，完整 Agent 兼容回归 2774 项通过；各轮 2 项原有跳过、0 失败，33 个测试包通过。
- go mod verify、go vet、源码/保留符号二进制调用漏洞扫描通过。仍有先前已说明的、未被导入的 OpenPGP 模块级公告；本轮没有关闭或忽略公告。
- 正式 Linux 包额外通过真实 Agent 连续三次进程中断恢复、独立生命周期测试和 11 项管理脚本回归。

所有真实进程测试仅使用临时配置、测试账号和隔离数据库。Windows 发布的临时写权限只用于独立输入下载任务，实际编译/测试任务仅有 contents:read；无生产配置、数据库、私钥或访问令牌进入发布包或测试工件。初次正式包流水线因只读凭据看不到草稿而失败，改为隔离输入任务后重跑成功，没有提前发布未验收的程序。

## 发布与部署

[custom-2026.10.08.4](https://github.com/shini74744/nezha/releases/tag/custom-2026.10.08.4) 发布为 latest，标签指向 301fa459806b1bdef21a7b290378f4d9593f6567；共 6 个正式资产，GitHub 资产摘要与本地 SHA-256 一致。临时输入归档从发布草稿移除，构建机及短期 Actions 工件保留副本。

- Linux 程序 SHA-256：37918df26cc371e180b864f37715088bc6e1a39f6a20d8cd865a085f7ec67e91。
- Windows EXE SHA-256：e9d77451cb61e3b6ac93ee6eda6c47bf270f913eb400298261ca507ca2291420。

阿里通过自有 nezha.sh update 更新，停收上报、排空队列、落盘、关闭、退出标记顺序正确，随后新进程 HTTP 200、持续接收上报。备份位于 /opt/nezha/backups/update-20261008T102411Z-39463。

上线核对：119 个节点身份/归属、1 个用户、18 个服务、配置和终端密钥摘要均与更新前一致；TSDB 原目录不变，SQLite 0600 且 quick_check=ok。运行进程和磁盘程序摘要匹配正式包；服务 enabled、Restart=always、NRestarts=0。WebSocket 连续两帧各 119 个节点、时间递增。观察窗口内未发现快照写入失败、数据库锁定、缺表、panic 或未完成停机。

1440px 电脑与 390px 触控手机只读页面验收通过：详情、连通性、BGP、流媒体接口 200；标签及历史快照切换均保持 scrollY=180，没有横向溢出或页面脚本错误，IPv4-only 节点隐藏 IPv6；未发起管理写请求。

证据目录：构建机 /srv/nezha-builder/windows-fix-20261008；阿里 /opt/nezha/backups/windows-update-20261008.LQoXfzkJ。未清理旧备份或已有无关工作文件。

## 适用边界

参见 [Windows 部署说明](windows-deployment.md)。使用本地 NTFS 和固定运行账号；不要将 EXE 直接注册为原生 SCM 服务。不同 Windows 版本、第三方服务包装器及真实物理断电/硬件损坏未逐一验证，不能把有限测试当作任意环境永无故障或内存数据绝不丢失的保证。
