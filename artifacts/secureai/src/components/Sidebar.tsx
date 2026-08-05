import React from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '../contexts/AuthContext';
import { useLogoutUser, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Shield, LayoutDashboard, Users, Activity, AlertTriangle, CreditCard, LogOut, Settings } from 'lucide-react';
import { cn } from '../lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/users', label: 'Users', icon: Users, adminOnly: true },
  { href: '/security-logs', label: 'Audit Logs', icon: Activity },
  { href: '/threats', label: 'Threat Intel', icon: AlertTriangle },
  { href: '/payments', label: 'Payments', icon: CreditCard },
  { href: '/account', label: 'Account Security', icon: Settings },
];

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const logout = useLogoutUser();

  if (!user) return null;

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
    } finally {
      // Clear the cached identity immediately so protected screens unmount
      // even if the session check is delayed by a network cache.
      queryClient.setQueryData(getGetCurrentUserQueryKey(), null);
      queryClient.removeQueries({ queryKey: getGetCurrentUserQueryKey() });
      setLocation('/');
    }
  };

  return (
    <div className="w-64 border-r border-border bg-sidebar flex flex-col h-screen fixed top-0 left-0 z-40">
      <div className="p-6 border-b border-border flex items-center gap-3">
        <div className="bg-primary/20 p-2 rounded-sm border border-primary/50">
          <Shield className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="font-mono font-bold tracking-widest text-foreground uppercase">SecureAI</h1>
          <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest">Platform v1.0.0</p>
        </div>
      </div>
      
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {navItems.map((item) => {
          if (item.adminOnly && user.role !== 'admin') return null;
          const isActive = location === item.href || location.startsWith(item.href + '/');
          
          return (
            <Link key={item.href} href={item.href} className="block">
              <div className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-sm font-mono text-sm tracking-wide transition-all group",
                isActive 
                  ? "bg-primary/10 text-primary border border-primary/30" 
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent"
              )}>
                <item.icon className={cn("w-5 h-5", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                {item.label}
              </div>
            </Link>
          );
        })}
      </nav>
      
      <div className="p-4 border-t border-border bg-sidebar-accent/30">
        <div className="flex items-center justify-between mb-4">
          <div className="overflow-hidden">
            <p className="font-mono text-sm text-foreground truncate">{user.name}</p>
            <p className="font-mono text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
          <div className={cn("w-2 h-2 rounded-full", user.faceEnrolled ? "bg-primary shadow-[0_0_8px_rgba(0,255,255,0.8)]" : "bg-muted-foreground")} />
        </div>
        <button
          onClick={handleLogout}
          disabled={logout.isPending}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all font-mono text-xs uppercase tracking-wider"
        >
          <LogOut className="w-4 h-4" />
          {logout.isPending ? 'Logging out...' : 'Terminate Session'}
        </button>
      </div>
    </div>
  );
}
