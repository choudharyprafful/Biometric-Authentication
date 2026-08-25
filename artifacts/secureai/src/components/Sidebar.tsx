import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '../contexts/AuthContext';
import { useLogoutUser, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Shield, LayoutDashboard, Users, Activity, AlertTriangle, CreditCard, Lock, ShieldCheck, Settings, LogOut, Menu, X } from 'lucide-react';
import { cn } from '../lib/utils';

// `roles` restricts a nav item to specific roles; omitted means everyone.
// "Users" (account management) is admin and it_support — it_support gets
// the same page but the delete/role-change controls stay admin-only inside
// it (see pages/Users.tsx). "Audit Logs" is security_analyst-only,
// deliberately NOT admin too — separation of duties: the role with
// account-management authority shouldn't also control visibility into the
// audit trail of its own actions. Admin/security_analyst are disjoint on
// purpose; it_support is not — it's a narrower slice of admin, not a peer.
const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/users', label: 'Users', icon: Users, roles: ['admin', 'it_support'] },
  { href: '/security-logs', label: 'Audit Logs', icon: Activity, roles: ['security_analyst'] },
  { href: '/threats', label: 'Threat Intel', icon: AlertTriangle },
  { href: '/payments', label: 'Payments', icon: CreditCard },
  { href: '/uploads', label: 'Data Vault', icon: Lock },
  { href: '/data-protection', label: 'Data Protection', icon: ShieldCheck },
  { href: '/enroll', label: 'Security Settings', icon: Settings },
];

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const logout = useLogoutUser();
  // Below the md breakpoint the sidebar is an off-canvas drawer (there's no
  // room for a permanent 256px rail on a phone); at md+ it's always visible,
  // same as before. This state only matters below md — see the `md:` classes
  // below that make it irrelevant on desktop.
  const [isOpen, setIsOpen] = useState(false);

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
    <>
      {/* Mobile-only top bar — the sidebar itself is off-canvas below md, so
          this is the only way to reach navigation on a phone. */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-sidebar border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <span className="font-mono font-bold tracking-widest text-foreground uppercase text-sm">SecureAI</span>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open navigation"
          className="p-2 text-muted-foreground hover:text-foreground"
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Backdrop — closes the drawer on tap, only rendered while open. */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={cn(
          'w-64 border-r border-border bg-sidebar flex flex-col h-screen fixed top-0 left-0 z-50 transition-transform duration-200 md:translate-x-0 md:z-40',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="p-6 border-b border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-primary/20 p-2 rounded-sm border border-primary/50">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="font-mono font-bold tracking-widest text-foreground uppercase">SecureAI</h1>
              <p className="text-[10px] font-mono text-primary/70 uppercase tracking-widest">Platform v1.0.0</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Close navigation"
            className="md:hidden p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            if (item.roles && !item.roles.includes(user.role)) return null;
            const isActive = location === item.href || location.startsWith(item.href + '/');

            return (
              <Link key={item.href} href={item.href} className="block" onClick={() => setIsOpen(false)}>
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
    </>
  );
}
