import React, { useState, useRef, useEffect } from 'react';
import { GlassCard } from './ui/GlassCard';
import { VideoProject, GeneratedClip, OverlayConfig, OverlayPosition, OverlayType } from '../types';
import { analyzeVideoForReframe, getInterpolatedReframe, ReframeKeyframe, ReframeConfig } from '../services/reframeService';

interface ClipConfigProps {
  project: VideoProject;
  onGenerate: (clips: GeneratedClip[], aspectRatio: '9:16' | '16:9' | '1:1', reframeData?: ReframeKeyframe[], overlays?: OverlayConfig[]) => void;
  onBack: () => void;
}

export const ClipConfig: React.FC<ClipConfigProps> = ({ project, onGenerate, onBack }) => {
  // State
  const [clipCount, setClipCount] = useState(3);
  const [durationMode, setDurationMode] = useState<'30+' | '60+' | 'random'>('random');
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16');
  const [isGenerating, setIsGenerating] = useState(false);

  // Auto Reframe State
  const [isAutoReframe, setIsAutoReframe] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [reframeData, setReframeData] = useState<ReframeKeyframe[] | null>(null);
  const [estTimeRemaining, setEstTimeRemaining] = useState<string>('Calculating...');
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  
  // Video Metadata
  const [naturalSize, setNaturalSize] = useState<{width: number, height: number} | null>(null);
  
  // Reframe Config Modal State
  const [showReframeConfig, setShowReframeConfig] = useState(false);
  const [reframeSettings, setReframeSettings] = useState<ReframeConfig>({
      mood: 'smart',
      cameraSpeed: 'normal',
      framingTightness: 'normal',
      scanMode: 'normal'
  });

  // Debug State
  const [currentDebugBox, setCurrentDebugBox] = useState<{x:number, y:number, width:number, height:number} | null>(null);
  const [currentFocusPoint, setCurrentFocusPoint] = useState<number>(0.5); // X center 0-1
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const analysisStartTimeRef = useRef<number>(0);

  // Advanced / Overlays State
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [overlays, setOverlays] = useState<OverlayConfig[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeFileType, setActiveFileType] = useState<'image' | 'video' | null>(null);
  
  // Playback & Trimming State
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  // Trim Range (in seconds)
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isDragging, setIsDragging] = useState<'start' | 'end' | 'current' | null>(null);

  // --- RAF LOOP FOR SMOOTH REFRAME ---
  const rafRef = useRef<number | null>(null);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
        const dur = videoRef.current.duration;
        setDuration(dur);
        setNaturalSize({
            width: videoRef.current.videoWidth,
            height: videoRef.current.videoHeight
        });
        if (trimEnd === 0) {
            setTrimEnd(dur);
            setTrimStart(0);
        }
    }
  };

  const togglePlay = () => {
      if (isAnalyzing) return; 

      if (videoRef.current) {
          if (isPlaying) {
              videoRef.current.pause();
              overlays.forEach(ov => {
                  if (ov.type === 'video') {
                      const el = document.getElementById(`overlay-video-${ov.id}`) as HTMLVideoElement;
                      if (el) el.pause();
                  }
              });
              if (rafRef.current) cancelAnimationFrame(rafRef.current);
          } else {
              if (videoRef.current.currentTime >= trimEnd) {
                  videoRef.current.currentTime = trimStart;
              }
              videoRef.current.play();
              overlays.forEach(ov => {
                  if (ov.type === 'video') {
                      const el = document.getElementById(`overlay-video-${ov.id}`) as HTMLVideoElement;
                      if (el) {
                          el.currentTime = 0; 
                          el.play();
                      }
                  }
              });
              
              // Start Animation Loop
              const loop = () => {
                  if (videoRef.current && !videoRef.current.paused) {
                      updateVideoPreview();
                      // Also update time slider smoothly
                      setCurrentTime(videoRef.current.currentTime);
                      rafRef.current = requestAnimationFrame(loop);
                  }
              };
              rafRef.current = requestAnimationFrame(loop);
          }
          setIsPlaying(!isPlaying);
      }
  };

  // Cleanup RAF
  useEffect(() => {
      return () => {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
  }, []);

  // --- LIVE PREVIEW SYNC EFFECT ---
  useEffect(() => {
    if (isAnalyzing && videoRef.current) {
        // Only seek if the difference is significant to prevent jitter
        if (Math.abs(videoRef.current.currentTime - currentTime) > 0.05) {
            videoRef.current.currentTime = currentTime;
        }
    }
  }, [currentTime, isAnalyzing]);


  // --- ANALYSIS HANDLER ---
  const runAnalysis = async () => {
      setShowReframeConfig(false);
      setIsAutoReframe(true);
      setShowSuccessMessage(false);

      if (abortControllerRef.current) abortControllerRef.current.abort();
      
      setIsAnalyzing(true);
      setIsPlaying(false); 
      setAnalysisProgress(0);
      setEstTimeRemaining('Calculating...');
      setReframeData(null); 
      
      analysisStartTimeRef.current = Date.now();
      
      const ac = new AbortController();
      abortControllerRef.current = ac;
      
      const accumulatedKeyframes: ReframeKeyframe[] = [];

      try {
          const data = await analyzeVideoForReframe(
              project.videoUrl, 
              (p, debugInfo) => {
                  setAnalysisProgress(p);
                  if (p > 1) {
                      const elapsed = (Date.now() - analysisStartTimeRef.current) / 1000;
                      const totalEstimated = elapsed / (p / 100);
                      const remaining = Math.max(0, Math.ceil(totalEstimated - elapsed));
                      setEstTimeRemaining(remaining < 60 ? `${remaining}s remaining` : `${Math.ceil(remaining/60)}m remaining`);
                  }
                  if (debugInfo) {
                      // Update visual debugging
                      if (debugInfo.debugBox) setCurrentDebugBox(debugInfo.debugBox);
                      
                      // Update the "Camera Center" for the Crop Box
                      setCurrentFocusPoint(debugInfo.centerX);

                      accumulatedKeyframes.push(debugInfo);
                      setReframeData([...accumulatedKeyframes]);
                      setCurrentTime(debugInfo.timestamp); 
                  }
              },
              ac.signal,
              undefined,
              videoRef.current || undefined,
              aspectRatio,
              reframeSettings 
          );
          setReframeData(data);
          setCurrentDebugBox(null);
          setShowSuccessMessage(true);
          
          if(videoRef.current) {
              videoRef.current.currentTime = trimStart;
              setCurrentTime(trimStart);
          }

      } catch (e: any) {
          if (e.message !== 'Aborted') {
              console.error("Analysis Failed", e);
              setIsAutoReframe(false);
          }
      } finally {
          setIsAnalyzing(false);
          abortControllerRef.current = null;
          // Force one update to switch to result view
          updateVideoPreview();
      }
  };

  const handleToggleReframe = () => {
      if (!isAutoReframe) {
          setShowReframeConfig(true);
      } else {
          setIsAutoReframe(false);
          setShowSuccessMessage(false);
          if (abortControllerRef.current) abortControllerRef.current.abort();
          setIsAnalyzing(false);
          setReframeData(null);
          setCurrentDebugBox(null);
          if (videoRef.current) {
              videoRef.current.style.objectPosition = '50% 50%';
              videoRef.current.style.transform = 'scale(1)';
          }
      }
  };

  const cancelAnalysis = () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      setIsAnalyzing(false);
      setIsAutoReframe(false);
      setAnalysisProgress(0);
      setCurrentDebugBox(null);
      if (videoRef.current) {
          videoRef.current.style.objectPosition = '50% 50%';
          videoRef.current.style.transform = 'scale(1)';
      }
  };

  // --- PREVIEW UPDATE ---
  const updateVideoPreview = () => {
      if (videoRef.current) {
          if (isAnalyzing) {
             // ANALYZING: Reset to center / scale 1 for Viewfinder
             videoRef.current.style.objectPosition = '50% 50%';
             videoRef.current.style.transform = 'scale(1)';
             
             // Update Debug overlays
             if (isAutoReframe && reframeData && reframeData.length > 0) {
                 const t = videoRef.current.currentTime;
                 const frame = getInterpolatedReframe(reframeData, t);
                 setCurrentFocusPoint(frame.x);
                 
                 // Debug box logic would go here if we were interpolating it, 
                 // but during analysis we usually get it live from the callback.
             }

          } else {
             // RESULT (or Manual): Apply Crop
             if (isAutoReframe && reframeData && reframeData.length > 0) {
                 const { x, y, scale } = getInterpolatedReframe(reframeData, videoRef.current.currentTime);
                 videoRef.current.style.objectPosition = `${x * 100}% ${y * 100}%`;
                 videoRef.current.style.transform = `scale(${scale})`;
             } else {
                 // Manual Mode default center
                 videoRef.current.style.objectPosition = '50% 50%';
                 videoRef.current.style.transform = 'scale(1)';
             }
          }
      }
  };

  // Effect to update static preview when data changes or seeking happens (outside playback)
  useEffect(() => {
      if (!isPlaying) updateVideoPreview();
  }, [isAutoReframe, isAnalyzing, reframeData, currentTime, aspectRatio]);

  const handleTimeUpdate = () => {
      if (isAnalyzing) return;
      
      // If NOT playing (dragging slider etc), update time
      if (!isPlaying && videoRef.current) {
          if (isDragging !== 'current') {
              const curr = videoRef.current.currentTime;
              setCurrentTime(curr);
              if (curr >= trimEnd) videoRef.current.currentTime = trimStart;
          }
          updateVideoPreview();
      }
  };

  // --- Trimming Logic ---
  useEffect(() => {
      const handleUp = () => setIsDragging(null);
      const handleMove = (e: MouseEvent | TouchEvent) => {
          if (isDragging) {
             if (!timelineRef.current || !duration) return;
             const rect = timelineRef.current.getBoundingClientRect();
             const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
             const percentage = Math.max(0, Math.min(clientX - rect.left, rect.width)) / rect.width;
             const newTime = percentage * duration;

             if (isDragging === 'start') {
                 setTrimStart(Math.min(newTime, trimEnd - 5));
                 if (videoRef.current) videoRef.current.currentTime = newTime;
             } else if (isDragging === 'end') {
                 setTrimEnd(Math.max(newTime, trimStart + 5));
                 if (videoRef.current) videoRef.current.currentTime = newTime;
             } else if (isDragging === 'current') {
                 setCurrentTime(newTime);
                 if (videoRef.current) videoRef.current.currentTime = newTime;
                 updateVideoPreview();
             }
          }
      };

      if (isDragging) {
          window.addEventListener('mouseup', handleUp);
          window.addEventListener('touchend', handleUp);
          window.addEventListener('mousemove', handleMove);
          window.addEventListener('touchmove', handleMove);
      }
      return () => {
          window.removeEventListener('mouseup', handleUp);
          window.removeEventListener('touchend', handleUp);
          window.removeEventListener('mousemove', handleMove);
          window.removeEventListener('touchmove', handleMove);
      }
  }, [isDragging, duration, trimStart, trimEnd]);


  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      const newClips: GeneratedClip[] = [];
      const effectiveDuration = trimEnd - trimStart;

      for (let i = 0; i < clipCount; i++) {
        let clipDur = durationMode === '30+' ? 30 : durationMode === '60+' ? 60 : 20;
        clipDur = Math.min(clipDur + Math.random() * 10, effectiveDuration);

        const absoluteStart = trimStart + (Math.random() * (effectiveDuration - clipDur));
        newClips.push({
          id: `gen-${Date.now()}-${i}`,
          projectId: project.id,
          startTime: absoluteStart,
          endTime: absoluteStart + clipDur,
          label: `Clip #${i + 1} (${Math.round(clipDur)}s)`
        });
      }

      setIsGenerating(false);
      onGenerate(newClips, aspectRatio, isAutoReframe ? reframeData || undefined : undefined, overlays);
    }, 1500);
  };

  // --- OVERLAY HELPERS ---
  const addOverlayText = () => {
    setOverlays([...overlays, {
        id: Date.now().toString(),
        type: 'text',
        content: 'TEXT',
        position: 'bottom-center',
        scale: 40,
        style: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.5)' }
    }]);
  };

  const triggerFileUpload = (type: 'image' | 'video') => {
      setActiveFileType(type);
      fileInputRef.current?.click();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && activeFileType) {
          setOverlays([...overlays, {
              id: Date.now().toString(),
              type: activeFileType,
              content: URL.createObjectURL(file),
              position: 'top-right',
              scale: 30,
              file: file
          }]);
      }
      setActiveFileType(null);
  };

  const updateOverlay = (id: string, updates: Partial<OverlayConfig>) => {
      setOverlays(overlays.map(o => o.id === id ? { ...o, ...updates } : o));
  };

  const removeOverlay = (id: string) => {
      setOverlays(overlays.filter(o => o.id !== id));
  };

  const getOverlayPositionStyle = (pos: OverlayPosition): React.CSSProperties => {
      const spacing = '5%';
      switch (pos) {
          case 'top-left': return { top: spacing, left: spacing };
          case 'top-center': return { top: spacing, left: '50%', transform: 'translateX(-50%)' };
          case 'top-right': return { top: spacing, right: spacing };
          case 'bottom-left': return { bottom: spacing, left: spacing };
          case 'bottom-center': return { bottom: '15%', left: '50%', transform: 'translateX(-50%)' };
          case 'bottom-right': return { bottom: spacing, right: spacing };
          default: return { top: spacing, left: spacing };
      }
  };

  const getPercent = (time: number) => duration > 0 ? (time / duration) * 100 : 0;

  // --- DYNAMIC PREVIEW STYLE ---
  const getContainerStyle = (): React.CSSProperties => {
      // 1. ANALYZING: Viewfinder Mode (Show Full Context)
      if (isAnalyzing && naturalSize) {
          return {
              aspectRatio: `${naturalSize.width} / ${naturalSize.height}`,
              width: '100%',
              height: 'auto',
              maxHeight: '100%',
              objectFit: 'contain'
          };
      } 
      // 2. RESULT / DEFAULT: Cropped Mode (Show Target Aspect Ratio)
      else {
          return {
              aspectRatio: aspectRatio.replace(':', '/'),
              width: 'auto',
              height: '100%',
              maxHeight: '100%',
              // Note: we use objectFit='cover' on the VIDEO element below to fill this container
          };
      }
  };

  // --- CROP BOX CALCULATIONS (Viewfinder Overlay) ---
  const getCropBoxStyle = (): React.CSSProperties => {
      if (!naturalSize) return {};

      const sourceRatio = naturalSize.width / naturalSize.height;
      let targetRatio = 9/16;
      if (aspectRatio === '16:9') targetRatio = 16/9;
      if (aspectRatio === '1:1') targetRatio = 1;

      // Calculate dimensions of the Crop Box as % of parent (Video Container)
      let widthPercent = 100;
      let heightPercent = 100;

      if (sourceRatio > targetRatio) {
          widthPercent = (targetRatio / sourceRatio) * 100;
          heightPercent = 100;
      } else {
          widthPercent = 100;
          heightPercent = (sourceRatio / targetRatio) * 100;
      }

      let left = (currentFocusPoint * 100) - (widthPercent / 2);
      left = Math.max(0, Math.min(100 - widthPercent, left));
      
      let top = 50 - (heightPercent / 2);

      return {
          position: 'absolute',
          top: `${top}%`,
          left: `${left}%`,
          width: `${widthPercent}%`,
          height: `${heightPercent}%`,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.75)', 
          border: '2px solid #ec4899', 
          borderRadius: '4px',
          zIndex: 30,
          pointerEvents: 'none',
          transition: 'left 0.1s linear'
      };
  };

  return (
    <div className="flex flex-col h-full bg-[#0f0f12] animate-fade-in relative overflow-hidden">
      <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />

      {/* --- REFRAME CONFIG MODAL --- */}
      {showReframeConfig && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-md animate-fade-in">
           <GlassCard className="w-full max-w-sm p-6 relative bg-[#18181b] border border-white/10 shadow-2xl">
               <button 
                 onClick={() => setShowReframeConfig(false)}
                 className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white transition-colors"
               >
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
               </button>

               <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                   <div className="w-8 h-8 rounded-full bg-brand-primary/20 flex items-center justify-center text-brand-primary">
                       <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                   </div>
                   Reframing Engine
               </h3>

               <div className="space-y-6">
                   {/* Aspect Ratio */}
                   <div>
                       <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">Output Format</label>
                       <div className="grid grid-cols-3 gap-2">
                           {['9:16', '16:9', '1:1'].map((r) => (
                               <button 
                                 key={r} 
                                 onClick={() => setAspectRatio(r as any)}
                                 className={`py-2 rounded-lg border text-sm font-bold transition-all ${aspectRatio === r ? 'bg-white text-black border-white' : 'bg-white/5 text-gray-400 border-transparent hover:bg-white/10'}`}
                               >
                                   {r}
                               </button>
                           ))}
                       </div>
                   </div>

                   {/* Analysis Speed Toggle (3-Tier) */}
                   <div>
                       <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">Scan Engine</label>
                       <div className="flex bg-white/5 rounded-lg p-1">
                           <button 
                             onClick={() => setReframeSettings({...reframeSettings, scanMode: 'faster'})}
                             className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all flex items-center justify-center gap-1 ${reframeSettings.scanMode === 'faster' ? 'bg-brand-secondary text-white shadow-sm' : 'text-gray-500 hover:text-white'}`}
                           >
                               <span>🚀</span> Faster
                           </button>
                           <button 
                             onClick={() => setReframeSettings({...reframeSettings, scanMode: 'normal'})}
                             className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all flex items-center justify-center gap-1 ${reframeSettings.scanMode === 'normal' ? 'bg-brand-primary text-white shadow-sm' : 'text-gray-500 hover:text-white'}`}
                           >
                               <span>⚡</span> Normal
                           </button>
                           <button 
                             onClick={() => setReframeSettings({...reframeSettings, scanMode: 'perfect'})}
                             className={`flex-1 py-1.5 rounded-md text-[10px] font-bold transition-all flex items-center justify-center gap-1 ${reframeSettings.scanMode === 'perfect' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-white'}`}
                           >
                               <span>💎</span> Perfect
                           </button>
                       </div>
                   </div>

                   {/* MOOD & SPEED CONTROLS */}
                   <div className="grid grid-cols-2 gap-4">
                        {/* MOOD */}
                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">Cam Mood</label>
                            <div className="flex flex-col gap-1">
                                {[
                                    { id: 'cinematic', label: 'Cinematic' },
                                    { id: 'smart', label: 'Smart' },
                                    { id: 'cut', label: 'Scene Cut' }
                                ].map((mood) => (
                                    <button 
                                        key={mood.id} 
                                        onClick={() => setReframeSettings({...reframeSettings, mood: mood.id as any})}
                                        className={`py-1.5 rounded-lg text-[10px] font-bold transition-all border ${reframeSettings.mood === mood.id ? 'bg-brand-primary/20 text-brand-primary border-brand-primary' : 'bg-white/5 text-gray-400 border-transparent hover:bg-white/10'}`}
                                    >
                                        {mood.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* SPEED */}
                        <div>
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 block">Cam Speed</label>
                            <div className="flex flex-col gap-1">
                                {[
                                    { id: 'slow', label: 'Slow' },
                                    { id: 'normal', label: 'Normal' },
                                    { id: 'fast', label: 'Fast' }
                                ].map((speed) => (
                                    <button 
                                        key={speed.id} 
                                        onClick={() => setReframeSettings({...reframeSettings, cameraSpeed: speed.id as any})}
                                        className={`py-1.5 rounded-lg text-[10px] font-bold transition-all border ${reframeSettings.cameraSpeed === speed.id ? 'bg-white text-black border-white' : 'bg-white/5 text-gray-400 border-transparent hover:bg-white/10'}`}
                                    >
                                        {speed.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                   </div>

               </div>

               <div className="mt-8">
                   <button 
                     onClick={runAnalysis}
                     className="w-full py-4 rounded-xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold text-lg shadow-lg active:scale-95 transition-transform"
                   >
                       Start Analysis
                   </button>
               </div>
           </GlassCard>
        </div>
      )}

      {/* --- TOP: VIDEO PREVIEW --- */}
      <div className="relative w-full bg-black flex flex-col shrink-0" style={{ height: '55vh' }}>
         <div className="absolute top-0 left-0 right-0 p-4 z-20 flex justify-between items-start bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
            <button onClick={onBack} className="pointer-events-auto p-2 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-white hover:bg-white/20 transition-colors">
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
         </div>

         {/* Video Element Container */}
         <div className="flex-1 relative w-full h-full flex items-center justify-center overflow-hidden bg-black/90" onClick={togglePlay}>
            <div 
              className={`relative overflow-hidden transition-all duration-500 border border-white/10 shadow-2xl bg-black`} 
              style={getContainerStyle()}
            >
                {/* 
                    ANALYSIS / REFRAME OVERLAY
                    Only visible when analyzing to show the detection logic (Viewfinder).
                */}
                {isAnalyzing && (
                    <>
                        {/* 1. Matrix Dot Overlay (Animated) */}
                        <div className="absolute inset-0 z-20 pointer-events-none opacity-50 animate-pulse-slow mix-blend-screen"
                             style={{
                                 backgroundImage: 'radial-gradient(circle, rgba(99,102,241,0.5) 1px, transparent 1px)',
                                 backgroundSize: '20px 20px'
                             }}
                        ></div>

                        {/* 2. Dynamic Crop Box (The Viewfinder) */}
                        <div style={getCropBoxStyle()}>
                             {/* Corner accents for the viewfinder */}
                             <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white/80"></div>
                             <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white/80"></div>
                             <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white/80"></div>
                             <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white/80"></div>
                             
                             {/* Scan line effect inside the box */}
                             <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/10 to-transparent animate-scan-vertical opacity-30"></div>
                             
                             {/* Center indicator */}
                             <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-brand-secondary rounded-full -translate-x-1/2 -translate-y-1/2 shadow-[0_0_10px_rgba(236,72,153,1)]"></div>
                        </div>
                    </>
                )}

                <video 
                    ref={videoRef}
                    src={project.videoUrl}
                    className="w-full h-full"
                    style={{ 
                        // During analysis, CONTAIN to show context.
                        // After analysis, COVER to crop to target aspect ratio.
                        objectFit: isAnalyzing ? 'contain' : 'cover',
                        objectPosition: '50% 50%', 
                        transformOrigin: 'center center'
                    }}
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={handleLoadedMetadata}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={() => setIsPlaying(false)}
                />

                {/* Debug Green Box - Visible only during analysis */}
                {currentDebugBox && isAnalyzing && (
                    <div 
                        className="absolute border-2 border-green-500 bg-green-500/20 z-40 transition-all duration-75"
                        style={{
                            left: `${currentDebugBox.x * 100}%`,
                            top: `${currentDebugBox.y * 100}%`,
                            width: `${currentDebugBox.width * 100}%`,
                            height: `${currentDebugBox.height * 100}%`,
                            boxShadow: '0 0 15px rgba(34, 197, 94, 0.4)'
                        }}
                    >
                         {/* Subject Label (Top Left) - OUTSIDE the box anchored to it */}
                         <div className="absolute -top-5 left-0 bg-green-500 text-black text-[9px] font-bold px-1.5 py-0.5 rounded-t-sm rounded-br-sm flex items-center gap-1 shadow-sm">
                             <span>SUBJECT</span>
                         </div>

                         {/* Adol Ai Working Label (Bottom Right) - OUTSIDE the box */}
                         <div className="absolute -bottom-5 right-0 bg-black/80 text-green-400 border border-green-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded-b-sm rounded-tl-sm flex items-center gap-1 shadow-sm whitespace-nowrap">
                             <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                             <span>Adol Ai Working</span>
                         </div>
                    </div>
                )}
                
                {/* Result Preview Overlays (Text/Stickers) */}
                {overlays.map(ov => (
                    <div 
                        key={ov.id}
                        className="absolute z-10 pointer-events-none"
                        style={getOverlayPositionStyle(ov.position)}
                    >
                        {ov.type === 'text' && (
                            <div style={{ 
                                fontSize: `${ov.scale}px`, 
                                color: ov.style?.color, 
                                backgroundColor: ov.style?.backgroundColor, 
                                padding: '0.2em 0.5em',
                                borderRadius: '0.2em',
                                fontWeight: 'bold'
                            }}>
                                {ov.content}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            
            {!isPlaying && !isAnalyzing && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
                     <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-2xl">
                        <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                     </div>
                </div>
            )}
         </div>

         {/* Trimmer */}
         <div className="h-16 bg-[#18181b] border-t border-white/5 px-6 flex flex-col justify-center relative select-none z-30">
             <div 
                ref={timelineRef}
                className="relative w-full h-8 group cursor-pointer touch-none"
                onMouseDown={(e) => { 
                     if(videoRef.current && duration) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const p = (e.clientX - rect.left) / rect.width;
                        videoRef.current.currentTime = p * duration;
                        setIsDragging('current');
                    }
                }}
             >
                 <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 bg-white/10 rounded-full"></div>
                 <div 
                    className="absolute top-1/2 -translate-y-1/2 h-1 bg-brand-primary opacity-80"
                    style={{ left: `${getPercent(trimStart)}%`, width: `${getPercent(trimEnd - trimStart)}%` }}
                 ></div>
                 <div 
                    className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_white] z-10 pointer-events-none"
                    style={{ left: `${getPercent(currentTime)}%` }}
                 ></div>
             </div>
         </div>
      </div>

      {/* --- BOTTOM: COMPACT SETTINGS --- */}
      <div className="flex-1 bg-white/60 dark:bg-black/40 backdrop-blur-xl border-t border-white/20 dark:border-white/5 p-5 flex flex-col overflow-y-auto pb-20">
        
        <div className="grid grid-cols-2 gap-3 mb-4">
            
            {/* Format Card - DYNAMIC CONTENT */}
            <div className="col-span-2 bg-white/40 dark:bg-glass-100 rounded-2xl p-3 border border-white/20 dark:border-white/5 flex flex-col gap-3 justify-center min-h-[90px]">
                {isAnalyzing ? (
                   // --- ANALYZING STATE ---
                   <div className="flex flex-col gap-2 w-full animate-fade-in">
                       <div className="flex justify-between items-center text-xs text-slate-800 dark:text-white mb-1">
                           <div className="flex items-center gap-2">
                               <div className="w-3 h-3 rounded-full border-2 border-brand-primary border-t-transparent animate-spin"></div>
                               <span className="font-bold uppercase tracking-wider text-brand-primary">Analyzing Scene</span>
                           </div>
                           <button onClick={cancelAnalysis} className="text-gray-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-white transition-colors p-1 text-[10px] font-bold">
                               CANCEL
                           </button>
                       </div>
                       <div className="w-full h-2 bg-gray-200 dark:bg-black/30 rounded-full overflow-hidden border border-white/5">
                           <div 
                             className="h-full bg-gradient-to-r from-brand-primary to-brand-secondary transition-all duration-300" 
                             style={{ width: `${analysisProgress}%` }}
                           ></div>
                       </div>
                       <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                           <span>{Math.round(analysisProgress)}% complete</span>
                           <span>{estTimeRemaining}</span>
                       </div>
                   </div>
                ) : showSuccessMessage ? (
                   // --- SUCCESS MESSAGE STATE ---
                    <div className="p-2 animate-fade-in relative flex items-center justify-center">
                        <button 
                            onClick={() => setShowSuccessMessage(false)} 
                            className="absolute top-0 right-0 p-1 text-slate-400 hover:text-slate-600 dark:text-gray-500 dark:hover:text-white"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                        <p className="text-[10px] text-gray-500 leading-relaxed text-center pr-4 pl-4">
                            Your video has been reframed using one of the best video Auto reframing AI intelligent engine developed by <span className="text-brand-secondary font-bold animate-pulse-slow">Rifad Ahmed Adol</span> to provide you a great quality video without any extra cost or any ai token limit.
                        </p>
                    </div>
                ) : (
                   // --- NORMAL STATE ---
                   <>
                       <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider ml-1">Format</label>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-500 dark:text-gray-500 font-bold uppercase tracking-wider">
                                    {isAutoReframe ? 'Auto Reframe' : 'Manual Crop'}
                                </span>
                                <button 
                                    onClick={handleToggleReframe}
                                    className={`w-10 h-5 rounded-full relative transition-colors ${isAutoReframe ? 'bg-brand-secondary' : 'bg-gray-300 dark:bg-gray-700'}`}
                                >
                                    <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${isAutoReframe ? 'translate-x-5' : ''}`}></div>
                                </button>
                            </div>
                        </div>
                        
                        <div className="flex gap-2">
                            {[
                                { id: '9:16', icon: <div className="w-2 h-3 border border-current rounded-[1px]"/> },
                                { id: '16:9', icon: <div className="w-3 h-2 border border-current rounded-[1px]"/> },
                                { id: '1:1', icon: <div className="w-2.5 h-2.5 border border-current rounded-[1px]"/> }
                            ].map((ratio) => (
                                <button
                                key={ratio.id}
                                onClick={() => setAspectRatio(ratio.id as any)}
                                className={`flex-1 p-2 rounded-lg flex items-center justify-center gap-2 transition-all ${
                                    aspectRatio === ratio.id 
                                    ? 'bg-brand-primary text-white shadow-lg' 
                                    : 'bg-white/50 dark:bg-white/5 text-slate-500 dark:text-gray-400 hover:bg-white/80 dark:hover:bg-white/10'
                                }`}
                                >
                                {ratio.icon}
                                <span className="text-xs font-bold">{ratio.id}</span>
                                </button>
                            ))}
                        </div>
                   </>
                )}
            </div>
            
            {/* Duration */}
            <div className="bg-white/40 dark:bg-glass-100 rounded-2xl p-3 border border-white/20 dark:border-white/5">
                <label className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Duration</label>
                <div className="flex bg-gray-200 dark:bg-black/20 rounded-lg p-1">
                    {['30+', '60+', 'Random'].map((mode) => (
                        <button
                            key={mode}
                            onClick={() => setDurationMode((mode === 'Random' ? 'random' : mode) as any)}
                            className={`flex-1 py-1.5 text-[10px] font-bold rounded-md transition-all ${
                                (durationMode === 'random' && mode === 'Random') || durationMode === mode
                                ? 'bg-white text-slate-900 shadow-sm' 
                                : 'text-gray-500 hover:text-slate-800 dark:hover:text-white'
                            }`}
                        >
                            {mode}
                        </button>
                    ))}
                </div>
            </div>

            {/* Clip Count */}
            <div className="bg-white/40 dark:bg-glass-100 rounded-2xl p-3 border border-white/20 dark:border-white/5">
                <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase tracking-wider">Count</label>
                    <span className="text-xs font-bold text-brand-secondary bg-brand-secondary/10 px-2 py-0.5 rounded-full">{clipCount}</span>
                </div>
                <input 
                    type="range" 
                    min="1" 
                    max="10" 
                    value={clipCount} 
                    onChange={(e) => setClipCount(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-gray-300 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-secondary"
                />
            </div>
        </div>
        
        {/* Advanced Section */}
        <div className="mb-4">
             <button 
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between bg-white/40 dark:bg-glass-100 p-3 rounded-xl border border-white/20 dark:border-white/5 hover:bg-white/60 dark:hover:bg-white/5 transition-colors"
             >
                 <span className="font-bold text-xs uppercase tracking-wider text-slate-600 dark:text-gray-300">Advanced / Overlays</span>
                 <svg className={`w-5 h-5 text-gray-400 transform transition-transform ${showAdvanced ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
             </button>
             
             {showAdvanced && (
                 <div className="mt-2 bg-white/40 dark:bg-black/20 rounded-xl border border-white/20 dark:border-white/5 p-3 space-y-4 animate-fade-in">
                     <div className="flex gap-2">
                         <button onClick={addOverlayText} className="flex-1 py-2 bg-white/60 dark:bg-glass-200 hover:bg-white/80 dark:hover:bg-glass-300 rounded-lg text-xs font-bold text-slate-800 dark:text-white border border-white/10">+ Text</button>
                         <button onClick={() => triggerFileUpload('image')} className="flex-1 py-2 bg-white/60 dark:bg-glass-200 hover:bg-white/80 dark:hover:bg-glass-300 rounded-lg text-xs font-bold text-slate-800 dark:text-white border border-white/10">+ Image</button>
                     </div>
                     {overlays.map((ov) => (
                         <div key={ov.id} className="bg-white/50 dark:bg-white/5 rounded-lg p-3 border border-white/20 dark:border-white/5 flex justify-between items-center">
                             <span className="text-xs font-bold uppercase text-brand-accent">{ov.type}</span>
                             <button onClick={() => removeOverlay(ov.id)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                         </div>
                     ))}
                 </div>
             )}
        </div>

        <div className="relative group mt-auto">
            <button 
              onClick={handleGenerate}
              disabled={isGenerating || isAnalyzing}
              className={`w-full py-4 mt-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2
                ${isAnalyzing 
                    ? 'bg-gray-200 dark:bg-gray-800 text-gray-500 cursor-not-allowed border border-white/5' 
                    : 'bg-gradient-to-r from-brand-primary to-brand-secondary text-white shadow-[0_0_30px_rgba(99,102,241,0.3)] active:scale-95'
                }`}
            >
              {isGenerating ? <span>Processing Video...</span> : isAnalyzing ? <span>Waiting for Analysis...</span> : <span>Generate Shorts</span>}
            </button>
        </div>
      </div>
    </div>
  );
};