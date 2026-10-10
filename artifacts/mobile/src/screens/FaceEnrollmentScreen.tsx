import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

const ENROLLMENT_URL = "https://192.168.0.110:5173/enroll";

export function FaceEnrollmentScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Face Enrollment</Text>
      <Text style={styles.note}>
        Sign in securely if requested. Camera access and blink verification are
        required before enrollment.
      </Text>
      <WebView
        source={{ uri: ENROLLMENT_URL }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction
        onError={(event) => {
          console.warn(
            "Face enrollment WebView error:",
            event.nativeEvent.description,
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#101018",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "bold",
    padding: 16,
  },
  note: {
    color: "#CCCCCC",
    fontSize: 13,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  webview: {
    flex: 1,
  },
});
