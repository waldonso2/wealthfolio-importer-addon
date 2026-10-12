// @vitest-environment jsdom
// The pages render with a faked addon context: settings load, the accounts show up, the wizard starts at the upload.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setFallbackLanguage } from "./i18n";
import { ImportPage } from "./ImportPage";
import { SettingsPage } from "./SettingsPage";

afterEach(() => {
  cleanup();
  setFallbackLanguage("en");
});

function fakeContext(settings: object | null = null): AddonContext {
  const account = (id: string, name: string) => ({ id, name, currency: "EUR", isActive: true, isArchived: false });
  return {
    api: {
      accounts: { getAll: vi.fn().mockResolvedValue([account("cash", "Test Cash"), account("depot", "Test Depot")]) },
      secrets: {
        get: vi.fn().mockResolvedValue(settings ? JSON.stringify(settings) : null),
        set: vi.fn().mockResolvedValue(undefined),
      },
      activities: {
        getAll: vi.fn().mockResolvedValue([]),
        // Wealthfolio's check returns the activities, validated.
        checkImport: vi.fn().mockImplementation(async (activities: unknown[]) => activities),
        create: vi.fn(),
        update: vi.fn(),
      },
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

describe("SettingsPage in German", () => {
  it("follows the language with the German texts", async () => {
    setFallbackLanguage("de");
    const ctx = fakeContext();
    render(<SettingsPage ctx={ctx} />);
    expect(await screen.findByText("Trade-Republic-Konten")).toBeTruthy();
    expect(screen.getByText("Trade Republic Verrechnungskonto")).toBeTruthy();
    expect(screen.queryByText("Trade Republic accounts")).toBeNull();
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

// A Trade Republic CSV with one deposit: no securities to map, straight to the review.
const DEPOSIT_CSV = [
  '"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id","counterparty_name","counterparty_iban","payment_reference","mcc_code"',
  '"2024-01-15T10:40:16.000000Z","2024-01-15","DEFAULT","CASH","CUSTOMER_INBOUND","","Jane Doe","","","","1000.000000","","","EUR","","","","No SEPA description provided","00000000-0000-0000-0000-000000000001","Jane Doe","ES7611110001280001000151","",""',
].join("\n");

async function uploadDeposit(ctx: AddonContext, container: HTMLElement) {
  await waitFor(() => expect(ctx.api.accounts.getAll).toHaveBeenCalled());
  const input = container.querySelector("input[type=file]") as HTMLInputElement;
  const file = new File([DEPOSIT_CSV], "deposit.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => DEPOSIT_CSV });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ImportPage review", () => {
  it("shows the Wealthfolio account's name, not a fixed one", async () => {
    const ctx = fakeContext({ cashAccountId: "cash", portfolioAccountId: "depot" });
    const { container } = render(<ImportPage ctx={ctx} />);
    await uploadDeposit(ctx, container);
    expect(await screen.findByText("Review activities", {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getAllByText("Test Cash").length).toBeGreaterThan(0);
    expect(screen.queryByText("TR Cash")).toBeNull();
  });

  it("falls back to a generic label when the account is unknown", async () => {
    const ctx = fakeContext({ cashAccountId: "gone", portfolioAccountId: "depot" });
    const { container } = render(<ImportPage ctx={ctx} />);
    await uploadDeposit(ctx, container);
    expect(await screen.findByText("Review activities", {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getAllByText("Cash account (Trade Republic)").length).toBeGreaterThan(0);
  });

  it("speaks German", async () => {
    setFallbackLanguage("de");
    const ctx = fakeContext({ cashAccountId: "cash", portfolioAccountId: "depot" });
    const { container } = render(<ImportPage ctx={ctx} />);
    expect(await screen.findByText(/CSV-Export oder beliebig viele PDF-Belege/)).toBeTruthy();
    await uploadDeposit(ctx, container);
    expect(await screen.findByText("Aktivitäten prüfen", {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText("1 Aktivität importieren")).toBeTruthy();
  });
});
