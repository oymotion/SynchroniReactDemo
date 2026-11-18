import { CHANNEL_COLORS } from './WaveformView';
import { useElementWidth } from './common';

export default function SpectrumView({
  freqs,
  mags,
  labels,
  colorIndex = -1,
  height,
  title,
  placeholder,
}: {
  freqs: Float32Array | number[];
  mags: Array<Float32Array | number[]>;
  labels?: string[];
  colorIndex?: number;
  height: number;
  title?: string;
  placeholder?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const plotHeight = Math.max(1, height - (title ? 20 : 0));
  const left = 3;
  const top = 3;
  const right = Math.max(left + 1, width - 3);
  const bottom = Math.max(top + 1, plotHeight - 16);
  const plotWidth = right - left;
  const plotDepth = bottom - top;
  const hasData = freqs.length >= 2 && mags.length > 0;
  const fMax = hasData ? freqs[freqs.length - 1] ?? 0 : 0;
  let peak = 0;
  for (const row of mags) {
    for (let i = 0; i < row.length; ++i) peak = Math.max(peak, row[i] ?? 0);
  }
  const yMax = peak > 0 ? peak * 1.1 : 1;
  return (
    <section className="plot-card spectrum-card" style={{ height }} aria-label={title ?? 'Spectrum'}>
      {title && <div className="plot-title">{title}</div>}
      <div className="plot-svg" ref={ref}>
        {width > 1 && (
          <svg width={width} height={plotHeight} viewBox={`0 0 ${width} ${plotHeight}`} preserveAspectRatio="none">
            <rect x={left} y={top} width={plotWidth} height={plotDepth} fill="none" stroke="#535c6a" />
            {hasData && fMax > 0 ? (
              <>
                {mags.map((row, channel) => {
                  const color = CHANNEL_COLORS[(colorIndex >= 0 ? colorIndex : channel) % CHANNEL_COLORS.length];
                  const points: string[] = [];
                  for (let i = 0; i < Math.min(row.length, freqs.length); ++i) {
                    const x = left + (freqs[i] ?? 0) / fMax * (plotWidth - 1);
                    const y = bottom - 1 - (row[i] ?? 0) / yMax * (plotDepth - 2);
                    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
                  }
                  return (
                    <g key={channel}>
                      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
                      <text x={left + 5} y={top + 12 + channel * 13} fill={color} fontSize={10}>{labels?.[channel] ?? `ch${channel}`}</text>
                    </g>
                  );
                })}
                <text x={left + 3} y={plotHeight - 3} fill="#969fad" fontSize={10}>0</text>
                <text x={right - 2} y={plotHeight - 3} fill="#969fad" fontSize={10} textAnchor="end">{`${fMax.toFixed(1)} Hz`}</text>
              </>
            ) : (
              <text x={width / 2} y={(top + bottom) / 2} fill="#969fad" fontSize={11} textAnchor="middle">{placeholder ?? 'Waiting for data ...'}</text>
            )}
          </svg>
        )}
      </div>
    </section>
  );
}
