import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
} from "react-native";
import {
  listUploads,
  getUpload,
  deleteUpload,
  pickFile,
  uploadPickedFile,
  declareUploadPeople,
  downloadAndShare,
  base64ToUtf8,
  mediaKind,
  CONTENT_SOURCE_OPTIONS,
  MEDIA_NOTICE,
  type ContentSource,
  type PickedFile,
  type UploadMeta,
  type UploadContent,
} from "../lib/uploads";
import { Card, Button, Badge, Centered } from "../components/ui";
import {
  NO_ANSWER,
  PeopleQuestion,
  answerFrom,
  peopleSummary,
  requestStatus,
  toRequest,
  type PeopleAnswer,
} from "../components/PeopleInFile";
import { ConsentRequestsInbox } from "../components/ConsentRequestsInbox";
import { colors, fonts } from "../theme";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadsScreen() {
  const [uploads, setUploads] = useState<UploadMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [preview, setPreview] = useState<UploadContent | null>(null);
  // Declared provenance for the next upload. Pre-set to own_work as the
  // common case; it is a factual claim about the file, not a consent grant,
  // and training still additionally requires the separate content-
  // personalization consent. The server treats an absent field as
  // "unspecified" and excludes it from training either way.
  const [contentSource, setContentSource] = useState<ContentSource>("own_work");
  // Asked afresh for every upload (Team 2's Bystander Consent Policy): no default answer.
  const [people, setPeople] = useState<PeopleAnswer>(NO_ANSWER);
  const peopleRequest = toRequest(people);
  // A voice recording or video waiting while its notice is read.
  const [pendingMedia, setPendingMedia] = useState<PickedFile | null>(null);
  const [editingPeopleId, setEditingPeopleId] = useState<number | null>(null);
  const [editPeople, setEditPeople] = useState<PeopleAnswer>(NO_ANSWER);

  const refresh = useCallback(() => {
    setLoading(true);
    listUploads()
      .then(setUploads)
      .catch((err) =>
        setError(err?.message || "Failed to load the data vault."),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const upload = async (file: PickedFile) => {
    setPendingMedia(null);
    if (!peopleRequest) {
      setError("Say whether the file shows or names anyone else.");
      return;
    }
    setUploading(true);
    try {
      await uploadPickedFile(file, contentSource, peopleRequest);
      setPeople(NO_ANSWER);
      refresh();
    } catch (err: any) {
      setError(err?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handlePick = async () => {
    setError("");
    if (!peopleRequest) {
      setError("Say whether the file shows or names anyone else.");
      return;
    }
    try {
      const file = await pickFile();
      if (!file) return;
      if (mediaKind(file.mimeType)) setPendingMedia(file);
      else await upload(file);
    } catch (err: any) {
      setError(err?.message || "Upload failed.");
    }
  };

  const savePeople = async (id: number) => {
    const request = toRequest(editPeople);
    if (!request) return;
    setBusyId(id);
    setError("");
    try {
      await declareUploadPeople(id, request);
      setEditingPeopleId(null);
      refresh();
    } catch (err: any) {
      setError(err?.message || "Could not save who the file shows.");
    } finally {
      setBusyId(null);
    }
  };

  const handlePreview = async (meta: UploadMeta) => {
    setBusyId(meta.id);
    setError("");
    try {
      setPreview(await getUpload(meta.id));
    } catch (err: any) {
      setError(err?.message || "Failed to load file.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDownload = async (meta: UploadMeta) => {
    setBusyId(meta.id);
    setError("");
    try {
      const content = await getUpload(meta.id);
      await downloadAndShare(content);
    } catch (err: any) {
      setError(err?.message || "Download failed.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (meta: UploadMeta) => {
    setBusyId(meta.id);
    setError("");
    try {
      await deleteUpload(meta.id);
      refresh();
    } catch (err: any) {
      setError(err?.message || "Delete failed.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.intro}>
        Files are AES-256-GCM encrypted at rest and only ever decrypted for you,
        the uploader — not even an admin can read them.
      </Text>

      <ConsentRequestsInbox />

      {/* Provenance picker. Chips rather than a Picker component so no new
          native dependency is pulled in for five options, and so every choice
          is visible at once instead of hidden behind a dropdown — the whole
          point is that the uploader sees what they are declaring. */}
      <Text style={styles.sourceLabel}>Where is this from?</Text>
      <View style={styles.sourceRow}>
        {CONTENT_SOURCE_OPTIONS.map((opt) => {
          const selected = contentSource === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setContentSource(opt.value)}
              style={[styles.sourceChip, selected && styles.sourceChipOn]}
            >
              <Text
                style={[
                  styles.sourceChipText,
                  selected && styles.sourceChipTextOn,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {contentSource !== "own_work" && (
        <Text style={styles.sourceNote}>
          Content you don't hold the rights to is stored and encrypted as
          normal, but is kept out of AI training.
        </Text>
      )}

      <PeopleQuestion
        value={people}
        onChange={setPeople}
        testIdPrefix="upload"
      />

      {pendingMedia ? (
        <Card style={styles.noticeCard} testID="media-notice">
          <Text style={styles.noticeTitle}>
            {MEDIA_NOTICE[mediaKind(pendingMedia.mimeType) ?? "audio"].title}:{" "}
            {pendingMedia.name}
          </Text>
          <Text style={styles.noticeText}>
            {MEDIA_NOTICE[mediaKind(pendingMedia.mimeType) ?? "audio"].text}
          </Text>
          <View style={styles.actionsRow}>
            <Button
              size="sm"
              onPress={() => void upload(pendingMedia)}
              isLoading={uploading}
              style={{ flexGrow: 1 }}
              testID="media-upload"
            >
              Upload it
            </Button>
            <Button
              size="sm"
              variant="outline"
              onPress={() => setPendingMedia(null)}
              style={{ flexGrow: 1 }}
            >
              Cancel
            </Button>
          </View>
        </Card>
      ) : (
        <Button
          onPress={handlePick}
          isLoading={uploading}
          disabled={!peopleRequest}
          style={{ marginBottom: 20 }}
        >
          Upload File
        </Button>
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <Centered>
          <ActivityIndicator color={colors.primary} />
        </Centered>
      ) : uploads.length === 0 ? (
        <Text style={styles.emptyText}>No files yet.</Text>
      ) : (
        uploads.map((u) => {
          const busy = busyId === u.id;
          return (
            <Card key={u.id} style={styles.fileCard}>
              <View style={styles.fileTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {u.fileName}
                  </Text>
                  <Text style={styles.fileMeta}>
                    {formatSize(u.sizeBytes)} ·{" "}
                    {new Date(u.createdAt).toLocaleDateString()}
                  </Text>
                  {peopleSummary(u.bystanders) ? (
                    <Text
                      style={styles.fileMeta}
                      testID={`upload-people-${u.id}`}
                    >
                      {peopleSummary(u.bystanders)}
                    </Text>
                  ) : null}
                  {u.pausedForReviewAt ? (
                    <Text style={styles.pausedText}>
                      Paused: someone in it asked us to review it
                    </Text>
                  ) : null}
                  {(u.consentRequests ?? []).map((r) => (
                    <Text key={r.email} style={styles.fileMeta}>
                      Asked {r.email}: {requestStatus(r)}
                    </Text>
                  ))}
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Badge tone="outline">{u.fileType}</Badge>
                  {/* Explicit === false, not a falsy check: an older server
                      that predates this field returns undefined, and treating
                      that as "excluded" would badge every file on a backend
                      that simply hasn't been upgraded yet. A client should not
                      assert a server's behaviour from a missing field. */}
                  {u.trainingEligible === false && (
                    <Badge tone="outline">not used for AI</Badge>
                  )}
                </View>
              </View>
              <View style={styles.actionsRow}>
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => handlePreview(u)}
                  disabled={busy}
                  style={{ flexGrow: 1 }}
                >
                  Preview
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => handleDownload(u)}
                  disabled={busy}
                  style={{ flexGrow: 1 }}
                >
                  Share
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => {
                    setEditingPeopleId(u.id);
                    setEditPeople(
                      answerFrom(
                        u.bystanders,
                        u.bystanderStatement,
                        u.consentRequests,
                      ),
                    );
                  }}
                  disabled={busy}
                  style={{ flexGrow: 1 }}
                  testID={`upload-people-edit-${u.id}`}
                >
                  People
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onPress={() => handleDelete(u)}
                  disabled={busy}
                  style={{ flexGrow: 1 }}
                >
                  Delete
                </Button>
              </View>
              {editingPeopleId === u.id ? (
                <View style={styles.editPeople}>
                  <PeopleQuestion
                    value={editPeople}
                    onChange={setEditPeople}
                    testIdPrefix={`edit-${u.id}`}
                  />
                  <View style={styles.actionsRow}>
                    <Button
                      size="sm"
                      onPress={() => void savePeople(u.id)}
                      isLoading={busy}
                      disabled={!toRequest(editPeople)}
                      style={{ flexGrow: 1 }}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onPress={() => setEditingPeopleId(null)}
                      style={{ flexGrow: 1 }}
                    >
                      Cancel
                    </Button>
                  </View>
                </View>
              ) : null}
            </Card>
          );
        })
      )}

      <Modal
        visible={preview !== null}
        animationType="slide"
        onRequestClose={() => setPreview(null)}
      >
        <View style={styles.previewContainer}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewTitle} numberOfLines={1}>
              {preview?.fileName}
            </Text>
            <Pressable onPress={() => setPreview(null)} hitSlop={12}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <View style={styles.previewBody}>
            {preview?.fileType === "image" && (
              <Image
                source={{
                  uri: `data:${preview.mimeType};base64,${preview.dataBase64}`,
                }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            )}
            {preview?.fileType === "text" && (
              <ScrollView style={styles.previewTextScroll}>
                <Text style={styles.previewText}>
                  {base64ToUtf8(preview.dataBase64)}
                </Text>
              </ScrollView>
            )}
            {(preview?.fileType === "video" ||
              preview?.fileType === "audio") && (
              <Text style={styles.previewUnsupported}>
                {preview.fileType === "video" ? "Video" : "Audio"} preview isn't
                supported inline — use Share to open it in another app.
              </Text>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
  intro: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 11,
    lineHeight: 17,
    marginBottom: 16,
  },
  sourceLabel: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  sourceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },
  sourceChip: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sourceChipOn: { borderColor: colors.primary, backgroundColor: colors.card },
  sourceChipText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.mutedForeground,
  },
  sourceChipTextOn: { color: colors.primary },
  sourceNote: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 10,
    lineHeight: 15,
    marginBottom: 14,
  },
  errorText: {
    fontFamily: fonts.mono,
    color: colors.destructive,
    fontSize: 11,
    marginBottom: 12,
  },
  emptyText: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
  },
  fileCard: { marginBottom: 12 },
  fileTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  fileName: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 12,
    marginBottom: 4,
  },
  fileMeta: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 9,
  },
  actionsRow: { flexDirection: "row", gap: 6 },
  editPeople: { marginTop: 12 },
  pausedText: {
    fontFamily: fonts.mono,
    color: colors.warning,
    fontSize: 9,
    marginTop: 2,
  },
  noticeCard: { marginBottom: 20, gap: 10 },
  noticeTitle: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  noticeText: {
    color: colors.mutedForeground,
    fontSize: 12,
    lineHeight: 18,
  },
  previewContainer: { flex: 1, backgroundColor: colors.background },
  previewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  previewTitle: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 13,
    flex: 1,
    marginRight: 12,
  },
  closeText: {
    fontFamily: fonts.mono,
    color: colors.primary,
    fontSize: 12,
    textTransform: "uppercase",
  },
  previewBody: { flex: 1, padding: 20 },
  previewImage: { flex: 1 },
  previewTextScroll: { flex: 1 },
  previewText: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 11,
    lineHeight: 17,
  },
  previewUnsupported: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 12,
    textAlign: "center",
    marginTop: 40,
  },
});
