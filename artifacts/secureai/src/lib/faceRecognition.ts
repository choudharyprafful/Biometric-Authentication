import * as faceapi from 'face-api.js';

// Vendored locally (public/models/) from a specific pinned commit, not
// fetched from `master` at runtime — a moving branch is something an
// upstream compromise could silently swap for malicious weights, and a
// live third-party CDN dependency is also a runtime availability risk
// (raw.githubusercontent.com rate-limits by IP). Re-pin deliberately by
// re-downloading from that commit if the models ever need to change.
const MODEL_URL = '/models';

let modelsLoaded = false;

// TinyFaceDetector, not SsdMobilenetv1: it's purpose-built for real-time
// webcam use (small, fast) rather than accuracy on static images, and a
// lower score threshold (default is 0.5) is more forgiving of ordinary
// webcam lighting/angle than the stricter out-of-the-box setting.
const DETECTOR_OPTIONS = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 });

export async function loadModels(): Promise<void> {
  if (modelsLoaded) return;
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsLoaded = true;
  } catch (err) {
    console.error('Error loading models', err);
    throw err;
  }
}

export async function getFaceDescriptor(videoEl: HTMLVideoElement): Promise<number[] | null> {
  if (!videoEl.videoWidth || !videoEl.videoHeight) return null;
  const detection = await faceapi
    .detectSingleFace(videoEl, DETECTOR_OPTIONS)
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection) return null;
  return Array.from(detection.descriptor);
}

export type FaceDetectionWithLandmarks = faceapi.WithFaceLandmarks<
  { detection: faceapi.FaceDetection },
  faceapi.FaceLandmarks68
>;

/** Runs detection + 68-point landmark extraction once per call. Shared by
 *  the per-frame draw loop and liveness (blink) tracking in FaceCamera so
 *  detection doesn't run twice per frame for two different purposes. */
export async function detectFaceWithLandmarks(videoEl: HTMLVideoElement): Promise<FaceDetectionWithLandmarks | null> {
  // Detecting before the video actually has frame dimensions wastes a
  // cycle and can throw in some browsers — wait for real dimensions.
  if (!videoEl.videoWidth || !videoEl.videoHeight) return null;
  const detection = await faceapi.detectSingleFace(videoEl, DETECTOR_OPTIONS).withFaceLandmarks();
  return detection ?? null;
}

export function drawDetection(
  detection: FaceDetectionWithLandmarks | null,
  videoEl: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): void {
  const displaySize = { width: videoEl.videoWidth, height: videoEl.videoHeight };
  faceapi.matchDimensions(canvas, displaySize);
  if (detection) {
    const resized = faceapi.resizeResults(detection, displaySize);
    faceapi.draw.drawDetections(canvas, resized);
    return;
  }
  // No detection this frame — clear whatever box was drawn for the last
  // one rather than leaving a stale reticle on screen after a face leaves.
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
}
