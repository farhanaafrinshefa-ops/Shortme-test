
export const RENDER_WORKER_CODE = `
// Use jsdelivr for stable ESM support in Workers
import MP4Box from "https://cdn.jsdelivr.net/npm/mp4box@0.5.2/+esm";

// Global error handler for the worker to report startup issues
self.onerror = function(e) {
    console.error("Worker Global Error:", e);
    self.postMessage({ type: 'error', payload: "Worker Start Failed: " + (e.message || e) });
};

// --- MP4Demuxer ---
class MP4Demuxer {
  constructor() {
    this.file = MP4Box.createFile();
    this.videoTrack = null;
    this.audioTrack = null;
    this.resolveReady = null;
    this.rejectReady = null;
    
    this.file.onReady = (info) => {
      this.videoTrack = info.videoTracks[0];
      this.audioTrack = info.audioTracks[0];
      if (this.resolveReady) this.resolveReady();
    };

    this.file.onError = (e) => {
       console.error("[Demuxer] Error:", e);
       if (this.rejectReady) this.rejectReady(e);
    };
  }

  async load(blob) {
    const buffer = await blob.arrayBuffer();
    buffer.fileStart = 0;
    
    const readyPromise = new Promise((resolve, reject) => {
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

  getDescription(track) {
      const trak = this.file.getTrackById(track.id);
      for (const entry of trak.mdia.minf.stbl.stsd.entries) {
          const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
          if (box) {
              const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
              box.write(stream);
              return new Uint8Array(stream.buffer, 8); 
          }
      }
      return undefined;
  }

  getAudioDescription(track) {
      const trak = this.file.getTrackById(track.id);
      for (const entry of trak.mdia.minf.stbl.stsd.entries) {
          if (entry.esds) {
              const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
              entry.esds.write(stream);
              return new Uint8Array(stream.buffer, 8);
          }
      }
      return undefined;
  }

  async getAllVideoChunks() {
      return new Promise((resolve) => {
          if (!this.videoTrack) { resolve([]); return; }
          const chunks = [];
          const videoId = this.videoTrack.id;

          this.file.onSamples = (id, user, samples) => {
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

          this.file.setExtractionOptions(videoId, null, { nbSamples: Infinity });
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

  async getAllAudioChunks() {
      return new Promise((resolve) => {
          if (!this.audioTrack) { resolve([]); return; }
          const chunks = [];
          const audioId = this.audioTrack.id;

          this.file.onSamples = (id, user, samples) => {
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
}

// --- MP4Muxer ---
class MP4Muxer {
  constructor() {
    this.file = MP4Box.createFile();
    this.videoTrackId = null;
    this.audioTrackId = null;
    this.started = false;
  }

  addVideoTrack(config) {
    const avcc = config.description ? new Uint8Array(config.description) : undefined;

    this.videoTrackId = this.file.addTrack({
      timescale: 1000000,
      width: config.width,
      height: config.height,
      nb_samples: 0,
      avcDecoderConfigRecord: avcc, 
      type: 'video',
      codec: config.codec
    });
    return this.videoTrackId;
  }

  addAudioTrack(config) {
      this.audioTrackId = this.file.addTrack({
          timescale: 1000000,
          type: 'audio',
          channel_count: config.numberOfChannels,
          samplerate: config.sampleRate,
          hdlr: 'soun',
          codec: config.codec,
          description: config.description,
      });
      return this.audioTrackId;
  }

  start() {
    if (!this.started) {
        this.file.start();
        this.started = true;
    }
  }

  addVideoChunk(chunk, fallbackDuration) {
    if (this.videoTrackId === null) return;
    
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);

    // FIX: Handle null/undefined explicitly for MP4Box
    // MP4Box requires a number. chunk.duration can be null in WebCodecs.
    let dur = chunk.duration;
    if (dur === null || dur === undefined) {
        dur = fallbackDuration || 0;
    }

    this.file.addSample(this.videoTrackId, data.buffer, {
      duration: dur,
      dts: chunk.timestamp,
      cts: chunk.timestamp,
      is_sync: chunk.type === 'key'
    });
  }

  addAudioChunk(chunk) {
      if (this.audioTrackId === null) return;
      
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);

      let dur = chunk.duration;
      if (dur === null || dur === undefined) {
          dur = 0;
      }

      this.file.addSample(this.audioTrackId, data.buffer, {
          duration: dur,
          dts: chunk.timestamp,
          cts: chunk.timestamp,
          is_sync: chunk.type === 'key'
      });
  }

  getBlob() {
    const buffer = this.file.getBuffer();
    return new Blob([buffer], { type: 'video/mp4' });
  }
}

// --- Compositor ---
class Compositor {
    constructor(width, height) {
        this.canvas = new OffscreenCanvas(width, height);
        this.gl = this.canvas.getContext('webgl2', { 
            alpha: false, 
            desynchronized: true, 
            powerPreference: 'high-performance' 
        });

        if (!this.gl) throw new Error("WebGL2 not supported");

        this.overlayCanvas = new OffscreenCanvas(width, height);
        this.overlayCtx = this.overlayCanvas.getContext('2d');

        this.initShaders();
        this.initBuffers();
        this.initTextures();
    }

    initShaders() {
        const vsSource = \`#version 300 es
            in vec2 a_position;
            in vec2 a_texCoord;
            uniform vec2 u_cropScale;
            uniform vec2 u_cropOffset;
            out vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = (a_texCoord * u_cropScale) + u_cropOffset; 
            }
        \`;

        const fsSource = \`#version 300 es
            precision highp float;
            uniform sampler2D u_image;
            in vec2 v_texCoord;
            out vec4 outColor;
            void main() {
                outColor = texture(u_image, v_texCoord);
            }
        \`;

        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vsSource);
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fsSource);
        
        this.program = this.gl.createProgram();
        this.gl.attachShader(this.program, vertexShader);
        this.gl.attachShader(this.program, fragmentShader);
        this.gl.linkProgram(this.program);

        this.positionLoc = this.gl.getAttribLocation(this.program, 'a_position');
        this.texCoordLoc = this.gl.getAttribLocation(this.program, 'a_texCoord');
        this.cropScaleLoc = this.gl.getUniformLocation(this.program, 'u_cropScale');
        this.cropOffsetLoc = this.gl.getUniformLocation(this.program, 'u_cropOffset');
    }

    createShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        return shader;
    }

    initBuffers() {
        const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
        const texCoords = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]);

        const posBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, posBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);
        this.gl.enableVertexAttribArray(this.positionLoc);
        this.gl.vertexAttribPointer(this.positionLoc, 2, this.gl.FLOAT, false, 0, 0);

        const texBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, texBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, texCoords, this.gl.STATIC_DRAW);
        this.gl.enableVertexAttribArray(this.texCoordLoc);
        this.gl.vertexAttribPointer(this.texCoordLoc, 2, this.gl.FLOAT, false, 0, 0);
    }

    initTextures() {
        this.texture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

        this.overlayTexture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.overlayTexture);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    }

    updateOverlays(overlays, bitmaps) {
        const ctx = this.overlayCtx;
        const w = this.overlayCanvas.width;
        const h = this.overlayCanvas.height;
        const REFERENCE_WIDTH = 360; 
        const scaleFactor = w / REFERENCE_WIDTH;

        ctx.clearRect(0, 0, w, h);

        overlays.forEach(ov => {
            const { x, y, align } = this.getPosition(ov.position, w, h);
            
            ctx.save();
            ctx.translate(x, y);
            
            if (ov.type === 'text') {
                const fontSize = ov.scale * scaleFactor;
                ctx.font = \`bold \${fontSize}px Inter, sans-serif\`;
                ctx.fillStyle = ov.style?.color || 'white';
                ctx.textAlign = align;
                ctx.textBaseline = 'middle';

                if (ov.style?.backgroundColor) {
                    const metrics = ctx.measureText(ov.content);
                    const bgPadding = fontSize * 0.2;
                    ctx.fillStyle = ov.style.backgroundColor;
                    const rectX = align === 'center' ? -metrics.width/2 : align === 'right' ? -metrics.width : 0;
                    ctx.fillRect(
                        rectX - bgPadding, 
                        -fontSize/2 - bgPadding, 
                        metrics.width + (bgPadding*2), 
                        fontSize + (bgPadding*2)
                    );
                    ctx.fillStyle = ov.style?.color || 'white';
                }
                ctx.fillText(ov.content, 0, 0);

            } else if (ov.type === 'image') {
                const bitmap = bitmaps.get(ov.id);
                if (bitmap) {
                    const targetW = (ov.scale * 3) * scaleFactor;
                    const ratio = bitmap.height / bitmap.width;
                    const targetH = targetW * ratio;
                    const drawX = align === 'center' ? -targetW/2 : align === 'right' ? -targetW : 0;
                    const drawY = -targetH/2;
                    ctx.drawImage(bitmap, drawX, drawY, targetW, targetH);
                }
            }
            ctx.restore();
        });

        this.gl.bindTexture(this.gl.TEXTURE_2D, this.overlayTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.overlayCanvas);
    }

    getPosition(pos, w, h) {
        const pad = w * 0.05;
        const bottomPad = h * 0.15;
        let x = 0, y = 0, align = 'left';

        if (pos.includes('left')) { x = pad; align = 'left'; }
        else if (pos.includes('right')) { x = w - pad; align = 'right'; }
        else { x = w / 2; align = 'center'; }

        if (pos.includes('top')) y = pad + (h * 0.05); 
        else if (pos.includes('bottom')) y = h - bottomPad;
        else y = h / 2;

        return { x, y, align };
    }

    render(frame, reframeConfig) {
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.useProgram(this.program);

        // PASS 1: VIDEO
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, frame);

        const srcRatio = frame.displayWidth / frame.displayHeight;
        const tgtRatio = this.canvas.width / this.canvas.height;
        let w = 1.0, h = 1.0;

        if (srcRatio > tgtRatio) { h = 1.0; w = tgtRatio / srcRatio; } 
        else { w = 1.0; h = srcRatio / tgtRatio; }

        const scale = reframeConfig?.scale || 1.0;
        w /= scale; h /= scale;
        
        const cx = reframeConfig?.x ?? 0.5;
        const cy = reframeConfig?.y ?? 0.5;
        const ox = cx - (w / 2);
        const oy = cy - (h / 2);

        this.gl.uniform2f(this.cropScaleLoc, w, h);
        this.gl.uniform2f(this.cropOffsetLoc, ox, oy);
        
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

        // PASS 2: OVERLAYS
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.overlayTexture);
        this.gl.uniform2f(this.cropScaleLoc, 1.0, 1.0);
        this.gl.uniform2f(this.cropOffsetLoc, 0.0, 0.0);
        
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
        this.gl.disable(this.gl.BLEND);
    }

    getOutputFrame(timestamp, duration) {
        // Fix: Ensure duration is passed as undefined if null/0 to avoid type errors
        return new VideoFrame(this.canvas, {
            timestamp: timestamp,
            duration: duration || undefined
        });
    }
}

// --- WORKER MAIN ---
let demuxer = null;
let muxer = null;
let compositor = null;
let videoEncoder = null;
let videoDecoder = null;
let overlayBitmaps = new Map();

self.onmessage = async (e) => {
    const { type } = e.data;
    if (type === 'init') {
        const { file, config } = e.data.payload;
        await startPipeline(file, config);
    } else if (type === 'cancel') {
        cleanup();
    }
};

const postResponse = (response) => {
    self.postMessage(response);
};

function cleanup() {
    if (videoDecoder) { try { videoDecoder.close(); } catch(e){} videoDecoder = null; }
    if (videoEncoder) { try { videoEncoder.close(); } catch(e){} videoEncoder = null; }
    overlayBitmaps.forEach(bmp => { try { bmp.close(); } catch(e){} });
    overlayBitmaps.clear();
    demuxer = null; muxer = null; compositor = null;
}

async function prepareOverlays(overlays) {
    overlayBitmaps.clear();
    for (const ov of overlays) {
        if (ov.type === 'image' && ov.file) {
            try {
                const bmp = await createImageBitmap(ov.file);
                overlayBitmaps.set(ov.id, bmp);
            } catch (e) {
                console.warn(\`Failed to load image overlay \${ov.id}\`, e);
            }
        }
    }
}

function getInterpolatedReframe(keyframes, time) {
    if (!keyframes || keyframes.length === 0) return { x: 0.5, y: 0.5, scale: 1.0 };
    let k1 = keyframes[0], k2 = keyframes[0];
    for (let i = 0; i < keyframes.length; i++) {
        if (keyframes[i].timestamp <= time) k1 = keyframes[i];
        else { k2 = keyframes[i]; break; }
    }
    if (k1 === k2) return { x: k1.centerX, y: k1.centerY, scale: k1.scale || 1.0 };
    const dt = k2.timestamp - k1.timestamp;
    if (dt <= 0.0001) return { x: k1.centerX, y: k1.centerY, scale: k1.scale || 1.0 };
    const t = (time - k1.timestamp) / dt;
    const clampedT = Math.max(0, Math.min(1, t));
    return {
        x: k1.centerX + (k2.centerX - k1.centerX) * clampedT,
        y: k1.centerY + (k2.centerY - k1.centerY) * clampedT,
        scale: (k1.scale || 1) + ((k2.scale || 1) - (k1.scale || 1)) * clampedT
    };
}

function copyData(chunk) {
    const buffer = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(buffer);
    return buffer;
}

async function startPipeline(file, config) {
    try {
        postResponse({ type: 'status', payload: { phase: 'Initializing', progress: 0 } });
        
        const startTime = config.startTime || 0;
        const endTime = config.endTime || Infinity;
        const startMicro = startTime * 1_000_000;
        const endMicro = endTime * 1_000_000;

        if (config.overlays && config.overlays.length > 0) {
            await prepareOverlays(config.overlays);
        }

        demuxer = new MP4Demuxer();
        await demuxer.load(file);
        
        const videoChunks = await demuxer.getAllVideoChunks();
        const audioChunks = await demuxer.getAllAudioChunks();

        const decoderConfig = demuxer.getVideoConfig();
        if (!decoderConfig) throw new Error("No video track found.");

        // NOTE: Muxer track addition deferred until first encoder output to capture AVCC.
        muxer = new MP4Muxer();

        const audioConfig = demuxer.getAudioConfig();
        if (audioConfig) {
             muxer.addAudioTrack({
                 codec: audioConfig.codec,
                 numberOfChannels: audioConfig.numberOfChannels,
                 sampleRate: audioConfig.sampleRate,
                 description: audioConfig.description
             });
        }

        compositor = new Compositor(config.width, config.height);
        if (config.overlays) {
            compositor.updateOverlays(config.overlays, overlayBitmaps);
        }

        let framesProcessed = 0;
        
        // --- CHUNK FILTERING LOGIC ---
        let startIndex = videoChunks.findIndex(c => c.timestamp >= startMicro);
        if (startIndex === -1) startIndex = 0; 

        // Backtrack to Keyframe
        let keyFrameIndex = startIndex;
        while (keyFrameIndex > 0 && videoChunks[keyFrameIndex].type !== 'key') {
            keyFrameIndex--;
        }

        const validChunks = [];
        for (let i = keyFrameIndex; i < videoChunks.length; i++) {
             if (videoChunks[i].timestamp > endMicro) break;
             validChunks.push(videoChunks[i]);
        }
        
        const totalVideoFrames = validChunks.length;
        
        let encoderResolve;
        let encoderReject;
        const encoderPromise = new Promise((res, rej) => { encoderResolve = res; encoderReject = rej; });

        const pixelCount = config.width * config.height;
        const targetFps = config.fps || 30;
        const calculatedBitrate = Math.floor(pixelCount * targetFps * 0.15);
        const finalBitrate = config.bitrate ? config.bitrate : Math.max(2_000_000, calculatedBitrate);

        const frameDuration = 1000000 / targetFps;
        
        let muxerStarted = false;

        videoEncoder = new VideoEncoder({
            output: (chunk, metadata) => {
                // 1️⃣ Add video track ONCE
                if (!muxerStarted && metadata?.decoderConfig) {
                    muxer.addVideoTrack({
                        width: config.width,
                        height: config.height,
                        codec: 'avc1.4d002a',
                        description: metadata.decoderConfig.description
                    });

                    // 🔥 THIS LINE FIXES 0.00s VIDEO
                    muxer.start();
                    muxerStarted = true;
                }

                // 2️⃣ Add encoded chunk
                muxer.addVideoChunk(chunk, frameDuration);
            },
            error: (e) => {
                console.error("Encoder Error", e);
                encoderReject(e);
            }
        });

        videoEncoder.configure({
            codec: 'avc1.4d002a',
            width: config.width,
            height: config.height,
            bitrate: finalBitrate,
            framerate: targetFps
        });

        let timestampOffset = null;
        const KEYFRAME_INTERVAL = 2_000_000;
        let lastKeyFrameTime = -KEYFRAME_INTERVAL;

        videoDecoder = new VideoDecoder({
            output: async (frame) => {
                // Pre-roll discard
                if (frame.timestamp < startMicro) {
                    frame.close();
                    return;
                }

                const reframe = getInterpolatedReframe(config.reframeKeyframes || [], frame.timestamp / 1_000_000);
                compositor.render(frame, reframe);
                frame.close(); 

                // Offset Calculation
                if (timestampOffset === null) timestampOffset = frame.timestamp;
                const newTimestamp = frame.timestamp - timestampOffset;

                // Fix: Robust null handling for duration in shim
                const newFrame = compositor.getOutputFrame(newTimestamp, frame.duration || undefined);
                
                const shouldKeyFrame = (newTimestamp - lastKeyFrameTime) >= KEYFRAME_INTERVAL;
                if (shouldKeyFrame) lastKeyFrameTime = newTimestamp;

                videoEncoder.encode(newFrame, { keyFrame: shouldKeyFrame });
                newFrame.close();

                framesProcessed++;
                if (framesProcessed % 15 === 0) {
                    const prog = Math.round((framesProcessed / totalVideoFrames) * 100);
                    postResponse({ type: 'status', payload: { phase: 'Rendering', progress: prog } });
                }
            },
            error: (e) => console.error("Decoder Error", e)
        });

        videoDecoder.configure(decoderConfig);

        postResponse({ type: 'status', payload: { phase: 'Rendering', progress: 0 } });
        
        let decoderStarted = false;

        for (const chunk of validChunks) {
            // 🚨 Skip until first keyframe
            if (!decoderStarted) {
                if (chunk.type !== 'key') continue;
                decoderStarted = true;
            }

            while (videoDecoder.decodeQueueSize > 5) {
                await new Promise(r => setTimeout(r, 10));
            }
            videoDecoder.decode(chunk);
        }

        await videoDecoder.flush();
        await videoEncoder.flush();

        if (audioConfig) {
            const validAudio = audioChunks.filter(c => c.timestamp >= startMicro && c.timestamp <= endMicro);
            for (const chunk of validAudio) {
                 if (timestampOffset !== null) {
                     const newTs = chunk.timestamp - timestampOffset;
                     if (newTs >= 0) {
                        const newChunk = new EncodedAudioChunk({
                            type: chunk.type,
                            timestamp: newTs,
                            duration: chunk.duration,
                            data: copyData(chunk)
                        });
                        muxer.addAudioChunk(newChunk);
                     }
                 }
            }
        }

        postResponse({ type: 'status', payload: { phase: 'Finalizing', progress: 100 } });
        const blob = muxer.getBlob();
        postResponse({ type: 'done', payload: blob });

    } catch (e) {
        console.error("Pipeline Failed", e);
        postResponse({ type: 'error', payload: e.message });
    } finally {
        cleanup();
    }
}
`;