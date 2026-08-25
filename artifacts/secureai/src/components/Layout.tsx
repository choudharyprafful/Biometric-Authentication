import React from 'react';
import { Sidebar } from './Sidebar';
import { useAuth } from '../contexts/AuthContext';
import { Loader2 } from 'lucide-react';

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
        <p className="text-primary font-mono text-xs uppercase tracking-widest">Establishing secure connection...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <Sidebar />
      <main className={`flex-1 min-w-0 transition-all duration-300 ${user ? 'md:ml-64' : ''}`}>
        <div className={`p-4 md:p-8 max-w-7xl mx-auto h-full ${user ? 'pt-20 md:pt-8' : ''}`}>
          {children}
        </div>
      </main>
      
      {/* Cinematic noise overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-50 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay"></div>
    </div>
  );
}
