# IP 地区库与国旗发布校验

国旗、地图地区统计依赖面板内嵌的 IP 地区库。源码中的
`pkg/geoip/geoip.db` 是占位文件，不能用于部署；仅检查文件存在或面板能启动并不足够。

## 本地发布

准备好各主题前端资源后，用统一脚本编译面板：

```sh
GEOIP_DB=/path/to/reviewed/country.mmdb VERSION=vX.Y.Z OUTPUT=/path/to/dashboard bash script/build-dashboard-binary.sh
```

脚本会临时装入地区库，执行 IPv4、IPv6 的真实解析测试，编译后对最终二进制再次执行
`-check-geoip`。任何一步失败都应中止发布。构建后还原源码中的占位文件，不把授权数据提交进 Git。

`script/build-custom.sh`、GitHub Release 工作流与 GoReleaser 的发布前检查也执行同样的地区库测试。
交叉编译产物应在对应平台运行二进制自检。

## 安装包和上线验收

```sh
./dashboard -check-geoip
```

该命令只检查程序内嵌数据，输出 IPv4、IPv6 示例地址对应的地区代码；
不会读取配置、打开监控数据库或启动服务。无效库会返回非零退出码。

部署必须先备份，再核验程序哈希、配置与历史数据。待 Agent 重连并上报地址后，
检查实时接口中的 `country_code`、国旗及地图地区统计，不应只用模拟地区数据验收。

2026-11-19 的纸张主题第二版手工构建漏装正式地区库，误将源码占位文件编入程序。
2026-11-20 修复安装包，并加入统一构建入口与最终二进制自检。
