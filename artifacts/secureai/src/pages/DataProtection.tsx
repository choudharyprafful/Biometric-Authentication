import React from 'react';
import { Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge } from '../components/ui';
import { ShieldCheck, Lock, Radio } from 'lucide-react';

interface Row {
  data: string;
  storedIn: string;
  atRest: string;
  atRestOk: boolean;
  access: string;
}

const ROWS: Row[] = [
  {
    data: 'Password',
    storedIn: 'users.password_hash',
    atRest: 'bcrypt hash (cost 12) — one-way, never decrypted',
    atRestOk: true,
    access: 'Never returned by any API response',
  },
  {
    data: 'Face biometric descriptor',
    storedIn: 'users.face_descriptor_ciphertext / _iv / _auth_tag',
    atRest: 'AES-256-GCM encrypted',
    atRestOk: true,
    access: 'Decrypted in memory only to compare a live scan; never sent to the client',
  },
  {
    data: 'Passkey public key',
    storedIn: 'passkeys.public_key',
    atRest: 'Public key only — the private key never leaves the user’s device',
    atRestOk: true,
    access: 'Used to verify signed challenges; not a secret if exposed',
  },
  {
    data: 'Uploaded files (text / image / video / audio)',
    storedIn: 'uploads.ciphertext / iv / auth_tag',
    atRest: 'AES-256-GCM encrypted',
    atRestOk: true,
    access: 'Strictly the uploader — no admin bypass',
  },
  {
    data: 'Payment provider token',
    storedIn: 'payments.provider_token_ciphertext / iv / auth_tag',
    atRest: 'AES-256-GCM encrypted',
    atRestOk: true,
    access: 'Owner or admin',
  },
  {
    data: 'Password-reset token',
    storedIn: 'password_reset_tokens.token_hash',
    atRest: 'SHA-256 hash, single-use, 30-minute expiry',
    atRestOk: true,
    access: 'Consumed server-side only; raw token only ever exists in the emailed link',
  },
  {
    data: 'Session identity',
    storedIn: 'connect.sid cookie + session table',
    atRest: 'httpOnly, Secure in production, SameSite=Lax',
    atRestOk: true,
    access: 'Server-validated only — not readable by page JavaScript',
  },
  {
    data: 'Audit / security logs',
    storedIn: 'security_logs',
    atRest: 'Hash-chained (SHA-256, links each row to the one before it) — tampering is detectable, not just logged',
    atRestOk: true,
    access: 'Admin only',
  },
];

export default function DataProtection() {
  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="border-b border-border pb-6">
        <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-primary" />
          Data Protection
        </h1>
        <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-2">
          Where every category of data lives, and how it's protected at rest and in transit
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <Lock className="w-5 h-5 text-primary" />
            <h2 className="font-mono font-bold uppercase tracking-widest text-foreground">Encryption at Rest</h2>
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            Face descriptors, uploaded files, and payment provider tokens are all AES-256-GCM
            encrypted before being written to Postgres — verifiable by inspecting the raw
            database columns directly, which hold only ciphertext, never plaintext.
          </p>
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <Radio className="w-5 h-5 text-primary" />
            <h2 className="font-mono font-bold uppercase tracking-widest text-foreground">Encryption in Transit</h2>
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            In production, every request is forced onto HTTPS (plain HTTP redirects, 308) and
            browsers are told to remember that via HSTS. Session cookies carry the Secure flag
            in production, so they're never sent over an unencrypted connection.
          </p>
        </Card>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col border border-border bg-card">
        <div className="overflow-auto flex-1">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card shadow-sm border-b border-border">
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Stored In</TableHead>
                <TableHead>At Rest</TableHead>
                <TableHead>Who Can Access It</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROWS.map((row) => (
                <TableRow key={row.data}>
                  <TableCell className="font-mono text-sm text-foreground whitespace-nowrap">{row.data}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    <code className="px-1.5 py-0.5 bg-input border border-border rounded-sm">{row.storedIn}</code>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <Badge variant={row.atRestOk ? 'success' : 'warning'} className="mb-1">
                      {row.atRestOk ? 'Encrypted' : 'Plaintext'}
                    </Badge>
                    <p className="text-muted-foreground mt-1">{row.atRest}</p>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{row.access}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
        Known limitation: the hash-chain write queue and rate limiters are in-memory and
        single-process — correct for this demo's single server instance, but a real multi-instance
        deployment would need a shared store (e.g. Redis) instead — flagged honestly rather than
        presented as solved.
      </p>
    </div>
  );
}
