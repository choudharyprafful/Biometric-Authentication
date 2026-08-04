/**
 * Euclidean distance between two face descriptor vectors.
 * face-api.js uses 128-element float32 arrays.
 * Threshold < 0.6 = same person (face-api.js default).
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2;
  }
  return Math.sqrt(sum);
}

export const FACE_MATCH_THRESHOLD = 0.6;

export function isFaceMatch(a: number[], b: number[]): boolean {
  return euclideanDistance(a, b) < FACE_MATCH_THRESHOLD;
}
