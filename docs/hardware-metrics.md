# CPU 与 GPU 指标

主面板 v0.0.8 与 Agent v1.0.4 新增指标采集及点击切换。发布不等于生产部署；旧 Agent 不会仅因面板更新就具备新采集能力。新 Agent 与现有面板协议兼容，未升级的面板会忽略新增字段；完整界面需要主面板 v0.0.8。

## 界面

默认主题与哆啦 A 梦详情页复用磁盘卡片的交互：点击 CPU / GPU 标题（键盘 Enter、空格也可）轮换有效指标。标题、数值、单位、曲线同步切换，卡片高度保持固定。

- CPU：使用率 → 温度 → 频率。温度为已识别 CPU 传感器最高值，不将普通 ACPI 热区当作 CPU 核心。
- 每张 GPU：利用率 → 专用显存占比 → 共享内存占比 → 核心温度。显存页同时显示已用 / 总量；共享内存是可供 GPU 使用的系统内存，不能与独显显存混合。
- 不支持或无法读取的选项隐藏，不伪造 0；已知总量下的真实零占用正常显示。
- 实时页显示本次访问收到的采样；离线「最后状态」使用持久化的最后一分钟快照，重载页面仍保持离线读数。
- 1 / 7 / 30 天沿用原有历史曲线；新增频率、显存及按设备关联的核心温度没有历史时序时不展示当前值冒充历史。

## 采集范围

GPU 利用率、显存仍受 `gpu` / GPU 监控开关控制；温度仍受 `temperature` / 温度监控开关控制。CPU 频率随状态上报，无新增安装参数、目录或服务，不改变 `DDNZ_*` 变量与官方安装隔离。

Windows 使用 DXGI 硬件适配器标识与英文 PDH 性能计数器关联，支持驱动提供 WDDM 计数器的核显、独显。显示名称由同一次采集提供，避免虚拟显示器导致列表错位。利用率取同一设备最忙引擎，不将所有引擎相加。专用容量为驱动报告可用容量，可能小于显卡标称容量。没有驱动计数器的数据不保证可采集。

Windows NVIDIA 核心温度通过已存在的 `nvidia-smi` 只读查询获取。仅在型号唯一时关联到 DXGI 设备；多张同型号无法可靠匹配时保留 PCI 限定的传感器名，不猜测归属。查询超时/失败清除旧样本并允许后续恢复。不会安装驱动、调整功耗或修改 GPU 设置。

Linux 逐卡读取：NVIDIA 使用同一份 PCI 标识查询提供利用率、显存和核心温度；AMD 从 DRM/sysfs 读取利用率、VRAM 和 `amdgpu` 的片上温度；Intel 指定 `/dev/dri/cardN` 调用已安装的 `intel_gpu_top`，避免混合显卡只选到第一种厂商。温度不会取 AMD 热点温度来冒充核心/边缘温度。Intel 缺少可靠显存或核心温度接口时不填充。各卡独立失败、缺失项隐藏；无 PCI DRM 节点时保留原有厂商回退路径。容器需可访问相应设备和宿主接口，遵循现有 `HOST_SYS/HOST_PROC` 挂载约定，不修改权限。

macOS Apple Silicon 保留 IOKit GPU 利用率，并将已开放的 GPU HID 核心传感器对应到唯一集成 GPU；不把统一内存总量冒充专用显存。Intel Mac 保留原有温度接口，可识别 `TC0D` CPU 二极管温度；Apple CPU 核心传感器 `pACC/eACC MTR Temp Sensor` 可用于 CPU 温度切换。传感器因系统版本关闭时隐藏。FreeBSD 只读读取已存在的 `dev.cpu.N.temperature`，不会加载 `coretemp/amdtemp` 模块；GPU 没有本项目可验证的通用采集接口，不承诺显示。

CPU 频率：
- Linux 优先读取 `cpuinfo_cur_freq`，标注「当前频率」；退回 `scaling_cur_freq` 或 `/proc/cpuinfo` 的 cpu MHz 时标注「系统报告频率」。多逻辑核取有效值平均。
- Windows 电源信息接口返回系统报告频率（指定频率乘节流比例），不能保证等同瞬时睿频。
- macOS 可用的基准信息标注「标称频率」。FreeBSD 优先读取 `dev.cpu.N.freq` 并标注「系统报告频率」，退回 `hw.clockrate` 时标注「标称频率」。其他平台使用系统接口可读取值并标注「系统报告频率」。
- 虚拟机、容器、Apple Silicon 或固件不提供数据时隐藏，不承诺所有硬件都有频率或 CPU 核心温度。
- 未额外安装 Windows CPU 温度驱动。只有 ACPI 温度的机器不会出现虚假的 CPU 核心温度选项。

参考：[Windows GPU 计数原理](https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/)、[Windows CPU 电源信息](https://learn.microsoft.com/en-us/windows/win32/power/processor-power-information-str)、[Linux CPUFreq](https://docs.kernel.org/admin-guide/pm/cpufreq.html)、[NVIDIA SMI](https://docs.nvidia.com/deploy/nvidia-smi/index.html)。

跨平台接口依据：[Linux AMDGPU 温度](https://www.kernel.org/doc/html/latest/gpu/amdgpu/thermal.html)、[Intel GPU 工具设备选择](https://manpages.debian.org/testing/intel-gpu-tools/intel_gpu_top.1.en.html)、[FreeBSD coretemp](https://man.freebsd.org/cgi/man.cgi?query=coretemp&sektion=4)、[macOS 传感器名称映射参考](https://github.com/exelban/stats/blob/master/Modules/Sensors/values.swift)。

验证边界：Windows Intel 核显 + NVIDIA RTX 2050 已运行隔离只读采集测试。Linux 混合厂商、显存、温度、失败/取消及 FreeBSD sysctl 通过模拟接口测试；Linux 构建机没有物理 GPU。macOS / FreeBSD 仍需对应实机验收，交叉编译不能代替真实传感器测试。
