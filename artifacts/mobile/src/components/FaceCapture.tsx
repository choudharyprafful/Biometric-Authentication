import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "./ui";
import { colors, fonts } from "../theme";
import { FACE_CHECK_URL, WEB_ORIGIN, originOf } from "../config";
import { DEVICE_KEY_PHRASE } from "../lib/biometricKey";

// Face sign-in on the phone (docs/04 R-AUTH-1). When an app asks Android for a biometric, Android
// decides which one to use: an app can't ask for face rather than fingerprint, and many phones' face
// unlock is rated too weak for apps to use at all. So the face option is the website's own face
// check: this opens the site's /app-face page in a WebView, the page computes the 128-number face
// descriptor with the same models and blink check as the website, and posts it here. The caller
// then sends it to the API over the app's own connection. Unlike the device key (fingerprint, Face
// ID or Touch ID), which signs a challenge with a key that never leaves the phone, this sends a face
// template: the same documented departure from the brief that the website makes. The iPhone app
// offers it too since 2026-10-07, as the same alternative to the device key as on Android.
//
// The WebView gives the camera to any page it shows once the app holds the camera permission, so
// it is locked to the site: it loads nothing from anywhere else, and only a message from the site's
// own page is accepted.

// The option's name. On Android it is "Face". An iPhone's Face ID already unlocks the device key
// (src/lib/biometricKey.ts), so there it is a "Face scan", to keep the two apart.
export const FACE_OPTION_NAME = Platform.OS === "ios" ? "Face scan" : "Face";
export const FACE_OPTION_PHRASE =
  Platform.OS === "ios" ? "a face scan" : "your face";

const DESCRIPTOR_LENGTH = 128;

// Asked with an unticked box before a face is set up (EnrollScreen, PrivacyScreen); the website asks
// the same in Enroll.tsx. The server refuses to store a template without it.
export const FACE_CONSENT_TEXT = `I consent to SecureAI storing a template of my face for sign-in. Biometric information is sensitive information under the Privacy Act 1988, so this is asked separately from my account data, and only because I chose face sign-in: I can use ${Platform.OS === "ios" ? "Face ID or Touch ID" : "my fingerprint"} instead. The template is 128 numbers computed on this phone (the camera image never leaves it), stored encrypted on SecureAI's servers in the United States, and used only to confirm it's me at sign-in and password reset. I can withdraw this consent at any time under Privacy & Your Data, which permanently deletes it.`;

/** The 128 finite numbers the face check page posts, or null for any other message. */
export function parseFaceMessage(data: string): number[] | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null) return null;
  const { type, descriptor } = message as {
    type?: unknown;
    descriptor?: unknown;
  };
  if (
    type !== "face-descriptor" ||
    !Array.isArray(descriptor) ||
    descriptor.length !== DESCRIPTOR_LENGTH ||
    !descriptor.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    return null;
  }
  return descriptor as number[];
}

type CameraAccess = "asking" | "granted" | "denied" | "blocked";

// On an iPhone the system asks for the camera itself, the first time the page opens it, with the
// NSCameraUsageDescription text in Info.plist.
async function askForCamera(): Promise<CameraAccess> {
  if (Platform.OS !== "android") return "granted";
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: "Camera for face sign-in",
        message:
          "SecureAI uses the front camera only during a face check. The camera image stays on this phone.",
        buttonPositive: "Allow",
        buttonNegative: "Not now",
      },
    );
    if (result === PermissionsAndroid.RESULTS.GRANTED) return "granted";
    return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
      ? "blocked"
      : "denied";
  } catch {
    return "denied";
  }
}

export function FaceCapture({
  visible,
  title,
  onCapture,
  onCancel,
}: Readonly<{
  visible: boolean;
  title: string;
  /** Called once with the descriptor; the caller closes this and sends it. */
  onCapture: (descriptor: number[]) => void;
  onCancel: () => void;
}>) {
  const [camera, setCamera] = useState<CameraAccess>("asking");
  const [loadError, setLoadError] = useState("");
  // A new WebView for each try, so each try starts a fresh camera and blink check.
  const [attempt, setAttempt] = useState(0);
  // One descriptor per opening: a second would be a second sign-in attempt, which the server
  // refuses while the first is in progress.
  const captured = useRef(false);

  const requestCamera = useCallback(() => {
    setCamera("asking");
    void askForCamera().then(setCamera);
  }, []);

  useEffect(() => {
    if (!visible) return;
    captured.current = false;
    setLoadError("");
    requestCamera();
  }, [visible, requestCamera]);

  const retry = () => {
    captured.current = false;
    setLoadError("");
    setAttempt((n) => n + 1);
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    if (captured.current || originOf(event.nativeEvent.url) !== WEB_ORIGIN) {
      return;
    }
    const descriptor = parseFaceMessage(event.nativeEvent.data);
    if (!descriptor) return;
    captured.current = true;
    onCapture(descriptor);
  };

  const stopped = () =>
    setLoadError("The face check stopped unexpectedly. Try again.");

  let body: React.ReactNode;
  if (camera === "asking") {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  } else if (camera !== "granted") {
    body = (
      <View style={styles.centered}>
        <Text style={styles.message}>
          {camera === "blocked"
            ? `The camera is switched off for SecureAI. Turn it on in Settings, under Apps, SecureAI, Permissions, then try again. Or cancel and use ${DEVICE_KEY_PHRASE}.`
            : `Face sign-in needs the front camera. Allow it when asked, or cancel and use ${DEVICE_KEY_PHRASE}.`}
        </Text>
        {camera === "blocked" ? (
          <Button
            variant="outline"
            onPress={() => void Linking.openSettings()}
            style={styles.action}
          >
            Open Settings
          </Button>
        ) : null}
        <Button onPress={requestCamera} style={styles.action}>
          Try Again
        </Button>
      </View>
    );
  } else if (loadError) {
    body = (
      <View style={styles.centered}>
        <Text style={styles.message}>{loadError}</Text>
        <Button onPress={retry} style={styles.action}>
          Try Again
        </Button>
      </View>
    );
  } else {
    body = (
      <>
        <WebView
          key={attempt}
          source={{ uri: FACE_CHECK_URL }}
          // Leaving the site is refused here; originWhitelist would hand such a link to the browser.
          originWhitelist={[WEB_ORIGIN]}
          onShouldStartLoadWithRequest={(request) =>
            originOf(request.url) === WEB_ORIGIN
          }
          onMessage={handleMessage}
          // The camera preview is a muted <video> that has to play without a tap, inside the page.
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          // iPhone: the site's own page gets the camera without WebKit asking a second time, once
          // the system has; a page from anywhere else would be refused, though none can load here.
          mediaCapturePermissionGrantType="grantIfSameHostElseDeny"
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => (
            <View style={[StyleSheet.absoluteFill, styles.centered]}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
          onError={() =>
            setLoadError(
              "The face check couldn't load. Check your internet connection and try again.",
            )
          }
          onHttpError={() =>
            setLoadError(
              `The face check couldn't load. Try again in a moment, or use ${DEVICE_KEY_PHRASE}.`,
            )
          }
          onRenderProcessGone={stopped}
          onContentProcessDidTerminate={stopped}
          style={styles.webview}
          testID="face-check-webview"
        />
        {Platform.OS === "ios" ? (
          <Text style={styles.hint}>
            Camera not starting? Allow it in Settings, SecureAI, Camera, or
            cancel and use Face ID or Touch ID.
          </Text>
        ) : null}
      </>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable
            onPress={onCancel}
            hitSlop={12}
            accessibilityRole="button"
            testID="button-face-cancel"
          >
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
        <View style={styles.body}>{body}</View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontFamily: fonts.mono,
    color: colors.primary,
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  cancel: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  body: { flex: 1 },
  webview: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: colors.background,
  },
  message: {
    color: colors.foreground,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 16,
  },
  hint: {
    color: colors.mutedForeground,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  action: { alignSelf: "stretch", marginTop: 8 },
});
