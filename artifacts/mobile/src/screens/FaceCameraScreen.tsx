import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Button } from "../components/ui";
import { colors } from "../theme";

type Props = {
  onBack: () => void;
};

export function FaceCameraScreen({ onBack }: Props) {
  const [permission, requestPermission] = useCameraPermissions();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Front Camera Verification</Text>

      {!permission ? (
        <Text style={styles.message}>Checking camera permission...</Text>
      ) : !permission.granted ? (
        <View style={styles.content}>
          <Text style={styles.message}>
            Camera access is needed to show your face in the app.
          </Text>
          <Button onPress={() => void requestPermission()}>Allow Camera</Button>
        </View>
      ) : (
        <CameraView style={styles.camera} facing="front" active />
      )}

      <Text style={styles.note}>
        Camera preview only. No facial data is saved or sent.
      </Text>

      <Button onPress={onBack} variant="outline">
        Back
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 20,
    gap: 16,
  },
  title: {
    color: colors.foreground,
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    gap: 16,
  },
  message: {
    color: colors.foreground,
    textAlign: "center",
  },
  camera: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
  },
  note: {
    color: colors.mutedForeground,
    textAlign: "center",
    fontSize: 12,
  },
});
