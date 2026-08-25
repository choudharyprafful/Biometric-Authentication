import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '../contexts/AuthContext';
import { useListSecurityLogs, getListSecurityLogsQueryKey, verifyLogIntegrity, VerifyLogIntegrityQueryResult } from '@workspace/api-client-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Button, Input, Label } from '../components/ui';
import { Loader2, Filter, ShieldCheck, ShieldAlert, X } from 'lucide-react';
import { format } from 'date-fns';

function ChainIntegrityPanel() {
  const [result, setResult] = useState<VerifyLogIntegrityQueryResult | null>(null);
  const [checking, setChecking] = useState(false);

  const handleVerify = async () => {
    setChecking(true);
    try {
      const res = await verifyLogIntegrity();
      setResult(res);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="border border-border p-4 flex items-center justify-between gap-4 flex-shrink-0">
      <div className="flex items-center gap-3">
        {result === null ? (
          <ShieldCheck className="w-5 h-5 text-muted-foreground" />
        ) : result.valid ? (
          <ShieldCheck className="w-5 h-5 text-green-400" />
        ) : (
          <ShieldAlert className="w-5 h-5 text-destructive" />
        )}
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-foreground">Hash-Chain Integrity</p>
          <p className="font-mono text-[11px] text-muted-foreground mt-0.5">
            {result === null && 'Not yet checked this session — recomputes every row\'s SHA-256 link.'}
            {result?.valid && `Intact — ${result.rowsChecked} chained row(s) verified, no gaps.`}
            {result && !result.valid && `Broken at log #${result.brokenAtId}: ${result.reason}`}
          </p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={handleVerify} isLoading={checking} data-testid="button-verify-chain">
        Verify Now
      </Button>
    </div>
  );
}

// Must match AuditEventType in lib/auditLog.ts.
const EVENT_TYPES = [
  '', 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_FACE_SUCCESS', 'LOGIN_FACE_FAILED',
  'LOGIN_PASSKEY_SUCCESS', 'LOGIN_PASSKEY_FAILED', 'PASSKEY_ENROLLED', 'PASSKEY_REMOVED',
  'LOGOUT', 'LOGOUT_ALL', 'REGISTER', 'FACE_ENROLLED', 'FACE_REMOVED', 'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_FACE_FAILED', 'PASSWORD_RESET_PASSKEY_FAILED', 'PASSWORD_RESET_COMPLETED',
  'USER_DELETED', 'USER_UPDATED', 'MFA_RESET_BY_STAFF', 'PAYMENT_CREATED', 'PAYMENT_FAILED', 'SUBSCRIPTION_CHANGED',
  'PAYMENT_WEBHOOK_RECEIVED', 'PAYMENT_WEBHOOK_REJECTED', 'UPLOAD_CREATED', 'UPLOAD_DOWNLOADED',
  'UPLOAD_DELETED', 'UPLOAD_SCAN_REJECTED', 'UNAUTHORIZED_ACCESS', 'RATE_LIMIT_HIT',
];

export default function SecurityLogs() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [eventType, setEventType] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // security_analyst only, not admin (separation of duties). Enforced
  // server-side too — this just avoids flashing an empty state.
  const canMonitor = user?.role === 'security_analyst';

  const filters = {
    eventType: eventType || undefined,
    userEmail: userEmail || undefined,
    ipAddress: ipAddress || undefined,
    fromDate: fromDate ? new Date(fromDate).toISOString() : undefined,
    toDate: toDate ? new Date(toDate).toISOString() : undefined,
    limit: 200,
  };

  const { data: logs, isLoading } = useListSecurityLogs(filters, {
    query: { queryKey: getListSecurityLogsQueryKey(filters), enabled: canMonitor },
  });

  if (user && !canMonitor) {
    setLocation('/dashboard');
    return null;
  }

  const hasActiveFilters = !!(eventType || userEmail || ipAddress || fromDate || toDate);
  const clearFilters = () => {
    setEventType('');
    setUserEmail('');
    setIpAddress('');
    setFromDate('');
    setToDate('');
  };

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-end justify-between flex-shrink-0">
        <div>
          <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground">Audit Trail</h1>
          <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-1">Immutable system event log</p>
        </div>
      </div>

      {/* Wazuh-style filter bar — every field is optional and independently
          AND-combined server-side (security.ts's buildLogFilterConditions). */}
      <div className="border border-border p-4 flex-shrink-0 flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Filters</span>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-event-type" className="text-[10px] uppercase tracking-widest text-muted-foreground">Event Type</Label>
          <select
            id="filter-event-type"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            data-testid="select-filter-event-type"
            className="bg-input border border-border text-foreground font-mono text-xs uppercase px-3 py-2 outline-none focus:border-primary min-w-[180px]"
          >
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>{type || 'ALL EVENTS'}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-user-email" className="text-[10px] uppercase tracking-widest text-muted-foreground">User (partial email)</Label>
          <Input
            id="filter-user-email"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            placeholder="e.g. admin"
            className="font-mono text-xs w-40"
            data-testid="input-filter-user-email"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-ip" className="text-[10px] uppercase tracking-widest text-muted-foreground">IP (partial match)</Label>
          <Input
            id="filter-ip"
            value={ipAddress}
            onChange={(e) => setIpAddress(e.target.value)}
            placeholder="e.g. 45.33"
            className="font-mono text-xs w-32"
            data-testid="input-filter-ip"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-from" className="text-[10px] uppercase tracking-widest text-muted-foreground">From</Label>
          <Input
            id="filter-from"
            type="datetime-local"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="font-mono text-xs"
            data-testid="input-filter-from-date"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="filter-to" className="text-[10px] uppercase tracking-widest text-muted-foreground">To</Label>
          <Input
            id="filter-to"
            type="datetime-local"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="font-mono text-xs"
            data-testid="input-filter-to-date"
          />
        </div>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
            <X className="w-4 h-4 mr-1" /> Clear
          </Button>
        )}
      </div>

      <ChainIntegrityPanel />

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
                  const isFail = log.eventType.includes('FAILED') || log.eventType.includes('REJECTED') || log.eventType === 'UNAUTHORIZED_ACCESS';
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
