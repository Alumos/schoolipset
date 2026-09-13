# IP Sentinel Windows 客户端

该客户端面向 Windows 7 SP1、Windows 10、Windows 11，目标运行时为 .NET Framework 4.8。

GitHub Release 提供 `IP-Sentinel-Windows.exe` 单文件程序，不需要额外复制 DLL、配置文件或 ZIP。客户端使用 Windows .NET Framework 4.8 自带组件，因此 .NET Framework 4.8 是唯一的系统前置条件；它无法像普通业务 DLL 一样被安全地内嵌进 EXE。发布包内的 API 地址由 GitHub Actions 构建时写入，修改服务器地址后需要重新构建发布版本。

首次运行输入教师姓名后，客户端会使用本机生成的设备 ID 向服务端注册；之后每 60 秒检查一次活动物理网卡，并在网卡变化、睡眠恢复时立即检查。发现配置不一致时，可以一键申请并设置 IP、子网掩码、网关和 DNS。

从 v0.2.2 起，启动 EXE 即请求管理员权限，主进程直接执行网络修改；已经提升权限或关闭 UAC 时可能不再弹窗。标准用户需要管理员凭据，使用另一管理员账户启动时设备状态属于该账户，可能需要重新绑定姓名。客户端保存当前配置，修改后重新读取并验证网关、DNS、TCP 443 和 `ping baidu.com`；验证失败尝试恢复旧配置。失败会弹窗显示具体原因。发布流水线提取 EXE 内嵌清单确认 requireAdministrator；这不替代真实 Win7 SP1/10/11 网卡验收。

## 发布注意

- .NET Framework 4.8 需要在目标 Windows 上可用；安装包应在发布前检查运行时。
- 直接运行 `IP-Sentinel-Windows.exe` 即可，无需解压或准备旁侧依赖文件；设备状态会保存到当前用户的 LocalAppData。
- 当前版本使用普通 JSON 与 API 通信，不需要服务端 RSA/AES 密钥或 GitHub 加密 Secret。
- API 地址是 `18080`，管理后台页面是 `18081`；地址写入 EXE 只是配置方式，不是保密措施。
- 客户端不会隐藏窗口、注入进程、读取键盘或绕过 UAC。
