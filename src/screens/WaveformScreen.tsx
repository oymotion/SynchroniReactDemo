import { useEffect, useState } from 'react';
import { DataType } from '../demo/sidecarSdk';
import { DemoPlot, useDemoVersion } from '../components/common';
import CubeView from '../components/CubeView';
import SpectrumView from '../components/SpectrumView';
import WaveformView from '../components/WaveformView';
import { DemoController, SPECTRUM_UPDATE_INTERVAL_MS } from '../demo/DemoController';
import type { DeviceState } from '../demo/DemoController';
import { computeSpectrum } from '../dsp/SpectrumCompute';
import type { SpectrumResult } from '../dsp/SpectrumCompute';

const OPTIONS = [
  { label: 'Acceleration', type: DataType.NTF_ACC, yRange: [-8, 8] as [number, number], channels: ['ACC-X', 'ACC-Y', 'ACC-Z'] },
  { label: 'Gyroscope', type: DataType.NTF_GYRO, yRange: [-2000, 2000] as [number, number], channels: ['GYRO-X', 'GYRO-Y', 'GYRO-Z'] },
  { label: 'Quaternion', type: DataType.NTF_QUAT, yRange: [-1, 1] as [number, number], channels: ['W', 'X', 'Y', 'Z'] },
  { label: 'Euler Angle', type: DataType.NTF_EULER, yRange: [-180, 180] as [number, number], channels: ['Pitch(Y)', 'Roll(X)', 'Yaw(Z)'] },
];

function ImuSpectrum({ visible, controller, active, ready, option }: {
  visible: boolean;
  controller: DemoController;
  active?: DeviceState;
  ready: boolean;
  option: (typeof OPTIONS)[number];
}) {
  const [spectrum, setSpectrum] = useState<SpectrumResult | null>(null);
  useEffect(() => {
    if (!visible) return;
    const tick = () => {
      const st = controller.getActiveState();
      if (!controller.isDisplayReady(st)) {
        setSpectrum(null);
        return;
      }
      if (controller.isWorkletsBound(st)) {
        setSpectrum(controller.getSpectrumFor(st, option.type));
        return;
      }
      const buffer = st.buffers.get(option.type);
      const rate = st.expectedRates.get(option.type) ?? 0;
      setSpectrum(!buffer || buffer.length < 16 || rate <= 0 ? null : computeSpectrum(buffer.getAllChannels(), rate));
    };
    tick();
    const timer = setInterval(tick, SPECTRUM_UPDATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [visible, controller, option.type, active?.profile]);
  return <SpectrumView freqs={spectrum?.freqs ?? []} mags={spectrum?.mags ?? []} labels={option.channels}
    height={280} title={`${option.label} Spectrum`} placeholder={ready ? 'Waiting for data ...' : 'Not connected'} />;
}

export default function WaveformScreen({ visible }: { visible: boolean }) {
  const controller = DemoController.Instance;
  useDemoVersion(visible);
  const [selected, setSelected] = useState(0);
  const option = OPTIONS[selected] ?? OPTIONS[0]!;
  const active = controller.getActiveState();
  const ready = controller.isDisplayReady(active);

  return (
    <div className="screen-scroll imu-screen">
      <h2>3D Quaternion Visualization</h2>
      <DemoPlot visible={visible}>{() => {
        const quaternion: [number, number, number, number] | null = ready && active
          && controller.getDisplayChannelCount(active, DataType.NTF_QUAT) >= 4
          ? [
            controller.getDisplayLatest(active, DataType.NTF_QUAT, 0),
            controller.getDisplayLatest(active, DataType.NTF_QUAT, 1),
            controller.getDisplayLatest(active, DataType.NTF_QUAT, 2),
            controller.getDisplayLatest(active, DataType.NTF_QUAT, 3),
          ] : null;
        return <CubeView quaternion={quaternion} placeholder={ready ? 'No quaternion data' : 'Not connected'} height={220} />;
      }}</DemoPlot>
      <div className="segmented" role="group" aria-label="IMU data type">
        {OPTIONS.map((item, index) => (
          <button type="button" key={item.label} className={index === selected ? 'active' : ''}
            onClick={() => {
              setSelected(index);
              controller.appLog(`User: display data type -> ${item.label}`);
            }}>{item.label}</button>
        ))}
      </div>
      <div className="split-row imu-split">
        <ImuSpectrum visible={visible} controller={controller} active={active} ready={ready} option={option} />
        <DemoPlot visible={visible}>{() => {
          const channels = ready && active ? controller.getDisplayChannels(active, option.type) : [];
          return <>
            <WaveformView channels={channels} yRange={option.yRange} height={280} title={option.label} />
            <h2>Real-time Values</h2>
            <div className="values-box">
              {channels.length === 0 || !active ? <span>--</span> : channels.map((_, channel) => (
                <span key={channel}>{`${option.channels[channel] ?? `ch${channel}`}: ${controller.getDisplayLatest(active, option.type, channel) >= 0 ? '+' : ''}${controller.getDisplayLatest(active, option.type, channel).toFixed(4)}`}</span>
              ))}
            </div>
          </>;
        }}</DemoPlot>
      </div>
    </div>
  );
}
