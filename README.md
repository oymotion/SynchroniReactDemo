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

## Node.js SDK 用户 API

以下说明对应当前安装的 `@synchroni/synchronisdk-node` `1.4.7`，只列出应用可直接使用的公开 API。

### 运行环境与安装

SDK 本身支持 Node.js 18 或更高版本，提供 Windows x64/x86、Linux x64/x86 运行时；Linux x86 运行环境要求 glibc 2.28 或更高版本。安装时不需要原 SensorSDKCXX 仓库或 C++ 编译器。

```bash
npm install @synchroni/synchronisdk-node
```

在 Node.js 中使用 `SensorClient` 时，运行环境还需要提供全局 `WebSocket`，建议使用 Node.js 22 或更高版本。浏览器直接使用浏览器自带的 `WebSocket` 即可。

### 导出入口

| 导入路径 | 内容 | 适用环境 |
| --- | --- | --- |
| `@synchroni/synchronisdk-node` | `SensorClient`、`SensorController`、`SensorProfile`、`SensorData` 和相关类型 | 浏览器或 Node.js 客户端 |
| `@synchroni/synchronisdk-node/sidecar` | `startSidecar`、`SidecarHandle` | 运行传感器服务的 Node.js 主机 |
| `@synchroni/synchronisdk-node/native` | 默认原生 API，以及快照和原生数据类型 | 仅 Node.js |

浏览器入口不加载原生模块，传感器操作由 sidecar 执行。原生入口则直接在当前 Node.js 进程中操作传感器。

### 客户端快速开始

```ts
import { SensorController } from '@synchroni/synchronisdk-node';

const controller = await SensorController.connect(url, token);
console.log(await controller.getVersion());
console.log(await controller.getCapiVersion());

const devices = await controller.scanOnce(3000);
if (devices.length > 0) {
  const profile = await controller.requireSensor(devices[0]);
  const unsubscribe = profile.onSensorNotifyData((dataList) => {
    for (const data of dataList) {
      console.log(data.deviceMac, data.dataType, data.sampleCount);
    }
  });

  await profile.connect();
  await profile.init();
  await profile.startDataNotification();

  // 使用完毕后停止数据、断开设备并取消订阅。
  await profile.stopDataNotification();
  await profile.disconnect();
  unsubscribe();
}

controller.terminate();
```

`controller.terminate()` 只关闭客户端；通过 `startSidecar()` 启动的服务还需要调用返回句柄的 `close()`。

### `startSidecar(options?)`

从 `@synchroni/synchronisdk-node/sidecar` 导入，用于启动 WebSocket 传感器服务。

```ts
import { startSidecar } from '@synchroni/synchronisdk-node/sidecar';

const sidecar = await startSidecar({ port: 8765 });
console.log(sidecar.url, sidecar.token);

// 服务使用完毕后关闭。
await sidecar.close();
```

可选参数：

- `host?: string`：监听地址，默认 `127.0.0.1`。
- `port?: number`：监听端口，默认自动分配可用端口。
- `token?: string`：客户端身份验证 Token，默认随机生成。
- `endpointPath?: string`：连接信息文件路径，默认 `build/sidecar-endpoint.json`。

返回 `Promise<SidecarHandle>`，句柄包含：

- `url: string`：客户端使用的 WebSocket URL。
- `token: string`：客户端连接 Token。
- `endpointPath: string`：连接信息文件的绝对路径。
- `close(): Promise<void>`：关闭服务并删除连接信息文件。

也可以使用命令行启动同样的服务：

```bash
npx synchroni-sidecar
```

### `SensorController`

设备扫描、设备对象管理、全局参数、多设备操作和 BIN 文件操作的控制器。

通常使用 `SensorController.connect(url, token)` 创建；也可以通过 `new SensorController(client)` 包装已有的 `SensorClient`。

**连接与状态**

- `static connect(url: string, token: string): Promise<SensorController>`：连接 sidecar 并创建控制器。
- `constructor(client: SensorClient)`：使用已有客户端创建控制器。
- `readonly client: SensorClient`：当前控制器使用的客户端。
- `snapshot: SyncSnapshot | undefined`：最近一次同步快照。
- `restore(snapshot: SyncSnapshot): void`：从同步快照恢复设备对象及状态。
- `getVersion(): Promise<string>`：获取 SDK 版本。
- `getCapiVersion(): Promise<number>`：获取 C API 版本。
- `onSuspend(): Promise<boolean>`：向 SDK 发送挂起通知。
- `terminate(): void`：释放控制器并关闭客户端连接。

**扫描**

- `startScan(periodInMs: number): Promise<boolean>`：开始持续扫描，参数为扫描周期，单位毫秒。
- `stopScan(): Promise<boolean>`：停止扫描。
- `scanOnce(periodInMs: number): Promise<BleDevice[]>`：扫描一次并返回设备列表。
- `isScanning(): Promise<boolean>`：查询是否正在扫描。
- `isEnable(): Promise<boolean>`：查询蓝牙是否可用。

**设备对象**

- `requireSensor(device: BleDevice): Promise<SensorProfile>`：取得或创建指定设备的 `SensorProfile`。
- `getSensor(mac: string): SensorProfile | undefined`：按 MAC 地址取得已有设备对象。
- `getSensors(): SensorProfile[]`：取得全部已有设备对象。

**控制器事件**

所有事件注册方法都返回取消订阅函数。

- `onDeviceFound(callback: (devices: BleDevice[]) => void): () => void`：发现设备。
- `onEnableChanged(callback: (enabled: boolean) => void): () => void`：蓝牙可用状态变化。
- `onScanStateChange(callback: (isScanning: boolean, errorMsg: string) => void): () => void`：扫描状态变化。

**参数与日志**

- `getParam(key: string): Promise<string>`：读取控制器参数。
- `setParam(key: string, value: string): Promise<string>`：写入控制器参数。
- `log(message: string, level = 'I'): void`：写入控制器日志。

**BIN 文件**

文件路径均指 sidecar 或原生 API 所在计算机上的路径。

- `getBinFileInfo(path: string): Promise<Record<string, unknown> | null>`：读取 BIN 文件信息。
- `replayBinFile(path: string, profile: SensorProfile, realtime = false, timeoutMs = 0): Promise<boolean>`：向指定设备对象回放 BIN 文件。
- `pauseBinReplay(profile: SensorProfile): Promise<string>`：暂停回放。
- `resumeBinReplay(profile: SensorProfile): Promise<string>`：继续回放。
- `stopBinReplay(profile: SensorProfile): Promise<string>`：停止回放。
- `parseBinToCsv(binPath: string, csvPath: string): Promise<string>`：将 BIN 文件导出为 CSV。

**多设备操作**

- `multiStartDataNotification(profiles: SensorProfile[], timeoutMs = 0, maxDelayDispersionMs = -1, maxAttempts = 0): Promise<MultiDeviceResult[]>`：启动多设备数据通知，可设置同步启动允许的最大时间差和重试次数。
- `multiStopDataNotification(profiles: SensorProfile[], timeoutMs = 0): Promise<MultiDeviceResult[]>`：停止多设备数据通知。
- `multiReplayBinFile(paths: string[], profiles: SensorProfile[], realtime = false, timeoutMs = 0): Promise<boolean[]>`：向多组设备同步回放 BIN 文件。

### `SensorProfile`

单个传感器的连接、初始化、数据通知、参数和事件接口。通常通过 `controller.requireSensor(device)` 获取，也可以使用 `new SensorProfile(client, bleDevice)` 创建。

**属性**

- `readonly bleDevice: BleDevice`：设备信息。
- `BLEDevice: BleDevice`：同 `bleDevice`。
- `mac: string`：设备 MAC 地址。
- `deviceState: number`：当前设备状态；`3` 表示 Ready。
- `isReady: boolean`：设备是否 Ready。
- `isDataTransfering: boolean`：是否正在传输数据。
- `hasInited: boolean`：是否已初始化。

**状态同步**

- `restore(snapshot: SensorSnapshot): void`：从设备快照恢复状态。
- `refreshFlags(): Promise<void>`：刷新设备状态、初始化和数据传输标志。

**连接与数据通知**

- `connect(): Promise<boolean>`：连接设备。
- `disconnect(): Promise<boolean>`：断开设备。
- `init(packageSampleCount = 32, powerRefreshInterval = 60000, timeout = 0): Promise<boolean>`：初始化设备，依次设置每包样本数、电量刷新间隔和超时时间；时间参数单位为毫秒。
- `startDataNotification(timeout = 0): Promise<boolean>`：启动数据通知。
- `stopDataNotification(timeout = 0): Promise<boolean>`：停止数据通知。
- `hasInit(): Promise<boolean>`：查询初始化状态。
- `hasStartDataNotification(): Promise<boolean>`：查询数据通知状态。

**设备信息与参数**

- `getBatteryLevel(timeout = 0): Promise<number>`：获取电量。
- `fetchDeviceInfo(timeout = 0): Promise<Record<string, unknown>>`：从设备获取信息。
- `getDeviceInfo(): Record<string, unknown> | undefined`：获取当前已缓存的设备信息。
- `setParam(key: string, value: string, timeout = 0): Promise<string>`：设置设备参数。
- `getParam(key: string, timeout = 0): Promise<string>`：读取设备参数。
- `autoReconnect: Promise<boolean>`：读取时 `await profile.autoReconnect` 获取自动重连设置，写入时 `profile.autoReconnect = true` 设置是否自动重连。
- `isAutoReconnecting(): Promise<boolean>`：查询是否正在自动重连。
- `log(message: string, level = 'I'): void`：写入设备日志。

**设备事件**

所有事件注册方法都返回取消订阅函数。

- `onStateChanged(callback: (state: number) => void): () => void`：设备状态变化。
- `onErrorCallback(callback: (reason: string) => void): () => void`：设备错误。
- `onSensorNotifyData(callback: (dataList: SensorData[]) => void): () => void`：收到传感器数据。
- `onPowerChanged(callback: (power: number) => void): () => void`：电量变化。
- `onDeviceInfoUpdate(callback: (info: Record<string, unknown>) => void): () => void`：设备信息更新。
- `onDataTransferStateChange(callback: (isTransferring: boolean) => void): () => void`：数据传输状态变化。
- `onAutoReconnect(callback: (hasLastSession: boolean, answer: (takeover: boolean) => void) => void): () => void`：询问是否接管上次会话，通过 `answer(true)` 或 `answer(false)` 回复。
- `onAutoReconnectingStateChanged(callback: (reconnecting: boolean) => void): () => void`：自动重连状态变化。

### `SensorData`

一批传感器样本的只读访问接口。通常由 `onSensorNotifyData` 回调提供，也可通过 `new SensorData(view: NativeDataView)` 创建。

**批次信息**

- `startSampleIndex: number`：本批起始样本索引。
- `startTimeStamp: number`：本批起始时间戳。
- `deviceMac: string`：设备 MAC 地址。
- `deviceName: string`：设备名称。
- `dataType: number`：数据类型数值。
- `lostPackageCount: number`：丢包数量。
- `sampleRate: number`：采样率。
- `channelCount: number`：通道数量。
- `channelMask: bigint`：启用通道位掩码。
- `sampleCount: number`：每通道样本数量。
- `delay: number`：数据延迟值。
- `startTimeSec: number`：批次开始时间，单位秒。

**样本访问**

通道从 `0` 开始，样本索引范围为 `0` 到 `sampleCount - 1`。无效通道、无效索引或无效样本的数值读取结果为 `0`。

- `isChannelEnabled(channel: number): boolean`：检查通道是否启用。
- `isDataValid(channel = 0, index = 0): boolean`：检查指定样本是否有效。
- `getData(channel: number, index: number): number`：读取转换后的样本值。
- `getRawData(channel: number, index: number): number`：读取原始样本值。
- `getSampleIndex(channel: number, index: number): number`：读取样本索引。
- `getImpedance(channel: number, index: number): number`：读取阻抗值。
- `getSaturation(channel: number, index: number): number`：读取饱和度值。
- `isLost(channel: number, index: number): boolean`：检查样本是否标记为丢失。
- `getAbsTimeStampInSec(channel: number, index: number): number`：读取样本绝对时间戳，单位秒。
- `getChannelData(channel: number): Float32Array`：读取整个通道；丢失样本以 `0` 填充。

**复制与原始视图**

- `nativeView(copy = false): NativeDataView`：取得原生数据视图；`copy` 为 `true` 时复制数据缓冲区。
- `clone(): SensorData`：创建独立副本。

### `SensorClient`

WebSocket 客户端。常规应用优先使用 `SensorController` 和 `SensorProfile`；需要自定义调用或事件处理时可直接使用此类。

```ts
const client = new SensorClient(url, token);
await client.connect();
```

- `constructor(url: string, token: string)`：创建客户端。
- `isConnected: boolean`：当前是否已连接。
- `syncSnapshot: SyncSnapshot | undefined`：最近一次同步快照。
- `connect(): Promise<void>`：连接并完成初始状态同步。
- `close(): void`：关闭客户端。
- `call<T = unknown>(method: string, params?: unknown): Promise<T>`：调用 sidecar 的命名方法。
- `on(name: string, listener: (...args: any[]) => void): () => void`：订阅事件，返回取消订阅函数。

客户端自身事件：

- `sync`：回调参数为 `SyncSnapshot`，表示收到完整状态快照。
- `clientError`：回调参数为 `Error`，表示客户端处理错误。
- `dataDropped`：回调参数为 `number`，表示丢弃的数据批次数量。

`on` 也可订阅控制器和设备事件。常规应用建议使用对应的类型化方法，例如 `controller.onDeviceFound` 和 `profile.onSensorNotifyData`。

### 公共数据类型

以下类型均可从 `@synchroni/synchronisdk-node/native` 导入；`BleDevice`、`NativeDataView` 和 `MultiDeviceResult` 也可从包根入口导入。

```ts
type BinaryData = ArrayBuffer | Uint8Array;

type BleDevice = {
  Name: string;
  Address: string;
  RSSI: number;
};

type NativeDataView = {
  infoBuffer: BinaryData;
  startSampleIndex: number;
  startTimeStamp: number;
  samplesBuffer: BinaryData;
};

type MultiDeviceResult = {
  mac: string;
  ok: boolean;
  error: string;
};

type SensorSnapshot = {
  device: BleDevice;
  state: number;
  initialized: boolean;
  transferring: boolean;
  deviceInfo: Record<string, unknown>;
  autoReconnect: boolean;
  autoReconnecting: boolean;
  power?: number;
};

type ReplaySnapshot = {
  mac?: string;
  macs: string[];
  paused: boolean;
  files: Record<string, string>;
  devices: Record<string, BleDevice>;
};

type SyncSnapshot = {
  sdkVersion: string;
  capiVersion: number;
  isScanning: boolean;
  isEnable: boolean;
  sensors: SensorSnapshot[];
  replay: ReplaySnapshot;
  settings: {
    debugEnabled: boolean;
    translateImu: boolean;
    debugDongleEnabled: boolean;
  };
};
```

### 原生 API

原生入口仅供 Node.js 使用，默认导出 `NativeAddon`。适合不使用 sidecar 的本地应用。

```ts
import native from '@synchroni/synchronisdk-node/native';

native.createController();
console.log(native.getVersion(), native.getCapiVersion());

// 使用完毕后释放。
native.terminate();
```

公开方法如下：

```ts
createController(): boolean;
terminate(): void;
getVersion(): string;
getCapiVersion(): number;

onControllerEvent(
  name: string,
  callback: (...args: any[]) => void,
): void;

startScan(periodInMs: number): boolean;
stopScan(): boolean;
isScanning(): boolean;
isEnable(): boolean;
scanOnce(periodInMs: number): Promise<BleDevice[]>;

getSensor(mac: string): SensorSnapshot;
getSensors(): SensorSnapshot[];
requireSensor(mac: string): void;
onProfileEvent(
  mac: string,
  name: string,
  callback: (...args: any[]) => void,
): void;

connect(mac: string): Promise<boolean>;
disconnect(mac: string): Promise<boolean>;
init(
  mac: string,
  packageSampleCount: number,
  powerRefreshInterval: number,
  timeout: number,
): Promise<boolean>;
startData(mac: string, timeout: number): Promise<boolean>;
stopData(mac: string, timeout: number): Promise<boolean>;
hasInit(mac: string): boolean;
hasStartData(mac: string): boolean;
getState(mac: string): number;

getBatteryLevel(mac: string, timeout: number): Promise<number>;
fetchDeviceInfo(mac: string, timeout: number): Promise<Record<string, unknown>>;
getDeviceInfo(mac: string): Record<string, unknown>;
setParam(
  mac: string,
  timeout: number,
  key: string,
  value: string,
): Promise<string>;
getParam(mac: string, timeout: number, key: string): Promise<string>;
controllerGetParam(key: string): Promise<string>;
controllerSetParam(key: string, value: string): Promise<string>;

setAutoReconnect(mac: string, enabled: boolean): void;
getAutoReconnect(mac: string): boolean;
isAutoReconnecting(mac: string): boolean;

getBinFileInfo(path: string): Record<string, unknown> | null;
replayBinFile(
  path: string,
  mac: string,
  realtime: boolean,
  timeoutMs: number,
): boolean;
pauseBinReplay(mac: string): string;
resumeBinReplay(mac: string): string;
stopBinReplay(mac: string): string;
parseBinToCsv(binPath: string, csvPath: string): Promise<string>;

controllerLog(message: string, level: string): void;
profileLog(mac: string, message: string, level: string): void;

multiStartData(
  macs: string[],
  timeoutMs: number,
  maxDelayDispersionMs: number,
  maxAttempts: number,
): Promise<MultiDeviceResult[]>;
multiStopData(
  macs: string[],
  timeoutMs: number,
): Promise<MultiDeviceResult[]>;
multiReplayBinFile(
  paths: string[],
  macs: string[],
  realtime: boolean,
  timeoutMs: number,
): boolean[];

onSuspend(): void;
```

控制器事件名称及回调参数：

- `deviceFound`：`(devices: BleDevice[])`。
- `enableChanged`：`(enabled: boolean)`。
- `scanStateChanged`：`(isScanning: boolean, errorMsg: string)`。

调用 `requireSensor(mac)` 后可订阅该设备的事件：

- `data`：`(mac: string, views: NativeDataView[])`。
- `stateChanged`：`(mac: string, newState: number)`。
- `error`：`(mac: string, errMsg: string)`。
- `powerChanged`：`(mac: string, power: number)`。
- `deviceInfoUpdate`：`(mac: string, info: Record<string, unknown>)`。
- `dataTransferStateChanged`：`(mac: string, isTransferring: boolean)`。
- `autoReconnectingStateChanged`：`(mac: string, isAutoReconnecting: boolean)`。
- `autoReconnect`：`(mac: string, hasLastSession: boolean, answer: (takeover: boolean) => void)`，通过 `answer` 回复是否接管上次会话。

如需使用自定义原生模块，可将 `SENSOR_NODE_ADDON_PATH` 设置为兼容 `.node` 文件的绝对路径；对应 SDK 动态库应放在该模块旁边，或位于系统的动态库搜索路径中。
