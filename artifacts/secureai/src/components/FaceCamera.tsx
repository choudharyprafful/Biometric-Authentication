import React, { useEffect, useRef, useState, useCallback } from 'react';
import { loadModels, drawDetections, getFaceDescriptor } from '../lib/faceRecognition';
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

  // Load Models
  useEffect(() => {
    let mounted = true;
    loadModels()
      .then(() => {
        if (mounted) setIsModelsLoaded(true);
      })
      .catch((err) => {
        if (mounted) setError('Failed to load biometric models.');
      });
    return () => { mounted = false; };
  }, []);

  // Initialize Camera
  useEffect(() => {
    let stream: MediaStream | null = null;
    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        setError('Camera access denied or unavailable.');
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
        const detected = await drawDetections(videoRef.current, canvasRef.current);
        setHasFace(detected);

        if (detected && autoCapture && !autoCaptureTriggered && onCapture) {
          autoCaptureTriggered = true;
          handleCapture();
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
            disabled={!isCameraReady || isProcessing || !hasFace}
            className={`px-8 py-3 bg-primary text-primary-foreground font-mono uppercase tracking-wider text-sm font-semibold transition-all ${
              (!isCameraReady || isProcessing || !hasFace) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary/90 hover:shadow-[0_0_15px_rgba(0,255,255,0.4)]'
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
    </div>
  );
}
