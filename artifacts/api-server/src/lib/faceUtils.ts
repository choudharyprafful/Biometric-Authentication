export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2;
  }
  return Math.sqrt(sum);
}

export const FACE_MATCH_THRESHOLD = 0.6; // face-api.js default for "same person"

export function isFaceMatch(a: number[], b: number[]): boolean {
  return euclideanDistance(a, b) < FACE_MATCH_THRESHOLD;
}

// Same comparison as isFaceMatch, but returns the actual distance instead of
// collapsing it to a boolean — needed to distinguish an ordinary mismatch
// from a distance clustered just above threshold.
export function faceMatchDistance(a: number[], b: number[]): number {
  return euclideanDistance(a, b);
}
