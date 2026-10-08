# Shini Nezha Agent

本仓库是基于 Nezha Agent 的自有发行版，安装包、自动更新及面板触发升级仅从 **shini74744/agent** 下载，不回退官方 GitHub、Gitee 或 AtomGit。

- [下载最新发行版](https://github.com/shini74744/agent/releases/latest)
- Linux/macOS 安装脚本：`scripts/install.sh`。面板命令下载为 `agent.sh`、自动赋予执行权限，运行后保留脚本；非 root 用户会通过 `sudo` 请求管理员权限（可能提示输入密码），root 用户直接执行。只向提权后的脚本传递 Agent 必需参数，不保留整个用户环境。
- Windows 安装脚本：`scripts/install.ps1`
- [安装、迁移与发布说明](OWNED-RELEASE.md)

**已有官方 Agent 不会自动迁移**：需使用面板中的新安装命令重装一次，保留 UUID 和配置后，才会使用本仓库更新。安装脚本会先校验 SHA256 并备份旧文件。

## 磁盘读写采集

v2.3.8 起上报整机磁盘读取/写入速率，配合自有面板的磁盘卡片点击切换显示。首轮采样和不支持设备保留未知状态；真实空闲为 0，Linux 排除分区和堆叠设备的重复计数。不会修改容量统计、UUID 或连接配置。详见 [版本说明](OWNED-RELEASE.md#v238-disk-readwrite-reporting)。

## 卸载 Agent（Linux/macOS/FreeBSD）

在新版 `agent.sh` 所在目录执行：

```sh
./agent.sh uninstall
# 未设置执行权限时，也可以使用：
sh agent.sh uninstall
```

非 root 用户会通过 `sudo` 提权。命令会停止并卸载 `/opt/nezha/agent` 目录顶层 `*config*.yml` 对应的 Agent 服务（包括多实例），仅在服务卸载成功后删除对应配置。**配置含 UUID 和连接参数，请按需提前备份。** 程序文件、历史备份及面板数据不会删除，也不会重新下载安装包。没有配置时会提示无需卸载；服务卸载或配置删除失败时返回非零状态，不会虚报成功。配置/程序/Agent 目录为符号链接时拒绝卸载，避免误操作其他位置。

此参数需要新版脚本，已保存在服务器上的旧 `agent.sh` 不会自动更新，必须先替换为新版。**不要向旧脚本传入 `uninstall` 或 `--help` 试探版本：旧脚本忽略参数，仍会走安装流程。** 新版支持 `sh agent.sh --help` 查看用法；无参数或 `install` 仍为安装，未知参数会直接报错退出。配置已丢失的遗留服务需要单独排查，本命令不会猜测并删除其他服务。

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
