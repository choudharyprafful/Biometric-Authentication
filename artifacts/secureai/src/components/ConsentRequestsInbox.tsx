import React, { useState } from "react";
import {
  useListIncomingConsentRequests,
  useAnswerConsentRequest,
  getListIncomingConsentRequestsQueryKey,
  type IncomingConsentRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "wouter";
import { Button } from "./ui";

// Requests to this account from people who uploaded a file that shows it: Team 2's Bystander Consent
// Policy, section 4, first row (the API's lib/bystanderConsent.ts). Each use is answered on its own,
// and an answer can be changed at any time. The file itself is never shown here.

const USES = [
  {
    key: "personalisation",
    question: "Their topic profile may use it",
    detail:
      "SecureAI's private list of the topics in their own writing, which only they see.",
  },
  {
    key: "sharedTraining",
    question: "Anything shared across accounts may use it",
    detail:
      "Nothing shared learns from files today; your answer is kept so anything that ever does has to follow it.",
  },
] as const;

type Answer = {
  personalisation: boolean | null;
  sharedTraining: boolean | null;
};

function RequestCard({
  request,
}: Readonly<{ request: IncomingConsentRequest }>) {
  const queryClient = useQueryClient();
  const answerMutation = useAnswerConsentRequest();
  const answered = request.answeredAt !== null;
  const [editing, setEditing] = useState(!answered);
  const [answer, setAnswer] = useState<Answer>({
    personalisation: request.personalisation,
    sharedTraining: request.sharedTraining,
  });
  const [error, setError] = useState("");
  const complete =
    answer.personalisation !== null && answer.sharedTraining !== null;

  const save = async () => {
    if (!complete) return;
    setError("");
    try {
      await answerMutation.mutateAsync({
        id: request.id,
        data: {
          personalisation: answer.personalisation === true,
          sharedTraining: answer.sharedTraining === true,
        },
      });
      setEditing(false);
      await queryClient.invalidateQueries({
        queryKey: getListIncomingConsentRequestsQueryKey(),
      });
    } catch (err: any) {
      setError(err?.data?.error || "Could not save your answer.");
    }
  };

  return (
    <li
      className="space-y-3 border border-border bg-card p-4"
      data-testid={`consent-request-${request.id}`}
    >
      <p className="text-sm text-foreground">
        <span className="font-semibold">{request.fromName}</span> (
        {request.fromEmail}) says their {request.fileType} file{" "}
        <span className="font-mono">{request.fileName}</span> shows or names
        you, and asked on {format(new Date(request.requestedAt), "d MMM yyyy")}{" "}
        whether it can be used.
      </p>
      {editing ? (
        <div className="space-y-3">
          {USES.map((use) => (
            <fieldset key={use.key} className="space-y-1">
              <legend className="text-xs text-foreground">
                {use.question}?
              </legend>
              <p className="text-xs text-muted-foreground">{use.detail}</p>
              <div className="flex gap-4">
                {(
                  [
                    [true, "Yes"],
                    [false, "No"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={label}
                    className="flex items-center gap-2 text-xs text-foreground"
                  >
                    <input
                      type="radio"
                      name={`consent-${request.id}-${use.key}`}
                      checked={answer[use.key] === value}
                      onChange={() =>
                        setAnswer((a) => ({ ...a, [use.key]: value }))
                      }
                      data-testid={`consent-${request.id}-${use.key}-${value ? "yes" : "no"}`}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={save}
              disabled={!complete}
              isLoading={answerMutation.isPending}
              data-testid={`consent-${request.id}-save`}
            >
              Save my answer
            </Button>
            {answered && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            You said: topic profile{" "}
            <strong>{request.personalisation ? "yes" : "no"}</strong>, shared{" "}
            <strong>{request.sharedTraining ? "yes" : "no"}</strong>
            {request.answeredAt &&
              ` (${format(new Date(request.answeredAt), "d MMM yyyy")})`}
            .
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
            data-testid={`consent-${request.id}-change`}
          >
            Change my answer
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </li>
  );
}

export function ConsentRequestsInbox() {
  const { data: requests } = useListIncomingConsentRequests();
  if (!requests || requests.length === 0) return null;
  const waiting = requests.filter((r) => r.answeredAt === null).length;
  return (
    <section className="space-y-3" data-testid="consent-requests">
      <div>
        <h2 className="text-sm font-mono uppercase tracking-widest text-foreground">
          Files other people say show you
          {waiting > 0 && (
            <span className="ml-2 text-primary">({waiting} to answer)</span>
          )}
        </h2>
        <p className="text-xs text-muted-foreground mt-1 max-w-prose">
          Until you answer, no feature uses the file. You can change an answer
          at any time. If you don't know who asked, or you want the file
          removed,{" "}
          <Link className="underline" href="/report-content">
            ask us to review it
          </Link>
          .
        </p>
      </div>
      <ul className="space-y-3">
        {requests.map((r) => (
          <RequestCard key={r.id} request={r} />
        ))}
      </ul>
    </section>
  );
}
