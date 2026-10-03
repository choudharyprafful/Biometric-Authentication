import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMyBreachNotices,
  getListMyBreachNoticesQueryKey,
  useAcknowledgeBreachNotice,
  type BreachNotice,
} from "@workspace/api-client-react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./ui";
import { useAuth } from "../contexts/AuthContext";

// Privacy policy section 14: someone affected by a data breach sees the notice at the top of every
// signed-in page until they confirm they've read it (they are also emailed). The confirmation is
// recorded as a DATA_BREACH_NOTICE_ACKNOWLEDGED audit event.

function Notice({ notice }: { notice: BreachNotice }) {
  const queryClient = useQueryClient();
  const acknowledge = useAcknowledgeBreachNotice();
  const [error, setError] = useState("");

  const confirm = async () => {
    setError("");
    try {
      await acknowledge.mutateAsync({ id: notice.id });
      await queryClient.invalidateQueries({
        queryKey: getListMyBreachNoticesQueryKey(),
      });
    } catch (err: any) {
      setError(err?.data?.error || "Could not record that. Try again.");
    }
  };

  return (
    <div
      role="alert"
      className="mb-6 border border-destructive/50 bg-destructive/10 p-4 space-y-2 [overflow-wrap:anywhere]"
      data-testid={`breach-notice-${notice.id}`}
    >
      <p className="font-mono text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
        Data breach notice: {notice.title}
      </p>
      <p className="text-sm text-foreground">{notice.description}</p>
      <p className="text-sm text-foreground">
        <span className="font-semibold">The information involved: </span>
        {notice.dataInvolved}
      </p>
      <p className="text-sm text-foreground">
        <span className="font-semibold">What you should do: </span>
        {notice.userGuidance}
      </p>
      <p className="text-xs text-muted-foreground">
        Sent {new Date(notice.notifiedAt).toLocaleString()}. If you aren't
        satisfied with how we handle this, you can complain to the Office of the
        Australian Information Commissioner (oaic.gov.au).
      </p>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={confirm}
          isLoading={acknowledge.isPending}
          data-testid={`breach-notice-ack-${notice.id}`}
        >
          I've read this
        </Button>
        {error && <p className="text-destructive font-mono text-xs">{error}</p>}
      </div>
    </div>
  );
}

export function BreachNotices() {
  const { user } = useAuth();
  const { data } = useListMyBreachNotices({
    query: {
      queryKey: getListMyBreachNoticesQueryKey(),
      enabled: !!user,
      staleTime: 5 * 60_000,
      // Before the server has the register (or on any error) show nothing rather than an error.
      retry: false,
    },
  });
  const unread = (data ?? []).filter((n) => !n.acknowledgedAt);
  if (unread.length === 0) return null;
  return (
    <>
      {unread.map((n) => (
        <Notice key={n.id} notice={n} />
      ))}
    </>
  );
}
