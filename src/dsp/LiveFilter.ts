const BANDS = [
  { label: 'Off', lo: 0, hi: 0 },
  { label: '\u03b4 0.5-4Hz', lo: 0.5, hi: 4 },
  { label: '\u03b8 4-8Hz', lo: 4, hi: 8 },
  { label: '\u03b1 8-13Hz', lo: 8, hi: 13 },
  { label: '\u03b2 13-30Hz', lo: 13, hi: 30 },
  { label: '\u03b3 30-45Hz', lo: 30, hi: 45 },
];
const ORDER = 4;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

interface StreamState {
  band: number;
  rate: number;
  sections: Biquad[];
  zi0: number[][];
  channels: Map<number, number[][]>;
}

class C {
  constructor(readonly re: number, readonly im: number) {}
  static polar(r: number, theta: number): C { return new C(r * Math.cos(theta), r * Math.sin(theta)); }
  static real(value: number): C { return new C(value, 0); }
  static sqrt(value: C): C {
    const m = Math.sqrt(value.abs());
    const angle = Math.atan2(value.im, value.re) / 2;
    return new C(m * Math.cos(angle), m * Math.sin(angle));
  }
  add(other: C | number): C {
    return typeof other === 'number' ? new C(this.re + other, this.im) : new C(this.re + other.re, this.im + other.im);
  }
  sub(other: C): C { return new C(this.re - other.re, this.im - other.im); }
  mul(other: C | number): C {
    return typeof other === 'number'
      ? new C(this.re * other, this.im * other)
      : new C(this.re * other.re - this.im * other.im, this.re * other.im + this.im * other.re);
  }
  div(other: C): C {
    const d = other.re * other.re + other.im * other.im;
    return new C((this.re * other.re + this.im * other.im) / d, (this.im * other.re - this.re * other.im) / d);
  }
  conj(): C { return new C(this.re, -this.im); }
  abs(): number { return Math.hypot(this.re, this.im); }
}

export class LiveFilter {
  static bandLabels(): string[] { return BANDS.map((band) => band.label); }

  private selected = 0;
  private streams = new Map<number, StreamState>();

  setBand(index: number): void {
    this.selected = index > 0 && index < BANDS.length ? index : 0;
    this.streams.clear();
  }

  get band(): number { return this.selected; }

  reset(): void { this.streams.clear(); }

  apply(dataType: number, channel: number, values: Float32Array, sampleRate: number): void {
    if (values.length === 0 || this.selected === 0) return;
    let stream = this.streams.get(dataType);
    if (!stream) {
      stream = { band: 0, rate: 0, sections: [], zi0: [], channels: new Map() };
      this.streams.set(dataType, stream);
    }
    if (stream.band !== this.selected || stream.rate !== sampleRate) {
      stream.sections = [];
      stream.zi0 = [];
      stream.channels.clear();
      stream.band = this.selected;
      stream.rate = sampleRate;
      const designed = LiveFilter.design(this.selected, sampleRate);
      if (!designed) return;
      stream.sections = designed;
      let u = 1;
      for (const section of designed) {
        const gain = (section.b0 + section.b1 + section.b2) / (1 + section.a1 + section.a2);
        const y = gain * u;
        stream.zi0.push([y - section.b0 * u, section.b2 * u - section.a2 * y]);
        u = y;
      }
    }
    if (stream.sections.length === 0) return;
    let state = stream.channels.get(channel);
    if (!state) {
      state = stream.zi0.map((z) => [z[0]!, z[1]!]);
      stream.channels.set(channel, state);
    }
    for (let i = 0; i < values.length; ++i) {
      let x = values[i]!;
      for (let s = 0; s < stream.sections.length; ++s) {
        const section = stream.sections[s]!;
        const z = state[s]!;
        const y = section.b0 * x + z[0]!;
        z[0] = section.b1 * x - section.a1 * y + z[1]!;
        z[1] = section.b2 * x - section.a2 * y;
        x = y;
      }
      values[i] = x;
    }
  }

  private static design(bandIndex: number, fs: number): Biquad[] | null {
    if (bandIndex <= 0 || bandIndex >= BANDS.length || fs <= 0) return null;
    const { lo, hi } = BANDS[bandIndex]!;
    if (hi >= fs / 2) return null;
    const w1 = 2 * fs * Math.tan(Math.PI * lo / fs);
    const w2 = 2 * fs * Math.tan(Math.PI * hi / fs);
    const bandwidth = w2 - w1;
    const omega = Math.sqrt(w1 * w2);
    const fs2 = 2 * fs;
    const poles: C[] = [];
    const zeros: C[] = [];
    for (let k = 0; k < ORDER; ++k) {
      const angle = Math.PI * (2 * k + 1 + ORDER) / (2 * ORDER);
      const pole = C.polar(1, angle);
      const mid = pole.mul(0.5 * bandwidth);
      const disc = C.sqrt(mid.mul(mid).sub(C.real(omega * omega)));
      const sp1 = mid.add(disc);
      const sp2 = mid.sub(disc);
      poles.push(sp1.add(fs2).div(C.real(fs2).sub(sp1)));
      poles.push(sp2.add(fs2).div(C.real(fs2).sub(sp2)));
    }
    for (let k = 0; k < ORDER; ++k) zeros.push(C.real(1), C.real(-1));
    const gain = C.real(Math.pow(bandwidth, ORDER)).mul(Math.pow(fs2, ORDER));
    let denominator = C.real(1);
    for (let k = 0; k < ORDER; ++k) {
      const angle = Math.PI * (2 * k + 1 + ORDER) / (2 * ORDER);
      const pole = C.polar(1, angle);
      const mid = pole.mul(0.5 * bandwidth);
      const disc = C.sqrt(mid.mul(mid).sub(C.real(omega * omega)));
      denominator = denominator.mul(
        C.real(fs2).sub(mid.add(disc)).mul(C.real(fs2).sub(mid.sub(disc))),
      );
    }
    const kz = gain.div(denominator).re;
    const sections: Biquad[] = [];
    while (poles.length > 0) {
      const pole = poles.pop()!;
      const conjugate = pole.conj();
      let best = 0;
      for (let i = 1; i < poles.length; ++i) {
        if (poles[i]!.sub(conjugate).abs() < poles[best]!.sub(conjugate).abs()) best = i;
      }
      const pair = poles.splice(best, 1)[0]!;
      const zeroPair: C[] = [];
      for (let j = 0; j < 2; ++j) {
        let nearest = 0;
        for (let i = 1; i < zeros.length; ++i) {
          const d = Math.min(zeros[i]!.sub(pole).abs(), zeros[i]!.sub(pair).abs());
          const bestD = Math.min(zeros[nearest]!.sub(pole).abs(), zeros[nearest]!.sub(pair).abs());
          if (d < bestD) nearest = i;
        }
        zeroPair.push(zeros.splice(nearest, 1)[0]!);
      }
      sections.push({
        b0: 1,
        b1: -zeroPair[0]!.add(zeroPair[1]!).re,
        b2: zeroPair[0]!.mul(zeroPair[1]!).re,
        a1: -pole.add(pair).re,
        a2: pole.mul(pair).re,
      });
    }
    sections[0]!.b0 *= kz;
    sections[0]!.b1 *= kz;
    sections[0]!.b2 *= kz;
    return sections;
  }
}
