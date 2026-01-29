import { GeneratedClip, OverlayConfig } from '../types';
import { ReframeKeyframe } from './reframeService';
import { RenderConfig, WorkerCommand, WorkerResponse } from './render/types';
import { RENDER_WORKER_CODE } from './render/RenderWorkerShim';

export interface ExportSettings {
  width: number;
  height: number;
  fps: number; // 0 = Original
  qualityLabel: string; // e.g., '1080p'
  format: 'mp4' | 'webm';
  mimeType: string;
  reframeKeyframes?: ReframeKeyframe[]; 
  overlays?: OverlayConfig[]; 
}

export interface VideoFormat {
  label: string;
  value: 'mp4' | 'webm';
  mimeType: string;
  extension: string;
}

export const getSupportedFormats = (): VideoFormat[] => {
  return [
      { label: 'MP4 (Native Fast)', value: 'mp4', mimeType: 'video/mp4', extension: 'mp4' }
  ];
};

export const processVideoClip = async (
  sourceUrl: string, 
  clip: GeneratedClip, 
  config: ExportSettings,
  onProgress: (progress: number) => void,
  signal?: AbortSignal
): Promise<Blob> => {
  
  // PHASE 5: FEATURE DETECTION (Reliability)
  if (!('VideoEncoder' in window) || !('VideoDecoder' in window)) {
      throw new Error("Your browser does not support hardware acceleration (WebCodecs). Please use a newer browser (Chrome 94+, Safari 16.4+).");
  }
  if (!('OffscreenCanvas' in window)) {
      throw new Error("Your browser does not support OffscreenCanvas. Please update your browser.");
  }

  // Capability Check: Can this device encode at this resolution/FPS?
  const codec = 'avc1.4d002a'; // High Profile
  const targetFps = config.fps || 30;
  // Use same heuristic as worker to check support
  const targetBitrate = Math.floor(config.width * config.height * targetFps * 0.15);

  try {
      const support = await VideoEncoder.isConfigSupported({
          codec: codec,
          width: config.width,
          height: config.height,
          bitrate: targetBitrate,
          framerate: targetFps
      });
      
      if (!support.supported) {
          console.warn("High Profile AVC not supported, checking capability for Baseline...");
      }
  } catch (e: any) {
      console.warn("Config support check failed", e);
      if (e.message && e.message.includes("Your device")) throw e;
  }

  // 1. Fetch Source File as Blob
  const response = await fetch(sourceUrl);
  const sourceBlob = await response.blob();

  return new Promise((resolve, reject) => {
    
    // 2. Initialize Worker using BLOB approach to avoid path issues
    const blob = new Blob([RENDER_WORKER_CODE], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl, { type: 'module' });

    // Handle Cancellation
    if (signal) {
        signal.addEventListener('abort', () => {
            worker.postMessage({ type: 'cancel' });
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
            reject(new DOMException('Aborted', 'AbortError'));
        });
    }

    // 3. Worker Messaging
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const { type, payload } = e.data;

        if (type === 'status') {
            if (payload.progress !== undefined) {
                onProgress(payload.progress);
            }
        } 
        else if (type === 'done') {
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
            resolve(payload as Blob);
        } 
        else if (type === 'error') {
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
            console.error("Render Worker Error:", payload);
            reject(new Error(typeof payload === 'string' ? payload : 'Render failed'));
        }
    };

    worker.onerror = (e) => {
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        console.error("Worker Infrastructure Error:", e);
        reject(new Error("Worker failed to start. Check console for 404s or CSP issues."));
    };

    // 4. Send Start Command
    const renderConfig: RenderConfig = {
        width: config.width,
        height: config.height,
        fps: config.fps,
        bitrate: targetBitrate, // Pass the calculated bitrate or let worker recalc
        startTime: clip.startTime,
        endTime: clip.endTime,
        reframeKeyframes: config.reframeKeyframes,
        overlays: config.overlays
    };

    const command: WorkerCommand = {
        type: 'init',
        payload: {
            file: sourceBlob,
            config: renderConfig
        }
    };

    worker.postMessage(command);
  });
};

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
};