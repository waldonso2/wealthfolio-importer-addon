import { useEffect, useState } from "react";
import type { ActivityDetails, AddonContext } from "@wealthfolio/addon-sdk";
import { Button, Icons } from "@wealthfolio/ui";
import { errorMessage } from "./importer";
import {
  activitiesOnMapping,
  likelyOfSecurity,
  mappingAsset,
  mappingLabel,
  mappingWarning,
  remapActivities,
  type RemapRun,
} from "./remap";
import { TickerSearchInput } from "./SecurityMappingStep";
import type { SecurityMapping } from "./types";

// Changing a saved ISIN mapping (#41): pick the new asset, then choose which of
// the activities on the old asset belong to this ISIN and move them over.
export function RemapPanel({
  ctx,
  isin,
  name,
  current,
  accountIds,
  accountName,
  onDone,
  onCancel,
}: {
  ctx: AddonContext;
  isin: string;
  name: string;
  current: SecurityMapping;
  // The securities accounts the addon imports into.
  accountIds: string[];
  accountName: (id: string) => string;
  // Called with the new mapping once it should be saved (activities moved or not).
  onDone: (mapping: SecurityMapping) => void;
  onCancel: () => void;
}) {
  // The mapping as it was when the panel opened: saving the new one doesn't reload the list.
  const [from] = useState(current);
  // A string, so a new array with the same ids doesn't reload the list.
  const accountKey = accountIds.join(",");
  const [target, setTarget] = useState<SecurityMapping | null>(null);
  const [onOld, setOnOld] = useState<ActivityDetails[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState("");
  const [progress, setProgress] = useState<string>("");
  const [run, setRun] = useState<RemapRun | null>(null);

  useEffect(() => {
    let alive = true;
    const ids = accountKey ? accountKey.split(",") : [];
    Promise.all(ids.map((id) => ctx.api.activities.getAll(id)))
      .then((lists) => {
        if (!alive) return;
        const found = activitiesOnMapping(lists.flat(), isin, from, ids);
        setOnOld(found);
        setSelected(new Set(found.filter((a) => likelyOfSecurity(a, name)).map((a) => a.id)));
      })
      .catch((e) => alive && setLoadError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [ctx, isin, from, accountKey, name]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    if (!target) return;
    const chosen = (onOld ?? []).filter((a) => selected.has(a.id));
    if (chosen.length) {
      setProgress(`Moving 0 of ${chosen.length}…`);
      const result = await remapActivities(ctx.api.activities, chosen, mappingAsset(isin, name, target), (d, t) =>
        setProgress(`Moving ${d} of ${t}…`),
      );
      setRun(result);
      setProgress("");
      try {
        await ctx.api.portfolio.update();
        ctx.api.query.invalidateQueries([]);
      } catch {
        // The recalculation also runs on Wealthfolio's next start.
      }
    } else {
      setRun({ moved: 0, failed: [] });
    }
    onDone(target);
  };

  const warning = target ? mappingWarning(isin, name, target) : null;
  const fmtDate = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

  return (
    <div className="bg-muted/30 space-y-3 rounded-md border p-3 text-xs">
      <p>
        <span className="font-mono font-bold">{isin}</span> {name && <span>{name} </span>}is mapped to{" "}
        <strong>{mappingLabel(from)}</strong>. Choose the right asset:
      </p>
      {target ? (
        <div className="flex items-center gap-2">
          <span className="font-medium">New mapping: {mappingLabel(target)}</span>
          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => setTarget(null)}>
            <Icons.X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <TickerSearchInput defaultQuery={name || isin} onSelect={setTarget} ctx={ctx} />
          <Button size="sm" variant="ghost" className="h-8 shrink-0 gap-1 px-2" onClick={() => setTarget("custom")}>
            <Icons.Tag className="h-3 w-3" />
            Custom
          </Button>
        </div>
      )}
      {warning && (
        <p className="text-amber-700 dark:text-amber-300">
          <Icons.AlertTriangle className="mr-1 inline h-3 w-3" />
          Check this mapping too: {warning}.
        </p>
      )}

      <div className="space-y-1">
        <p className="font-medium">Activities on {mappingLabel(from)}</p>
        {loadError && <p className="text-destructive">Could not read the activities: {loadError}</p>}
        {!onOld && !loadError && <p className="text-muted-foreground">Loading…</p>}
        {onOld && onOld.length === 0 && <p className="text-muted-foreground italic">None.</p>}
        {onOld && onOld.length > 0 && (
          <>
            <p className="text-muted-foreground">
              Other ISINs may be booked on the same asset (e.g. its real product). Select only the activities of{" "}
              {isin}
              {name ? " — preselected: those whose comment names it" : ""}. Cash transfers stay as they are.
            </p>
            <div className="max-h-72 overflow-auto rounded border">
              <table className="w-full">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="w-6 p-1"></th>
                    <th className="p-1 text-left">Date</th>
                    <th className="p-1 text-left">Account</th>
                    <th className="p-1 text-left">Type</th>
                    <th className="p-1 text-right">Shares</th>
                    <th className="p-1 text-right">Amount</th>
                    <th className="p-1 text-left">Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {onOld.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="p-1">
                        <input
                          type="checkbox"
                          aria-label="move"
                          checked={selected.has(a.id)}
                          onChange={() => toggle(a.id)}
                          disabled={!!progress || !!run}
                        />
                      </td>
                      <td className="p-1 font-mono">{fmtDate(a.date)}</td>
                      <td className="p-1">{accountName(a.accountId)}</td>
                      <td className="p-1">{a.activityType}</td>
                      <td className="p-1 text-right font-mono">{a.quantity}</td>
                      <td className="p-1 text-right font-mono">
                        {a.amount} {a.currency}
                      </td>
                      <td className="text-muted-foreground max-w-xs truncate p-1">{a.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {run && (
        <div>
          <p>
            Moved {run.moved} {run.moved === 1 ? "activity" : "activities"}
            {run.failed.length > 0 && `, ${run.failed.length} failed`}.
          </p>
          {run.failed.map((f) => (
            <p key={f.activity.id} className="text-destructive">
              {fmtDate(f.activity.date)} {f.activity.activityType} {f.activity.quantity}: {f.error}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        {!run && (
          <>
            <Button size="sm" onClick={apply} disabled={!target || !!progress || (!onOld && !loadError)}>
              {selected.size > 0
                ? `Save mapping and move ${selected.size} ${selected.size === 1 ? "activity" : "activities"}`
                : "Save mapping"}
            </Button>
            <Button size="sm" variant="outline" onClick={onCancel} disabled={!!progress}>
              Cancel
            </Button>
          </>
        )}
        {run && (
          <Button size="sm" variant="outline" onClick={onCancel}>
            Close
          </Button>
        )}
        {progress && <span className="text-muted-foreground">{progress}</span>}
      </div>
    </div>
  );
}
