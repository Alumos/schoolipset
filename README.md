# IP Sentinel

教师办公 IP 合规监测系统：Windows 客户端负责采集和验证网卡配置，VPS 服务端负责名单、MAC 记录、审计和实时管理后台。

## 本地开发（Mac）

```bash
npm install
cp .env.example .env
npm run check
npm test
npm run build
```

启动服务端和已构建后台：

```bash
npm run build
npm start
```

- API：<http://127.0.0.1:18080>
- 管理后台：<http://127.0.0.1:18081>
- 默认开发管理员密码：`change-me-in-development`

后台教师名单页支持按 XLSX 相同字段直接新增或编辑姓名、地点、IP/前缀、网关、DNS、网卡提示和启用状态，并可按 MAC 是否已登记筛选。总览显示 MAC 登记人数和占比；检测事件页支持清空日志。教师名单、检测事件和审计日志均可导出 XLSX 或 CSV。客户端每次打开都要求确认姓名，上报并展示真实网卡 MAC 地址，修改 IP 后会逐步显示配置刷新、网关、DNS、HTTPS 和 `ping baidu.com` 校验结果。

开发时也可以分开启动：

```bash
npm run dev:api
npm run dev:web
```

后台导入目录内的 XLSX 后，服务会保存到 `.env` 中的 SQLite 路径。真实学校名单不应提交到 GitHub；当前文件只用于本地导入验证。

## Docker Compose

```bash
docker compose pull
docker compose up -d
```

容器同时监听 `18080`（API）和 `18081`（后台），数据保存于 `schoolipset_data` volume。生产部署可以直接使用仓库里的 Compose 文件，只需将 `environment.ADMIN_PASSWORD` 改成自己的管理员密码。客户端和 API 使用普通 JSON 通信，不需要 RSA/AES 密钥。

## Windows 客户端

客户端项目位于 `client/SchoolIpSet.Client`，目标为 .NET Framework 4.8，GitHub Actions 在 Windows runner 上构建。Mac 本地只构建/测试服务端和后台，不运行客户端，也不将 Mac 的网络行为当作 Windows 验收结果。

客户端修改网络前会请求一次性 change token；UAC 提升后使用 `netsh interface ipv4` 同时设置 IP、子网掩码、网关和 DNS，随后验证配置、网关、DNS、HTTPS 和 `ping baidu.com`。验证失败会尝试回滚原配置并上报证据。

## 客户端地址与传输说明

Windows 客户端连接编译在 EXE 中的 API 地址 `http://139.196.136.61:18080/`；管理后台页面地址是 `http://139.196.136.61:18081`。地址不是安全秘密，具备基本逆向能力的人可以从 EXE 中读取；修改地址需要重新编译客户端。

当前版本不要求填写 `DEVICE_SERVER_PRIVATE_KEY`、`DEVICE_SERVER_PUBLIC_KEY`，也不要求配置 GitHub 加密 Secret。设备令牌仍用于识别和撤销客户端，保存在客户端本地时使用 Windows DPAPI 保护。

由于当前部署使用 HTTP，管理员密码和设备令牌在网络传输中不具备 TLS 保护。若将端口暴露到公网，建议后续在 VPS 前面加 HTTPS、VPN 或 SSH 隧道。

管理后台不要长期通过公网明文 HTTP 登录；请在 VPS 上使用域名 HTTPS、VPN 或 SSH 隧道保护 `18081`。
