/**
 * Verifies the differential-privacy mechanism in
 * artifacts/api-server/src/lib/behaviorModelPrivacy.ts against measured
 * behaviour rather than against the fact that it compiles.
 *
 * Permanent rather than throwaway because the two things most likely to
 * silently void a DP guarantee are both invisible to code review and to a
 * typecheck: a noise sampler that stops being Laplace-shaped (a refactor to
 * Math.random, say), and a sensitivity bound that stops being enforced after
 * an unrelated change to train(). Both would leave a mechanism that still
 * looks correct, still runs, and no longer protects anything. Section [3]
 * measures the actual leak rate of a planted single-user canary over 20k
 * randomised releases and fails if it exceeds the design budget.
 *
 * Run: pnpm --filter @workspace/api-server run verify:dp
 * Needs no server and no database — operates on synthetic corpora.
 *
 * Lives beside the code it tests rather than in scripts/, which is for probes
 * that drive a RUNNING server over HTTP. This is a unit-level check of pure
 * functions, so it belongs in this package where the typechecker covers it.
 * Not reachable from src/index.ts, so esbuild never bundles it into dist.
 */
// Marks this file as a module. It has no static imports (see below), and
// without this TypeScript treats it as a script, where top-level await is an
// error.
export {};

// behaviorModel.ts is pure, but its module graph includes the db layer, which
// throws at import time if DATABASE_URL is absent. This test issues no queries,
// so a placeholder satisfies that check without opening a connection (the pool
// is lazy). Set before a DYNAMIC import, because static imports are hoisted and
// would run first. Testing the real train() matters more than avoiding this.
process.env["DATABASE_URL"] ??= "postgresql://unused@127.0.0.1:1/unused";

const { train, MIN_DISTINCT_USERS } = await import("./behaviorModel");
type TrainingRecord = Awaited<ReturnType<typeof import("./behaviorModel").buildTrainingCorpus>>[number];
const {
  sampleLaplace,
  deriveParameters,
  applyDifferentialPrivacy,
  privacyReport,
  MAX_CONTRIBUTED_TRANSITIONS_PER_USER,
  minimumUsersForEpsilon,
  minimumEpsilonForUsers,
} = await import("./behaviorModelPrivacy");

let failures = 0;
function check(label: string, pass: boolean, detail: string): void {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}\n        ${detail}`);
  if (!pass) failures += 1;
}

// ---------------------------------------------------------------------------
console.log("\n[1] Laplace sampler statistical properties");
// Laplace(0,b) has mean 0 and variance 2b^2. A sampler that silently returned
// something else (e.g. uniform noise) would void the guarantee while looking
// superficially random, so check the shape, not just that it varies.
{
  const b = 4;
  const n = 200_000;
  const samples = Array.from({ length: n }, () => sampleLaplace(b));
  const mean = samples.reduce((a, x) => a + x, 0) / n;
  const variance = samples.reduce((a, x) => a + (x - mean) ** 2, 0) / n;
  const expectedVar = 2 * b * b;

  check("mean ≈ 0", Math.abs(mean) < 0.1, `measured ${mean.toFixed(4)}, expected ~0`);
  check(
    "variance ≈ 2b²",
    Math.abs(variance - expectedVar) / expectedVar < 0.05,
    `measured ${variance.toFixed(2)}, expected ~${expectedVar} (within 5%)`,
  );
  const distinct = new Set(samples.slice(0, 1000)).size;
  check("sampler is not degenerate", distinct > 990, `${distinct}/1000 distinct values`);
}

// ---------------------------------------------------------------------------
console.log("\n[2] Sensitivity cap actually clips a hyperactive account");
{
  // One account cycling through far more distinct transitions than the cap.
  const events: string[] = [];
  for (let i = 0; i < 60; i++) events.push(`EVENT_${i}`);
  const hyperactive: TrainingRecord = { userId: 1, sequence: events };
  const model = train([hyperactive]);

  let cells = 0;
  for (const c of model.transitionsOrder1.values()) cells += c.size;

  check(
    "one account cannot exceed the distinct-transition cap",
    cells <= MAX_CONTRIBUTED_TRANSITIONS_PER_USER,
    `contributed ${cells} distinct order-1 transitions, cap is ${MAX_CONTRIBUTED_TRANSITIONS_PER_USER} ` +
      `(59 were available in its sequence)`,
  );
}

// ---------------------------------------------------------------------------
console.log("\n[3] THE SECURITY TEST — does a single-user canary leak?");
{
  // A transition exhibited by exactly ONE user is precisely what the
  // memorisation defence must never release. Build a corpus where a canary
  // sits at true count 1, alongside a popular transition many users share,
  // then run the randomised release many times and measure the leak rate.
  const records: TrainingRecord[] = [];
  for (let u = 0; u < 20; u++) {
    records.push({ userId: u, sequence: ["LOGIN_SUCCESS", "UPLOAD_CREATED", "LOGOUT"] });
  }
  records.push({ userId: 999, sequence: ["LOGIN_SUCCESS", "CANARY_SECRET_ACTION", "LOGOUT"] });

  const base = train(records);
  const canaryTrue = base.transitionsOrder1.get("LOGIN_SUCCESS")?.get("CANARY_SECRET_ACTION") ?? 0;
  const popularTrue = base.transitionsOrder1.get("LOGIN_SUCCESS")?.get("UPLOAD_CREATED") ?? 0;
  console.log(`        corpus: canary true count = ${canaryTrue}, popular true count = ${popularTrue}`);

  const epsilon = 1.0;
  const params = deriveParameters(epsilon / 2);
  console.log(
    `        ε=${epsilon} → per-table ε=${epsilon / 2}, noise scale b=${params.noiseScale.toFixed(2)}, ` +
      `release threshold=${params.threshold.toFixed(2)}`,
  );

  const trials = 20_000;
  let canaryLeaks = 0;
  for (let t = 0; t < trials; t++) {
    const noised = applyDifferentialPrivacy(base, epsilon);
    if (noised.transitionsOrder1.get("LOGIN_SUCCESS")?.has("CANARY_SECRET_ACTION")) canaryLeaks += 1;
  }
  const leakRate = canaryLeaks / trials;

  check(
    "single-user canary is not released",
    leakRate <= 0.001 * 3, // allow sampling slack around the 0.001 design budget
    `leaked ${canaryLeaks}/${trials} trials = ${(leakRate * 100).toFixed(4)}% (design budget 0.1%)`,
  );

  // The deterministic threshold alone, for comparison: it never releases a
  // count-1 cell either, but it also can't bound what an attacker learns by
  // watching the boundary — which is the gap DP closes.
  const withoutDp = (base.transitionsOrder1.get("LOGIN_SUCCESS")?.get("CANARY_SECRET_ACTION") ?? 0) >= MIN_DISTINCT_USERS;
  check(
    "baseline k-threshold also withholds it (both defences agree)",
    !withoutDp,
    `true count ${canaryTrue} < MIN_DISTINCT_USERS ${MIN_DISTINCT_USERS}, so it is withheld by the deterministic rule too`,
  );
}

// ---------------------------------------------------------------------------
console.log("\n[4] Honest-reporting check — small corpus is reported as unusable");
{
  const small = train([
    { userId: 1, sequence: ["LOGIN_SUCCESS", "UPLOAD_CREATED"] },
    { userId: 2, sequence: ["LOGIN_SUCCESS", "UPLOAD_CREATED"] },
    { userId: 3, sequence: ["LOGIN_SUCCESS", "UPLOAD_CREATED"] },
  ]);
  const report = privacyReport(small, 1.0);
  check(
    "reports a strong-ε/small-corpus combination as unusable rather than fine",
    report.cellsAfterNoise === 0 && report.assessment.includes("NOT usable"),
    `${report.cellsBeforeNoise} cells before noise, ${report.cellsAfterNoise} after — assessment given`,
  );

  const off = privacyReport(small, null);
  check("reports disabled state clearly", off.enabled === false, off.assessment.slice(0, 80) + "...");
}

console.log("\n[5] Usability frontier — what corpus size does each ε actually need?");
{
  console.log("        ε        min distinct users for a releasable transition");
  for (const eps of [0.1, 0.5, 1, 2, 5, 10, 20]) {
    console.log(`        ε=${String(eps).padEnd(6)} ${minimumUsersForEpsilon(eps)}`);
  }
  console.log("\n        corpus   smallest ε that releases a transition at that size");
  for (const n of [10, 20, 50, 100, 1000, 10000]) {
    const e = minimumEpsilonForUsers(n);
    console.log(`        N=${String(n).padEnd(7)} ε ≥ ${e === null ? "unreachable" : e.toFixed(2)}`);
  }
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
