# 自有面板管理与发布

## 范围与来源

本管理入口用于 Linux systemd 独立二进制部署。首个自有 Release 为 `custom-2026.10.08.1`，提供 Linux amd64 安装包；未提供安装包的架构会在停止现有服务前失败，不会下载其他项目替代。Windows x64 使用独立安装包，按 [Windows 部署说明](docs/windows-deployment.md) 运行，不执行本 Linux 管理脚本。

唯一发布来源为 [shini74744/nezha](https://github.com/shini74744/nezha/releases)。面板安装、更新、脚本自更新均锁定同一个 Release 并校验 SHA-256，不访问官方面板、官方脚本或第三方下载镜像。校验文件和程序都经 HTTPS 从同一仓库获得；校验用于发现下载错误，不等同于独立签名验证。

首次安装（需要 curl、unzip、sha256sum、flock 和 systemd）：

```bash
curl -fL https://raw.githubusercontent.com/shini74744/nezha/main/script/install.sh -o /tmp/nezha-install.sh
sudo bash /tmp/nezha-install.sh
```

已有安装不能使用 `install` 覆盖。替换老管理入口时，可执行上述引导脚本并传入 `update_script`；它会备份旧脚本且不重启面板。已有 Docker / OpenRC 安装不在此入口的迁移范围内。

## 常用命令

```bash
bash /opt/nezha/nezha.sh                 # 交互菜单
bash /opt/nezha/nezha.sh start           # 启动并等待 HTTP 就绪
bash /opt/nezha/nezha.sh stop            # 完整停止，显示阶段
bash /opt/nezha/nezha.sh restart         # 完整停止后再启动，不下载
bash /opt/nezha/nezha.sh update          # 下载、校验、备份、停止、更新、启动
bash /opt/nezha/nezha.sh restart_and_update # update 的兼容别名
bash /opt/nezha/nezha.sh update_script   # 更新自有脚本，不重启
bash /opt/nezha/nezha.sh status
bash /opt/nezha/nezha.sh show_log
bash /opt/nezha/nezha.sh version
```

## 停止与重启进度

脚本读取本次 systemd 进程的阶段日志，不模拟百分比：

1. 发送正常停止请求。
2. 停止接收新上报，等待已接受的 Agent 上报完成，再封闭并排空服务监控队列。
3. 保存剩余采样窗口、流量计数，完成存储落盘和关闭。
4. 检查服务退出结果，确认面板已停止。

并发节点快照使用小批次同步提交：每条上报仍等事务提交或回滚后才结束，因此停止流程不会把尚在队列中的快照当作已写完；快照及对应流量计数保持原子性。

重启继续显示“正在启动并恢复数据库”及“面板已就绪”。下载/校验失败不会停止旧服务；停机未正常结束不会继续启动或覆盖程序。首次切换时，旧二进制没有新版阶段日志，脚本只报告它能实际确认的退出状态，不冒充已经完成新版落盘流程。

系统直接发送 SIGTERM（包括 systemctl stop/restart）也使用后端同一停机顺序。需要看到这些中文阶段时请使用管理脚本。正常停止最多允许后端排空 30 秒，systemd 最终停止期限 90 秒；超时或存储失败必须检查日志，不能当作完整保存成功。

更新前将旧程序、配置、SQLite 文件和终端命令密钥备份到 `/opt/nezha/backups/update-时间-进程号/`。新程序启动不成功时恢复旧程序，不用旧备份覆盖正在使用的业务数据库；TSDB 大目录不会在每次更新时全量复制，仍应另行做定期完整备份。

## 突然断电与恢复

新安装服务启用开机启动，使用 `Restart=always` 保留面板内部主动退出后重启的行为，也覆盖异常退出。通过管理脚本或 systemctl 正常停止不会触发自动重启；系统再次开机后，已启用的服务会启动。

突然断电 / SIGKILL 来不及执行上述保存流程，最后尚在内存的监控数据可能丢失。这不应导致面板必须删库才能开机：启动复用原 SQLite 和 TSDB 数据路径，恢复后继续接收上报。没有自动删除数据库、删除锁文件或重建空库的“修复”操作。

隔离回归覆盖缓冲尚未刷新时进程强制中断、原目录重开、SQLite 完整性检查、真实 Agent 恢复上报。进程中断测试不等同于物理断电、磁盘损坏或文件系统故障；后几类仍需要可靠存储与备份，不能承诺任意硬件故障下零丢失。

## 发布约定与回归

使用 `custom-*` 标签，避免触发保留的上游 `v*` 发布流程。正式发布前运行 Linux 普通测试、`go_json` 生产配置、race/shuffle、agentcompat、go vet，以及：

```bash
bash -n script/nezha.sh script/install.sh script/install_en.sh
python3 script/test_manager.py
```

发布资产：`dashboard-linux-amd64.zip`（内含同名无扩展名程序）、`version.txt`、`nezha.sh`、`nezha-dashboard.service`、`SHA256SUMS`。版本文件应与程序 `-v` 输出一致。只发布本仓库后端和二开前端构建产物，不上传生产配置、数据库、私钥或访问令牌。

管理脚本离线测试模拟网络和 systemd，覆盖阶段反馈、失败中止、校验、备份、二进制回退、数据不覆盖和安装保护；不能代替目标服务器上的 HTTP 与 Agent 上报验证。
