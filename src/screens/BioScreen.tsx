import { useEffect, useState } from 'react';
import { DataType } from '../demo/sidecarSdk';
import { DemoButton, DemoPlot, useDemoVersion } from '../components/common';
import SpectrumView from '../components/SpectrumView';
import WaveformView from '../components/WaveformView';
import { DemoController, SPECTRUM_UPDATE_INTERVAL_MS } from '../demo/DemoController';
import type { DeviceState } from '../demo/DemoController';
import { LiveFilter } from '../dsp/LiveFilter';
import { computeSpectrum } from '../dsp/SpectrumCompute';
import type { SpectrumResult } from '../dsp/SpectrumCompute';

const FILTER_BANDS = LiveFilter.bandLabels();

interface BioPlot {
  title: string;
  type: DataType;
  channel: number;
  spectrum: boolean;
  yRange?: [number, number];
}

function impedanceSide(impedance: number[], channel: number): { text: string; color: string } | undefined {
  const raw = impedance[channel];
  if (raw === undefined) return undefined;
  const kohm = raw / 1000;
  const color = kohm <= 500 ? '#4caf50' : kohm <= 999 ? '#ff9800' : '#f44336';
  return { text: `${kohm.toFixed(2)} KOhm`, color };
}

function BioPlots({ visible, controller, active, ready, impedanceOn, plots }: {
  visible: boolean;
  controller: DemoController;
  active?: DeviceState;
  ready: boolean;
  impedanceOn: boolean;
  plots: BioPlot[];
}) {
  const spectrumKey = plots.filter((plot) => plot.spectrum).map((plot) => `${plot.type}:${plot.channel}`).join('|');
  const [spectra, setSpectra] = useState<Record<string, SpectrumResult | null>>({});
  useEffect(() => {
    if (!visible || spectrumKey.length === 0) {
      setSpectra({});
      return;
    }
    const bindings = spectrumKey.split('|').map((entry) => entry.split(':').map(Number) as [number, number]);
    const tick = () => {
      const st = controller.getActiveState();
      if (!controller.isDisplayReady(st)) {
        setSpectra({});
        return;
      }
      const next: Record<string, SpectrumResult | null> = {};
      for (const [type, channel] of bindings) {
        const key = `${type}:${channel}`;
        if (controller.isWorkletsBound(st)) {
          const spectrum = controller.getSpectrumFor(st, type);
          const row = spectrum?.mags[channel];
          next[key] = spectrum && row ? { freqs: spectrum.freqs, mags: [row] } : null;
          continue;
        }
        const buffer = st.buffers.get(type);
        const rate = st.expectedRates.get(type) ?? 0;
        next[key] = !buffer || buffer.length < 16 || rate <= 0 || channel >= buffer.channelCount
          ? null : computeSpectrum([buffer.getChannel(channel)], rate);
      }
      setSpectra(next);
    };
    tick();
    const timer = setInterval(tick, SPECTRUM_UPDATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [visible, controller, spectrumKey, active?.profile]);

  return <DemoPlot visible={visible}>{() => (
    <div className="screen-scroll bio-plots">
      {plots.length === 0 ? <p className="plot-placeholder">No bio stream (connect a device first)</p> : plots.map((plot) => {
        const all = active ? controller.getDisplayChannels(active, plot.type) : [];
        const channels = plot.channel < all.length ? [all[plot.channel]!] : [new Float32Array(0)];
        const side = active && impedanceOn && plot.type !== DataType.NTF_ANGLE
          ? impedanceSide(active.impedance, plot.channel) : undefined;
        const waveform = (
          <WaveformView channels={channels} height={110} title={plot.title} yRange={plot.yRange}
            sideText={side?.text} sideTextColor={side?.color} />
        );
        if (!plot.spectrum) return <div key={`${plot.title}-${plot.channel}`}>{waveform}</div>;
        const spectrum = spectra[`${plot.type}:${plot.channel}`] ?? null;
        return (
          <div className="split-row" key={`${plot.title}-${plot.channel}`}>
            <SpectrumView freqs={spectrum?.freqs ?? []} mags={spectrum?.mags ?? []} labels={[plot.title]}
              colorIndex={plot.channel} height={110} placeholder={ready ? 'Waiting for data ...' : 'Not connected'} />
            {waveform}
          </div>
        );
      })}
    </div>
  )}</DemoPlot>;
}

export default function BioScreen({ visible }: { visible: boolean }) {
  const controller = DemoController.Instance;
  useDemoVersion(visible);
  const [page, setPage] = useState(0);
  const active = controller.getActiveState();
  const info = active?.info;
  const impedanceOn = (info?.ImpeChannelCount ?? 0) > 0 && (controller.ntfStates.NTF_IMPEDANCE ?? false);
  const ready = controller.isDisplayReady(active);
  let plots: BioPlot[] = [];
  let pages = 1;

  if (ready && active) {
    const hasAngle = (info?.AngleChannelCount ?? 0) > 0
      || controller.getDisplayChannelCount(active, DataType.NTF_ANGLE) > 0;
    const anglePlot: BioPlot = {
      title: 'Angle', type: DataType.NTF_ANGLE, channel: 0, spectrum: true, yRange: [0, 180],
    };
    if (info && info.PpgChannelCount > 0) {
      plots = [
        { title: 'fp1', type: DataType.NTF_EEG, channel: 0, spectrum: true },
        { title: 'fp2', type: DataType.NTF_EEG, channel: 1, spectrum: true },
        { title: 'red_led', type: DataType.NTF_PPG, channel: 0, spectrum: true },
        { title: 'ir_led', type: DataType.NTF_PPG, channel: 1, spectrum: true },
        { title: 'spo2', type: DataType.NTF_SPO2_HR, channel: 0, spectrum: false },
        { title: 'heart_rate', type: DataType.NTF_SPO2_HR, channel: 1, spectrum: false },
      ];
    } else if (info && info.EegChannelCount > 0) {
      const hasECG = info.EcgChannelCount > 0;
      const hasBRTH = info.BrthChannelCount > 0;
      const perPage = 8 - (hasECG ? 1 : 0) - (hasBRTH ? 1 : 0) - (hasAngle ? 1 : 0);
      pages = Math.max(1, Math.ceil(info.EegChannelCount / perPage));
      const currentPage = Math.min(page, pages - 1);
      const start = currentPage * perPage;
      for (let i = start; i < Math.min(start + perPage, info.EegChannelCount); ++i) {
        plots.push({ title: `EEG-${i + 1}`, type: DataType.NTF_EEG, channel: i, spectrum: true });
      }
      if (currentPage === pages - 1) {
        if (hasAngle) plots.push(anglePlot);
        if (hasECG) plots.push({ title: 'ECG', type: DataType.NTF_ECG, channel: 0, spectrum: true });
        if (hasBRTH) plots.push({ title: 'BRTH', type: DataType.NTF_BRTH, channel: 0, spectrum: false });
      }
    } else {
      const count = info?.EmgChannelCount ?? controller.getDisplayChannelCount(active, DataType.NTF_EMG_ADC);
      for (let i = 0; i < Math.min(hasAngle ? 7 : 8, count); ++i) {
        plots.push({ title: `EMG-${i + 1}`, type: DataType.NTF_EMG_ADC, channel: i, spectrum: true });
      }
      if (hasAngle) plots.push(anglePlot);
    }
  }

  const currentPage = Math.min(page, pages - 1);

  return (
    <div className="bio-screen">
      <h2>Live Filter (EMG/EEG/ECG/BRTH/PPG/SpO2)</h2>
      <div className="segmented" role="group" aria-label="Live Filter">
        {FILTER_BANDS.map((label, index) => (
          <button type="button" key={label} className={index === controller.liveFilterBand ? 'active' : ''}
            onClick={() => controller.setLiveFilterBand(index)}>{label}</button>
        ))}
      </div>
      {pages > 1 && (
        <div className="pager">
          <DemoButton title="Prev" disabled={currentPage <= 0} onPress={() => {
            const next = Math.max(0, currentPage - 1);
            setPage(next);
            controller.appLog(`User: prev page -> ${next}`, 'D');
          }} />
          <span>{`${currentPage + 1} / ${pages}`}</span>
          <DemoButton title="Next" disabled={currentPage >= pages - 1} onPress={() => {
            const next = Math.min(pages - 1, currentPage + 1);
            setPage(next);
            controller.appLog(`User: next page -> ${next}`, 'D');
          }} />
        </div>
      )}
      <BioPlots visible={visible} controller={controller} active={active} ready={ready}
        impedanceOn={impedanceOn} plots={plots} />
    </div>
  );
}
