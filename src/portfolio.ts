// Portfolio model shared by the agent (server) and the dashboard (client):
// types, parsers that turn broker MCP tool results into holdings, and the
// metrics the dashboard and the daily analysis are built from.

export type Source = "kite" | "indmoney" | "demo";
export type Kind = "stock" | "etf" | "mutual_fund" | "us_stock" | "other";

export interface Holding {
  source: Source;
  symbol: string;
  name: string;
  kind: Kind;
  quantity: number;
  /** Amounts are in INR. */
  invested: number;
  value: number;
  /** Today's change in percent, when the broker reports it. */
  dayChangePct: number | null;
}

export type SourceState = "ok" | "needs_login" | "error";

export interface SourceStatus {
  state: SourceState;
  message?: string;
  /** Kite's daily login link, shown on the dashboard when the session expired. */
  loginUrl?: string;
  updatedAt: string;
  count?: number;
}

export interface Analysis {
  createdAt: string;
  headline: string;
  summary: string;
  highlights: string[];
  watch: string[];
}

export interface Totals {
  value: number;
  invested: number;
  gain: number;
  gainPct: number;
  dayChange: number;
  count: number;
}

export interface Slice {
  label: string;
  value: number;
  pct: number;
}

export interface Metrics {
  totals: Totals;
  byKind: Slice[];
  bySource: Slice[];
  top: Array<{ symbol: string; name: string; value: number; pct: number }>;
  gainers: Array<{ symbol: string; gainPct: number }>;
  losers: Array<{ symbol: string; gainPct: number }>;
  /** Largest single position as a share of the portfolio, in percent. */
  concentration: number;
}

export interface HistoryPoint {
  date: string;
  value: number;
  invested: number;
}

/** Everything the dashboard renders. Synced to the browser as agent state. */
export interface DashboardState {
  holdings: Holding[];
  metrics: Metrics | null;
  analysis: Analysis | null;
  sources: Partial<Record<Source, SourceStatus>>;
  history: HistoryPoint[];
  running: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
}

export const EMPTY_STATE: DashboardState = {
  holdings: [],
  metrics: null,
  analysis: null,
  sources: {},
  history: [],
  running: false,
  lastRunAt: null,
  nextRunAt: null,
  lastError: null
};

export const KIND_LABELS: Record<Kind, string> = {
  stock: "Indian stocks",
  etf: "ETFs",
  mutual_fund: "Mutual funds",
  us_stock: "US stocks",
  other: "Other"
};

export const SOURCE_LABELS: Record<Source, string> = {
  kite: "Zerodha (Kite)",
  indmoney: "INDmoney",
  demo: "Demo"
};

// ── MCP result helpers ────────────────────────────────────────────────

interface ToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

/** Concatenated text content of an MCP tool result. */
export function resultText(result: unknown): string {
  const r = result as ToolResult;
  return (r?.content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
}

/** Python MCP servers often wrap a JSON string return value as { result: "<json>" }. */
function unwrap(v: unknown): unknown {
  const inner = (v as { result?: unknown } | null)?.result;
  if (typeof inner === "string") {
    try {
      return JSON.parse(inner);
    } catch {
      return v;
    }
  }
  return v;
}

/** Structured data from an MCP tool result: structuredContent, or JSON in the text. */
export function resultData(result: unknown): unknown {
  const r = result as ToolResult;
  if (r?.structuredContent !== undefined) return unwrap(r.structuredContent);
  const text = resultText(result).trim();
  try {
    return unwrap(JSON.parse(text));
  } catch {
    // Some servers wrap JSON in prose; take the outermost array or object.
    const m = text.match(/[[{][\s\S]*[\]}]/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/** True when a tool result says the broker session has expired or never existed. */
export function needsLogin(result: unknown): boolean {
  const text = resultText(result);
  return (
    /log ?in|session|unauthori[sz]ed|access token|token.*(expired|invalid)/i.test(
      text
    ) && resultData(result) === null
  );
}

export function firstUrl(text: string): string | undefined {
  return text.match(/https?:\/\/[^\s"'<>)\]]+/)?.[0];
}

// ── Parsers ───────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[₹$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  // Some APIs nest amounts: { amount: 123 } or { value: 123 }.
  if (v && typeof v === "object") {
    const o = v as Row;
    return num(o.amount ?? o.value ?? o.inr);
  }
  return null;
}

function pick(row: Row, keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
  }
  return undefined;
}

/** Every array of objects found anywhere in a JSON value. */
function objectArrays(v: unknown, out: Row[][] = []): Row[][] {
  if (Array.isArray(v)) {
    if (
      v.length &&
      v.every((x) => x && typeof x === "object" && !Array.isArray(x))
    ) {
      out.push(v as Row[]);
    }
    for (const x of v) objectArrays(x, out);
  } else if (v && typeof v === "object") {
    for (const x of Object.values(v)) objectArrays(x, out);
  }
  return out;
}

function etfLike(symbol: string, name: string): boolean {
  return (
    /BEES$|ETF|IETF$/i.test(symbol) || /\bETF\b|exchange traded/i.test(name)
  );
}

/** Kite `get_holdings` (equity) rows. */
export function parseKiteHoldings(data: unknown): Holding[] {
  const rows = objectArrays(data).flat();
  const out: Holding[] = [];
  for (const r of rows) {
    const symbol = String(pick(r, ["tradingsymbol", "symbol"]) ?? "");
    const qty = (num(r.quantity) ?? 0) + (num(r.t1_quantity) ?? 0);
    const avg = num(r.average_price);
    const last = num(pick(r, ["last_price", "close_price"]));
    if (!symbol || !qty || avg === null || last === null) continue;
    out.push({
      source: "kite",
      symbol,
      name: symbol,
      kind: etfLike(symbol, symbol) ? "etf" : "stock",
      quantity: qty,
      invested: qty * avg,
      value: qty * last,
      dayChangePct: num(r.day_change_percentage)
    });
  }
  return out;
}

/** Kite `get_mf_holdings` rows. */
export function parseKiteMfHoldings(data: unknown): Holding[] {
  const rows = objectArrays(data).flat();
  const out: Holding[] = [];
  for (const r of rows) {
    const symbol = String(pick(r, ["tradingsymbol", "isin"]) ?? "");
    const qty = num(r.quantity);
    const avg = num(r.average_price);
    const last = num(r.last_price);
    if (!symbol || !qty || avg === null || last === null) continue;
    out.push({
      source: "kite",
      symbol,
      name: String(r.fund ?? symbol),
      kind: "mutual_fund",
      quantity: qty,
      invested: qty * avg,
      value: qty * last,
      dayChangePct: null
    });
  }
  return out;
}

function kindFrom(r: Row, symbol: string, name: string): Kind {
  const t = String(
    pick(r, [
      "asset_class",
      "assetClass",
      "asset_type",
      "assetType",
      "instrument_type",
      "category",
      "type"
    ]) ?? ""
  ).toLowerCase();
  if (t === "us_stock") return "us_stock";
  if (t === "ind_stock") return etfLike(symbol, name) ? "etf" : "stock";
  if (/mutual|mf|fund/.test(t)) return "mutual_fund";
  if (/us|global|international|foreign/.test(t)) return "us_stock";
  if (/etf/.test(t) || etfLike(symbol, name)) return "etf";
  if (/stock|equity|share/.test(t)) return "stock";
  return t ? "other" : "stock";
}

/** Asset types requested from INDmoney's `networth_holdings` (it returns one type per call). */
export const INDMONEY_ASSET_TYPES = ["IND_STOCK", "MF", "US_STOCK"] as const;

/**
 * INDmoney `networth_holdings` for one asset type. Rows look like
 * { investment_code, investment, asset_type, invested_amount, market_value,
 *   total_units, broker, one_day_change_percentage } with amounts in INR.
 * Only `holdings` is read: the IND_STOCK response also carries F&O positions
 * and open orders, which aren't holdings.
 */
export function parseIndmoneyHoldings(
  data: unknown,
  opts: { skipZerodha?: boolean } = {}
): Holding[] {
  const rows = (data as { holdings?: unknown } | null)?.holdings;
  if (!Array.isArray(rows)) return [];
  const out: Holding[] = [];
  for (const r of rows as Row[]) {
    const name = String(pick(r, ["investment", "name"]) ?? "");
    const symbol = String(pick(r, ["investment_code", "symbol"]) ?? name);
    const value = num(pick(r, ["market_value", "current_value"]));
    if (!name || value === null) continue;
    // With Kite connected directly, Zerodha rows would be counted twice.
    if (opts.skipZerodha && /zerodha|kite/i.test(String(r.broker ?? ""))) {
      continue;
    }
    out.push({
      source: "indmoney",
      symbol,
      name,
      kind: kindFrom(r, symbol, name),
      quantity: num(pick(r, ["total_units", "units", "quantity"])) ?? 0,
      invested: num(pick(r, ["invested_amount", "invested_value"])) ?? value,
      value,
      dayChangePct: num(r.one_day_change_percentage)
    });
  }
  return out;
}

// ── Metrics ───────────────────────────────────────────────────────────

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function slices<K extends string>(
  holdings: Holding[],
  key: (h: Holding) => K,
  label: (k: K) => string,
  total: number
): Slice[] {
  const sums = new Map<K, number>();
  for (const h of holdings) sums.set(key(h), (sums.get(key(h)) ?? 0) + h.value);
  return [...sums.entries()]
    .map(([k, v]) => ({
      label: label(k),
      value: round(v),
      pct: total ? round((v / total) * 100, 1) : 0
    }))
    .sort((a, b) => b.value - a.value);
}

export function gainPct(h: Holding): number {
  return h.invested ? ((h.value - h.invested) / h.invested) * 100 : 0;
}

export function computeMetrics(holdings: Holding[]): Metrics {
  const value = holdings.reduce((s, h) => s + h.value, 0);
  const invested = holdings.reduce((s, h) => s + h.invested, 0);
  // Yesterday's value of a position is value / (1 + pct/100).
  const dayChange = holdings.reduce(
    (s, h) =>
      h.dayChangePct === null
        ? s
        : s + h.value - h.value / (1 + h.dayChangePct / 100),
    0
  );
  const byValue = [...holdings].sort((a, b) => b.value - a.value);
  const byGain = [...holdings]
    .filter((h) => h.invested > 0)
    .sort((a, b) => gainPct(b) - gainPct(a));
  return {
    totals: {
      value: round(value),
      invested: round(invested),
      gain: round(value - invested),
      gainPct: invested ? round(((value - invested) / invested) * 100) : 0,
      dayChange: round(dayChange),
      count: holdings.length
    },
    byKind: slices(
      holdings,
      (h) => h.kind,
      (k) => KIND_LABELS[k],
      value
    ),
    bySource: slices(
      holdings,
      (h) => h.source,
      (s) => SOURCE_LABELS[s],
      value
    ),
    top: byValue.slice(0, 5).map((h) => ({
      symbol: h.symbol,
      name: h.name,
      value: round(h.value),
      pct: value ? round((h.value / value) * 100, 1) : 0
    })),
    gainers: byGain
      .slice(0, 3)
      .map((h) => ({ symbol: h.symbol, gainPct: round(gainPct(h), 1) })),
    losers: byGain
      .slice(-3)
      .reverse()
      .filter((h) => gainPct(h) < 0)
      .map((h) => ({ symbol: h.symbol, gainPct: round(gainPct(h), 1) })),
    concentration:
      value && byValue[0] ? round((byValue[0].value / value) * 100, 1) : 0
  };
}

// ── Formatting ────────────────────────────────────────────────────────

/** ₹ in Indian style: ₹13.78 L, ₹1.2 Cr, ₹45,300. */
export function inr(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
  return `${sign}₹${Math.round(a).toLocaleString("en-IN")}`;
}

export function pct(n: number, signed = true): string {
  return `${signed && n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

// ── Demo data ─────────────────────────────────────────────────────────

/** A made-up portfolio so reviewers can try the app without a broker account. */
export function demoHoldings(): Holding[] {
  const rows: Array<[string, string, Kind, number, number, number, number]> = [
    // symbol, name, kind, qty, avg, last, day %
    ["HDFCBANK", "HDFC Bank", "stock", 120, 1480, 1725, 0.6],
    ["TCS", "Tata Consultancy Services", "stock", 25, 3350, 3920, -0.4],
    ["ASIANPAINT", "Asian Paints", "stock", 40, 3100, 2480, -1.1],
    ["PIDILITIND", "Pidilite Industries", "stock", 30, 2400, 3050, 0.3],
    ["BAJFINANCE", "Bajaj Finance", "stock", 15, 6800, 7350, 1.4],
    ["TITAN", "Titan Company", "stock", 28, 2900, 3420, 0.2],
    ["NIFTYBEES", "Nippon India Nifty 50 BeES", "etf", 600, 210, 268, 0.4],
    [
      "PPFAS-FLEXI",
      "Parag Parikh Flexi Cap Fund",
      "mutual_fund",
      2500,
      58,
      84,
      0
    ],
    ["AXIS-SMALL", "Axis Small Cap Fund", "mutual_fund", 1800, 72, 101, 0],
    ["MSFT", "Microsoft (US)", "us_stock", 6, 28500, 36800, -0.7],
    ["GOOGL", "Alphabet (US)", "us_stock", 10, 11200, 14900, 0.9]
  ];
  return rows.map(([symbol, name, kind, qty, avg, last, day]) => ({
    source: "demo",
    symbol,
    name,
    kind,
    quantity: qty,
    invested: qty * avg,
    value: qty * last,
    dayChangePct: kind === "mutual_fund" ? null : day
  }));
}
