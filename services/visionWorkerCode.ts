// This file exports the worker code as a string to ensure it runs without specific bundler configuration for workers.
// It implements the "Vision" engine blueprint.

export const VISION_WORKER_CODE = `
// Use a try-catch block for the entire script execution to catch early errors
try {
    self.importScripts('https://docs.opencv.org/4.8.0/opencv.js');
} catch (e) {
    self.postMessage({ type: 'error', payload: "Failed to load OpenCV script: " + e.message });
}

// --- STATE ---
let isReady = false;
let trackingMode = 'auto'; // 'auto' | 'manual'
let isTracking = false;

// OpenCV Objects
let classifier = null;     // Haar Cascade
let tracker = null;        // CSRT Tracker
let kalman = null;         // Kalman Filter
let src = null;
let gray = null;
let m = null;              // Measurement Mat for Kalman

// Constants
// Since we are now sampling at a much lower FPS (e.g. 4 FPS), we should detect on every frame we get.
const DETECT_INTERVAL = 1; 
let frameCount = 0;

// Config
// Increased process noise slightly to account for larger time steps (0.25s vs 0.05s)
const KALMAN_PROCESS_NOISE = 1e-3; 
const KALMAN_MEASUREMENT_NOISE = 1e-1;

self.onmessage = async function(e) {
    const { type, payload } = e.data;

    if (type === 'init') {
        try {
            // 1. Wait for OpenCV to initialize
            if (typeof self.cv === 'undefined' || !self.cv.Mat) {
                await new Promise((resolve, reject) => {
                    // Timeout for CV load
                    const t = setTimeout(() => {
                        if (self.cv && self.cv.Mat) resolve(); 
                        else reject("OpenCV initialization timeout");
                    }, 10000);

                    if (self.Module && typeof self.Module.onRuntimeInitialized === 'function') {
                         // Already hooked?
                    } else {
                        self.Module = { 
                            onRuntimeInitialized: () => {
                                clearTimeout(t);
                                resolve();
                            } 
                        };
                    }
                    
                    // Polling fallback in case onRuntimeInitialized already fired
                    const interval = setInterval(() => {
                        if (self.cv && self.cv.Mat) {
                            clearInterval(interval);
                            clearTimeout(t);
                            resolve();
                        }
                    }, 500);
                });
            }

            if (!self.cv.Mat) throw new Error("OpenCV failed to load");

            // 2. Load Face Cascade (Haar)
            // Using a CORS-friendly proxy or reliable source is critical.
            // raw.githubusercontent.com usually works, but sometimes fails.
            const CASCADE_URL = 'https://raw.githubusercontent.com/opencv/opencv/master/data/haarcascades/haarcascade_frontalface_default.xml';
            
            try {
                const response = await fetch(CASCADE_URL);
                if (!response.ok) throw new Error("Failed to fetch cascade xml: " + response.statusText);
                const buffer = await response.arrayBuffer();
                const data = new Uint8Array(buffer);
                self.cv.FS_createDataFile('/', 'haarcascade_frontalface_default.xml', data, true, false, false);
                
                classifier = new self.cv.CascadeClassifier();
                classifier.load('haarcascade_frontalface_default.xml');
            } catch (err) {
                console.warn("Haarcascade load failed, auto-tracking disabled.", err);
                // We don't crash the worker, just disable classifier
                classifier = null;
            }

            // 3. Allocations
            src = new self.cv.Mat();
            gray = new self.cv.Mat();
            
            // 4. Initialize Kalman Filter
            initKalman();

            isReady = true;
            self.postMessage({ type: 'ready' });
        } catch (err) {
            console.error("Vision Worker Init Error", err);
            self.postMessage({ type: 'error', payload: err.message || "Worker Init Failed" });
        }
    }

    if (type === 'config') {
        if (payload.mode) {
            trackingMode = payload.mode;
            isTracking = false;
            
            if (payload.mode === 'manual' && payload.initialRect) {
                initTracker(payload.initialRect);
            }
        }
    }

    if (type === 'process') {
        if (!isReady) {
             // If processing requested but not ready, ignore or queue?
             return;
        }

        try {
            const { imageData, timestamp } = payload;
            processFrame(imageData, timestamp);
        } catch (e) {
            console.error("Frame Processing Error", e);
            // self.postMessage({ type: 'error', payload: e.message });
        }
    }
};

function initKalman() {
    try {
        // 4 state variables (x, y, dx, dy), 2 measurements (x, y)
        kalman = new self.cv.KalmanFilter(4, 2, 0);
        
        kalman.transitionMatrix = self.cv.matFromArray(4, 4, self.cv.CV_32F, [
            1, 0, 1, 0,
            0, 1, 0, 1,
            0, 0, 1, 0,
            0, 0, 0, 1
        ]);

        kalman.measurementMatrix = self.cv.matFromArray(2, 4, self.cv.CV_32F, [
            1, 0, 0, 0,
            0, 1, 0, 0
        ]);

        const q = self.cv.Mat.eye(4, 4, self.cv.CV_32F);
        q.data32F.fill(KALMAN_PROCESS_NOISE);
        kalman.processNoiseCov = q;

        const r = self.cv.Mat.eye(2, 2, self.cv.CV_32F);
        r.data32F.fill(KALMAN_MEASUREMENT_NOISE);
        kalman.measurementNoiseCov = r;

        const p = self.cv.Mat.eye(4, 4, self.cv.CV_32F);
        kalman.errorCovPost = p;

        m = new self.cv.Mat(2, 1, self.cv.CV_32F);
    } catch(e) {
        console.error("Kalman Init Error", e);
    }
}

function initTracker(rect) {
    try {
        if (tracker && !tracker.isDeleted) {
             try { tracker.delete(); } catch(e){}
        }

        // Check availability
        if (self.cv.TrackerCSRT && self.cv.TrackerCSRT.create) {
             tracker = self.cv.TrackerCSRT.create();
        } else {
             // Fallback to KCF if CSRT missing (sometimes happens in mini builds)
             if (self.cv.TrackerKCF && self.cv.TrackerKCF.create) {
                 tracker = self.cv.TrackerKCF.create();
             } else {
                 tracker = null;
                 console.warn("No Tracker Algo found.");
                 return;
             }
        }
        
        if (tracker && src && !src.empty()) {
             let roi = new self.cv.Rect(rect.x, rect.y, rect.width, rect.height);
             tracker.init(src, roi);
             isTracking = true;
        }
    } catch (e) {
        console.error("Tracker Init Failed", e);
        isTracking = false;
    }
}

function processFrame(imageData, timestamp) {
    if (src.cols !== imageData.width || src.rows !== imageData.height) {
        src.delete();
        src = new self.cv.Mat(imageData.height, imageData.width, self.cv.CV_8UC4);
        gray.delete();
        gray = new self.cv.Mat();
    }
    src.data.set(imageData.data);

    self.cv.cvtColor(src, gray, self.cv.COLOR_RGBA2GRAY, 0);

    let measurementX = -1, measurementY = -1, measurementW = 0, measurementH = 0;
    let found = false;

    if (trackingMode === 'auto') {
        if (classifier && !classifier.isDeleted && frameCount % DETECT_INTERVAL === 0) {
            let faces = new self.cv.RectVector();
            let minSize = new self.cv.Size(gray.cols * 0.1, gray.rows * 0.1);
            
            try {
                classifier.detectMultiScale(gray, faces, 1.1, 3, 0, minSize, new self.cv.Size());
                
                if (faces.size() > 0) {
                    let maxArea = 0, maxIdx = -1;
                    for (let i = 0; i < faces.size(); ++i) {
                        const f = faces.get(i);
                        const area = f.width * f.height;
                        if (area > maxArea) { maxArea = area; maxIdx = i; }
                    }
                    if (maxIdx >= 0) {
                        const face = faces.get(maxIdx);
                        measurementX = face.x + face.width / 2;
                        measurementY = face.y + face.height / 2;
                        measurementW = face.width;
                        measurementH = face.height;
                        found = true;
                    }
                }
            } catch(e) { console.error("Detection Error", e); }
            finally { faces.delete(); }
        }
    } 
    else if (trackingMode === 'manual' && tracker) {
         try {
             let rect = new self.cv.Rect();
             const success = tracker.update(src, rect);
             if (success) {
                 measurementX = rect.x + rect.width / 2;
                 measurementY = rect.y + rect.height / 2;
                 measurementW = rect.width;
                 measurementH = rect.height;
                 found = true;
             }
         } catch(e) { console.error("Tracking Error", e); }
    }

    // --- KALMAN FILTERING ---
    let predX = 0, predY = 0;
    
    if (kalman) {
        const prediction = kalman.predict();
        predX = prediction.data32F[0];
        predY = prediction.data32F[1];

        if (found) {
            m.data32F[0] = measurementX;
            m.data32F[1] = measurementY;
            const estimated = kalman.correct(m);
            predX = estimated.data32F[0];
            predY = estimated.data32F[1];
        } else {
            // Check bounds
            predX = Math.max(0, Math.min(src.cols, predX));
            predY = Math.max(0, Math.min(src.rows, predY));
        }
    } else {
        // Fallback if Kalman failed init
        if (found) { predX = measurementX; predY = measurementY; }
        else { predX = src.cols/2; predY = src.rows/2; }
    }

    const finalX = predX / src.cols;
    const finalY = predY / src.rows;
    
    // Calculate Zoom
    const normW = found ? measurementW / src.cols : 0;
    let scale = 1.0;
    if (normW > 0) {
        const targetW = 0.35; 
        scale = targetW / Math.max(normW, 0.1); 
        scale = Math.min(Math.max(scale, 1.0), 2.2); 
    }

    const debugBox = found ? {
        x: (measurementX - measurementW/2) / src.cols,
        y: (measurementY - measurementH/2) / src.rows,
        width: measurementW / src.cols,
        height: measurementH / src.rows
    } : null;

    self.postMessage({ type: 'result', payload: {
        timestamp,
        centerX: finalX,
        centerY: finalY,
        scale: scale,
        debugBox: debugBox
    }});
    
    frameCount++;
}
`;
