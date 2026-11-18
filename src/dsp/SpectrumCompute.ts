const PI = Math.PI;

export interface SpectrumResult {
  freqs: Float32Array;
  mags: Float32Array[];
}

function fft(re: Float64Array, im: Float64Array, n: number): void {
  let j = 0;
  for (let i = 1; i < n; ++i) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * PI / len;
    const wr0 = Math.cos(angle);
    const wi0 = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < len / 2; ++k) {
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * wr - im[i + k + len / 2]! * wi;
        const vi = re[i + k + len / 2]! * wi + im[i + k + len / 2]! * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nextWr = wr * wr0 - wi * wi0;
        wi = wr * wi0 + wi * wr0;
        wr = nextWr;
      }
    }
  }
}

export function computeSpectrum(
  channels: ReadonlyArray<ArrayLike<number>>,
  rate: number,
): SpectrumResult | null {
  if (channels.length === 0 || rate <= 0) return null;
  const n = channels[0]?.length ?? 0;
  if (n < 16) return null;
  let nfft = 1;
  while (nfft < n) nfft <<= 1;
  const window = new Float64Array(n);
  let windowSum = 0;
  for (let i = 0; i < n; ++i) {
    window[i] = 0.5 - 0.5 * Math.cos(2 * PI * i / (n - 1));
    windowSum += window[i]!;
  }
  const freqs = new Float32Array(nfft / 2 + 1);
  for (let k = 0; k <= nfft / 2; ++k) freqs[k] = k * rate / nfft;
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const mags: Float32Array[] = [];
  for (const channel of channels) {
    re.fill(0);
    im.fill(0);
    const m = Math.min(n, channel.length);
    for (let i = 0; i < m; ++i) re[i] = (channel[i] ?? 0) * window[i]!;
    fft(re, im, nfft);
    const scale = 2 / Math.max(windowSum, 1e-12);
    const row = new Float32Array(nfft / 2 + 1);
    for (let k = 0; k <= nfft / 2; ++k) row[k] = scale * Math.hypot(re[k]!, im[k]!);
    mags.push(row);
  }
  return { freqs, mags };
}
