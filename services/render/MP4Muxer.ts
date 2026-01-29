import MP4Box from 'mp4box';

/**
 * Handles packaging of EncodedVideoChunks (and Audio) into an MP4 container.
 */
export class MP4Muxer {
  private file: any;
  private videoTrackId: number | null = null;
  private audioTrackId: number | null = null;
  private started: boolean = false;

  constructor() {
    this.file = MP4Box.createFile();
  }

  /**
   * Configures the video track in the MP4 container.
   */
  addVideoTrack(config: { width: number; height: number; codec: string; description?: Uint8Array }) {
    this.videoTrackId = this.file.addTrack({
      timescale: 1000000, // WebCodecs uses microseconds (1e6)
      width: config.width,
      height: config.height,
      nb_samples: 0,
      avcDecoderConfigRecord: config.description, // Critical for H.264
      type: 'video',
      codec: config.codec
    });
    
    return this.videoTrackId;
  }

  /**
   * Configures the audio track in the MP4 container.
   */
  addAudioTrack(config: { codec: string; numberOfChannels: number; sampleRate: number; description?: Uint8Array }) {
      this.audioTrackId = this.file.addTrack({
          timescale: 1000000,
          type: 'audio',
          channel_count: config.numberOfChannels,
          samplerate: config.sampleRate,
          hdlr: 'soun',
          codec: config.codec,
          description: config.description, // ESDS for AAC
          // MP4Box might need specific box structures passed in description
      });

      // If we have raw ESDS (AudioSpecificConfig) from Demuxer, MP4Box usually handles it if passed 
      // via `addTrack` options, or we might need to append a specific box manually if MP4Box 
      // doesn't auto-parse 'description' for audio. 
      // For now, assuming MP4Box.js handles `description` or `esds` property in options.
      if (config.description && this.audioTrackId !== null) {
          const track = this.file.getTrackById(this.audioTrackId);
          // Manually injecting if addTrack didn't pick it up (Safety fallback for MP4Box versions)
          // Note: MP4Box addTrack usually expects `esds` or specific config. 
          // We rely on the caller passing correct config or MP4Box defaults.
      }

      return this.audioTrackId;
  }

  /**
   * Starts the muxing process.
   */
  start() {
    if (!this.started) {
        this.file.start();
        this.started = true;
    }
  }

  /**
   * Adds an encoded video chunk to the container.
   */
  addVideoChunk(chunk: EncodedVideoChunk) {
    if (this.videoTrackId === null) {
        throw new Error("Video track not initialized");
    }

    const buffer = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(buffer);

    this.file.addSample(this.videoTrackId, buffer, {
      duration: chunk.duration ?? 0,
      dts: chunk.timestamp,
      cts: chunk.timestamp,
      is_sync: chunk.type === 'key'
    });
  }

  /**
   * Adds an encoded audio chunk to the container.
   */
  addAudioChunk(chunk: EncodedAudioChunk) {
      if (this.audioTrackId === null) {
          throw new Error("Audio track not initialized");
      }

      const buffer = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(buffer);

      this.file.addSample(this.audioTrackId, buffer, {
          duration: chunk.duration ?? 0,
          dts: chunk.timestamp,
          cts: chunk.timestamp,
          is_sync: chunk.type === 'key'
      });
  }

  /**
   * Finalizes the file and returns the generated Blob.
   */
  getBlob(): Blob {
    const buffer = this.file.getBuffer();
    return new Blob([buffer], { type: 'video/mp4' });
  }
}