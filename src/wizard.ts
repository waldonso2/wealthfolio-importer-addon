// The import wizard's state and its transitions (#78): a pure reducer, tested like importer.ts. The pages
// (src/import/) show a state, ImportPage.tsx runs the async work and dispatches what happened.
import type { ActivityImport } from "@wealthfolio/addon-sdk";
import type { ImportFormat } from "./formats";
import type { Params } from "./i18n";
import type { FailedActivity } from "./importer";
import type { SecurityInfo, SecurityMapping } from "./SecurityMappingStep";
import { isCashSymbol } from "./common";
import type { TransformResult } from "./types";

export type Step = "upload" | "asset-review" | "checking" | "confirm" | "importing" | "done";

// A text for the UI: English, and its translation key when it has one.
export interface UiText {
  text: string;
  key?: string;
  params?: Params;
}

// A file read and transformed, until another file or a restart.
export interface Parsed {
  result: TransformResult;
  format: ImportFormat;
  brokerCash: { currency: string; amount: number } | null;
  fileName: string;
  fromPdf: boolean;
}

// What an import did (#11).
export interface ImportOutcome {
  total: number;
  imported: number;
  // Of `imported`: existing activities that were updated.
  updated: number;
  userSkipped: number;
  failed: FailedActivity[];
  // Kept so a retry sends the failed activities with their sourceGroupId.
  groupIdByLine: Map<number, string>;
}

export interface WizardState {
  step: Step;
  parsed: Parsed | null;
  securities: SecurityInfo[];
  mappings: Map<string, SecurityMapping>;
  // While PDFs are read: what the upload zone says.
  reading: string;
  fileError: UiText | null;
  checked: ActivityImport[] | null;
  // Lines the user skips; at first those already in Wealthfolio from another source.
  excluded: Set<number>;
  // Lines already in Wealthfolio (e.g. CSV vs. PDF), each mapped to all lines of its transaction.
  existing: Map<number, number[]>;
  checkError: string;
  matchError: string;
  duplicatesOnly: boolean;
  progress: number;
  outcome: ImportOutcome | null;
  retrying: boolean;
}

export const INITIAL: WizardState = {
  step: "upload",
  parsed: null,
  securities: [],
  mappings: new Map(),
  reading: "",
  fileError: null,
  checked: null,
  excluded: new Set(),
  existing: new Map(),
  checkError: "",
  matchError: "",
  duplicatesOnly: false,
  progress: 0,
  outcome: null,
  retrying: false,
};

export type Action =
  | { type: "reading"; text: string }
  | { type: "fileError"; error: UiText | null }
  | { type: "parsed"; parsed: Parsed; securities: SecurityInfo[]; mappings: Map<string, SecurityMapping> }
  | { type: "review" }
  | { type: "mappings"; mappings: Map<string, SecurityMapping> }
  | { type: "checking" }
  | {
      type: "checked";
      checked: ActivityImport[];
      existing: Map<number, number[]>;
      checkError: string;
      matchError: string;
    }
  | { type: "toggleLines"; lines: number[] }
  | { type: "toggleDuplicatesOnly" }
  | { type: "importing" }
  | { type: "progress"; value: number }
  | { type: "imported"; outcome: ImportOutcome }
  | { type: "importFailed"; error: string }
  | { type: "retrying" }
  | { type: "retried"; outcome: ImportOutcome | null }
  | { type: "backToUpload" }
  | { type: "backFromReview" }
  | { type: "reset" };

// Skips the lines, or includes them all again when all are skipped (a transaction and its legs together).
function toggled(excluded: Set<number>, lines: number[]): Set<number> {
  const next = new Set(excluded);
  const allExcluded = lines.every((ln) => next.has(ln));
  for (const ln of lines) {
    if (allExcluded) next.delete(ln);
    else next.add(ln);
  }
  return next;
}

export function wizard(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "reading":
      return { ...state, reading: action.text };
    case "fileError":
      return { ...state, fileError: action.error };
    case "parsed":
      // A new file: nothing of the previous one's review stays.
      return {
        ...state,
        parsed: action.parsed,
        securities: action.securities,
        mappings: action.mappings,
        fileError: null,
        checked: null,
        excluded: new Set(),
        existing: new Map(),
        duplicatesOnly: false,
        checkError: "",
      };
    case "review":
      return { ...state, step: "asset-review" };
    case "mappings":
      return { ...state, mappings: action.mappings };
    case "checking":
      return { ...state, step: "checking" };
    case "checked":
      return {
        ...state,
        step: "confirm",
        checked: action.checked,
        existing: action.existing,
        excluded: new Set(action.existing.keys()),
        checkError: action.checkError,
        matchError: action.matchError,
      };
    case "toggleLines":
      return { ...state, excluded: toggled(state.excluded, action.lines) };
    case "toggleDuplicatesOnly":
      return { ...state, duplicatesOnly: !state.duplicatesOnly };
    case "importing":
      return { ...state, step: "importing", progress: 0 };
    case "progress":
      return { ...state, progress: action.value };
    case "imported":
      return { ...state, step: "done", progress: 100, outcome: action.outcome };
    case "importFailed":
      return { ...state, step: "confirm", checkError: action.error };
    case "retrying":
      return { ...state, retrying: true };
    case "retried":
      return { ...state, retrying: false, outcome: action.outcome ?? state.outcome };
    case "backToUpload":
      // Keeps the file: "Continue" goes on with it.
      return { ...state, step: "upload", checked: null, checkError: "" };
    case "backFromReview":
      return { ...state, step: state.securities.length > 0 ? "asset-review" : "upload" };
    case "reset":
      return INITIAL;
  }
}

// The securities of a file (non-cash symbols), each with how often it occurs.
export function securitiesOf(result: TransformResult): SecurityInfo[] {
  const found = new Map<string, SecurityInfo>();
  for (const a of result.activities) {
    if (!a.symbol || isCashSymbol(a.symbol)) continue;
    const known = found.get(a.symbol);
    if (known) {
      known.count += 1;
      // Activities are sorted oldest first, so this keeps the most recent
      // name — exports may carry outdated names for older rows.
      if (a.symbolName) known.name = a.symbolName;
    } else {
      found.set(a.symbol, { isin: a.symbol, name: a.symbolName ?? "", count: 1 });
    }
  }
  return Array.from(found.values());
}
