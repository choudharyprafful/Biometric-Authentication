/**
 * Differential privacy for the behaviour model's transition histograms.
 *
 * WHY THIS EXISTS, AND WHAT IT ADDS OVER MIN_DISTINCT_USERS
 *
 * `MIN_DISTINCT_USERS` already refuses to surface a transition seen from
 * fewer than k distinct accounts. That is a k-anonymity-flavoured rule and it
 * is a real defence, but it is a *deterministic* one, and deterministic
 * thresholds leak at the boundary: an attacker who can observe whether a
 * prediction appears, and who can add or remove their own consented account,
 * learns whether the true count sat exactly at k-1 or k. Repeated across many
 * transitions that is a membership-inference channel.
 *
 * Differential privacy closes that channel by construction: the released
 * output is randomised so that any single user's presence or absence changes
 * the probability of any observable outcome by at most a factor of e^ε.
 *
 * THE SENSITIVITY ANALYSIS (the part that has to be right)
 *
 * For a histogram release, the Laplace mechanism needs the L1 sensitivity —
 * the largest total change one user can cause across all cells.
 *
 *   1. `train()` deduplicates per user per table: a user contributes AT MOST
 *      1 to any given cell, however many times they personally exhibited that
 *      transition. So removing a user changes any single cell by at most 1.
 *   2. `MAX_CONTRIBUTED_TRANSITIONS_PER_USER` (enforced in train()) caps how
 *      many DISTINCT cells one user can touch.
 *
 * Together: removing one user decreases at most C cells by at most 1 each, so
 * L1 sensitivity Δ₁ = C. Adding Laplace(Δ₁/ε) noise to every cell therefore
 * satisfies ε-differential privacy for the histogram release. This is the
 * standard bounded-contribution histogram result, not a novel claim.
 *
 * Note that step 1 was already true before this file existed — the
 * per-user dedup was written for the k-anonymity rule. Step 2 is the piece
 * this work added, and it is worth having on its own merits as an
 * anti-poisoning bound (see MAX_CONTRIBUTED_TRANSITIONS_PER_USER).
 *
 * WHY THRESHOLDING ALSO HAD TO CHANGE
 *
 * Noise cuts both ways. Applying noise and then keeping the old
 * `count >= MIN_DISTINCT_USERS` test would be strictly WORSE than no noise:
 * a transition exhibited by exactly one user could be noised upward past the
 * threshold and released — leaking precisely what the threshold exists to
 * protect. So the release rule becomes a stability-based (propose-test-
 * release style) threshold: release only when the NOISY count clears
 * `MIN_DISTINCT_USERS + margin`, where the margin is derived from the Laplace
 * tail so that the probability of releasing a cell whose TRUE count is below
 * k is at most `leakProbability`.
 *
 * HONEST LIMIT — READ THIS BEFORE QUOTING AN ε
 *
 * DP's usefulness depends on the ratio of noise to signal, and this app's
 * consented population is tiny (single digits in development). With counts
 * that small, the noise needed for a strong ε swamps the signal and the model
 * returns almost nothing. That is not a flaw in this implementation; it is a
 * well-known property of DP on small populations. `privacyReport()` below
 * computes the actual numbers for the current corpus so the trade-off can be
 * stated with real figures rather than asserted.
 *
 * Consequently this is DISABLED by default and gated behind
 * `BEHAVIOR_MODEL_DP_EPSILON`, following the same "mechanism built,
 * activation is a deliberate decision" pattern this codebase already uses for
 * retention ceilings and CLAMD_HOST. Enabling it on a small corpus will
 * visibly degrade predictions — which is the honest trade, not a bug.
 */

import crypto from "node:crypto";
import type { BehaviorTransitionModel } from "./behaviorModel";
import { MIN_DISTINCT_USERS } from "./behaviorModel";

/**
 * Caps how many DISTINCT transitions one account can contribute to either
 * table in a single corpus build.
 *
 * Two jobs, and it would be worth having for either one alone:
 *   - Anti-poisoning: bounds the blast radius of a single malicious account.
 *     MAX_TRANSITIONS_PER_USER bounds how many EVENTS one account
 *     contributes; this bounds how many distinct PATTERNS it can influence,
 *     which is the thing that actually shapes predictions.
 *   - It is the L1 sensitivity Δ₁ for the DP analysis above. DP is not
 *     definable without a bound like this.
 *
 * Set well above what ordinary use produces (a normal account cycles through
 * a handful of distinct transitions), so it clips abusive accounts, not
 * legitimate ones.
 */
export const MAX_CONTRIBUTED_TRANSITIONS_PER_USER = 12;

/** Probability budget for the stability threshold: the chance that a cell
 *  whose TRUE distinct-user count is below MIN_DISTINCT_USERS is released
 *  anyway because noise pushed it over. */
export const MAX_LEAK_PROBABILITY = 0.001;

/** Reads the configured privacy budget. Absent/invalid/non-positive = DP off,
 *  which is the default. Smaller ε = stronger privacy = more noise. */
export function readEpsilonFromEnv(): number | null {
  const raw = process.env["BEHAVIOR_MODEL_DP_EPSILON"];
  if (!raw) return null;
  const epsilon = Number(raw);
  return Number.isFinite(epsilon) && epsilon > 0 ? epsilon : null;
}

/**
 * Laplace sample via inverse-CDF, drawn from a CSPRNG rather than
 * Math.random(): predictable noise is not noise. An attacker who can predict
 * the perturbation can subtract it and recover the true count, which would
 * void the guarantee entirely.
 */
export function sampleLaplace(scale: number): number {
  // 53-bit uniform in [0,1) from 8 random bytes, shifted to (-0.5, 0.5].
  const bytes = crypto.randomBytes(8);
  const uint53 = Number(bytes.readBigUInt64BE() >> 11n);
  const uniform = 0.5 - uint53 / 2 ** 53;
  const sign = uniform >= 0 ? 1 : -1;
  // log(0) guard: |uniform| is at most 0.5, so 1 - 2|uniform| is 0 only at
  // the single exact endpoint; clamp keeps it finite.
  return -scale * sign * Math.log(Math.max(1 - 2 * Math.abs(uniform), Number.MIN_VALUE));
}

export interface PrivacyParameters {
  epsilon: number;
  /** L1 sensitivity — see the module comment's analysis. */
  sensitivity: number;
  /** Laplace scale b = Δ₁/ε. */
  noiseScale: number;
  /** Extra headroom above MIN_DISTINCT_USERS the noisy count must clear. */
  threshold: number;
  leakProbability: number;
}

/**
 * Threshold such that P(release | true count ≤ k-1) ≤ leakProbability.
 *
 * For X ~ Laplace(0, b): P(X ≥ t) = ½·exp(−t/b). Releasing a cell with true
 * count (k−1) requires noise ≥ threshold − (k−1), so:
 *
 *   ½·exp(−(threshold − (k−1))/b) ≤ δ
 *   threshold ≥ (k−1) + b·ln(1/(2δ))
 */
export function deriveParameters(epsilon: number, leakProbability = MAX_LEAK_PROBABILITY): PrivacyParameters {
  const sensitivity = MAX_CONTRIBUTED_TRANSITIONS_PER_USER;
  const noiseScale = sensitivity / epsilon;
  const threshold = MIN_DISTINCT_USERS - 1 + noiseScale * Math.log(1 / (2 * leakProbability));
  return { epsilon, sensitivity, noiseScale, threshold, leakProbability };
}

/**
 * Smallest distinct-user count a transition needs before it can clear the
 * noisy release threshold at a given ε — i.e. how big the consented
 * population has to get before this ε is usable at all.
 *
 * Rearranging the threshold from deriveParameters (with per-table ε/2):
 *   N > (k−1) + (2C/ε)·ln(1/(2δ))
 *
 * Exposed because "DP is hard on small populations" is a vague claim, and a
 * specific number is a checkable one. Quoting the ε without also quoting the
 * corpus size it requires would be exactly the kind of half-true guarantee
 * this module is trying not to ship.
 */
export function minimumUsersForEpsilon(epsilon: number, leakProbability = MAX_LEAK_PROBABILITY): number {
  const perTable = deriveParameters(epsilon / 2, leakProbability);
  return Math.ceil(perTable.threshold) + 1;
}

/** The inverse: the smallest ε at which a transition shared by `users`
 *  distinct accounts is releasable. Larger ε = weaker formal guarantee. */
export function minimumEpsilonForUsers(users: number, leakProbability = MAX_LEAK_PROBABILITY): number | null {
  const headroom = users - 1 - (MIN_DISTINCT_USERS - 1);
  if (headroom <= 0) return null; // unreachable at any ε: below the k-anonymity floor itself
  return (2 * MAX_CONTRIBUTED_TRANSITIONS_PER_USER * Math.log(1 / (2 * leakProbability))) / headroom;
}

function noiseTable(table: Map<string, Map<string, number>>, params: PrivacyParameters): Map<string, Map<string, number>> {
  const noised = new Map<string, Map<string, number>>();
  for (const [context, candidates] of table) {
    const noisedCandidates = new Map<string, number>();
    for (const [eventType, count] of candidates) {
      const noisy = count + sampleLaplace(params.noiseScale);
      // Cells that can't clear the stability threshold are dropped entirely
      // rather than carried at a low value: retaining them would let a
      // caller that inspects the model directly (rather than going through
      // predictNext) read a perturbed-but-informative count for a
      // transition too rare to release.
      if (noisy >= params.threshold) noisedCandidates.set(eventType, noisy);
    }
    if (noisedCandidates.size > 0) noised.set(context, noisedCandidates);
  }
  return noised;
}

/**
 * Returns a new model with both histograms perturbed. The budget is split
 * evenly across the two tables because they are two releases derived from the
 * same underlying users: by sequential composition the total spend is the sum,
 * so each table gets ε/2 to keep the overall guarantee at ε.
 */
export function applyDifferentialPrivacy(model: BehaviorTransitionModel, epsilon: number): BehaviorTransitionModel {
  const perTable = deriveParameters(epsilon / 2);
  return {
    ...model,
    transitionsOrder1: noiseTable(model.transitionsOrder1, perTable),
    transitionsOrder2: noiseTable(model.transitionsOrder2, perTable),
  };
}

export interface PrivacyReport {
  enabled: boolean;
  epsilon: number | null;
  perTableEpsilon: number | null;
  sensitivity: number;
  noiseScale: number | null;
  releaseThreshold: number | null;
  minDistinctUsers: number;
  cellsBeforeNoise: number;
  cellsAfterNoise: number | null;
  /** Plain-language reading of whether the configured budget is usable at the
   *  current corpus size, rather than leaving that to be inferred. */
  assessment: string;
}

/**
 * Reports the real numbers for the current corpus instead of asserting a
 * guarantee. Intended for the security dashboard and for writing up the
 * trade-off with actual figures.
 */
export function privacyReport(model: BehaviorTransitionModel, epsilon: number | null): PrivacyReport {
  const cellsBeforeNoise = countCells(model);

  if (epsilon === null) {
    return {
      enabled: false,
      epsilon: null,
      perTableEpsilon: null,
      sensitivity: MAX_CONTRIBUTED_TRANSITIONS_PER_USER,
      noiseScale: null,
      releaseThreshold: null,
      minDistinctUsers: MIN_DISTINCT_USERS,
      cellsBeforeNoise,
      cellsAfterNoise: null,
      assessment:
        "Differential privacy is off (BEHAVIOR_MODEL_DP_EPSILON unset). The memorisation defence in force is the " +
        `deterministic MIN_DISTINCT_USERS = ${MIN_DISTINCT_USERS} threshold, which resists direct extraction but not ` +
        "boundary-probing membership inference. See lib/behaviorModelPrivacy.ts for the trade-off.",
    };
  }

  const perTable = deriveParameters(epsilon / 2);
  const noised = applyDifferentialPrivacy(model, epsilon);
  const cellsAfterNoise = countCells(noised);

  // A threshold above the plausible count ceiling means nothing survives, so
  // say so directly rather than leaving an unusable ε looking configured-fine.
  const usable = cellsBeforeNoise > 0 && cellsAfterNoise > 0;
  const assessment = usable
    ? `ε=${epsilon} is usable at the current corpus size: ${cellsAfterNoise} of ${cellsBeforeNoise} transitions survive the ` +
      `noisy release threshold of ${perTable.threshold.toFixed(1)} distinct users.`
    : `ε=${epsilon} is NOT usable at the current corpus size: the release threshold is ${perTable.threshold.toFixed(1)} ` +
      `distinct users, and no transition reaches it, so the model returns nothing. This is the expected behaviour of ` +
      `differential privacy on a small population, not a defect. At ε=${epsilon} a transition needs ` +
      `${minimumUsersForEpsilon(epsilon)} distinct consented users before it can be released at all — either grow the ` +
      `corpus to that, or raise ε and accept the weaker formal guarantee. Reporting this honestly is the point of this ` +
      `function.`;

  return {
    enabled: true,
    epsilon,
    perTableEpsilon: epsilon / 2,
    sensitivity: perTable.sensitivity,
    noiseScale: perTable.noiseScale,
    releaseThreshold: perTable.threshold,
    minDistinctUsers: MIN_DISTINCT_USERS,
    cellsBeforeNoise,
    cellsAfterNoise,
    assessment,
  };
}

function countCells(model: BehaviorTransitionModel): number {
  let total = 0;
  for (const candidates of model.transitionsOrder1.values()) total += candidates.size;
  for (const candidates of model.transitionsOrder2.values()) total += candidates.size;
  return total;
}
