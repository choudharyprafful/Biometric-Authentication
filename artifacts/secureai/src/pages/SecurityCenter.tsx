import React from "react";
import { Link } from "wouter";
import {
  useGetSecurityControls,
  getGetSecurityControlsQueryKey,
  type SecurityControl,
} from "@workspace/api-client-react";
import { Card, Badge, Button } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import {
  Radar,
  Loader2,
  KeyRound,
  Database,
  Activity,
  Globe,
  Bot,
  ShieldCheck,
} from "lucide-react";

// Every backend control's live state (GET /security/controls, lib/securityControls.ts), for
// showing what the server does that no other screen shows: limits, keys, scanning, headers.
const SECTION_ICONS: Record<string, React.ElementType> = {
  "sign-in": KeyRound,
  data: Database,
  monitoring: Activity,
  hardening: Globe,
  ai: Bot,
  assurance: ShieldCheck,
};

const STATUS = {
  on: { label: "Active", variant: "success" },
  partial: { label: "Limited here", variant: "warning" },
  off: { label: "Off", variant: "destructive" },
} as const;

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
      {control.whereLabel &&
        (control.where ? (
          <Link href={control.where}>
            <span className="text-xs font-mono text-primary hover:underline cursor-pointer">
              See it: {control.whereLabel} →
            </span>
          </Link>
        ) : (
          <p className="text-xs font-mono text-muted-foreground">
            See it: {control.whereLabel}
          </p>
        ))}
    </Card>
  );
}

export default function SecurityCenter() {
  const { user } = useAuth();
  const isStaff = user?.role === "security_analyst" || user?.role === "admin";
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
  if (report.isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }
  if (report.error || !report.data) {
    return (
      <div className="p-6 bg-destructive/10 text-destructive border border-destructive/30 font-mono">
        Could not load the Security Center.
      </div>
    );
  }

  const { sections, generatedAt } = report.data;
  const controls = sections.flatMap((s) => s.controls);
  const count = (status: SecurityControl["status"]) =>
    controls.filter((c) => c.status === status).length;

  return (
    <div className="space-y-8">
      <div className="border-b border-border pb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-3">
            <Radar className="w-8 h-8 text-primary shrink-0" />
            Security Center
          </h1>
          <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-2">
            Every protection the server runs, checked live
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Badge variant="success">{count("on")} active</Badge>
            {count("partial") > 0 && (
              <Badge variant="warning">{count("partial")} limited here</Badge>
            )}
            {count("off") > 0 && (
              <Badge variant="destructive">{count("off")} off</Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground">
            Checked {new Date(generatedAt).toLocaleTimeString()}
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
      </div>

      {sections.map((section) => {
        const Icon = SECTION_ICONS[section.id] ?? ShieldCheck;
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
      })}
    </div>
  );
}
