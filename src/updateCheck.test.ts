import type { AddonContext } from "@wealthfolio/addon-sdk";
import { describe, expect, it, vi } from "vitest";
import { CHECK_INTERVAL_MS, checkForUpdate, compareVersions, parseLatestRelease, RELEASES_API_URL } from "./updateCheck";

const RELEASE_BODY = JSON.stringify({
  tag_name: "v2.1.0",
  html_url: "https://github.com/waldonso2/wealthfolio-importer-addon/releases/tag/v2.1.0",
  assets: [
    { name: "addon.js", browser_download_url: "https://example.test/addon.js" },
    { name: "broker-importer-addon.zip", browser_download_url: "https://example.test/broker-importer-addon.zip" },
  ],
});

function fakeCtx(opts: { stored?: string | null; response?: { status: number; body: string }; fail?: boolean } = {}) {
  const store = new Map<string, string>();
  if (opts.stored) store.set("update-check", opts.stored);
  const request = vi.fn(async () => {
    if (opts.fail) throw new Error("host not approved");
    return { status: 200, headers: {}, body: RELEASE_BODY, ...opts.response };
  });
  const ctx = {
    api: {
      network: { request },
      storage: {
        get: vi.fn(async (k: string) => store.get(k) ?? null),
        set: vi.fn(async (k: string, v: string) => void store.set(k, v)),
        delete: vi.fn(async (k: string) => void store.delete(k)),
      },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
    },
  } as unknown as AddonContext;
  return { ctx, request, store };
}

describe("compareVersions", () => {
  it("compares MAJOR.MINOR.PATCH numerically", () => {
    expect(compareVersions("2.1.0", "2.0.2")).toBeGreaterThan(0);
    expect(compareVersions("2.0.10", "2.0.9")).toBeGreaterThan(0);
    expect(compareVersions("v2.0.2", "2.0.2")).toBe(0);
    expect(compareVersions("1.9.9", "2.0.0")).toBeLessThan(0);
    expect(compareVersions("2.1", "2.1.0")).toBe(0);
  });
});

describe("parseLatestRelease", () => {
  it("reads version, release page and ZIP asset", () => {
    expect(parseLatestRelease(RELEASE_BODY)).toEqual({
      version: "2.1.0",
      pageUrl: "https://github.com/waldonso2/wealthfolio-importer-addon/releases/tag/v2.1.0",
      zipUrl: "https://example.test/broker-importer-addon.zip",
    });
  });

  it("returns null for unusable bodies", () => {
    expect(parseLatestRelease("not json")).toBeNull();
    expect(parseLatestRelease(JSON.stringify({ message: "Not Found" }))).toBeNull();
  });
});

describe("checkForUpdate", () => {
  const NOW = 1_800_000_000_000;

  it("reports a newer release and caches the result", async () => {
    const { ctx, request, store } = fakeCtx();
    const update = await checkForUpdate(ctx, "2.0.2", NOW);
    expect(update).toMatchObject({ version: "2.1.0", currentVersion: "2.0.2" });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: RELEASES_API_URL, method: "GET" }));
    expect(JSON.parse(store.get("update-check")!).checkedAt).toBe(NOW);
  });

  it("returns null when the installed version is current or newer", async () => {
    expect(await checkForUpdate(fakeCtx().ctx, "2.1.0", NOW)).toBeNull();
    expect(await checkForUpdate(fakeCtx().ctx, "3.0.0", NOW)).toBeNull();
  });

  it("uses a fresh cache without calling the network", async () => {
    const stored = JSON.stringify({ checkedAt: NOW - 1000, latest: { version: "2.2.0", pageUrl: "p" } });
    const { ctx, request } = fakeCtx({ stored });
    expect(await checkForUpdate(ctx, "2.0.2", NOW)).toMatchObject({ version: "2.2.0" });
    expect(request).not.toHaveBeenCalled();
  });

  it("refreshes a stale cache", async () => {
    const stored = JSON.stringify({ checkedAt: NOW - CHECK_INTERVAL_MS - 1, latest: { version: "2.0.5", pageUrl: "p" } });
    const { ctx, request } = fakeCtx({ stored });
    expect(await checkForUpdate(ctx, "2.0.2", NOW)).toMatchObject({ version: "2.1.0" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("never throws: a blocked request or HTTP error yields no hint", async () => {
    expect(await checkForUpdate(fakeCtx({ fail: true }).ctx, "2.0.2", NOW)).toBeNull();
    expect(await checkForUpdate(fakeCtx({ response: { status: 403, body: "{}" } }).ctx, "2.0.2", NOW)).toBeNull();
  });
});
