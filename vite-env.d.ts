// /// <reference types="vite/client" />

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

// Fix for missing WebCodecs Audio Type
declare class EncodedAudioChunk {
  constructor(init: {
    type: 'key' | 'delta';
    timestamp: number;
    duration?: number;
    data: BufferSource;
  });
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;
  copyTo(destination: BufferSource): void;
}