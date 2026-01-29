import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GlassCard } from '../ui/GlassCard';
import { Timeline } from './Timeline';
import { VideoProject, TimelineSegment, UserTier, GeminiAnalysisResult, GeneratedClip, OverlayConfig, OverlayPosition } from '../../types';
import { analyzeVideoContext, analyzeVideoLocal } from '../../services/geminiService';
import { getInterpolatedReframe } from '../../services/reframeService';
import { processVideoClip, downloadBlob, getSupportedFormats, VideoFormat, ExportSettings } from '../../services/videoExportService';

interface EditorProps {
  project: VideoProject;
  initialClip?: GeneratedClip; // New Prop
  userTier: UserTier;
  onBack: () => void;
  onUpgrade: () => void;
}

export const Editor: React.FC<EditorProps> = ({ project, initialClip, userTier, onBack, onUpgrade }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisType, setAnalysisType] = useState<'local' | 'gemini'>('local');
  const [geminiResult, setGeminiResult] = useState<GeminiAnalysisResult | null>(null);

  // Overlays State
  const [overlays, setOverlays] = useState<OverlayConfig[]>(initialClip?.overlays || []);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [activeFileType, setActiveFileType] = useState<'image' | 'video' | null>(null);
  const [showLayers, setShowLayers] = useState(false);

  // Export State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportProcessing, setExportProcessing] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState<'idle' | 'processing' | 'success'>('idle');
  
  const [selectedQuality, setSelectedQuality] = useState('1080p');
  const [selectedFps, setSelectedFps] = useState(0);
  const [selectedFormat, setSelectedFormat] = useState<VideoFormat | null>(null);
  const [supportedFormats, setSupportedFormats] = useState<VideoFormat[]>([]);
  const [originalDimensions, setOriginalDimensions] = useState<{width: number, height: number} | null>(null);

  // Determine scope: Full Video vs Clip
  const offset = initialClip ? initialClip.startTime : 0;
  const duration = initialClip ? (initialClip.endTime - initialClip.startTime) : project.duration;
  
  // State for UI time (Relative to start of clip/video)
  const [currentTime, setCurrentTime] = useState(0);

  // Initialize segments
  const [segments, setSegments] = useState<TimelineSegment[]>(() => {
    if (initialClip) {
      return [{
        id: initialClip.id,
        startTime: 0, // Relative 0
        endTime: duration, // Relative duration
        type: 'video',
        label: initialClip.label
      }];
    }
    return [{ id: '1', startTime: 0, endTime: project.duration, type: 'video', label: 'Full Clip' }];
  });

  useEffect(() => {
    // Set initial time if clip is provided
    if (initialClip && videoRef.current) {
        videoRef.current.currentTime = initialClip.startTime;
    }
  }, [initialClip]);

  useEffect(() => {
      const formats = getSupportedFormats();
      setSupportedFormats(formats);
      if (formats.length > 0) setSelectedFormat(formats[0]);
  }, []);

  // Sync overlays back to clip if possible (In a real app, we'd use a callback)
  // For now, we update local state which is what renders.

  // Dynamic Container Style for Exact Aspect Ratio
  const getContainerStyle = () => {
    const ratio = project.aspectRatio; // '9:16', '16:9', '1:1'
    
    const baseStyle: React.CSSProperties = {
      aspectRatio: ratio.replace(':', '/'),
    };

    if (ratio === '9:16') {
       // Portrait: Height is usually the constraint on mobile/desktop
       return { 
         ...baseStyle, 
         height: '100%', 
         maxHeight: '70vh',
         width: 'auto',
       };
    }
    
    if (ratio === '16:9') {
       // Landscape: Width is constraint
       return { 
         ...baseStyle, 
         width: '100%', 
         maxWidth: '100%',
         height: 'auto',
         maxHeight: '70vh'
       };
    }
    
    // Square
    return { 
       ...baseStyle, 
       height: '60vh', 
       width: 'auto',
       maxWidth: '100%'
    };
  };

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

  // --- REFRAME VISUALIZER ---
  const updateReframePreview = () => {
      if (videoRef.current && initialClip?.reframeKeyframes) {
           const { x, y, scale } = getInterpolatedReframe(initialClip.reframeKeyframes, videoRef.current.currentTime);
           videoRef.current.style.objectPosition = `${x * 100}% ${y * 100}%`;
           videoRef.current.style.transform = `scale(${scale})`;
      } else if (videoRef.current && !initialClip?.reframeKeyframes) {
           // Reset to center if no reframe data
           videoRef.current.style.objectPosition = '50% 50%';
           videoRef.current.style.transform = 'scale(1)';
      }
  };

  // Initial Load Reframe
  useEffect(() => {
      if (initialClip?.reframeKeyframes && videoRef.current) {
          updateReframePreview();
      }
  }, [initialClip]);


  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const vidTime = videoRef.current.currentTime;
      
      // Update Reframe
      updateReframePreview();

      // Update UI Time (Relative)
      const relativeTime = vidTime - offset;
      setCurrentTime(relativeTime);
      
      // Loop playback for the specific clip in Editor
      if (initialClip && isPlaying) {
        if (vidTime >= initialClip.endTime) {
            videoRef.current.currentTime = initialClip.startTime;
            setCurrentTime(0);
        }
      }
    }
  };

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        // If we are at the end, restart
        if (initialClip && videoRef.current.currentTime >= initialClip.endTime) {
            videoRef.current.currentTime = initialClip.startTime;
        }
        videoRef.current.play();
        setIsPlaying(true);
        // Play Overlay Videos
        overlays.forEach(ov => {
           if (ov.type === 'video') {
             const el = document.getElementById(`editor-overlay-${ov.id}`) as HTMLVideoElement;
             if(el) { el.currentTime = 0; el.play(); }
           }
        });
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
        // Pause Overlay Videos
        overlays.forEach(ov => {
            if (ov.type === 'video') {
              const el = document.getElementById(`editor-overlay-${ov.id}`) as HTMLVideoElement;
              if(el) el.pause();
            }
        });
      }
    }
  };

  const handleSeek = (time: number) => {
    if (videoRef.current) {
      // Seek Absolute = Relative Seek Time + Offset
      const absoluteTime = time + offset;
      videoRef.current.currentTime = absoluteTime;
      setCurrentTime(time);
      updateReframePreview(); // Update preview instantly on seek
    }
  };

  // --- OVERLAY LOGIC ---
  const getOverlayPositionStyle = (pos: OverlayPosition): React.CSSProperties => {
      const spacing = '5%';
      // Fixed 15% bottom spacing as requested
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

  const addOverlayText = () => {
    const newOverlay: OverlayConfig = {
        id: Date.now().toString(),
        type: 'text',
        content: 'EDIT ME',
        position: 'bottom-center',
        scale: 40, 
        style: { color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.5)' }
    };
    setOverlays([...overlays, newOverlay]);
    setSelectedOverlayId(newOverlay.id);
    setShowLayers(true);
  };

  const triggerFileUpload = (type: 'image' | 'video') => {
      setActiveFileType(type);
      if (fileInputRef.current) {
          fileInputRef.current.accept = type === 'image' ? 'image/*' : 'video/*';
          fileInputRef.current.click();
      }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && activeFileType) {
          const url = URL.createObjectURL(file);
          const newOverlay: OverlayConfig = {
              id: Date.now().toString(),
              type: activeFileType,
              content: url,
              position: 'top-right',
              scale: 30, // Width %
              file: file
          };
          setOverlays([...overlays, newOverlay]);
          setSelectedOverlayId(newOverlay.id);
          setShowLayers(true);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
      setActiveFileType(null);
  };

  const updateOverlay = (id: string, updates: Partial<OverlayConfig>) => {
      setOverlays(overlays.map(o => o.id === id ? { ...o, ...updates } : o));
  };

  const removeOverlay = (id: string) => {
      setOverlays(overlays.filter(o => o.id !== id));
      if (selectedOverlayId === id) setSelectedOverlayId(null);
  };

  // --- AI CUT LOGIC ---
  const handleMagicCut = async () => {
    setIsPlaying(false);
    if(videoRef.current) videoRef.current.pause();
    setGeminiResult(null);
    setIsAnalyzing(true);

    let result: GeminiAnalysisResult;

    if (userTier === UserTier.PRO) {
      setAnalysisType('gemini');
      const context = window.prompt("Gemini Context (Optional)", "Describe the funny or viral parts of this video...") || "A viral video clip";
      result = await analyzeVideoContext(project.name, context, duration);
    } else {
      setAnalysisType('local');
      result = await analyzeVideoLocal(duration);
    }

    setIsAnalyzing(false);
    setGeminiResult(result);

    if (result.suggestedCuts.length > 0) {
      const newSegments = result.suggestedCuts.map((cut, idx) => ({
        id: `ai-${idx}`,
        startTime: cut.start,
        endTime: cut.end,
        type: 'video' as const, 
        label: cut.reason || 'Viral Moment'
      }));
      setSegments(newSegments);
      
      if (videoRef.current) {
        const firstSegmentStartRelative = newSegments[0].startTime;
        videoRef.current.currentTime = firstSegmentStartRelative + offset;
        setCurrentTime(firstSegmentStartRelative);
      }
    }
  };

  // --- EXPORT LOGIC ---
  const handleExportClick = () => {
      if (videoRef.current) {
         setOriginalDimensions({ width: videoRef.current.videoWidth, height: videoRef.current.videoHeight });
      }
      setShowExportModal(true);
  };

  const startExport = async () => {
      if (!selectedFormat) return;
      setShowExportModal(false);
      setExportProcessing(true);
      setExportStatus('processing');
      setExportProgress(0);

      // Resolve Resolution
      const resolution = availableResolutions.find(r => r.label === selectedQuality) || availableResolutions[0];
      
      const settings: ExportSettings = {
          width: resolution.width,
          height: resolution.height,
          fps: selectedFps,
          qualityLabel: selectedQuality,
          format: selectedFormat.value,
          mimeType: selectedFormat.mimeType
      };

      // Construct Synthesized GeneratedClip for Export
      const exportClip: GeneratedClip = {
          id: initialClip ? initialClip.id : `export-${Date.now()}`,
          projectId: project.id,
          label: initialClip ? initialClip.label : project.name,
          startTime: initialClip ? initialClip.startTime : 0,
          endTime: initialClip ? initialClip.endTime : project.duration,
          reframeKeyframes: initialClip?.reframeKeyframes,
          overlays: overlays 
      };

      try {
          const blob = await processVideoClip(
              project.videoUrl,
              exportClip,
              settings,
              (p) => setExportProgress(p)
          );
          
          const fpsLabel = settings.fps === 0 ? 'OriginalFPS' : `${settings.fps}fps`;
          const ext = supportedFormats.find(f => f.value === settings.format)?.extension || 'mp4';
          downloadBlob(blob, `${project.name.split('.')[0]}-${exportClip.label}-${settings.qualityLabel}-${fpsLabel}.${ext}`);
          
          setExportStatus('success');
          
          setTimeout(() => {
              setExportProcessing(false);
              setExportStatus('idle');
          }, 2500);

      } catch (e) {
          console.error("Export Failed", e);
          alert("Export failed. See console.");
          setExportProcessing(false);
          setExportStatus('idle');
      }
  };

  return (
    <div className="flex flex-col h-full bg-black relative">
      <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
      
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-30 flex justify-between items-center p-4 bg-gradient-to-b from-black/80 to-transparent">
        <button onClick={onBack} className="p-2 rounded-full bg-glass-200 backdrop-blur-md hover:bg-glass-300 transition-colors">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex gap-2">
           <button className="px-4 py-1.5 rounded-full bg-glass-200 text-xs font-semibold backdrop-blur-md border border-white/10 text-white">
             {project.aspectRatio}
           </button>
           <button 
             onClick={handleExportClick}
             className="px-4 py-1.5 rounded-full bg-brand-primary text-white text-xs font-bold shadow-[0_0_15px_rgba(99,102,241,0.5)] active:scale-95 transition-transform"
           >
             Export
           </button>
        </div>
      </div>

      {/* Main Preview Area */}
      <div className="flex-1 relative flex items-center justify-center bg-gray-900 overflow-hidden p-4">
        {/* Aspect Ratio Container */}
        <div 
          className="relative bg-black rounded-lg overflow-hidden shadow-2xl border border-white/10 group transition-all duration-300"
          style={getContainerStyle()}
        >
           {project.videoUrl ? (
             <video 
               ref={videoRef}
               src={project.videoUrl}
               className="w-full h-full object-cover transition-all duration-300" 
               playsInline
               onTimeUpdate={handleTimeUpdate}
               onEnded={() => setIsPlaying(false)}
             />
           ) : (
             <div className="w-full h-full flex items-center justify-center text-gray-500">
               No Video Source
             </div>
           )}

           {/* --- EDITOR OVERLAYS --- */}
           {overlays.map(ov => (
               <div 
                   key={ov.id}
                   className={`absolute z-10 cursor-pointer transition-transform ${selectedOverlayId === ov.id ? 'scale-105 ring-2 ring-brand-primary ring-offset-2 ring-offset-black/50' : ''}`}
                   onClick={(e) => { e.stopPropagation(); setSelectedOverlayId(ov.id); setShowLayers(true); }}
                   style={{
                       ...getOverlayPositionStyle(ov.position),
                   }}
               >
                   {ov.type === 'text' && (
                       <div 
                           style={{ 
                               fontSize: `${ov.scale}px`, 
                               color: ov.style?.color, 
                               backgroundColor: ov.style?.backgroundColor,
                               padding: '0.2em 0.5em',
                               borderRadius: '0.2em',
                               fontWeight: 'bold',
                               whiteSpace: 'nowrap',
                               fontFamily: 'Inter, sans-serif'
                           }}
                       >
                           {ov.content}
                       </div>
                   )}
                   {ov.type === 'image' && (
                       <img 
                           src={ov.content} 
                           alt="overlay" 
                           style={{ width: `${ov.scale * 3}px`, maxWidth: '50vw' }} // simple scaling
                       />
                   )}
                   {ov.type === 'video' && (
                       <video 
                           id={`editor-overlay-${ov.id}`}
                           src={ov.content}
                           muted
                           loop
                           playsInline
                           style={{ width: `${ov.scale * 3}px`, maxWidth: '50vw', borderRadius: '8px' }}
                       />
                   )}
               </div>
           ))}
           
           {/* Play/Pause Area (Click anywhere else) */}
           <div 
             className="absolute inset-0 z-0" 
             onClick={() => { setSelectedOverlayId(null); handlePlayPause(); }}
           ></div>
           
           {/* Play Button Overlay */}
           <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-300 z-0 ${isPlaying ? 'opacity-0' : 'opacity-100'}`}>
             <div className="w-16 h-16 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
               <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
             </div>
           </div>

           {/* Gemini AI Overlays */}
           {geminiResult && (
             <div className="absolute bottom-10 left-4 right-4 text-center pointer-events-none z-20">
               <p className="text-xl md:text-2xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] uppercase italic animate-pulse-slow">
                 {geminiResult.keywords[0]}
               </p>
             </div>
           )}

           {isAnalyzing && (
             <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-20">
               <div className={`w-16 h-16 rounded-full border-4 ${analysisType === 'gemini' ? 'border-brand-secondary' : 'border-blue-400'} border-t-transparent animate-spin mb-4`}></div>
               <p className={`${analysisType === 'gemini' ? 'text-brand-secondary' : 'text-blue-400'} font-bold animate-pulse`}>
                 {analysisType === 'gemini' ? 'Gemini is Watching...' : 'Analyzing On-Device...'}
               </p>
             </div>
           )}
        </div>
      </div>

      {/* Bottom Control Area */}
      <div className="h-[35vh] bg-white/70 dark:bg-glass-dark border-t border-white/20 dark:border-glass-border flex flex-col backdrop-blur-2xl z-20 rounded-t-3xl relative -mt-4 transition-all">
        
        {/* Tools Strip */}
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex gap-4 overflow-x-auto no-scrollbar">
            {/* Standard Tools */}
            <button onClick={() => setShowLayers(false)} className={`flex flex-col items-center gap-1 group ${!showLayers ? 'opacity-100' : 'opacity-50'}`}>
               <div className="w-10 h-10 rounded-full bg-white dark:bg-glass-200 flex items-center justify-center group-hover:bg-gray-100 dark:group-hover:bg-white/20 transition-colors shadow-sm">
                 <svg className="w-5 h-5 text-slate-800 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0 0L12 12m3 3l3 3" /></svg>
               </div>
               <span className="text-[10px] text-slate-600 dark:text-gray-300">Timeline</span>
            </button>
            
            <button 
              onClick={handleMagicCut}
              className="flex flex-col items-center gap-1 group relative"
            >
               <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${userTier === UserTier.PRO ? 'bg-gradient-to-tr from-brand-secondary to-brand-primary shadow-[0_0_10px_rgba(236,72,153,0.5)]' : 'bg-blue-500/10 dark:bg-blue-500/20 text-blue-500 dark:text-blue-300 border border-blue-500/30 dark:border-blue-500/50'}`}>
                 {userTier === UserTier.PRO ? (
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                 ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                 )}
               </div>
               <span className="text-[10px] text-slate-700 dark:text-white font-medium">Auto Cut</span>
            </button>

            {/* Layer/Overlay Toggle */}
            <button onClick={() => setShowLayers(true)} className={`flex flex-col items-center gap-1 group ${showLayers ? 'opacity-100' : 'opacity-50'}`}>
               <div className="w-10 h-10 rounded-full bg-white dark:bg-glass-200 flex items-center justify-center group-hover:bg-gray-100 dark:group-hover:bg-white/20 transition-colors shadow-sm">
                 <svg className="w-5 h-5 text-slate-800 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
               </div>
               <span className="text-[10px] text-slate-600 dark:text-gray-300">Layers</span>
            </button>
            
            {/* Add Overlay Actions (Only show if Layers active) */}
            {showLayers && (
                <>
                   <div className="w-[1px] h-8 bg-gray-300 dark:bg-white/10 mx-2"></div>
                   <button onClick={addOverlayText} className="flex flex-col items-center gap-1 group">
                       <div className="w-10 h-10 rounded-full bg-white dark:bg-glass-200 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/20 shadow-sm">
                          <span className="font-serif font-bold text-lg text-slate-800 dark:text-white">T</span>
                       </div>
                       <span className="text-[10px] text-slate-600 dark:text-gray-300">+Text</span>
                   </button>
                   <button onClick={() => triggerFileUpload('image')} className="flex flex-col items-center gap-1 group">
                       <div className="w-10 h-10 rounded-full bg-white dark:bg-glass-200 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/20 shadow-sm">
                          <svg className="w-5 h-5 text-slate-800 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                       </div>
                       <span className="text-[10px] text-slate-600 dark:text-gray-300">+Img</span>
                   </button>
                   <button onClick={() => triggerFileUpload('video')} className="flex flex-col items-center gap-1 group">
                       <div className="w-10 h-10 rounded-full bg-white dark:bg-glass-200 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/20 shadow-sm">
                          <svg className="w-5 h-5 text-slate-800 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                       </div>
                       <span className="text-[10px] text-slate-600 dark:text-gray-300">+Vid</span>
                   </button>
                </>
            )}
          </div>
          
          <button 
            onClick={handlePlayPause}
            className="w-12 h-12 rounded-full bg-white dark:bg-white text-black flex items-center justify-center shadow-lg active:scale-95 transition-transform"
          >
            {isPlaying ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
            ) : (
              <svg className="w-5 h-5 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
        </div>

        {/* Content Area: Timeline vs Layers */}
        <div className="flex-1 bg-white/40 dark:bg-black/40 relative px-4 py-2 border-t border-white/20 dark:border-white/5 overflow-y-auto no-scrollbar">
           
           {!showLayers ? (
               <Timeline 
                 duration={duration}
                 currentTime={currentTime}
                 segments={segments}
                 onSeek={handleSeek}
               />
           ) : (
               /* LAYERS / OVERLAY EDITOR PANEL */
               <div className="flex flex-col gap-4 pb-10">
                   {overlays.length === 0 ? (
                       <div className="text-center text-slate-500 dark:text-gray-500 py-4 text-xs">No overlays. Add text, images or video.</div>
                   ) : (
                       /* Selected Overlay Editor */
                       selectedOverlayId ? (
                           (() => {
                               const ov = overlays.find(o => o.id === selectedOverlayId);
                               if (!ov) return null;
                               return (
                                   <div className="bg-white/50 dark:bg-white/5 rounded-xl p-3 border border-white/20 dark:border-white/10 space-y-3 animate-fade-in">
                                       <div className="flex justify-between items-center">
                                           <span className="text-xs font-bold text-brand-primary uppercase">Edit {ov.type}</span>
                                           <button onClick={() => removeOverlay(ov.id)} className="text-red-600 dark:text-red-400 text-xs">Delete</button>
                                       </div>
                                       
                                       {/* Content Edit (Text Only) */}
                                       {ov.type === 'text' && (
                                            <input 
                                                type="text" 
                                                value={ov.content}
                                                onChange={(e) => updateOverlay(ov.id, { content: e.target.value })}
                                                className="w-full bg-gray-50 dark:bg-black/50 border border-gray-300 dark:border-white/10 rounded px-2 py-1 text-sm text-slate-900 dark:text-white"
                                            />
                                       )}

                                       {/* Position Grid */}
                                       <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-[10px] text-slate-500 dark:text-gray-400 block mb-1">Position</label>
                                                <div className="grid grid-cols-3 gap-1 w-20">
                                                    {['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'].map((pos) => (
                                                        <button 
                                                            key={pos}
                                                            onClick={() => updateOverlay(ov.id, { position: pos as any })}
                                                            className={`w-6 h-6 rounded-[2px] ${ov.position === pos ? 'bg-brand-primary' : 'bg-gray-200 dark:bg-white/10 hover:bg-gray-300 dark:hover:bg-white/20'}`}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-slate-500 dark:text-gray-400 block mb-1">Scale: {ov.scale}</label>
                                                <input 
                                                    type="range" 
                                                    min="10" 
                                                    max="150" 
                                                    value={ov.scale} 
                                                    onChange={(e) => updateOverlay(ov.id, { scale: parseInt(e.target.value) })}
                                                    className="w-full h-1 bg-gray-300 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer accent-brand-secondary"
                                                />
                                                {ov.type === 'text' && (
                                                    <div className="flex gap-2 mt-2">
                                                        <input 
                                                            type="color" 
                                                            value={ov.style?.color || '#ffffff'}
                                                            onChange={(e) => updateOverlay(ov.id, { style: { ...ov.style, color: e.target.value } })}
                                                            className="w-6 h-6 rounded bg-transparent border-0 p-0"
                                                        />
                                                        <button 
                                                            onClick={() => updateOverlay(ov.id, { style: { ...ov.style, backgroundColor: ov.style?.backgroundColor ? '' : 'rgba(0,0,0,0.5)' } })}
                                                            className={`text-[10px] px-2 rounded border ${ov.style?.backgroundColor ? 'bg-gray-200 dark:bg-white/20 border-gray-400 dark:border-white/30 text-slate-900 dark:text-white' : 'border-gray-300 dark:border-white/10 text-gray-400 dark:text-gray-500'}`}
                                                        >BG</button>
                                                    </div>
                                                )}
                                            </div>
                                       </div>
                                       
                                       <button onClick={() => setSelectedOverlayId(null)} className="w-full py-1 text-xs text-slate-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 rounded hover:bg-gray-200 dark:hover:bg-white/10">Done</button>
                                   </div>
                               );
                           })()
                       ) : (
                           /* List of Layers */
                           <div className="space-y-2">
                               {overlays.map(ov => (
                                   <div 
                                      key={ov.id}
                                      onClick={() => setSelectedOverlayId(ov.id)}
                                      className="flex items-center gap-3 p-2 rounded-lg bg-white/40 dark:bg-white/5 hover:bg-white/60 dark:hover:bg-white/10 border border-white/20 dark:border-white/5 cursor-pointer"
                                   >
                                       <div className="w-8 h-8 rounded bg-gray-200 dark:bg-black/40 flex items-center justify-center overflow-hidden">
                                           {ov.type === 'text' && <span className="font-serif text-xs text-slate-800 dark:text-white">T</span>}
                                           {(ov.type === 'image' || ov.type === 'video') && <img src={ov.content} className="w-full h-full object-cover" />}
                                       </div>
                                       <div className="flex-1 min-w-0">
                                           <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{ov.type === 'text' ? ov.content : `${ov.type} Layer`}</div>
                                           <div className="text-[10px] text-slate-500 dark:text-gray-500 uppercase">{ov.position}</div>
                                       </div>
                                       <div className="w-2 h-2 rounded-full bg-brand-primary"></div>
                                   </div>
                               ))}
                           </div>
                       )
                   )}
               </div>
           )}
        </div>
      </div>

      {/* --- EXPORT MODAL --- */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in" onClick={() => setShowExportModal(false)}>
            <div className="w-full max-w-sm bg-white dark:bg-[#18181b] border border-white/20 dark:border-white/10 rounded-3xl p-6 shadow-2xl transform transition-transform duration-300 relative" onClick={e => e.stopPropagation()}>
                
                <button 
                  onClick={() => setShowExportModal(false)}
                  className="absolute top-4 right-4 p-2 text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>

                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">Export Settings</h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
                   Export your edited video clip
                </p>

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
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Resolution</label>
                    <div className="grid grid-cols-2 gap-2">
                        {availableResolutions.map(res => (
                            <button
                                key={res.label}
                                onClick={() => setSelectedQuality(res.label)}
                                className={`w-full py-3 px-3 rounded-xl border flex items-center justify-between transition-all ${
                                    selectedQuality === res.label 
                                        ? 'bg-brand-primary/10 dark:bg-brand-primary/20 border-brand-primary text-brand-primary dark:text-white shadow-[0_0_15px_rgba(99,102,241,0.2)]' 
                                        : 'bg-gray-50 dark:bg-white/5 border-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10'
                                }`}
                            >
                                <span className="font-bold text-sm">{res.label}</span>
                                <span className="text-[10px] opacity-60 font-mono">{res.width}x{res.height}</span>
                            </button>
                        ))}
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
                        Start Export
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* --- PROGRESS MODAL --- */}
      {exportProcessing && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-white/90 dark:bg-black/90 backdrop-blur-xl animate-fade-in">
             <div className="w-full max-w-sm p-8 flex flex-col items-center text-center">
                 <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                    {exportStatus === 'processing' ? 'Exporting...' : 'All Done!'}
                 </h3>

                 {exportStatus === 'processing' && (
                     <div className="w-full mt-6">
                         <div className="flex justify-between text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">
                             <span>Rendering</span>
                             <span className="text-brand-primary">{Math.round(exportProgress)}%</span>
                         </div>
                         <div className="h-3 w-full bg-gray-200 dark:bg-black/50 rounded-full overflow-hidden border border-black/5 dark:border-white/10 relative shadow-inner">
                             <div 
                                className="h-full bg-gradient-to-r from-brand-primary via-brand-accent to-brand-secondary transition-all duration-200 ease-out"
                                style={{ width: `${exportProgress}%` }}
                             ></div>
                         </div>
                     </div>
                 )}

                 {exportStatus === 'success' && (
                     <div className="mt-4 animate-fade-in">
                        <svg className="w-20 h-20 text-green-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                        <p className="text-slate-500 dark:text-gray-400">Your video has been saved.</p>
                     </div>
                 )}
             </div>
        </div>
      )}

    </div>
  );
};