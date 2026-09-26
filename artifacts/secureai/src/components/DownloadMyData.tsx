import React, { useState } from 'react';
import { exportMyData } from '@workspace/api-client-react';
import { Download } from 'lucide-react';
import { Button } from './ui';

// Privacy policy section 11: a copy of your data as a JSON file (GET /users/me/export).
export function DownloadMyData() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `secureai-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.data?.error || 'The download failed. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={download} isLoading={busy} data-testid="button-download-my-data">
        <Download className="w-4 h-4 mr-2" /> Download my data
      </Button>
      {error && <p className="text-destructive font-mono text-xs">{error}</p>}
    </div>
  );
}
