import { OverlayConfig } from '../../types';

/**
 * WebGL Compositor
 * Handles the rendering of VideoFrames onto an OffscreenCanvas using WebGL 2.
 * Responsible for Reframing (Cropping), Scaling, and Overlay blending.
 */
export class Compositor {
    private canvas: OffscreenCanvas;
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram | null = null;
    private texture: WebGLTexture | null = null;
    
    // Overlay Layer
    private overlayCanvas: OffscreenCanvas;
    private overlayCtx: OffscreenCanvasRenderingContext2D;
    private overlayTexture: WebGLTexture | null = null;
    
    // Shader Attribute Locations
    private positionLoc: number = -1;
    private texCoordLoc: number = -1;
    
    // Shader Uniform Locations
    private cropScaleLoc: WebGLUniformLocation | null = null;
    private cropOffsetLoc: WebGLUniformLocation | null = null;
    
    constructor(width: number, height: number) {
        this.canvas = new OffscreenCanvas(width, height);
        const gl = this.canvas.getContext('webgl2', { 
            alpha: false, 
            desynchronized: true, 
            powerPreference: 'high-performance' 
        });

        if (!gl) throw new Error("WebGL2 not supported in this browser.");
        this.gl = gl as WebGL2RenderingContext;

        // Initialize Overlay Layer (2D)
        this.overlayCanvas = new OffscreenCanvas(width, height);
        this.overlayCtx = this.overlayCanvas.getContext('2d')!;

        this.initShaders();
        this.initBuffers();
        this.initTextures();
    }

    private initShaders() {
        // Vertex Shader: Maps frame coordinates to canvas coordinates and handles cropping via UV manipulation
        const vsSource = `#version 300 es
            in vec2 a_position;
            in vec2 a_texCoord;
            
            // Reframe Params
            uniform vec2 u_cropScale;  // Size of the crop relative to full frame (0.0 - 1.0)
            uniform vec2 u_cropOffset; // Top-Left position of crop (0.0 - 1.0)

            out vec2 v_texCoord;
            
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = (a_texCoord * u_cropScale) + u_cropOffset; 
            }
        `;

        // Fragment Shader: Samples the texture
        const fsSource = `#version 300 es
            precision highp float;
            
            uniform sampler2D u_image;
            in vec2 v_texCoord;
            out vec4 outColor;
            
            void main() {
                outColor = texture(u_image, v_texCoord);
            }
        `;

        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vsSource);
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fsSource);
        
        this.program = this.gl.createProgram()!;
        this.gl.attachShader(this.program, vertexShader);
        this.gl.attachShader(this.program, fragmentShader);
        this.gl.linkProgram(this.program);

        if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
            throw new Error('Program link failed: ' + this.gl.getProgramInfoLog(this.program));
        }

        this.positionLoc = this.gl.getAttribLocation(this.program, 'a_position');
        this.texCoordLoc = this.gl.getAttribLocation(this.program, 'a_texCoord');
        
        this.cropScaleLoc = this.gl.getUniformLocation(this.program, 'u_cropScale');
        this.cropOffsetLoc = this.gl.getUniformLocation(this.program, 'u_cropOffset');
    }

    private createShader(type: number, source: string): WebGLShader {
        const shader = this.gl.createShader(type)!;
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            throw new Error('Shader compile failed: ' + this.gl.getShaderInfoLog(shader));
        }
        return shader;
    }

    private initBuffers() {
        // Full screen quad
        const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
        const texCoords = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]);

        const posBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, posBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);
        this.gl.enableVertexAttribArray(this.positionLoc);
        this.gl.vertexAttribPointer(this.positionLoc, 2, this.gl.FLOAT, false, 0, 0);

        const texBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, texBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, texCoords, this.gl.STATIC_DRAW);
        this.gl.enableVertexAttribArray(this.texCoordLoc);
        this.gl.vertexAttribPointer(this.texCoordLoc, 2, this.gl.FLOAT, false, 0, 0);
    }

    private initTextures() {
        // Video Texture
        this.texture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);

        // Overlay Texture
        this.overlayTexture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.overlayTexture);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    }

    /**
     * Bakes text and images onto the 2D overlay canvas and uploads to WebGL texture.
     */
    public updateOverlays(overlays: OverlayConfig[], bitmaps: Map<string, ImageBitmap>) {
        const ctx = this.overlayCtx;
        const w = this.overlayCanvas.width;
        const h = this.overlayCanvas.height;
        
        // Base reference width (approx mobile preview width) to scale relative sizes
        const REFERENCE_WIDTH = 360; 
        const scaleFactor = w / REFERENCE_WIDTH;

        ctx.clearRect(0, 0, w, h);

        overlays.forEach(ov => {
            const { x, y, align } = this.getPosition(ov.position, w, h);
            
            ctx.save();
            ctx.translate(x, y);
            
            if (ov.type === 'text') {
                const fontSize = ov.scale * scaleFactor;
                ctx.font = `bold ${fontSize}px Inter, sans-serif`;
                ctx.fillStyle = ov.style?.color || 'white';
                ctx.textAlign = align as CanvasTextAlign;
                ctx.textBaseline = 'middle'; // simplify vertical alignment

                if (ov.style?.backgroundColor) {
                    const metrics = ctx.measureText(ov.content);
                    const bgPadding = fontSize * 0.2;
                    ctx.fillStyle = ov.style.backgroundColor;
                    // Draw rect background
                    const rectX = align === 'center' ? -metrics.width/2 : align === 'right' ? -metrics.width : 0;
                    ctx.fillRect(
                        rectX - bgPadding, 
                        -fontSize/2 - bgPadding, 
                        metrics.width + (bgPadding*2), 
                        fontSize + (bgPadding*2)
                    );
                    ctx.fillStyle = ov.style?.color || 'white';
                }
                ctx.fillText(ov.content, 0, 0);

            } else if (ov.type === 'image') {
                const bitmap = bitmaps.get(ov.id);
                if (bitmap) {
                    // ov.scale is roughly % of width in UI or a raw number. 
                    // In Editor, scale 30 = 90px width on 360px screen (~25%)
                    const targetW = (ov.scale * 3) * scaleFactor;
                    const ratio = bitmap.height / bitmap.width;
                    const targetH = targetW * ratio;
                    
                    const drawX = align === 'center' ? -targetW/2 : align === 'right' ? -targetW : 0;
                    const drawY = -targetH/2;
                    
                    ctx.drawImage(bitmap, drawX, drawY, targetW, targetH);
                }
            }
            ctx.restore();
        });

        // Upload to Texture
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.overlayTexture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.overlayCanvas);
    }

    private getPosition(pos: string, w: number, h: number) {
        const pad = w * 0.05;
        const bottomPad = h * 0.15;
        let x = 0, y = 0, align = 'left';

        if (pos.includes('left')) { x = pad; align = 'left'; }
        else if (pos.includes('right')) { x = w - pad; align = 'right'; }
        else { x = w / 2; align = 'center'; }

        if (pos.includes('top')) y = pad + (h * 0.05); // slightly down from top
        else if (pos.includes('bottom')) y = h - bottomPad;
        else y = h / 2;

        return { x, y, align };
    }

    /**
     * Renders a VideoFrame to the canvas with reframe parameters and overlays.
     */
    public render(frame: VideoFrame, reframeConfig?: { x: number, y: number, scale: number }) {
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.useProgram(this.program);

        // --- PASS 1: VIDEO (CROP/SCALE) ---
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, frame);

        // Calculate Crop
        const srcRatio = frame.displayWidth / frame.displayHeight;
        const tgtRatio = this.canvas.width / this.canvas.height;
        let w = 1.0, h = 1.0;

        if (srcRatio > tgtRatio) { h = 1.0; w = tgtRatio / srcRatio; } 
        else { w = 1.0; h = srcRatio / tgtRatio; }

        const scale = reframeConfig?.scale || 1.0;
        w /= scale; h /= scale;
        
        const cx = reframeConfig?.x ?? 0.5;
        const cy = reframeConfig?.y ?? 0.5;
        const ox = cx - (w / 2);
        const oy = cy - (h / 2);

        this.gl.uniform2f(this.cropScaleLoc, w, h);
        this.gl.uniform2f(this.cropOffsetLoc, ox, oy);
        
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);


        // --- PASS 2: OVERLAYS (FULL SCREEN BLEND) ---
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.overlayTexture);
        
        // Reset uniforms to 1:1 for overlay layer
        this.gl.uniform2f(this.cropScaleLoc, 1.0, 1.0);
        this.gl.uniform2f(this.cropOffsetLoc, 0.0, 0.0);
        
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
        
        this.gl.disable(this.gl.BLEND);
    }

    // UPDATED SIGNATURE: Accept number, null, or undefined to be robust
    public getOutputFrame(timestamp: number, duration?: number | null): VideoFrame {
        return new VideoFrame(this.canvas, {
            timestamp: timestamp,
            duration: duration ?? undefined
        });
    }
}
