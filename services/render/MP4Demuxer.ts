import MP4Box from 'mp4box';

/**
 * A wrapper class around MP4Box.js to facilitate extracting 
 * EncodedVideoChunks and EncodedAudioChunks for WebCodecs.
 */
export class MP4Demuxer {
  private file: any;
  private videoTrack: any = null;
  private audioTrack: any = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((err: any) => void) | null = null;

  constructor() {
    this.file = MP4Box.createFile();
    
    this.file.onReady = (info: any) => {
      // Find video track (prefer AVC/H.264 for now as it's most common)
      this.videoTrack = info.videoTracks[0];
      this.audioTrack = info.audioTracks[0];
      
      console.log(`[Demuxer] Ready. Tracks found - Video: ${this.videoTrack?.id}, Audio: ${this.audioTrack?.id}`);
      
      if (this.resolveReady) this.resolveReady();
    };

    this.file.onError = (e: any) => {
       console.error("[Demuxer] Error:", e);
       if (this.rejectReady) this.rejectReady(e);
    };
  }

  /**
   * Loads a file (Blob/File) into the demuxer. 
   * Reads the entire file into memory as ArrayBuffer.
   */
  async load(blob: Blob): Promise<void> {
    const buffer = await blob.arrayBuffer();
    // MP4Box requires fileStart to be set on the buffer
    (buffer as any).fileStart = 0;
    
    const readyPromise = new Promise<void>((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
    });

    this.file.appendBuffer(buffer);
    this.file.flush();
    
    return readyPromise;
  }

  getVideoConfig() {
      if (!this.videoTrack) return null;
      return {
          codec: this.videoTrack.codec,
          codedWidth: this.videoTrack.video.width,
          codedHeight: this.videoTrack.video.height,
          description: this.getDescription(this.videoTrack)
      };
  }

  getAudioConfig() {
      if (!this.audioTrack) return null;
      return {
          codec: this.audioTrack.codec,
          numberOfChannels: this.audioTrack.audio.channel_count,
          sampleRate: this.audioTrack.audio.sample_rate,
          description: this.getAudioDescription(this.audioTrack)
      };
  }

  getSampleCount(): number {
      return this.videoTrack ? this.videoTrack.nb_samples : 0;
  }

  /**
   * Extracts the AVCC/HVCC/VPCC configuration box from the MP4 track.
   */
  private getDescription(track: any): Uint8Array | undefined {
      const trak = this.file.getTrackById(track.id);
      for (const entry of trak.mdia.minf.stbl.stsd.entries) {
          const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
          if (box) {
              const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
              box.write(stream);
              return new Uint8Array(stream.buffer, 8); // Remove box header
          }
      }
      return undefined;
  }

  private getAudioDescription(track: any): Uint8Array | undefined {
      const trak = this.file.getTrackById(track.id);
      for (const entry of trak.mdia.minf.stbl.stsd.entries) {
          if (entry.esds) {
              const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
              entry.esds.write(stream);
              return new Uint8Array(stream.buffer, 8); // Remove box header
          }
      }
      return undefined;
  }

  /**
   * Collects all video chunks in memory.
   * Useful for the transcoding loop where we need to control the flow.
   */
  async getAllVideoChunks(): Promise<EncodedVideoChunk[]> {
      return new Promise((resolve) => {
          if (!this.videoTrack) { resolve([]); return; }
          
          const chunks: EncodedVideoChunk[] = [];
          const videoId = this.videoTrack.id;

          // Override handler for this operation
          this.file.onSamples = (id: number, user: any, samples: any[]) => {
              if (id === videoId) {
                  for (const sample of samples) {
                      const type = sample.is_sync ? 'key' : 'delta';
                      chunks.push(new EncodedVideoChunk({
                          type: type,
                          timestamp: (1e6 * sample.cts) / sample.timescale,
                          duration: (1e6 * sample.duration) / sample.timescale,
                          data: sample.data
                      }));
                  }
              }
          };

          // Extract entire track
          this.file.setExtractionOptions(videoId, null, { nbSamples: Infinity });
          this.file.start();

          // Poll for completion (MP4Box.js doesn't have a clean "track done" callback in this mode)
          // Since we already loaded the buffer, extraction is fast and synchronous-ish
          // but file.start() triggers async processing.
          
          // Simple completion check: wait until extraction stops adding chunks
          let lastCount = 0;
          const check = setInterval(() => {
              if (chunks.length > 0 && chunks.length === lastCount) {
                  // likely done
                  clearInterval(check);
                  resolve(chunks);
              }
              lastCount = chunks.length;
          }, 100);
      });
  }

  /**
   * Collects all audio chunks in memory.
   */
  async getAllAudioChunks(): Promise<EncodedAudioChunk[]> {
      return new Promise((resolve) => {
          if (!this.audioTrack) { resolve([]); return; }
          
          const chunks: EncodedAudioChunk[] = [];
          const audioId = this.audioTrack.id;

          this.file.onSamples = (id: number, user: any, samples: any[]) => {
              if (id === audioId) {
                  for (const sample of samples) {
                      const type = sample.is_sync ? 'key' : 'delta';
                      chunks.push(new EncodedAudioChunk({
                          type: type,
                          timestamp: (1e6 * sample.cts) / sample.timescale,
                          duration: (1e6 * sample.duration) / sample.timescale,
                          data: sample.data
                      }));
                  }
              }
          };

          this.file.setExtractionOptions(audioId, null, { nbSamples: Infinity });
          this.file.start();

          let lastCount = 0;
          const check = setInterval(() => {
              if (chunks.length > 0 && chunks.length === lastCount) {
                  clearInterval(check);
                  resolve(chunks);
              }
              lastCount = chunks.length;
          }, 100);
      });
  }

  demux(handlers: { onVideoChunk?: (chunk: EncodedVideoChunk) => void, onAudioChunk?: (chunk: EncodedAudioChunk) => void }) {
      // Keep existing implementation for stream-based compatibility if needed
      const videoId = this.videoTrack ? this.videoTrack.id : -1;
      const audioId = this.audioTrack ? this.audioTrack.id : -1;
      
      this.file.onSamples = (id: number, user: any, samples: any[]) => {
          if (id === videoId && handlers.onVideoChunk) {
              for (const sample of samples) {
                 const type = sample.is_sync ? 'key' : 'delta';
                 const chunk = new EncodedVideoChunk({
                     type: type,
                     timestamp: (1e6 * sample.cts) / sample.timescale,
                     duration: (1e6 * sample.duration) / sample.timescale,
                     data: sample.data
                 });
                 handlers.onVideoChunk(chunk);
              }
          } 
          else if (id === audioId && handlers.onAudioChunk) {
              for (const sample of samples) {
                 const type = sample.is_sync ? 'key' : 'delta'; 
                 const chunk = new EncodedAudioChunk({
                     type: type,
                     timestamp: (1e6 * sample.cts) / sample.timescale,
                     duration: (1e6 * sample.duration) / sample.timescale,
                     data: sample.data
                 });
                 handlers.onAudioChunk(chunk);
              }
          }
      };

      if (this.videoTrack && handlers.onVideoChunk) this.file.setExtractionOptions(videoId, null, { nbSamples: 1000 });
      if (this.audioTrack && handlers.onAudioChunk) this.file.setExtractionOptions(audioId, null, { nbSamples: 1000 });
      this.file.start();
  }
}