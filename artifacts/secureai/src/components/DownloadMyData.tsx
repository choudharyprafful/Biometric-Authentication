import React, { useState } from "react";
import {
  exportMyData,
  exportMyDataReadable,
} from "@workspace/api-client-react";
import { Download, FileText } from "lucide-react";
import { Button } from "./ui";

type Format = "readable" | "json";

function save(content: string, type: string, extension: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `secureai-data-${new Date().toISOString().slice(0, 10)}.${extension}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Privacy policy section 11: a copy of your data, either as a page anyone can read, print or save as
// a PDF (GET /users/me/export/readable), or as a JSON file for moving it to another service
// (GET /users/me/export). Both count towards the same limit of 5 downloads an hour.
export function DownloadMyData() {
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState("");

  const download = async (format: Format) => {
    setBusy(format);
    setError("");
    try {
      if (format === "readable") {
        save(await exportMyDataReadable(), "text/html", "html");
      } else {
        save(
          JSON.stringify(await exportMyData(), null, 2),
          "application/json",
          "json",
        );
      }
    } catch (err: any) {
      setError(
        err?.data?.error || "The download failed. Try again in a moment.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => download("readable")}
          isLoading={busy === "readable"}
          disabled={busy !== null}
          data-testid="button-download-my-data-readable"
        >
          <FileText className="w-4 h-4 mr-2" /> Download a readable copy
        </Button>
        <Button
          variant="outline"
          onClick={() => download("json")}
          isLoading={busy === "json"}
          disabled={busy !== null}
          data-testid="button-download-my-data"
        >
          <Download className="w-4 h-4 mr-2" /> Download as a data file (JSON)
        </Button>
      </div>
      {error && <p className="text-destructive font-mono text-xs">{error}</p>}
    </div>
  );
}
