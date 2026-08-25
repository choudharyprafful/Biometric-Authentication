import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Image, Modal, Pressable } from 'react-native';
import { listUploads, getUpload, deleteUpload, pickAndUploadFile, downloadAndShare, base64ToUtf8, type UploadMeta, type UploadContent } from '../lib/uploads';
import { Card, Button, Badge, Centered } from '../components/ui';
import { colors, fonts } from '../theme';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadsScreen() {
  const [uploads, setUploads] = useState<UploadMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [preview, setPreview] = useState<UploadContent | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    listUploads()
      .then(setUploads)
      .catch((err) => setError(err?.message || 'Failed to load the data vault.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handlePick = async () => {
    setError('');
    setUploading(true);
    try {
      const result = await pickAndUploadFile();
      if (result) refresh();
    } catch (err: any) {
      setError(err?.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handlePreview = async (meta: UploadMeta) => {
    setBusyId(meta.id);
    setError('');
    try {
      setPreview(await getUpload(meta.id));
    } catch (err: any) {
      setError(err?.message || 'Failed to load file.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDownload = async (meta: UploadMeta) => {
    setBusyId(meta.id);
    setError('');
    try {
      const content = await getUpload(meta.id);
      await downloadAndShare(content);
    } catch (err: any) {
      setError(err?.message || 'Download failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (meta: UploadMeta) => {
    setBusyId(meta.id);
    setError('');
    try {
      await deleteUpload(meta.id);
      refresh();
    } catch (err: any) {
      setError(err?.message || 'Delete failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.intro}>
        Files are AES-256-GCM encrypted at rest and only ever decrypted for you, the uploader — not even an admin
        can read them.
      </Text>

      <Button onPress={handlePick} isLoading={uploading} style={{ marginBottom: 20 }}>
        Upload File
      </Button>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <Centered><ActivityIndicator color={colors.primary} /></Centered>
      ) : uploads.length === 0 ? (
        <Text style={styles.emptyText}>No files yet.</Text>
      ) : (
        uploads.map((u) => {
          const busy = busyId === u.id;
          return (
            <Card key={u.id} style={styles.fileCard}>
              <View style={styles.fileTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fileName} numberOfLines={1}>{u.fileName}</Text>
                  <Text style={styles.fileMeta}>{formatSize(u.sizeBytes)} · {new Date(u.createdAt).toLocaleDateString()}</Text>
                </View>
                <Badge tone="outline">{u.fileType}</Badge>
              </View>
              <View style={styles.actionsRow}>
                <Button size="sm" variant="outline" onPress={() => handlePreview(u)} disabled={busy} style={{ flexGrow: 1 }}>
                  Preview
                </Button>
                <Button size="sm" variant="outline" onPress={() => handleDownload(u)} disabled={busy} style={{ flexGrow: 1 }}>
                  Share
                </Button>
                <Button size="sm" variant="destructive" onPress={() => handleDelete(u)} disabled={busy} style={{ flexGrow: 1 }}>
                  Delete
                </Button>
              </View>
            </Card>
          );
        })
      )}

      <Modal visible={preview !== null} animationType="slide" onRequestClose={() => setPreview(null)}>
        <View style={styles.previewContainer}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewTitle} numberOfLines={1}>{preview?.fileName}</Text>
            <Pressable onPress={() => setPreview(null)} hitSlop={12}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <View style={styles.previewBody}>
            {preview?.fileType === 'image' && (
              <Image
                source={{ uri: `data:${preview.mimeType};base64,${preview.dataBase64}` }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            )}
            {preview?.fileType === 'text' && (
              <ScrollView style={styles.previewTextScroll}>
                <Text style={styles.previewText}>{base64ToUtf8(preview.dataBase64)}</Text>
              </ScrollView>
            )}
            {(preview?.fileType === 'video' || preview?.fileType === 'audio') && (
              <Text style={styles.previewUnsupported}>
                {preview.fileType === 'video' ? 'Video' : 'Audio'} preview isn't supported inline — use Share to open
                it in another app.
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
  intro: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 11, lineHeight: 17, marginBottom: 16 },
  errorText: { fontFamily: fonts.mono, color: colors.destructive, fontSize: 11, marginBottom: 12 },
  emptyText: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 12, textAlign: 'center', marginTop: 8 },
  fileCard: { marginBottom: 12 },
  fileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  fileName: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 12, marginBottom: 4 },
  fileMeta: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 9 },
  actionsRow: { flexDirection: 'row', gap: 6 },
  previewContainer: { flex: 1, backgroundColor: colors.background },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  previewTitle: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 13, flex: 1, marginRight: 12 },
  closeText: { fontFamily: fonts.mono, color: colors.primary, fontSize: 12, textTransform: 'uppercase' },
  previewBody: { flex: 1, padding: 20 },
  previewImage: { flex: 1 },
  previewTextScroll: { flex: 1 },
  previewText: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 11, lineHeight: 17 },
  previewUnsupported: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 12, textAlign: 'center', marginTop: 40 },
});
