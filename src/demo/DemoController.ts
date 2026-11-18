import { SensorController, DeviceStateEx, DataType } from './sidecarSdk';
import type {
  BLEDevice,
  DeviceInfo,
  MultiDeviceResult,
  SensorData,
  SensorProfile,
} from './sidecarSdk';
import type { SyncSnapshot } from '@synchroni/synchronisdk-node/native';
import { LiveFilter } from '../dsp/LiveFilter';
import { RingBuffer } from '../dsp/RingBuffer';
import {
  startDspRuntime,
  dspSetActive,
  dspSetBand,
  dspSetCloneData,
} from '../dsp/WorkerPipeline';
import type {
  DspExtras,
  DspRuntimeHandle,
  SpectrumSnapshot,
  WaveformSnapshot,
} from '../dsp/WorkerPipeline';
import type { SpectrumResult } from '../dsp/SpectrumCompute';

export { RingBuffer } from '../dsp/RingBuffer';

export const SCAN_DEVICE_PERIOD_MS = 3000;
export const PACKAGE_COUNT = 32;
export const CMD_TIMEOUT_MS = 5000;
export const PLOT_UPDATE_INTERVAL_MS = 50;
export const POWER_REFRESH_PERIOD_MS = 60000;
export const SPECTRUM_UPDATE_INTERVAL_MS = 200;
export const DEMO_VERSION = '0.1.9';

const DEVICE_EXPIRE_MS = 2 * SCAN_DEVICE_PERIOD_MS + 1500;
const DEVICE_LIST_REFRESH_MS = 1000;

export const NTF_OPTIONS = [
  { label: 'EEG', key: 'NTF_EEG' },
  { label: 'IMPE', key: 'NTF_IMPEDANCE' },
  { label: 'EMG', key: 'NTF_EMG' },
  { label: 'GESTURE', key: 'NTF_GEST' },
  { label: 'PPG', key: 'NTF_PPG' },
  { label: 'SpO2', key: 'NTF_SPO2' },
  { label: 'IMU', key: 'NTF_IMU' },
  { label: 'Angle', key: 'NTF_ANGLE' },
] as const;

export const FILTER_OPTIONS = [
  { label: '50Hz', key: 'FILTER_50HZ' },
  { label: '60Hz', key: 'FILTER_60HZ' },
  { label: 'HPF', key: 'FILTER_HPF' },
  { label: 'LPF', key: 'FILTER_LPF' },
] as const;

export const SAMPLE_RATE_CONTROLS = [
  { key: 'EEG_SAMPLE_RATE', label: 'EEG Sample Rate', candidates: [250, 500, 1000, 2000] },
  { key: 'EMG_SAMPLE_RATE', label: 'EMG Sample Rate', candidates: [500, 1000] },
  { key: 'IMU_SAMPLE_RATE', label: 'IMU Sample Rate', candidates: [50, 100, 200, 250, 400, 500, 1000, 2000] },
  { key: 'PPG_SAMPLE_RATE', label: 'PPG Sample Rate', candidates: [50, 100, 200, 400, 800, 1000, 1600, 3200] },
] as const;

const NTF_KEYS: string[] = NTF_OPTIONS.map((option) => option.key);
const FILTER_KEYS: string[] = FILTER_OPTIONS.map((option) => option.key);
const BIO_TYPES = new Set<DataType>([
  DataType.NTF_EMG_ADC, DataType.NTF_EEG, DataType.NTF_ECG,
  DataType.NTF_BRTH, DataType.NTF_ANGLE,
]);
const IMPEDANCE_TYPES = new Set<DataType>([
  DataType.NTF_EMG_ADC, DataType.NTF_EEG, DataType.NTF_ECG, DataType.NTF_BRTH,
]);
const LIVE_FILTER_TYPES = new Set<DataType>([
  DataType.NTF_EMG_ADC, DataType.NTF_EEG, DataType.NTF_ECG,
  DataType.NTF_BRTH, DataType.NTF_PPG, DataType.NTF_SPO2_HR,
]);
const RATE_LABEL_ORDER: Array<[DataType, string]> = [
  [DataType.NTF_EEG, 'EEG'], [DataType.NTF_ECG, 'ECG'],
  [DataType.NTF_EMG_ADC, 'EMG'], [DataType.NTF_BRTH, 'BRTH'],
  [DataType.NTF_PPG, 'PPG'], [DataType.NTF_SPO2_HR, 'SPO2'],
  [DataType.NTF_IMU, 'IMU'], [DataType.NTF_ACC, 'ACC'],
  [DataType.NTF_GYRO, 'GYRO'], [DataType.NTF_EULER, 'EULER'],
  [DataType.NTF_QUAT, 'QUAT'], [DataType.NTF_MAG, 'MAG'],
  [DataType.NTF_ANGLE, 'Angle'],
];

function logDirStamp(date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export interface GestureInfo {
  gesture: number;
  rawGesture: string;
  possibility: number;
  strength: number;
}

export interface DeviceState {
  profile: SensorProfile;
  info?: DeviceInfo;
  power?: number;
  buffers: Map<DataType, RingBuffer>;
  impedance: number[];
  expectedRates: Map<DataType, number>;
  actualRates: Map<DataType, number>;
  rateTotalCounts: Map<DataType, number>;
  rateStreamStartMs: Map<DataType, number>;
  rateStreamTags: Map<DataType, number>;
  rateLastDataMs: number;
  lostCounts: Map<DataType, number>;
  batches: number;
  totalSamples: number;
  gesture?: GestureInfo;
  liveFilter: LiveFilter;
  flowStarted: boolean;
  flowRunning: boolean;
  flowGeneration: number;
  isReplay: boolean;
  streaming: boolean;
  replayStreamingSeen: boolean;
  streamStartTimeSecs: Map<DataType, number>;
  streamDelayMs: number;
}

type Listener = () => void;

export class DemoController {
  private static instance?: DemoController;
  static get Instance(): DemoController {
    return this.instance ?? (this.instance = new DemoController());
  }

  devices: BLEDevice[] = [];
  selectedMac?: string;
  deviceStates = new Map<string, DeviceState>();
  status = 'Connect the sidecar first';
  sdkVersion = '';
  sidecarBusy = false;
  sidecarUrl: string;
  sidecarToken: string;
  binPathInput = '';
  multiBinPathsInput = '';
  debugLogEnabled = true;
  binDataEnabled = true;
  debugDongleEnabled = false;
  translateImu = true;
  useWorklets = true;
  cloneData = false;
  workletsActive = false;
  ntfStates: Record<string, boolean> = {};
  filterStates: Record<string, boolean> = {};
  sampleRateOptions: Record<string, number[]> = {};
  sampleRateCurrent: Record<string, number> = {};
  liveFilterBand = 0;
  replayFiles = new Map<string, string>();
  replayMac?: string;
  replayMacs: string[] = [];
  replayPaused = false;
  debugReplayLoop = false;

  private _autoReconnect = true;
  private sdkVersionPromise: Promise<string> = Promise.resolve('');
  private sessionLogDir?: string;
  private scanCache = new Map<string, { device: BLEDevice; lastSeenAt: number }>();
  private lastDeviceListRefreshAt = 0;
  private dspRuntimes = new Map<string, Worker>();
  private dspRuntimePool = new Map<string, DspRuntimeHandle>();
  private processedBuffers = new Map<string, Map<number, Float32Array[]>>();
  private spectra = new Map<string, Map<number, SpectrumResult>>();
  private lastLogPaths = new Map<string, string>();
  private lastDataPaths = new Map<string, string>();
  private savedParamsByMac = new Map<string, Array<[string, string]>>();
  private restoreParamsMacs = new Set<string>();
  private autoRecoveryMacs = new Set<string>();
  private replayStopRequestedMacs = new Set<string>();
  private listeners = new Set<Listener>();
  private plotListeners = new Set<Listener>();
  private statsListeners = new Set<Listener>();
  private plotTimer?: ReturnType<typeof setInterval>;
  private statsTimer?: ReturnType<typeof setInterval>;
  private autoConnectSidecar = false;
  private restorePromise?: Promise<void>;
  private selectionGeneration = 0;

  private constructor() {
    const query = new URLSearchParams(window.location.search);
    this.sidecarUrl = query.get('url') ?? 'ws://127.0.0.1:0';
    this.sidecarToken = query.get('token') ?? '';
    this.autoConnectSidecar = Boolean(this.sidecarUrl && this.sidecarToken);
    this.resetSelectionParamStates();
    if (import.meta.env.DEV) {
      (window as unknown as { __demoController: DemoController }).__demoController = this;
    }
  }

  get scanning(): boolean { return SensorController.Instance.isScanning; }
  get sidecarConnected(): boolean { return SensorController.Instance.connected; }

  activate(): void {
    SensorController.Instance.onScanResult = this.onScanResult;
    SensorController.Instance.onEnableChanged = this.onEnableChanged;
    SensorController.Instance.onRestore = this.restoreSnapshot;
    if (!this.plotTimer) this.plotTimer = setInterval(() => this.notifyPlots(), PLOT_UPDATE_INTERVAL_MS);
    if (!this.statsTimer) this.statsTimer = setInterval(() => this.settleStats(), 1000);
    this.deviceStates.forEach((state) => {
      if (this.isDisplayReady(state)) this.ensureWorkletBinding(state);
    });
    this.notify();
    if (this.autoConnectSidecar) void this.connectSidecar();
  }

  release(): void {
    if (this.plotTimer) clearInterval(this.plotTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.plotTimer = undefined;
    this.statsTimer = undefined;
    this.listeners.clear();
    this.plotListeners.clear();
    this.statsListeners.clear();
    SensorController.Instance.onScanResult = undefined;
    SensorController.Instance.onEnableChanged = undefined;
    SensorController.Instance.onRestore = undefined;
    this.unbindAllWorklets();
    this.destroyWorkerPool();
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  subscribePlot = (listener: Listener): (() => void) => {
    this.plotListeners.add(listener);
    return () => { this.plotListeners.delete(listener); };
  };

  subscribeStats = (listener: Listener): (() => void) => {
    this.statsListeners.add(listener);
    return () => { this.statsListeners.delete(listener); };
  };

  notify(): void {
    this.listeners.forEach((listener) => listener());
    this.plotListeners.forEach((listener) => listener());
    this.statsListeners.forEach((listener) => listener());
  }

  private notifyPlots(): void {
    this.plotListeners.forEach((listener) => listener());
  }

  private notifyStats(): void {
    this.statsListeners.forEach((listener) => listener());
  }

  connectSidecar = async (): Promise<void> => {
    if (this.sidecarBusy || this.sidecarConnected) return;
    this.sidecarBusy = true;
    this.status = 'Connecting sidecar ...';
    this.notify();
    try {
      await SensorController.Instance.connect(this.sidecarUrl.trim(), this.sidecarToken);
      this.sdkVersionPromise = SensorController.Instance.getVersion();
      this.sdkVersion = await this.sdkVersionPromise;
      void this.applyLogPath().then(() => SensorController.Instance.setParam(
        'DEBUG_ENABLED', this.debugLogEnabled ? 'True' : 'False',
      )).catch((error: unknown) => console.warn('DEBUG_ENABLED failed', error));
      void this.setTranslateImu(this.translateImu);
      void this.setDebugDongleEnabled(this.debugDongleEnabled);
      this.status = `Sidecar connected | SDK ${this.sdkVersion}`;
    } catch (error) {
      this.status = `Sidecar connection failed: ${String(error)}`;
    } finally {
      this.sidecarBusy = false;
      this.notify();
    }
  };

  disconnectSidecar = async (): Promise<void> => {
    if (this.sidecarBusy || !this.sidecarConnected) return;
    this.sidecarBusy = true;
    this.debugReplayLoop = false;
    this.status = 'Disconnecting sidecar ...';
    this.notify();
    try {
      if (this.replayActive()) await this.stopReplay();
      if (this.scanning) await SensorController.Instance.stopScan().catch(() => false);
      const profiles = SensorController.Instance.getSensors();
      await Promise.all(profiles.filter((profile) => profile.deviceState !== DeviceStateEx.Disconnected)
        .map((profile) => profile.disconnect().catch(() => false)));
    } finally {
      this.unbindAllWorklets();
      this.destroyWorkerPool();
      SensorController.Instance.disconnect();
      SensorController.Instance.clearSensors();
      this.deviceStates.clear();
      this.devices = [];
      this.scanCache.clear();
      this.selectedMac = undefined;
      ++this.selectionGeneration;
      this.resetSelectionParamStates();
      this.replayFiles.clear();
      this.replayMac = undefined;
      this.replayMacs = [];
      this.replayPaused = false;
      this.replayStopRequestedMacs.clear();
      this.processedBuffers.clear();
      this.spectra.clear();
      this.autoRecoveryMacs.clear();
      this.restoreParamsMacs.clear();
      this.sdkVersion = '';
      this.sidecarBusy = false;
      this.status = 'Sidecar disconnected';
      this.notify();
    }
  };

  private restoreSnapshot = async (snapshot: SyncSnapshot): Promise<void> => {
    if (this.restorePromise) return this.restorePromise;
    this.restorePromise = this.applySnapshot(snapshot).finally(() => {
      this.restorePromise = undefined;
    });
    return this.restorePromise;
  };

  private async applySnapshot(snapshot: SyncSnapshot): Promise<void> {
    const controller = SensorController.Instance;
    const sensors = snapshot.sensors ?? [];
    const replay = snapshot.replay ?? { files: {}, devices: {}, macs: [], paused: false };
    const now = Date.now();
    if (snapshot.settings) {
      this.debugLogEnabled = snapshot.settings.debugEnabled;
      this.translateImu = snapshot.settings.translateImu;
      this.debugDongleEnabled = snapshot.settings.debugDongleEnabled ?? false;
    }
    if (sensors.length > 0) this._autoReconnect = sensors.every((sensor) => sensor.autoReconnect);
    this.replayFiles = new Map(Object.entries(replay.files));
    this.replayMac = replay.mac;
    this.replayMacs = [...replay.macs];
    this.replayPaused = replay.paused;

    for (const sensor of sensors) {
      if (!sensor.device.Name && !replay.files[sensor.device.Address]) continue;
      this.scanCache.set(sensor.device.Address, { device: { ...sensor.device }, lastSeenAt: now });
    }
    for (const [mac, device] of Object.entries(replay.devices)) {
      this.scanCache.set(mac, { device: { ...device }, lastSeenAt: now });
    }

    const activeSensors = [...new Map(sensors.filter((sensor) => sensor.state !== DeviceStateEx.Disconnected
      || replay.files[sensor.device.Address] !== undefined)
      .map((sensor) => [sensor.device.Address, sensor])).values()];
    const activeMacs = new Set(activeSensors.map((sensor) => sensor.device.Address));
    for (const [mac, st] of this.deviceStates) {
      if (!activeMacs.has(mac)) this.teardownState(st);
    }

    for (const sensor of activeSensors) {
      const mac = sensor.device.Address;
      const isReplay = replay.files[mac] !== undefined;
      const profile = controller.requireSensor(sensor.device);
      await profile.ensureNative();
      const st = this.ensureState(mac, profile);
      st.isReplay = isReplay;
      st.info = sensor.deviceInfo as DeviceInfo;
      st.power = sensor.power !== undefined && sensor.power >= 0 ? sensor.power : undefined;
      st.flowStarted = isReplay || sensor.initialized;
      st.streaming = sensor.transferring;
      st.replayStreamingSeen = isReplay && sensor.transferring;
      this.attachProfileCallbacks(st);
      if (st.info) this.seedSampleRateCurrent(st.info, mac);
      if (isReplay) {
        this.autoRecoveryMacs.delete(mac);
        this.restoreParamsMacs.delete(mac);
      } else if (sensor.autoReconnecting) {
        this.autoRecoveryMacs.add(mac);
        this.restoreParamsMacs.add(mac);
      }
      if (this.isDisplayReady(st)) this.ensureWorkletBinding(st);
      if (!isReplay && sensor.initialized) await this.refreshParamStates(st, false, st.flowGeneration);
      if (!isReplay && profile.isReady && !st.flowStarted) void this.runReadyChain(st);
    }

    this.refreshDeviceList(now, true);
    if (!this.selectedMac || !this.devices.some((device) => device.Address === this.selectedMac)) {
      const selected = this.replayMac ?? this.replayMacs[0] ?? this.devices[0]?.Address;
      if (selected) this.selectDevice(selected);
    }
    if (!this.binPathInput && this.replayMac) this.binPathInput = this.replayFiles.get(this.replayMac) ?? '';
    if (!this.multiBinPathsInput && this.replayMacs.length > 0) {
      this.multiBinPathsInput = this.replayMacs.map((mac) => this.replayFiles.get(mac) ?? '').join(';');
    }
    this.notify();
  }

  private ensureWorkletBinding(st: DeviceState): void {
    if (!this.useWorklets || this.dspRuntimes.has(st.profile.BLEDevice.Address)) return;
    const mac = st.profile.BLEDevice.Address;
    try {
      let handle = this.dspRuntimePool.get(mac);
      if (!handle) {
        handle = startDspRuntime({
          onWaveform: this.onDspWaveform,
          onSpectrum: this.onDspSpectrum,
          onError: () => {
            this.status = 'Worker DSP unavailable; using the main thread';
            this.setUseWorklets(false);
          },
        }, mac, this.liveFilterBand, this.cloneData);
        this.dspRuntimePool.set(mac, handle);
      }
      if (st.profile.useWorkletRuntime(handle.runtime, handle.onData)) {
        this.dspRuntimes.set(mac, handle.runtime);
        this.workletsActive = true;
        dspSetActive(handle.runtime, true);
        dspSetBand(handle.runtime, this.liveFilterBand);
        dspSetCloneData(handle, this.cloneData);
      }
    } catch (error) {
      console.warn('Worker DSP init failed', error);
      this.setUseWorklets(false);
    }
  }

  private unbindAllWorklets(): void {
    this.dspRuntimes.forEach((runtime, mac) => {
      this.deviceStates.get(mac)?.profile.useWorkletRuntime(null);
      dspSetActive(runtime, false);
    });
    this.dspRuntimes.clear();
    this.workletsActive = false;
  }

  private destroyWorkerPool(): void {
    this.dspRuntimePool.forEach((handle) => handle.runtime.terminate());
    this.dspRuntimePool.clear();
  }

  isWorkletsBound(st: DeviceState): boolean {
    return this.dspRuntimes.has(st.profile.BLEDevice.Address);
  }

  private onDspWaveform = (
    mac: string,
    entries: WaveformSnapshot[],
    batches: number,
    _samples: Array<[number, number]>,
    rates: Array<[number, number]>,
    extras: DspExtras,
  ): void => {
    const st = this.deviceStates.get(mac);
    if (!st) return;
    let byType = this.processedBuffers.get(mac);
    if (!byType) {
      byType = new Map();
      this.processedBuffers.set(mac, byType);
    }
    for (const entry of entries) byType.set(entry.type, entry.channels);
    st.batches = Math.max(st.batches, batches);
    for (const [type, rate] of rates) st.expectedRates.set(type as DataType, rate);
    for (const [channel, value] of extras.impedance) st.impedance[channel] = value;
    if (extras.gesture) st.gesture = { ...extras.gesture, rawGesture: '-' };
  };

  private onDspSpectrum = (mac: string, entries: SpectrumSnapshot[]): void => {
    if (!this.deviceStates.has(mac)) return;
    let byType = this.spectra.get(mac);
    if (!byType) {
      byType = new Map();
      this.spectra.set(mac, byType);
    }
    for (const entry of entries) byType.set(entry.type, entry.result);
  };

  setUseWorklets = (enabled: boolean): void => {
    this.appLog(`User: use worker DSP ${enabled ? 'ON' : 'OFF'}`);
    this.useWorklets = enabled;
    if (enabled) this.deviceStates.forEach((state) => this.ensureWorkletBinding(state));
    else this.unbindAllWorklets();
    this.processedBuffers.clear();
    this.spectra.clear();
    this.deviceStates.forEach((state) => {
      this.clearBuffers(state);
      state.liveFilter.reset();
    });
    this.notify();
  };

  setCloneData = (enabled: boolean): void => {
    this.appLog(`User: clone data ${enabled ? 'ON' : 'OFF'}`);
    this.cloneData = enabled;
    this.dspRuntimePool.forEach((handle) => dspSetCloneData(handle, enabled));
    this.notify();
  };

  getDisplayChannels(st: DeviceState, type: DataType): Float32Array[] {
    if (this.isWorkletsBound(st)) {
      return this.processedBuffers.get(st.profile.BLEDevice.Address)?.get(type) ?? [];
    }
    return st.buffers.get(type)?.getAllChannels() ?? [];
  }

  getDisplayChannelCount(st: DeviceState, type: DataType): number {
    if (this.isWorkletsBound(st)) {
      return this.processedBuffers.get(st.profile.BLEDevice.Address)?.get(type)?.length ?? 0;
    }
    return st.buffers.get(type)?.channelCount ?? 0;
  }

  getDisplayLatest(st: DeviceState, type: DataType, channel: number): number {
    if (this.isWorkletsBound(st)) {
      const values = this.processedBuffers.get(st.profile.BLEDevice.Address)?.get(type)?.[channel];
      return values && values.length > 0 ? values[values.length - 1]! : 0;
    }
    return st.buffers.get(type)?.latest(channel) ?? 0;
  }

  getSpectrumFor(st: DeviceState, type: DataType): SpectrumResult | null {
    if (!this.isWorkletsBound(st)) return null;
    return this.spectra.get(st.profile.BLEDevice.Address)?.get(type) ?? null;
  }

  appLog = (message: string, level = 'I', st?: DeviceState): void => {
    try {
      const target = st ?? this.getActiveState();
      if (target) target.profile.log(message, level);
      else SensorController.Instance.log(message, level);
    } catch {
      return;
    }
  };

  private onEnableChanged = (enabled: boolean): void => {
    if (!enabled) {
      this.status = 'Please enable Bluetooth first';
      this.notify();
    }
  };

  private onScanResult = (deviceList: BLEDevice[]): void => {
    if (deviceList.length === 0) return;
    const now = Date.now();
    deviceList.forEach((device) => this.scanCache.set(device.Address, {
      device: { ...device }, lastSeenAt: now,
    }));
    this.refreshDeviceList(now);
  };

  private refreshDeviceList(now: number, force = false): void {
    for (const [mac, entry] of this.scanCache) {
      if (now - entry.lastSeenAt > DEVICE_EXPIRE_MS) this.scanCache.delete(mac);
    }
    const merged = this.mergeLiveDevices([...this.scanCache.values()].map((entry) => entry.device));
    const byMac = new Map(merged.map((device) => [device.Address, device]));
    const next: BLEDevice[] = [];
    for (const old of this.devices) {
      const current = byMac.get(old.Address);
      if (current) {
        next.push(current);
        byMac.delete(old.Address);
      }
    }
    next.push(...byMac.values());
    const membershipChanged = next.length !== this.devices.length
      || next.some((device, index) => device.Address !== this.devices[index]?.Address);
    const rssiChanged = next.some((device, index) => device.RSSI !== this.devices[index]?.RSSI);
    if (!membershipChanged && !rssiChanged) return;
    if (!force && !membershipChanged && now - this.lastDeviceListRefreshAt < DEVICE_LIST_REFRESH_MS) return;
    this.lastDeviceListRefreshAt = now;
    this.devices = next;
    const initialSelection = this.selectedMac ? undefined : this.devices[0]?.Address;
    if (initialSelection) this.selectDevice(initialSelection);
    this.notify();
  }

  private mergeLiveDevices(scanned: BLEDevice[]): BLEDevice[] {
    const merged = scanned.map((device) => ({ ...device }));
    const seen = new Set(merged.map((device) => device.Address));
    this.deviceStates.forEach((st, mac) => {
      if (!seen.has(mac) && (st.isReplay || st.profile.deviceState !== DeviceStateEx.Disconnected)) {
        merged.push({ ...st.profile.BLEDevice });
      }
    });
    merged.sort((a, b) => b.RSSI - a.RSSI);
    return merged;
  }

  startScanning = async (): Promise<void> => {
    try {
      if (!SensorController.Instance.isEnable) {
        this.appLog('User: start scan rejected (Bluetooth disabled)', 'W');
        this.status = 'Please enable bluetooth';
        this.notify();
        return;
      }
      this.appLog('User: start scan');
      const ok = await SensorController.Instance.startScan(SCAN_DEVICE_PERIOD_MS);
      this.status = ok ? 'Scanning ...' : 'Scan failed, try again';
    } catch (error) {
      this.status = `Error: ${String(error)}`;
    }
    this.notify();
  };

  stopScanning = async (): Promise<void> => {
    try {
      this.appLog('Stop scan');
      await SensorController.Instance.stopScan();
      this.status = 'Scan stopped';
    } catch (error) {
      this.status = `Error: ${String(error)}`;
    }
    this.notify();
  };

  selectDevice = (mac: string): void => {
    this.selectedMac = mac;
    const generation = ++this.selectionGeneration;
    this.resetSelectionParamStates();
    const st = this.deviceStates.get(mac);
    if (st?.flowStarted || st?.profile.isReady) {
      if (st.isReplay) this.status = `Replaying: ${st.profile.BLEDevice.Name}`;
      else this.updateConnectedStatus(st);
    } else {
      const device = this.devices.find((item) => item.Address === mac);
      if (device) this.status = `Selected: ${device.Name}`;
    }
    this.notify();
    if (st && (st.flowStarted || st.profile.isReady)) {
      void this.refreshParamStates(st, this.autoRecoveryMacs.has(mac), st.flowGeneration, generation)
        .finally(() => {
          if (this.selectedMac === mac && this.selectionGeneration === generation) this.notify();
        });
    }
  };

  connectSelected = async (): Promise<void> => {
    const mac = this.selectedMac;
    const device = this.devices.find((item) => item.Address === mac);
    if (!mac || !device) {
      this.appLog('User: connect rejected (no device selected)', 'W');
      this.status = 'Select a device first';
      this.notify();
      return;
    }
    this.appLog(`User: connect ${device.Name} (${mac})`);
    try {
      if (this.scanning) await this.stopScanning();
      const profile = SensorController.Instance.requireSensor(device);
      const st = this.ensureState(mac, profile);
      st.isReplay = false;
      this.attachProfileCallbacks(st);
      profile.autoReconnect = this._autoReconnect;
      this.status = `Connecting: ${device.Name}`;
      this.notify();
      const ok = await profile.connect();
      if (!ok && !profile.isReady) this.status = `Connect failed: ${device.Name}`;
    } catch (error) {
      this.status = `Connect failed: ${String(error)}`;
    }
    this.notify();
  };

  disconnectSelected = async (): Promise<void> => {
    const st = this.selectedMac ? this.deviceStates.get(this.selectedMac) : undefined;
    if (!st) {
      this.status = 'Select a device first';
      this.notify();
      return;
    }
    this.appLog(`User: disconnect ${st.profile.BLEDevice.Address}`, 'I', st);
    this.status = `Disconnecting: ${st.profile.BLEDevice.Name}`;
    this.notify();
    try {
      await st.profile.disconnect();
    } catch (error) {
      this.status = `Error: ${String(error)}`;
      this.notify();
    }
  };

  private ensureState(mac: string, profile: SensorProfile): DeviceState {
    let st = this.deviceStates.get(mac);
    if (!st) {
      st = {
        profile,
        buffers: new Map<DataType, RingBuffer>(),
        impedance: [],
        expectedRates: new Map<DataType, number>(),
        actualRates: new Map<DataType, number>(),
        rateTotalCounts: new Map<DataType, number>(),
        rateStreamStartMs: new Map<DataType, number>(),
        rateStreamTags: new Map<DataType, number>(),
        rateLastDataMs: 0,
        lostCounts: new Map<DataType, number>(),
        batches: 0,
        totalSamples: 0,
        liveFilter: new LiveFilter(),
        flowStarted: false,
        flowRunning: false,
        flowGeneration: 0,
        isReplay: false,
        streaming: false,
        replayStreamingSeen: false,
        streamStartTimeSecs: new Map<DataType, number>(),
        streamDelayMs: 0,
      };
      this.deviceStates.set(mac, st);
    }
    st.liveFilter.setBand(this.liveFilterBand);
    return st;
  }

  private attachProfileCallbacks(st: DeviceState): void {
    const { profile } = st;
    profile.onStateChange = (_sensor, state) => this.onStateChange(st, state);
    profile.onErrorCallback = (_sensor, reason) => {
      this.appLog(`App: error callback: ${String(reason)}`, 'E', st);
      this.status = `Error: ${String(reason)}`;
      this.notify();
    };
    profile.onSensorNotifyData = (_sensor, dataList) => {
      for (const data of dataList) this.onData(st, data);
    };
    profile.onPowerChanged = (_sensor, power) => {
      st.power = power;
      this.notify();
    };
    profile.onDeviceInfoUpdate = (_sensor, info) => {
      st.info = info;
      this.seedSampleRateCurrent(info, st.profile.BLEDevice.Address);
      if (st.flowStarted) this.updateConnectedStatus(st);
      this.notify();
    };
    profile.onAutoReconnect = (sensor, hasLastSession, answer) => {
      this.appLog(`App: auto reconnect callback received, restore=${hasLastSession ? 'True' : 'False'}`, 'I', st);
      const mac = sensor.BLEDevice.Address;
      if (!this._autoReconnect) {
        sensor.autoReconnect = false;
        this.autoRecoveryMacs.delete(mac);
        this.restoreParamsMacs.delete(mac);
        answer(false);
        return;
      }
      answer(true);
      this.autoRecoveryMacs.add(mac);
      if (hasLastSession) this.restoreParamsMacs.add(mac);
      const recovered = this.ensureState(mac, sensor);
      recovered.isReplay = false;
      this.selectDevice(mac);
      this.status = `Connection restored, recovering session: ${sensor.BLEDevice.Name} (${mac})`;
      this.notify();
      if (sensor.isReady) this.runReadyChain(recovered);
    };
    profile.onDataTransferStateChange = (_sensor, transferring) => {
      const mac = st.profile.BLEDevice.Address;
      st.streaming = transferring;
      this.appLog(`App: data stream ${transferring ? 'ON' : 'OFF'} ${mac}`, 'I', st);
      if (st.isReplay) {
        if (transferring) {
          st.replayStreamingSeen = true;
        } else {
          const stopRequested = this.replayStopRequestedMacs.delete(mac);
          const isMember = this.replayMac === mac || this.replayMacs.includes(mac);
          if ((isMember && st.replayStreamingSeen) || stopRequested) {
            const message = stopRequested
              ? 'Replay stopped'
              : `Replay finished (${st.batches} batches, ${st.totalSamples} samples)`;
            st.replayStreamingSeen = false;
            this.appLog(`App: replay done: ${message}`, 'I', st);
            this.status = message;
            if (!stopRequested && this.debugReplayLoop && isMember) {
              setTimeout(() => { void this.debugReplayLatestBin(); }, 500);
            }
          }
        }
      }
      this.notify();
    };
  }

  private onStateChange(st: DeviceState, state: DeviceStateEx): void {
    const mac = st.profile.BLEDevice.Address;
    if (state === DeviceStateEx.Ready) {
      if (st.isReplay) {
        st.flowStarted = true;
        this.status = `Replaying: ${st.profile.BLEDevice.Name}`;
        this.notify();
      } else {
        void this.runReadyChainFromState(st);
      }
    } else if (state === DeviceStateEx.Disconnected) {
      this.autoRecoveryMacs.delete(mac);
      if (!st.isReplay) {
        this.restoreParamsMacs.delete(mac);
        this.teardownState(st);
        this.scanCache.set(mac, { device: { ...st.profile.BLEDevice }, lastSeenAt: Date.now() });
        this.status = 'Disconnected (device)';
        this.appLog(`App: device disconnected, removed from UI: ${mac}`);
      } else {
        this.teardownState(st);
        this.replayFiles.delete(mac);
        this.replayMacs = this.replayMacs.filter((item) => item !== mac);
        if (this.replayMac === mac) this.replayMac = undefined;
        if (!this.replayActive()) this.replayPaused = false;
      }
      this.notify();
    }
  }

  private teardownState(st: DeviceState): void {
    st.flowStarted = false;
    ++st.flowGeneration;
    st.streaming = false;
    st.replayStreamingSeen = false;
    st.buffers.forEach((buffer) => buffer.clear());
    st.liveFilter.reset();
    const mac = st.profile.BLEDevice.Address;
    this.processedBuffers.delete(mac);
    this.spectra.delete(mac);
    const runtime = this.dspRuntimes.get(mac);
    if (runtime) {
      this.dspRuntimes.delete(mac);
      st.profile.useWorkletRuntime(null);
      dspSetActive(runtime, false);
      this.workletsActive = this.dspRuntimes.size > 0;
    }
    st.impedance = [];
    st.gesture = undefined;
    st.power = undefined;
    st.expectedRates.clear();
    st.actualRates.clear();
    st.rateTotalCounts.clear();
    st.rateStreamStartMs.clear();
    st.rateStreamTags.clear();
    st.rateLastDataMs = 0;
    st.streamStartTimeSecs.clear();
    st.lostCounts.clear();
    st.batches = 0;
    st.totalSamples = 0;
    st.streamDelayMs = 0;
    if (this.selectedMac === mac) this.resetSelectionParamStates();
    if (st.isReplay) this.deviceStates.delete(mac);
  }

  private async shouldContinueAutoRecovery(
    st: DeviceState,
    autoRecovery: boolean,
    generation: number,
  ): Promise<boolean> {
    const { profile } = st;
    const mac = profile.BLEDevice.Address;
    if (st.flowGeneration !== generation || profile.deviceState === DeviceStateEx.Disconnected) return false;
    if (!autoRecovery) return true;
    let nativeEnabled = false;
    try {
      nativeEnabled = await profile.autoReconnect;
    } catch (error) {
      console.warn('getAutoReconnect failed', error);
    }
    if (st.flowGeneration !== generation) return false;
    if (this._autoReconnect && nativeEnabled) return true;
    profile.autoReconnect = false;
    this.autoRecoveryMacs.delete(mac);
    this.restoreParamsMacs.delete(mac);
    return false;
  }

  private async runReadyChainFromState(st: DeviceState): Promise<void> {
    const generation = st.flowGeneration;
    try {
      if (await st.profile.isAutoReconnecting()) return;
    } catch (error) {
      console.warn('isAutoReconnecting failed', error);
      return;
    }
    if (st.flowGeneration === generation && st.profile.isReady) await this.runReadyChain(st);
  }

  private async runReadyChain(st: DeviceState): Promise<void> {
    if (st.flowRunning) return;
    const { profile } = st;
    const name = profile.BLEDevice.Name;
    const mac = profile.BLEDevice.Address;
    const autoRecovery = this.autoRecoveryMacs.has(mac);
    const generation = st.flowGeneration;
    st.flowRunning = true;
    try {
      if (!(await this.shouldContinueAutoRecovery(st, autoRecovery, generation))) return;
      const initialized = await profile.hasInit();
      if (st.flowStarted && initialized) {
        this.autoRecoveryMacs.delete(mac);
        this.updateConnectedStatus(st);
        return;
      }
      this.status = `Initializing: ${name}`;
      this.notify();
      if (!initialized) {
        const ok = await profile.init(PACKAGE_COUNT, POWER_REFRESH_PERIOD_MS);
        if (!ok) {
          this.appLog(`App: failed to initialize ${name} (${mac})`, 'E', st);
          throw new Error('init failed');
        }
      }
      const info = await profile.fetchDeviceInfo();
      if (info) {
        st.info = info;
        this.seedSampleRateCurrent(info, st.profile.BLEDevice.Address);
      }
      if (!(await profile.hasStartDataNotification())) {
        const started = await profile.startDataNotification();
        if (!started) throw new Error('startDataNotification failed');
        this.appLog(`App: device connected and streaming: ${name} (${mac})`, 'I', st);
      }
      if (this.debugLogEnabled) {
        try {
          await profile.setParam('DEBUG_LOG_PATH', this.lastLogPaths.get(mac) ?? 'True');
          const current = await profile.getParam('DEBUG_LOG_PATH');
          if (current && !/^error/i.test(current)) this.lastLogPaths.set(mac, current);
        } catch (error) {
          console.warn('DEBUG_LOG_PATH failed', error);
        }
      }
      if (this.binDataEnabled) {
        try {
          await profile.setParam('DEBUG_BLE_DATA_PATH', this.lastDataPaths.get(mac) ?? 'True');
          const current = await profile.getParam('DEBUG_BLE_DATA_PATH');
          if (current && !/^error/i.test(current)) this.lastDataPaths.set(mac, current);
        } catch (error) {
          console.warn('DEBUG_BLE_DATA_PATH failed', error);
        }
      }
      if (this.restoreParamsMacs.delete(mac)) {
        await this.restoreSavedParams(mac, 0, autoRecovery, generation);
      } else {
        await this.refreshParamStates(st, autoRecovery, generation);
      }
      try {
        st.power = await profile.getBatteryLevel();
      } catch (error) {
        console.warn('getBatteryLevel failed', error);
      }
      if (st.flowGeneration !== generation || profile.deviceState !== DeviceStateEx.Ready) return;
      this.ensureWorkletBinding(st);
      st.flowStarted = true;
      this.autoRecoveryMacs.delete(mac);
      this.updateConnectedStatus(st);
    } catch (error) {
      this.status = `Error: ${String(error)}`;
    } finally {
      const interrupted = st.flowGeneration !== generation;
      st.flowRunning = false;
      this.notify();
      if (interrupted && !st.isReplay && profile.deviceState === DeviceStateEx.Ready) {
        void this.runReadyChainFromState(st);
      }
    }
  }

  private updateConnectedStatus(st: DeviceState): void {
    if (this.selectedMac !== st.profile.BLEDevice.Address) return;
    const summary = st.info ? this.streamSummary(st.info) : '';
    this.status = `Connected: ${st.profile.BLEDevice.Name}${summary ? ` | ${summary}` : ''}`;
  }

  private streamSummary(info: DeviceInfo): string {
    const parts: string[] = [];
    const add = (label: string, channels: number, rate: number) => {
      if (channels > 0) parts.push(`${label} ${channels}ch @ ${rate}Hz`);
    };
    add('EEG', info.EegChannelCount, info.EegSampleRate);
    add('ECG', info.EcgChannelCount, info.EcgSampleRate);
    add('EMG', info.EmgChannelCount, info.EmgSampleRate);
    add('BRTH', info.BrthChannelCount, info.BrthSampleRate);
    add('PPG', info.PpgChannelCount, info.PpgSampleRate);
    add('SpO2', info.Spo2ChannelCount, info.Spo2SampleRate);
    add('ACC', info.AccChannelCount, info.AccSampleRate);
    add('GYRO', info.GyroChannelCount, info.GyroSampleRate);
    return parts.join(' | ');
  }

  private onData = (st: DeviceState, data: SensorData): void => {
    const type = data.dataType as DataType;
    st.batches += 1;
    st.totalSamples += data.sampleCount;
    st.expectedRates.set(type, data.sampleRate);
    if (data.sampleCount > 0 && data.channelCount > 0) {
      const fresh = data.isDataValid();
      let valid = 0;
      if (fresh && data.isChannelEnabled(0)) {
        for (let i = 0; i < data.sampleCount; ++i) if (!data.isLost(0, i)) ++valid;
      }
      this.noteRateSamples(st, type, data.startTimeStamp, valid);
    }
    st.lostCounts.set(type, data.lostPackageCount);
    if (data.startTimeSec > 0) st.streamStartTimeSecs.set(type, data.startTimeSec);
    if (data.delay > 0) st.streamDelayMs = data.delay;
    const last = data.sampleCount - 1;
    if (last < 0 || data.channelCount <= 0) return;
    if (type === DataType.NTF_EMG_GEST) {
      if (data.isDataValid(0, last)) {
        st.gesture = {
          gesture: data.getData(0, last), rawGesture: '-',
          possibility: data.getImpedance(0, last), strength: data.getSaturation(0, last),
        };
      }
      return;
    }
    if (type === DataType.NTF_IMPEDANCE) {
      for (let channel = 0; channel < data.channelCount; ++channel) {
        if (data.isDataValid(channel, last)) st.impedance[channel] = data.getImpedance(channel, last);
      }
      return;
    }
    if (type === DataType.NTF_IMU) {
      const split: Array<[DataType, number, number]> = [
        [DataType.NTF_ACC, 0, 3], [DataType.NTF_GYRO, 3, 6],
        [DataType.NTF_EULER, 6, 9], [DataType.NTF_QUAT, 9, 13],
      ];
      const fresh = data.isDataValid();
      for (const [splitType, from, to] of split) {
        if (data.channelCount < to) continue;
        let valid = 0;
        if (fresh && data.isChannelEnabled(from)) {
          for (let i = 0; i < data.sampleCount; ++i) if (!data.isLost(from, i)) ++valid;
        }
        if (valid > 0) this.noteRateSamples(st, splitType, data.startTimeStamp, valid);
        st.expectedRates.set(splitType, data.sampleRate);
        if (data.startTimeSec > 0) st.streamStartTimeSecs.set(splitType, data.startTimeSec);
        if (this.isWorkletsBound(st)) continue;
        const values: Float32Array[] = [];
        for (let channel = from; channel < to; ++channel) values.push(data.getChannelData(channel));
        this.appendToBuffer(st, splitType, values, data.sampleRate);
      }
      return;
    }
    if (this.isWorkletsBound(st)) {
      if (IMPEDANCE_TYPES.has(type)) {
        for (let channel = 0; channel < data.channelCount; ++channel) {
          if (data.isDataValid(channel, last)) st.impedance[channel] = data.getImpedance(channel, last);
        }
      }
      return;
    }
    const filter = LIVE_FILTER_TYPES.has(type);
    const values: Float32Array[] = [];
    for (let channel = 0; channel < data.channelCount; ++channel) {
      const channelValues = data.getChannelData(channel);
      if (filter) st.liveFilter.apply(type, channel, channelValues, data.sampleRate);
      values.push(channelValues);
    }
    this.appendToBuffer(st, type, values, data.sampleRate);
    if (IMPEDANCE_TYPES.has(type)) {
      for (let channel = 0; channel < data.channelCount; ++channel) {
        if (data.isDataValid(channel, last)) st.impedance[channel] = data.getImpedance(channel, last);
      }
    }
  };

  private appendToBuffer(
    st: DeviceState,
    type: DataType,
    channelValues: ReadonlyArray<ArrayLike<number>>,
    sampleRate: number,
  ): void {
    let buffer = st.buffers.get(type);
    if (!buffer) {
      buffer = new RingBuffer();
      st.buffers.set(type, buffer);
    }
    buffer.ensureSize(channelValues.length, sampleRate * (BIO_TYPES.has(type) ? 1 : 5));
    buffer.appendBatch(channelValues);
  }

  private noteRateSamples(st: DeviceState, type: DataType, sessionTag: number, valid: number): void {
    if (valid <= 0) return;
    const now = Date.now();
    if (st.rateStreamTags.get(type) !== sessionTag) {
      st.rateStreamTags.set(type, sessionTag);
      st.rateTotalCounts.set(type, 0);
      st.rateStreamStartMs.set(type, now);
    }
    st.rateTotalCounts.set(type, (st.rateTotalCounts.get(type) ?? 0) + valid);
    st.rateLastDataMs = now;
  }

  private settleStats(): void {
    const now = Date.now();
    if (this.scanning) this.refreshDeviceList(now, true);
    this.deviceStates.forEach((st) => {
      if (st.rateLastDataMs > 0 && now - st.rateLastDataMs > 2000) {
        st.actualRates.clear();
        st.rateTotalCounts.clear();
        st.rateStreamStartMs.clear();
        st.rateStreamTags.clear();
        st.rateLastDataMs = 0;
        return;
      }
      st.actualRates.clear();
      st.rateTotalCounts.forEach((total, type) => {
        const start = st.rateStreamStartMs.get(type) ?? now;
        st.actualRates.set(type, total / Math.max((now - start) / 1000, 0.001));
      });
    });
    this.notifyStats();
  }

  clearBuffers(st: DeviceState): void {
    st.buffers.forEach((buffer) => buffer.clear());
    st.impedance = [];
  }

  private recordSavedParam(mac: string, key: string, value: string, result: string): void {
    if (!mac || /^error/i.test(result)) return;
    const saved = this.savedParamsByMac.get(mac) ?? [];
    const existing = saved.find((item) => item[0] === key);
    if (existing) existing[1] = value;
    else saved.push([key, value]);
    this.savedParamsByMac.set(mac, saved);
  }

  private async restoreSavedParams(
    mac: string,
    index: number,
    autoRecovery: boolean,
    generation: number,
  ): Promise<void> {
    const st = this.deviceStates.get(mac);
    const saved = this.savedParamsByMac.get(mac) ?? [];
    if (!st || !(await this.shouldContinueAutoRecovery(st, autoRecovery, generation))) return;
    if (index >= saved.length) {
      await this.refreshParamStates(st, autoRecovery, generation);
      this.clearBuffers(st);
      return;
    }
    const [key, value] = saved[index]!;
    try {
      const result = await st.profile.setParam(key, value);
      this.appLog(`App: restore setParam(${key}, ${value}) -> ${result}`, 'I', st);
    } catch (error) {
      this.appLog(`App: restore setParam(${key}, ${value}) -> ${String(error)}`, 'W', st);
    }
    await this.restoreSavedParams(mac, index + 1, autoRecovery, generation);
  }

  private async refreshParamStates(
    st: DeviceState,
    autoRecovery = this.autoRecoveryMacs.has(st.profile.BLEDevice.Address),
    generation = st.flowGeneration,
    selectionGeneration?: number,
  ): Promise<void> {
    if (!(await this.shouldContinueAutoRecovery(st, autoRecovery, generation))) return;
    const { profile } = st;
    const mac = profile.BLEDevice.Address;
    const canPublish = () => this.selectedMac === mac
      && (selectionGeneration === undefined || this.selectionGeneration === selectionGeneration);
    try {
      const result = await profile.getParam('NTF');
      if (canPublish()) this.parseParamStates(result, NTF_KEYS, this.ntfStates);
    } catch (error) {
      console.warn('getParam(NTF) failed', error);
    }
    try {
      const result = await profile.getParam('FILTER');
      if (canPublish()) this.parseParamStates(result, FILTER_KEYS, this.filterStates);
    } catch (error) {
      console.warn('getParam(FILTER) failed', error);
    }
    for (const control of SAMPLE_RATE_CONTROLS) {
      try {
        const list = await profile.getParam(`${control.key}_LIST`);
        if (canPublish()) {
          this.sampleRateOptions[control.key] = !list || /^error/i.test(list)
            ? []
            : list.split('|').map((item) => parseInt(item, 10)).filter((rate) => !Number.isNaN(rate));
        }
      } catch {
        if (canPublish()) this.sampleRateOptions[control.key] = [];
      }
      try {
        const rate = parseInt(await profile.getParam(control.key), 10);
        if (canPublish()) this.sampleRateCurrent[control.key] = Number.isNaN(rate) ? 0 : rate;
      } catch {
        if (canPublish()) this.sampleRateCurrent[control.key] = 0;
      }
    }
  }

  private resetSelectionParamStates(): void {
    for (const key of NTF_KEYS) this.ntfStates[key] = key !== 'NTF_GEST';
    for (const key of FILTER_KEYS) this.filterStates[key] = false;
    this.resetSampleRateStates();
  }

  private resetSampleRateStates(): void {
    for (const control of SAMPLE_RATE_CONTROLS) {
      this.sampleRateOptions[control.key] = [];
      this.sampleRateCurrent[control.key] = 0;
    }
  }

  private seedSampleRateCurrent(info: DeviceInfo, mac?: string): void {
    if (mac && this.selectedMac !== mac) return;
    const seeds: Array<[string, number]> = [
      ['EEG_SAMPLE_RATE', info.EegSampleRate], ['EMG_SAMPLE_RATE', info.EmgSampleRate],
      ['IMU_SAMPLE_RATE', info.AccSampleRate], ['PPG_SAMPLE_RATE', info.PpgSampleRate],
    ];
    for (const [key, rate] of seeds) if (rate > 0) this.sampleRateCurrent[key] = rate;
  }

  private parseParamStates(text: string, keys: string[], states: Record<string, boolean>): void {
    if (!text || /^error/i.test(text)) return;
    const items = text.split('|');
    const parsed = new Map<string, string>();
    for (let i = 0; i + 1 < items.length; i += 2) parsed.set(items[i]!, items[i + 1]!);
    for (const key of keys) {
      const value = parsed.get(key);
      if (value !== undefined) states[key] = value.toUpperCase() === 'ON';
    }
  }

  setNtfEnabled = async (key: string, enabled: boolean): Promise<void> => {
    const st = this.getActiveState();
    if (!st || !st.profile.isReady) return;
    const mac = st.profile.BLEDevice.Address;
    const selectionGeneration = this.selectionGeneration;
    const value = enabled ? 'ON' : 'OFF';
    try {
      const result = await st.profile.setParam(key, value);
      this.appLog(`User: setParam(${key}, ${value}) -> ${result}`);
      this.recordSavedParam(mac, key, value, result);
      if (this.selectedMac === mac && this.selectionGeneration === selectionGeneration) {
        this.ntfStates[key] = enabled;
      }
      await this.refreshParamStates(st, this.autoRecoveryMacs.has(mac), st.flowGeneration, selectionGeneration);
      this.clearBuffers(st);
      this.status = `${key}: ${enabled ? 'ON' : 'OFF'}`;
    } catch (error) {
      this.appLog(`User: setParam(${key}, ${value}) -> ${String(error)}`);
      this.status = `Error: ${key} failed`;
    }
    this.notify();
  };

  setSampleRate = async (key: string, rate: number): Promise<void> => {
    const st = this.getActiveState();
    if (!st || !st.profile.isReady) return;
    const mac = st.profile.BLEDevice.Address;
    const selectionGeneration = this.selectionGeneration;
    try {
      const result = await st.profile.setParam(key, String(rate));
      this.appLog(`User: setParam(${key}, ${rate}) -> ${result}`);
      this.recordSavedParam(mac, key, String(rate), result);
      if (this.selectedMac === mac && this.selectionGeneration === selectionGeneration) {
        this.sampleRateCurrent[key] = rate;
      }
      await this.refreshParamStates(st, this.autoRecoveryMacs.has(mac), st.flowGeneration, selectionGeneration);
      this.clearBuffers(st);
      this.status = `setParam ${key}=${rate} -> ${result}`;
    } catch (error) {
      this.appLog(`User: setParam(${key}, ${rate}) -> ${String(error)}`);
      this.status = `Error: ${key} failed`;
    }
    this.notify();
  };

  setFilterEnabled = async (key: string, enabled: boolean): Promise<void> => {
    const st = this.getActiveState();
    if (!st || !st.profile.isReady) return;
    const mac = st.profile.BLEDevice.Address;
    const selectionGeneration = this.selectionGeneration;
    const value = enabled ? 'ON' : 'OFF';
    try {
      const result = await st.profile.setParam(key, value);
      this.appLog(`User: setParam(${key}, ${value}) -> ${result}`);
      this.recordSavedParam(mac, key, value, result);
      if (this.selectedMac === mac && this.selectionGeneration === selectionGeneration) {
        this.filterStates[key] = enabled;
      }
      await this.refreshParamStates(st, this.autoRecoveryMacs.has(mac), st.flowGeneration, selectionGeneration);
      this.clearBuffers(st);
      this.status = `${key}: ${enabled ? 'ON' : 'OFF'}`;
    } catch (error) {
      this.appLog(`User: setParam(${key}, ${value}) -> ${String(error)}`);
      this.status = `Error: ${key} failed`;
    }
    this.notify();
  };

  setLiveFilterBand = (index: number): void => {
    this.liveFilterBand = index;
    this.appLog(`User: live filter -> ${LiveFilter.bandLabels()[index] ?? 'Off'}`);
    this.deviceStates.forEach((st) => st.liveFilter.setBand(index));
    this.dspRuntimes.forEach((runtime) => dspSetBand(runtime, index));
    this.notify();
  };

  get autoReconnect(): boolean { return this._autoReconnect; }
  set autoReconnect(enabled: boolean) {
    this.appLog(`User: auto reconnect ${enabled ? 'ON' : 'OFF'}`);
    this._autoReconnect = enabled;
    SensorController.Instance.getSensors().forEach((profile) => { profile.autoReconnect = enabled; });
    this.notify();
  }

  setBinDataEnabled = async (enabled: boolean): Promise<void> => {
    this.binDataEnabled = enabled;
    this.appLog(`User: data debug log ${enabled ? 'ON' : 'OFF'}`);
    const value = enabled ? 'True' : 'False';
    await Promise.all([...this.deviceStates.values()]
      .filter((st) => st.profile.isReady && st.profile.hasInited)
      .map(async (st) => {
        try {
          const result = await st.profile.setParam('DEBUG_BLE_DATA_PATH', value);
          st.profile.log(`App: setParam(DEBUG_BLE_DATA_PATH, ${value}) -> ${result}`);
        } catch (error) {
          st.profile.log(`App: setParam(DEBUG_BLE_DATA_PATH, ${value}) -> ${String(error)}`);
        }
      }));
    this.notify();
  };

  setDebugLogEnabled = async (enabled: boolean): Promise<void> => {
    this.debugLogEnabled = enabled;
    this.appLog(`User: SDK debug log ${enabled ? 'ON' : 'OFF'}`);
    await this.applyDebugLog(enabled);
  };

  setDebugDongleEnabled = async (enabled: boolean): Promise<void> => {
    this.debugDongleEnabled = enabled;
    const value = enabled ? 'True' : 'False';
    this.appLog(`User: dongle debug ${enabled ? 'ON' : 'OFF'}`);
    try {
      const result = await SensorController.Instance.setParam('BLE_TRACE_ENABLED', value);
      this.appLog(`App: setParam(BLE_TRACE_ENABLED, ${value}) -> ${result}`);
    } catch (error) {
      this.appLog(`App: setParam(BLE_TRACE_ENABLED, ${value}) -> ${String(error)}`);
    }
    this.notify();
  };

  setTranslateImu = async (enabled: boolean): Promise<void> => {
    this.translateImu = enabled;
    const value = enabled ? 'True' : 'False';
    this.appLog(`User: translate IMU ${value}`);
    try {
      const result = await SensorController.Instance.setParam('TRANSLATE_IMU', value);
      this.appLog(`App: setParam(TRANSLATE_IMU, ${value}) -> ${result}`);
    } catch (error) {
      this.appLog(`App: setParam(TRANSLATE_IMU, ${value}) -> ${String(error)}`);
    }
    this.notify();
  };

  private applyDebugLog = async (enabled: boolean): Promise<void> => {
    try {
      if (enabled) await this.applyLogPath();
      else await SensorController.Instance.setParam('LOG_PATH', 'False');
      await SensorController.Instance.setParam('DEBUG_ENABLED', enabled ? 'True' : 'False');
    } catch (error) {
      console.warn('applyDebugLog failed', error);
    }
    const value = enabled ? 'True' : 'False';
    await Promise.all([...this.deviceStates.values()]
      .filter((st) => st.profile.isReady && st.profile.hasInited)
      .map(async (st) => {
        try {
          const result = await st.profile.setParam('DEBUG_LOG_PATH', value);
          st.profile.log(`App: setParam(DEBUG_LOG_PATH, ${value}) -> ${result}`);
        } catch (error) {
          st.profile.log(`App: setParam(DEBUG_LOG_PATH, ${value}) -> ${String(error)}`);
        }
      }));
    this.notify();
  };

  private async applyLogPath(): Promise<void> {
    try {
      await SensorController.Instance.setParam('LOG_PATH', 'True');
      const root = await SensorController.Instance.getParam('LOG_PATH');
      const version = (await this.sdkVersionPromise).replace(/\./g, '_');
      if (root && !/^error/i.test(root) && root !== 'True' && root !== 'False') {
        this.sessionLogDir = `${root.replace(/[\\/]+$/, '')}/${logDirStamp()}_${version}`;
        await SensorController.Instance.setParam('LOG_PATH', this.sessionLogDir);
      }
    } catch (error) {
      console.warn('setParam(LOG_PATH) failed', error);
    }
  }

  multiStart = async (): Promise<void> => {
    const states = [...this.deviceStates.values()].filter(
      (st) => !st.isReplay && st.profile.isReady && st.profile.hasInited,
    );
    if (states.length === 0) {
      this.appLog('User: multi start rejected (no connected device)', 'W');
      this.status = 'No connected device to sync-start';
      this.notify();
      return;
    }
    this.appLog(`User: multi start on ${states.length} device(s)`);
    try {
      const sensors = states.map((st) => st.profile);
      const transferring = sensors.filter((profile) => profile.isDataTransfering);
      if (transferring.length > 0) {
        const results = await SensorController.Instance.multiStopDataNotification(transferring, 10000);
        const failed = results.filter((result) => !result.ok);
        if (failed.length > 0) {
          this.status = `Multi stop failed on: ${failed.map((result) => result.mac).join(', ')}`;
          this.notify();
          return;
        }
      }
      this.reportMultiResult('start', 'started', await SensorController.Instance.multiStartDataNotification(sensors));
    } catch (error) {
      this.status = `Error: ${String(error)}`;
    }
    this.notify();
  };

  multiStop = async (): Promise<void> => {
    const sensors = [...this.deviceStates.values()]
      .filter((st) => !st.isReplay && st.profile.isDataTransfering)
      .map((st) => st.profile);
    if (sensors.length === 0) {
      this.appLog('User: multi stop rejected (no streaming device)', 'W');
      this.status = 'No streaming device to sync-stop';
      this.notify();
      return;
    }
    this.appLog(`User: multi stop on ${sensors.length} device(s)`);
    try {
      this.reportMultiResult('stop', 'stopped', await SensorController.Instance.multiStopDataNotification(sensors, 10000));
    } catch (error) {
      this.status = `Error: ${String(error)}`;
    }
    this.notify();
  };

  private reportMultiResult(action: string, past: string, results: MultiDeviceResult[]): void {
    const failed = results.filter((result) => !result.ok);
    for (const result of failed) {
      this.appLog(`App: multi ${action} failed[${result.mac}]: ${result.error}`, 'W', this.deviceStates.get(result.mac));
    }
    if (failed.length === 0) {
      this.appLog(`App: multi ${action} OK: ${results.length} device(s) ${past}`);
      this.status = `Multi ${action}: ${results.length} device(s) ${past}`;
    } else {
      this.status = `Multi ${action} failed on: ${failed.map((result) => result.mac).join(', ')}`;
    }
  }

  replayActive(): boolean { return this.replayMac !== undefined || this.replayMacs.length > 0; }

  hasRealDeviceConnected(): boolean {
    return [...this.deviceStates.values()].some((st) => !st.isReplay && st.profile.isReady);
  }

  isDisplayReady(st: DeviceState | undefined): st is DeviceState {
    return !!st && (st.profile.isReady || (st.isReplay && st.info !== undefined));
  }

  pickAndReplayBin = async (): Promise<void> => {
    const path = this.binPathInput.trim() || window.prompt('Bin file path on the sidecar computer', '')?.trim();
    if (!path) return;
    this.binPathInput = path;
    await this.startSingleReplay(path);
  };

  startSingleReplay = async (path: string): Promise<void> => {
    if (this.replayActive()) {
      this.status = 'Stop the running replay first';
      this.notify();
      return;
    }
    if (this.hasRealDeviceConnected()) {
      this.status = 'Disconnect the real device before replay';
      this.notify();
      return;
    }
    this.appLog(`User: replay bin file: ${path}`);
    try {
      const info = await SensorController.Instance.getBinFileInfo(path);
      if (!info.Valid) {
        this.appLog(`App: invalid bin file (no config record): ${path}`, 'W');
        this.status = 'Invalid bin file';
        this.notify();
        return;
      }
      const mac = info.Mac;
      const profile = SensorController.Instance.requireSensor({
        Name: info.DeviceName || 'Replay', Address: mac, RSSI: 0,
      });
      const st = this.ensureState(mac, profile);
      st.isReplay = true;
      st.info = info.DeviceInfo;
      st.flowStarted = true;
      this.attachProfileCallbacks(st);
      this.seedSampleRateCurrent(info.DeviceInfo, mac);
      if (this.scanning) await this.stopScanning();
      this.ensureWorkletBinding(st);
      const ok = await SensorController.Instance.replayBinFile(path, mac, true, CMD_TIMEOUT_MS);
      if (ok) {
        this.replayMac = mac;
        this.replayFiles.set(mac, path);
        this.replayPaused = false;
        this.selectDevice(mac);
        this.ensureWorkletBinding(st);
        this.refreshDeviceList(Date.now(), true);
        this.status = `Replaying: ${info.DeviceName || mac}`;
      } else {
        this.status = 'Replay start failed';
      }
    } catch (error) {
      this.status = `Error: ${String(error)}`;
    }
    this.notify();
  };

  toggleDebugReplayLoop = (): void => {
    this.debugReplayLoop = !this.debugReplayLoop;
    this.appLog(`User: debug replay loop ${this.debugReplayLoop ? 'ON' : 'OFF'}`);
    this.notify();
  };

  debugReplayLatestBin = async (): Promise<void> => {
    if (!this.binPathInput.trim()) {
      this.status = 'Enter a bin path first';
      this.notify();
      return;
    }
    await this.startSingleReplay(this.binPathInput.trim());
  };

  pickAndMultiReplayBins = async (): Promise<void> => {
    const text = this.multiBinPathsInput.trim()
      || window.prompt('Bin paths on the sidecar computer, separated by semicolons', '')?.trim();
    if (!text) return;
    this.multiBinPathsInput = text;
    const paths = text.split(';').map((path) => path.trim()).filter(Boolean);
    await this.startGroupReplay(paths);
  };

  startGroupReplay = async (paths: string[]): Promise<void> => {
    if (paths.length < 2) {
      this.status = 'Multi replay needs 2+ bin files';
      this.notify();
      return;
    }
    if (this.replayActive()) {
      this.status = 'Stop the running replay first';
      this.notify();
      return;
    }
    if (this.hasRealDeviceConnected()) {
      this.status = 'Disconnect the real device before replay';
      this.notify();
      return;
    }
    this.appLog(`User: replay ${paths.length} bin files: ${paths.join('; ')}`);
    try {
      const items: Array<{ path: string; deviceMac: string; profile: SensorProfile }> = [];
      for (const path of paths) {
        const info = await SensorController.Instance.getBinFileInfo(path);
        if (!info.Valid) this.appLog(`App: invalid bin file (no config record): ${path}`, 'W');
        const mac = info.Valid && info.Mac ? info.Mac : 'REPLAY';
        const profile = SensorController.Instance.requireSensor({
          Name: (info.Valid && info.DeviceName) || 'Replay', Address: mac, RSSI: 0,
        });
        const st = this.ensureState(mac, profile);
        st.isReplay = true;
        if (info.Valid) st.info = info.DeviceInfo;
        st.flowStarted = true;
        this.attachProfileCallbacks(st);
        items.push({ path, deviceMac: mac, profile });
      }
      if (this.scanning) await this.stopScanning();
      for (const item of items) this.ensureWorkletBinding(this.deviceStates.get(item.deviceMac)!);
      const startedProfiles = await SensorController.Instance.multiReplayBinFile(
        items.map((item) => item.path), items.map((item) => item.profile), true, CMD_TIMEOUT_MS,
      );
      const started: string[] = [];
      items.forEach((item, index) => {
        if (startedProfiles[index]) {
          this.replayFiles.set(item.deviceMac, item.path);
          started.push(item.deviceMac);
        } else {
          this.appLog(`App: replay failed to start: ${item.path} (mac=${item.deviceMac})`, 'W');
          const failed = this.deviceStates.get(item.deviceMac);
          if (failed) this.teardownState(failed);
        }
      });
      if (started.length === 0) {
        this.status = 'Replay failed: multiReplayBinFile started no member';
        this.notify();
        return;
      }
      this.replayMacs = started;
      this.replayPaused = false;
      if (started[0]) this.selectDevice(started[0]);
      this.refreshDeviceList(Date.now(), true);
      const selectedInfo = started[0] ? this.deviceStates.get(started[0])?.info : undefined;
      if (selectedInfo) this.seedSampleRateCurrent(selectedInfo, started[0]);
      started.forEach((mac) => {
        const st = this.deviceStates.get(mac);
        if (st) this.ensureWorkletBinding(st);
      });
      this.status = `Replaying ${started.length} bin files (realtime=true) ...`;
    } catch (error) {
      this.status = `Error: ${String(error)}`;
    }
    this.notify();
  };

  pauseResumeReplay = async (): Promise<void> => {
    const mac = this.replayMac ?? this.replayMacs[0];
    if (!mac) return;
    const action = this.replayPaused ? 'resume' : 'pause';
    try {
      const result = this.replayPaused
        ? await SensorController.Instance.resumeBinReplay(mac)
        : await SensorController.Instance.pauseBinReplay(mac);
      this.appLog(`User: ${action} replay -> ${result}`, result === 'OK' ? 'I' : 'W', this.deviceStates.get(mac));
      this.status = this.replayPaused ? 'Replay resumed' : 'Replay paused';
      this.replayPaused = !this.replayPaused;
    } catch (error) {
      this.status = `Error: ${String(error)}`;
    }
    this.notify();
  };

  stopReplay = async (): Promise<void> => {
    const macs = [...(this.replayMac ? [this.replayMac] : []), ...this.replayMacs];
    if (macs.length === 0) return;
    macs.forEach((mac) => this.replayStopRequestedMacs.add(mac));
    this.replayMac = undefined;
    this.replayMacs = [];
    this.replayPaused = false;
    for (const mac of macs) {
      try {
        const result = await SensorController.Instance.stopBinReplay(mac);
        this.appLog(`User: stop replay -> ${result}`, result === 'OK' ? 'I' : 'W', this.deviceStates.get(mac));
        if (result !== 'OK') this.replayStopRequestedMacs.delete(mac);
      } catch (error) {
        this.replayStopRequestedMacs.delete(mac);
        this.status = `Error: ${String(error)}`;
      }
      this.replayFiles.delete(mac);
      const st = this.deviceStates.get(mac);
      if (st) this.teardownState(st);
    }
    this.status = 'Replay stopped';
    this.notify();
  };

  pickAndAnalyzeBin = async (): Promise<void> => {
    const path = this.binPathInput.trim() || window.prompt('Bin file path on the sidecar computer', '')?.trim();
    if (!path) return;
    this.binPathInput = path;
    await this.analyzeBinAtPath(path);
  };

  analyzeBinAtPath = async (path: string): Promise<void> => {
    if (this.hasRealDeviceConnected()) {
      this.status = 'Disconnect the real device before analyze';
      this.notify();
      return;
    }
    this.appLog(`User: analyze bin file: ${path}`);
    try {
      this.status = 'Analyzing bin ...';
      this.notify();
      const csvPath = await SensorController.Instance.parseBinToCsv(path, path.replace(/\.bin$/i, '') + '.csv');
      this.appLog(`App: CSV saved: ${csvPath}`);
      this.status = `CSV: ${csvPath}`;
    } catch (error) {
      this.appLog(`App: analyze failed: ${String(error)}`, 'E');
      this.status = `Error: ${String(error)}`;
    }
    this.notify();
  };

  getActiveState(): DeviceState | undefined {
    if (this.selectedMac) {
      const st = this.deviceStates.get(this.selectedMac);
      if (st) return st;
    }
    for (const st of this.deviceStates.values()) if (st.profile.isReady) return st;
    return undefined;
  }

  get rateText(): string {
    const st = this.getActiveState();
    if (!st) return 'Actual: --';
    const parts: string[] = [];
    const p = (n: number, width = 2) => String(n).padStart(width, '0');
    for (const [type, label] of RATE_LABEL_ORDER) {
      const expected = st.expectedRates.get(type);
      if (expected === undefined) continue;
      const actual = st.actualRates.get(type) ?? 0;
      let entry = `${label} ${actual.toFixed(1)} / ${expected}Hz`;
      const startSec = st.streamStartTimeSecs.get(type) ?? 0;
      if (startSec > 0) {
        const date = new Date(startSec * 1000);
        entry += ` (start ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)})`;
      }
      parts.push(entry);
    }
    if (st.streamDelayMs > 0) parts.push(`delay ${st.streamDelayMs}ms`);
    return parts.length > 0 ? `Actual: ${parts.join(' | ')}` : 'Actual: --';
  }

  get lostText(): string {
    const st = this.getActiveState();
    if (!st) return 'Packet Loss: --';
    const parts: string[] = [];
    for (const [type, label] of RATE_LABEL_ORDER) {
      const lost = st.lostCounts.get(type);
      if (lost !== undefined) parts.push(`${label} ${lost}`);
    }
    return parts.length > 0 ? `Packet Loss: ${parts.join(' | ')}` : 'Packet Loss: --';
  }
}
