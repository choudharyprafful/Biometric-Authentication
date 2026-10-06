import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Linking,
  Alert,
} from "react-native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  acknowledgeBreachNotice,
  acknowledgePrivacyPolicy,
  deleteMyAccount,
  enrollFace,
  exportMyData,
  exportMyDataReadable,
  getPrivacyPolicyStatus,
  listMyBreachNotices,
  removeFace,
  setContentPersonalizationConsent,
  setTrainingConsent,
  type BreachNotice,
  type PrivacyPolicyStatus,
} from "../lib/api";
import {
  DEVICE_KEY_NAME,
  DEVICE_KEY_PHRASE,
  enrollBiometricKey,
  isBiometricSupported,
} from "../lib/biometricKey";
import { useAuth } from "../context/AuthContext";
import {
  FaceCapture,
  FACE_CHECK_SUPPORTED,
  FACE_CONSENT_TEXT,
} from "../components/FaceCapture";
import {
  Button,
  Card,
  CheckRow,
  Input,
  Label,
  SectionNote,
} from "../components/ui";
import { colors, fonts } from "../theme";
import { PRIVACY_POLICY_URL, PRIVACY_POLICY_VERSION } from "../config";

// Privacy policy sections 11, 13 and 14 on mobile, using the same endpoints as the web app's
// Security Settings: read data breach notices, see and acknowledge the policy, change the optional
// consents, choose the sign-in methods (fingerprint, face), download a copy of your data, and
// delete the account.

// Section 14: a notice stays at the top until the person confirms reading it (they're also emailed).
function BreachNoticeCard({
  notice,
  onAcknowledged,
}: Readonly<{
  notice: BreachNotice;
  onAcknowledged: (n: BreachNotice) => void;
}>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const acknowledge = async () => {
    setBusy(true);
    setError("");
    try {
      onAcknowledged(await acknowledgeBreachNotice(notice.id));
    } catch (err: any) {
      setError(err?.message || "Could not record that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={[styles.card, styles.danger]}>
      <Label style={{ color: colors.destructive }}>Data breach notice</Label>
      <Text style={styles.title}>{notice.title}</Text>
      <Text style={styles.text}>{notice.description}</Text>
      <Text style={styles.text}>
        <Text style={styles.strong}>The information involved: </Text>
        {notice.dataInvolved}
      </Text>
      <Text style={styles.text}>
        <Text style={styles.strong}>What you should do: </Text>
        {notice.userGuidance}
      </Text>
      <Text style={styles.muted}>
        Sent {new Date(notice.notifiedAt).toLocaleString()}. You can complain to
        the Office of the Australian Information Commissioner (oaic.gov.au) if
        you aren't satisfied with how we handle this.
      </Text>
      <Button
        onPress={acknowledge}
        isLoading={busy}
        testID={`breach-notice-ack-${notice.id}`}
      >
        I've read this
      </Button>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
  );
}

function PolicyCard({
  status,
  onAcknowledged,
}: Readonly<{
  status: PrivacyPolicyStatus | null;
  onAcknowledged: (s: PrivacyPolicyStatus) => void;
}>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = status?.acknowledgedVersion === PRIVACY_POLICY_VERSION;

  const acknowledge = async () => {
    setBusy(true);
    setError("");
    try {
      onAcknowledged(await acknowledgePrivacyPolicy(PRIVACY_POLICY_VERSION));
    } catch (err: any) {
      setError(err?.message || "Could not record that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card} topAccent>
      <Label>Privacy Policy</Label>
      <Text style={styles.body}>
        Version {PRIVACY_POLICY_VERSION}: what SecureAI collects, where it is
        stored, and how to download or delete it.
      </Text>
      {status && !current ? (
        <SectionNote>
          {status.acknowledgedVersion
            ? "We've updated our Privacy Policy since you last read it."
            : "Please read our Privacy Policy."}
        </SectionNote>
      ) : null}
      {status && current && status.acknowledgedAt ? (
        <Text style={styles.muted} testID="privacy-acknowledged">
          You acknowledged this version on{" "}
          {new Date(status.acknowledgedAt).toLocaleDateString()}.
        </Text>
      ) : null}
      <View style={styles.row}>
        <Button
          variant="outline"
          size="sm"
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
          style={styles.flex}
        >
          Read it
        </Button>
        {status && !current ? (
          <Button
            size="sm"
            onPress={acknowledge}
            isLoading={busy}
            style={styles.flex}
            testID="privacy-ack"
          >
            I've read it
          </Button>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
  );
}

function ConsentCard() {
  const { user, refetchUser } = useAuth();
  const [busy, setBusy] = useState<"training" | "content" | null>(null);
  const [error, setError] = useState("");
  if (!user) return null;

  const change = async (which: "training" | "content", consent: boolean) => {
    setBusy(which);
    setError("");
    try {
      if (which === "training") await setTrainingConsent(consent);
      else await setContentPersonalizationConsent(consent);
      await refetchUser();
    } catch (err: any) {
      setError(err?.message || "Could not change that. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={styles.card}>
      <Label>Optional Consents</Label>
      <Text style={styles.body}>
        Each is separate from the others and from using the app. Untick one to
        withdraw it; it takes effect immediately.
      </Text>
      <View style={styles.consents}>
        <CheckRow
          checked={user.trainingConsentGiven}
          onChange={(v) => busy === null && void change("training", v)}
          testID="toggle-training-consent"
        >
          Let my activity (which actions I take, never what I upload) contribute
          to the behaviour-suggestion model.
        </CheckRow>
        <CheckRow
          checked={user.contentPersonalizationConsentGiven}
          onChange={(v) => busy === null && void change("content", v)}
          testID="toggle-content-consent"
        >
          Let the app read the text files I upload to build a private
          personalisation profile that only I can see.
        </CheckRow>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
  );
}

// The second sign-in step: set up fingerprint on this phone, and set up (Android) or remove face
// sign-in.
// Removing the face withdraws biometric consent, which deletes the template at once (policy section
// 11). If it was the only second step, the app goes back to the set-up screen.
function SignInMethodsCard() {
  const { user, refetchUser } = useAuth();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [faceConsent, setFaceConsent] = useState(false);
  const [faceOpen, setFaceOpen] = useState(false);
  const [busy, setBusy] = useState<"fingerprint" | "face" | "remove" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  useEffect(() => {
    isBiometricSupported()
      .then(setSupported)
      .catch(() => setSupported(false));
  }, []);
  if (!user) return null;

  const run = async (
    which: "fingerprint" | "face" | "remove",
    work: () => Promise<unknown>,
    success: string,
  ) => {
    setBusy(which);
    setError("");
    setDone("");
    try {
      await work();
      await refetchUser();
      setDone(success);
    } catch (err: any) {
      setError(err?.message || "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const setUpFace = (descriptor: number[]) => {
    setFaceOpen(false);
    setFaceConsent(false);
    void run(
      "face",
      () => enrollFace(user.id, descriptor, true),
      "Face sign-in is set up.",
    );
  };

  const confirmRemoveFace = () =>
    Alert.alert(
      "Remove face sign-in?",
      user.passkeyEnrolled
        ? `This deletes your face template and withdraws your consent. You'll sign in with ${DEVICE_KEY_PHRASE}.`
        : "This deletes your face template and withdraws your consent. Face is your only second sign-in step, so you'll be asked to set one up again straight away.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () =>
            void run(
              "remove",
              () => removeFace(user.id),
              "Face sign-in is removed and your face template deleted.",
            ),
        },
      ],
    );

  return (
    <Card style={styles.card}>
      <Label>Sign-in Methods</Label>
      <Text style={styles.body}>
        {FACE_CHECK_SUPPORTED
          ? "After your password, you finish signing in with your fingerprint or your face. Set up both to have a spare."
          : "After your password, you finish signing in with Face ID or Touch ID."}
      </Text>

      <View style={styles.method}>
        <Text style={styles.title}>{DEVICE_KEY_NAME}</Text>
        <Text style={styles.text}>
          {user.passkeyEnrolled
            ? "Set up: a device key or passkey is registered to your account."
            : "Not set up."}
        </Text>
        <Text style={styles.muted}>
          {supported === false
            ? "This phone has no biometric set up in its settings."
            : "Setting it up here replaces any key this app made before on this phone."}
        </Text>
        <Button
          variant="outline"
          size="sm"
          onPress={() =>
            void run(
              "fingerprint",
              () => enrollBiometricKey("Mobile device"),
              `${DEVICE_KEY_NAME} sign-in is set up on this phone.`,
            )
          }
          isLoading={busy === "fingerprint"}
          disabled={supported !== true || busy !== null}
          testID="button-setup-fingerprint"
        >
          Set Up {DEVICE_KEY_NAME} on This Phone
        </Button>
      </View>

      <View style={styles.method}>
        <Text style={styles.title}>Face</Text>
        {user.faceEnrolled ? (
          <>
            <Text style={styles.text}>
              Set up. Your face template is stored encrypted, with your consent.
            </Text>
            <Button
              variant="destructive"
              size="sm"
              onPress={confirmRemoveFace}
              isLoading={busy === "remove"}
              disabled={busy !== null}
              testID="button-remove-face"
            >
              Remove Face Sign-in
            </Button>
          </>
        ) : !FACE_CHECK_SUPPORTED ? (
          <Text style={styles.text}>
            Not set up. Face sign-in can be set up on the website.
          </Text>
        ) : (
          <>
            <Text style={styles.text}>Not set up.</Text>
            <CheckRow
              checked={faceConsent}
              onChange={setFaceConsent}
              testID="checkbox-biometric-consent"
            >
              {FACE_CONSENT_TEXT}
            </CheckRow>
            <Button
              variant="outline"
              size="sm"
              onPress={() => {
                setError("");
                setDone("");
                setFaceOpen(true);
              }}
              isLoading={busy === "face"}
              disabled={!faceConsent || busy !== null}
              testID="button-setup-face"
            >
              Set Up Face Sign-in
            </Button>
          </>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {done ? <Text style={styles.done}>{done}</Text> : null}

      <FaceCapture
        visible={faceOpen}
        title="Set up face sign-in"
        onCapture={setUpFace}
        onCancel={() => setFaceOpen(false)}
      />
    </Card>
  );
}

type ExportFormat = "readable" | "json";

function ExportCard() {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState("");

  const download = async (format: ExportFormat) => {
    setBusy(format);
    setError("");
    const dest = `${FileSystem.cacheDirectory}secureai-data-${new Date()
      .toISOString()
      .slice(0, 10)}.${format === "readable" ? "html" : "json"}`;
    try {
      await FileSystem.writeAsStringAsync(
        dest,
        format === "readable"
          ? await exportMyDataReadable()
          : await exportMyData(),
      );
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest, {
          mimeType: format === "readable" ? "text/html" : "application/json",
        });
      } else {
        setError("This device can't share files.");
      }
    } catch (err: any) {
      setError(err?.message || "The download failed. Try again in a moment.");
    } finally {
      // The share sheet has closed; don't leave a plaintext copy in the app's cache.
      await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
      setBusy(null);
    }
  };

  return (
    <Card style={styles.card}>
      <Label>Download My Data</Label>
      <Text style={styles.body}>
        Your account, consents, devices, files, payments, security activity and
        any data breach notices. The readable copy is a page you can open in any
        browser, print or save as a PDF; the data file (JSON) also includes your
        files' contents. Your face template and password hash are not included.
      </Text>
      <Button
        onPress={() => download("readable")}
        isLoading={busy === "readable"}
        disabled={busy !== null}
        testID="button-download-my-data-readable"
      >
        Download a readable copy
      </Button>
      <Button
        variant="outline"
        onPress={() => download("json")}
        isLoading={busy === "json"}
        disabled={busy !== null}
        testID="button-download-my-data"
      >
        Download as a data file (JSON)
      </Button>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
  );
}

function DeleteCard() {
  const { user, refetchUser } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!user) return null;

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await deleteMyAccount(user.id, password);
      await refetchUser();
    } catch (err: any) {
      setError(err?.message || "Deletion failed.");
      setBusy(false);
    }
  };

  const confirm = () =>
    Alert.alert(
      "Delete your account?",
      "This removes your account, face template, passkeys, device keys and uploads. Payment and security records are kept as the Privacy Policy describes. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void remove() },
      ],
    );

  return (
    <Card style={[styles.card, styles.danger]}>
      <Label style={{ color: colors.destructive }}>Delete Account</Label>
      <Text style={styles.body}>Enter your password to confirm.</Text>
      <Input
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        testID="input-delete-password"
      />
      <Button
        variant="destructive"
        onPress={confirm}
        isLoading={busy}
        disabled={!password}
        style={styles.gapTop}
        testID="button-delete-account"
      >
        Delete my account
      </Button>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
  );
}

export function PrivacyScreen() {
  const [status, setStatus] = useState<PrivacyPolicyStatus | null>(null);
  const [notices, setNotices] = useState<BreachNotice[]>([]);
  const load = useCallback(() => {
    getPrivacyPolicyStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
    listMyBreachNotices()
      .then(setNotices)
      .catch(() => setNotices([]));
  }, []);
  useEffect(load, [load]);
  const acknowledged = (n: BreachNotice) =>
    setNotices((all) => all.map((x) => (x.id === n.id ? n : x)));

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {notices
        .filter((n) => !n.acknowledgedAt)
        .map((n) => (
          <BreachNoticeCard
            key={n.id}
            notice={n}
            onAcknowledged={acknowledged}
          />
        ))}
      <PolicyCard status={status} onAcknowledged={setStatus} />
      <ConsentCard />
      <SignInMethodsCard />
      <ExportCard />
      <DeleteCard />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, paddingBottom: 48 },
  card: { gap: 12 },
  danger: { borderColor: `${colors.destructive}66` },
  body: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
  title: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 14,
    fontWeight: "700",
  },
  text: { color: colors.foreground, fontSize: 13, lineHeight: 19 },
  strong: { fontWeight: "700" },
  muted: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 11,
  },
  consents: { gap: 14 },
  method: {
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  done: { fontFamily: fonts.mono, color: colors.success, fontSize: 11 },
  row: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  gapTop: { marginTop: 4 },
  error: { fontFamily: fonts.mono, color: colors.destructive, fontSize: 11 },
});
