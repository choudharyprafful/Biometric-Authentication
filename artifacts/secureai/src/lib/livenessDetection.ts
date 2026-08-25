import type * as faceapi from 'face-api.js';

// EAR (Eye Aspect Ratio) is eye height / eye width, so it stays comparable
// across face size and camera distance, but its absolute value still
// varies with eye shape, angle, and lighting — a fixed threshold doesn't
// hold up across setups. So this tracks a per-session adaptive baseline
// ("what does this camera/face read as open right now") and watches for a
// proportional drop from it instead.
//
// A dip check alone isn't enough: a tilted or moved photo produces a
// similar EAR dip through perspective distortion, and a perfectly still
// photo can produce a small dip purely from sensor/exposure noise. So this
// also checks that the face stayed still AND level during the dip (rules
// out the tilted/moved-photo case) and that the dip has a fast, blink-shaped
// open→dip→recover timing (rules out the noise case) — see the
// class doc comment below for what this still doesn't catch.
//
// Position and rotation are both checked against the best "eyes open"
// reading seen so far this session (the same frame openBaseline is updated
// from), not just a small rolling window of recent frames — a tilt slow
// enough to play out over more frames than the window holds would let the
// window "forget" what level looked like, since every frame currently in
// it would already share the same partially-tilted angle. Anchoring to a
// persistent reference instead of a window catches drift no matter how
// slowly it happens. Tilting is a rotation, which a position-only check
// can also miss entirely if the tilt happens to pivot near the box's own
// center, hence checking both axes independently.
const CLOSE_RATIO = 0.90; // EAR must drop below 90% of the established open baseline to count as "closed"
const REOPEN_RATIO = 0.88; // EAR must recover to at least 88% of baseline to count as "reopened"
const MIN_OPEN_SAMPLES_BEFORE_TRUSTING_BASELINE = 5;
const RECENT_WINDOW_SIZE = 6; // frames considered together when checking for a dip, not just the current one
const MAX_NORMALIZED_MOVEMENT = 0.12; // max allowed face-box position spread across the window (as a fraction of face size) for a dip to count as a real blink rather than camera/photo motion
const MAX_ROTATION_DEG = 3; // max allowed eye-line angle spread across the window, in degrees — catches a tilt even when the box position barely moves
const MAX_RECOVERY_MS = 800; // a genuine blink recovers fast; a dip that takes longer than this to recover is more likely drift (lighting/exposure), not a blink
const MAX_TIME_SINCE_OPEN_MS = 700; // how recently we must have seen a not-yet-dipped reading for a later dip to count as a fresh open->close transition, not sustained drift
const BLINK_TIMEOUT_MS = 15000;
const REQUIRED_BLINKS = 1;

type Point = { x: number; y: number };

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Eye Aspect Ratio (Soukupová & Čech, 2016): (|p2-p6| + |p3-p5|) / (2*|p1-p4|)
 *  over the 6 landmark points face-api.js returns per eye, already in the
 *  point order the formula expects. Drops sharply when the eye closes. */
function eyeAspectRatio(eye: Point[]): number {
  const vertical1 = distance(eye[1] as Point, eye[5] as Point);
  const vertical2 = distance(eye[2] as Point, eye[4] as Point);
  const horizontal = distance(eye[0] as Point, eye[3] as Point);
  return (vertical1 + vertical2) / (2 * horizontal);
}

export function averageEyeAspectRatio(landmarks: faceapi.FaceLandmarks68): number {
  const left = eyeAspectRatio(landmarks.getLeftEye());
  const right = eyeAspectRatio(landmarks.getRightEye());
  return (left + right) / 2;
}

function centerOf(points: Point[]): Point {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** Roll angle (degrees) of the line between the two eye centers. A rotation
 *  signal independent of EAR and independent of face-box position — tilting
 *  a photo changes this even when the box itself barely moves. */
export function eyeLineAngle(landmarks: faceapi.FaceLandmarks68): number {
  const left = centerOf(landmarks.getLeftEye());
  const right = centerOf(landmarks.getRightEye());
  return Math.atan2(right.y - left.y, right.x - left.x) * (180 / Math.PI);
}

/** Center point and size of the detected face box for one frame — used to
 *  measure whether the face moved between frames, independent of EAR. */
export interface FaceBoxSample {
  centerX: number;
  centerY: number;
  size: number; // face box width — used to normalize movement distance
}

export function faceBoxSample(box: { x: number; y: number; width: number; height: number }): FaceBoxSample {
  return { centerX: box.x + box.width / 2, centerY: box.y + box.height / 2, size: box.width };
}

interface FrameSample extends FaceBoxSample {
  ear: number;
  t: number;
  angle: number;
}

type BlinkPhase = 'waiting-for-close' | 'waiting-for-open' | 'confirmed';

/**
 * Confirms liveness after REQUIRED_BLINKS qualifying blinks (currently 1;
 * the mechanics support more without changing the per-blink checks). A
 * blink only counts when EAR dips from the learned baseline, the face
 * stayed both positionally still AND level (no rotation) while it did, and
 * the dip-to-recovery timing looks like a real blink rather than a bad
 * angle, droopy eyelid, or camera noise.
 *
 * Honest limit: this is a client-side behavioral heuristic, not
 * cryptographic proof of liveness. It doesn't defeat a video replay of a
 * real blink, and a direct API call bypassing the UI skips it entirely —
 * which is why face-scan is the fallback factor here, not the primary one.
 * WebAuthn's signed challenge is the actual cryptographic guarantee. See
 * docs/04_Threat_Model_Risk_Assessment.md, R-BIO-1.
 */
export class BlinkDetector {
  private phase: BlinkPhase = 'waiting-for-close';
  private readonly startedAt = Date.now();
  private openBaseline = 0;
  private openSampleCount = 0;
  private recentSamples: FrameSample[] = [];
  private minEarSeen = Infinity;
  private lastMaxMovement = 0;
  private lastMaxRotation = 0;
  private dipAt = 0;
  // The face-box position and eye-line angle recorded on the same frame
  // openBaseline was last raised — the persistent "this is what open and
  // level looks like" reference that trough drift is measured against.
  private baselineBox: FaceBoxSample | null = null;
  private baselineAngle = 0;
  private confirmedBlinkCount = 0;
  // Last time EAR was NOT in the "closed" range, tracked independently of
  // recentSamples' small window so an open reading that scrolled out of
  // the window is still visible here.
  private lastOpenAt = Date.now();

  /** Feed one frame's EAR value, current face-box position/size, and eye-
   *  line roll angle. Returns true on the exact frame a full blink
   *  completes; false otherwise (including every frame before/after). */
  update(ear: number, box: FaceBoxSample, angleDeg: number): boolean {
    this.minEarSeen = Math.min(this.minEarSeen, ear);
    return this.phase === 'waiting-for-close' ? this.updateWaitingForClose(ear, box, angleDeg) : this.updateWaitingForOpen(ear);
  }

  private updateWaitingForClose(ear: number, box: FaceBoxSample, angleDeg: number): boolean {
    const now = Date.now();

    // Keep adapting the "eyes open" baseline upward while we're presumed
    // open — a clearer, more front-on frame later should raise it. Snapshot
    // position/angle on the same frame, so they track whatever "open"
    // currently means too, not just EAR.
    if (ear > this.openBaseline) {
      this.openBaseline = ear;
      this.baselineBox = box;
      this.baselineAngle = angleDeg;
    }
    this.openSampleCount += 1;

    // Reuses CLOSE_RATIO rather than a stricter separate "open" bar — open
    // jitter and a partially-sampled dip sit close enough together that a
    // stricter threshold rejects genuine blinks.
    if (ear >= this.openBaseline * CLOSE_RATIO) this.lastOpenAt = now;

    this.recentSamples.push({ ear, t: now, angle: angleDeg, ...box });
    if (this.recentSamples.length > RECENT_WINDOW_SIZE) this.recentSamples.shift();

    const haveTrustworthyBaseline = this.openSampleCount >= MIN_OPEN_SAMPLES_BEFORE_TRUSTING_BASELINE && this.openBaseline > 0;
    if (!haveTrustworthyBaseline) return false;

    const trough = this.findTrough();
    this.lastMaxMovement = this.driftFromBaseline(trough.sample);
    this.lastMaxRotation = Math.abs(trough.sample.angle - this.baselineAngle);

    const faceWasStable = this.lastMaxMovement < MAX_NORMALIZED_MOVEMENT;
    const faceWasLevel = this.lastMaxRotation < MAX_ROTATION_DEG;
    const dipDeepEnough = trough.sample.ear < this.openBaseline * CLOSE_RATIO;
    // Elapsed-time based, not window-index based, so it rules out slow
    // drift without being blind to an open moment that's aged out of the
    // small rolling window.
    const sawRecentOpen = now - this.lastOpenAt <= MAX_TIME_SINCE_OPEN_MS;

    if (faceWasStable && faceWasLevel && dipDeepEnough && sawRecentOpen) {
      this.phase = 'waiting-for-open';
      this.dipAt = trough.sample.t;
    }
    return false;
  }

  private updateWaitingForOpen(ear: number): boolean {
    const elapsedSinceDip = Date.now() - this.dipAt;

    if (ear > this.openBaseline * REOPEN_RATIO) {
      if (elapsedSinceDip <= MAX_RECOVERY_MS) {
        this.confirmedBlinkCount += 1;
        if (this.confirmedBlinkCount >= REQUIRED_BLINKS) {
          this.phase = 'confirmed'; // terminal — reported exactly once, never again
          return true;
        }
        // One qualifying blink counted, but not enough yet — go back to
        // watching for another rather than confirming on just this one.
        this.phase = 'waiting-for-close';
        return false;
      }
      // Recovered, but too slowly to be a real blink (more likely gradual
      // drift) -- not a permanent lockout, just go back to watching for a
      // genuinely fast one.
      this.phase = 'waiting-for-close';
      return false;
    }

    if (elapsedSinceDip > MAX_RECOVERY_MS) {
      this.phase = 'waiting-for-close'; // never recovered in time -- abandon this attempt
    }
    return false;
  }

  private findTrough(): { sample: FrameSample; index: number } {
    let index = 0;
    for (let i = 1; i < this.recentSamples.length; i++) {
      if ((this.recentSamples[i] as FrameSample).ear < (this.recentSamples[index] as FrameSample).ear) index = i;
    }
    return { sample: this.recentSamples[index] as FrameSample, index };
  }

  /** Face-box distance between the given sample and the persistent open/
   *  level reference, normalized by face size. Anchored to that reference
   *  rather than a recent window so drift is caught regardless of how many
   *  frames it plays out over. */
  private driftFromBaseline(sample: FrameSample): number {
    if (!this.baselineBox) return 0;
    const dist = Math.hypot(sample.centerX - this.baselineBox.centerX, sample.centerY - this.baselineBox.centerY);
    const avgSize = (sample.size + this.baselineBox.size) / 2;
    return avgSize > 0 ? dist / avgSize : 0;
  }

  get timedOut(): boolean {
    return Date.now() - this.startedAt > BLINK_TIMEOUT_MS;
  }

  /** How many qualifying blinks have been confirmed so far this session,
   *  and how many are required in total — for UI progress ("blink again"). */
  get blinkProgress(): { count: number; required: number } {
    return { count: this.confirmedBlinkCount, required: REQUIRED_BLINKS };
  }

  // On-screen diagnostics only.
  get debugState(): { phase: BlinkPhase; openBaseline: number; minEarSeen: number; lastMaxMovement: number; lastMaxRotation: number } {
    return { phase: this.phase, openBaseline: this.openBaseline, minEarSeen: this.minEarSeen, lastMaxMovement: this.lastMaxMovement, lastMaxRotation: this.lastMaxRotation };
  }
}
