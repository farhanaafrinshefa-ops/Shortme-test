# ShortMe Native Rendering Engine Blueprint

**Goal:** Create a "Native-Grade" rendering engine inside the browser that utilizes GPU/CPU hardware acceleration (WebCodecs) to achieve frame-perfect rendering, 4K export, and instant trimming without relying on the DOM or `MediaRecorder`.

---

## 1. The Core Technology Stack

To bypass the limitations of `HTMLVideoElement` and `Canvas.captureStream()`, we will talk directly to the browser's media engine.

| Technology | Role | Benefit |
| :--- | :--- | :--- |
| **WebCodecs API** (`VideoDecoder` & `VideoEncoder`) | **Hardware Access** | Provides low-level access to the device's GPU to decode input and encode output. Vastly faster than real-time playback (e.g., rendering 1 min in 10s). |
| **Web Workers** | **Concurrency** | Runs the entire rendering engine on a separate CPU thread. The UI never freezes while exporting. |
| **WebGL 2 / WebGPU** | **Compositor** | Replaces the HTML Canvas 2D context. Handles reframing (cropping), scaling, color grading, and overlay blending using GPU Shaders. |
| **MP4Box.js** | **Containerizer** | Packages the raw media chunks output by WebCodecs into a valid `.mp4` file for download. |
| **OffscreenCanvas** | **Surface** | Allows GPU rendering contexts to exist inside a Web Worker, decoupling rendering from the DOM. |

---

## 2. The Architecture Workflow

### Phase A: The Setup (Main Thread)
1.  **Serialization:** The React app bundles the `Project`, `Clips`, `ReframeData`, and `Overlays` into a JSON configuration object (Edit Decision List - EDL).
2.  **Asset Buffering:** File Blobs (Video, Images, Fonts) are transferred to the Worker (using `transferable` objects where possible to zero-copy).
3.  **Worker Handoff:** The EDL and Assets are posted to the Dedicated Web Worker.

### Phase B: The Pipeline (Worker Thread)
This pipeline runs in a loop until all frames are processed.

**Step 1: Demuxing & Decoding (Frame Extraction)**
*   **Demux:** Use `mp4box.js` to parse the input video file and locate the byte offsets of frames corresponding to the Clip's `startTime` and `endTime`.
*   **Decode:** Feed these encoded chunks into `VideoDecoder`.
*   **Optimization:** Only decode frames within the trim range. Skip everything before `startTime`.

**Step 2: The GPU Compositor (WebGL)**
*   The `VideoDecoder` outputs a `VideoFrame` (a texture on GPU memory).
*   **Vertex Shader:** Applies `ReframeLogic`. Takes `centerX`, `centerY`, and `scale` to transform geometry, cropping the 9:16 vertical slice from the 16:9 source.
*   **Fragment Shader:** Renders the texture, handles color space conversion (YUV -> RGB).
*   **Overlays:** Textures for stickers/images and text bitmaps are drawn on top using standard alpha blending.

**Step 3: Encoding (Hardware Acceleration)**
*   The resulting WebGL canvas is drawn to a new `VideoFrame`.
*   Pass this frame to `VideoEncoder`.
*   **Configuration:**
    ```javascript
    const config = {
      codec: 'avc1.4d002a', // H.264 High Profile
      width: 1080,
      height: 1920,
      bitrate: 12_000_000, // 12 Mbps
      framerate: 60,
      hardwareAcceleration: 'prefer-hardware', // FORCE GPU
    };
    ```

**Step 4: Muxing**
*   The encoder outputs `EncodedVideoChunk` objects.
*   `MP4Box.js` writes these chunks into a virtual file in memory.

### Phase C: The Download
1.  Worker generates a final `Blob`.
2.  Blob is posted back to Main Thread.
3.  Browser initiates download.

---

## 3. "Smart Render" (Passthrough Mode)

**Scenario:** User wants to trim the video *without* applying reframe/crop/overlays.

1.  **Bypass Pipeline:** Skip `VideoDecoder` and `VideoEncoder`.
2.  **Keyframe Logic:** Identify "Keyframes" (I-Frames) nearest to `startTime` and `endTime`.
3.  **Packet Copy:** Extract raw binary NAL units from the source.
4.  **Remux:** Write them into a new container.
5.  **Result:** Instantaneous export (copying bytes, not processing pixels).

---

## 4. "Exact Preview" (WYSIWYG) Strategy

To ensure the downloaded video looks *exactly* like the preview:

1.  **Unified Math Kernel:**
    *   Create a shared utility function: `calculateCropMatrix(timestamp, reframeData)`.
    *   **React:** Uses this to apply CSS `transform` and `object-position`.
    *   **WebGL:** Uses this to calculate Vertex Shader attributes.
2.  **Time Sync:**
    *   Do not rely on `video.currentTime` (which is float).
    *   Use Frame Indices (e.g., Frame #450).
    *   If video is 30fps, 1.0s = Frame 30.

---

## 5. Production-Grade Improvements

To move from "Prototype" to "World-Class":

1.  **Adaptive Encoding:**
    *   Don't hardcode bitrate. Calculate it based on output resolution and FPS.
    *   `(Width * Height * FPS * 0.15) = Target Bitrate`.
2.  **Audio Pipeline (Critical):**
    *   Implement `AudioDecoder` and `AudioEncoder`.
    *   Mix audio if overlays have sound.
    *   Ensure A/V sync by tracking timestamps (`timestamp` vs `duration`).
3.  **Memory Discipline:**
    *   Explicitly call `frame.close()` immediately after rendering.
    *   Cap "in-flight" frames (e.g., max 10 frames in queue) to prevent crashing mobile browser memory.
4.  **Color Management:**
    *   Handle `BT.709` vs `BT.601` color spaces in the Fragment Shader to prevent "washed out" exports.

---

## 6. Real-World Constraints & Fallbacks

1.  **Browser Support:**
    *   **WebCodecs** is not available on older browsers or specific WebView implementations.
    *   **Safari iOS:** Has specific memory limits for Canvas in Workers.
2.  **Fallback Strategy:**
    *   **Tier 1 (Best):** WebCodecs + WebGL (GPU).
    *   **Tier 2 (Compatibility):** `MediaRecorder` + `Canvas` playback (Real-time).
    *   **Tier 3 (Universal):** FFmpeg.wasm (Software encoding, slow but reliable).

## 7. Implementation Roadmap

1.  **Step 1:** Create `VideoWorker.ts` and set up the message passing interface.
2.  **Step 2:** Implement `MP4Demuxer` using mp4box.js inside the worker.
3.  **Step 3:** Implement the `VideoDecoder` loop to log frames to console.
4.  **Step 4:** Set up `OffscreenCanvas` and basic WebGL renderer.
5.  **Step 5:** Connect `VideoEncoder` and Muxing logic.
6.  **Step 6:** Add Audio pipeline.
