import React, { useState, useEffect } from 'react';
import { GlassCard } from './ui/GlassCard';
import { VideoProject } from '../types';

interface DashboardProps {
  projects: VideoProject[];
  onNewProject: () => void;
  onDirectEditor: () => void;
  onOpenProject: (project: VideoProject) => void;
  onViewAllProjects: () => void;
  onToggleTheme: () => void;
  theme: 'dark' | 'light';
}

const POWER_TAGLINES = [
  "Unlimited AI usage: No credits, no limits.",
  "Privacy First: AI runs locally on your device.",
  "Super fast rendering engine optimized for mobile.",
  "Cinema-grade 4K export at 60FPS.",
  "Smart face tracking keeps subjects in focus.",
  "Professional multi-track timeline editor.",
  "Instantly predict viral potential with Gemini.",
  "Auto-remove silence and boring parts.",
  "Studio quality subtitles and dynamic captions.",
  "Optimized specifically for Reels & TikTok algorithms."
];

export const Dashboard: React.FC<DashboardProps> = ({ 
  projects, 
  onNewProject, 
  onDirectEditor, 
  onOpenProject,
  onViewAllProjects,
  onToggleTheme,
  theme
}) => {
  const [taglineIndex, setTaglineIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setTaglineIndex((prev) => (prev + 1) % POWER_TAGLINES.length);
        setFade(true);
      }, 500); // Wait for fade out
    }, 4000); // Change every 4 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-6 pb-32 space-y-8 animate-fade-in">
      
      {/* Header Area */}
      <div className="flex justify-between items-center pt-2">
        <div className="flex items-center gap-3">
          {/* Logo Icon */}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center shadow-lg shadow-brand-primary/20">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-brand-primary to-brand-secondary dark:from-white dark:to-gray-300">
            ShortMe
          </h1>
        </div>
        
        <div className="flex items-center gap-3">
            {/* Theme Toggle Button */}
            <button 
                onClick={onToggleTheme}
                className="p-2.5 rounded-full bg-glass-200 backdrop-blur-md border border-glass-border shadow-sm transition-transform hover:scale-105 active:scale-95"
                title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            >
                {theme === 'dark' ? (
                    <svg className="w-5 h-5 text-yellow-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                ) : (
                    <svg className="w-5 h-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
                )}
            </button>

            {/* Avatar */}
            <div className="h-11 w-11 rounded-full bg-gradient-to-tr from-brand-secondary to-brand-primary p-[2px] shadow-lg">
                <img 
                    src="https://picsum.photos/100/100" 
                    alt="Profile" 
                    className="rounded-full w-full h-full object-cover border-2 border-white dark:border-[#0f0f12]"
                />
            </div>
        </div>
      </div>

      {/* Main Action Cards (Side by Side) - Height Reduced to h-52 */}
      <div className="grid grid-cols-2 gap-4">
          
          {/* Card 1: Viral Shorts (Input -> Engine -> Output Flow) */}
          <GlassCard 
            onClick={onNewProject}
            hoverEffect={true}
            className="relative overflow-hidden group h-52 border-0 shadow-2xl p-0 ring-1 ring-white/10"
          >
             {/* Deep Space Background */}
             <div className="absolute inset-0 bg-[#0c0a24]"></div>
             
             {/* Animation Stage */}
             <div className="absolute inset-0 flex items-center justify-center">
                
                {/* 1. INPUT: Long Video Feeding In (Left) */}
                <div className="absolute left-0 flex items-center animate-feed-in z-10 opacity-0">
                    <div className="w-16 h-9 rounded-md bg-gradient-to-br from-blue-400 to-indigo-600 border border-white/40 shadow-[0_0_15px_rgba(99,102,241,0.5)] flex items-center justify-center">
                        <svg className="w-4 h-4 text-white opacity-80" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                </div>

                {/* 2. ENGINE: The Central Brain (Always pulsating) */}
                <div className="relative z-20 w-16 h-16 flex items-center justify-center">
                    <div className="absolute inset-0 bg-indigo-500/30 rounded-full blur-xl animate-pulse-slow"></div>
                    <div className="relative w-10 h-10 bg-gradient-to-tr from-brand-secondary to-brand-primary rounded-xl rotate-45 border-2 border-white/20 shadow-inner flex items-center justify-center overflow-hidden">
                        <div className="absolute inset-0 bg-white/20 animate-spin-slow"></div>
                        <svg className="w-5 h-5 text-white transform -rotate-45 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    </div>
                    {/* Ring Radar */}
                    <div className="absolute inset-0 border border-indigo-400/30 rounded-full animate-[ping_2s_linear_infinite]"></div>
                </div>

                {/* 3. OUTPUT: Portrait Videos Ejecting (Right) */}
                <div className="absolute z-10">
                    <div className="w-8 h-14 bg-gradient-to-br from-pink-500 to-purple-600 rounded-sm border border-white/40 shadow-lg absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-eject-out-1 opacity-0"></div>
                    <div className="w-8 h-14 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-sm border border-white/40 shadow-lg absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-eject-out-2 opacity-0"></div>
                    <div className="w-8 h-14 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-sm border border-white/40 shadow-lg absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-eject-out-3 opacity-0"></div>
                </div>

             </div>

             {/* Content Overlay */}
             <div className="relative z-30 h-full flex flex-col justify-end p-4 bg-gradient-to-t from-black/90 via-black/20 to-transparent">
                 <div className="mb-auto pt-2">
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/30 border border-indigo-400/30 text-[9px] font-mono text-indigo-200 backdrop-blur-md">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                        AI ENGINE
                    </div>
                 </div>
                 
                 <div>
                    <h2 className="text-xl md:text-2xl font-black text-white leading-[0.9] tracking-tight mb-1">
                        VIRAL<br/>SHORTS
                    </h2>
                    <p className="text-indigo-200/70 text-[10px] font-medium tracking-wide">
                        Long Video <span className="text-white">→</span> Portrait
                    </p>
                 </div>
             </div>
          </GlassCard>

          {/* Card 2: Video Editor (Timeline -> Cut -> Save Flow) */}
          <GlassCard 
            onClick={onDirectEditor}
            hoverEffect={true}
            className="relative overflow-hidden group h-52 border-0 shadow-2xl p-0 ring-1 ring-white/10"
          >
             {/* Dark Editor Background */}
             <div className="absolute inset-0 bg-[#111827]"></div>

             {/* Animation Stage: Timeline Interaction */}
             <div className="absolute inset-0 flex flex-col justify-center px-4 py-8">
                
                {/* Timeline Track */}
                <div className="relative h-12 w-full bg-gray-800/50 rounded-lg overflow-hidden border border-white/5 flex items-center">
                    {/* The Clip */}
                    <div className="absolute left-0 top-1 bottom-1 w-[80%] bg-blue-600/60 rounded border-l-2 border-r-2 border-blue-400/50 flex items-center justify-center overflow-hidden">
                        {/* Waveform Visualization */}
                        <div className="flex items-center gap-0.5 h-full opacity-50">
                             {[...Array(15)].map((_, i) => (
                                 <div key={i} className="w-1 bg-white rounded-full" style={{ height: `${30 + Math.random() * 60}%` }}></div>
                             ))}
                        </div>
                    </div>

                    {/* The "To Be Trimmed" Part - Shrinking */}
                    <div className="absolute left-[50%] top-1 bottom-1 bg-red-500/40 border-r-2 border-red-400/50 animate-clip-shrink backdrop-grayscale"></div>

                    {/* The Playhead (Cursor) Moving */}
                    <div className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_white] z-20 animate-playhead-move">
                        <div className="absolute top-0 -left-1.5 w-3 h-3 bg-brand-secondary transform rotate-45 border border-white"></div>
                    </div>

                    {/* Scissor Action Popup */}
                    <div className="absolute left-[50%] top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 animate-scissor-cut opacity-0">
                         <div className="w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center text-brand-dark">
                             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                         </div>
                    </div>
                </div>

                {/* Save Confirmation Badge */}
                <div className="absolute top-4 right-4 animate-save-badge opacity-0">
                    <div className="bg-green-500 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-lg flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                        SAVED
                    </div>
                </div>

             </div>

             {/* Content Overlay */}
             <div className="relative z-30 h-full flex flex-col justify-end p-4">
                 <div className="mb-auto pt-2">
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700/50 border border-gray-600/30 text-[9px] font-mono text-gray-300 backdrop-blur-md">
                        MANUAL EDIT
                    </div>
                 </div>
                 
                 <div>
                    <h2 className="text-xl md:text-2xl font-black text-white leading-[0.9] tracking-tight mb-1">
                        VIDEO<br/>EDITOR
                    </h2>
                    <p className="text-gray-400 text-[10px] font-medium tracking-wide">
                        Trim • Cut • Save
                    </p>
                 </div>
             </div>
          </GlassCard>
      </div>

      {/* Rotating Power Taglines (Center) */}
      <div className="text-center py-2 h-16 flex items-center justify-center">
          <p 
            className={`text-sm md:text-base font-medium text-transparent bg-clip-text bg-gradient-to-r from-slate-600 to-slate-900 dark:from-gray-400 dark:to-white transition-opacity duration-500 ${fade ? 'opacity-100' : 'opacity-0'}`}
          >
            {POWER_TAGLINES[taglineIndex]}
          </p>
      </div>

      {/* Recent Projects (3 Cards Side by Side) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white/90">Recent Projects</h3>
            <button onClick={onViewAllProjects} className="text-xs font-semibold text-brand-primary hover:text-brand-secondary transition-colors">
                View All
            </button>
        </div>
        
        {projects.length === 0 ? (
          <div className="p-8 border border-dashed border-slate-300 dark:border-white/10 rounded-2xl text-center text-slate-400 dark:text-gray-500 bg-white/20 dark:bg-white/5">
              <p className="text-sm">No projects yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {projects.slice(0, 3).map(project => (
              <GlassCard 
                key={project.id} 
                onClick={() => onOpenProject(project)}
                hoverEffect={true}
                className="p-0 overflow-hidden relative aspect-[9/16] rounded-xl group border-0 shadow-md"
              >
                <img src={project.thumbnailUrl} alt="Project" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                
                {/* Minimal Overlay Status */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-2">
                    <span className="text-[9px] text-white font-medium bg-black/50 px-2 py-0.5 rounded-full backdrop-blur-sm">
                        Edit
                    </span>
                </div>
                
                {/* Status Dot */}
                <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${project.status === 'exported' ? 'bg-green-400' : 'bg-yellow-400'} shadow-sm`}></div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>

      {/* Power Showcase Section */}
      <div className="space-y-4">
          <h3 className="text-lg font-bold text-slate-800 dark:text-white/90">Why ShortMe?</h3>
          
          <div className="grid grid-cols-3 gap-3">
              <ShowcaseItem 
                icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />}
                title="AI Magic"
                desc="Smart Cuts"
                color="text-yellow-500"
                bg="bg-yellow-500/10"
              />
              <ShowcaseItem 
                icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />}
                title="Cloud Power"
                desc="Fast Processing"
                color="text-blue-500"
                bg="bg-blue-500/10"
              />
              <ShowcaseItem 
                icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />}
                title="Auto Reframe"
                desc="Face Tracking"
                color="text-green-500"
                bg="bg-green-500/10"
              />
          </div>

          <GlassCard className="p-4 flex items-center gap-4 bg-gradient-to-r from-purple-500/10 to-indigo-500/10 border-indigo-500/20">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0 shadow-lg">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
              <div>
                  <h4 className="font-bold text-slate-800 dark:text-white text-sm">Best for Creators</h4>
                  <p className="text-xs text-slate-600 dark:text-gray-300 mt-1">
                      Designed to maximize engagement on Shorts, Reels, and TikTok with professional tools.
                  </p>
              </div>
          </GlassCard>
      </div>

      {/* Clean Developer Footer - Removed "unwanted overlay" background/border */}
      <div className="pt-8 pb-4 text-center">
          <p className="text-[10px] font-medium text-slate-400 dark:text-gray-600">
              Developed by Rifad Ahmed Adol with ❤️
          </p>
      </div>

    </div>
  );
};

const ShowcaseItem = ({ icon, title, desc, color, bg }: { icon: any, title: string, desc: string, color: string, bg: string }) => (
    <div className={`rounded-xl p-3 flex flex-col items-center text-center gap-2 ${bg} border border-white/5`}>
        <div className={`w-8 h-8 ${color}`}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">{icon}</svg>
        </div>
        <div>
            <div className={`text-xs font-bold ${color}`}>{title}</div>
            <div className="text-[10px] text-slate-500 dark:text-gray-400">{desc}</div>
        </div>
    </div>
);