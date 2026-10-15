# DDnezha Agent

基于 Nezha Agent 的自有发行版，与主面板在 **shini74744/nezha** 同仓库维护、分别递增版本。Agent v1.0.1 使用旧目录；v1.0.2 起改为 DDnezha 独立安装。当前 Agent **v1.0.3** 与主面板 **v0.0.5** 配套，管理入口区分为 `agent.sh` 与 `nezha.sh`。源码版本不代表线上节点已迁移，现有节点须逐实例核对并保留原 UUID／独立密钥，其他配置和服务不动。

安装、自动更新及面板触发升级只使用自有仓库，不回退旧 Agent 仓库、官方 GitHub、Gitee 或 AtomGit。旧仓库保留历史、不再发布。

- 程序／服务：`DDnezha`；POSIX 目录 `/opt/DDnezha/`，Windows 目录 `C:\DDnezha\`。
- 安装变量：`DDNZ_SERVER`、`DDNZ_CLIENT_SECRET`、`DDNZ_TLS`、`DDNZ_UUID`。不读取官方 `NZ_*` 环境变量。
- Linux/macOS/FreeBSD 脚本：`scripts/install.sh`，面板在独立临时目录下载为 `agent.sh`，成功安装后保存到 `/opt/DDnezha/agent.sh`；非 root 通过 sudo 请求提权，仅传必需参数。
- Windows 脚本：`scripts/install.ps1`，需要管理员 PowerShell；安装成功后保存到 `C:\DDnezha\agent.ps1`。
- 安装包：`DDnezha_系统_架构.zip`；标签 `agent-v1.0.3`，程序版本 `1.0.3`。与主面板版本独立递增。
- 归属检查：程序名、相邻 `.DDnezha-owned` 标记、独立配置目录；拒绝链接和未确认的既有安装。

只隔离生命周期，不改变通信协议。原有 UUID／密钥配对、磁盘读写采集、终端、检测等功能保留。详见 [隔离与迁移说明](../docs/ddnezha-isolation.md)、[统一仓库](../docs/unified-repository.md)、[发布说明](OWNED-RELEASE.md)。旧节点不能通过普通更新按钮自动迁移目录；必须备份并只迁移确认属于本项目的实例，保留每台机器自己的认证和配置，不能接管官方实例。

## 卸载独立 Agent

安装完成后会保存自己的管理脚本。与主面板 `nezha.sh` 分开，但无需拆分仓库。脚本文件名与官方相同不代表脚本来源相同；仅使用本仓库版本，安装命令不会覆盖当前目录的同名官方脚本。

### 卸载自有目录内所有 Agent 实例

POSIX（配置含 UUID 和密钥，需要时请先备份）：

```sh
cd /opt/DDnezha
./agent.sh uninstall
# 未设置执行权限时：
sh agent.sh uninstall
```

Windows 管理员 PowerShell：

```powershell
cd C:\DDnezha
.\agent.ps1 uninstall
```

仅卸载自有目录顶层 `*config*.yml` 对应服务，服务卸载成功后才删除对应配置。**配置含 UUID 和密钥，请按需先备份。** 保留程序、历史备份和面板数据；不联网、不解除封禁、不操作官方目录或服务。失败返回非零；配置缺失的遗留服务需单独排查。归属标记用于防止误接管，不是对抗管理员的安全边界。

### 单独停止、卸载一个 Agent 服务

以下是你自己项目的默认实例，不是官方 `nezha-agent`。直接调用程序不会删除配置文件；多个实例必须指定各自的实际配置路径，不能只按默认实例卸载。

```sh
cd /opt/DDnezha
sudo ./DDnezha service -c /opt/DDnezha/config.yml stop
sudo ./DDnezha service -c /opt/DDnezha/config.yml uninstall
```

### 可选：卸载后彻底删除 Agent 文件夹

**仅在自有目录内所有实例都已成功停止、卸载，且所需配置和回滚备份已复制到目录外之后执行。** 确认 `/opt/DDnezha` 不是软链接、没有挂载的其他数据，也没有其他运行进程引用该目录。删除会永久清除程序、管理脚本、配置及目录内全部历史备份；单实例卸载后不能直接删除共用目录。不需要清理文件时到卸载步骤为止即可。

```sh
sudo rm -rf -- /opt/DDnezha/
```

不要将路径改为官方的 `/opt/nezha/agent/`，也不要删除 `/opt/nezha/`（本项目主面板可能在那里）。以上是文档操作示例，不会在发布或节点升级中执行。

不要对来源不明或历史下载的同名 `agent.sh` 用 `uninstall` 或 `--help` 试探版本：部分旧脚本会忽略参数并安装。使用安装后保存在自有目录中的脚本。新 POSIX 脚本支持 `--help`，无参数或 `install` 为安装，未知参数直接报错。

Original project: Nezha Monitoring Agent (Apache-2.0). Upstream credits are retained below.

## Contributors

<!--GAMFC_DELIMITER--><a href="https://github.com/naiba" title="naiba"><img src="https://avatars.githubusercontent.com/u/29243953?v=4" width="50;" alt="naiba"/></a>
<a href="https://github.com/uubulb" title="UUBulb"><img src="https://avatars.githubusercontent.com/u/35923940?v=4" width="50;" alt="UUBulb"/></a>
<a href="https://github.com/funnyzak" title="Leon"><img src="https://avatars.githubusercontent.com/u/2562087?v=4" width="50;" alt="Leon"/></a>
<a href="https://github.com/zhangnew" title="zhangnew"><img src="https://avatars.githubusercontent.com/u/9146834?v=4" width="50;" alt="zhangnew"/></a>
<a href="https://github.com/AEnjoy" title="AEnjoy"><img src="https://avatars.githubusercontent.com/u/37976919?v=4" width="50;" alt="AEnjoy"/></a>
<a href="https://github.com/wwng2333" title=":D"><img src="https://avatars.githubusercontent.com/u/17147265?v=4" width="50;" alt=":D"/></a>
<a href="https://github.com/DarcJC" title="Darc Z."><img src="https://avatars.githubusercontent.com/u/53445798?v=4" width="50;" alt="Darc Z."/></a>
<a href="https://github.com/geniucker-dev" title="Geniucker Zhu"><img src="https://avatars.githubusercontent.com/u/165345526?v=4" width="50;" alt="Geniucker Zhu"/></a>
<a href="https://github.com/ChrisKimZHT" title="Haotian Zou"><img src="https://avatars.githubusercontent.com/u/49368462?v=4" width="50;" alt="Haotian Zou"/></a>
<a href="https://github.com/yuanweize" title="IYUANWEIZE"><img src="https://avatars.githubusercontent.com/u/30067203?v=4" width="50;" alt="IYUANWEIZE"/></a>
<a href="https://github.com/NewbieOrange" title="NewbieOrange"><img src="https://avatars.githubusercontent.com/u/7200314?v=4" width="50;" alt="NewbieOrange"/></a>
<a href="https://github.com/pexcn" title="pexcn"><img src="https://avatars.githubusercontent.com/u/4590439?v=4" width="50;" alt="pexcn"/></a>
<a href="https://github.com/elysia-best" title="Yinan Qin"><img src="https://avatars.githubusercontent.com/u/39023210?v=4" width="50;" alt="Yinan Qin"/></a>
<a href="https://github.com/nowubh" title="mou"><img src="https://avatars.githubusercontent.com/u/22713482?v=4" width="50;" alt="mou"/></a>
<a href="https://github.com/miaojior" title="miaojior"><img src="https://avatars.githubusercontent.com/u/79573934?v=4" width="50;" alt="miaojior"/></a>
<a href="https://github.com/xream" title="xream"><img src="https://avatars.githubusercontent.com/u/1210282?v=4" width="50;" alt="xream"/></a>
<a href="https://github.com/xykt" title="xykt"><img src="https://avatars.githubusercontent.com/u/152045469?v=4" width="50;" alt="xykt"/></a>
<a href="https://github.com/zhdsmy" title="zhdsmy"><img src="https://avatars.githubusercontent.com/u/8348149?v=4" width="50;" alt="zhdsmy"/></a>
<a href="https://github.com/matchch" title="卖女孩的小火柴"><img src="https://avatars.githubusercontent.com/u/44471469?v=4" width="50;" alt="卖女孩的小火柴"/></a>
<a href="https://github.com/liuran001" title="baka"><img src="https://avatars.githubusercontent.com/u/32791471?v=4" width="50;" alt="baka"/></a>
<a href="https://github.com/akiasprin" title="kevi"><img src="https://avatars.githubusercontent.com/u/25278728?v=4" width="50;" alt="kevi"/></a><!--GAMFC_DELIMITER_END-->
