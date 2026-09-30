# 哪吒监控 · 非官方二次开发版

> [!IMPORTANT]
> **非官方版本声明**
>
> 本仓库基于 [哪吒监控（Nezha Monitoring）](https://github.com/nezhahq/nezha) 及其开源前端进行二次开发，不是从零开发的原创项目，也不是 NezhaHQ 官方发布版本。
> 上游项目及原作者不为本仓库的修改提供背书。功能、行为和更新节奏可能与官方版本不同；本仓库新增或修改功能的问题，请在 [本仓库 Issues](https://github.com/shini74744/nezha/issues) 反馈，不要直接向上游项目提交。

二开维护者：[shini74744](https://github.com/shini74744) · 本仓库：[shini74744/nezha](https://github.com/shini74744/nezha)。

## 本仓库源码

- 后端：`cmd/`、`model/`、`service/` 等目录。
- 管理后台：`frontend/admin/`，包含排序、公开备注、时间格式、统一留白、移动端表格滚动和主题列表修复。
- 默认前台：`frontend/user/`，包含原生美化功能；其他社区主题不应用默认主题美化。
- 美化接口和配置说明：[APPEARANCE.md](APPEARANCE.md)。

## 从源码构建

Linux 构建依赖：Go 1.26.8、C/C++ 编译工具、Node.js 24、npm、Corepack、rsync、curl、unzip、yq v4、swag v1.16.6。
默认前台使用 package.json 固定的 pnpm 版本，后台使用 npm lockfile。
自行准备合法授权的 GeoIP country.mmdb，不要把生产配置、数据库、证书或访问令牌提交到仓库。

```bash
GEOIP_DB=/path/to/country.mmdb VERSION=custom-$(git rev-parse --short HEAD) bash script/build-custom.sh
```

产物为 `dist/dashboard`。脚本会编译本仓库的两套前端、保留原有社区主题，再嵌入后端。
仅运行上游 `fetch-frontends.sh` 会下载上游界面；构建此二开版请使用上述 `build-custom.sh`。
本次源码同步不创建 GitHub Release，不修改现有上游发布工作流。
测试方法和目录说明见 [frontend/README.md](frontend/README.md)。

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
