// AudioWorklet: converts mic Float32 frames to PCM16 little-endian and posts
// them in ~100ms chunks to the main thread. The main thread base64-encodes
// the chunks and sends them to the backend via WebSocket.
//
// The AudioContext is created with sampleRate = 24000 in the main thread, so
// no resampling is needed here — just float→int16 conversion and buffering.

class PcmRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._frames = options?.processorOptions?.framesPerChunk ?? 2400; // 100ms @ 24kHz
    this._buffer = new Int16Array(this._frames);
    this._offset = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      let s = Math.max(-1, Math.min(1, channel[i]));
      this._buffer[this._offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this._offset >= this._frames) {
        // Transfer underlying buffer to avoid copies.
        this.port.postMessage(this._buffer.buffer, [this._buffer.buffer]);
        this._buffer = new Int16Array(this._frames);
        this._offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-recorder", PcmRecorder);
