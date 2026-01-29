

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  PROJECT_LIBRARY = 'PROJECT_LIBRARY',
  CLIP_CONFIG = 'CLIP_CONFIG',
  CLIP_GALLERY = 'CLIP_GALLERY',
  EDITOR = 'EDITOR',
  PRO_UPGRADE = 'PRO_UPGRADE',
  SETTINGS = 'SETTINGS'
}

export enum UserTier {
  FREE = 'FREE',
  PRO = 'PRO'
}

// Enhanced reframe data for OpenCV logic
export interface ReframeDataPoint {
    timestamp: number;
    centerX: number;
    centerY: number;
    scale?: number; // Zoom level (1.0 = fit height, >1.0 = zoomed in)
    debugBox?: { x: number, y: number, width: number, height: number }; // Normalized 0-1
}

export type OverlayType = 'text' | 'image' | 'video';
export type OverlayPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface OverlayConfig {
  id: string;
  type: OverlayType;
  content: string; // Text content or Blob URL
  position: OverlayPosition;
  scale: number; // 10 to 100 for media width %, 10 to 100 for font-size px approx
  style?: {
      color?: string;
      backgroundColor?: string;
      fontFamily?: string;
  };
  file?: File; // Keep reference for export if needed
}

export interface GeneratedClip {
  id: string;
  projectId: string;
  startTime: number;
  endTime: number;
  label: string;
  // Optional reframe data for smart crop
  reframeKeyframes?: ReframeDataPoint[];
  overlays?: OverlayConfig[];
}

export interface VideoProject {
  id: string;
  name: string;
  thumbnailUrl: string;
  videoUrl: string; // Blob URL for local playback
  duration: number;
  lastModified: Date;
  status: 'draft' | 'processing' | 'exported';
  aspectRatio: '9:16' | '16:9' | '1:1';
  generatedClips?: GeneratedClip[];
}

export interface TimelineSegment {
  id: string;
  startTime: number;
  endTime: number;
  type: 'video' | 'effect' | 'caption';
  label: string;
}

export interface GeminiAnalysisResult {
  viralScore: number;
  suggestedCuts: { start: number; end: number; reason: string }[];
  summary: string;
  keywords: string[];
}