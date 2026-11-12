# DDnezha SSH Fail2ban 适配脚本

此目录只提供 SSH 防护，来源参考：

- https://raw.githubusercontent.com/shini74744/jj/refs/heads/main/fb5.sh
- 参考内容 SHA-256：`6dbac7e761b77bbd9f7fd914eb71dff8d6e986c3d46d4ba34ea3b7e005995a19`

脚本通过 Go embed 随 Agent 打包，由 Agent 非交互调用。系统安装、配置校验、指定 jail 的加载、状态读取、封禁列表与解封均限定为 SSH 功能。参数校验、私有配置、规则归属、切换备份及回退由 `pkg/sshlogin` 负责。

不执行上游整份脚本，不安装或清理 XUI，不重启 SSH、网络或整台服务器，不清空共享防火墙。

自动封禁使用 Agent 已核验端口的失败事件输入，Fail2ban 负责计数和 action；手动黑名单、白名单和仅白名单使用独立的来源 action。后者是 DDnezha 的扩展能力，不声称上游 fb5 原本提供“仅白名单”。

`--plan OS_RELEASE` 只显示安装计划，供测试使用。其他入口由 Agent 调用；用户通过后台选择防护方式并保存即可。
