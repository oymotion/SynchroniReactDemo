import { SensorData, DataType } from '../demo/sidecarSdk';
import type { NativeDataView } from '../demo/sidecarSdk';
import { LiveFilter } from './LiveFilter';
import { RingBuffer } from './RingBuffer';
import { computeSpectrum } from './SpectrumCompute';

const BIO_TYPES = new Set<number>([
  DataType.NTF_EMG_ADC, DataType.NTF_EEG, DataType.NTF_ECG, DataType.NTF_BRTH, DataType.NTF_ANGLE,
]);
const LIVE_FILTER_TYPES = new Set<number>([
  DataType.NTF_EMG_ADC, DataType.NTF_EEG, DataType.NTF_ECG, DataType.NTF_BRTH,
  DataType.NTF_PPG, DataType.NTF_SPO2_HR,
]);
const IMPEDANCE_TYPES = new Set<number>([
  DataType.NTF_EMG_ADC, DataType.NTF_EEG, DataType.NTF_ECG, DataType.NTF_BRTH,
]);
const IMU_SPLIT: Array<[DataType, number, number]> = [
  [DataType.NTF_ACC, 0, 3], [DataType.NTF_GYRO, 3, 6],
  [DataType.NTF_EULER, 6, 9], [DataType.NTF_QUAT, 9, 13],
];

type Gesture = { gesture: number; possibility: number; strength: number };
type Message =
  | { type: 'active'; value: boolean }
  | { type: 'band'; value: number }
  | { type: 'reset' }
  | { type: 'data'; views: NativeDataView[] };

const scope = self as unknown as Worker;
const rings = new Map<number, RingBuffer>();
const samples = new Map<number, number>();
const impedance = new Map<number, number>();
const filter = new LiveFilter();
let active = true;
let batches = 0;
let gesture: Gesture | undefined;

function reset(): void {
  rings.clear();
  samples.clear();
  impedance.clear();
  filter.reset();
  batches = 0;
  gesture = undefined;
}

function append(type: DataType, data: SensorData, from: number, to: number): void {
  const rate = data.sampleRate;
  const seconds = BIO_TYPES.has(type) ? 1 : 5;
  let ring = rings.get(type);
  if (!ring || ring.channelCount !== to - from || ring.length !== Math.max(1, Math.round(rate * seconds))) {
    ring = new RingBuffer();
    ring.ensureSize(to - from, rate * seconds);
    rings.set(type, ring);
  }
  const channels: Float32Array[] = [];
  for (let channel = from; channel < to; ++channel) {
    const values = data.getChannelData(channel);
    if (LIVE_FILTER_TYPES.has(type)) filter.apply(type, channel - from, values, rate);
    channels.push(values);
  }
  ring.appendBatch(channels);
}

function ingest(views: NativeDataView[]): void {
  if (!active) return;
  for (const view of views) {
    const data = new SensorData(view);
    if (!data.isDataValid()) continue;
    const type = data.dataType as DataType;
    const last = data.sampleCount - 1;
    if (type === DataType.NTF_EMG_GEST) {
      if (last >= 0 && data.isDataValid(0, last)) {
        gesture = {
          gesture: data.getData(0, last),
          possibility: data.getImpedance(0, last),
          strength: data.getSaturation(0, last),
        };
      }
      continue;
    }
    if (type === DataType.NTF_IMPEDANCE) {
      for (let channel = 0; channel < data.channelCount; ++channel) {
        if (data.isDataValid(channel, last)) impedance.set(channel, data.getImpedance(channel, last));
      }
      continue;
    }
    if (data.channelCount <= 0 || data.sampleCount <= 0 || data.sampleRate <= 0) continue;
    ++batches;
    samples.set(type, (samples.get(type) ?? 0) + data.sampleCount);
    if (type === DataType.NTF_IMU) {
      for (const [splitType, from, to] of IMU_SPLIT) {
        if (data.channelCount >= to) append(splitType, data, from, to);
      }
    } else {
      append(type, data, 0, data.channelCount);
    }
    if (IMPEDANCE_TYPES.has(type)) {
      for (let channel = 0; channel < data.channelCount; ++channel) {
        if (data.isDataValid(channel, last)) impedance.set(channel, data.getImpedance(channel, last));
      }
    }
  }
}

function transferable(values: Float32Array[]): ArrayBuffer[] {
  return values.map((value) => value.buffer as ArrayBuffer);
}

function emitWaveforms(): void {
  if (!active || rings.size === 0) return;
  const entries: Array<{ type: number; channels: Float32Array[] }> = [];
  const rates: Array<[number, number]> = [];
  const buffers: ArrayBuffer[] = [];
  rings.forEach((ring, type) => {
    const channels = ring.getAllChannels();
    entries.push({ type, channels });
    rates.push([type, ring.length / (BIO_TYPES.has(type) ? 1 : 5)]);
    buffers.push(...transferable(channels));
  });
  scope.postMessage({
    type: 'waveform', entries, batches, samples: [...samples], rates,
    impedance: [...impedance], gesture,
  }, buffers);
}

function emitSpectra(): void {
  if (!active || rings.size === 0) return;
  const entries: Array<{ type: number; rate: number; result: ReturnType<typeof computeSpectrum> }> = [];
  const buffers: ArrayBuffer[] = [];
  rings.forEach((ring, type) => {
    const rate = ring.length / (BIO_TYPES.has(type) ? 1 : 5);
    const result = computeSpectrum(ring.getAllChannels(), rate);
    if (!result) return;
    entries.push({ type, rate, result });
    buffers.push(result.freqs.buffer as ArrayBuffer, ...transferable(result.mags));
  });
  if (entries.length > 0) scope.postMessage({ type: 'spectrum', entries }, buffers);
}

scope.onmessage = (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === 'data') ingest(message.views);
  else if (message.type === 'active') { active = message.value; reset(); }
  else if (message.type === 'band') filter.setBand(message.value);
  else if (message.type === 'reset') reset();
};

setInterval(emitWaveforms, 50);
setInterval(emitSpectra, 200);
