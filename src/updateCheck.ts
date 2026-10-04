import type { AddonContext } from "@wealthfolio/addon-sdk";

// Checks GitHub for a newer release of this addon. Wealthfolio only offers
// in-app updates for addons listed in its own store, so this is how users of
// the GitHub release ZIP learn about new versions. Installing stays manual
// (Settings → Add-ons → Install from File).

export const RELEASES_API_URL =
  "https://api.github.com/repos/waldonso2/wealthfolio-importer-addon/releases/latest";
export const RELEASES_PAGE_URL = "https://github.com/waldonso2/wealthfolio-importer-addon/releases/latest";
const ZIP_ASSET_NAME = "broker-importer-addon.zip";

const CACHE_KEY = "update-check";
// GitHub's unauthenticated API allows 60 requests/hour; once a day is plenty.
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface LatestRelease {
  version: string;
  pageUrl: string;
  zipUrl?: string;
}

export interface UpdateInfo extends LatestRelease {
  currentVersion: string;
}

interface CacheEntry {
  checkedAt: number;
  latest: LatestRelease;
}

function parts(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, "")
    .split(/[-+]/)[0]
    .split(".")
    .map((p) => Number.parseInt(p, 10) || 0);
}

// Numeric semver comparison of MAJOR.MINOR.PATCH (pre-release suffixes ignored).
// Returns > 0 when a is newer than b.
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Parses the body of GitHub's "latest release" endpoint; null if unusable.
export function parseLatestRelease(body: string): LatestRelease | null {
  try {
    const json = JSON.parse(body) as {
      tag_name?: unknown;
      html_url?: unknown;
      assets?: { name?: unknown; browser_download_url?: unknown }[];
    };
    if (typeof json.tag_name !== "string" || !json.tag_name.trim()) return null;
    const zip = (json.assets ?? []).find((a) => a.name === ZIP_ASSET_NAME);
    return {
      version: json.tag_name.trim().replace(/^v/i, ""),
      pageUrl: typeof json.html_url === "string" ? json.html_url : RELEASES_PAGE_URL,
      zipUrl: typeof zip?.browser_download_url === "string" ? zip.browser_download_url : undefined,
    };
  } catch {
    return null;
  }
}

async function readCache(ctx: AddonContext): Promise<CacheEntry | null> {
  try {
    const raw = await ctx.api.storage.get(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    return typeof entry?.checkedAt === "number" && entry.latest?.version ? entry : null;
  } catch {
    return null;
  }
}

async function fetchLatest(ctx: AddonContext): Promise<LatestRelease | null> {
  const res = await ctx.api.network.request({
    url: RELEASES_API_URL,
    method: "GET",
    headers: { Accept: "application/vnd.github+json", "User-Agent": "broker-importer-addon" },
  });
  if (res.status < 200 || res.status >= 300) return null;
  return parseLatestRelease(res.body);
}

// Returns update info when a newer release exists, otherwise null. Never throws:
// a missing network approval, no connection or a GitHub error just means no hint.
export async function checkForUpdate(
  ctx: AddonContext,
  currentVersion: string,
  now: number = Date.now(),
): Promise<UpdateInfo | null> {
  try {
    let latest: LatestRelease | null = null;
    const cached = await readCache(ctx);
    if (cached && now - cached.checkedAt < CHECK_INTERVAL_MS) {
      latest = cached.latest;
    } else {
      latest = await fetchLatest(ctx);
      if (latest) {
        await ctx.api.storage.set(CACHE_KEY, JSON.stringify({ checkedAt: now, latest } satisfies CacheEntry));
      } else if (cached) {
        latest = cached.latest;
      }
    }
    if (!latest || compareVersions(latest.version, currentVersion) <= 0) return null;
    return { ...latest, currentVersion };
  } catch (e) {
    ctx.api.logger.debug(`Update check failed: ${String(e)}`);
    return null;
  }
}
