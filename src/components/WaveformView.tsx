import { useElementWidth } from './common';

export const CHANNEL_COLORS = [
  '#37a6ec', '#ff9e36', '#43c768', '#ef5350',
  '#ab72d8', '#b58a67', '#e879b9', '#a5adb8',
];

export default function WaveformView({
  channels,
  yRange,
  height,
  title,
  sideText,
  sideTextColor,
}: {
  channels: Array<Float32Array | number[]>;
  yRange?: [number, number];
  height: number;
  title?: string;
  sideText?: string;
  sideTextColor?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const plotHeight = Math.max(1, height - (title ? 20 : 0));
  let min = yRange?.[0] ?? Infinity;
  let max = yRange?.[1] ?? -Infinity;
  if (!yRange) {
    for (const channel of channels) {
      for (let i = 0; i < channel.length; ++i) {
        const value = channel[i] ?? 0;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) { min = -1; max = 1; }
    if (min === max) { min -= 1; max += 1; }
    const margin = (max - min) * 0.1;
    min -= margin;
    max += margin;
  }
  const toY = (value: number) => plotHeight - 1 - (value - min) / (max - min) * (plotHeight - 2);
  const centerY = Math.min(plotHeight - 1, Math.max(1, toY(0)));
  return (
    <section className="plot-card" style={{ height }} aria-label={title ?? 'Waveform'}>
      {title && <div className="plot-title">{title}</div>}
      <div className="waveform-body">
        <div className="plot-svg" ref={ref}>
          {width > 1 && (
            <svg width={width} height={plotHeight} viewBox={`0 0 ${width} ${plotHeight}`} preserveAspectRatio="none">
              <line x1={0} y1={centerY} x2={width} y2={centerY} stroke="#3b424e" strokeWidth={1} />
              {channels.map((data, channel) => {
                if (data.length === 0) return null;
                const points: string[] = [];
                for (let x = 0; x < width; ++x) {
                  const index = Math.min(data.length - 1, Math.floor(x * data.length / width));
                  points.push(`${x},${toY(data[index] ?? 0).toFixed(1)}`);
                }
                return <polyline key={channel} points={points.join(' ')} fill="none" stroke={CHANNEL_COLORS[channel % CHANNEL_COLORS.length]} strokeWidth={1.15} vectorEffect="non-scaling-stroke" />;
              })}
            </svg>
          )}
        </div>
        {sideText && <span className="impedance" style={{ color: sideTextColor ?? '#9e9e9e' }}>{sideText}</span>}
      </div>
    </section>
  );
}
