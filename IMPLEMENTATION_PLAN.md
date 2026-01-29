# ShortMe Native Rendering Engine: Implementation Master Plan

**Objective:** Replace the existing `MediaRecorder` based export with a frame-perfect, hardware-accelerated WebCodecs pipeline running in a Web Worker.

---

## Phase 1: Infrastructure & Data Ingestion (The "Input" Layer)

**Goal:** Successfully read a video file inside a Web Worker and extract raw encoded chunks.

### Step 1: Worker Architecture Setup
*   **File:** `services/render/worker.ts` (New File)
*   **Action:** Create a standard Web Worker shell.
*   **Logic:**
    *   Implement message handlers: `initialize`, `start`, `cancel`.
    *   Define the `RenderConfig` interface (resolution, bitrate, crops).
    *   **Crucial:** Setup `MP4Box.js` import inside the worker context.

### Step 2: The Demuxer (MP4Box Integration)
*   **File:** `services/render/Demuxer.ts`
*   **Action:** Create a class that wraps `MP4Box`.
*   **Logic:**
    *   Ingest `File` or `Blob`.
    *   Extract `VideoTrack` and `AudioTrack` metadata (codec string, dimensions, duration).
    *   **Method:** `getChunks(start, end)`: Returns a stream of `EncodedVideoChunk` objects representing the video data.
*   **Validation:** Log the number of frames found in a 10-second clip.

---

## Phase 2: The Video Pipeline (The "Visual" Layer)

**Goal:** Decode raw chunks into visual frames, modify them with WebGL, and re-encode them.

### Step 3: The Video Decoder
*   **File:** `services/render/VideoProcessor.ts`
*   **Action:** Initialize `VideoDecoder`.
*   **Logic:**
    *   Configure with the codec string from the Demuxer (e.g., `avc1.4d002a`).
    *   Feed chunks from Step 2 into `decoder.decode(chunk)`.
    *   **Memory Safety:** Implement a "Queue Control" system. If the decoder outputs more than 5 frames that haven't been processed yet, pause input to prevent RAM crashes.

### Step 4: The WebGL Compositor (OffscreenCanvas)
*   **File:** `services/render/Compositor.ts`
*   **Action:** Create a WebGL2 Context on an `OffscreenCanvas`.
*   **Logic:**
    *   **Input:** Receive `VideoFrame` objects from the Decoder.
    *   **Shaders:** Write a Vertex Shader that handles the "Reframe" logic (Math-based cropping/scaling).
    *   **Texture Upload:** Upload the `VideoFrame` as an external texture (`OES_texture`).
    *   **Overlays:** Render images/text on top of the video texture using standard 2D/3D layering.
    *   **Output:** The `OffscreenCanvas` now holds the pixel-perfect frame.

### Step 5: The Video Encoder
*   **File:** `services/render/VideoProcessor.ts` (Add encoding logic)
*   **Action:** Initialize `VideoEncoder`.
*   **Logic:**
    *   **Config:** Set specific bitrates (e.g., 8Mbps for 1080p). Use `hardwareAcceleration: 'prefer-hardware'`.
    *   **Frame Passing:** Create a new `VideoFrame` from the `OffscreenCanvas` and pass it to `encoder.encode()`.
    *   **Keyframes:** Force a keyframe every 2 seconds for seekability.

---

## Phase 3: The Audio Pipeline (The "Sync" Layer)

**Goal:** Ensure audio exists and is perfectly synchronized with the video.

### Step 6: Audio Decoding & Mixing
*   **File:** `services/render/AudioProcessor.ts`
*   **Action:** Initialize `AudioDecoder`.
*   **Logic:**
    *   Decode raw audio chunks into `AudioData`.
    *   (Future Proofing) If we add background music later, we mix the PCM data here.

### Step 7: Audio Encoding
*   **File:** `services/render/AudioProcessor.ts`
*   **Action:** Initialize `AudioEncoder`.
*   **Logic:**
    *   Re-encode the PCM data to AAC (using `mp4a.40.2`).
    *   Ensure timestamps match the video frames exactly.

---

## Phase 4: Packaging & Output (The "File" Layer)

**Goal:** Combine the new video and audio streams into a downloadable file.

### Step 8: The Muxer
*   **File:** `services/render/Muxer.ts`
*   **Action:** Use `MP4Box.js` in "Write" mode.
*   **Logic:**
    *   Create a virtual file in memory.
    *   Add Video Track and Audio Track.
    *   Stream `EncodedVideoChunk` and `EncodedAudioChunk` from the encoders into MP4Box.
    *   **Optimization:** Flush chunks periodically to keep memory usage flat.

### Step 9: Main Thread Integration
*   **File:** `services/videoExportService.ts`
*   **Action:** Replace the existing `processVideoClip` function.
*   **Logic:**
    *   Instantiate the Worker.
    *   Transfer `OffscreenCanvas` control (if needed) or assets.
    *   Listen for `progress` events to update the UI bar.
    *   Listen for `complete` to trigger the download.

---

## Phase 5: Reliability & Fallbacks

**Goal:** Ensure the app doesn't crash on older devices.

### Step 10: Feature Detection & Fallback
*   **Logic:**
    *   Check `if ('VideoEncoder' in window)`.
    *   If missing (e.g., older Android/iOS), silently fall back to the old `MediaRecorder` implementation (Tier 2).

### Step 11: Memory Governance
*   **Logic:**
    *   Strictly call `frame.close()` on every single input and output frame.
    *   Implement a "Time-to-live" watchdog that kills the worker if rendering stalls for >10 seconds.

---

## Execution Order
1.  **Step 1, 2, 8:** Get the file system working (Demux -> Mux -> Download). Result: A file clone.
2.  **Step 3, 5:** Add Video Transcoding (Demux -> Decode -> Encode -> Mux). Result: A re-encoded video.
3.  **Step 4:** Add WebGL. Result: A cropped/reframed video.
4.  **Step 6, 7:** Add Audio. Result: A complete video with sound.
5.  **Step 9:** Hook into UI.
