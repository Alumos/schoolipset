# IP Sentinel Windows 客户端

该客户端面向 Windows 7 SP1、Windows 10、Windows 11，目标运行时为 .NET Framework 4.8。

GitHub Release 提供 `IP-Sentinel-Windows.exe` 单文件程序，不需要额外复制 DLL、配置文件或 ZIP。客户端使用 Windows .NET Framework 4.8 自带组件，因此 .NET Framework 4.8 是唯一的系统前置条件；它无法像普通业务 DLL 一样被安全地内嵌进 EXE。发布包内的服务器地址和生产公钥由 GitHub Actions 构建时写入，修改服务器配置后需要重新构建发布版本。

首次运行输入教师姓名后，客户端会使用本机生成的设备密钥向服务端注册；之后每 60 秒检查一次活动物理网卡，并在网卡变化、睡眠恢复时立即检查。发现配置不一致时，可以一键申请并设置 IP、子网掩码、网关和 DNS。

网络修改在获得 UAC 授权后执行。客户端会保存当前配置，修改后重新读取并验证网关、DNS、HTTPS 和 `ping baidu.com`；验证失败会自动尝试恢复旧配置，并将“疑似目标 IP 被占用”或“回滚失败”上报后台。

## 发布注意

- .NET Framework 4.8 需要在目标 Windows 上可用；安装包应在发布前检查运行时。
- 直接运行 `IP-Sentinel-Windows.exe` 即可，无需解压或准备旁侧依赖文件；设备状态会保存到当前用户的 LocalAppData。
- 生产环境应在 GitHub Actions Secret 中配置 `DEVICE_SERVER_PUBLIC_KEY_JWK`，让发布包内置并固定服务端公钥。
- 未配置公钥时，客户端会通过 `/v1/device/server-key` bootstrap；这只适合开发或受信网络，不应作为公网生产安全方案。
- 客户端不会隐藏窗口、注入进程、读取键盘或绕过 UAC。
