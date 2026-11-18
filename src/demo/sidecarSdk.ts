import { SensorController as NodeController, SensorData } from '@synchroni/synchronisdk-node';
import type {
  SensorProfile as NodeProfile,
  NativeDataView,
  MultiDeviceResult,
} from '@synchroni/synchronisdk-node';
import type { SyncSnapshot } from '@synchroni/synchronisdk-node/native';

export { SensorData };
export type { MultiDeviceResult, NativeDataView };
export type BLEDevice = { Name: string; Address: string; RSSI: number };

export enum DeviceStateEx {
  Disconnected = 0,
  Connecting = 1,
  Connected = 2,
  Ready = 3,
  Disconnecting = 4,
}

export enum DataType {
  NTF_ACC = 0x1,
  NTF_GYRO = 0x2,
  NTF_MAG = 0x3,
  NTF_EULER = 0x4,
  NTF_QUAT = 0x5,
  NTF_EMG_GEST = 0x7,
  NTF_EMG_ADC = 0x8,
  NTF_ANGLE = 0xd,
  NTF_EEG = 0x10,
  NTF_ECG = 0x11,
  NTF_IMPEDANCE = 0x12,
  NTF_IMU = 0x13,
  NTF_BRTH = 0x15,
  NTF_IMPEDANCE_EXT = 0x16,
  NTF_SPO2_HR = 0x17,
  NTF_PPG = 0x18,
}

const numericInfoKeys = [
  'MTUSize', 'EmgGain', 'EegGain', 'EcgGain',
  'EmgChannelCount', 'EegChannelCount', 'EcgChannelCount', 'BrthChannelCount',
  'AccChannelCount', 'GyroChannelCount', 'AngleChannelCount',
  'EmgSampleRate', 'EegSampleRate', 'EcgSampleRate', 'BrthSampleRate',
  'AccSampleRate', 'GyroSampleRate', 'AngleSampleRate',
  'ImuChannelCount', 'ImuSampleRate', 'EulerChannelCount', 'EulerSampleRate',
  'QuatChannelCount', 'QuatSampleRate', 'PpgChannelCount', 'PpgSampleRate',
  'Spo2ChannelCount', 'Spo2SampleRate', 'ImpeChannelCount', 'ImpeSampleRate',
  'EmgMaxSampleRate', 'EegMaxSampleRate', 'EcgMaxSampleRate',
  'ConnectionIntervalMs', 'PeripheralLatency', 'SupervisionTimeoutMs',
  'GestChannelCount', 'GestSampleRate', 'MagChannelCount', 'MagSampleRate',
] as const;

export type DeviceInfo = {
  DeviceName: string;
  ModelName: string;
  HardwareVersion: string;
  FirmwareVersion: string;
  IsMTUFine: boolean;
  Backend: string;
} & { [K in (typeof numericInfoKeys)[number]]: number };

export type BinFileInfo = {
  Mac: string;
  DeviceName: string;
  DurationSec: number;
  Valid: boolean;
  DeviceInfo: DeviceInfo;
  ConfigVersion: number;
};

export function emptyDeviceInfo(): DeviceInfo {
  return {
    DeviceName: '',
    ModelName: '',
    HardwareVersion: '',
    FirmwareVersion: '',
    IsMTUFine: false,
    Backend: '',
    ...Object.fromEntries(numericInfoKeys.map((key) => [key, 0])),
  } as DeviceInfo;
}

type WorkerSink = (dataList: SensorData[]) => void;

export class SensorProfile {
  onStateChange?: (profile: SensorProfile, state: DeviceStateEx) => void;
  onErrorCallback?: (profile: SensorProfile, reason: string) => void;
  onSensorNotifyData?: (profile: SensorProfile, dataList: SensorData[]) => void;
  onPowerChanged?: (profile: SensorProfile, power: number) => void;
  onDeviceInfoUpdate?: (profile: SensorProfile, info: DeviceInfo) => void;
  onAutoReconnect?: (
    profile: SensorProfile,
    hasLastSession: boolean,
    answer: (takeover: boolean) => void,
  ) => void;
  onDataTransferStateChange?: (profile: SensorProfile, transferring: boolean) => void;

  private native?: NodeProfile;
  private nativePromise?: Promise<NodeProfile>;
  private nativePromiseGeneration = -1;
  private unsubscribers: Array<() => void> = [];
  private generation = 0;
  private state = DeviceStateEx.Disconnected;
  private transferring = false;
  private initialized = false;
  private workerRuntime: Worker | null = null;
  private workerSink?: WorkerSink;

  constructor(
    private readonly owner: SensorController,
    private readonly device: BLEDevice,
  ) {}

  get BLEDevice(): BLEDevice { return this.device; }
  get mac(): string { return this.device.Address; }
  get deviceState(): DeviceStateEx { return this.state; }
  get isReady(): boolean { return this.state === DeviceStateEx.Ready; }
  get isDataTransfering(): boolean { return this.transferring; }
  get hasInited(): boolean { return this.native?.hasInited ?? this.initialized; }

  async ensureNative(): Promise<NodeProfile> {
    if (this.native) return this.native;
    if (this.nativePromise && this.nativePromiseGeneration === this.generation) return this.nativePromise;
    const generation = this.generation;
    this.nativePromiseGeneration = generation;
    this.nativePromise = (async () => {
      const native = await this.owner.resolveSensor(this.device);
      if (generation !== this.generation) return native;
      this.native = native;
      this.unsubscribers.push(
        native.onStateChanged((state) => {
          this.state = state as DeviceStateEx;
          if (this.state === DeviceStateEx.Disconnected) this.transferring = false;
          this.onStateChange?.(this, this.state);
        }),
        native.onErrorCallback((reason) => this.onErrorCallback?.(this, reason)),
        native.onSensorNotifyData((dataList) => {
          try {
            this.onSensorNotifyData?.(this, dataList);
          } finally {
            if (this.workerRuntime && this.workerSink) this.workerSink(dataList);
          }
        }),
        native.onPowerChanged((power) => this.onPowerChanged?.(this, power)),
        native.onDeviceInfoUpdate((info) => {
          this.onDeviceInfoUpdate?.(this, info as unknown as DeviceInfo);
        }),
        native.onAutoReconnect((hasLastSession, answer) => {
          if (this.onAutoReconnect) this.onAutoReconnect(this, hasLastSession, answer);
          else answer(false);
        }),
        native.onDataTransferStateChange((transferring) => {
          this.transferring = transferring;
          this.onDataTransferStateChange?.(this, transferring);
        }),
      );
      void this.refreshFlags();
      return native;
    })();
    try {
      return await this.nativePromise;
    } finally {
      this.nativePromise = undefined;
    }
  }

  async refreshFlags(): Promise<void> {
    const native = await this.ensureNative();
    await native.refreshFlags();
    this.state = native.deviceState as DeviceStateEx;
    this.initialized = native.hasInited;
    this.transferring = native.isDataTransfering;
  }

  useWorkletRuntime(runtime: Worker | null, onData?: WorkerSink): boolean {
    if (runtime !== null && typeof Worker === 'undefined') return false;
    this.workerRuntime = runtime;
    this.workerSink = runtime ? onData : undefined;
    return true;
  }

  async connect(): Promise<boolean> {
    const result = await (await this.ensureNative()).connect();
    await this.refreshFlags();
    return result;
  }

  async disconnect(): Promise<boolean> {
    const result = await (await this.ensureNative()).disconnect();
    this.transferring = false;
    return result;
  }

  async init(packageSampleCount = 32, powerRefreshInterval = 60000, timeout = 0): Promise<boolean> {
    this.initialized = await (await this.ensureNative()).init(
      packageSampleCount, powerRefreshInterval, timeout,
    );
    return this.initialized;
  }

  async hasInit(): Promise<boolean> {
    this.initialized = await (await this.ensureNative()).hasInit();
    return this.initialized;
  }

  async startDataNotification(timeout = 0): Promise<boolean> {
    const result = await (await this.ensureNative()).startDataNotification(timeout);
    if (result) this.transferring = true;
    return result;
  }

  async stopDataNotification(timeout = 0): Promise<boolean> {
    const result = await (await this.ensureNative()).stopDataNotification(timeout);
    if (result) this.transferring = false;
    return result;
  }

  async hasStartDataNotification(): Promise<boolean> {
    this.transferring = await (await this.ensureNative()).hasStartDataNotification();
    return this.transferring;
  }

  getBatteryLevel(timeout = 0): Promise<number> {
    return this.ensureNative().then((native) => native.getBatteryLevel(timeout));
  }

  async fetchDeviceInfo(timeout = 0): Promise<DeviceInfo> {
    return await (await this.ensureNative()).fetchDeviceInfo(timeout) as unknown as DeviceInfo;
  }

  getDeviceInfo(): DeviceInfo | undefined {
    return this.native?.getDeviceInfo() as DeviceInfo | undefined;
  }

  async setParam(key: string, value: string, timeout = 0): Promise<string> {
    return (await this.ensureNative()).setParam(key, value, timeout);
  }

  async getParam(key: string, timeout = 0): Promise<string> {
    return (await this.ensureNative()).getParam(key, timeout);
  }

  get autoReconnect(): Promise<boolean> {
    return this.ensureNative().then((native) => native.autoReconnect);
  }

  set autoReconnect(enabled: boolean) {
    void this.ensureNative().then((native) => { native.autoReconnect = enabled; }).catch(() => undefined);
  }

  isAutoReconnecting(): Promise<boolean> {
    return this.ensureNative().then((native) => native.isAutoReconnecting());
  }

  log(message: string, level = 'I'): void {
    void this.ensureNative().then((native) => native.log(message, level)).catch(() => undefined);
  }

  detach(): void {
    ++this.generation;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.native = undefined;
    this.workerRuntime = null;
    this.workerSink = undefined;
    this.state = DeviceStateEx.Disconnected;
    this.transferring = false;
  }
}

export class SensorController {
  private static instance?: SensorController;
  static get Instance(): SensorController {
    return this.instance ?? (this.instance = new SensorController());
  }

  onScanResult?: (devices: BLEDevice[]) => void;
  onEnableChanged?: (enabled: boolean) => void;
  onRestore?: (snapshot: SyncSnapshot) => void;

  private native?: NodeController;
  private nativeUnsubscribers: Array<() => void> = [];
  private profiles = new Map<string, SensorProfile>();
  private scanning = false;
  private enabled = false;
  private connecting?: Promise<void>;

  private constructor() {}

  get isScanning(): boolean { return this.scanning; }
  get isEnable(): boolean { return this.enabled; }
  get connected(): boolean { return this.native?.client.isConnected ?? false; }

  async connect(url: string, token: string): Promise<void> {
    if (this.native) {
      await this.native.client.connect();
      return;
    }
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const native = await NodeController.connect(url, token);
      this.native = native;
      [this.scanning, this.enabled] = await Promise.all([
        native.isScanning(), native.isEnable(),
      ]);
      if (native.snapshot) this.onRestore?.(native.snapshot);
      this.nativeUnsubscribers.push(
        native.client.on('sync', (snapshot: SyncSnapshot) => this.onRestore?.(snapshot)),
        native.client.on('clientError', (error) => console.error(error)),
        native.onDeviceFound((devices) => this.onScanResult?.(devices)),
        native.onEnableChanged((enabled) => {
          this.enabled = enabled;
          this.onEnableChanged?.(enabled);
        }),
        native.onScanStateChange((scanning) => { this.scanning = scanning; }),
      );
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  disconnect(): void {
    for (const profile of this.profiles.values()) profile.detach();
    for (const unsubscribe of this.nativeUnsubscribers) unsubscribe();
    this.nativeUnsubscribers = [];
    this.native?.terminate();
    this.native = undefined;
    this.scanning = false;
    this.enabled = false;
  }

  clearSensors(): void { this.profiles.clear(); }

  getVersion(): Promise<string> { return this.requireNative().getVersion(); }
  getCapiVersion(): Promise<number> { return this.requireNative().getCapiVersion(); }

  async startScan(periodInMs: number): Promise<boolean> {
    const result = await this.requireNative().startScan(periodInMs);
    this.scanning = result;
    return result;
  }

  async stopScan(): Promise<boolean> {
    const result = await this.requireNative().stopScan();
    this.scanning = false;
    return result;
  }

  scanOnce(periodInMs: number): Promise<BLEDevice[]> {
    return this.requireNative().scanOnce(periodInMs);
  }

  requireSensor(device: BLEDevice): SensorProfile {
    let profile = this.profiles.get(device.Address);
    if (!profile) {
      profile = new SensorProfile(this, device);
      this.profiles.set(device.Address, profile);
    }
    return profile;
  }

  async resolveSensor(device: BLEDevice): Promise<NodeProfile> {
    return this.requireNative().requireSensor(device);
  }

  getSensor(mac: string): SensorProfile | undefined { return this.profiles.get(mac); }
  getSensors(): SensorProfile[] { return [...this.profiles.values()]; }

  getParam(key: string): Promise<string> { return this.requireNative().getParam(key); }
  setParam(key: string, value: string): Promise<string> {
    return this.requireNative().setParam(key, value);
  }

  async getBinFileInfo(path: string): Promise<BinFileInfo> {
    const info = await this.requireNative().getBinFileInfo(path);
    if (info) return info as unknown as BinFileInfo;
    return {
      Mac: '', DeviceName: '', DurationSec: 0, Valid: false,
      DeviceInfo: emptyDeviceInfo(), ConfigVersion: 0,
    };
  }

  async replayBinFile(
    path: string,
    target: string | SensorProfile,
    realtime = false,
    timeoutMs = 0,
  ): Promise<boolean> {
    const profile = this.profileFor(target);
    const native = await profile.ensureNative();
    const result = await this.requireNative().replayBinFile(path, native, realtime, timeoutMs);
    await profile.refreshFlags();
    return result;
  }

  pauseBinReplay(target: string | SensorProfile): Promise<string> {
    return this.nativeReplayCall('pauseBinReplay', target);
  }

  resumeBinReplay(target: string | SensorProfile): Promise<string> {
    return this.nativeReplayCall('resumeBinReplay', target);
  }

  stopBinReplay(target: string | SensorProfile): Promise<string> {
    return this.nativeReplayCall('stopBinReplay', target);
  }

  private async nativeReplayCall(
    method: 'pauseBinReplay' | 'resumeBinReplay' | 'stopBinReplay',
    target: string | SensorProfile,
  ): Promise<string> {
    const profile = this.profileFor(target);
    return this.requireNative()[method](await this.resolveSensor(profile.BLEDevice));
  }

  parseBinToCsv(binPath: string, csvPath: string): Promise<string> {
    return this.requireNative().parseBinToCsv(binPath, csvPath);
  }

  async multiStartDataNotification(
    profiles: SensorProfile[], timeoutMs = 0, maxDelayDispersionMs = -1, maxAttempts = 0,
  ): Promise<MultiDeviceResult[]> {
    return this.requireNative().multiStartDataNotification(
      await this.nativeProfiles(profiles), timeoutMs, maxDelayDispersionMs, maxAttempts,
    );
  }

  async multiStopDataNotification(profiles: SensorProfile[], timeoutMs = 0): Promise<MultiDeviceResult[]> {
    return this.requireNative().multiStopDataNotification(
      await this.nativeProfiles(profiles), timeoutMs,
    );
  }

  async multiReplayBinFile(
    paths: string[], profiles: SensorProfile[], realtime = false, timeoutMs = 0,
  ): Promise<boolean[]> {
    const started = await this.requireNative().multiReplayBinFile(
      paths, await this.nativeProfiles(profiles), realtime, timeoutMs,
    );
    await Promise.all(profiles.map((profile, index) => started[index] ? profile.refreshFlags() : Promise.resolve()));
    return started;
  }

  private async nativeProfiles(profiles: SensorProfile[]): Promise<NodeProfile[]> {
    return Promise.all(profiles.map((profile) => profile.ensureNative()));
  }

  private profileFor(target: string | SensorProfile): SensorProfile {
    return typeof target === 'string'
      ? this.requireSensor({ Name: 'Replay', Address: target, RSSI: 0 })
      : target;
  }

  log(message: string, level = 'I'): void { this.native?.log(message, level); }
  onSuspend(): Promise<boolean> { return this.requireNative().onSuspend(); }

  private requireNative(): NodeController {
    if (!this.native) throw new Error('Connect the sidecar first');
    return this.native;
  }
}
