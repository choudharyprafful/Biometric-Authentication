import React, { useEffect, useRef, useState, useCallback } from 'react';
import { loadModels, detectFaceWithLandmarks, drawDetection, getFaceDescriptor } from '../lib/faceRecognition';
import { averageEyeAspectRatio, faceBoxSample, eyeLineAngle, BlinkDetector } from '../lib/livenessDetection';
import { Loader2, Camera, AlertTriangle } from 'lucide-react';

interface FaceCameraProps {
  onCapture?: (descriptor: number[]) => void;
  autoCapture?: boolean;
  buttonLabel?: string;
  isVerifying?: boolean;
}

export function FaceCamera({ onCapture, autoCapture = false, buttonLabel = 'Capture', isVerifying = false }: FaceCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isModelsLoaded, setIsModelsLoaded] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasFace, setHasFace] = useState(false);
  const [blinkConfirmed, setBlinkConfirmed] = useState(false);
  const [blinkTimedOut, setBlinkTimedOut] = useState(false);
  const [earDebug, setEarDebug] = useState<{ ear: number; phase: string; baseline: number; movement: number; rotation: number } | null>(null);
  const [blinkProgress, setBlinkProgress] = useState<{ count: number; required: number }>({ count: 0, required: 1 });
  // A fresh detector per component instance — callers that want to retry
  // liveness detection (Login/ResetPassword) already remount FaceCamera via
  // a changing `key` prop on retry, which naturally gives a clean detector.
  const blinkDetectorRef = useRef(new BlinkDetector());
  // The detection loop below runs inside a requestAnimationFrame closure
  // that isn't recreated every render, so it can't read the `blinkConfirmed`
  // state directly without going stale — mirror it into a ref for the loop
  // to read, while the state drives the UI as usual.
  const blinkConfirmedRef = useRef(false);

  // Load Models — the ~12MB weights come from a public CDN, so a slow or
  // blocked network shouldn't spin forever; time out with a clear message.
  useEffect(() => {
    let mounted = true;
    const timeout = setTimeout(() => {
      if (mounted) setError('Biometric models are taking too long to load — check your network connection (or a firewall may be blocking the model CDN), then reload. You can use a device passkey instead.');
    }, 20000);

    loadModels()
      .then(() => {
        if (mounted) {
          clearTimeout(timeout);
          setIsModelsLoaded(true);
        }
      })
      .catch(() => {
        clearTimeout(timeout);
        if (mounted) setError('Failed to load biometric models — check your network connection, then reload. You can use a device passkey instead.');
      });
    return () => { mounted = false; clearTimeout(timeout); };
  }, []);

  // Initialize Camera
  useEffect(() => {
    let stream: MediaStream | null = null;
    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser does not support camera access (getUserMedia unavailable) — try a different browser, or use a device passkey instead.');
        return;
      }
      try {
        // facingMode is explicit rather than left to the browser default —
        // without it, some mobile browsers default to the rear camera for a
        // plain `video: true` request, which is exactly wrong for a face
        // scan. `ideal` (not `exact`) so a desktop webcam without a concept
        // of "front/back" still matches instead of failing outright.
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        const name = (err as DOMException)?.name;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setError('Camera permission was denied. Allow camera access for this site in your browser settings, then reload.');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setError('No camera was found on this device — connect a webcam, or use a device passkey instead.');
        } else if (name === 'NotReadableError' || name === 'TrackStartError') {
          setError('The camera is already in use by another app or browser tab — close it and reload.');
        } else {
          const suffix = name ? ` (${name})` : '';
          setError(`Camera access failed${suffix} — try reloading, or use a device passkey instead.`);
        }
      }
    }
    if (isModelsLoaded) {
      startCamera();
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isModelsLoaded]);

  // Detection Loop
  useEffect(() => {
    let animationFrame: number;
    let autoCaptureTriggered = false;

    async function detect() {
      if (videoRef.current && canvasRef.current && isCameraReady && isModelsLoaded && !isProcessing) {
        // A single failed frame (e.g. a transient WebGL/TF.js hiccup while
        // the backend warms up on the very first call) must not kill this
        // loop — without the try/catch, an uncaught throw here stops
        // requestAnimationFrame from ever being scheduled again, so
        // detection silently dies for the rest of the session.
        try {
          const detection = await detectFaceWithLandmarks(videoRef.current);
          drawDetection(detection, videoRef.current, canvasRef.current);
          setHasFace(!!detection);

          const detector = blinkDetectorRef.current;
          if (detection && !blinkConfirmedRef.current) {
            const ear = averageEyeAspectRatio(detection.landmarks);
            const box = faceBoxSample(detection.detection.box);
            const angle = eyeLineAngle(detection.landmarks);
            if (detector.update(ear, box, angle)) {
              blinkConfirmedRef.current = true;
              setBlinkConfirmed(true);
            }
            const debug = detector.debugState;
            setEarDebug({ ear, phase: debug.phase, baseline: debug.openBaseline, movement: debug.lastMaxMovement, rotation: debug.lastMaxRotation });
            setBlinkProgress(detector.blinkProgress);
          }
          setBlinkTimedOut(!blinkConfirmedRef.current && detector.timedOut);

          // Liveness gate: auto-capture only fires once a genuine blink has
          // been observed, not just once a face is detected — otherwise a
          // static photo held up to the camera would auto-capture exactly
          // as fast as a real person.
          if (detection && blinkConfirmedRef.current && autoCapture && !autoCaptureTriggered && onCapture) {
            autoCaptureTriggered = true;
            handleCapture();
          }
        } catch (err) {
          console.error('Face detection frame failed, retrying:', err);
          setHasFace(false);
        }
      }
      animationFrame = requestAnimationFrame(detect);
    }
    
    if (isCameraReady) {
      detect();
    }
    
    return () => cancelAnimationFrame(animationFrame);
  }, [isCameraReady, isModelsLoaded, isProcessing, autoCapture, onCapture]);

  const handleCapture = useCallback(async () => {
    if (!videoRef.current || !onCapture) return;
    setIsProcessing(true);
    
    try {
      const descriptor = await getFaceDescriptor(videoRef.current);
      if (descriptor) {
        onCapture(descriptor);
      } else {
        // If autoCapture triggered it but we failed to get a full descriptor, reset
        setIsProcessing(false);
      }
    } catch (err) {
      console.error(err);
      setIsProcessing(false);
    }
  }, [onCapture]);

  if (error) {
    return (
      <div className="bg-destructive/10 border border-destructive/20 text-destructive p-6 flex flex-col items-center justify-center text-center">
        <AlertTriangle className="w-8 h-8 mb-4 opacity-80" />
        <p className="text-sm uppercase tracking-widest font-mono">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center w-full max-w-md mx-auto">
      <div className="relative w-full aspect-video bg-black overflow-hidden border border-border group">
        {!isModelsLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
            <p className="text-primary font-mono text-xs uppercase tracking-widest">Loading Neural Models...</p>
          </div>
        )}
        
        {isModelsLoaded && !isCameraReady && !error && (
           <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20">
             <Camera className="w-8 h-8 text-muted-foreground animate-pulse mb-4" />
             <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Initializing Camera...</p>
           </div>
        )}

        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay
          muted
          playsInline
          onPlay={() => setIsCameraReady(true)}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover z-10 pointer-events-none"
        />

        {isVerifying && hasFace && !isProcessing && (
          <div className="absolute inset-0 border-2 border-primary/50 bg-primary/5 z-10 animate-pulse pointer-events-none" />
        )}
        
        {isProcessing && (
          <div className="absolute inset-0 bg-primary/20 backdrop-blur-sm z-20 flex items-center justify-center transition-all duration-300">
             <Loader2 className="w-12 h-12 text-primary animate-spin" />
          </div>
        )}

        {/* Reticle / Targeting Overlay */}
        <div className="absolute inset-0 z-10 pointer-events-none">
          <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-primary opacity-50" />
          <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-primary opacity-50" />
          <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-primary opacity-50" />
          <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-primary opacity-50" />
        </div>
      </div>

      {!autoCapture && (
        <div className="mt-6">
          <button
            type="button"
            data-testid="button-capture-face"
            onClick={handleCapture}
            disabled={!isCameraReady || isProcessing || !hasFace || !blinkConfirmed}
            className={`px-8 py-3 bg-primary text-primary-foreground font-mono uppercase tracking-wider text-sm font-semibold transition-all ${
              (!isCameraReady || isProcessing || !hasFace || !blinkConfirmed) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary/90 hover:shadow-[0_0_15px_rgba(0,255,255,0.4)]'
            }`}
          >
            {isProcessing ? 'Processing...' : buttonLabel}
          </button>
        </div>
      )}

      {isCameraReady && !hasFace && !isProcessing && (
        <p className="mt-4 text-xs font-mono text-muted-foreground uppercase tracking-widest text-center">
          Position face within frame
        </p>
      )}

      {isCameraReady && hasFace && !blinkConfirmed && !isProcessing && (
        <p className="mt-4 text-xs font-mono text-primary uppercase tracking-widest text-center animate-pulse">
          {blinkProgress.count > 0
            ? `Blink once more to verify liveness (${blinkProgress.count}/${blinkProgress.required})`
            : 'Blink naturally to verify liveness'}
        </p>
      )}

      {isCameraReady && hasFace && !blinkConfirmed && blinkTimedOut && !isProcessing && (
        <p className="mt-2 text-[10px] font-mono text-muted-foreground text-center">
          Still waiting for a blink — make sure your eyes are visible and well-lit.
        </p>
      )}

      {/* Diagnostic readout, not gated behind a dev flag on purpose — this
          check's whole premise is that it self-calibrates per camera/
          lighting, so seeing the live numbers is the fastest way to tell
          whether it's working as intended vs. needs recalibrating. */}
      {isCameraReady && hasFace && !blinkConfirmed && earDebug && (
        <p className="mt-2 text-[9px] font-mono text-muted-foreground/60 text-center" data-testid="text-ear-debug">
          EAR {earDebug.ear.toFixed(3)} · baseline {earDebug.baseline.toFixed(3)} · movement {earDebug.movement.toFixed(3)} · rotation {earDebug.rotation.toFixed(1)}° · phase {earDebug.phase}
        </p>
      )}
    </div>
  );
}
