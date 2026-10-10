import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  ScrollView,
} from "react-native";
import { useAuth } from "../context/AuthContext";
import { colors, fonts } from "../theme";
import { DashboardScreen } from "../screens/DashboardScreen";
import { UsersScreen } from "../screens/UsersScreen";
import { SecurityLogsScreen } from "../screens/SecurityLogsScreen";
import { ThreatsScreen } from "../screens/ThreatsScreen";
import { PaymentsScreen } from "../screens/PaymentsScreen";
import { UploadsScreen } from "../screens/UploadsScreen";
import { DataProtectionScreen } from "../screens/DataProtectionScreen";
import { PrivacyScreen } from "../screens/PrivacyScreen";
import { FaceEnrollmentScreen } from "../screens/FaceEnrollmentScreen";
import { getPrivacyPolicyStatus, listMyBreachNotices } from "../lib/api";
import { PRIVACY_POLICY_VERSION } from "../config";

type ScreenKey =
  | "dashboard"
  | "users"
  | "security-logs"
  | "threats"
  | "payments"
  | "uploads"
  | "data-protection"
  | "face-enrollment"
  | "privacy";

interface NavItem {
  key: ScreenKey;
  label: string;
  visible: (role: string | undefined) => boolean;
}

// Mirrors artifacts/secureai/src/components/Sidebar.tsx's role gates exactly
// (client-side convenience only — the real enforcement is server-side in
// each route, same as web). Users/Security Logs are deliberately disjoint
// (admin can't see logs, security_analyst can't manage users) — see
// routes/security.ts's canSeeAuditLogs comment for why that's intentional.
const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Command Center", visible: () => true },
  {
    key: "users",
    label: "Operator Registry",
    visible: (role) => role === "admin" || role === "it_support",
  },
  {
    key: "security-logs",
    label: "Audit Trail",
    visible: (role) => role === "security_analyst",
  },
  { key: "threats", label: "Threat Intel", visible: () => true },
  { key: "payments", label: "Financial Ledger", visible: () => true },
  { key: "uploads", label: "Data Vault", visible: () => true },
  { key: "data-protection", label: "Data Protection", visible: () => true },
  { key: "face-enrollment", label: "Face Enrollment", visible: () => true },
  { key: "privacy", label: "Privacy & Your Data", visible: () => true },
];

const SCREENS: Record<ScreenKey, React.ComponentType> = {
  dashboard: DashboardScreen,
  users: UsersScreen,
  "security-logs": SecurityLogsScreen,
  threats: ThreatsScreen,
  payments: PaymentsScreen,
  uploads: UploadsScreen,
  "data-protection": DataProtectionScreen,
  "face-enrollment": FaceEnrollmentScreen,
  privacy: PrivacyScreen,
};

export function AppShell() {
  const { user } = useAuth();
  const [screen, setScreen] = useState<ScreenKey>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  // Policy section 13: signed-in people are told when the policy changes. Re-checked whenever
  // the screen changes, so acknowledging on the Privacy screen clears the banner.
  const [policyOutdated, setPolicyOutdated] = useState(false);
  // Section 14: an unread data breach notice is flagged on every screen until it's read.
  const [unreadBreachNotices, setUnreadBreachNotices] = useState(0);
  useEffect(() => {
    getPrivacyPolicyStatus()
      .then((s) =>
        setPolicyOutdated(s.acknowledgedVersion !== PRIVACY_POLICY_VERSION),
      )
      .catch(() => setPolicyOutdated(false));
    listMyBreachNotices()
      .then((n) =>
        setUnreadBreachNotices(n.filter((x) => !x.acknowledgedAt).length),
      )
      .catch(() => setUnreadBreachNotices(0));
  }, [screen]);

  const items = NAV_ITEMS.filter((item) => item.visible(user?.role));
  const activeLabel =
    NAV_ITEMS.find((item) => item.key === screen)?.label ?? "";
  const Screen = SCREENS[screen];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{activeLabel}</Text>
        <Pressable
          onPress={() => setMenuOpen(true)}
          hitSlop={12}
          style={styles.menuButton}
        >
          <Text style={styles.menuIcon}>≡</Text>
        </Pressable>
      </View>

      {unreadBreachNotices > 0 && screen !== "privacy" ? (
        <Pressable
          style={styles.breachBanner}
          onPress={() => setScreen("privacy")}
          testID="breach-notice-banner"
        >
          <Text style={styles.policyBannerText}>
            Important: a data breach involves your information. Tap to read what
            happened and what you should do.
          </Text>
        </Pressable>
      ) : null}

      {policyOutdated && screen !== "privacy" ? (
        <Pressable
          style={styles.policyBanner}
          onPress={() => setScreen("privacy")}
          testID="privacy-policy-notice"
        >
          <Text style={styles.policyBannerText}>
            Our Privacy Policy has changed, or you haven't read it yet. Tap to
            review it.
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.body}>
        <Screen />
      </View>

      <Modal
        visible={menuOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <Pressable
            style={styles.menuPanel}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.menuTitle}>SecureAI</Text>
            <ScrollView>
              {items.map((item) => (
                <Pressable
                  key={item.key}
                  style={[
                    styles.menuItem,
                    screen === item.key && styles.menuItemActive,
                  ]}
                  onPress={() => {
                    setScreen(item.key);
                    setMenuOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.menuItemText,
                      screen === item.key && styles.menuItemTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 16,
    textTransform: "uppercase",
    letterSpacing: 2,
    fontWeight: "700",
  },
  menuButton: { padding: 4 },
  menuIcon: { color: colors.primary, fontSize: 26, fontFamily: fonts.mono },
  body: { flex: 1 },
  policyBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: `${colors.primary}66`,
    backgroundColor: `${colors.primary}14`,
  },
  breachBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: `${colors.destructive}88`,
    backgroundColor: `${colors.destructive}1A`,
  },
  policyBannerText: { color: colors.foreground, fontSize: 12, lineHeight: 17 },
  backdrop: { flex: 1, backgroundColor: "#000000A0", flexDirection: "row" },
  menuPanel: {
    width: "72%",
    height: "100%",
    backgroundColor: colors.card,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingTop: 64,
    paddingHorizontal: 16,
  },
  menuTitle: {
    fontFamily: fonts.mono,
    color: colors.primary,
    fontSize: 18,
    textTransform: "uppercase",
    letterSpacing: 3,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  menuItem: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuItemActive: { backgroundColor: `${colors.primary}14` },
  menuItemText: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  menuItemTextActive: { color: colors.primary },
});
