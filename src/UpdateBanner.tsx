import { useEffect, useState } from "react";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import { Icons } from "@wealthfolio/ui";
import { version as installedVersion } from "../manifest.json";
import { checkForUpdate, type UpdateInfo } from "./updateCheck";

// The addon iframe is sandboxed without popups or top-level navigation, so
// external links can't be opened from here. The download URL is shown as
// selectable text for the user to copy into a browser instead.
function CopyableUrl({ url }: { url: string }) {
  return (
    <input
      readOnly
      value={url}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.currentTarget.select()}
      className="bg-background w-full rounded border px-2 py-1 font-mono text-[11px]"
    />
  );
}

export function UpdateBanner({ ctx }: { ctx: AddonContext }) {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkForUpdate(ctx, installedVersion).then((u) => {
      if (!cancelled) setUpdate(u);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  if (!update) return null;

  return (
    <div className="mx-6 mt-4 flex max-w-3xl gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-400/25 dark:bg-blue-400/10">
      <Icons.Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-medium">
          Version {update.version} is available (installed: {update.currentVersion}).
        </p>
        <p className="text-muted-foreground text-xs">
          Download the ZIP in your browser, then install it via Settings → Add-ons → Install from
          File. Your settings are kept.
        </p>
        <CopyableUrl url={update.zipUrl ?? update.pageUrl} />
        {update.zipUrl && (
          <p className="text-muted-foreground text-xs">
            Release notes: <span className="font-mono">{update.pageUrl}</span>
          </p>
        )}
      </div>
    </div>
  );
}
