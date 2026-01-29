import { MP4Demuxer } from './MP4Demuxer';
import { MP4Muxer } from './MP4Muxer';
import { Compositor } from './Compositor';
import { WorkerCommand, WorkerResponse, RenderConfig } from './types';
import { OverlayConfig } from '../../types';

// State
let demuxer: MP4Demuxer | null = null;
let muxer: MP4Muxer | null = null;
let compositor: Compositor | null = null;
let videoEncoder: VideoEncoder | null = null;
let videoDecoder: VideoDecoder | null = null;
let overlayBitmaps: Map<string, ImageBitmap> = new Map();
let muxerHasVideoTrack = false;

// Messaging
self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
    const { type } = e.data;

    if (type === 'init') {
        const { file, config } = (e.data as any).payload;
        await startPipeline(file, config);
    } 
    else if (type === 'cancel') {
        cleanup();
    }
};

const postResponse = (response: WorkerResponse) => {
    self.postMessage(response);
};

function cleanup() {
    if (videoDecoder) { 
        try { videoDecoder.close(); } catch(e){}
        videoDecoder = null; 
    }
    if (videoEncoder) { 
        try { videoEncoder.close(); } catch(e){}
        videoEncoder = null; 
    }
    overlayBitmaps.forEach(bmp => { try { bmp.close(); } catch(e){} });
    overlayBitmaps.clear();
    demuxer = null;
    muxer = null;
    compositor = null;
    muxerHasVideoTrack = false;
}

// --- ASSET PREPARATION ---
async function prepareOverlays(overlays: OverlayConfig[]) {
    overlayBitmaps.clear();
    for (const ov of overlays) {
        if (ov.type === 'image' && ov.file) {
            try {
                const bmp = await createImageBitmap(ov.file);
                overlayBitmaps.set(ov.id, bmp);
            } catch (e) {
                console.warn(`Failed to load image overlay ${ov.id}`, e);
            }
        }
    }
}

// --- MATH HELPERS ---
function getInterpolatedReframe(keyframes: any[], time: number) {
    if (!keyframes || keyframes.length === 0) return { x: 0.5, y: 0.5, scale: 1.0 };
    
    let k1 = keyframes[0];
    let k2 = keyframes[0];
    
    for (let i = 0; i < keyframes.length; i++) {
        if (keyframes[i].timestamp <= time) {
            k1 = keyframes[i];
        } else {
            k2 = keyframes[i];
            break;
        }
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


// --- PHASE 2: VISUAL PIPELINE (TRANSCODING) ---
async function startPipeline(file: Blob, config: RenderConfig) {
    try {
        postResponse({ type: 'status', payload: { phase: 'Initializing', progress: 0 } });
        
        const startTime = config.startTime || 0;
        const endTime = config.endTime || Infinity;
        const startMicro = startTime * 1_000_000;
        const endMicro = endTime * 1_000_000;

        // 0. Load Overlay Assets
        if (config.overlays && config.overlays.length > 0) {
            await prepareOverlays(config.overlays);
        }

        // 1. Demux (Get All Chunks for Buffering)
        demuxer = new MP4Demuxer();
        await demuxer.load(file);
        
        const videoChunks = await demuxer.getAllVideoChunks();
        const audioChunks = await demuxer.getAllAudioChunks();

        const decoderConfig = demuxer.getVideoConfig();
        if (!decoderConfig) throw new Error("No video track found.");

        // 2. Setup Muxer (Output) - Track added lazily
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

        // 3. Setup Visual Components
        compositor = new Compositor(config.width, config.height);
        
        // Bake Overlays once (since they are static per clip)
        if (config.overlays) {
            compositor.updateOverlays(config.overlays, overlayBitmaps);
        }

        // 4. Setup Encoder
        let framesProcessed = 0;
        const validChunks = videoChunks.filter(c => c.timestamp >= startMicro && c.timestamp <= endMicro);
        const totalVideoFrames = validChunks.length;
        
        let encoderResolve: () => void;
        let encoderReject: (e: any) => void;
        const encoderPromise = new Promise<void>((res, rej) => { encoderResolve = res; encoderReject = rej; });

        // Adaptive Bitrate: Calculate based on Resolution and FPS
        const pixelCount = config.width * config.height;
        const targetFps = config.fps || 30;
        const calculatedBitrate = Math.floor(pixelCount * targetFps * 0.15);
        const finalBitrate = config.bitrate ? config.bitrate : Math.max(2_000_000, calculatedBitrate);

        videoEncoder = new VideoEncoder({
            output: (chunk, meta) => {
                // Lazy Track Initialization to capture Encoder Description
                if (muxer && !muxerHasVideoTrack) {
                    // Convert description to Uint8Array safely
                    const rawDesc = meta.decoderConfig?.description;
                    let description: Uint8Array | undefined;
                    
                    if (rawDesc) {
                        if (rawDesc instanceof Uint8Array) {
                            description = rawDesc;
                        } else {
                            // Safely handle ArrayBuffer or other buffer source types
                            description = new Uint8Array(rawDesc as ArrayBuffer);
                        }
                    }

                    muxer.addVideoTrack({
                        width: config.width,
                        height: config.height,
                        codec: 'avc1.4d002a',
                        description: description
                    });
                    muxerHasVideoTrack = true;
                }
                muxer?.addVideoChunk(chunk);
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

        // 5. Setup Decoder
        let timestampOffset: number | null = null;
        let pendingFrames = 0;
        // Keyframe Logic: Force keyframe every 2 seconds for seekability
        const KEYFRAME_INTERVAL = 2_000_000; // microseconds
        let lastKeyFrameTime = -KEYFRAME_INTERVAL;

        videoDecoder = new VideoDecoder({
            output: async (frame) => {
                pendingFrames--; 
                
                // Reframe Math
                const reframe = getInterpolatedReframe(config.reframeKeyframes || [], frame.timestamp / 1_000_000);
                
                // Draw (Video + Overlays)
                compositor!.render(frame, reframe);
                frame.close(); 

                // Encode
                if (timestampOffset === null) timestampOffset = frame.timestamp;
                const newTimestamp = frame.timestamp - timestampOffset;

                // Robust null handling for duration
                const frameDuration = frame.duration || undefined;
                const newFrame = compositor!.getOutputFrame(newTimestamp, frameDuration);
                
                // Smart Keyframe insertion
                const shouldKeyFrame = (newTimestamp - lastKeyFrameTime) >= KEYFRAME_INTERVAL;
                if (shouldKeyFrame) lastKeyFrameTime = newTimestamp;

                videoEncoder!.encode(newFrame, { keyFrame: shouldKeyFrame });
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

        // 6. The Pipeline Loop
        postResponse({ type: 'status', payload: { phase: 'Rendering', progress: 0 } });
        
        if (validChunks.length > 0) {
            timestampOffset = validChunks[0].timestamp;
        }

        for (const chunk of validChunks) {
            // BACKPRESSURE: Prevent memory overload
            while (videoDecoder.decodeQueueSize > 5) {
                await new Promise(r => setTimeout(r, 10));
            }
            videoDecoder.decode(chunk);
            pendingFrames++;
        }

        await videoDecoder.flush();
        await videoEncoder.flush();

        // 7. Audio Passthrough
        if (audioConfig) {
            const validAudio = audioChunks.filter(c => c.timestamp >= startMicro && c.timestamp <= endMicro);
            for (const chunk of validAudio) {
                 if (timestampOffset !== null) {
                     const newTs = chunk.timestamp - timestampOffset;
                     // Only include audio that starts after video starts (avoid negative sync)
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

        console.log("Transcoding Complete");
        postResponse({ type: 'status', payload: { phase: 'Finalizing', progress: 100 } });

        const blob = muxer.getBlob();
        postResponse({ type: 'done', payload: blob });

    } catch (e: any) {
        console.error("Pipeline Failed", e);
        postResponse({ type: 'error', payload: e.message });
    } finally {
        cleanup();
    }
}

function copyData(chunk: any): ArrayBuffer {
    const buffer = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(buffer);
    return buffer;
}