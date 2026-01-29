import React, { useState, useRef, useEffect } from 'react';
import { Dashboard } from './components/Dashboard';
import { Editor } from './components/views/Editor';
import { ProUpgrade } from './components/ProUpgrade';
import { ClipConfig } from './components/ClipConfig';
import { ClipGallery } from './components/ClipGallery';
import { ProjectLibrary } from './components/ProjectLibrary';
import { AppView, UserTier, VideoProject, GeneratedClip, OverlayConfig } from './types';
import { ReframeKeyframe } from './services/reframeService';

// Mock Data
const MOCK_PROJECTS: VideoProject[] = [
  { 
    id: '1', 
    name: 'Demo: Tokyo Trip.mp4', 
    thumbnailUrl: 'https://picsum.photos/300/500?random=1', 
    videoUrl: '', // Mock doesn't play
    duration: 124, 
    lastModified: new Date(), 
    status: 'draft', 
    aspectRatio: '9:16' 
  },
  { 
    id: '2', 
    name: 'Skate Park Vlog', 
    thumbnailUrl: 'https://picsum.photos/300/500?random=2', 
    videoUrl: '', 
    duration: 45, 
    lastModified: new Date(Date.now() - 86400000), 
    status: 'exported', 
    aspectRatio: '9:16' 
  },
  { 
    id: '3', 
    name: 'Product Review', 
    thumbnailUrl: 'https://picsum.photos/300/500?random=3', 
    videoUrl: '', 
    duration: 180, 
    lastModified: new Date(Date.now() - 172800000), 
    status: 'draft', 
    aspectRatio: '9:16' 
  }
];

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>(AppView.DASHBOARD);
  const [userTier, setUserTier] = useState<UserTier>(UserTier.FREE);
  const [projects, setProjects] = useState<VideoProject[]>(MOCK_PROJECTS);
  
  // Theme State
  const [theme, setTheme] = useState<'dark' | 'light'>('light');

  // Active state
  const [activeProject, setActiveProject] = useState<VideoProject | null>(null);
  const [activeClip, setActiveClip] = useState<GeneratedClip | undefined>(undefined);
  
  // Upload Mode State: 'viral' goes to Config, 'editor' goes to Editor directly
  const [uploadMode, setUploadMode] = useState<'viral' | 'editor'>('viral');

  // Hidden file input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize Theme
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
        root.classList.add('dark');
    } else {
        root.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
      setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // 1. Dashboard -> Open existing project
  const handleOpenProject = (project: VideoProject) => {
    setActiveProject(project);
    setActiveClip(undefined);
    setCurrentView(AppView.EDITOR);
  };

  // 2. Dashboard -> New Project Actions
  const handleNewProjectClick = () => {
    setUploadMode('viral');
    fileInputRef.current?.click();
  };

  const handleDirectEditorClick = () => {
    setUploadMode('editor');
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const videoUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = videoUrl;

    video.onloadedmetadata = () => {
      const newProject: VideoProject = {
        id: Date.now().toString(),
        name: file.name,
        thumbnailUrl: 'https://picsum.photos/300/500?random=' + Date.now(),
        videoUrl: videoUrl,
        duration: video.duration,
        lastModified: new Date(),
        status: 'draft',
        aspectRatio: video.videoWidth < video.videoHeight ? '9:16' : '16:9'
      };
      
      setProjects([newProject, ...projects]);
      setActiveProject(newProject);
      
      // Determine flow based on upload mode
      if (uploadMode === 'viral') {
          setCurrentView(AppView.CLIP_CONFIG);
      } else {
          // Direct Editor: Needs a dummy clip or just load full video
          // We'll pass the project to Editor, Editor handles full video logic if no clip
          setCurrentView(AppView.EDITOR);
      }
    };
    
    event.target.value = '';
  };

  // 3. Config -> Generate Clips -> Gallery
  const handleClipsGenerated = (clips: GeneratedClip[], aspectRatio: '9:16' | '16:9' | '1:1', reframeData?: ReframeKeyframe[], overlays?: OverlayConfig[]) => {
    if (activeProject) {
        const enrichedClips = clips.map(clip => ({
            ...clip,
            reframeKeyframes: reframeData, 
            overlays: overlays
        }));

        const updatedProject = { ...activeProject, aspectRatio, generatedClips: enrichedClips };
        setActiveProject(updatedProject);
        setProjects(projects.map(p => p.id === updatedProject.id ? updatedProject : p));
        setCurrentView(AppView.CLIP_GALLERY);
    }
  };

  // 4. Gallery -> Edit Specific Clip
  const handleEditClip = (clip: GeneratedClip) => {
    setActiveClip(clip);
    setCurrentView(AppView.EDITOR);
  };

  const handleUpgrade = () => {
    setUserTier(UserTier.PRO);
    if (activeProject) {
        if (activeClip) setCurrentView(AppView.EDITOR);
        else if (currentView === AppView.CLIP_GALLERY) setCurrentView(AppView.CLIP_GALLERY);
        else setCurrentView(AppView.EDITOR);
    } else {
        setCurrentView(AppView.DASHBOARD);
    }
  };

  return (
    <div className={`min-h-screen font-sans transition-colors duration-500 ${theme === 'dark' ? 'bg-[#0f0f12] text-white' : 'bg-[#f8fafc] text-slate-900'}`}>
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept="video/*" 
        className="hidden" 
      />

      {/* --- DYNAMIC ANIMATED BACKGROUND --- */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
         {theme === 'dark' ? (
             /* Dark Mode Mesh Gradient */
             <>
                <div className="absolute -top-[20%] -left-[10%] w-[70%] h-[70%] bg-indigo-900/40 rounded-full blur-[120px] animate-blob"></div>
                <div className="absolute top-[20%] -right-[10%] w-[60%] h-[60%] bg-purple-900/30 rounded-full blur-[120px] animate-blob animation-delay-2000"></div>
                <div className="absolute -bottom-[20%] left-[20%] w-[70%] h-[70%] bg-blue-900/30 rounded-full blur-[120px] animate-blob animation-delay-4000"></div>
                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-20 mix-blend-overlay"></div>
             </>
         ) : (
             /* Light Mode Mesh Gradient - CLEANED UP */
             <>
                {/* Base Gradient - Ensures screen is bright */}
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/80 via-white to-purple-50/80"></div>
                
                {/* Soft Pastels (Reduced Opacity, No Multiply) */}
                <div className="absolute -top-[20%] -left-[10%] w-[70%] h-[70%] bg-blue-200/30 rounded-full blur-[120px] animate-blob"></div>
                <div className="absolute top-[20%] -right-[10%] w-[60%] h-[60%] bg-purple-200/30 rounded-full blur-[120px] animate-blob animation-delay-2000"></div>
                <div className="absolute -bottom-[20%] left-[20%] w-[70%] h-[70%] bg-pink-200/30 rounded-full blur-[120px] animate-blob animation-delay-4000"></div>
             </>
         )}
      </div>

      <div className="relative z-10 h-screen flex flex-col">
        
        {currentView === AppView.DASHBOARD && (
          <Dashboard 
            projects={projects}
            onNewProject={handleNewProjectClick}
            onDirectEditor={handleDirectEditorClick}
            onOpenProject={handleOpenProject}
            onViewAllProjects={() => setCurrentView(AppView.PROJECT_LIBRARY)}
            onToggleTheme={toggleTheme}
            theme={theme}
          />
        )}

        {currentView === AppView.PROJECT_LIBRARY && (
            <ProjectLibrary 
                projects={projects}
                onOpenProject={handleOpenProject}
                onBack={() => setCurrentView(AppView.DASHBOARD)}
            />
        )}

        {currentView === AppView.CLIP_CONFIG && activeProject && (
          <ClipConfig 
            project={activeProject}
            onGenerate={handleClipsGenerated}
            onBack={() => setCurrentView(AppView.DASHBOARD)}
          />
        )}

        {currentView === AppView.CLIP_GALLERY && activeProject && (
          <ClipGallery 
            project={activeProject}
            clips={activeProject.generatedClips || []}
            onEdit={handleEditClip}
            onBack={() => setCurrentView(AppView.CLIP_CONFIG)}
            onUpdateClips={(updatedClips) => {
                const updatedProject = { ...activeProject, generatedClips: updatedClips };
                setActiveProject(updatedProject);
                setProjects(projects.map(p => p.id === updatedProject.id ? updatedProject : p));
            }}
          />
        )}

        {currentView === AppView.EDITOR && activeProject && (
          <Editor 
            project={activeProject}
            initialClip={activeClip}
            userTier={userTier}
            onBack={() => {
                // If we have an active clip, go back to gallery
                if (activeClip) setCurrentView(AppView.CLIP_GALLERY);
                // If we came from direct editor (no clip), go back to Dashboard
                else setCurrentView(AppView.DASHBOARD);
            }}
            onUpgrade={() => setCurrentView(AppView.PRO_UPGRADE)}
          />
        )}

        {currentView === AppView.PRO_UPGRADE && (
          <ProUpgrade 
            onUpgrade={handleUpgrade}
            onCancel={() => {
                 if (activeProject) setCurrentView(AppView.EDITOR);
                 else setCurrentView(AppView.DASHBOARD);
            }}
          />
        )}

        {/* Bottom Navigation (Only visible on Dashboard) */}
        {currentView === AppView.DASHBOARD && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white/80 dark:bg-glass-200/90 backdrop-blur-2xl border border-black/5 dark:border-white/10 rounded-full px-6 py-3 flex items-center gap-8 shadow-2xl z-40">
             <NavIcon icon="home" active />
             <NavIcon icon="search" />
             <div className="w-10 h-10 bg-brand-primary rounded-full flex items-center justify-center -mt-8 border-4 border-[#f8fafc] dark:border-[#0f0f12] shadow-lg shadow-brand-primary/40 cursor-pointer" onClick={handleNewProjectClick}>
               <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
             </div>
             <NavIcon icon="folder" onClick={() => setCurrentView(AppView.PROJECT_LIBRARY)} />
             <NavIcon icon="user" />
          </div>
        )}
      </div>
    </div>
  );
};

const NavIcon = ({ icon, active, onClick }: { icon: string, active?: boolean, onClick?: () => void }) => {
  const icons: Record<string, React.ReactElement> = {
    home: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
    search: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />,
    folder: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />,
    user: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  };

  return (
    <div onClick={onClick} className={`p-1 cursor-pointer transition-colors ${active ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300'}`}>
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {icons[icon]}
      </svg>
    </div>
  );
};

export default App;