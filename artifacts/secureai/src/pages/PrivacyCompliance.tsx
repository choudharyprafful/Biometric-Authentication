import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDataBreaches,
  getListDataBreachesQueryKey,
  useRecordDataBreach,
  useAssessDataBreach,
  useNotifyDataBreachUsers,
  useRecordRegulatorNotification,
  useListGovernmentDisclosures,
  getListGovernmentDisclosuresQueryKey,
  useRecordGovernmentDisclosure,
  useListLegalHolds,
  getListLegalHoldsQueryKey,
  usePlaceLegalHold,
  useReleaseLegalHold,
  type DataBreach,
  type DisclosureCategory,
  type LegalHold,
  type LegalHoldCopyCountKind,
  type NotifyDataBreachUsersResult,
  type RecordGovernmentDisclosureInputRequestType,
} from "@workspace/api-client-react";
import {
  Card,
  Badge,
  Button,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui";
import { Textarea } from "../components/ui/textarea";
import { useAuth } from "../contexts/AuthContext";
import {
  Archive,
  FileWarning,
  Landmark,
  Loader2,
  Plus,
  Scale,
} from "lucide-react";

// The data breach register, the government disclosure record and legal holds
// (docs/12_Data_Breach_Response_Plan.md). Under the Notifiable Data Breaches scheme a suspected breach
// is assessed within 30 days; if serious harm is likely, the people affected and the OAIC are told as
// soon as practicable. Security analysts record and assess; administrators tell people and the OAIC,
// record disclosures and manage legal holds.

// <input type="datetime-local"> works in the browser's local time, without a zone.
const toLocalInput = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
const fromLocalInput = (v: string) => new Date(v).toISOString();
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : "—";
const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const errorText = (err: any, fallback: string) => err?.data?.error || fallback;

// Privacy policy section 9: why information can be given, and what.
const REQUEST_TYPES: {
  value: RecordGovernmentDisclosureInputRequestType;
  label: string;
  help: string;
}[] = [
  {
    value: "legal-demand",
    label: "Required by law",
    help: "A warrant, subpoena, court order or statutory notice (APP 6.2(b))",
  },
  {
    value: "enforcement-request",
    label: "Enforcement request",
    help: "A written request from an Australian enforcement body, with no order, that you judge reasonably necessary for its work (APP 6.2(e))",
  },
  {
    value: "emergency",
    label: "Emergency",
    help: "A serious threat to someone's life, health or safety, or a missing person (Privacy Act s 16A)",
  },
];
const REQUEST_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  REQUEST_TYPES.map((t) => [t.value, t.label]),
);
const CATEGORIES: { value: DisclosureCategory; label: string }[] = [
  { value: "account", label: "Account details" },
  { value: "security-records", label: "Security records" },
  { value: "payments", label: "Payment records" },
  { value: "uploads", label: "Uploaded files" },
  { value: "face-template", label: "Face template" },
  { value: "ai-challenges", label: "AI challenge records" },
  { value: "sign-in-keys", label: "Passkeys and phone keys" },
];
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label]),
);
// Given only when the law requires it; the API refuses them for any other kind of request.
const LEGAL_DEMAND_ONLY: DisclosureCategory[] = ["uploads", "face-template"];

const COPY_LABEL: Record<LegalHoldCopyCountKind, [string, string]> = {
  account: ["account", "accounts"],
  "face-template": ["face template", "face templates"],
  upload: ["file", "files"],
  passkey: ["passkey", "passkeys"],
  "phone-key": ["phone key", "phone keys"],
  payment: ["payment record", "payment records"],
  "security-record": ["security record", "security records"],
};

function useRefreshBreaches() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: getListDataBreachesQueryKey() });
}

function stepBadge(b: DataBreach) {
  switch (b.nextStep) {
    case "assess":
      return b.assessmentOverdue ? (
        <Badge variant="destructive" data-testid={`breach-status-${b.id}`}>
          Assessment overdue
        </Badge>
      ) : (
        <Badge variant="warning" data-testid={`breach-status-${b.id}`}>
          Assess by {day(b.assessBy)}
        </Badge>
      );
    case "notify-people-and-regulator":
      return (
        <Badge variant="destructive" data-testid={`breach-status-${b.id}`}>
          Tell people and the OAIC
        </Badge>
      );
    case "notify-people":
      return (
        <Badge variant="destructive" data-testid={`breach-status-${b.id}`}>
          Tell the people affected
        </Badge>
      );
    case "notify-regulator":
      return (
        <Badge variant="destructive" data-testid={`breach-status-${b.id}`}>
          Tell the OAIC
        </Badge>
      );
    default:
      return (
        <Badge
          variant={b.assessment === "eligible" ? "success" : "secondary"}
          data-testid={`breach-status-${b.id}`}
        >
          {b.assessment === "eligible" ? "Notified" : "Not notifiable"}
        </Badge>
      );
  }
}

function RecordBreachForm({ onDone }: { onDone: () => void }) {
  const record = useRecordDataBreach();
  const refresh = useRefreshBreaches();
  const [form, setForm] = useState({
    title: "",
    description: "",
    dataInvolved: "",
    userGuidance: "",
    discoveredAt: toLocalInput(new Date()),
  });
  const [error, setError] = useState("");
  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [key]: e.target.value });

  const submit = async () => {
    setError("");
    try {
      await record.mutateAsync({
        data: { ...form, discoveredAt: fromLocalInput(form.discoveredAt) },
      });
      await refresh();
      onDone();
    } catch (err) {
      setError(errorText(err, "Could not record the breach."));
    }
  };

  return (
    <Card className="space-y-3" data-testid="form-record-breach">
      <p className="text-sm text-muted-foreground">
        Write what happened and what to do in plain words: if the breach has to
        be notified, the people affected receive this text.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="breach-title">Title</Label>
          <Input
            id="breach-title"
            value={form.title}
            onChange={set("title")}
            maxLength={200}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="breach-discovered">When it was discovered</Label>
          <Input
            id="breach-discovered"
            type="datetime-local"
            value={form.discoveredAt}
            onChange={set("discoveredAt")}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="breach-description">What happened</Label>
        <Textarea
          id="breach-description"
          value={form.description}
          onChange={set("description")}
          rows={3}
          maxLength={4000}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="breach-data">The information involved</Label>
        <Textarea
          id="breach-data"
          value={form.dataInvolved}
          onChange={set("dataInvolved")}
          rows={2}
          maxLength={1000}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="breach-guidance">
          What the people affected should do
        </Label>
        <Textarea
          id="breach-guidance"
          value={form.userGuidance}
          onChange={set("userGuidance")}
          rows={2}
          maxLength={2000}
        />
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <div className="flex gap-2">
        <Button
          onClick={submit}
          isLoading={record.isPending}
          disabled={
            form.title.trim().length < 3 ||
            form.description.trim().length < 10 ||
            form.dataInvolved.trim().length < 3 ||
            form.userGuidance.trim().length < 3 ||
            !form.discoveredAt
          }
          data-testid="button-record-breach"
        >
          Record breach
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function AssessForm({
  breach,
  onDone,
}: {
  breach: DataBreach;
  onDone?: () => void;
}) {
  const assess = useAssessDataBreach();
  const refresh = useRefreshBreaches();
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [containedAt, setContainedAt] = useState(
    breach.containedAt ? toLocalInput(new Date(breach.containedAt)) : "",
  );
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    try {
      await assess.mutateAsync({
        id: breach.id,
        data: {
          eligible: eligible!,
          note,
          containedAt: containedAt ? fromLocalInput(containedAt) : null,
        },
      });
      await refresh();
      onDone?.();
    } catch (err) {
      setError(errorText(err, "Could not record the assessment."));
    }
  };

  return (
    <div className="space-y-2 border border-border/60 p-3">
      <p className="font-mono text-xs uppercase tracking-wider text-foreground">
        {breach.assessment ? "Reassess" : "Assess"}: is serious harm likely?
      </p>
      <div className="flex flex-col gap-1">
        {[
          [
            true,
            "Yes: an eligible data breach. People and the OAIC must be told.",
          ],
          [
            false,
            "No: serious harm is not likely (for example, it was contained in time).",
          ],
        ].map(([value, label]) => (
          <label
            key={String(value)}
            className="flex items-start gap-2 text-sm text-foreground"
          >
            <input
              type="radio"
              className="mt-1"
              name={`eligible-${breach.id}`}
              checked={eligible === value}
              onChange={() => setEligible(value as boolean)}
            />
            {label as string}
          </label>
        ))}
      </div>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Why: who could be harmed, how, and what has been done to reduce it"
        aria-label="Reasons for the assessment"
        data-testid={`input-assess-${breach.id}`}
      />
      <div className="space-y-1">
        <Label htmlFor={`contained-${breach.id}`}>
          When it was contained (if it has been)
        </Label>
        <Input
          id={`contained-${breach.id}`}
          type="datetime-local"
          value={containedAt}
          onChange={(e) => setContainedAt(e.target.value)}
        />
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <Button
        size="sm"
        onClick={submit}
        isLoading={assess.isPending}
        disabled={eligible === null || note.trim().length < 5}
        data-testid={`button-assess-${breach.id}`}
      >
        Record assessment
      </Button>
    </div>
  );
}

function NotifyForm({
  breach,
  onNotified,
}: {
  breach: DataBreach;
  onNotified?: () => void;
}) {
  const notify = useNotifyDataBreachUsers();
  const refresh = useRefreshBreaches();
  const [audience, setAudience] = useState<"listed" | "all">("listed");
  const [emails, setEmails] = useState("");
  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<NotifyDataBreachUsersResult | null>(
    null,
  );
  const [error, setError] = useState("");
  const list = emails.split(/[\s,;]+/).filter(Boolean);

  const submit = async () => {
    setError("");
    try {
      const r = await notify.mutateAsync({
        id: breach.id,
        data: audience === "all" ? { audience } : { audience, emails: list },
      });
      setResult(r);
      setArmed(false);
      setEmails("");
      // Keeps this form, and so the result, on screen once the breach shows people as told.
      onNotified?.();
      await refresh();
    } catch (err) {
      setError(errorText(err, "Could not tell them."));
    }
  };

  return (
    <div className="space-y-2 border border-border/60 p-3">
      <p className="font-mono text-xs uppercase tracking-wider text-foreground">
        Tell the people affected
      </p>
      <p className="text-xs text-muted-foreground">
        Each person gets an email with what happened, the information involved
        and what to do, and sees a notice in SecureAI until they confirm reading
        it. Anyone already told about this breach is skipped.
      </p>
      <div className="flex flex-wrap gap-3">
        {(
          [
            ["listed", "Only these accounts"],
            ["all", "Everyone with an account"],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className="flex items-center gap-2 text-sm text-foreground"
          >
            <input
              type="radio"
              name={`audience-${breach.id}`}
              checked={audience === value}
              onChange={() => {
                setAudience(value);
                setArmed(false);
              }}
            />
            {label}
          </label>
        ))}
      </div>
      {audience === "listed" && (
        <Textarea
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          rows={3}
          placeholder="Email addresses, one per line"
          aria-label="Email addresses of the people affected"
          data-testid={`input-notify-${breach.id}`}
        />
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
      {!armed ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setArmed(true)}
          disabled={audience === "listed" && list.length === 0}
          data-testid={`button-notify-${breach.id}`}
        >
          Tell them…
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-foreground">
            {audience === "all"
              ? "This emails every account holder. Send?"
              : `This emails ${list.length} ${list.length === 1 ? "person" : "people"}. Send?`}
          </p>
          <Button
            size="sm"
            variant="destructive"
            onClick={submit}
            isLoading={notify.isPending}
            data-testid={`button-notify-confirm-${breach.id}`}
          >
            Send the notice
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>
            Cancel
          </Button>
        </div>
      )}
      {result && (
        <div
          className="text-xs text-muted-foreground space-y-1"
          data-testid={`notify-result-${breach.id}`}
        >
          <p>
            Told {result.notified} {result.notified === 1 ? "person" : "people"}
            {result.alreadyNotified > 0 &&
              ` (${result.alreadyNotified} had already been told)`}
            .{" "}
            {result.emailed < result.notified &&
              `${result.notified - result.emailed} could not be emailed (email may not be set up); they'll see the notice when they sign in.`}
          </p>
          {result.unknownEmails.length > 0 && (
            <p className="text-destructive">
              No account for: {result.unknownEmails.join(", ")}. If any of them
              deleted their account and their kept payment or security records
              are involved, email them the same statement yourself (privacy
              policy section 14).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RegulatorForm({ breach }: { breach: DataBreach }) {
  const record = useRecordRegulatorNotification();
  const refresh = useRefreshBreaches();
  const [notifiedAt, setNotifiedAt] = useState(toLocalInput(new Date()));
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    try {
      await record.mutateAsync({
        id: breach.id,
        data: { notifiedAt: fromLocalInput(notifiedAt), reference },
      });
      await refresh();
    } catch (err) {
      setError(errorText(err, "Could not record it."));
    }
  };

  return (
    <div className="space-y-2 border border-border/60 p-3">
      <p className="font-mono text-xs uppercase tracking-wider text-foreground">
        Tell the OAIC
      </p>
      <p className="text-xs text-muted-foreground">
        Submit the Notifiable Data Breach form at oaic.gov.au, then record when
        and the reference it gives. This can't be changed afterwards.
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`oaic-when-${breach.id}`}>When</Label>
          <Input
            id={`oaic-when-${breach.id}`}
            type="datetime-local"
            value={notifiedAt}
            onChange={(e) => setNotifiedAt(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`oaic-ref-${breach.id}`}>OAIC reference</Label>
          <Input
            id={`oaic-ref-${breach.id}`}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={200}
            data-testid={`input-oaic-ref-${breach.id}`}
          />
        </div>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <Button
        size="sm"
        variant="outline"
        onClick={submit}
        isLoading={record.isPending}
        disabled={!notifiedAt || reference.trim().length === 0}
        data-testid={`button-oaic-${breach.id}`}
      >
        Record OAIC notification
      </Button>
    </div>
  );
}

function BreachItem({
  breach: b,
  isAdmin,
}: {
  breach: DataBreach;
  isAdmin: boolean;
}) {
  const eligible = b.assessment === "eligible";
  const [extra, setExtra] = useState<"reassess" | "notify" | null>(null);
  const steps: Array<[string, string]> = [
    ["Discovered", when(b.discoveredAt)],
    ["Contained", when(b.containedAt)],
    [
      "Assessed",
      b.assessedAt
        ? `${when(b.assessedAt)}: ${eligible ? "eligible" : "not eligible"}`
        : `due ${day(b.assessBy)}`,
    ],
    [
      "People told",
      b.usersNotifiedAt
        ? `${when(b.usersNotifiedAt)} (${b.noticesSent} told, ${b.noticesAcknowledged} confirmed reading)`
        : "—",
    ],
    [
      "OAIC told",
      b.regulatorNotifiedAt
        ? `${when(b.regulatorNotifiedAt)}, reference ${b.regulatorReference}`
        : "—",
    ],
  ];

  return (
    <li
      className="border border-border p-4 space-y-3 min-w-0 [overflow-wrap:anywhere]"
      data-testid={`breach-${b.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm uppercase tracking-wider text-foreground">
            {b.title}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            #{b.id} · recorded by {b.recordedByEmail}
          </p>
        </div>
        <div className="shrink-0">{stepBadge(b)}</div>
      </div>
      <p className="text-sm text-foreground">{b.description}</p>
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[9rem_1fr]">
        <dt className="text-muted-foreground">Information involved</dt>
        <dd>{b.dataInvolved}</dd>
        <dt className="text-muted-foreground">What people should do</dt>
        <dd>{b.userGuidance}</dd>
        {steps.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono tabular-nums">{value}</dd>
          </React.Fragment>
        ))}
        {b.assessmentNote && (
          <>
            <dt className="text-muted-foreground">Assessment</dt>
            <dd>{b.assessmentNote}</dd>
          </>
        )}
      </dl>
      <div className="grid gap-3 lg:grid-cols-2 items-start">
        {(b.nextStep === "assess" || extra === "reassess") && (
          <AssessForm breach={b} onDone={() => setExtra(null)} />
        )}
        {eligible && isAdmin && !b.regulatorNotifiedAt && (
          <RegulatorForm breach={b} />
        )}
        {eligible && isAdmin && (!b.usersNotifiedAt || extra === "notify") && (
          <NotifyForm breach={b} onNotified={() => setExtra("notify")} />
        )}
        {eligible && !isAdmin && b.nextStep !== "done" && (
          <p className="text-xs text-muted-foreground border border-border/60 p-3">
            An administrator tells the people affected and the OAIC.
          </p>
        )}
      </div>
      {extra === null && (
        <div className="flex flex-wrap gap-2">
          {b.assessment === "not-eligible" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExtra("reassess")}
            >
              Reassess (new facts)
            </Button>
          )}
          {eligible && isAdmin && b.usersNotifiedAt && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExtra("notify")}
            >
              Tell more people
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function DisclosureForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const record = useRecordGovernmentDisclosure();
  const [form, setForm] = useState({
    agency: "",
    legalBasis: "",
    reference: "",
    subjectEmail: "",
    informationDisclosed: "",
    disclosedAt: toLocalInput(new Date()),
    personToldAt: "",
    notTellingReason: "",
  });
  const [told, setTold] = useState<boolean | null>(null);
  const [requestType, setRequestType] =
    useState<RecordGovernmentDisclosureInputRequestType | null>(null);
  const [categories, setCategories] = useState<DisclosureCategory[]>([]);
  const [error, setError] = useState("");
  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [key]: e.target.value });
  const chooseType = (value: RecordGovernmentDisclosureInputRequestType) => {
    setRequestType(value);
    if (value !== "legal-demand")
      setCategories(categories.filter((c) => !LEGAL_DEMAND_ONLY.includes(c)));
  };
  const toggleCategory = (value: DisclosureCategory) =>
    setCategories(
      categories.includes(value)
        ? categories.filter((c) => c !== value)
        : [...categories, value],
    );

  const submit = async () => {
    if (!requestType) return;
    setError("");
    try {
      await record.mutateAsync({
        data: {
          agency: form.agency,
          legalBasis: form.legalBasis,
          requestType,
          categories,
          reference: form.reference || null,
          subjectEmail: form.subjectEmail || null,
          informationDisclosed: form.informationDisclosed,
          disclosedAt: fromLocalInput(form.disclosedAt),
          personToldAt:
            told && form.personToldAt
              ? fromLocalInput(form.personToldAt)
              : null,
          notTellingReason: told ? null : form.notTellingReason,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getListGovernmentDisclosuresQueryKey(),
      });
      onDone();
    } catch (err) {
      setError(errorText(err, "Could not record the disclosure."));
    }
  };

  return (
    <Card className="space-y-3" data-testid="form-record-disclosure">
      <p className="text-sm text-muted-foreground">
        Only disclose when Australian law requires or allows it, only what the
        request covers, and only about the person it names. Check the request is
        genuine through the agency's published contact details first, and place
        a legal hold below before anything else. A foreign government or court
        must go through Australia's mutual assistance process: don't disclose to
        it directly. Never give passwords (only a hash is held), sign-in tokens
        or encryption keys.
      </p>
      <fieldset className="space-y-2">
        <legend className="text-sm text-foreground">
          What kind of request is it?
        </legend>
        {REQUEST_TYPES.map((t) => (
          <label
            key={t.value}
            className="flex items-start gap-2 text-sm text-foreground"
          >
            <input
              type="radio"
              name="disclosure-type"
              className="mt-1"
              checked={requestType === t.value}
              onChange={() => chooseType(t.value)}
              data-testid={`disclosure-type-${t.value}`}
            />
            <span>
              {t.label}
              <span className="block text-xs text-muted-foreground">
                {t.help}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm text-foreground">
          What kinds of information were given?
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {CATEGORIES.map((c) => {
            const blocked =
              LEGAL_DEMAND_ONLY.includes(c.value) &&
              requestType !== "legal-demand";
            return (
              <label
                key={c.value}
                className={`flex items-center gap-2 text-sm ${blocked ? "text-muted-foreground" : "text-foreground"}`}
              >
                <input
                  type="checkbox"
                  checked={categories.includes(c.value)}
                  disabled={blocked}
                  onChange={() => toggleCategory(c.value)}
                  data-testid={`disclosure-category-${c.value}`}
                />
                {c.label}
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Face templates and uploaded files only when the law requires it, never
          on an enforcement request or in an emergency.
        </p>
      </fieldset>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="disclosure-agency">Agency</Label>
          <Input
            id="disclosure-agency"
            value={form.agency}
            onChange={set("agency")}
            maxLength={200}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="disclosure-reference">Their reference</Label>
          <Input
            id="disclosure-reference"
            value={form.reference}
            onChange={set("reference")}
            maxLength={200}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="disclosure-basis">
          The law or order that requires or allows it
        </Label>
        <Input
          id="disclosure-basis"
          value={form.legalBasis}
          onChange={set("legalBasis")}
          maxLength={500}
          placeholder="For example: search warrant 2026/123 under the Crimes Act 1914 (Cth)"
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="disclosure-subject">Whose account (email)</Label>
          <Input
            id="disclosure-subject"
            value={form.subjectEmail}
            onChange={set("subjectEmail")}
            maxLength={320}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="disclosure-when">When it was disclosed</Label>
          <Input
            id="disclosure-when"
            type="datetime-local"
            value={form.disclosedAt}
            onChange={set("disclosedAt")}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="disclosure-what">What was disclosed</Label>
        <Textarea
          id="disclosure-what"
          value={form.informationDisclosed}
          onChange={set("informationDisclosed")}
          rows={2}
          maxLength={2000}
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm text-foreground">Has the person been told?</p>
        <div className="flex flex-wrap gap-3">
          {(
            [
              [true, "Yes"],
              [false, "No: the order forbids it, or not yet"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={String(value)}
              className="flex items-center gap-2 text-sm text-foreground"
            >
              <input
                type="radio"
                name="disclosure-told"
                checked={told === value}
                onChange={() => setTold(value)}
              />
              {label}
            </label>
          ))}
        </div>
        {told === true && (
          <Input
            type="datetime-local"
            aria-label="When the person was told"
            value={form.personToldAt}
            onChange={set("personToldAt")}
          />
        )}
        {told === false && (
          <Textarea
            aria-label="Why the person hasn't been told"
            value={form.notTellingReason}
            onChange={set("notTellingReason")}
            rows={2}
            maxLength={1000}
            placeholder="Why not. They won't see this disclosure in their data download until they are told."
          />
        )}
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <div className="flex gap-2">
        <Button
          onClick={submit}
          isLoading={record.isPending}
          disabled={
            !requestType ||
            categories.length === 0 ||
            form.agency.trim().length < 2 ||
            form.legalBasis.trim().length < 5 ||
            form.informationDisclosed.trim().length < 5 ||
            !form.disclosedAt ||
            told === null ||
            (told && !form.personToldAt) ||
            (!told && form.notTellingReason.trim().length < 5)
          }
          data-testid="button-record-disclosure"
        >
          Record disclosure
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function PlaceHoldForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const place = usePlaceLegalHold();
  const [form, setForm] = useState({
    subjectEmail: "",
    agency: "",
    reference: "",
    reason: "",
  });
  const [error, setError] = useState("");
  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [key]: e.target.value });

  const submit = async () => {
    setError("");
    try {
      await place.mutateAsync({
        data: {
          subjectEmail: form.subjectEmail.trim(),
          agency: form.agency,
          reference: form.reference || null,
          reason: form.reason,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getListLegalHoldsQueryKey(),
      });
      onDone();
    } catch (err) {
      setError(errorText(err, "Could not place the hold."));
    }
  };

  return (
    <Card className="space-y-3" data-testid="form-place-hold">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="hold-subject">The person's email</Label>
          <Input
            id="hold-subject"
            type="email"
            value={form.subjectEmail}
            onChange={set("subjectEmail")}
            maxLength={320}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hold-agency">Agency</Label>
          <Input
            id="hold-agency"
            value={form.agency}
            onChange={set("agency")}
            maxLength={200}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="hold-reference">Their reference</Label>
        <Input
          id="hold-reference"
          value={form.reference}
          onChange={set("reference")}
          maxLength={200}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="hold-reason">What the request covers</Label>
        <Textarea
          id="hold-reason"
          value={form.reason}
          onChange={set("reason")}
          rows={2}
          maxLength={1000}
          placeholder="For example: preservation request for account and payment records, 1 Jan to 30 Jun 2026"
        />
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <div className="flex gap-2">
        <Button
          onClick={submit}
          isLoading={place.isPending}
          disabled={
            !/^[^@\s]+@[^@\s]+$/.test(form.subjectEmail.trim()) ||
            form.agency.trim().length < 2 ||
            form.reason.trim().length < 5
          }
          data-testid="button-place-hold"
        >
          Place hold
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function HoldItem({ hold }: { hold: LegalHold }) {
  const queryClient = useQueryClient();
  const release = useReleaseLegalHold();
  const [releasing, setReleasing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    try {
      await release.mutateAsync({ id: hold.id, data: { reason } });
      await queryClient.invalidateQueries({
        queryKey: getListLegalHoldsQueryKey(),
      });
      setReleasing(false);
    } catch (err) {
      setError(errorText(err, "Could not release the hold."));
    }
  };

  const copies = hold.copies
    .map((c) => `${c.count} ${COPY_LABEL[c.kind][c.count === 1 ? 0 : 1]}`)
    .join(", ");

  return (
    <li data-testid={`hold-${hold.id}`}>
      <Card className="space-y-2 [overflow-wrap:anywhere]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-foreground">
            {hold.subjectEmail}
          </span>
          {hold.releasedAt ? (
            <Badge variant="outline">Released</Badge>
          ) : (
            <Badge variant="warning">Active</Badge>
          )}
          {!hold.accountFound && (
            <Badge variant="outline">No account with this email</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {hold.agency}
          {hold.reference && ` · ${hold.reference}`} · placed{" "}
          {day(hold.placedAt)} by {hold.placedByEmail}
        </p>
        <p className="text-sm text-foreground">{hold.reason}</p>
        {hold.releasedAt ? (
          <p className="text-xs text-muted-foreground">
            Released {day(hold.releasedAt)} by {hold.releasedByEmail}:{" "}
            {hold.releaseReason}. Its copies were deleted.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {hold.copiesTotal === 0 ? "No copies yet." : `Kept: ${copies}.`}
          </p>
        )}
        {!hold.releasedAt && !releasing && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReleasing(true)}
            data-testid={`button-release-hold-${hold.id}`}
          >
            Release hold
          </Button>
        )}
        {releasing && (
          <div className="space-y-2">
            <Textarea
              aria-label="Why the information no longer has to be kept"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Why the information no longer has to be kept, for example: matter closed, agency confirmed on 1 Nov"
            />
            <p className="text-xs text-muted-foreground">
              Releasing deletes the copies this hold kept.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={submit}
                isLoading={release.isPending}
                disabled={reason.trim().length < 5}
                data-testid={`button-confirm-release-${hold.id}`}
              >
                Release and delete copies
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setReleasing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {error && <p className="text-destructive text-xs">{error}</p>}
      </Card>
    </li>
  );
}

// Administrators only, to read too: who is the subject of a government request is need-to-know.
function LegalHolds() {
  const holds = useListLegalHolds({
    query: { queryKey: getListLegalHoldsQueryKey() },
  });
  const [placing, setPlacing] = useState(false);
  const active = (holds.data ?? []).filter((h) => !h.releasedAt).length;

  let list: React.ReactNode;
  if (holds.isLoading) {
    list = <Loader2 className="w-5 h-5 text-primary animate-spin" />;
  } else if (!holds.data) {
    list = (
      <Card>
        <p className="text-sm text-destructive">Could not load legal holds.</p>
      </Card>
    );
  } else if (holds.data.length === 0) {
    list = (
      <Card>
        <p className="text-sm text-muted-foreground">No legal holds.</p>
      </Card>
    );
  } else {
    list = (
      <ul className="space-y-3">
        {holds.data.map((h) => (
          <HoldItem key={h.id} hold={h} />
        ))}
      </ul>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
          <Archive className="w-5 h-5 text-primary" /> Legal holds{" "}
          <Badge variant={active > 0 ? "warning" : "outline"}>
            {active} active
          </Badge>
        </h2>
        {!placing && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPlacing(true)}
            data-testid="button-new-hold"
          >
            <Plus className="w-4 h-4 mr-2" /> Place a hold
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        When a government or law-enforcement request arrives, place a hold on
        the person it names first. Their account, face template, files, sign-in
        keys and payment records are copied now, and while the hold lasts
        anything of theirs that would be deleted, by them, by staff or by the
        retention purge, is copied first. They see no difference. Files and face
        templates stay encrypted in the copies, and no copy can be opened in the
        app: producing them for an agency is an operator task (docs/12). Release
        the hold when the obligation ends; its copies are then deleted.
      </p>
      {placing && <PlaceHoldForm onDone={() => setPlacing(false)} />}
      {list}
    </section>
  );
}

export default function PrivacyCompliance() {
  const { user } = useAuth();
  const isStaff = user?.role === "security_analyst" || user?.role === "admin";
  const isAdmin = user?.role === "admin";
  const breaches = useListDataBreaches({
    query: { queryKey: getListDataBreachesQueryKey(), enabled: isStaff },
  });
  const disclosures = useListGovernmentDisclosures({
    query: {
      queryKey: getListGovernmentDisclosuresQueryKey(),
      enabled: isStaff,
    },
  });
  const [recording, setRecording] = useState(false);
  const [disclosing, setDisclosing] = useState(false);

  if (!isStaff) {
    return (
      <div className="p-6 border border-border font-mono text-sm text-muted-foreground">
        Privacy compliance is for security analysts and administrators.
      </div>
    );
  }
  if (breaches.isLoading || disclosures.isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }
  if (!breaches.data || !disclosures.data) {
    return (
      <div className="p-6 bg-destructive/10 text-destructive border border-destructive/30 font-mono">
        Could not load the registers.
      </div>
    );
  }

  // Anything still needing a step first, then finished ones; newest discovered first within each.
  const ordered = [...breaches.data].sort(
    (a, b) => Number(a.nextStep === "done") - Number(b.nextStep === "done"),
  );
  const open = ordered.filter((b) => b.nextStep !== "done").length;

  return (
    <div className="space-y-8">
      <div className="border-b border-border pb-6">
        <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-3">
          <Scale className="w-8 h-8 text-primary shrink-0" />
          Privacy Compliance
        </h1>
        <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-2">
          Data breaches and disclosures to government agencies
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
            <FileWarning className="w-5 h-5 text-primary" /> Data breach
            register{" "}
            <Badge variant={open > 0 ? "warning" : "outline"}>
              {open} need action
            </Badge>
          </h2>
          {!recording && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRecording(true)}
              data-testid="button-new-breach"
            >
              <Plus className="w-4 h-4 mr-2" /> Record a breach
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Assess a suspected breach within 30 days of discovering it. If serious
          harm is likely, tell the people affected and the OAIC as soon as
          practicable. The steps are in docs/12, the data breach response plan.
        </p>
        {recording && <RecordBreachForm onDone={() => setRecording(false)} />}
        {ordered.length === 0 ? (
          <Card>
            <p className="text-sm text-muted-foreground">
              No data breaches recorded.
            </p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {ordered.map((b) => (
              <BreachItem key={b.id} breach={b} isAdmin={isAdmin} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
            <Landmark className="w-5 h-5 text-primary" /> Disclosures to
            government agencies
          </h2>
          {isAdmin && !disclosing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDisclosing(true)}
              data-testid="button-new-disclosure"
            >
              <Plus className="w-4 h-4 mr-2" /> Record a disclosure
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          The written record Australian Privacy Principle 6.5 requires each time
          personal information is given to an agency under the law.
          {!isAdmin &&
            " Administrators record disclosures and manage legal holds."}
        </p>
        {disclosing && <DisclosureForm onDone={() => setDisclosing(false)} />}
        <Card className="overflow-x-auto">
          {disclosures.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No disclosures recorded.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Agency</TableHead>
                  <TableHead>Law or order</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>What was disclosed</TableHead>
                  <TableHead>Person told</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {disclosures.data.map((d) => (
                  <TableRow key={d.id} data-testid={`disclosure-${d.id}`}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {when(d.disclosedAt)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {d.agency}
                      {d.reference && (
                        <span className="block font-mono text-[10px] text-muted-foreground">
                          {d.reference}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {d.requestType
                          ? REQUEST_TYPE_LABEL[d.requestType]
                          : "Kind not recorded"}
                      </span>
                      {d.legalBasis}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {d.subjectEmail ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {d.categories && d.categories.length > 0 && (
                        <span className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          {d.categories
                            .map((c) => CATEGORY_LABEL[c] ?? c)
                            .join(", ")}
                        </span>
                      )}
                      {d.informationDisclosed}
                    </TableCell>
                    <TableCell className="text-xs">
                      {d.personToldAt ? (
                        when(d.personToldAt)
                      ) : (
                        <span className="text-muted-foreground">
                          Not told: {d.notTellingReason}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>
      {isAdmin && <LegalHolds />}
    </div>
  );
}
