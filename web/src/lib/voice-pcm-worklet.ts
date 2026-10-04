// Runs in the audio rendering thread. Batch mono PCM16 into small network chunks.
export const voicePcmWorklet = `
class VoicePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(2048);
    this.length = 0;
    this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (data === 'stop') {
        this.stopped = true;
        this.flush();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  flush() {
    if (!this.length) return;
    const bytes = new ArrayBuffer(this.length * 2);
    const view = new DataView(bytes);
    for (let i = 0; i < this.length; i++) {
      view.setInt16(i * 2, this.samples[i], true);
    }
    this.port.postMessage({ type: 'audio', bytes }, [bytes]);
    this.length = 0;
  }

  process(inputs) {
    if (this.stopped) return false;
    const channel = inputs[0]?.[0];
    if (channel) {
      for (const sample of channel) {
        const value = Math.max(-1, Math.min(1, sample));
        this.samples[this.length++] = value < 0 ? value * 32768 : value * 32767;
        if (this.length === this.samples.length) this.flush();
      }
    }
    // Outputs remain silent; microphone audio is never played through speakers.
    return true;
  }
}
registerProcessor('voice-pcm', VoicePcmProcessor);
`
