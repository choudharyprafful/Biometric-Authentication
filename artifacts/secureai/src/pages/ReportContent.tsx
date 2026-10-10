import React, { useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, UserX } from "lucide-react";
import {
  useReportContentShowingMe,
  type BystanderReportInputRelationship,
  type BystanderReportInputRequest,
  type BystanderReportReceipt,
} from "@workspace/api-client-react";
import { Button, Card, Input, Label } from "../components/ui";
import { Textarea } from "../components/ui/textarea";

// Team 2's Bystander Consent Policy, section 6: someone who appears in another person's upload can
// ask for it to be reviewed or removed without an account. Public, like /ai and /privacy, and linked
// from the sign-in page and privacy policy section 5. The API side is routes/bystanderReports.ts.

const RELATIONSHIPS: {
  value: BystanderReportInputRelationship;
  label: string;
}[] = [
  { value: "self", label: "Me" },
  {
    value: "parent-or-guardian",
    label: "My child, or someone under 18 I'm the parent or guardian of",
  },
];

const REQUESTS: {
  value: BystanderReportInputRequest;
  label: string;
}[] = [
  { value: "removal", label: "Remove it" },
  { value: "review", label: "Review it, and stop it being used" },
];

const STEPS = [
  [
    "We find the file",
    "Staff match your description to a file in SecureAI. Anything that helps, such as who you think uploaded it, makes this quicker.",
  ],
  [
    "We pause it",
    "The file stays stored, but no SecureAI feature uses it while we review your report.",
  ],
  [
    "We tell the person who uploaded it",
    "They're told that someone in one of their files asked us to review it, and what happens next. We don't give them your name or email.",
  ],
  [
    "We decide, and reply to you",
    "If the file should go, we delete it. If the law requires us to keep a copy, for example under a court order, it's kept separately until that ends.",
  ],
] as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ReportContent() {
  const report = useReportContentShowingMe();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [relationship, setRelationship] =
    useState<BystanderReportInputRelationship | null>(null);
  const [request, setRequest] = useState<BystanderReportInputRequest | null>(
    null,
  );
  const [description, setDescription] = useState("");
  const [uploaderHint, setUploaderHint] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<BystanderReportReceipt | null>(null);

  const ready =
    EMAIL.test(email.trim()) &&
    relationship !== null &&
    request !== null &&
    description.trim().length >= 10;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setError("");
    try {
      setReceipt(
        await report.mutateAsync({
          data: {
            reporterEmail: email.trim(),
            reporterName: name.trim() || null,
            relationship,
            request,
            contentDescription: description.trim(),
            uploaderHint: uploaderHint.trim() || null,
          },
        }),
      );
    } catch (err: any) {
      setError(
        err?.data?.error ||
          "Your report wasn't sent. Check your connection and try again.",
      );
    }
  };

  const startAgain = () => {
    setReceipt(null);
    setRelationship(null);
    setRequest(null);
    setDescription("");
    setUploaderHint("");
  };

  return (
    <div className="space-y-8 max-w-3xl" data-testid="report-content">
      <div className="border-b border-border pb-6">
        <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-3">
          <UserX className="w-8 h-8 text-primary shrink-0" />
          Report content that shows you
        </h1>
        <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-2">
          No account needed
        </p>
      </div>

      <p className="text-sm text-foreground leading-relaxed">
        If someone uploaded a photo, video, recording or piece of writing to
        SecureAI that shows you, names you or describes you, or your child, you
        can ask us to review it or remove it. You don't need a SecureAI account.
      </p>

      <section className="space-y-3">
        <h2 className="font-mono font-bold uppercase tracking-widest text-foreground">
          What happens next
        </h2>
        <ol className="space-y-3">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="flex gap-3">
              <span className="font-mono text-sm text-primary w-5 shrink-0">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {text}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {receipt ? (
        <Card className="space-y-3" data-testid="report-receipt">
          <p className="flex items-center gap-2 font-mono text-sm uppercase tracking-wider text-foreground">
            <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
            Report received
          </p>
          <p className="text-sm text-foreground">
            Your reference is{" "}
            <span
              className="font-mono font-bold"
              data-testid="report-reference"
            >
              #{receipt.reference}
            </span>
            , received {new Date(receipt.receivedAt).toLocaleString()}. Quote it
            if you write to us about this report. We'll reply to{" "}
            <span className="font-mono">{email.trim()}</span>.
          </p>
          <Button variant="outline" size="sm" onClick={startAgain}>
            Report something else
          </Button>
        </Card>
      ) : (
        <Card>
          <form className="space-y-5" onSubmit={submit} noValidate>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-2">
                Who does it show or name?
              </legend>
              {RELATIONSHIPS.map((r) => (
                <label
                  key={r.value}
                  className="flex items-start gap-2 text-sm text-foreground"
                >
                  <input
                    type="radio"
                    name="report-relationship"
                    id={`report-relationship-${r.value}`}
                    className="mt-1"
                    checked={relationship === r.value}
                    onChange={() => setRelationship(r.value)}
                  />
                  {r.label}
                </label>
              ))}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-2">
                What are you asking for?
              </legend>
              {REQUESTS.map((r) => (
                <label
                  key={r.value}
                  className="flex items-start gap-2 text-sm text-foreground"
                >
                  <input
                    type="radio"
                    name="report-request"
                    id={`report-request-${r.value}`}
                    className="mt-1"
                    checked={request === r.value}
                    onChange={() => setRequest(r.value)}
                  />
                  {r.label}
                </label>
              ))}
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="report-description">
                What does it show, and where did you see it?
              </Label>
              <Textarea
                id="report-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="For example: a photo of me at a party on 12 September, which a friend showed me on their phone"
              />
              <p className="text-xs text-muted-foreground">
                At least 10 characters. Don't send us the file itself.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="report-uploader">
                Who do you think uploaded it? (optional)
              </Label>
              <Input
                id="report-uploader"
                value={uploaderHint}
                onChange={(e) => setUploaderHint(e.target.value)}
                maxLength={500}
                placeholder="Their name or email, if you know it"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="report-email">Your email</Label>
                <Input
                  id="report-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={320}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-name">Your name (optional)</Label>
                <Input
                  id="report-name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              We use what you give us only to handle this report and reply to
              you. Our security staff can see it; the person who uploaded the
              file can't. We keep the report for 2 years after it's closed, so
              the decision can be checked later, then delete it. More in our{" "}
              <Link href="/privacy#other-people">
                <span className="text-primary underline underline-offset-2 cursor-pointer">
                  privacy policy
                </span>
              </Link>
              .
            </p>

            {error && (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}

            <Button
              type="submit"
              isLoading={report.isPending}
              disabled={!ready}
              data-testid="button-send-report"
            >
              Send report
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
