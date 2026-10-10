import { useCallback, useState } from "react";
import { Link } from "wouter";
import { ScanFace } from "lucide-react";
import { FaceCamera } from "../components/FaceCamera";

// The face check inside the SecureAI phone app (docs/04 R-AUTH-1). Android doesn't let an app ask
// for face rather than fingerprint, and many phones' face unlock isn't strong enough for apps to use
// at all, so the app offers face sign-in by opening this one page in a WebView locked to this site:
// the same face models and blink check as the website, not a second implementation of them.
//
// The page only computes the 128-number face descriptor and hands it to the app. It makes no API
// call and is rendered outside AuthProvider (App.tsx), because on Android the WebView shares the
// app's cookies, and a request from here must not disturb the app's half-finished sign-in. The app
// sends the descriptor itself, to /auth/face-verify or /users/:id/enroll-face.

interface AppBridge {
  postMessage: (message: string) => void;
}

/** Defined only inside the phone app's WebView. */
function appBridge(): AppBridge | undefined {
  return (window as Window & { ReactNativeWebView?: AppBridge })
    .ReactNativeWebView;
}

export default function AppFace() {
  const bridge = appBridge();
  const [sent, setSent] = useState(false);

  const handleCapture = useCallback(
    (descriptor: number[]) => {
      bridge?.postMessage(
        JSON.stringify({ type: "face-descriptor", descriptor }),
      );
      // Unmounting the camera stops it straight away.
      setSent(true);
    },
    [bridge],
  );

  if (!bridge) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <ScanFace className="w-10 h-10 text-primary" />
        <h1 className="font-mono text-lg uppercase tracking-widest">
          Face check for the phone app
        </h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          This page runs inside the SecureAI phone app. To sign in on the
          website, use the sign-in page.
        </p>
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-widest text-primary underline underline-offset-4"
        >
          Go to sign-in
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 p-4">
      <div className="text-center space-y-2 max-w-sm">
        <p className="text-xs font-mono text-muted-foreground">
          Hold the phone at eye level, in even light, and blink once. The scan
          starts by itself after the blink.
        </p>
        <p className="text-[10px] font-mono text-muted-foreground">
          AI face matching. The camera image stays on this phone; only 128
          numbers describing your face are sent.
        </p>
      </div>
      {sent ? (
        <p
          className="text-primary font-mono text-xs uppercase tracking-wider text-center animate-pulse"
          data-testid="text-face-sent"
        >
          Face captured. Checking...
        </p>
      ) : (
        <FaceCamera autoCapture isVerifying onCapture={handleCapture} />
      )}
    </div>
  );
}
