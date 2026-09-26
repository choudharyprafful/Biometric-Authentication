import React, { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMyPrivacyPolicyStatus,
  getGetMyPrivacyPolicyStatusQueryKey,
  useAcknowledgePrivacyPolicy,
} from '@workspace/api-client-react';
import { Button } from './ui';
import { useAuth } from '../contexts/AuthContext';
import { PRIVACY_POLICY } from '../lib/privacyPolicy';

// Privacy policy section 13: signed-in people are told when the policy changes, and the server
// records which version they were shown (a PRIVACY_POLICY_ACKNOWLEDGED audit event).

function usePolicyStatus() {
  const { user } = useAuth();
  return useGetMyPrivacyPolicyStatus({
    query: { queryKey: getGetMyPrivacyPolicyStatusQueryKey(), enabled: !!user, staleTime: 5 * 60_000 },
  });
}

function useAcknowledge() {
  const queryClient = useQueryClient();
  const mutation = useAcknowledgePrivacyPolicy();
  const [error, setError] = useState('');
  const acknowledge = async () => {
    setError('');
    try {
      await mutation.mutateAsync({ data: { version: PRIVACY_POLICY.version } });
      await queryClient.invalidateQueries({ queryKey: getGetMyPrivacyPolicyStatusQueryKey() });
    } catch (err: any) {
      setError(err?.data?.error || 'Could not record that. Try again.');
    }
  };
  return { acknowledge, isPending: mutation.isPending, error };
}

const needsReview = (acknowledged: string | null | undefined) => acknowledged !== PRIVACY_POLICY.version;

/** Banner at the top of signed-in pages until the current version has been acknowledged. */
export function PrivacyPolicyNotice() {
  const { data } = usePolicyStatus();
  const { acknowledge, isPending, error } = useAcknowledge();
  if (!data || !needsReview(data.acknowledgedVersion)) return null;
  const updated = data.acknowledgedVersion !== null;
  return (
    <div className="mb-6 border border-primary/40 bg-primary/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3" data-testid="privacy-policy-notice">
      <p className="text-sm text-foreground flex-1">
        {updated ? 'We\'ve updated our Privacy Policy' : 'Please read our Privacy Policy'} (version {PRIVACY_POLICY.version}). It explains what
        SecureAI collects, where it is stored, and how to download or delete your data.
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <Link href="/privacy">
          <Button variant="outline" size="sm" data-testid="privacy-notice-read">Read it</Button>
        </Link>
        <Button size="sm" onClick={acknowledge} isLoading={isPending} data-testid="privacy-notice-ack">I've read it</Button>
      </div>
      {error && <p className="text-destructive font-mono text-xs">{error}</p>}
    </div>
  );
}

/** At the foot of the policy page for signed-in people who haven't acknowledged this version. */
export function PrivacyPolicyAcknowledge() {
  const { data } = usePolicyStatus();
  const { acknowledge, isPending, error } = useAcknowledge();
  if (!data) return null;
  if (!needsReview(data.acknowledgedVersion)) {
    return (
      <p className="text-xs font-mono text-muted-foreground" data-testid="privacy-acknowledged">
        You acknowledged this version{data.acknowledgedAt ? ` on ${new Date(data.acknowledgedAt).toLocaleDateString()}` : ''}.
      </p>
    );
  }
  return (
    <div className="border-t border-border pt-6 flex items-center gap-3">
      <Button onClick={acknowledge} isLoading={isPending} data-testid="privacy-page-ack">I've read this version</Button>
      {error && <p className="text-destructive font-mono text-xs">{error}</p>}
    </div>
  );
}
