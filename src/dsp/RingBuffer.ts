export class RingBuffer {
  channelCount = 0;
  length = 0;
  private data: Float32Array[] = [];
  private head = 0;

  ensureSize(channelCount: number, length: number): void {
    const size = Math.max(1, Math.round(length));
    if (this.channelCount === channelCount && this.length === size) return;
    this.channelCount = channelCount;
    this.length = size;
    this.data = Array.from({ length: channelCount }, () => new Float32Array(size));
    this.head = 0;
  }

  appendBatch(channelValues: ReadonlyArray<ArrayLike<number>>): void {
    const count = channelValues[0]?.length ?? 0;
    for (let i = 0; i < count; ++i) {
      for (let ch = 0; ch < this.channelCount; ++ch) {
        const buffer = this.data[ch];
        if (buffer) buffer[this.head] = channelValues[ch]?.[i] ?? 0;
      }
      this.head = (this.head + 1) % this.length;
    }
  }

  getChannel(channel: number): Float32Array {
    const buffer = this.data[channel];
    if (!buffer || this.length === 0) return new Float32Array(0);
    const out = new Float32Array(this.length);
    for (let i = 0; i < this.length; ++i) out[i] = buffer[(this.head + i) % this.length] ?? 0;
    return out;
  }

  getAllChannels(): Float32Array[] {
    return Array.from({ length: this.channelCount }, (_, channel) => this.getChannel(channel));
  }

  latest(channel: number): number {
    const buffer = this.data[channel];
    if (!buffer || this.length === 0) return 0;
    return buffer[(this.head + this.length - 1) % this.length] ?? 0;
  }

  clear(): void {
    for (const buffer of this.data) buffer.fill(0);
    this.head = 0;
  }
}
