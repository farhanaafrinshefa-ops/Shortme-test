import { ReframeDataPoint } from '../types';
import { FaceLandmarker, FilesetResolver, FaceLandmarkerResult } from "@mediapipe/tasks-vision";

export type ReframeKeyframe = ReframeDataPoint;

export interface ReframeConfig {
    mood: 'cinematic' | 'cut' | 'smart';
    cameraSpeed: 'slow' | 'normal' | 'fast';
    framingTightness: 'wide' | 'normal' | 'tight'; 
    scanMode: 'faster' | 'normal' | 'perfect';
}

// --- SINGLETON AI ---
let visionResolverPromise: Promise<any> | null = null;
let landmarkerInstance: FaceLandmarker | null = null;

export const resetFaceDetector = () => {
    if (landmarkerInstance) {
        try { landmarkerInstance.close(); } catch(e) { console.warn("Failed to close landmarker", e); }
        landmarkerInstance = null;
    }
};

const createFaceLandmarker = async (): Promise<FaceLandmarker> => {
    if (landmarkerInstance) return landmarkerInstance;

    if (!visionResolverPromise) {
        visionResolverPromise = FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        );
    }
    const vision = await visionResolverPromise;

    // STRATEGY: Attempt GPU first. Only fallback to CPU if GPU fails.
    try {
        console.log("AI Engine: Attempting GPU initialization...");
        landmarkerInstance = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
                delegate: "GPU"
            },
            runningMode: "IMAGE",
            numFaces: 1, // Optimization: Track main speaker only for stability
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
        });
        console.log("AI Engine: GPU Delegate Active. Hardware Acceleration Enabled.");
    } catch (gpuError) {
        console.warn("AI Engine: GPU Initialization failed. Falling back to CPU.", gpuError);
        
        // Fallback to CPU
        landmarkerInstance = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
                delegate: "CPU"
            },
            runningMode: "IMAGE",
            numFaces: 1
        });
        console.log("AI Engine: CPU Delegate Active (Standard Driver).");
    }
    return landmarkerInstance!;
};

// --- TYPES & HELPERS ---
interface RawDetection {
    timestamp: number;
    centerX: number;
    centerY: number;
    width: number; 
    height: number;
    score: number;
    isSpeaking: boolean;
}

interface ShotSegment {
    start: number;
    end: number;
    isStatic: boolean;
}

// Helper: Calculate normalized pixel difference (0.0 - 1.0)
const calculatePixelDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
    let diff = 0;
    // Iterate RGBA buffer. Length is 32*32*4
    for (let i = 0; i < a.length; i += 4) {
        // Simple luminance diff
        const lumA = 0.299*a[i] + 0.587*a[i+1] + 0.114*a[i+2];
        const lumB = 0.299*b[i] + 0.587*b[i+1] + 0.114*b[i+2];
        diff += Math.abs(lumA - lumB);
    }
    // Normalize: max diff per pixel is 255. Total pixels a.length/4.
    return diff / ((a.length / 4) * 255);
};

// Helper: Calculate Mouth Openness from Landmarks
const calculateMouthOpenness = (landmarks: any[]): number => {
    if (!landmarks || landmarks.length < 15) return 0;
    const upper = landmarks[13];
    const lower = landmarks[14];
    return Math.abs(lower.y - upper.y);
};

// --- MAIN ENGINE ---

export const analyzeVideoForReframe = async (
  videoUrl: string, 
  onProgress: (percent: number, debugInfo?: ReframeKeyframe) => void,
  signal?: AbortSignal,
  manualPoint?: { x: number, y: number },
  existingVideoElement?: HTMLVideoElement,
  targetAspectRatio: '9:16' | '16:9' | '1:1' = '9:16',
  config: ReframeConfig = { mood: 'smart', cameraSpeed: 'normal', framingTightness: 'normal', scanMode: 'normal' }
): Promise<ReframeKeyframe[]> => {
  
  // Initialize AI
  if (!landmarkerInstance) await createFaceLandmarker();
  const landmarker = landmarkerInstance!;
  
  return new Promise(async (resolve, reject) => {
    // 1. SETUP VIDEO & CANVAS
    const video = document.createElement('video');
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    
    // Use fixed position and opacity 0 to ensure it's "visible" to the DOM but not the user
    // This is required for some browsers to render frames to canvas correctly
    video.style.position = 'fixed';
    video.style.top = '-10000px';
    video.style.left = '0';
    video.style.width = '320px'; 
    video.style.height = '180px';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    
    document.body.appendChild(video); 

    // Echo canvas for shot detection (small, needs CPU access)
    const echoCanvas = document.createElement('canvas');
    echoCanvas.width = 64; 
    echoCanvas.height = 64;
    const echoCtx = echoCanvas.getContext('2d', { willReadFrequently: true });

    // Processing canvas for Face Detection (Downscaled for performance)
    // Removed willReadFrequently: true to prefer GPU backing if available for landmarker
    const processCanvas = document.createElement('canvas');
    const processCtx = processCanvas.getContext('2d');
    
    const cleanup = () => {
        if(video.parentNode) video.parentNode.removeChild(video);
        video.src = "";
        video.load();
        echoCanvas.remove();
        processCanvas.remove();
    };

    if (signal?.aborted) { cleanup(); reject(new Error("Aborted")); return; }

    await new Promise(r => { 
        video.onloadedmetadata = () => { setTimeout(r, 100); }; 
        video.onerror = (e) => reject(e);
    });
    
    const duration = video.duration || 10;

    // --- CONFIGURATION TUNING ---
    let PHASE1_INTERVAL = 1.0; 
    let RECURSION_STOP_THRESHOLD = 0.5;

    if (config.scanMode === 'faster') {
        PHASE1_INTERVAL = 3.0; 
        RECURSION_STOP_THRESHOLD = 2.0;
    } else if (config.scanMode === 'perfect') {
        PHASE1_INTERVAL = 0.5;
        RECURSION_STOP_THRESHOLD = 0.2;
    }

    // --- DETECTION HELPER ---
    const detectFrame = async (time: number): Promise<RawDetection | null> => {
        if (signal?.aborted) throw new Error("Aborted");
        video.currentTime = time;
        await new Promise(r => {
            const h = () => { video.removeEventListener('seeked', h); r(true); };
            video.addEventListener('seeked', h);
        });

        if (echoCtx) echoCtx.drawImage(video, 0, 0, 64, 64);

        try {
            if (video.videoWidth === 0 || video.videoHeight === 0) return null;

            // PERFORMANCE OPTIMIZATION: 
            // Downscale frame for detection to ~360p width.
            const TARGET_WIDTH = 360;
            let renderW = video.videoWidth;
            let renderH = video.videoHeight;
            
            if (renderW > TARGET_WIDTH) {
                const scale = TARGET_WIDTH / renderW;
                renderW = TARGET_WIDTH;
                renderH = video.videoHeight * scale;
            }

            if (processCanvas.width !== renderW || processCanvas.height !== renderH) {
                processCanvas.width = renderW;
                processCanvas.height = renderH;
            }

            if (processCtx) {
                processCtx.drawImage(video, 0, 0, renderW, renderH);
                
                // Use the canvas instead of the video element for detection
                // Result coordinates are normalized [0,1], so scaling doesn't affect accuracy
                const result: FaceLandmarkerResult = landmarker.detect(processCanvas);
                
                if (result.faceLandmarks.length > 0) {
                    let bestFace: RawDetection | null = null;
                    let maxScore = -1;

                    for(let i=0; i<result.faceLandmarks.length; i++) {
                        const landmarks = result.faceLandmarks[i];
                        
                        let minX = 1, minY = 1, maxX = 0, maxY = 0;
                        for(const pt of landmarks) {
                            if (pt.x < minX) minX = pt.x;
                            if (pt.x > maxX) maxX = pt.x;
                            if (pt.y < minY) minY = pt.y;
                            if (pt.y > maxY) maxY = pt.y;
                        }
                        const width = maxX - minX;
                        const height = maxY - minY;
                        const centerX = minX + width/2;
                        const centerY = minY + height/2;

                        const area = width * height;
                        const centerBias = 1.0 - Math.abs(centerX - 0.5); 
                        
                        const mouthOpenness = calculateMouthOpenness(landmarks);
                        const isSpeaking = mouthOpenness > 0.015;
                        
                        let score = (centerBias * 20) + (area * 30);
                        if (isSpeaking) score += 100;

                        if(score > maxScore) { 
                            maxScore = score; 
                            bestFace = {
                                timestamp: time,
                                centerX,
                                centerY,
                                width,
                                height,
                                score,
                                isSpeaking
                            }; 
                        }
                    }
                    return bestFace;
                }
            }
        } catch(e) { console.warn("Detection warning:", e); }
        return null;
    };

    // --- PHASE 1: VISUAL ECHO SCAN (SHOT DETECTION) ---
    const shots: ShotSegment[] = [];
    const activityMap = new Map<number, number>(); 

    try {
        const CUT_THRESHOLD = 0.25; 
        const STATIC_THRESHOLD = 0.03; 

        let lastPixels: Uint8ClampedArray | null = null;
        let lastTime = 0;
        let shotStart = 0;
        let isCurrentShotStatic = true;

        // Visual Echo Loop
        for (let t = 0; t < duration; t += PHASE1_INTERVAL) {
            video.currentTime = t;
            await new Promise(r => { 
                const h = () => { video.removeEventListener('seeked', h); r(true); };
                video.addEventListener('seeked', h); 
            });

            if (echoCtx) {
                echoCtx.drawImage(video, 0, 0, 64, 64);
                const pixels = echoCtx.getImageData(0, 0, 64, 64).data;
                
                if (lastPixels) {
                    const diff = calculatePixelDiff(lastPixels, pixels);
                    activityMap.set(t, diff);

                    if (diff > CUT_THRESHOLD) {
                         shots.push({ start: shotStart, end: lastTime, isStatic: isCurrentShotStatic });
                         shotStart = t;
                         isCurrentShotStatic = true; 
                    } else {
                        if (diff > STATIC_THRESHOLD) isCurrentShotStatic = false;
                    }
                }
                lastPixels = pixels;
            }
            lastTime = t;
            // Progress: Phase 1 is 20% of total
            onProgress((t / duration) * 20); 
        }
        shots.push({ start: shotStart, end: duration, isStatic: isCurrentShotStatic });


        // --- PHASE 2: ADAPTIVE ANCHOR SCAN (RECURSIVE) ---
        const anchorPoints: RawDetection[] = [];
        
        const processSegment = async (t1: number, t2: number, d1: RawDetection | null, d2: RawDetection | null, depth: number) => {
            const dt = t2 - t1;
            
            if (dt < RECURSION_STOP_THRESHOLD) return; 

            // Yield to main thread to prevent UI freeze
            await new Promise(r => setTimeout(r, 0));

            let needsSplit = false;
            let forceSplit = false;

            // CHECK 1: Detection Existence Mismatch
            if ((!d1 && d2) || (d1 && !d2)) {
                needsSplit = true;
                forceSplit = true;
            } 
            // CHECK 2: Position Mismatch
            else if (d1 && d2) {
                const dx = Math.abs(d1.centerX - d2.centerX);
                if (dx > 0.1) {
                    needsSplit = true;
                    if (dx > 0.3) forceSplit = true;
                }
            }

            // CHECK 3: Visual Activity
            if (!needsSplit) {
                let maxActivity = 0;
                for (const [t, diff] of activityMap.entries()) {
                    if (t > t1 && t < t2) maxActivity = Math.max(maxActivity, diff);
                }
                if (maxActivity > STATIC_THRESHOLD * 3) {
                    needsSplit = true; 
                }
            }

            if (needsSplit) {
                const mid = (t1 + t2) / 2;
                const dMid = await detectFrame(mid);
                
                if (dMid) {
                    anchorPoints.push(dMid);
                    onProgress(20 + (mid/duration)*70, {
                        timestamp: mid,
                        centerX: dMid.centerX,
                        centerY: dMid.centerY,
                        debugBox: { x: (dMid.centerX - dMid.width/2), y: (dMid.centerY - dMid.height/2), width: dMid.width, height: dMid.height }
                    });
                }

                if (!forceSplit && depth > 2 && config.scanMode === 'faster') {
                    // Stop early for speed
                } else {
                    await processSegment(t1, mid, d1, dMid, depth + 1);
                    await processSegment(mid, t2, dMid, d2, depth + 1);
                }
            }
        };

        // Process each Shot
        for (const shot of shots) {
             const startDet = await detectFrame(shot.start);
             if (startDet) anchorPoints.push(startDet);
             
             const endDet = await detectFrame(shot.end);
             if (endDet) anchorPoints.push(endDet);

             if (shot.isStatic && config.scanMode === 'faster') {
                 continue; 
             }
             
             await processSegment(shot.start, shot.end, startDet, endDet, 0);
        }

        anchorPoints.sort((a,b) => a.timestamp - b.timestamp);


        // --- PHASE 3: VIRTUAL CINEMATOGRAPHER (PHYSICS) ---
        const finalKeyframes: ReframeKeyframe[] = [];
        const DEFAULT_OFFSET_Y = -0.05; 

        if (anchorPoints.length === 0) {
            finalKeyframes.push({ timestamp: 0, centerX: 0.5, centerY: 0.5 + DEFAULT_OFFSET_Y, scale: 1 });
            finalKeyframes.push({ timestamp: duration, centerX: 0.5, centerY: 0.5 + DEFAULT_OFFSET_Y, scale: 1 });
        } else {
            // Physics Params
            let k = 5.0; // Stiffness
            let d = 3.0; // Damping
            
            if (config.cameraSpeed === 'fast') { k = 10.0; d = 2.0; }
            if (config.cameraSpeed === 'slow') { k = 2.0; d = 4.0; }
            
            let camPos = anchorPoints[0].centerX;
            let camVel = 0;
            const SIM_STEP = 1/30; 
            let currentAnchorIdx = 0;

            for (let t = 0; t <= duration; t += SIM_STEP) {
                while (currentAnchorIdx < anchorPoints.length - 1 && anchorPoints[currentAnchorIdx + 1].timestamp < t) {
                    currentAnchorIdx++;
                }
                
                const currA = anchorPoints[currentAnchorIdx];
                const nextA = anchorPoints[currentAnchorIdx + 1] || currA;
                
                let rawTarget = currA.centerX;
                let isCut = false;

                if (nextA !== currA) {
                    const range = nextA.timestamp - currA.timestamp;
                    const dist = Math.abs(nextA.centerX - currA.centerX);
                    
                    if (config.mood === 'cut') {
                         if (t >= currA.timestamp + range/2) rawTarget = nextA.centerX;
                         else rawTarget = currA.centerX;
                         if (dist > 0.1) isCut = true;

                    } else if (config.mood === 'smart') {
                        if (dist > 0.2) { 
                            if (t >= currA.timestamp + range/2) rawTarget = nextA.centerX;
                            else rawTarget = currA.centerX;
                            isCut = true;
                        } else {
                            const progress = (t - currA.timestamp) / range;
                            rawTarget = currA.centerX + (nextA.centerX - currA.centerX) * progress;
                        }
                    } else {
                        const progress = (t - currA.timestamp) / range;
                        rawTarget = currA.centerX + (nextA.centerX - currA.centerX) * progress;
                    }
                }

                if (isCut && (config.mood === 'cut' || config.mood === 'smart')) {
                     camPos = rawTarget;
                     camVel = 0;
                } else {
                     const force = (rawTarget - camPos) * k - (camVel * d);
                     camVel += force * SIM_STEP;
                     camPos += camVel * SIM_STEP;
                }

                camPos = Math.max(0, Math.min(1, camPos));

                finalKeyframes.push({
                    timestamp: t,
                    centerX: camPos,
                    centerY: 0.5 + DEFAULT_OFFSET_Y,
                    scale: 1.0 
                });
            }
        }
        
        onProgress(100);
        cleanup();
        resolve(finalKeyframes);

    } catch (e) {
        cleanup();
        reject(e);
    }
  });
};

export const getInterpolatedReframe = (keyframes: ReframeKeyframe[], time: number): { x: number, y: number, scale: number } => {
    if (!keyframes || keyframes.length === 0) return { x: 0.5, y: 0.5, scale: 1.0 };
    
    let low = 0, high = keyframes.length - 1;
    let idx = 0;

    while (low <= high) {
        const mid = (low + high) >>> 1;
        if (keyframes[mid].timestamp <= time) {
            idx = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    
    const k1 = keyframes[idx];
    const k2 = keyframes[idx + 1] || k1;
    
    const dt = k2.timestamp - k1.timestamp;
    if (dt <= 0.0001) return { x: k1.centerX, y: k1.centerY, scale: k1.scale || 1 };

    const t = (time - k1.timestamp) / dt;
    const clampedT = Math.max(0, Math.min(1, t));

    return {
        x: k1.centerX + (k2.centerX - k1.centerX) * clampedT,
        y: k1.centerY + (k2.centerY - k1.centerY) * clampedT,
        scale: (k1.scale || 1) + ((k2.scale || 1) - (k1.scale || 1)) * clampedT
    };
};