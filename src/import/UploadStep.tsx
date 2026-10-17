// The wizard's first page: drop a file, or go on with the one read before (#78).
import React, { useCallback, useRef, useState } from "react";
import { Button, Icons } from "@wealthfolio/ui";
import { FORMAT_LABEL } from "../formats";
import { textOf, useT } from "../i18n";
import type { WizardState } from "../wizard";

// ─── UploadZone ─────────────────────────────────────────────────────────────

function UploadZone({ onFiles, error, busy }: { onFiles: (f: File[]) => void; error: string; busy: string }) {
  const { t } = useT();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    },
    [onFiles],
  );
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      // The file input is hidden: the zone itself is the button, also for the keyboard.
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={`cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
        dragging
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/30 hover:border-primary/50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          e.target.value = "";
        }}
      />
      <Icons.Upload className="text-muted-foreground mx-auto mb-3 h-8 w-8" />
      <p className="text-sm font-medium">{t("upload.drop")}</p>
      <p className="text-muted-foreground mt-1 text-xs">{t("upload.browse")}</p>
      {busy && <p className="text-muted-foreground mt-3 text-xs">{busy}</p>}
      {error && <p className="text-destructive mt-3 text-xs">{error}</p>}
    </div>
  );
}

export function UploadStep({
  state,
  onFiles,
  onContinue,
  onOtherFile,
}: {
  state: WizardState;
  onFiles: (files: File[]) => void;
  onContinue: () => void;
  onOtherFile: () => void;
}) {
  const { t } = useT();
  const { parsed, fileError, reading } = state;
  const fileErrorText = fileError ? textOf(t, fileError.text, fileError.key, fileError.params) : "";
  return (
    <div className="max-w-xl space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("upload.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("upload.intro")}</p>
      </div>
      {parsed ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg border p-4">
            <Icons.FileText className="text-muted-foreground h-8 w-8 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{parsed.fileName}</p>
              <p className="text-muted-foreground text-xs">
                {`${FORMAT_LABEL[parsed.format]} · `}
                {t("upload.parsed", { count: parsed.result.activities.length })}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={onContinue}>
              {t("common.continue")}
            </Button>
            <Button variant="outline" onClick={onOtherFile}>
              {t("upload.otherFile")}
            </Button>
          </div>
          {fileErrorText && <p className="text-destructive text-xs">{fileErrorText}</p>}
        </div>
      ) : (
        <UploadZone onFiles={onFiles} error={fileErrorText} busy={reading} />
      )}
    </div>
  );
}
