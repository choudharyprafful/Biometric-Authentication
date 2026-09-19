import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from 'wouter';
import { useListUsers, useDeleteUser, useUpdateUser, useResetUserMfa, useStaffResetPassword, getListUsersQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Button } from '../components/ui';
import { Loader2, Trash2, Fingerprint, KeyRound, ShieldOff } from 'lucide-react';
import { format } from 'date-fns';

function roleBadgeVariant(role: string): 'destructive' | 'outline' | 'secondary' {
  if (role === 'admin') return 'destructive';
  if (role === 'security_analyst' || role === 'it_support') return 'outline';
  return 'secondary';
}

export default function Users() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [resetLinks, setResetLinks] = useState<Record<number, string>>({});

  // Admin has full control here; it_support gets the same view plus the two
  // account-recovery actions below, but never role changes or deletion —
  // that split is enforced server-side too, this is just matching UI to it.
  const isAdmin = user?.role === 'admin';
  const isStaff = isAdmin || user?.role === 'it_support';

  const { data: users, isLoading } = useListUsers({
    query: {
      queryKey: getListUsersQueryKey(),
      enabled: isStaff,
    },
  });
  const deleteMutation = useDeleteUser();
  const updateMutation = useUpdateUser();
  const resetMfaMutation = useResetUserMfa();
  const resetPasswordMutation = useStaffResetPassword();

  // Redirect if neither admin nor it_support
  if (user && !isStaff) {
    setLocation('/dashboard');
    return null;
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to terminate this operator?')) return;
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
    } catch (err) {
      console.error(err);
    }
  };

  const handleChangeRole = async (id: number, newRole: string) => {
    try {
      await updateMutation.mutateAsync({ id, data: { role: newRole as any } });
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
    } catch (err) {
      console.error(err);
    }
  };

  const handleResetMfa = async (id: number, email: string) => {
    if (!confirm(`Clear face + passkey enrollment for ${email}? They'll need to re-enroll from scratch.`)) return;
    try {
      await resetMfaMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
    } catch (err) {
      console.error(err);
    }
  };

  const handleResetPassword = async (id: number) => {
    try {
      const result = await resetPasswordMutation.mutateAsync({ id });
      if (result.devResetLink) {
        setResetLinks((prev) => ({ ...prev, [id]: result.devResetLink as string }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground">Operator Registry</h1>
        <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-1">Manage system access and privileges</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Designation</TableHead>
              <TableHead>ID / Email</TableHead>
              <TableHead>Privilege</TableHead>
              <TableHead>Biometric</TableHead>
              <TableHead>Inducted</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users?.map(u => (
              <TableRow key={u.id}>
                <TableCell className="font-mono text-sm text-foreground">{u.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{u.email}</TableCell>
                <TableCell>
                  <Badge
                    variant={roleBadgeVariant(u.role)}
                    className={u.role === 'admin' ? 'animate-pulse' : ''}
                  >
                    {u.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  {u.faceEnrolled ? (
                    <Badge variant="success" className="gap-1 px-2 py-0.5">
                      <Fingerprint className="w-3 h-3" /> Enrolled
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30">Pending</Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {format(new Date(u.createdAt), 'MMM dd, yyyy')}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2 flex-wrap">
                    {isAdmin && (
                      <select
                        value={u.role}
                        onChange={(e) => handleChangeRole(u.id, e.target.value)}
                        disabled={updateMutation.isPending || u.id === user?.id}
                        data-testid={`select-role-${u.id}`}
                        className="bg-input border border-border text-foreground font-mono text-xs uppercase px-2 py-1.5 outline-none focus:border-primary disabled:opacity-50"
                      >
                        <option value="user">User</option>
                        <option value="security_analyst">Security Analyst</option>
                        <option value="it_support">IT Support</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      title="Send a password reset link"
                      onClick={() => handleResetPassword(u.id)}
                      disabled={resetPasswordMutation.isPending}
                    >
                      <KeyRound className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      title="Clear face + passkey enrollment"
                      onClick={() => handleResetMfa(u.id, u.email)}
                      disabled={resetMfaMutation.isPending || (!u.faceEnrolled && !u.passkeyEnrolled)}
                    >
                      <ShieldOff className="w-4 h-4" />
                    </Button>
                    {isAdmin && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(u.id)}
                        disabled={deleteMutation.isPending || u.id === user?.id}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  {resetLinks[u.id] && (
                    <p className="mt-2 text-right text-[10px] font-mono text-muted-foreground break-all">
                      Dev reset link: <span className="text-foreground">{resetLinks[u.id]}</span>
                    </p>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
