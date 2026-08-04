import React from 'react';
import { useListThreats } from '@workspace/api-client-react';
import { Card, Badge } from '../components/ui';
import { Loader2, ShieldAlert, AlertTriangle, ShieldCheck, Activity } from 'lucide-react';
import { format } from 'date-fns';

export default function Threats() {
  const { data: threats, isLoading } = useListThreats();

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-500 border-red-500/50 bg-red-500/10 shadow-[0_0_15px_rgba(239,68,68,0.3)]';
      case 'high': return 'text-orange-500 border-orange-500/50 bg-orange-500/10';
      case 'medium': return 'text-yellow-500 border-yellow-500/50 bg-yellow-500/10';
      case 'low': return 'text-blue-500 border-blue-500/50 bg-blue-500/10';
      default: return 'text-muted-foreground border-border bg-muted/10';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <AlertTriangle className="w-5 h-5 text-destructive animate-pulse" />;
      case 'mitigated': return <Activity className="w-5 h-5 text-yellow-500" />;
      case 'resolved': return <ShieldCheck className="w-5 h-5 text-green-500" />;
      default: return <ShieldAlert className="w-5 h-5" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-3">
            <ShieldAlert className="w-8 h-8 text-destructive" />
            Threat Intel
          </h1>
          <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-2">Active anomalies and risk vectors</p>
        </div>
        
        <div className="flex gap-4">
          <div className="text-right">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Active Vectors</p>
            <p className="text-2xl font-mono font-bold text-destructive">
              {threats?.filter(t => t.status === 'active').length || 0}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {threats?.map(threat => (
          <div key={threat.id} className={`border border-border bg-card p-5 relative overflow-hidden transition-all hover:border-primary/50`}>
            
            {threat.severity === 'critical' && threat.status === 'active' && (
              <div className="absolute top-0 left-0 w-1 h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,1)] animate-pulse" />
            )}
            
            <div className="flex flex-col md:flex-row justify-between gap-6 pl-2">
              <div className="space-y-4 flex-1">
                <div className="flex items-center gap-3">
                  {getStatusIcon(threat.status)}
                  <h3 className="text-lg font-mono font-bold text-foreground uppercase tracking-wider">{threat.type.replace(/_/g, ' ')}</h3>
                  <div className={`px-2 py-0.5 border text-xs font-mono uppercase tracking-widest ${getSeverityColor(threat.severity)}`}>
                    {threat.severity}
                  </div>
                  <Badge variant={threat.status === 'active' ? 'destructive' : 'outline'} className="ml-auto md:ml-0">
                    {threat.status}
                  </Badge>
                </div>
                
                <p className="text-sm font-mono text-muted-foreground border-l border-border pl-4">
                  {threat.description}
                </p>
              </div>

              <div className="flex flex-col justify-between md:items-end gap-2 shrink-0 md:w-48">
                <div className="text-left md:text-right">
                  <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Detection Time</p>
                  <p className="text-sm font-mono text-foreground">{format(new Date(threat.timestamp), 'yyyy-MM-dd HH:mm:ss')}</p>
                </div>
                {threat.affectedUsers !== null && (
                  <div className="text-left md:text-right">
                    <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Impact Radius</p>
                    <p className="text-sm font-mono text-primary">{threat.affectedUsers} Users</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {(!threats || threats.length === 0) && (
          <div className="text-center py-12 border border-border bg-card/50">
            <ShieldCheck className="w-12 h-12 text-green-500/50 mx-auto mb-4" />
            <p className="font-mono text-muted-foreground uppercase tracking-widest">No threat vectors recorded.</p>
          </div>
        )}
      </div>
    </div>
  );
}
