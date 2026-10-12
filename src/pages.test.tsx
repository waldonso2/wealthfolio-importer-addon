// @vitest-environment jsdom
// The pages render with a faked addon context: settings load, the accounts show up, the wizard starts at the upload.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportPage } from "./ImportPage";
import { SettingsPage } from "./SettingsPage";

afterEach(cleanup);

function fakeContext(settings: object | null = null): AddonContext {
  const account = (id: string, name: string) => ({ id, name, currency: "EUR", isActive: true, isArchived: false });
  return {
    api: {
      accounts: { getAll: vi.fn().mockResolvedValue([account("cash", "Test Cash"), account("depot", "Test Depot")]) },
      secrets: {
        get: vi.fn().mockResolvedValue(settings ? JSON.stringify(settings) : null),
        set: vi.fn().mockResolvedValue(undefined),
      },
      activities: { getAll: vi.fn().mockResolvedValue([]), checkImport: vi.fn(), create: vi.fn(), update: vi.fn() },
      portfolio: { update: vi.fn() },
      query: { invalidateQueries: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    },
  } as unknown as AddonContext;
}

describe("SettingsPage", () => {
  it("loads the accounts and shows the account settings", async () => {
    const ctx = fakeContext();
    render(<SettingsPage ctx={ctx} />);
    await waitFor(() => expect(ctx.api.accounts.getAll).toHaveBeenCalled());
    expect((await screen.findAllByText(/Receives buy\/sell trades and dividends/)).length).toBeGreaterThan(0);
  });
});

describe("ImportPage", () => {
  it("starts at the upload step once the settings are loaded", async () => {
    const ctx = fakeContext({ cashAccountId: "cash", portfolioAccountId: "depot" });
    render(<ImportPage ctx={ctx} />);
    await waitFor(() => expect(ctx.api.accounts.getAll).toHaveBeenCalled());
    expect(screen.getByText(/CSV or PDF/i)).toBeTruthy();
  });
});

describe("ImportPage with a Trade Republic CSV", () => {
  it("asks for the securities it doesn't know yet", async () => {
    const ctx = fakeContext({ cashAccountId: "cash", portfolioAccountId: "depot" });
    const { container } = render(<ImportPage ctx={ctx} />);
    await waitFor(() => expect(ctx.api.accounts.getAll).toHaveBeenCalled());
    const csv = readFileSync("src/__fixtures__/tr-sample.csv", "utf8");
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File([csv], "tr-sample.csv", { type: "text/csv" });
    // jsdom's File has no text(); the browser's has.
    Object.defineProperty(file, "text", { value: async () => csv });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText("Map Securities", {}, { timeout: 4000 })).toBeTruthy();
  });
});
