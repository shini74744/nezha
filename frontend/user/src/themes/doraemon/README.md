# 哆啦 A 梦 · 哪吒移植主题

基于当前默认前台的数据与交互逻辑，移植 dongbo501/minimalist-probe-doraemon-theme 的 v1.2.0 视觉设计。
参考版本：f340e11d649f79cffcaca0386edd59e44dd6356e。
原项目采用 Vue 与 Monitor 接口；此版本为 React / Nezha 原生适配，不请求 Monitor API。

## 使用与隔离

后台「系统设置 → 主题」列表最下方选择「哆啦 A 梦」，保存后刷新前台。
主题标识为 doraemon-dist。不会修改默认主题的美化配置；切回 Official 后仍恢复原有设置。
本主题不注入默认主题的自定义 HTML/CSS/JS、不挂载内置美化特效。
夜空、晴空与北京时间自动（07:00–19:00 晴空）在顶栏切换；偏好独立保存。
服务器、分组、排序、筛选、搜索、详情、网络与历史图表使用当前项目已有接口和权限。
没有引入新查询服务、分析服务、远程脚本或身份凭据。

## 本地构建

在 frontend/user 下运行 corepack pnpm run build:doraemon，产物位于 dist-doraemon。
仓库根目录运行 bash script/build-doraemon.sh 会安装锁定依赖、构建并嵌入 cmd/dashboard/doraemon-dist。
script/build-custom.sh 通过 fetch-frontends.sh 自动构建此内置移植主题。
Go 的 *-dist 嵌入同时保留默认、社区主题和新主题。

## 致谢与许可

视觉与 SVG 来源：https://github.com/dongbo501/minimalist-probe-doraemon-theme/tree/v1.2.0
SVG 版权声明及 MIT 许可保留于本目录 LICENSE。
上游归属：Copyright (c) 2025 Tony Liu；Copyright (c) 2026 dongbo501。
哪吒适配：shini74744/nezha。监控数据逻辑沿用当前项目默认主题。
非官方同人主题，与角色版权方无关。角色和道具名称权利归其权利人所有。
