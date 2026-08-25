import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { listUsers, updateUserRole, deleteUser, resetUserMfa, staffResetPassword, type StaffUser } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Card, Button, Badge, Centered } from '../components/ui';
import { colors, fonts } from '../theme';

const ROLES: StaffUser['role'][] = ['user', 'admin', 'security_analyst', 'it_support'];

export function UsersScreen() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [resetLinks, setResetLinks] = useState<Record<number, string | null>>({});

  const isAdmin = me?.role === 'admin';
  const isStaff = isAdmin || me?.role === 'it_support';

  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    listUsers()
      .then(setUsers)
      .catch((err) => setError(err?.message || 'Failed to load operators.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (!isStaff) {
    return (
      <Centered>
        <Text style={styles.deniedText}>Admin or IT support access required.</Text>
      </Centered>
    );
  }

  const handleRoleChange = async (target: StaffUser, role: StaffUser['role']) => {
    setBusyId(target.id);
    try {
      await updateUserRole(target.id, role);
      refresh();
    } catch (err: any) {
      Alert.alert('Failed', err?.message || 'Could not update role.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = (target: StaffUser) => {
    Alert.alert('Delete account', `Permanently delete ${target.email}? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusyId(target.id);
          try {
            await deleteUser(target.id);
            refresh();
          } catch (err: any) {
            Alert.alert('Failed', err?.message || 'Could not delete user.');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const handleResetMfa = (target: StaffUser) => {
    Alert.alert('Reset MFA', `Clear all biometric enrollment for ${target.email}? They'll need to re-enroll.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          setBusyId(target.id);
          try {
            await resetUserMfa(target.id);
            refresh();
          } catch (err: any) {
            Alert.alert('Failed', err?.message || 'Could not reset MFA.');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const handleResetPassword = async (target: StaffUser) => {
    setBusyId(target.id);
    try {
      const result = await staffResetPassword(target.id);
      setResetLinks((prev) => ({ ...prev, [target.id]: result.devResetLink }));
    } catch (err: any) {
      Alert.alert('Failed', err?.message || 'Could not issue password reset.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {loading ? (
        <Centered><ActivityIndicator color={colors.primary} /></Centered>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        users.map((u) => {
          const isSelf = u.id === me?.id;
          const busy = busyId === u.id;
          return (
            <Card key={u.id} style={styles.userCard} topAccent>
              <View style={styles.userHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{u.name}</Text>
                  <Text style={styles.userEmail}>{u.email}</Text>
                </View>
                <Badge tone={u.role === 'admin' ? 'destructive' : 'outline'}>{u.role}</Badge>
              </View>

              <View style={styles.badgeRow}>
                <Badge tone={u.faceEnrolled || u.passkeyEnrolled ? 'success' : 'warning'}>
                  {u.faceEnrolled || u.passkeyEnrolled ? 'Biometric Enrolled' : 'Pending'}
                </Badge>
                <Text style={styles.inducted}>Since {new Date(u.createdAt).toLocaleDateString()}</Text>
              </View>

              {isAdmin && !isSelf && (
                <View style={styles.roleRow}>
                  {ROLES.map((role) => (
                    <Button
                      key={role}
                      size="sm"
                      variant={u.role === role ? 'default' : 'outline'}
                      onPress={() => handleRoleChange(u, role)}
                      disabled={busy}
                      style={styles.roleButton}
                    >
                      {role}
                    </Button>
                  ))}
                </View>
              )}

              <View style={styles.actionsRow}>
                <Button size="sm" variant="outline" onPress={() => handleResetPassword(u)} disabled={busy} style={styles.actionButton}>
                  Reset Password
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => handleResetMfa(u)}
                  disabled={busy || (!u.faceEnrolled && !u.passkeyEnrolled)}
                  style={styles.actionButton}
                >
                  Reset MFA
                </Button>
                {isAdmin && !isSelf && (
                  <Button size="sm" variant="destructive" onPress={() => handleDelete(u)} disabled={busy} style={styles.actionButton}>
                    Delete
                  </Button>
                )}
              </View>

              {resetLinks[u.id] !== undefined && (
                <Text style={styles.resetLink}>
                  {resetLinks[u.id] ? `Dev reset link: ${resetLinks[u.id]}` : 'Reset link issued.'}
                </Text>
              )}
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
  deniedText: { fontFamily: fonts.mono, color: colors.destructive, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  errorText: { fontFamily: fonts.mono, color: colors.destructive, fontSize: 12 },
  userCard: { marginBottom: 16 },
  userHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  userName: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 15, fontWeight: '700' },
  userEmail: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 11, marginTop: 2 },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  inducted: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 9, textTransform: 'uppercase' },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  roleButton: { flexGrow: 1 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actionButton: { flexGrow: 1 },
  resetLink: { fontFamily: fonts.mono, color: colors.primary, fontSize: 10, marginTop: 10 },
});
