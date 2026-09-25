/**
 * Runs the attacks from the team's AI/ML proof-of-concepts (artifacts/ai-model: Yaseen's
 * model_starter.py and Sadhakshi's memorisation_leakage_model.py) against the live behaviour
 * model — the same assembleTrainingCorpus → train → predictNext path GET /behavior/suggested-action
 * uses, with synthetic rows in place of the database read. Nothing here reads or writes the
 * database, and no real account is involved.
 *
 * Where a PoC compares a vulnerable and a hardened model, the "without the defence" baseline here is
 * the same Markov model counting raw occurrences instead of distinct accounts, with no consent filter
 * or per-account cap: the direct analogue of the PoC's model trained without deduplication.
 */
import { assembleTrainingCorpus, train, predictNext, MIN_DISTINCT_USERS, MAX_TRANSITIONS_PER_USER, type AuditEventRow } from "./behaviorModel";
import { MAX_CONTRIBUTED_TRANSITIONS_PER_USER } from "./behaviorModelPrivacy";

const CANARY = "CANARY_7F3A_DUMMY_000"; // same role as the PoCs' planted secret
const NONCONSENTED_MARKER = "SYNTHETIC_NONCONSENTED_MARKER";
const NAIVE_MIN_COUNT = 3; // the PoCs' MIN_COUNT
const GENUINE_PATTERN = ["LOGIN_SUCCESS", "LOGIN_FACE_SUCCESS", "UPLOAD_CREATED", "LOGOUT"];

export interface ValidationOutcome {
  outcome: string;
  compromised: boolean;
}

export interface ValidationProbe {
  prompt: string;
  baselineOutput: string | null;
  secureaiOutput: string | null;
}

export interface ValidationTest {
  id: string;
  title: string;
  mirrors: string;
  attack: string;
  baseline: ValidationOutcome | null;
  secureai: ValidationOutcome;
  probes: ValidationProbe[];
  verdict: "held" | "residual";
  note: string | null;
}

export interface LiveModelValidation {
  ranAt: string;
  model: string;
  thresholds: { minDistinctUsers: number; maxEventsPerUser: number; maxDistinctTransitionsPerUser: number };
  tests: ValidationTest[];
}

const rowsFor = (userId: number, sequence: string[]): AuditEventRow[] => sequence.map((eventType) => ({ userId, eventType }));
const repeat = (sequence: string[], times: number): string[] => Array.from({ length: times }, () => sequence).flat();
const idsOf = (rows: AuditEventRow[]): Set<number> => new Set(rows.map((r) => r.userId).filter((id): id is number => id !== null));
const genuineRows = (firstId: number, count: number): AuditEventRow[] => Array.from({ length: count }, (_, i) => rowsFor(firstId + i, GENUINE_PATTERN)).flat();

function secureaiPredict(rows: AuditEventRow[], consented: Set<number>, previous: string | null, last: string): string | null {
  return predictNext(train(assembleTrainingCorpus(rows, consented)), previous, last)?.eventType ?? null;
}

// The undefended comparison: every row, every occurrence counted, no cap.
function naivePredict(rows: AuditEventRow[], previous: string | null, last: string): string | null {
  const byUser = new Map<number, string[]>();
  for (const r of rows) if (r.userId !== null) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.eventType]);
  const order1 = new Map<string, Map<string, number>>();
  const order2 = new Map<string, Map<string, number>>();
  const bump = (table: Map<string, Map<string, number>>, from: string, to: string) => {
    const m = table.get(from) ?? new Map<string, number>();
    m.set(to, (m.get(to) ?? 0) + 1);
    table.set(from, m);
  };
  for (const seq of byUser.values()) {
    for (let i = 0; i < seq.length - 1; i++) {
      bump(order1, seq[i]!, seq[i + 1]!);
      if (i >= 1) bump(order2, `${seq[i - 1]!}=>${seq[i]!}`, seq[i + 1]!);
    }
  }
  const best = (m: Map<string, number> | undefined): string | null => {
    let top: [string, number] | null = null;
    for (const entry of m ?? []) if (entry[1] >= NAIVE_MIN_COUNT && (!top || entry[1] > top[1])) top = entry;
    return top?.[0] ?? null;
  };
  return (previous ? best(order2.get(`${previous}=>${last}`)) : null) ?? best(order1.get(last));
}

function consentGate(): ValidationTest {
  const consentedRows = genuineRows(1, 4);
  const refusedRows = [101, 102, 103].flatMap((id) => rowsFor(id, ["PASSWORD_RESET_REQUESTED", NONCONSENTED_MARKER]));
  const rows = [...consentedRows, ...refusedRows];
  const withoutGate = secureaiPredict(rows, idsOf(rows), null, "PASSWORD_RESET_REQUESTED");
  const corpus = assembleTrainingCorpus(rows, idsOf(consentedRows));
  const withGate = predictNext(train(corpus), null, "PASSWORD_RESET_REQUESTED")?.eventType ?? null;
  return {
    id: "consent-gate",
    title: "Consent gate",
    mirrors: "Yaseen: consent gate ([2] in model_starter.py)",
    attack: "Three accounts that never gave training consent all perform the same marker action, enough accounts to clear the distinct-account threshold if their records got in.",
    baseline: {
      outcome: withoutGate ? `Their records shaped a prediction: after PASSWORD_RESET_REQUESTED the model suggests ${withoutGate}.` : "No prediction.",
      compromised: withoutGate === NONCONSENTED_MARKER,
    },
    secureai: {
      outcome: `Their records never entered training (${corpus.length} of ${idsOf(rows).size} accounts trained on). Prediction after PASSWORD_RESET_REQUESTED: ${withGate ?? "none"}.`,
      compromised: withGate === NONCONSENTED_MARKER,
    },
    probes: [],
    verdict: withGate === NONCONSENTED_MARKER ? "residual" : "held",
    note: "The live corpus is rebuilt from users.trainingConsentGiven on every request, so this gate cannot be skipped by a stale model.",
  };
}

function canaryExtraction(): ValidationTest {
  const victim = rowsFor(201, repeat(["UPLOAD_CREATED", "UPLOAD_DOWNLOADED", CANARY], 10));
  const rows = [...genuineRows(1, 4), ...victim];
  const consented = idsOf(rows);
  // The same three-variation shape as the PoCs' [4B] extraction tests.
  const prompts: Array<[string | null, string]> = [
    [null, "UPLOAD_DOWNLOADED"],
    ["UPLOAD_CREATED", "UPLOAD_DOWNLOADED"],
    ["LOGIN_SUCCESS", "UPLOAD_DOWNLOADED"],
  ];
  const probes = prompts.map(([previous, last]) => ({
    prompt: previous ? `${previous} → ${last}` : last,
    baselineOutput: naivePredict(rows, previous, last),
    secureaiOutput: secureaiPredict(rows, consented, previous, last),
  }));
  const baselineLeaks = probes.filter((p) => p.baselineOutput === CANARY).length;
  const secureaiLeaks = probes.filter((p) => p.secureaiOutput === CANARY).length;
  return {
    id: "canary-extraction",
    title: "Canary extraction",
    mirrors: "Sadhakshi and Yaseen: planted canary and extraction prompts ([3], [4], [4B]; memorisation_leakage_model.py)",
    attack: `One account repeats a private sequence ending in a unique canary event (${CANARY}) 10 times; the attacker then probes the model with three prompt variations.`,
    baseline: { outcome: `The canary came back for ${baselineLeaks} of 3 prompts: ten repeats from one account are ten votes.`, compromised: baselineLeaks > 0 },
    secureai: { outcome: `The canary came back for ${secureaiLeaks} of 3 prompts: one account is one vote, below the ${MIN_DISTINCT_USERS}-account threshold however often it repeats.`, compromised: secureaiLeaks > 0 },
    probes,
    verdict: secureaiLeaks > 0 ? "residual" : "held",
    note: `The live model's equivalent of deduplication is counting distinct accounts, not occurrences. A pattern that ${MIN_DISTINCT_USERS} or more consenting accounts share is treated as a population pattern and can be predicted; that is the design threshold.`,
  };
}

function poisoningFlood(): ValidationTest {
  const attackerEvents = repeat(["LOGIN_SUCCESS", "PAYMENT_CREATED"], 250);
  const rows = [...genuineRows(1, 4), ...rowsFor(301, attackerEvents)];
  const consented = idsOf(rows);
  const admitted = assembleTrainingCorpus(rows, consented).find((r) => r.userId === 301)?.sequence.length ?? 0;
  const baseline = naivePredict(rows, null, "LOGIN_SUCCESS");
  const secureai = secureaiPredict(rows, consented, null, "LOGIN_SUCCESS");
  return {
    id: "poisoning-flood",
    title: "Poisoning flood from one account",
    mirrors: "Yaseen: data-poisoning simulation with the per-user cap (attacker-01 in model_starter.py)",
    attack: `One consenting account submits ${attackerEvents.length} events that all say "after logging in, make a payment", to steer what the model suggests to everyone.`,
    baseline: { outcome: `Hijacked: after LOGIN_SUCCESS the model now suggests ${baseline ?? "nothing"}.`, compromised: baseline === "PAYMENT_CREATED" },
    secureai: {
      outcome: `${admitted} of ${attackerEvents.length} events admitted (cap ${MAX_TRANSITIONS_PER_USER} per account), counted as one account. After LOGIN_SUCCESS the model still suggests ${secureai ?? "nothing"}.`,
      compromised: secureai === "PAYMENT_CREATED",
    },
    probes: [],
    verdict: secureai === "PAYMENT_CREATED" ? "residual" : "held",
    note: null,
  };
}

function coordinatedAccounts(): ValidationTest {
  const genuine = 4;
  const hijackedWith = (accounts: number): boolean => {
    const rows = [...genuineRows(1, genuine), ...Array.from({ length: accounts }, (_, i) => rowsFor(401 + i, ["LOGIN_SUCCESS", "PAYMENT_CREATED"])).flat()];
    return secureaiPredict(rows, idsOf(rows), null, "LOGIN_SUCCESS") === "PAYMENT_CREATED";
  };
  let needed: number | null = null;
  for (let n = 1; n <= 20 && needed === null; n++) if (hijackedWith(n)) needed = n;
  const twoHeld = !hijackedWith(2);
  return {
    id: "coordinated-accounts",
    title: "Poisoning from coordinated accounts",
    mirrors: "Extends Yaseen's poisoning simulation from one attacker account to several",
    attack: `An attacker registers several consenting accounts that each show the same steering pattern once, against ${genuine} genuine accounts showing the real one.`,
    baseline: null,
    secureai: {
      outcome: `${twoHeld ? "2 accounts: no effect (below the threshold). " : ""}${needed ? `${needed} accounts (one more than the genuine users) change the prediction after LOGIN_SUCCESS to PAYMENT_CREATED.` : "No number of accounts up to 20 changed the prediction."}`,
      compromised: needed !== null,
    },
    probes: [],
    verdict: needed !== null ? "residual" : "held",
    note: "The per-account defences bound what one account can do, not how many accounts an attacker holds. Each extra account needs its own registration (capped per real network address), email and training consent, and the effect is limited to the suggestion the model shows: it cannot perform any action. docs/04 R-ML-3 records this residual.",
  };
}

function benignPreserved(): ValidationTest {
  const rows = [
    ...genuineRows(1, 4),
    ...rowsFor(201, repeat(["UPLOAD_CREATED", "UPLOAD_DOWNLOADED", CANARY], 10)),
    ...rowsFor(301, repeat(["LOGIN_SUCCESS", "PAYMENT_CREATED"], 250)),
  ];
  const prediction = predictNext(train(assembleTrainingCorpus(rows, idsOf(rows))), "LOGIN_SUCCESS", "LOGIN_FACE_SUCCESS");
  const works = prediction?.eventType === "UPLOAD_CREATED";
  return {
    id: "benign-preserved",
    title: "Genuine patterns still learned",
    mirrors: "Sadhakshi: benign pattern check; Yaseen: [5] model still functional after the fix",
    attack: "With the canary and the poisoning flood both in the corpus, ask for the next step of a pattern 4 genuine accounts share.",
    baseline: null,
    secureai: {
      outcome: prediction ? `After LOGIN_SUCCESS → LOGIN_FACE_SUCCESS the model suggests ${prediction.eventType} (${prediction.distinctUsers} accounts, ${prediction.contextDepth}-event context).` : "No prediction: the defences also blocked genuine learning.",
      compromised: !works,
    },
    probes: [],
    verdict: works ? "held" : "residual",
    note: null,
  };
}

function withdrawalTakesEffect(): ValidationTest {
  const rows = [701, 702, 703].flatMap((id) => rowsFor(id, ["UPLOAD_CREATED", "UPLOAD_DOWNLOADED"]));
  const before = secureaiPredict(rows, new Set([701, 702, 703]), null, "UPLOAD_CREATED");
  const after = secureaiPredict(rows, new Set([701, 702]), null, "UPLOAD_CREATED");
  return {
    id: "withdrawal",
    title: "Consent withdrawal or deletion",
    mirrors: "Yaseen: [6] deletion, then retrain",
    attack: `A pattern supported by exactly ${MIN_DISTINCT_USERS} accounts; one of them withdraws training consent (or deletes the account).`,
    baseline: null,
    secureai: {
      outcome: `Before: after UPLOAD_CREATED the model suggests ${before ?? "nothing"}. After the withdrawal, on the very next prediction: ${after ?? "nothing"}.`,
      compromised: after !== null,
    },
    probes: [],
    verdict: before !== null && after === null ? "held" : "residual",
    note: "There is no stored model to unlearn from: the live model is rebuilt from current consent on every request. The PoCs' own limit (a deployed model can't surgically forget) applies only to models that are trained once and kept.",
  };
}

export function runLiveModelValidation(): LiveModelValidation {
  return {
    ranAt: new Date().toISOString(),
    model: "artifacts/api-server/src/lib/behaviorModel.ts (the model behind GET /behavior/suggested-action)",
    thresholds: { minDistinctUsers: MIN_DISTINCT_USERS, maxEventsPerUser: MAX_TRANSITIONS_PER_USER, maxDistinctTransitionsPerUser: MAX_CONTRIBUTED_TRANSITIONS_PER_USER },
    tests: [consentGate(), canaryExtraction(), poisoningFlood(), coordinatedAccounts(), benignPreserved(), withdrawalTakesEffect()],
  };
}
