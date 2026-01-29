
import { MP4Demuxer } from './MP4Demuxer';
import { MP4Muxer } from './MP4Muxer';
import { Compositor } from './Compositor';
import { WorkerCommand, WorkerResponse, RenderConfig } from './types';
import { OverlayConfig } from '../../types';

let demuxer: MP4Demuxer | null = null;
let muxer: MP4Muxer | null = null;
let compositor: Compositor | null = null;
let videoEncoder: VideoEncoder | null = null;
let videoDecoder: VideoDecoder | null = null;

let muxerHasVideoTrack = false;
let overlayBitmaps = new Map<string, ImageBitmap>();

self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
    if (e.data.type === 'init') {
        const { file, config } = (e.data as any).payload;
        await startPipeline(file, config);
    }
    if (e.data.type === 'cancel') cleanup();
};

const post = (msg: WorkerResponse) => self.postMessage(msg);

/* ---------------- CLEANUP ---------------- */

function cleanup() {
    try { videoDecoder?.close(); } catch {}
    try { videoEncoder?.close(); } catch {}

    overlayBitmaps.forEach(b => { try { b.close(); } catch {} });
    overlayBitmaps.clear();

    demuxer = null;
    muxer = null;
    compositor = null;
    videoEncoder = null;
    videoDecoder = null;
    muxerHasVideoTrack = false;
}

/* ---------------- OVERLAYS ---------------- */

async function prepareOverlays(overlays: OverlayConfig[]) {
    overlayBitmaps.clear();
    for (const o of overlays) {
        if (o.type === 'image' && o.file) {
            const bmp = await createImageBitmap(o.file);
            overlayBitmaps.set(o.id, bmp);
        }
    }
}

/* ---------------- PIPELINE ---------------- */

async function startPipeline(file: Blob, config: RenderConfig) {
    try {
        post({ type: 'status', payload: { phase: 'Init', progress: 0 } });

        demuxer = new MP4Demuxer();
        await demuxer.load(file);

        const videoChunks = await demuxer.getAllVideoChunks();
        const audioChunks = await demuxer.getAllAudioChunks();

        const decoderConfig = demuxer.getVideoConfig();
        if (!decoderConfig) throw new Error('No video track found');

        muxer = new MP4Muxer();

        const audioCfg = demuxer.getAudioConfig();
        if (audioCfg) {
            muxer.addAudioTrack({
                codec: audioCfg.codec,
                numberOfChannels: audioCfg.numberOfChannels,
                sampleRate: audioCfg.sampleRate,
                description: audioCfg.description
            });
        }

        compositor = new Compositor(config.width, config.height);
        if (config.overlays) {
            await prepareOverlays(config.overlays);
            compositor.updateOverlays(config.overlays, overlayBitmaps);
        }

        /* ---------- FILTER TIME RANGE ---------- */

        const startUs = (config.startTime ?? 0) * 1_000_000;
        const endUs = (config.endTime ?? Infinity) * 1_000_000;

        const validChunks = videoChunks.filter(
            c => c.timestamp >= startUs && c.timestamp <= endUs
        );

        if (!validChunks.length) throw new Error('No frames in selected range');

        /* ---------- HARD SEEK TO FIRST KEYFRAME ---------- */

        const firstKeyIndex = validChunks.findIndex(c => c.type === 'key');
        if (firstKeyIndex === -1) {
            throw new Error('No keyframe found in clip range');
        }

        const decodeChunks = validChunks.slice(firstKeyIndex);

        /* ---------- ENCODER ---------- */

        let firstVideoTimestamp: number | null = null;
        let lastKeyframeTime = -2_000_000;

        videoEncoder = new VideoEncoder({
            output: (chunk, meta) => {
                if (!muxerHasVideoTrack) {
                    const raw = meta.decoderConfig?.description;
                    const desc = raw ? new Uint8Array(raw as ArrayBuffer) : undefined;

                    muxer!.addVideoTrack({
                        codec: 'avc1.4d002a',
                        width: config.width,
                        height: config.height,
                        description: desc
                    });

                    muxer!.start();
                    muxerHasVideoTrack = true;
                }

                muxer!.addVideoChunk(chunk);
            },
            error: e => { throw e; }
        });

        videoEncoder.configure({
            codec: 'avc1.4d002a',
            width: config.width,
            height: config.height,
            bitrate: config.bitrate ?? 4_000_000,
            framerate: config.fps ?? 30
        });

        /* ---------- DECODER ---------- */

        let frames = 0;

        videoDecoder = new VideoDecoder({
            output: frame => {
                if (firstVideoTimestamp === null) {
                    firstVideoTimestamp = frame.timestamp;
                }

                const ts = frame.timestamp - firstVideoTimestamp;

                compositor!.render(frame);
                frame.close();

                const shouldKey =
                    ts - lastKeyframeTime >= 2_000_000;

                if (shouldKey) lastKeyframeTime = ts;

                const outFrame = compositor!.getOutputFrame(
                    ts,
                    frame.duration ?? undefined
                );

                videoEncoder!.encode(outFrame, { keyFrame: shouldKey });
                outFrame.close();

                frames++;
                if (frames % 15 === 0) {
                    post({
                        type: 'status',
                        payload: {
                            phase: 'Rendering',
                            progress: Math.round((frames / decodeChunks.length) * 100)
                        }
                    });
                }
            },
            error: e => { throw e; }
        });

        videoDecoder.configure(decoderConfig);

        /* ---------- PIPE ---------- */

        for (const chunk of decodeChunks) {
            while (videoDecoder.decodeQueueSize > 5) {
                await new Promise(r => setTimeout(r, 5));
            }
            videoDecoder.decode(chunk);
        }

        await videoDecoder.flush();
        await videoEncoder.flush();

        /* ---------- AUDIO PASSTHROUGH ---------- */

        if (audioCfg && firstVideoTimestamp !== null) {
            for (const a of audioChunks) {
                if (a.timestamp < startUs || a.timestamp > endUs) continue;

                const ts = a.timestamp - firstVideoTimestamp;
                if (ts < 0) continue;

                muxer.addAudioChunk(new EncodedAudioChunk({
                    type: a.type,
                    timestamp: ts,
                    duration: a.duration,
                    data: copyData(a)
                }));
            }
        }

        /* ---------- FINALIZE ---------- */

        const blob = muxer.getBlob();
        post({ type: 'done', payload: blob });

    } catch (e: any) {
        console.error(e);
        post({ type: 'error', payload: e.message });
    } finally {
        cleanup();
    }
}

/* ---------------- UTIL ---------------- */

function copyData(chunk: EncodedVideoChunk | EncodedAudioChunk): ArrayBuffer {
    const buffer = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(buffer);
    return buffer;
}
