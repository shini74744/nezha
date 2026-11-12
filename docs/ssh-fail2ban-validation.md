# SSH Fail2ban 后端与读取性能验证

日期：2026-11-12。代码基线：a2c0159a55bcdd0eac96d520986e691f5e5e770c。工作分支：feat/ssh-fail2ban-backend-20261112。

## 范围

服务器可选择 DDnezha 原生或 Fail2ban，共用端口、通知、记录、自动封禁、手动 IP/CIDR 黑名单、白名单、仅白名单、搜索分页、时间及快捷操作。脚本由本项目编译打包，不执行在线完整 fb5.sh。保存后应用，升级不会自动切换或安装防护。

只管理本实例的指定 SSH TCP 端口，不清空全局防火墙，不修改 NAT、FORWARD、拨号、桥接、网络命名空间或 XUI。以下开发验证在隔离环境完成，当时没有部署阿里或业务 Agent。后续正式发布及阿里部署验收见文末；本轮未执行节点 Agent 批量升级。

## 最终结果

| 检查 | 结果 |
| --- | --- |
| 面板完整 Go 测试 | 36 个有测试的包通过 |
| Agent 完整 Go 测试，最后修改后重跑 | 18 个有测试的包通过 |
| SSH Go 竞态测试，最后修改后重跑 | 通过 |
| 隔离内核与 Fail2ban 集成 | 7 组全部通过 |
| 后台全部单元测试 | 69 个文件，447 项通过，2 项原有跳过 |
| 后台正式构建 | 通过 |
| 手机、平板、电脑浏览器回归 | 31 项通过，包含浅色和深色外观 |
| 改动前端文件静态检查 | 5 个文件，0 警告、0 错误 |
| 正式 go_json 编译选项的 SSH 后端测试 | 通过 |
| Linux amd64 面板与 Agent 构建、版本输出 | 通过 |
| SSH 模块 Linux arm64、Windows amd64、macOS arm64 编译 | 通过 |
| git diff --check | 通过 |

实测环境为 Ubuntu 24.04 x86_64、Go 1.26.6、Fail2ban 1.0.2。所有防火墙集成测试使用独立网络命名空间、Fail2ban 配置、日志、socket 与 PID。没有对宿主业务网络执行测试规则。

集成测试覆盖 nftables 与 iptables、IPv4/IPv6、指定端口隔离、其他 TCP 端口及 UDP 保留、NAT/FORWARD 哨兵规则保留、白名单优先、仅白名单、手动黑名单、永久/到期封禁、解封、旧 sshd jail 迁移、多实例冲突、双向后端切换和失败恢复。真实 OpenSSH 成功/失败认证记录经过采集器、Fail2ban 与防火墙后验证拦截，解封后成功重新认证。

额外验证了旧 Agent 不会忽略后端字段而误用原生模式、离线编辑保留设置、切换时重新读取最新封禁、手动黑名单不阻止旧原生规则退出，以及中断恢复不会遗留暂停检测或临时封禁时长。

## 读取性能

- 120 台服务器列表最多 2 次 SQL 查询，避免逐台读取设置。
- 前端列表使用精简状态，不在每轮刷新中重复传输各节点全部封禁预览；原 API 默认响应保持兼容。
- 相同读取正在执行时，重复刷新合并。过时请求取消，旧响应不能覆盖新服务器/页码。
- 已显示内容在刷新期间保留；封禁列表使用最多 2 秒的 Agent 快照缓存。
- 解封、黑白名单修改使缓存失效；切换防护方式强制读取最新封禁。
- 批量失败事件去重改为一次建立索引，避免按每条事件重复扫描日志尾部。

构建机微基准，3 次迭代：10000 条封禁记录分页约 9.03 ms/op；2000 条手动来源、32 个端口的 iptables 脚本生成约 45.30 ms/op。这些数据不包含网络往返、Fail2ban 命令启动和浏览器渲染，不能作为线上请求时延保证。

## 限制与复现

发行版自动安装分支检查了 Debian/Ubuntu、Alpine、Fedora/RHEL 系和 openSUSE/SUSE 的命令计划及输入边界，未逐发行版执行真实软件包安装。真实防护功能在上述已安装 Fail2ban 的 Ubuntu 环境中验证；其他版本仍需相应环境验收。

普通测试不设置 DDNZ_NATIVE_PROBE_PARENT_NS。只有隔离内核测试使用该标记并通过 unshare -n 执行，测试本身会拒绝在宿主命名空间运行。初次验证中的磁盘余量、umask 和测试环境标记问题均已修正并重跑；慢构建机的后台单元测试时限调整为 20 秒，断言保持不变。真实 OpenSSH 测试为 sshd -E 的原始认证消息补上标准 syslog 传输头，没有放宽生产日志来源检查。

主要命令：

```sh
umask 022
go test -p 1 ./... -count=1
(cd agent && go test -p 1 ./... -count=1)
(cd agent && go test -race ./pkg/sshlogin -count=1)
(cd agent && DDNZ_NATIVE_PROBE_PARENT_NS="$(readlink /proc/self/ns/net)" unshare -n go test ./pkg/sshlogin -run '^TestSSHKernel' -v -count=1)
(cd frontend/admin && npm test -- --maxWorkers=1 --testTimeout=20000)
(cd frontend/admin && npm run build)
```

验证产物版本：dev-ssh-fail2ban-validation。不是已发布正式版本。

- dashboard-linux-amd64 SHA256：0ab8fb1344e33758d498b91fcb02fb76196ddb6f85cfa7bc40e7485e09a384f0
- DDnezha-linux-amd64 SHA256：c396d7814630f7875dc577c8dcdc1ccf4116f041f2f211d0cdb990401de9e27d

构建机上的完整日志、源码快照和验证产物保存在 /srv/nezha-builder/fail2ban-backend-20261112/。


## 正式发布验收（2026-11-13 北京时间）

- 主面板 [v0.0.25](https://github.com/shini74744/nezha/releases/tag/v0.0.25) 与 Agent [v1.0.11](https://github.com/shini74744/nezha/releases/tag/agent-v1.0.11) 已发布；程序源码提交为 `13866a9e6a177f9f38039cea778791dbd049d884`。后续文档修订不改变已发布程序及标签。
- 正式二进制使用 Go 1.26.8。Linux 面板静态包、Windows 原生面板包均通过实际安装包的启动、访问密码、GeoIP RPC、任务长连接、数据保留及重启验收。
- 打包阶段发现并替换了 GeoIP 占位文件；正式包分别验证 IPv4 与 IPv6 查询。旧 Go 1.26.6 的 HTTP/2 首包超时回归会使长期连接提前断开，改用现有 Go 1.26.8 工具链后完整生命周期测试通过；没有降低连接测试要求。
- Agent 发布工作流的 Linux、Windows、macOS 测试，以及 18 个系统／架构安装包构建全部通过。18 个 ZIP 的内容、单包校验文件、版本和源码清单一致。
- 面板 18 个附件、Agent 48 个附件上传后，逐项检查名称、长度和 GitHub 服务端 SHA-256；安装版本入口在两套附件齐全后更新。各附件的完整摘要见对应 Release 校验文件。
- 阿里运行面板 v0.0.25，运行文件 SHA-256 为 `0596204e68adead17772e15d5310ffa94d0405e4350eb5074e72ca05d82f4dc4`。部署前保存并验证 SQLite 一致性备份；部署后原配置、服务器身份、已有 SSH 设置及历史记录保留。仅新增防护后端字段，不替用户切换防护方式。
- 阿里面板服务 active、异常重启计数为 0，原 Agent 进程、程序和配置保持不变；源站 API 与首页正常，首页引用的 29 个 JS/CSS 文件与发布输入一致。后台访问密码保护保持生效。公网自动请求遇到 Cloudflare 验证页，源站核验与公网浏览器访问分别记录。

[Go HTTP/2 超时修复记录](https://github.com/golang/go/issues/80927)。正式版本与上文开发验证产物区分保存，不使用开发包替代正式安装包。
