# SynchroniReactDemo

Synchroni SDK 的独立浏览器 React 应用，保留设备管理、IMU、Bio、文件回放和 CSV 导出功能。

- React 19 / Vite 7 / TypeScript
- Synchroni SDK 通过 npm 包 `@synchroni/synchronisdk-node` 安装
- 浏览器客户端通过带身份验证的 WebSocket 连接 sidecar，蓝牙和传感器操作在 sidecar 所在的计算机上执行
- 使用 Web Worker 处理波形和频谱数据，支持多设备与 BIN 文件回放

## 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`，以及 npm
- 支持 WebSocket 和 Web Worker 的现代浏览器
- 连接真实传感器时，sidecar 主机需要支持蓝牙；当前 SDK 提供 Windows x64/x86 和 Linux x64/x86 运行时，Linux 要求 glibc 2.28 或更高版本

安装依赖：

```bash
npm install
```

## 启动 Sensor Sidecar

在连接传感器的计算机上、本项目目录中运行：

```bash
npx synchroni-sidecar
```

sidecar 默认监听 `127.0.0.1` 的随机可用端口，并将连接信息写入：

```text
build/sidecar-endpoint.json
```

该文件包含 WebSocket `url` 和随机生成的 `token`。请勿提交或分享此文件；正常停止 sidecar 时会将其删除。使用 `Ctrl+C` 停止 sidecar。

## 运行 React Demo

保持 sidecar 运行，在另一个终端启动 Vite：

```bash
npm run dev
```

打开 <http://127.0.0.1:5173>，将 `sidecar-endpoint.json` 中的 URL 和 Token 填入页面，然后点击 **Connect Sidecar**。

连接成功后即可扫描、连接并初始化传感器，启动数据通知后在 **IMU** 和 **Bio** 页面查看数据。BIN 文件路径指的是 **sidecar 所在计算机** 上的路径，而不是浏览器所在计算机。

页面也支持通过 `url` 和 `token` 查询参数预填并自动连接。注意 Token 会因此进入浏览器历史，分享链接前应移除连接参数。

## 构建与预览

```bash
npm run build
npm run preview
```

`npm run build` 会先执行 TypeScript 检查，再将生产文件输出到 `dist/`。预览地址默认为 <http://127.0.0.1:4173>。

生产构建和本地预览仍然需要单独运行 sidecar；`dist/` 中不包含原生 SDK 或 sidecar 进程。
