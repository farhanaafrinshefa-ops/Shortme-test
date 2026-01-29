import React from 'react';
import { GlassCard } from './ui/GlassCard';
import { VideoProject } from '../types';

interface ProjectLibraryProps {
  projects: VideoProject[];
  onOpenProject: (project: VideoProject) => void;
  onBack: () => void;
}

export const ProjectLibrary: React.FC<ProjectLibraryProps> = ({ projects, onOpenProject, onBack }) => {
  return (
    <div className="p-6 pb-24 space-y-6 animate-fade-in min-h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button 
            onClick={onBack}
            className="p-2 rounded-full bg-white/60 dark:bg-glass-200 hover:bg-white/80 dark:hover:bg-glass-300 transition-colors backdrop-blur-md shadow-sm"
        >
            <svg className="w-5 h-5 text-slate-800 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Project Library</h2>
      </div>

      {projects.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400 dark:text-gray-500 py-20">
              <div className="w-20 h-20 rounded-full bg-slate-200 dark:bg-white/5 flex items-center justify-center mb-4">
                  <svg className="w-10 h-10 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" /></svg>
              </div>
              <p>No projects found.</p>
          </div>
      ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projects.map(project => (
              <GlassCard 
                key={project.id} 
                onClick={() => onOpenProject(project)}
                hoverEffect={true}
                className="flex flex-row items-center p-3 gap-4 group"
              >
                <div className="w-24 h-28 rounded-lg overflow-hidden bg-slate-200 dark:bg-black/40 relative flex-shrink-0 group-hover:scale-105 transition-transform duration-300">
                  <img src={project.thumbnailUrl} alt={project.name} className="w-full h-full object-cover opacity-90 dark:opacity-80" />
                  <div className="absolute bottom-1 right-1 bg-black/60 px-1 rounded text-[10px] font-mono text-white">
                    {project.aspectRatio}
                  </div>
                </div>
                <div className="flex-1 min-w-0 py-1">
                  <h4 className="text-slate-900 dark:text-white font-bold truncate text-base">{project.name}</h4>
                  <p className="text-slate-500 dark:text-gray-400 text-xs mt-1">Edited {project.lastModified.toLocaleDateString()}</p>
                  <p className="text-slate-400 dark:text-gray-500 text-[10px] mt-0.5">{Math.round(project.duration)}s • {project.generatedClips?.length || 0} Clips</p>
                  
                  <div className="flex items-center gap-2 mt-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                      project.status === 'exported' 
                      ? 'bg-green-500/10 text-green-600 dark:text-green-300 border-green-500/20' 
                      : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-300 border-yellow-500/20'
                    }`}>
                      {project.status === 'exported' ? 'Completed' : 'Draft'}
                    </span>
                  </div>
                </div>
                <div className="px-2 self-center">
                   <div className="w-8 h-8 rounded-full bg-white/50 dark:bg-white/10 flex items-center justify-center group-hover:bg-brand-primary group-hover:text-white transition-colors text-slate-400 dark:text-gray-500">
                       <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                   </div>
                </div>
              </GlassCard>
            ))}
          </div>
      )}
    </div>
  );
};