import React, { useState, useRef, useEffect, useMemo } from 'react';
import { GlassCard } from './ui/GlassCard';
import { VideoProject, GeneratedClip, OverlayPosition } from '../types';
import { processVideoClip, downloadBlob, ExportSettings, getSupportedFormats, VideoFormat } from '../services/videoExportService';
import { getInterpolatedReframe } from '../services/reframeService';

interface ClipGalleryProps {
  project: VideoProject;
  clips: GeneratedClip[];
  onEdit: (clip: GeneratedClip) => void;
  onBack: () => void;
  onUpdateClips: (clips: GeneratedClip[]) => void;
}

export const ClipGallery: React.FC<ClipGalleryProps> = ({ project, clips: initialClips, onEdit, onBack, onUpdateClips }) => {
  const [clips, setClips] = useState<GeneratedClip[]>(initialClips);
  const [playingId, setPlayingId] = useState<string | null>(null);
  
  // --- Selection State ---
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // --- Export State ---
  // Config context: either a single clip or 'multi' for batch
  const [configScope, setConfigScope] = useState<{ type: 'single', clip: GeneratedClip } | { type: 'multi', clips: GeneratedClip[] } | null>(null);
  const [originalDimensions, setOriginalDimensions] = useState<{width: number, height: number} | null>(null);
  const [maxCropDimensions, setMaxCropDimensions] = useState<{width: number, height: number} | null>(null);
  
  // Configuration settings
  const [selectedQuality, setSelectedQuality] = useState<string>('1080p');
  const [selectedFps, setSelectedFps] = useState<number>(0); // 0 = Original
  const [selectedFormat, setSelectedFormat] = useState<VideoFormat | null>(null);
  const [supportedFormats, setSupportedFormats] = useState<VideoFormat[]>([]);
  
  // Progress/Process State
  const [processingClip, setProcessingClip] = useState<GeneratedClip | null>(null);
  const [processingThumbnail, setProcessingThumbnail] = useState<string | null>(null); 
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState<'idle' | 'processing' | 'success'>('idle');
  
  // Batch specific state
  const [exportQueue, setExportQueue] = useState<GeneratedClip[]>([]);
  const [processedCount, setProcessedCount] = useState(0);
  
  const videoRefs = useRef<{[key: string]: HTMLVideoElement | null}>({});
  const hiddenMetaVideoRef = useRef<HTMLVideoElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Overlay Scaling Factor for Gallery Thumbs
  const GALLERY_SCALE = 0.6;

  useEffect(() => {
    setClips(initialClips);
  }, [initialClips]);

  // Load supported formats on mount
  useEffect(() => {
      const formats = getSupportedFormats();
      setSupportedFormats(formats);
      if (formats.length > 0) {
          setSelectedFormat(formats[0]);
      }
  }, []);

  // Determine source format from filename
  const sourceFormat = useMemo(() => {
      if (!project.name) return 'MP4';
      const parts = project.name.split('.');
      return parts.length > 1 ? parts.pop()?.toUpperCase() : 'MP4';
  }, [project.name]);

  // Robust metadata loading
  useEffect(() => {
    const video = hiddenMetaVideoRef.current;
    if (video && project.videoUrl) {
        setOriginalDimensions(null);
        setMaxCropDimensions(null);

        const handleMetadata = () => {
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                setOriginalDimensions({
                    width: video.videoWidth,
                    height: video.videoHeight
                });

                const sourceRatio = video.videoWidth / video.videoHeight;
                let targetRatio = 9/16; // default
                
                if (project.aspectRatio === '16:9') targetRatio = 16/9;
                else if (project.aspectRatio === '1:1') targetRatio = 1;

                let maxCropW, maxCropH;

                if (Math.abs(sourceRatio - targetRatio) < 0.01) {
                    maxCropW = video.videoWidth;
                    maxCropH = video.videoHeight;
                } else if (sourceRatio > targetRatio) {
                    maxCropH = video.videoHeight;
                    maxCropW = Math.round(maxCropH * targetRatio);
                } else {
                    maxCropW = video.videoWidth;
                    maxCropH = Math.round(maxCropW / targetRatio);
                }
                
                setMaxCropDimensions({ width: maxCropW, height: maxCropH });
            }
        };

        if (video.readyState >= 1) handleMetadata();
        video.addEventListener('loadedmetadata', handleMetadata);
        return () => video.removeEventListener('loadedmetadata', handleMetadata);
    }
  }, [project.videoUrl, project.aspectRatio]);

  // --- REFRAME ANIMATION LOOP ---
  useEffect(() => {
    let rafId: number;
    const loop = () => {
      if (playingId) {
        const video = videoRefs.current[playingId];
        const clip = clips.find(c => c.id === playingId);
        
        if (video && clip?.reframeKeyframes) {
             const { x, y, scale } = getInterpolatedReframe(clip.reframeKeyframes, video.currentTime);
             video.style.objectPosition = `${x * 100}% ${y * 100}%`;
             video.style.transform = `scale(${scale})`;
        }
      }
      rafId = requestAnimationFrame(loop);
    };
    
    if (playingId) loop();
    return () => cancelAnimationFrame(rafId);
  }, [playingId, clips]);

  const updateStaticPreview = (clip: GeneratedClip, video: HTMLVideoElement) => {
       if (clip.reframeKeyframes) {
           const { x, y, scale } = getInterpolatedReframe(clip.reframeKeyframes, clip.startTime);
           video.style.objectPosition = `${x * 100}% ${y * 100}%`;
           video.style.transform = `scale(${scale})`;
       } else {
           // Default center if no reframe data
           video.style.objectPosition = '50% 50%';
           video.style.transform = 'scale(1)';
       }
  };

  const aspectRatioClass = {
    '9:16': 'aspect-[9/16]',
    '16:9': 'aspect-[16/9]',
    '1:1': 'aspect-square'
  }[project.aspectRatio] || 'aspect-[9/16]';

  const availableResolutions = useMemo(() => {
      const ratio = project.aspectRatio;
      const list = [];
      if (ratio === '9:16') {
          list.push({ label: '720p', width: 720, height: 1280 });
          list.push({ label: '1080p', width: 1080, height: 1920 });
          list.push({ label: '2K', width: 1440, height: 2560 });
          list.push({ label: '4K', width: 2160, height: 3840 });
      } else if (ratio === '16:9') {
          list.push({ label: '720p', width: 1280, height: 720 });
          list.push({ label: '1080p', width: 1920, height: 1080 });
          list.push({ label: '2K', width: 2560, height: 1440 });
          list.push({ label: '4K', width: 3840, height: 2160 });
      } else {
          list.push({ label: '720p', width: 720, height: 720 });
          list.push({ label: '1080p', width: 1080, height: 1080 });
          list.push({ label: '2K', width: 1440, height: 1440 });
          list.push({ label: '4K', width: 2160, height: 2160 });
      }
      return list;
  }, [project.aspectRatio]);

  const isResolutionSupported = (res: {width: number, height: number}) => {
      if (!maxCropDimensions) return true;
      return res.width <= maxCropDimensions.width + 5 && res.height <= maxCropDimensions.height + 5;
  };

  const getOverlayPositionStyle = (pos: OverlayPosition): React.CSSProperties => {
      const spacing = '5%';
      // Dynamic spacing set to 15% as per request
      const bottomSpacing = '15%';

      switch (pos) {
          case 'top-left': return { top: spacing, left: spacing };
          case 'top-center': return { top: spacing, left: '50%', transform: 'translateX(-50%)' };
          case 'top-right': return { top: spacing, right: spacing };
          case 'bottom-left': return { bottom: spacing, left: spacing };
          case 'bottom-center': return { bottom: bottomSpacing, left: '50%', transform: 'translateX(-50%)' };
          case 'bottom-right': return { bottom: spacing, right: spacing };
          default: return { top: spacing, left: spacing };
      }
  };

  // --- SELECTION LOGIC ---
  const toggleSelectionMode = () => {
      if (isSelectionMode) {
          setIsSelectionMode(false);
          setSelectedIds(new Set());
      } else {
          setIsSelectionMode(true);
      }
  };

  const toggleSelectAll = () => {
      if (selectedIds.size === clips.length) {
          setSelectedIds(new Set());
      } else {
          setSelectedIds(new Set(clips.map(c => c.id)));
      }
  };

  const handleCardClick = (clip: GeneratedClip) => {
      if (isSelectionMode) {
          const newSet = new Set(selectedIds);
          if (newSet.has(clip.id)) {
              newSet.delete(clip.id);
          } else {
              newSet.add(clip.id);
          }
          setSelectedIds(newSet);
      } else {
          togglePlay(clip);
      }
  };

  const handleDeleteSelected = () => {
      if (window.confirm(`Delete ${selectedIds.size} selected clips?`)) {
          const newClips = clips.filter(c => !selectedIds.has(c.id));
          onUpdateClips(newClips);
          setClips(newClips);
          setSelectedIds(new Set());
          if (newClips.length === 0) setIsSelectionMode(false);
      }
  };

  // --- EXPORT LOGIC ---

  // Handle click on "Export" button on a card (Single)
  const handleSingleExportClick = (e: React.MouseEvent, clip: GeneratedClip) => {
    e.stopPropagation();
    initExportConfig({ type: 'single', clip });
  };

  // Handle "Export Selected" button (Multi)
  const handleBatchExportClick = () => {
      const selectedClips = clips.filter(c => selectedIds.has(c.id));
      if (selectedClips.length === 0) return;
      initExportConfig({ type: 'multi', clips: selectedClips });
  };

  const initExportConfig = (scope: { type: 'single', clip: GeneratedClip } | { type: 'multi', clips: GeneratedClip[] }) => {
    // Default logic
    const validRes = availableResolutions.filter(r => isResolutionSupported(r));
    const defaultRes = validRes.find(r => r.label === '1080p') || validRes[validRes.length - 1] || availableResolutions[0];
    
    setSelectedQuality(defaultRes.label);
    setSelectedFps(0);
    
    if (!selectedFormat && supportedFormats.length > 0) {
        setSelectedFormat(supportedFormats[0]);
    }
    setConfigScope(scope);
  };

  const captureThumbnail = (clip: GeneratedClip): string => {
      let thumbUrl = project.thumbnailUrl;
      const videoEl = videoRefs.current[clip.id];
      if (videoEl && videoEl.readyState >= 2) {
          try {
             const canvas = document.createElement('canvas');
             canvas.width = videoEl.videoWidth;
             canvas.height = videoEl.videoHeight;
             const ctx = canvas.getContext('2d');
             if (ctx) {
                 ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
                 thumbUrl = canvas.toDataURL('image/jpeg', 0.85);
             }
          } catch (e) { console.warn(e); }
      }
      return thumbUrl;
  };

  // Recursive queue processor
  const processQueue = async (
    queue: GeneratedClip[], 
    index: number, 
    settings: ExportSettings, 
    controller: AbortController
  ) => {
      if (index >= queue.length || controller.signal.aborted) {
          // Finished all
          setExportStatus('success');
          setProcessingClip(null); // Keep success screen but maybe clear specific clip info
          
          setTimeout(() => {
             // Reset UI
             setProcessingClip(null);
             setProcessingThumbnail(null);
             setExportStatus('idle');
             setExportQueue([]);
             setProcessedCount(0);
             setConfigScope(null);
             
             // If batch, exit selection mode
             if (queue.length > 1) {
                 setIsSelectionMode(false);
                 setSelectedIds(new Set());
             }
          }, 2500);
          return;
      }

      const currentClip = queue[index];
      setProcessingClip(currentClip);
      setProcessedCount(index);
      setExportProgress(0);
      setExportStatus('processing');
      
      setProcessingThumbnail(captureThumbnail(currentClip));

      try {
        const blob = await processVideoClip(
            project.videoUrl, 
            currentClip, 
            { 
              ...settings, 
              reframeKeyframes: currentClip.reframeKeyframes,
              overlays: currentClip.overlays // PASS OVERLAYS
            },
            (progress) => {
                setExportProgress(progress);
            },
            controller.signal
        );
        
        // Download current
        const fpsLabel = settings.fps === 0 ? 'OriginalFPS' : `${settings.fps}fps`;
        // Find extension from formats list
        const ext = supportedFormats.find(f => f.value === settings.format)?.extension || 'mp4';
        
        downloadBlob(blob, `${project.name.split('.')[0]}-${currentClip.label}-${settings.qualityLabel}-${fpsLabel}.${ext}`);
        
        // Wait a small moment before next
        setTimeout(() => {
            processQueue(queue, index + 1, settings, controller);
        }, 500);

      } catch (error: any) {
          if (error.name === 'AbortError') {
              console.log('Aborted');
          } else {
              console.error("Export failed for " + currentClip.label, error);
              // Continue to next even if fail? Or stop? 
              // Let's stop and alert.
              alert(`Export failed for ${currentClip.label}. Stopping queue.`);
              setExportStatus('idle');
              setConfigScope(null);
          }
      }
  };

  const startExport = async () => {
      if (!configScope || !selectedFormat) return;
      
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Determine Resolution
      let width, height;
      if (selectedQuality === 'Original' && maxCropDimensions) {
          width = maxCropDimensions.width;
          height = maxCropDimensions.height;
      } else {
          const resolution = availableResolutions.find(r => r.label === selectedQuality) || availableResolutions[0];
          width = resolution.width;
          height = resolution.height;
      }

      const settings: ExportSettings = {
          width,
          height,
          fps: selectedFps,
          qualityLabel: selectedQuality,
          format: selectedFormat.value,
          mimeType: selectedFormat.mimeType
      };

      // Set Queue
      let queue: GeneratedClip[] = [];
      if (configScope.type === 'single') {
          queue = [configScope.clip];
      } else {
          queue = configScope.clips;
      }

      setExportQueue(queue);
      setConfigScope(null); // Close config modal
      
      // Start Queue
      processQueue(queue, 0, settings, controller);
  };

  const cancelExport = () => {
      if (abortControllerRef.current) {
          abortControllerRef.current.abort();
      }
      setProcessingClip(null);
      setProcessingThumbnail(null);
      setExportStatus('idle');
      setExportProgress(0);
  };

  const safePlay = async (video: HTMLVideoElement) => {
      try {
          await video.play();
      } catch (error: any) {
          if (error.name !== 'AbortError') {
              console.error("Play error:", error);
          }
      }
  };

  const togglePlay = (clip: GeneratedClip) => {
    const video = videoRefs.current[clip.id];
    if (!video) return;

    if (playingId === clip.id) {
      video.pause();
      setPlayingId(null);
    } else {
      if (playingId && videoRefs.current[playingId]) {
        videoRefs.current[playingId]?.pause();
      }
      if (video.currentTime < clip.startTime || video.currentTime >= clip.endTime) {
        video.currentTime = clip.startTime;
      }
      safePlay(video);
      setPlayingId(clip.id);
    }
  };

  const handleTimeUpdate = (clip: GeneratedClip) => {
    const video = videoRefs.current[clip.id];
    if (!video) return;
    if (video.currentTime >= clip.endTime) {
      video.currentTime = clip.startTime;
      safePlay(video);
    }
  };

  return (
    <div className="flex flex-col h-full p-4 animate-fade-in relative">
      <video ref={hiddenMetaVideoRef} src={project.videoUrl} className="hidden" muted playsInline preload="auto" />

      {/* HEADER */}
      <div className="flex items-center justify-between mb-6 mt-2 z-10" onClick={(e) => e.stopPropagation()}>
        <button onClick={onBack} className="p-2 rounded-full bg-white/60 dark:bg-glass-200 hover:bg-white/80 dark:hover:bg-glass-300 transition-colors backdrop-blur-md shadow-sm">
          <svg className="w-6 h-6 text-slate-800 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
        </button>
        
        {isSelectionMode ? (
             <div className="flex items-center gap-4">
                 <button onClick={toggleSelectAll} className="text-sm font-medium text-slate-800 dark:text-white/80 hover:text-slate-900 dark:hover:text-white">
                    {selectedIds.size === clips.length ? 'Unselect All' : 'Select All'}
                 </button>
                 <button onClick={toggleSelectionMode} className="text-sm font-bold text-brand-secondary">
                    Done
                 </button>
             </div>
        ) : (
             <div className="flex items-center gap-4">
                 <h2 className="text-xl font-bold text-slate-800 dark:text-white drop-shadow-md">Generated Shorts</h2>
                 <button onClick={toggleSelectionMode} className="px-3 py-1 bg-white/60 dark:bg-glass-200 rounded-full text-xs font-bold hover:bg-white/80 dark:hover:bg-glass-300 transition-colors text-slate-800 dark:text-white">
                    Select
                 </button>
             </div>
        )}
      </div>

      {/* GRID */}
      <div className={`grid grid-cols-2 gap-4 pb-32 overflow-y-auto no-scrollbar ${project.aspectRatio === '16:9' ? 'auto-rows-min' : ''}`}>
        {clips.map((clip) => {
            const duration = Math.round(clip.endTime - clip.startTime);
            const isPlaying = playingId === clip.id;
            const isSelected = selectedIds.has(clip.id);

            return (
                <div key={clip.id} className="relative rounded-2xl transition-all duration-300 scale-100">
                    <GlassCard 
                        className={`group flex flex-col overflow-hidden border-white/20 dark:border-white/10 h-full ${isSelected ? 'ring-2 ring-brand-primary bg-brand-primary/10' : ''}`} 
                        hoverEffect={false}
                        onClick={() => handleCardClick(clip)} // Clicking whole card handles select if mode active
                    >
                        {/* Video Area */}
                        <div className={`relative ${aspectRatioClass} bg-gray-900 cursor-pointer overflow-hidden`}>
                            {/* Checkbox Overlay (Visible only in selection mode) */}
                            {isSelectionMode && (
                                <div className="absolute top-2 right-2 z-20">
                                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-brand-primary border-brand-primary' : 'bg-black/40 border-white/50'}`}>
                                        {isSelected && <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                    </div>
                                </div>
                            )}

                            {project.videoUrl ? (
                                <video 
                                    ref={el => {
                                        videoRefs.current[clip.id] = el;
                                        if (el) updateStaticPreview(clip, el);
                                    }}
                                    onLoadedData={(e) => updateStaticPreview(clip, e.currentTarget)}
                                    src={`${project.videoUrl}#t=${clip.startTime},${clip.endTime}`} 
                                    className="w-full h-full object-cover pointer-events-none" // pointer-events-none ensures click goes to parent
                                    playsInline
                                    preload="metadata"
                                    loop={false} 
                                    onTimeUpdate={() => handleTimeUpdate(clip)}
                                    style={{ transition: isPlaying ? 'none' : 'object-position 0.3s ease' }} // Smooth reset, instant tracking
                                />
                            ) : (
                                <img src={project.thumbnailUrl} className="w-full h-full object-cover opacity-80" alt="thumb" />
                            )}

                            {/* --- OVERLAYS PREVIEW --- */}
                            {clip.overlays?.map(ov => (
                                <div 
                                    key={ov.id}
                                    className="absolute z-10 pointer-events-none"
                                    style={getOverlayPositionStyle(ov.position)}
                                >
                                    {ov.type === 'text' && (
                                        <div style={{
                                            fontSize: `${ov.scale * GALLERY_SCALE}px`,
                                            color: ov.style?.color,
                                            backgroundColor: ov.style?.backgroundColor,
                                            padding: '0.2em 0.5em',
                                            borderRadius: '0.2em',
                                            fontWeight: 'bold',
                                            whiteSpace: 'nowrap',
                                            fontFamily: 'Inter, sans-serif'
                                        }}>
                                            {ov.content}
                                        </div>
                                    )}
                                    {ov.type === 'image' && (
                                            <img 
                                                src={ov.content} 
                                                alt="overlay" 
                                                style={{ width: `${ov.scale * 3 * GALLERY_SCALE}px`, maxWidth: '80%' }} 
                                            />
                                    )}
                                    {ov.type === 'video' && (
                                            <video 
                                                src={ov.content}
                                                muted loop autoPlay playsInline
                                                style={{ width: `${ov.scale * 3 * GALLERY_SCALE}px`, maxWidth: '80%', borderRadius: '4px' }}
                                            />
                                    )}
                                </div>
                            ))}
                            
                            {/* Play Overlay (Hidden in selection mode) */}
                            {!isSelectionMode && (
                                <div className={`absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px] transition-all duration-300 ${isPlaying ? 'opacity-0' : 'opacity-100'} group-hover:bg-black/40`}>
                                     {!isPlaying && (
                                         <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30 shadow-lg scale-90 transition-transform">
                                           <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                         </div>
                                     )}
                                </div>
                            )}
                            
                            <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-mono text-white pointer-events-none border border-white/10">
                                {duration}s
                            </div>
                        </div>

                        {/* Actions Area */}
                        <div className="p-3 flex flex-col gap-2 bg-white/60 dark:bg-glass-100 border-t border-white/5 flex-grow justify-between">
                            <div>
                                <div className="text-sm font-semibold text-slate-900 dark:text-white truncate px-1">{clip.label}</div>
                                {originalDimensions && (
                                    <div className="flex items-center gap-2 mt-1.5 px-1 text-[10px] text-slate-500 dark:text-gray-500 font-mono tracking-tight">
                                        <span className="bg-black/5 dark:bg-white/5 px-1.5 rounded flex items-center gap-1">
                                            {originalDimensions.width}×{originalDimensions.height}
                                        </span>
                                    </div>
                                )}
                            </div>
                            
                            {/* Individual Buttons (Hidden in Selection Mode) */}
                            {!isSelectionMode && (
                                <div className="flex gap-2 mt-2">
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); onEdit(clip); }}
                                        className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl bg-white dark:bg-glass-200 hover:bg-gray-100 dark:hover:bg-glass-300 text-xs font-bold text-slate-700 dark:text-white transition-all active:scale-95 border border-black/5 dark:border-white/5 shadow-sm"
                                    >
                                        Edit
                                    </button>
                                    <button 
                                        onClick={(e) => handleSingleExportClick(e, clip)}
                                        className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl bg-gradient-to-r from-brand-primary to-brand-accent hover:opacity-90 text-xs font-bold text-white shadow-lg transition-all active:scale-95 border border-white/10"
                                    >
                                        Export
                                    </button>
                                </div>
                            )}
                        </div>
                    </GlassCard>
                </div>
            );
        })}
      </div>

      {/* SELECTION ACTION BAR */}
      {isSelectionMode && selectedIds.size > 0 && (
          <div className="fixed bottom-6 left-4 right-4 z-40">
              <GlassCard className="flex items-center justify-between p-4 bg-white/90 dark:bg-black/80 backdrop-blur-xl border-white/20 dark:border-white/10 shadow-2xl">
                  <span className="text-slate-900 dark:text-white font-semibold text-sm ml-2">{selectedIds.size} Selected</span>
                  <div className="flex gap-3">
                      <button 
                         onClick={handleDeleteSelected}
                         className="px-4 py-2 rounded-lg bg-red-500/10 dark:bg-red-500/20 text-red-600 dark:text-red-400 font-bold text-xs border border-red-500/30 hover:bg-red-500/30 transition-colors"
                      >
                          Delete
                      </button>
                      <button 
                         onClick={handleBatchExportClick}
                         className="px-6 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-black font-bold text-xs shadow-lg hover:opacity-90 transition-colors"
                      >
                          Export ({selectedIds.size})
                      </button>
                  </div>
              </GlassCard>
          </div>
      )}

      {/* --- EXPORT CONFIG MODAL --- */}
      {configScope && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in" onClick={() => setConfigScope(null)}>
            <div className="w-full max-w-sm bg-white dark:bg-[#18181b] border border-white/20 dark:border-white/10 rounded-3xl p-6 shadow-2xl transform transition-transform duration-300 relative" onClick={e => e.stopPropagation()}>
                
                <button 
                  onClick={() => setConfigScope(null)}
                  className="absolute top-4 right-4 p-2 text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>

                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">
                    {configScope.type === 'single' ? 'Export Settings' : `Export ${configScope.clips.length} Clips`}
                </h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
                    {configScope.type === 'single' ? `Configure quality for "${configScope.clip.label}"` : 'Apply settings to all selected clips'}
                </p>

                {/* Original Option */}
                <button
                    onClick={() => { setSelectedQuality('Original'); setSelectedFps(0); }}
                    className={`w-full py-4 mb-6 rounded-xl border flex items-center justify-between px-4 transition-all group ${
                        selectedQuality === 'Original'
                        ? 'bg-gradient-to-r from-brand-primary/10 to-brand-accent/10 dark:from-brand-primary/40 dark:to-brand-accent/40 border-brand-accent text-brand-primary dark:text-white shadow-lg ring-1 ring-brand-primary/20 dark:ring-white/20'
                        : 'bg-gray-50 dark:bg-white/5 border-transparent text-gray-400 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10'
                    }`}
                >
                    <div className="flex flex-col items-start">
                        <span className="font-bold text-sm flex items-center gap-2">
                           <span className="text-xl">✨</span> Original Quality
                        </span>
                        <span className="text-[10px] opacity-60 mt-0.5">Max resolution for {project.aspectRatio} crop.</span>
                    </div>
                </button>

                 {/* Format Selector */}
                <div className="mb-4">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Format</label>
                    <div className="flex gap-2">
                        {supportedFormats.map(fmt => (
                            <button key={fmt.value} onClick={() => setSelectedFormat(fmt)} className={`flex-1 py-2 px-2 rounded-lg border text-xs font-bold ${selectedFormat?.value === fmt.value ? 'bg-slate-900 dark:bg-white/10 border-slate-900 dark:border-white/20 text-white' : 'bg-gray-100 dark:bg-white/5 border-transparent text-gray-500'}`}>{fmt.label}</button>
                        ))}
                    </div>
                </div>

                {/* Resolution Selector */}
                <div className="mb-4">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Crop Resolution</label>
                    <div className="grid grid-cols-2 gap-2">
                        {availableResolutions.map(res => {
                            const supported = isResolutionSupported(res);
                            return (
                                <div key={res.label} className="relative group">
                                    <button
                                        onClick={() => setSelectedQuality(res.label)}
                                        className={`w-full py-3 px-3 rounded-xl border flex items-center justify-between transition-all ${
                                            selectedQuality === res.label 
                                                ? 'bg-brand-primary/10 dark:bg-brand-primary/20 border-brand-primary text-brand-primary dark:text-white shadow-[0_0_15px_rgba(99,102,241,0.2)]' 
                                                : !supported
                                                    ? 'bg-gray-50 dark:bg-white/5 border-transparent text-gray-400 dark:text-gray-500' // Visual cue it's upscaling
                                                    : 'bg-gray-50 dark:bg-white/5 border-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-sm">{res.label}</span>
                                            {!supported && (
                                                <span className="text-[10px] text-yellow-600 dark:text-yellow-500 font-bold" title="Upscaled">▲</span>
                                            )}
                                        </div>
                                        <span className="text-[10px] opacity-60 font-mono">{res.width}x{res.height}</span>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* FPS Selector */}
                <div className="mb-8">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Frame Rate</label>
                    <div className="flex gap-2">
                        {[
                          { val: 0, label: 'Original' }, 
                          { val: 30, label: '30 FPS' }, 
                          { val: 60, label: '60 FPS' }
                        ].map(fpsOpt => (
                            <button
                                key={fpsOpt.val}
                                onClick={() => setSelectedFps(fpsOpt.val)}
                                className={`flex-1 py-2 rounded-lg border font-bold text-xs transition-all ${
                                    selectedFps === fpsOpt.val
                                    ? 'bg-brand-secondary/10 dark:bg-brand-secondary/20 border-brand-secondary text-brand-secondary dark:text-white'
                                    : 'bg-gray-50 dark:bg-white/5 border-transparent text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10'
                                }`}
                            >
                                {fpsOpt.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex gap-3">
                    <button 
                        onClick={startExport}
                        className="w-full py-4 rounded-xl bg-gradient-to-r from-brand-primary to-brand-accent text-white font-bold shadow-lg active:scale-95 transition-all"
                    >
                        {configScope.type === 'single' ? 'Start Export' : `Export All ${configScope.clips.length} Clips`}
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* --- PROGRESS MODAL --- */}
      {processingClip && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-white/90 dark:bg-black/90 backdrop-blur-xl animate-fade-in">
            <style>{`
               @keyframes shimmer {
                 0% { transform: translateX(-150%) skewX(-12deg); }
                 100% { transform: translateX(150%) skewX(-12deg); }
               }
               .text-shadow-glow {
                 text-shadow: 0 0 10px rgba(99,102,241,0.8);
               }
            `}</style>
            <div className="w-full max-w-sm p-8 flex flex-col items-center text-center">
                
                {/* Batch Progress Indicator */}
                {exportQueue.length > 1 && (
                     <div className="mb-4 bg-black/5 dark:bg-white/10 px-3 py-1 rounded-full text-xs font-mono text-gray-600 dark:text-white/80 border border-black/5 dark:border-white/5">
                        Exporting Clip {processedCount + 1} of {exportQueue.length}
                     </div>
                )}

                <div className={`relative w-48 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(99,102,241,0.3)] border border-white/10 mb-8 transition-all duration-500 ${exportStatus === 'success' ? 'scale-105 ring-2 ring-green-400' : ''} ${aspectRatioClass}`}>
                    <img 
                        src={processingThumbnail || project.thumbnailUrl} 
                        className="absolute inset-0 w-full h-full object-cover filter grayscale brightness-50 contrast-125 blur-[1px]" 
                        alt="Processing Base" 
                    />
                    <div 
                        className="absolute inset-0 transition-all duration-200 ease-linear will-change-[clip-path]"
                        style={{ clipPath: `inset(0 0 ${100 - exportProgress}% 0)` }}
                    >
                         <img 
                             src={processingThumbnail || project.thumbnailUrl} 
                             className="w-full h-full object-cover" 
                             alt="Processing Progress" 
                         />
                         {exportStatus === 'processing' && (
                             <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white shadow-[0_0_20px_2px_rgba(99,102,241,0.9)] z-20"></div>
                         )}
                    </div>
                    {exportStatus === 'success' && (
                        <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center animate-fade-in z-30">
                           <svg className="w-20 h-20 text-green-400 drop-shadow-lg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" className="animate-[dash_0.6s_ease-in-out_forwards]" style={{ strokeDasharray: 100, strokeDashoffset: 100 }} />
                           </svg>
                           <style>{`@keyframes dash { to { stroke-dashoffset: 0; } }`}</style>
                        </div>
                    )}
                </div>

                <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                    {exportStatus === 'processing' ? 'Exporting...' : 'All Done!'}
                </h3>
                
                {exportStatus === 'processing' && (
                    <div className="w-full mt-6">
                         {/* Percentage Status */}
                         <div className="flex justify-between text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">
                             <span>Rendering</span>
                             <span className="text-brand-primary text-shadow-glow">{Math.round(exportProgress)}%</span>
                         </div>

                         {/* Sparkle Progress Bar */}
                         <div className="h-3 w-full bg-gray-200 dark:bg-black/50 rounded-full overflow-hidden border border-black/5 dark:border-white/10 relative shadow-inner">
                             {/* Gradient Fill */}
                             <div 
                                className="h-full bg-gradient-to-r from-brand-primary via-brand-accent to-brand-secondary transition-all duration-200 ease-out relative"
                                style={{ width: `${exportProgress}%`, boxShadow: '0 0 15px rgba(99,102,241,0.5)' }}
                             >
                                 {/* Sparkle/Shimmer Overlay */}
                                 <div 
                                    className="absolute inset-0 bg-white/30 w-full h-full"
                                    style={{ animation: 'shimmer 1.5s infinite linear' }}
                                 ></div>
                                 {/* Leading Edge Glow */}
                                 <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-full bg-white/90 blur-[2px] shadow-[0_0_8px_3px_rgba(255,255,255,0.8)]"></div>
                             </div>
                         </div>
                        <button onClick={cancelExport} className="mt-8 text-sm text-gray-500 hover:text-red-400 transition-colors">Cancel</button>
                    </div>
                )}
            </div>
        </div>
      )}
    </div>
  );
};