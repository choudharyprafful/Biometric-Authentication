import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from 'wouter';
import { useListUsers, useDeleteUser, useUpdateUser, getListUsersQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Button } from '../components/ui';
import { Loader2, Trash2, ShieldAlert, Fingerprint } from 'lucide-react';
import { format } from 'date-fns';

export default function Users() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  const { data: users, isLoading } = useListUsers({ query: { enabled: user?.role === 'admin' } });
  const deleteMutation = useDeleteUser();
  const updateMutation = useUpdateUser();

  // Redirect if not admin
  if (user && user.role !== 'admin') {
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

  const handleToggleRole = async (id: number, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      await updateMutation.mutateAsync({ id, data: { role: newRole as any } });
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
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
                  <Badge variant={u.role === 'admin' ? 'destructive' : 'secondary'} className={u.role === 'admin' ? 'animate-pulse' : ''}>
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
                <TableCell className="text-right space-x-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => handleToggleRole(u.id, u.role)}
                    disabled={updateMutation.isPending || u.id === user?.id}
                  >
                    <ShieldAlert className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="sm" 
                    onClick={() => handleDelete(u.id)}
                    disabled={deleteMutation.isPending || u.id === user?.id}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
