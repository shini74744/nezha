> [!IMPORTANT]
> **非官方版本声明**
>
> 本仓库是基于哪吒监控进行二次开发的魔改版本，并非官方开源版本。功能、行为及更新节奏可能与官方版本不同；本仓库特有问题请勿向官方项目反馈。

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
