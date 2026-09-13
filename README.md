# IP Sentinel

教师办公 IP 合规监测系统：Windows 客户端负责采集和验证网卡配置，VPS 服务端负责名单、审计和实时管理后台。

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

容器同时监听 `18080`（API）和 `18081`（后台），数据保存于 `schoolipset_data` volume。生产部署应将镜像 tag 固定到 GitHub Actions 生成的 `sha-<commit>`，并通过 `.env` 注入管理员密码、MAC HMAC 密钥和设备加密私钥。

## Windows 客户端

客户端项目位于 `client/SchoolIpSet.Client`，目标为 .NET Framework 4.8，GitHub Actions 在 Windows runner 上构建。Mac 本地只构建/测试服务端和后台，不运行客户端，也不将 Mac 的网络行为当作 Windows 验收结果。

客户端修改网络前会请求一次性 change token；UAC 提升后使用 `netsh interface ipv4` 同时设置 IP、子网掩码、网关和 DNS，随后验证配置、网关、DNS、HTTPS 和 `ping baidu.com`。验证失败会尝试回滚原配置并上报证据。

## 加密密钥

生产客户端应在 GitHub Actions Secret 中设置 `DEVICE_SERVER_PUBLIC_KEY_JWK`，服务端通过 `DEVICE_SERVER_PRIVATE_KEY` 注入对应私钥，并将 `CLIENT_CRYPTO_REQUIRED=true`。未固定公钥时，客户端会使用 `/v1/device/server-key` bootstrap，只适合开发或受信网络。

管理后台不要长期通过公网明文 HTTP 登录；请在 VPS 上使用域名 HTTPS、VPN 或 SSH 隧道保护 `18081`。
