import * as faceapi from 'face-api.js';

const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';

let modelsLoaded = false;

export async function loadModels(): Promise<void> {
  if (modelsLoaded) return;
  try {
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
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
  const detection = await faceapi
    .detectSingleFace(videoEl)
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection) return null;
  return Array.from(detection.descriptor);
}

export async function drawDetections(videoEl: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<boolean> {
  const detection = await faceapi
    .detectSingleFace(videoEl)
    .withFaceLandmarks();
  const displaySize = { width: videoEl.videoWidth, height: videoEl.videoHeight };
  faceapi.matchDimensions(canvas, displaySize);
  if (detection) {
    const resized = faceapi.resizeResults(detection, displaySize);
    faceapi.draw.drawDetections(canvas, resized);
    return true;
  }
  return false;
}
