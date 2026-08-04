import React, { useState } from 'react';
import { useListSecurityLogs } from '@workspace/api-client-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge } from '../components/ui';
import { Loader2, Filter } from 'lucide-react';
import { format } from 'date-fns';

export default function SecurityLogs() {
  const [eventType, setEventType] = useState<string>('');
  
  const { data: logs, isLoading } = useListSecurityLogs({
    query: {
      queryKey: ['security-logs', eventType] as const
    },
    request: {
      query: {
        eventType: eventType || undefined,
        limit: 100
      }
    }
  } as any); // Using 'as any' since the generated types for the custom query shape might differ

  const eventTypes = [
    { value: '', label: 'ALL EVENTS' },
    { value: 'LOGIN_SUCCESS', label: 'LOGIN SUCCESS' },
    { value: 'LOGIN_FAILED', label: 'LOGIN FAILED' },
    { value: 'FACE_VERIFY_SUCCESS', label: 'MFA SUCCESS' },
    { value: 'FACE_VERIFY_FAILED', label: 'MFA FAILED' },
    { value: 'FACE_ENROLL_SUCCESS', label: 'ENROLL SUCCESS' },
    { value: 'PAYMENT_COMPLETED', label: 'PAYMENT COMPLETED' },
  ];

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-end justify-between flex-shrink-0">
        <div>
          <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground">Audit Trail</h1>
          <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-1">Immutable system event log</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <select 
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="bg-input border border-border text-foreground font-mono text-xs uppercase px-3 py-2 outline-none focus:border-primary"
          >
            {eventTypes.map(type => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col border border-border">
        {isLoading ? (
          <div className="flex-1 flex justify-center items-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <div className="overflow-auto flex-1 relative">
            <Table className="relative">
              <TableHeader className="sticky top-0 z-10 shadow-sm">
                <TableRow>
                  <TableHead className="w-[180px]">Timestamp</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead>Origin IP</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs?.map(log => {
                  const isFail = log.eventType.includes('FAILED');
                  return (
                    <TableRow key={log.id} className="group">
                      <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={isFail ? 'destructive' : 'outline'} className={isFail ? 'bg-destructive/10' : 'border-primary/20 text-primary'}>
                          {log.eventType}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-foreground">
                        {log.userEmail || 'SYSTEM'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {log.ipAddress}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground max-w-md truncate group-hover:whitespace-normal group-hover:break-words group-hover:bg-card relative z-20">
                        {log.details}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!logs || logs.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center font-mono text-muted-foreground">
                      No logs found matching criteria.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
