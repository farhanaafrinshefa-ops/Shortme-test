// Removed invalid reference to vite/client to fix "Cannot find type definition file" error
// /// <reference types="vite/client" />

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

// WebCodecs Type Definitions
// These are added to support environments where DOM WebCodecs types are missing.

type BufferSource = ArrayBufferView | ArrayBuffer;

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

interface EncodedVideoChunkInit {
    type: 'key' | 'delta';
    timestamp: number;
    duration?: number;
    data: BufferSource;
}

declare class EncodedVideoChunk {
    constructor(init: EncodedVideoChunkInit);
    readonly type: 'key' | 'delta';
    readonly timestamp: number;
    readonly duration: number | null;
    readonly byteLength: number;
    copyTo(destination: BufferSource): void;
}
