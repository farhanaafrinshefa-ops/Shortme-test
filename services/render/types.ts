import { ReframeKeyframe } from '../reframeService';
import { OverlayConfig } from '../../types';

export interface RenderConfig {
    width: number;
    height: number;
    fps: number;
    bitrate: number; // in bits per second
    startTime: number; // in seconds
    endTime: number; // in seconds
    reframeKeyframes?: ReframeKeyframe[];
    overlays?: OverlayConfig[];
}

export interface RenderJob {
    file: File | Blob;
    config: RenderConfig;
}

// Messages SENT to the Worker
export type WorkerCommand = 
  | { type: 'init'; payload: RenderJob }
  | { type: 'cancel' };

// Messages RECEIVED from the Worker
export type WorkerResponse = 
  | { type: 'status'; payload: { phase: string; progress: number } }
  | { type: 'error'; payload: string }
  | { type: 'done'; payload: Blob }; // The final MP4 file

export type VideoDecoderConfig = {
    codec: string;
    codedWidth: number;
    codedHeight: number;
    description?: Uint8Array;
};
