import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useGetSecurityControls,
  getGetSecurityControlsQueryKey,
  type SecurityControl,
} from "@workspace/api-client-react";
import { Card, Badge, Button } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import {
  SECURITY_FEATURE_AREAS,
  SECURITY_FEATURE_COUNT,
  type SecurityFeature,
} from "../lib/securityFeatures";
import {
  Radar,
  Loader2,
  KeyRound,
  Database,
  Activity,
  Globe,
  Bot,
  ShieldCheck,
  Users,
  CreditCard,
  Scale,
  Smartphone,
  GitBranch,
  Search,
  ChevronRight,
} from "lucide-react";

// Every security feature (lib/securityFeatures.ts), and every backend control's live state
// (GET /security/controls, lib/securityControls.ts): what the server does that no other screen
// shows, such as limits, keys, scanning and headers.
const AREA_ICONS: Record<string, React.ElementType> = {
  "sign-in": KeyRound,
  access: Users,
  data: Database,
  hardening: Globe,
  payments: CreditCard,
  monitoring: Activity,
  privacy: Scale,
  ai: Bot,
  mobile: Smartphone,
  pipeline: GitBranch,
  assurance: ShieldCheck,
};

const STATUS = {
  on: { label: "Active", variant: "success" },
  partial: { label: "Limited here", variant: "warning" },
  off: { label: "Off", variant: "destructive" },
} as const;

function WhereToSee({
  where,
  label,
}: {
  where?: string | null;
  label?: string | null;
}) {
  if (!label) return null;
  return where ? (
    <Link href={where}>
      <span className="text-xs font-mono text-primary hover:underline cursor-pointer">
        See it: {label} →
      </span>
    </Link>
  ) : (
    <p className="text-xs font-mono text-muted-foreground">See it: {label}</p>
  );
}

function ControlCard({ control }: { control: SecurityControl }) {
  const status = STATUS[control.status];
  return (
    <Card className="space-y-3" data-testid={`control-${control.id}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-mono font-bold text-sm uppercase tracking-wider text-foreground">
          {control.name}
        </h3>
        <Badge variant={status.variant} className="shrink-0">
          {status.label}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{control.summary}</p>
      {control.evidence.length > 0 && (
        <dl className="divide-y divide-border/60 border-t border-border/60">
          {control.evidence.map((e) => (
            <div
              key={e.label}
              className="flex flex-col gap-1 py-1.5 sm:flex-row sm:justify-between sm:gap-4"
            >
              <dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {e.label}
              </dt>
              <dd className="font-mono text-xs text-foreground break-words sm:text-right">
                {e.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <WhereToSee where={control.where} label={control.whereLabel} />
    </Card>
  );
}

// Backticks in a feature's `how` mark code: set in the code face here, and code spans in docs/13.
function WithCode({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          <code key={`${i}:${part}`} className="font-mono text-[12px]">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

function FeatureCard({
  number,
  feature,
  control,
  defaultOpen,
}: {
  number: number;
  feature: SecurityFeature;
  control: SecurityControl | undefined;
  defaultOpen: boolean;
}) {
  const status = control ? STATUS[control.status] : null;
  const [open, setOpen] = useState(defaultOpen);
  const howId = `feature-${number}-how`;
  return (
    <Card className="space-y-2 p-5" data-testid={`feature-${number}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-mono font-bold text-sm text-foreground">
          <span className="text-primary mr-2 tabular-nums">{number}.</span>
          {feature.name}
        </h3>
        {status && (
          <Badge
            variant={status.variant}
            className="shrink-0"
            title={`Live check: ${control!.name}`}
          >
            {status.label}
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{feature.detail}</p>
      <WhereToSee where={feature.where} label={feature.whereLabel} />
      <button
        type="button"
        aria-expanded={open}
        aria-controls={howId}
        onClick={() => setOpen((o) => !o)}
        data-testid={`feature-${number}-how-toggle`}
        className="flex min-h-6 items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`}
        />
        How it's built
      </button>
      <div
        id={howId}
        hidden={!open}
        className="space-y-2 border-t border-border/60 pt-3"
      >
        <p className="text-sm text-foreground break-words">
          <WithCode text={feature.how} />
        </p>
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Code
        </p>
        <ul className="space-y-1">
          {feature.code.map((file) => (
            <li
              key={file}
              className="font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]"
            >
              {/* Long paths wrap after a slash rather than mid-name. */}
              {file.split("/").map((segment, i) => (
                <React.Fragment key={`${i}:${segment}`}>
                  {i > 0 && (
                    <>
                      /<wbr />
                    </>
                  )}
                  {segment}
                </React.Fragment>
              ))}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function AllFeatures({ controls }: { controls: Map<string, SecurityControl> }) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const numbered = useMemo(() => {
    let n = 0;
    return SECURITY_FEATURE_AREAS.map((area) => ({
      ...area,
      features: area.features.map((feature) => ({ feature, number: ++n })),
    }));
  }, []);
  const q = query.trim().toLowerCase();
  // A feature found only through how it's built (a file name, say) opens, so the match is visible.
  const visible = numbered
    .map((area) => ({
      ...area,
      features: area.features
        .map(({ feature, number }) => {
          const summary = `${area.title} ${feature.name} ${feature.detail}`;
          const built = `${feature.how.replaceAll("`", "")} ${feature.code.join(" ")}`;
          const inSummary = summary.toLowerCase().includes(q);
          return {
            feature,
            number,
            matches: !q || inSummary || built.toLowerCase().includes(q),
            matchedInside: !!q && !inSummary,
          };
        })
        .filter((f) => f.matches),
    }))
    .filter((area) => area.features.length > 0);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex flex-1 items-center gap-2 border border-border bg-card px-3 py-2 max-w-md">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              id="security-feature-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search features and code, e.g. refund, bcrypt"
              className="w-full bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={showAll}
            onClick={() => setShowAll((s) => !s)}
            data-testid="security-features-show-how"
          >
            {showAll ? "Hide how each is built" : "Show how each is built"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {numbered.map((area) => (
            <button
              key={area.id}
              type="button"
              onClick={() =>
                document
                  .getElementById(`area-${area.id}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="font-mono text-[11px] uppercase tracking-wider border border-border px-2 py-1 text-muted-foreground hover:text-primary hover:border-primary transition-colors"
            >
              {area.title} ({area.features.length})
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 && (
        <p className="font-mono text-sm text-muted-foreground">
          No feature matches "{query}".
        </p>
      )}
      {visible.map((area) => {
        const Icon = AREA_ICONS[area.id] ?? ShieldCheck;
        return (
          <section
            key={area.id}
            id={`area-${area.id}`}
            className="space-y-3 scroll-mt-24"
          >
            <h2 className="font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
              <Icon className="w-5 h-5 text-primary" /> {area.title}
              <span className="text-muted-foreground font-normal">
                ({area.features.length})
              </span>
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {area.features.map(({ feature, number, matchedInside }) => (
                // The key resets a card to the new default when "show all" or the match changes.
                <FeatureCard
                  key={`${number}-${showAll}-${matchedInside}`}
                  number={number}
                  feature={feature}
                  control={
                    feature.controlId
                      ? controls.get(feature.controlId)
                      : undefined
                  }
                  defaultOpen={showAll || matchedInside}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function SecurityCenter() {
  const { user } = useAuth();
  const isStaff = user?.role === "security_analyst" || user?.role === "admin";
  const [tab, setTab] = useState<"features" | "live">("features");
  const report = useGetSecurityControls({
    query: { queryKey: getGetSecurityControlsQueryKey(), enabled: isStaff },
  });

  if (!isStaff) {
    return (
      <div className="p-6 border border-border font-mono text-sm text-muted-foreground">
        The Security Center is for security analysts and administrators.
      </div>
    );
  }

  const sections = report.data?.sections ?? [];
  const liveControls = sections.flatMap((s) => s.controls);
  const byId = new Map(liveControls.map((c) => [c.id, c]));
  const count = (status: SecurityControl["status"]) =>
    liveControls.filter((c) => c.status === status).length;
  const tabs = [
    {
      id: "features" as const,
      label: `All ${SECURITY_FEATURE_COUNT} features`,
    },
    {
      id: "live" as const,
      label: `Live checks (${liveControls.length || "…"})`,
    },
  ];

  let liveContent: React.ReactNode;
  if (report.isLoading) {
    liveContent = (
      <div className="py-16 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  } else if (report.error || !report.data) {
    liveContent = (
      <div className="p-6 bg-destructive/10 text-destructive border border-destructive/30 font-mono">
        Could not load the live checks.
      </div>
    );
  } else {
    liveContent = sections.map((section) => {
      const Icon = AREA_ICONS[section.id] ?? ShieldCheck;
      return (
        <section key={section.id} className="space-y-3">
          <h2 className="font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
            <Icon className="w-5 h-5 text-primary" /> {section.title}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {section.controls.map((control) => (
              <ControlCard key={control.id} control={control} />
            ))}
          </div>
        </section>
      );
    });
  }

  return (
    <div className="space-y-8">
      <div className="border-b border-border pb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-3">
            <Radar className="w-8 h-8 text-primary shrink-0" />
            Security Center
          </h1>
          <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-2">
            {SECURITY_FEATURE_COUNT} security features, how each is built, and
            the server's own live checks
          </p>
          {report.data && (
            <div className="flex flex-wrap gap-2 mt-4">
              <Badge variant="success">{count("on")} active</Badge>
              {count("partial") > 0 && (
                <Badge variant="warning">{count("partial")} limited here</Badge>
              )}
              {count("off") > 0 && (
                <Badge variant="destructive">{count("off")} off</Badge>
              )}
            </div>
          )}
        </div>
        {report.data && (
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-muted-foreground">
              Checked {new Date(report.data.generatedAt).toLocaleTimeString()}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => report.refetch()}
              isLoading={report.isFetching}
              data-testid="security-center-refresh"
            >
              Check again
            </Button>
          </div>
        )}
      </div>

      <div role="tablist" className="flex gap-2 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            data-testid={`security-center-tab-${t.id}`}
            className={`font-mono text-xs uppercase tracking-widest px-4 py-2 -mb-px border-b-2 transition-colors ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "features" ? <AllFeatures controls={byId} /> : liveContent}
    </div>
  );
}
