import React, { useRef, useState } from 'react';
import {
  useListUploads,
  useCreateUpload,
  useDeleteUpload,
  getUpload,
  getListUploadsQueryKey,
  UploadMeta,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Button, Card } from '../components/ui';
import { Loader2, Lock, FileText, ImageIcon, Video, Music, Upload as UploadIcon, Download, Trash2, Eye, X } from 'lucide-react';
import { format } from 'date-fns';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // must match artifacts/api-server/src/routes/uploads.ts
const ACCEPTED_TYPES = 'image/*,video/*,audio/*,text/plain';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeIcon(fileType: string) {
  switch (fileType) {
    case 'image': return ImageIcon;
    case 'video': return Video;
    case 'audio': return Music;
    default: return FileText;
  }
}

// data:<mime>;base64,<payload> — we only need the payload.
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function base64ToBytes(dataBase64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function triggerDownload(dataBase64: string, mimeType: string, fileName: string): void {
  const blob = new Blob([base64ToBytes(dataBase64)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

interface PreviewState {
  meta: UploadMeta;
  objectUrl: string | null;
  text: string | null;
}

export default function Uploads() {
  const queryClient = useQueryClient();
  const { data: uploads, isLoading } = useListUploads();
  const createMutation = useCreateUpload();
  const deleteMutation = useDeleteUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [previewingId, setPreviewingId] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');

    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`File too large — max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`);
      return;
    }

    try {
      const dataBase64 = await readAsBase64(file);
      await createMutation.mutateAsync({
        data: {
          fileName: file.name,
          mimeType: file.type || 'text/plain',
          dataBase64,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListUploadsQueryKey() });
    } catch (err: any) {
      setError(err?.data?.error || 'Upload failed.');
    }
  };

  const handleDownload = async (id: number, fileName: string, mimeType: string) => {
    setError('');
    setDownloadingId(id);
    try {
      const content = await getUpload(id);
      triggerDownload(content.dataBase64, mimeType, fileName);
    } catch (err: any) {
      setError(err?.data?.error || 'Download failed.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handlePreview = async (upload: UploadMeta) => {
    setError('');
    setPreviewingId(upload.id);
    try {
      const content = await getUpload(upload.id);
      if (upload.fileType === 'text') {
        setPreview({ meta: upload, objectUrl: null, text: atob(content.dataBase64) });
      } else {
        const blob = new Blob([base64ToBytes(content.dataBase64)], { type: upload.mimeType });
        setPreview({ meta: upload, objectUrl: URL.createObjectURL(blob), text: null });
      }
    } catch (err: any) {
      setError(err?.data?.error || 'Preview failed.');
    } finally {
      setPreviewingId(null);
    }
  };

  const closePreview = () => {
    if (preview?.objectUrl) URL.revokeObjectURL(preview.objectUrl);
    setPreview(null);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListUploadsQueryKey() });
    } catch (err: any) {
      setError(err?.data?.error || 'Delete failed.');
    }
  };

  return (
    <div className="space-y-6 h-full flex flex-col relative">
      <div className="flex items-end justify-between border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-3">
            <Lock className="w-8 h-8 text-primary" />
            Encrypted Data Vault
          </h1>
          <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-2">
            Text, image, video &amp; audio files — AES-256-GCM encrypted at rest, visible only to you
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={handleFileSelect}
          data-testid="input-file-upload"
        />
        <Button onClick={() => fileInputRef.current?.click()} isLoading={createMutation.isPending} data-testid="button-upload">
          <UploadIcon className="w-4 h-4 mr-2" /> Upload File
        </Button>
      </div>

      {error && <p className="text-destructive font-mono text-xs uppercase tracking-wider">{error}</p>}

      <div className="flex-1 overflow-hidden flex flex-col border border-border bg-card">
        {isLoading ? (
          <div className="flex-1 flex justify-center items-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-sm border-b border-border">
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uploads?.map((upload) => {
                  const Icon = fileTypeIcon(upload.fileType);
                  return (
                    <TableRow key={upload.id}>
                      <TableCell className="font-mono text-sm text-foreground flex items-center gap-2">
                        <Icon className="w-4 h-4 text-primary/70 shrink-0" />
                        {upload.fileName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{upload.fileType}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatBytes(upload.sizeBytes)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(upload.createdAt), 'MMM dd, yyyy HH:mm')}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            isLoading={previewingId === upload.id}
                            onClick={() => handlePreview(upload)}
                            title="View"
                            data-testid={`button-preview-upload-${upload.id}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            isLoading={downloadingId === upload.id}
                            onClick={() => handleDownload(upload.id, upload.fileName, upload.mimeType)}
                            title="Download"
                            data-testid={`button-download-upload-${upload.id}`}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(upload.id)}
                            title="Delete"
                            data-testid={`button-delete-upload-${upload.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive/70" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!uploads || uploads.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center font-mono text-muted-foreground uppercase tracking-widest">
                      Vault is empty.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-2xl max-h-[85vh] flex flex-col border-primary shadow-[0_0_30px_rgba(0,220,255,0.1)] relative">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h2 className="text-lg font-mono uppercase tracking-widest text-foreground truncate pr-4">
                {preview.meta.fileName}
              </h2>
              <Button variant="ghost" size="icon" onClick={closePreview} data-testid="button-close-preview">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="overflow-auto flex-1 flex items-center justify-center bg-background/40 border border-border p-4">
              {preview.meta.fileType === 'image' && preview.objectUrl && (
                <img src={preview.objectUrl} alt={preview.meta.fileName} className="max-w-full max-h-full object-contain" />
              )}
              {preview.meta.fileType === 'video' && preview.objectUrl && (
                <video src={preview.objectUrl} controls className="max-w-full max-h-full" />
              )}
              {preview.meta.fileType === 'audio' && preview.objectUrl && (
                <audio src={preview.objectUrl} controls className="w-full" />
              )}
              {preview.meta.fileType === 'text' && preview.text !== null && (
                <pre className="w-full font-mono text-xs text-foreground whitespace-pre-wrap break-words">{preview.text}</pre>
              )}
            </div>
            <div className="flex justify-end mt-4 shrink-0">
              <Button
                variant="outline"
                onClick={() => handleDownload(preview.meta.id, preview.meta.fileName, preview.meta.mimeType)}
                isLoading={downloadingId === preview.meta.id}
              >
                <Download className="w-4 h-4 mr-2" /> Download
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
