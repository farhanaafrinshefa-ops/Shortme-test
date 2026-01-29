import React from 'react';
import { GlassCard } from './ui/GlassCard';

interface ProUpgradeProps {
  onUpgrade: () => void;
  onCancel: () => void;
}

export const ProUpgrade: React.FC<ProUpgradeProps> = ({ onUpgrade, onCancel }) => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-end sm:justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in">
      <GlassCard className="w-full max-w-md p-0 overflow-hidden border-brand-primary/50 shadow-[0_0_50px_rgba(99,102,241,0.2)]">
        
        {/* Header Graphic */}
        <div className="h-32 bg-gradient-to-br from-brand-primary via-brand-secondary to-brand-accent flex items-center justify-center relative overflow-hidden">
           <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-30 mix-blend-overlay"></div>
           <div className="absolute w-64 h-64 bg-white/20 blur-3xl rounded-full -top-32 -left-10 animate-pulse-slow"></div>
           <div className="relative z-10 text-center">
             <h2 className="text-3xl font-black text-white tracking-tight drop-shadow-md">PRO</h2>
             <p className="text-white/80 font-medium text-sm tracking-widest uppercase">Cloud Intelligence</p>
           </div>
           
           <button onClick={onCancel} className="absolute top-4 right-4 text-white/70 hover:text-white">
             <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
           </button>
        </div>

        {/* Benefits */}
        <div className="p-8 space-y-6 bg-glass-dark">
          <div className="space-y-4">
            <FeatureRow icon="✨" title="Gemini 1.5 Cloud Model" desc="Context-aware analysis that understands humor and topics." />
            <FeatureRow icon="🎯" title="Smart Scene Detection" desc="Advanced computer vision instead of basic local heuristics." />
            <FeatureRow icon="🚀" title="Viral Prediction" desc="Get accurate engagement scores based on global trends." />
            <FeatureRow icon="☁️" title="Cloud Processing" desc="Offload heavy processing to Google's servers." />
          </div>

          <div className="pt-4">
             <button 
               onClick={onUpgrade}
               className="w-full py-4 rounded-xl bg-gradient-to-r from-brand-primary to-brand-secondary text-white font-bold text-lg shadow-lg active:scale-95 transition-transform"
             >
               Unlock Gemini - $9.99/mo
             </button>
             <p className="text-center text-gray-500 text-xs mt-4">Restore Purchases • Terms of Service</p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
};

const FeatureRow = ({ icon, title, desc }: { icon: string, title: string, desc: string }) => (
  <div className="flex gap-4 items-start">
    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-xl shrink-0">
      {icon}
    </div>
    <div>
      <h3 className="text-white font-semibold text-sm">{title}</h3>
      <p className="text-gray-400 text-xs leading-relaxed">{desc}</p>
    </div>
  </div>
);