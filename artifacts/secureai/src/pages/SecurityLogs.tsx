import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '../contexts/AuthContext';
import { useListSecurityLogs, getListSecurityLogsQueryKey, verifyLogIntegrity, repairLogChain, restoreLogChain, useListDeletionAudit, getListDeletionAuditQueryKey, VerifyLogIntegrityQueryResult, ChainRepairResult, ChainRestoreResult } from '@workspace/api-client-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Button, Input, Label } from '../components/ui';
import { Loader2, Filter, ShieldCheck, ShieldAlert, Wrench, RotateCcw, Trash2, ChevronDown, ChevronRight, RefreshCw, X } from 'lucide-react';
import { format } from 'date-fns';

function ChainIntegrityPanel() {
  const [result, setResult] = useState<VerifyLogIntegrityQueryResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [confirmingRepair, setConfirmingRepair] = useState(false);
  const [repairResult, setRepairResult] = useState<ChainRepairResult | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<ChainRestoreResult | null>(null);

  const handleVerify = async () => {
    setChecking(true);
    setRepairResult(null);
    setRestoreResult(null);
    try {
      const res = await verifyLogIntegrity();
      setResult(res);
    } finally {
      setChecking(false);
    }
  };

  const handleRepair = async () => {
    setRepairing(true);
    try {
      const res = await repairLogChain();
      setRepairResult(res);
      setResult(res.verification);
    } finally {
      setRepairing(false);
      setConfirmingRepair(false);
    }
  };

  // Unlike repair, this only re-inserts rows using their exact original
  // pre-delete snapshot (from the deletion-audit trigger) — nothing is
  // discarded, so it doesn't need the same destructive-action confirm step.
  const handleRestore = async () => {
    setRestoring(true);
    try {
      const res = await restoreLogChain();
      setRestoreResult(res);
      setResult(res.verification);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="border border-border p-4 flex-shrink-0 space-y-3">
      <div className="flex items-center justify-between gap-4">
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
        <div className="flex items-center gap-2">
          {result && !result.valid && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestore}
              isLoading={restoring}
              data-testid="button-restore-chain"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Restore Deleted Rows
            </Button>
          )}
          {result && !result.valid && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmingRepair(true)}
              disabled={confirmingRepair}
              data-testid="button-repair-chain"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
            >
              <Wrench className="w-3.5 h-3.5 mr-1.5" />
              Repair Chain
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleVerify} isLoading={checking} data-testid="button-verify-chain">
            Verify Now
          </Button>
        </div>
      </div>

      {restoreResult && (
        restoreResult.restored ? (
          <p className="font-mono text-[11px] text-green-400">
            Restored {restoreResult.restoredCount} row(s) (#{restoreResult.restoredIds.join(', #')}) from their pre-deletion
            snapshots. Chain is now {restoreResult.verification.valid ? 'valid' : 'still broken — some rows remain unrecoverable, see below'}.
            {restoreResult.unrecoverableIds.length > 0 && ` No snapshot found for #${restoreResult.unrecoverableIds.join(', #')} — use Repair Chain for those.`}
          </p>
        ) : (
          <p className="font-mono text-[11px] text-muted-foreground">
            Nothing to restore — the break wasn't caused by a deletion (e.g. a row still present but edited in place), or no
            deletion snapshot exists for the missing row(s).
          </p>
        )
      )}

      {confirmingRepair && (
        <div className="border border-destructive/40 bg-destructive/5 p-3 flex items-center justify-between gap-4">
          <p className="font-mono text-[11px] text-foreground">
            This permanently deletes every log from #{result?.brokenAtId} onward — none of it is verifiable anyway. Try
            "Restore Deleted Rows" first if you haven't; this is only for what that can't fix (rows edited in place, or
            deleted before the deletion-audit trigger existed). This repair action itself will be recorded as a new audit entry.
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => setConfirmingRepair(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleRepair} isLoading={repairing} data-testid="button-confirm-repair">
              Confirm
            </Button>
          </div>
        </div>
      )}

      {repairResult?.repaired && (
        <p className="font-mono text-[11px] text-green-400">
          Repaired — removed {repairResult.removedCount} untrustworthy row(s) from #{repairResult.removedFromId} onward. Chain is
          now {repairResult.verification.valid ? 'valid' : 'still broken (unexpected — check server logs)'}.
        </p>
      )}
    </div>
  );
}

// Forensic view of security_log_deletions — every deletion the database
// trigger has captured, whether it went through the app (Repair Chain) or a
// raw SQL client with the DB credentials (e.g. TablePlus/pgAdmin). This is
// the "who deleted this log" answer; ChainIntegrityPanel above is "is the
// chain currently intact".
function DeletionAuditPanel() {
  const [expanded, setExpanded] = useState(false);
  const { data: entries, isLoading, refetch, isFetching } = useListDeletionAudit({
    query: { queryKey: getListDeletionAuditQueryKey(), enabled: expanded },
  });

  return (
    <div className="border border-border flex-shrink-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        data-testid="button-toggle-deletion-audit"
        className="w-full flex items-center justify-between gap-4 p-4 text-left"
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          <Trash2 className="w-5 h-5 text-muted-foreground" />
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-foreground">Deletion Audit Trail</p>
            <p className="font-mono text-[11px] text-muted-foreground mt-0.5">
              Who deleted which log row and when — captured by a database trigger, independent of the app.
            </p>
          </div>
        </div>
        {expanded && (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); refetch(); }}
            isLoading={isFetching}
            data-testid="button-refresh-deletion-audit"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border max-h-80 overflow-auto">
          {isLoading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 z-10 shadow-sm">
                <TableRow>
                  <TableHead className="w-[180px]">Deleted At</TableHead>
                  <TableHead>Log #</TableHead>
                  <TableHead>Original Event</TableHead>
                  <TableHead>Deleted By</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries?.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(entry.deletedAt), 'yyyy-MM-dd HH:mm:ss')}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground">#{entry.deletedLogId}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground max-w-xs truncate">
                      {entry.eventType ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground">
                      {entry.deletedByAppActor ? (
                        <span>{entry.deletedByAppActor}</span>
                      ) : (
                        <Badge variant="destructive" className="bg-destructive/10">
                          RAW: {entry.deletedByDbRole}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.deletedByClientAddr ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={entry.currentlyRestored ? 'border-green-400/40 text-green-400' : 'border-destructive/40 text-destructive'}>
                        {entry.currentlyRestored ? 'Restored' : 'Missing'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {(!entries || entries.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-20 text-center font-mono text-muted-foreground">
                      No deletions recorded yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      )}
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
  'UPLOAD_DELETED', 'UPLOAD_SCAN_REJECTED', 'UPLOAD_SCAN_UNAVAILABLE', 'UNAUTHORIZED_ACCESS', 'RATE_LIMIT_HIT',
  'AUDIT_LOG_CHAIN_REPAIRED', 'AUDIT_LOG_CHAIN_RESTORED',
];

export default function SecurityLogs() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [eventType, setEventType] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Admin is a superset role — see security.ts's canSeeAuditLogs. Enforced
  // server-side too — this just avoids flashing an empty state.
  const canMonitor = user?.role === 'security_analyst' || user?.role === 'admin';

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
      <DeletionAuditPanel />

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
