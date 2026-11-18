import type { SensorData } from '../demo/sidecarSdk';
import type { SpectrumResult } from './SpectrumCompute';

export interface WaveformSnapshot {
  type: number;
  channels: Float32Array[];
}

export interface SpectrumSnapshot {
  type: number;
  rate: number;
  result: SpectrumResult;
}

export interface DspExtras {
  impedance: Array<[number, number]>;
  gesture?: { gesture: number; possibility: number; strength: number };
}

export interface DspHandlers {
  onWaveform: (
    mac: string,
    entries: WaveformSnapshot[],
    batches: number,
    samples: Array<[number, number]>,
    rates: Array<[number, number]>,
    extras: DspExtras,
  ) => void;
  onSpectrum: (mac: string, entries: SpectrumSnapshot[]) => void;
  onError?: () => void;
}

export interface DspRuntimeHandle {
  runtime: Worker;
  onData: (dataList: SensorData[]) => void;
  setCloneData: (enabled: boolean) => void;
}

export function startDspRuntime(
  handlers: DspHandlers,
  mac: string,
  initialBand: number,
  initialCloneData = false,
): DspRuntimeHandle {
  const runtime = new Worker(new URL('./dsp.worker.ts', import.meta.url), {
    type: 'module', name: `sensor-dsp-${mac}`,
  });
  let cloneData = initialCloneData;
  runtime.onmessage = (event: MessageEvent) => {
    const message = event.data;
    if (message.type === 'waveform') {
      handlers.onWaveform(mac, message.entries, message.batches, message.samples, message.rates, {
        impedance: message.impedance,
        gesture: message.gesture,
      });
    } else if (message.type === 'spectrum') {
      handlers.onSpectrum(mac, message.entries);
    }
  };
  runtime.onerror = () => handlers.onError?.();
  runtime.postMessage({ type: 'band', value: initialBand });
  return {
    runtime,
    setCloneData: (enabled) => { cloneData = enabled; },
    onData: (dataList) => {
      const views = dataList.map((data) => {
        const view = data.nativeView(cloneData);
        if (!cloneData) {
          view.infoBuffer = view.infoBuffer instanceof ArrayBuffer
            ? view.infoBuffer.slice(0)
            : view.infoBuffer.slice();
        }
        return view;
      });
      const transfer = views.flatMap((view) => [view.infoBuffer, view.samplesBuffer])
        .map((buffer) => buffer instanceof ArrayBuffer ? buffer : buffer.buffer)
        .filter((buffer, index, all) => buffer instanceof ArrayBuffer && all.indexOf(buffer) === index);
      runtime.postMessage({ type: 'data', views }, transfer);
    },
  };
}

export function dspSetBand(runtime: Worker, band: number): void {
  runtime.postMessage({ type: 'band', value: band });
}

export function dspSetCloneData(handle: DspRuntimeHandle, enabled: boolean): void {
  handle.setCloneData(enabled);
}

export function dspSetActive(runtime: Worker, active: boolean): void {
  runtime.postMessage({ type: 'active', value: active });
}

export function dspReset(runtime: Worker): void {
  runtime.postMessage({ type: 'reset' });
}
