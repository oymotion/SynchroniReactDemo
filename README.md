# SynchroniReactDemo

A standalone browser-based React application for the Synchroni SDK, with device management, IMU, Bio, file replay, and CSV export features.

- React 19 / Vite 7 / TypeScript
- Installs the Synchroni SDK from the `@synchroni/synchronisdk-node` npm package
- Connects the browser client to a sidecar over an authenticated WebSocket; Bluetooth and sensor operations run on the computer hosting the sidecar
- Uses a Web Worker to process waveform and spectrum data, with support for multiple devices and BIN file replay

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`, and npm
- A modern browser with WebSocket and Web Worker support
- To connect to physical sensors, the sidecar host must support Bluetooth. The SDK currently provides Windows x64/x86 and Linux x64/x86 runtimes; Linux requires glibc 2.28 or later

Install the dependencies:

```bash
npm install
```

## Start the Sensor Sidecar

Run the following command in this project directory on the computer connected to the sensors:

```bash
npx synchroni-sidecar
```

By default, the sidecar listens on a randomly available port on `127.0.0.1` and writes its connection details to:

```text
build/sidecar-endpoint.json
```

This file contains the WebSocket `url` and a randomly generated `token`. Do not commit or share this file. It is deleted when the sidecar shuts down normally. Press `Ctrl+C` to stop the sidecar.

## Run the React Demo

Keep the sidecar running and start Vite in another terminal:

```bash
npm run dev
```

Open <http://127.0.0.1:5173>, enter the URL and token from `sidecar-endpoint.json`, and click **Connect Sidecar**.

Once connected, you can scan for, connect to, and initialize sensors. After starting data notifications, view the data on the **IMU** and **Bio** pages. BIN file paths refer to files on the **computer hosting the sidecar**, not the computer running the browser.

The page also supports the `url` and `token` query parameters to prefill the fields and connect automatically. Note that this places the token in the browser history; remove the connection parameters before sharing a link.

## Build and Preview

```bash
npm run build
npm run preview
```

`npm run build` runs the TypeScript checks before writing production files to `dist/`. The default preview URL is <http://127.0.0.1:4173>.

Both production builds and local previews still require a separately running sidecar. The `dist/` directory contains neither the native SDK nor a sidecar process.

## Node.js SDK User API

The following documentation applies to the currently installed `@synchroni/synchronisdk-node` version `1.4.7` and covers only the public APIs available to applications.

### Runtime Requirements and Installation

The SDK itself supports Node.js 18 or later and provides Windows x64/x86 and Linux x64/x86 runtimes. Linux x64 and x86 runtimes require glibc 2.28 or later. Installation requires neither the original SensorSDKCXX repository nor a C++ compiler.

```bash
npm install @synchroni/synchronisdk-node
```

When using `SensorClient` in Node.js, the runtime must also provide a global `WebSocket`; Node.js 22 or later is recommended. In a browser, the native browser `WebSocket` implementation is used.

### Package Entry Points

| Import path | Exports | Environment |
| --- | --- | --- |
| `@synchroni/synchronisdk-node` | `SensorClient`, `SensorController`, `SensorProfile`, `SensorData`, and related types | Browser or Node.js clients |
| `@synchroni/synchronisdk-node/sidecar` | `startSidecar`, `SidecarHandle` | Node.js host running the sensor service |
| `@synchroni/synchronisdk-node/native` | Default native API, snapshot types, and native data types | Node.js only |

The browser entry point does not load the native module; sensor operations are performed by the sidecar. The native entry point operates sensors directly in the current Node.js process.

### Client Quick Start

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

  // Stop notifications, disconnect the device, and unsubscribe when done.
  await profile.stopDataNotification();
  await profile.disconnect();
  unsubscribe();
}

controller.terminate();
```

`controller.terminate()` closes only the client. A service started with `startSidecar()` must also be closed through the returned handle's `close()` method.

### `startSidecar(options?)`

Import from `@synchroni/synchronisdk-node/sidecar` to start the WebSocket sensor service.

```ts
import { startSidecar } from '@synchroni/synchronisdk-node/sidecar';

const sidecar = await startSidecar({ port: 8765 });
console.log(sidecar.url, sidecar.token);

// Close the service when done.
await sidecar.close();
```

Options:

- `host?: string`: Listening address; defaults to `127.0.0.1`.
- `port?: number`: Listening port; defaults to an automatically assigned available port.
- `token?: string`: Client authentication token; generated randomly by default.
- `endpointPath?: string`: Path to the connection details file; defaults to `build/sidecar-endpoint.json`.

Returns `Promise<SidecarHandle>`. The handle contains:

- `url: string`: WebSocket URL used by clients.
- `token: string`: Token used for client connections.
- `endpointPath: string`: Absolute path to the connection details file.
- `close(): Promise<void>`: Closes the service and deletes the connection details file.

You can also start the same service from the command line:

```bash
npx synchroni-sidecar
```

### `SensorController`

Controller for device scanning, device object management, global parameters, multi-device operations, and BIN file operations.

Usually created with `SensorController.connect(url, token)`. You can also wrap an existing `SensorClient` with `new SensorController(client)`.

**Connection and State**

- `static connect(url: string, token: string): Promise<SensorController>`: Connects to a sidecar and creates a controller.
- `constructor(client: SensorClient)`: Creates a controller using an existing client.
- `readonly client: SensorClient`: Client used by this controller.
- `snapshot: SyncSnapshot | undefined`: Most recent synchronization snapshot.
- `restore(snapshot: SyncSnapshot): void`: Restores device objects and state from a synchronization snapshot.
- `getVersion(): Promise<string>`: Gets the SDK version.
- `getCapiVersion(): Promise<number>`: Gets the C API version.
- `onSuspend(): Promise<boolean>`: Sends a suspend notification to the SDK.
- `terminate(): void`: Releases the controller and closes the client connection.

**Scanning**

- `startScan(periodInMs: number): Promise<boolean>`: Starts continuous scanning; `periodInMs` is the scan period in milliseconds.
- `stopScan(): Promise<boolean>`: Stops scanning.
- `scanOnce(periodInMs: number): Promise<BleDevice[]>`: Performs one scan and returns the discovered devices.
- `isScanning(): Promise<boolean>`: Checks whether scanning is active.
- `isEnable(): Promise<boolean>`: Checks whether Bluetooth is available.

**Device Objects**

- `requireSensor(device: BleDevice): Promise<SensorProfile>`: Gets or creates the `SensorProfile` for a device.
- `getSensor(mac: string): SensorProfile | undefined`: Gets an existing device object by MAC address.
- `getSensors(): SensorProfile[]`: Gets all existing device objects.

**Controller Events**

All event registration methods return an unsubscribe function.

- `onDeviceFound(callback: (devices: BleDevice[]) => void): () => void`: Devices discovered.
- `onEnableChanged(callback: (enabled: boolean) => void): () => void`: Bluetooth availability changed.
- `onScanStateChange(callback: (isScanning: boolean, errorMsg: string) => void): () => void`: Scan state changed.

**Parameters and Logging**

- `getParam(key: string): Promise<string>`: Reads a controller parameter.
- `setParam(key: string, value: string): Promise<string>`: Writes a controller parameter.
- `log(message: string, level = 'I'): void`: Writes a controller log message.

**BIN Files**

All file paths refer to files on the computer hosting the sidecar or native API.

- `getBinFileInfo(path: string): Promise<Record<string, unknown> | null>`: Reads BIN file information.
- `replayBinFile(path: string, profile: SensorProfile, realtime = false, timeoutMs = 0): Promise<boolean>`: Replays a BIN file through the specified device object.
- `pauseBinReplay(profile: SensorProfile): Promise<string>`: Pauses replay.
- `resumeBinReplay(profile: SensorProfile): Promise<string>`: Resumes replay.
- `stopBinReplay(profile: SensorProfile): Promise<string>`: Stops replay.
- `parseBinToCsv(binPath: string, csvPath: string): Promise<string>`: Exports a BIN file to CSV.

**Multi-device Operations**

- `multiStartDataNotification(profiles: SensorProfile[], timeoutMs = 0, maxDelayDispersionMs = -1, maxAttempts = 0): Promise<MultiDeviceResult[]>`: Starts notifications for multiple devices, with options for the maximum allowed synchronized-start time dispersion and the number of retry attempts.
- `multiStopDataNotification(profiles: SensorProfile[], timeoutMs = 0): Promise<MultiDeviceResult[]>`: Stops notifications for multiple devices.
- `multiReplayBinFile(paths: string[], profiles: SensorProfile[], realtime = false, timeoutMs = 0): Promise<boolean[]>`: Replays BIN files synchronously across multiple devices.

### `SensorProfile`

Interface for a single sensor's connection, initialization, data notifications, parameters, and events. Usually obtained through `controller.requireSensor(device)`, but can also be created with `new SensorProfile(client, bleDevice)`.

**Properties**

- `readonly bleDevice: BleDevice`: Device information.
- `BLEDevice: BleDevice`: Same as `bleDevice`.
- `mac: string`: Device MAC address.
- `deviceState: number`: Current device state; `3` means Ready.
- `isReady: boolean`: Whether the device is Ready.
- `isDataTransfering: boolean`: Whether data is being transferred.
- `hasInited: boolean`: Whether the device has been initialized.

**State Synchronization**

- `restore(snapshot: SensorSnapshot): void`: Restores state from a device snapshot.
- `refreshFlags(): Promise<void>`: Refreshes the device state, initialization, and data transfer flags.

**Connection and Data Notifications**

- `connect(): Promise<boolean>`: Connects to the device.
- `disconnect(): Promise<boolean>`: Disconnects from the device.
- `init(packageSampleCount = 32, powerRefreshInterval = 60000, timeout = 0): Promise<boolean>`: Initializes the device with the samples per packet, power refresh interval, and timeout; time values are in milliseconds.
- `startDataNotification(timeout = 0): Promise<boolean>`: Starts data notifications.
- `stopDataNotification(timeout = 0): Promise<boolean>`: Stops data notifications.
- `hasInit(): Promise<boolean>`: Checks the initialization state.
- `hasStartDataNotification(): Promise<boolean>`: Checks the data notification state.

**Device Information and Parameters**

- `getBatteryLevel(timeout = 0): Promise<number>`: Gets the battery level.
- `fetchDeviceInfo(timeout = 0): Promise<Record<string, unknown>>`: Fetches information from the device.
- `getDeviceInfo(): Record<string, unknown> | undefined`: Gets the currently cached device information.
- `setParam(key: string, value: string, timeout = 0): Promise<string>`: Sets a device parameter.
- `getParam(key: string, timeout = 0): Promise<string>`: Reads a device parameter.
- `autoReconnect: Promise<boolean>`: Read with `await profile.autoReconnect` to get the automatic reconnection setting; assign `profile.autoReconnect = true` to enable it or `false` to disable it.
- `isAutoReconnecting(): Promise<boolean>`: Checks whether automatic reconnection is in progress.
- `log(message: string, level = 'I'): void`: Writes a device log message.

**Device Events**

All event registration methods return an unsubscribe function.

- `onStateChanged(callback: (state: number) => void): () => void`: Device state changed.
- `onErrorCallback(callback: (reason: string) => void): () => void`: Device error received.
- `onSensorNotifyData(callback: (dataList: SensorData[]) => void): () => void`: Sensor data received.
- `onPowerChanged(callback: (power: number) => void): () => void`: Battery level changed.
- `onDeviceInfoUpdate(callback: (info: Record<string, unknown>) => void): () => void`: Device information updated.
- `onDataTransferStateChange(callback: (isTransferring: boolean) => void): () => void`: Data transfer state changed.
- `onAutoReconnect(callback: (hasLastSession: boolean, answer: (takeover: boolean) => void) => void): () => void`: Asks whether to take over the previous session; respond with `answer(true)` or `answer(false)`.
- `onAutoReconnectingStateChanged(callback: (reconnecting: boolean) => void): () => void`: Automatic reconnection state changed.

### `SensorData`

Read-only access to a batch of sensor samples. Instances are usually supplied to the `onSensorNotifyData` callback, but can also be created with `new SensorData(view: NativeDataView)`.

**Batch Information**

- `startSampleIndex: number`: Index of the first sample in this batch.
- `startTimeStamp: number`: Start timestamp of this batch.
- `deviceMac: string`: Device MAC address.
- `deviceName: string`: Device name.
- `dataType: number`: Numeric data type identifier.
- `lostPackageCount: number`: Number of lost packets.
- `sampleRate: number`: Sample rate.
- `channelCount: number`: Number of channels.
- `channelMask: bigint`: Bitmask of enabled channels.
- `sampleCount: number`: Number of samples per channel.
- `delay: number`: Data delay value.
- `startTimeSec: number`: Batch start time in seconds.

**Sample Access**

Channels are zero-based, and sample indices range from `0` to `sampleCount - 1`. Numeric reads return `0` for an invalid channel, invalid index, or invalid sample.

- `isChannelEnabled(channel: number): boolean`: Checks whether a channel is enabled.
- `isDataValid(channel = 0, index = 0): boolean`: Checks whether a sample is valid.
- `getData(channel: number, index: number): number`: Reads a converted sample value.
- `getRawData(channel: number, index: number): number`: Reads a raw sample value.
- `getSampleIndex(channel: number, index: number): number`: Reads the sample index.
- `getImpedance(channel: number, index: number): number`: Reads the impedance value.
- `getSaturation(channel: number, index: number): number`: Reads the saturation value.
- `isLost(channel: number, index: number): boolean`: Checks whether a sample is marked as lost.
- `getAbsTimeStampInSec(channel: number, index: number): number`: Reads the absolute sample timestamp in seconds.
- `getChannelData(channel: number): Float32Array`: Reads an entire channel, replacing lost samples with `0`.

**Copying and Native Views**

- `nativeView(copy = false): NativeDataView`: Gets the native data view; set `copy` to `true` to copy the data buffers.
- `clone(): SensorData`: Creates an independent copy.

### `SensorClient`

WebSocket client. Most applications should prefer `SensorController` and `SensorProfile`; use this class directly for custom calls or event handling.

```ts
const client = new SensorClient(url, token);
await client.connect();
```

- `constructor(url: string, token: string)`: Creates a client.
- `isConnected: boolean`: Whether the client is currently connected.
- `syncSnapshot: SyncSnapshot | undefined`: Most recent synchronization snapshot.
- `connect(): Promise<void>`: Connects and performs the initial state synchronization.
- `close(): void`: Closes the client.
- `call<T = unknown>(method: string, params?: unknown): Promise<T>`: Calls a named sidecar method.
- `on(name: string, listener: (...args: any[]) => void): () => void`: Subscribes to an event and returns an unsubscribe function.

Client events:

- `sync`: Receives a `SyncSnapshot` when a complete state snapshot arrives.
- `clientError`: Receives an `Error` when a client processing error occurs.
- `dataDropped`: Receives a `number` indicating the number of dropped data batches.

`on` can also subscribe to controller and device events. Most applications should use the corresponding typed methods, such as `controller.onDeviceFound` and `profile.onSensorNotifyData`.

### Public Data Types

All of the following types can be imported from `@synchroni/synchronisdk-node/native`. `BleDevice`, `NativeDataView`, and `MultiDeviceResult` can also be imported from the package root.

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

### Native API

The native entry point is available only in Node.js and has `NativeAddon` as its default export. It is suitable for local applications that do not use a sidecar.

```ts
import native from '@synchroni/synchronisdk-node/native';

native.createController();
console.log(native.getVersion(), native.getCapiVersion());

// Release the native API when done.
native.terminate();
```

The following public methods are available:

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

Controller event names and callback arguments:

- `deviceFound`: `(devices: BleDevice[])`.
- `enableChanged`: `(enabled: boolean)`.
- `scanStateChanged`: `(isScanning: boolean, errorMsg: string)`.

After calling `requireSensor(mac)`, you can subscribe to events for that device:

- `data`: `(mac: string, views: NativeDataView[])`.
- `stateChanged`: `(mac: string, newState: number)`.
- `error`: `(mac: string, errMsg: string)`.
- `powerChanged`: `(mac: string, power: number)`.
- `deviceInfoUpdate`: `(mac: string, info: Record<string, unknown>)`.
- `dataTransferStateChanged`: `(mac: string, isTransferring: boolean)`.
- `autoReconnectingStateChanged`: `(mac: string, isAutoReconnecting: boolean)`.
- `autoReconnect`: `(mac: string, hasLastSession: boolean, answer: (takeover: boolean) => void)`; use `answer` to specify whether to take over the previous session.

To use a custom native module, set `SENSOR_NODE_ADDON_PATH` to the absolute path of a compatible `.node` file. The corresponding SDK dynamic library must be located beside that module or in the system's dynamic library search path.
