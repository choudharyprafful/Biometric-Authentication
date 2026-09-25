import React, { useState } from 'react';
import { useGetSecurityDashboard, useGetSuggestedAction } from '@workspace/api-client-react';
import { Card, Badge, Button } from '../components/ui';
import { AiLabel } from '../components/AiLabel';
import { readSecurityNotice, clearSecurityNotice } from '../lib/securityNotice';
import { Users, Fingerprint, Activity, AlertTriangle, Loader2, Shield, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { useLocation } from 'wouter';
import { useAuth } from '../contexts/AuthContext';

// Live behavior model's own widget — see api-server/src/lib/behaviorModel.ts.
// Degrades quietly (no error banner) on 403/429/no-data: this is a nice-to-have
// hint, not something worth interrupting the dashboard over if MFA/parent-consent
// gating blocks it or the model has too little consented data yet.
// The sign-in risk check's warning, carried over from the password step (lib/securityNotice.ts). Shown once
// per sign-in, labelled as automated, with a way to challenge it (Team 2: transparency, contestability).
function SecurityNoticeBanner() {
  const [notice, setNotice] = useState<string | null>(() => readSecurityNotice());
  if (!notice) return null;
  const dismiss = () => {
    clearSecurityNotice();
    setNotice(null);
  };
  return (
    <div role="alert" className="border border-yellow-500/40 bg-yellow-500/5 p-4 space-y-2 [overflow-wrap:anywhere]" data-testid="security-notice">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
          <p className="font-mono text-xs uppercase tracking-widest text-yellow-400">Unusual sign-in</p>
          <AiLabel system="login-risk" text="Automated check" />
        </div>
        <Button variant="ghost" size="sm" onClick={dismiss} data-testid="button-dismiss-notice">Dismiss</Button>
      </div>
      <p className="text-sm text-foreground">{notice}</p>
      <a href="/ai?challenge=login-risk#challenge" className="text-xs text-primary underline underline-offset-2">This was me: challenge the check</a>
    </div>
  );
}

function SuggestedActionCard() {
  const { data, isLoading, error } = useGetSuggestedAction();

  return (
    <Card className="bg-primary/5 border-primary/20 p-6 space-y-3">
      <div className="flex items-center gap-3">
        <Sparkles className="w-5 h-5 text-primary" />
        <h3 className="font-mono text-sm uppercase tracking-widest text-foreground">Suggested Next Action</h3>
        <AiLabel system="behaviour-suggestions" text="AI suggestion" />
      </div>
      {isLoading ? (
        <p className="font-mono text-xs text-muted-foreground">Loading…</p>
      ) : data?.disabled ? (
        <p className="font-mono text-xs text-muted-foreground">AI suggestions are switched off by an administrator.</p>
      ) : error || !data?.suggestion ? (
        <p className="font-mono text-xs text-muted-foreground">
          Not enough shared, opted-in activity yet to suggest anything — this needs a pattern
          independently seen from 3 or more consenting operators before it will surface.
        </p>
      ) : (
        <>
          <p className="font-mono text-lg text-primary uppercase tracking-wider">{data.suggestion.replace(/_/g, ' ')}</p>
          <p className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-wider">
            Seen from {data.distinctUsersSupporting} operators with similar activity · model built from {data.modelTrainedFromUsers} consenting accounts
            {data.contextDepth != null && ` · based on your last ${data.contextDepth === 2 ? '2 actions' : 'action'}`}
          </p>
        </>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const { data: dashboard, isLoading, error } = useGetSecurityDashboard();
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="p-6 bg-destructive/10 text-destructive border border-destructive/30 font-mono">
        Failed to load telemetry.
      </div>
    );
  }

  const isAdmin = user?.role === 'admin';
  const canManageUsers = isAdmin || user?.role === 'it_support';
  // Admin is a superset role — it has every other role's rights, including
  // audit-log visibility (see security.ts's canSeeAuditLogs).
  const canMonitor = user?.role === 'security_analyst' || isAdmin;
  const operatorsCardHref = canManageUsers ? '/users' : canMonitor ? '/security-logs' : '/dashboard';
  const operatorsCardAction = canManageUsers ? 'Open user registry' : canMonitor ? 'View audit trail' : 'Aggregate count only';
  const statCards = [
    {
      label: 'Active Operators',
      value: dashboard.totalUsers,
      icon: Users,
      color: 'text-blue-400',
      href: operatorsCardHref,
      action: operatorsCardAction,
    },
    {
      label: 'Biometric Enrolled',
      value: dashboard.faceEnrolledUsers,
      icon: Fingerprint,
      color: 'text-primary',
      href: '/enroll',
      action: user?.faceEnrolled ? 'Review biometric status' : 'Enroll your face',
    },
    {
      label: 'Failed Access (24h)',
      value: dashboard.failedLogins24h,
      icon: Activity,
      color: dashboard.failedLogins24h > 10 ? 'text-destructive' : 'text-yellow-400',
      href: canMonitor ? '/security-logs' : '/dashboard',
      action: canMonitor ? 'Review access events' : 'Aggregate count only',
    },
    {
      label: 'Active Threats',
      value: dashboard.threatsDetected,
      icon: AlertTriangle,
      color: dashboard.threatsDetected > 0 ? 'text-destructive' : 'text-green-400',
      href: '/threats',
      action: 'Open threat intelligence',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground">Command Center</h1>
          <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-1">Real-time system telemetry</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
          <span className="font-mono text-xs text-green-500 uppercase tracking-widest">System Nominal</span>
        </div>
      </div>

      <SecurityNoticeBanner />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <button
            key={stat.label}
            type="button"
            onClick={() => setLocation(stat.href)}
            className="group text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={`${stat.action}: ${stat.label}`}
          >
          <Card className="relative h-full overflow-hidden border-t-2 transition-all duration-200 group-hover:-translate-y-1 group-hover:border-primary/60 group-hover:shadow-[0_0_20px_rgba(0,229,255,0.12)]" style={{ borderTopColor: 'currentColor' }}>
            <div className={`absolute top-0 right-0 p-4 opacity-20 ${stat.color}`}>
              <stat.icon className="w-16 h-16" />
            </div>
            <div className="relative z-10">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">{stat.label}</p>
              <p className={`text-4xl font-mono font-bold ${stat.color}`}>{stat.value}</p>
              <p className="mt-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground transition-colors group-hover:text-primary">
                {stat.action} →
              </p>
            </div>
          </Card>
          </button>
        ))}
      </div>

      {dashboard.activeAlerts.length > 0 && (
        <div className="space-y-2" role="alert" aria-live="polite">
          <h2 className="text-xl font-mono uppercase tracking-widest text-destructive border-b border-destructive/30 pb-2 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 animate-pulse" />
            Active Alerts ({dashboard.activeAlerts.length})
          </h2>
          {dashboard.activeAlerts.map((alert) => (
            <button
              key={alert.id}
              type="button"
              onClick={() => setLocation('/security-logs')}
              className={`w-full text-left flex items-center justify-between gap-4 p-4 border font-mono transition-colors ${
                alert.severity === 'high'
                  ? 'bg-destructive/10 border-destructive/50 hover:border-destructive'
                  : 'bg-yellow-500/10 border-yellow-500/40 hover:border-yellow-500'
              }`}
            >
              <div className="flex items-center gap-3">
                <Badge className={alert.severity === 'high' ? 'bg-destructive text-destructive-foreground' : 'bg-yellow-500 text-black'}>
                  {alert.severity.toUpperCase()}
                </Badge>
                <span className="text-sm text-foreground">{alert.message}</span>
              </div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Review →</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xl font-mono uppercase tracking-widest text-foreground border-b border-border pb-2">Recent Audit Trail</h2>
          <div className="space-y-3">
            {dashboard.recentLogs.map(log => (
              <div key={log.id} className="bg-card border border-border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group hover:border-primary/50 transition-colors">
                <div className="flex items-start gap-4">
                  <div className="mt-1">
                    {log.eventType.includes('FAILED') ? (
                      <div className="w-2 h-2 rounded-full bg-destructive shadow-[0_0_8px_rgba(255,0,0,0.8)]" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <div>
                    <p className="font-mono text-sm text-foreground uppercase tracking-wider">{log.eventType.replace('_', ' ')}</p>
                    <p className="font-mono text-xs text-muted-foreground mt-1">{log.details}</p>
                    <div className="flex gap-3 mt-2">
                      <span className="font-mono text-[10px] text-muted-foreground/70 uppercase">ID: {log.userEmail || 'UNKNOWN'}</span>
                      <span className="font-mono text-[10px] text-muted-foreground/70 uppercase">IP: {log.ipAddress}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-mono text-xs text-muted-foreground">{format(new Date(log.timestamp), 'HH:mm:ss')}</span>
                  <p className="font-mono text-[10px] text-muted-foreground/50 uppercase">{format(new Date(log.timestamp), 'MMM dd, yyyy')}</p>
                </div>
              </div>
            ))}
            {dashboard.recentLogs.length === 0 && (
              <p className="text-muted-foreground font-mono text-sm">
                {canMonitor ? 'No recent logs.' : 'Audit trail requires security analyst or admin access.'}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-mono uppercase tracking-widest text-foreground border-b border-border pb-2">Threat Surface</h2>
          <Card className="bg-destructive/5 border-destructive/20 p-6 flex flex-col items-center justify-center text-center min-h-[300px]">
            {dashboard.threatsDetected > 0 ? (
              <>
                <AlertTriangle className="w-16 h-16 text-destructive mb-4 animate-pulse" />
                <h3 className="font-mono text-lg text-destructive uppercase tracking-widest mb-2">Active Threats Detected</h3>
                <p className="font-mono text-sm text-muted-foreground">Immediate operator attention required. Check threat intel board.</p>
              </>
            ) : (
              <>
                <Shield className="w-16 h-16 text-green-500/50 mb-4" />
                <h3 className="font-mono text-lg text-green-500 uppercase tracking-widest mb-2">Perimeter Secure</h3>
                <p className="font-mono text-sm text-muted-foreground">No active threats detected in the last 24 hours.</p>
              </>
            )}
          </Card>
          <SuggestedActionCard />
        </div>
      </div>
    </div>
  );
}
