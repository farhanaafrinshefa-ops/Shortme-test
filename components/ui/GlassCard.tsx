import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hoverEffect?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({ 
  children, 
  className = '', 
  onClick,
  hoverEffect = false
}) => {
  return (
    <div 
      onClick={onClick}
      className={`
        relative overflow-hidden
        bg-white/60 dark:bg-glass-100 backdrop-blur-xl 
        border border-white/40 dark:border-glass-border 
        rounded-2xl shadow-lg
        transition-all duration-300
        ${hoverEffect ? 'hover:bg-white/80 dark:hover:bg-glass-200 hover:scale-[1.02] active:scale-95 cursor-pointer' : ''}
        ${className}
      `}
    >
      {/* Glossy gradient overlay - Adaptive opacity */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-50 pointer-events-none" />
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
};