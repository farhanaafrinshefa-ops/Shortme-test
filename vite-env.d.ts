// Removed vite/client reference which was causing type resolution errors
// /// <reference types="vite/client" />

/**
 * WebCodecs Type Definitions
 * Polyfill for environments where EncodedAudioChunk is missing
 */
interface EncodedAudioChunkInit {
  type: 'key' | 'delta';
  timestamp: number;
  duration?: number;
  data: BufferSource;
}

declare class EncodedAudioChunk {
  constructor(init: EncodedAudioChunkInit);
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;
  copyTo(destination: BufferSource): void;
}

declare module 'mp4box' {
  const MP4Box: any;
  export default MP4Box;
}

declare module '*.svg' {
  import * as React from 'react';
  export const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement> & { title?: string }>;
  const src: string;
  export default src;
}

declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.bmp';
declare module '*.tiff';
