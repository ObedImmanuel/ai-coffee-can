import type { Analysis, Holding, HistoryPoint, Metrics } from "./portfolio";
import { gainPct, inr, KIND_LABELS, pct, SOURCE_LABELS } from "./portfolio";

export const ADVISER_NOTE =
  "You are a research assistant for the user's own decisions, not a licensed financial adviser. Never tell the user they must buy or sell; explain trade-offs and what the numbers imply.";

/**
 * Compact JSON the model reads. Amounts are pre-formatted (₹16.24 L) because
 * smaller models get lakh/crore conversions wrong when given raw numbers.
 */
export function portfolioContext(
  holdings: Holding[],
  metrics: Metrics | null,
  history: HistoryPoint[]
): string {
  const t = metrics?.totals;
  return JSON.stringify({
    totals: t && {
      value: inr(t.value),
      invested: inr(t.invested),
      gain: inr(t.gain),
      gainPct: pct(t.gainPct),
      todayChange: inr(t.dayChange),
      holdings: t.count
    },
    allocationByKind: metrics?.byKind.map(
      (s) => `${s.label}: ${inr(s.value)} (${s.pct}%)`
    ),
    allocationBySource: metrics?.bySource.map(
      (s) => `${s.label}: ${inr(s.value)} (${s.pct}%)`
    ),
    largestPositionPct: metrics && `${metrics.concentration}%`,
    valueHistory: history.slice(-14).map((p) => `${p.date}: ${inr(p.value)}`),
    holdings: holdings.map((h) => ({
      symbol: h.symbol,
      name: h.name,
      type: KIND_LABELS[h.kind],
      broker: SOURCE_LABELS[h.source],
      value: inr(h.value),
      invested: inr(h.invested),
      gain: pct(gainPct(h)),
      weight: t?.value ? `${((h.value / t.value) * 100).toFixed(1)}%` : null,
      today: h.dayChangePct === null ? null : pct(h.dayChangePct)
    }))
  });
}

export const ANALYSIS_SYSTEM = `You write the daily review for a long-term "coffee can" investor in India: they buy quality businesses and hold for years, so ignore day-to-day noise unless it is large.
${ADVISER_NOTE}
Amounts are already formatted in Indian rupees (L = lakh, Cr = crore); copy them exactly as given, never convert or recompute them.
Use only the numbers in the portfolio JSON. Never invent prices, ratios or news.
"gain" is the total gain since purchase (not year-to-date); "today" is today's price change.

Reply with JSON only, no prose around it, in exactly this shape:
{"headline": "one sentence, under 15 words",
 "summary": "2-3 sentences on how the portfolio stands today",
 "highlights": ["2-4 short factual observations: allocation, concentration, big winners or losers"],
 "watch": ["1-3 things worth a closer look, e.g. a position above 15% of the portfolio, a fund overlap, a large unrealised loss"]}`;

/** Parses the model's reply, tolerating code fences or prose around the JSON. */
export function parseAnalysis(text: string, createdAt: string): Analysis {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as Partial<Analysis>;
      const list = (v: unknown) =>
        Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 5) : [];
      if (j.headline || j.summary) {
        return {
          createdAt,
          headline: String(j.headline ?? "").trim(),
          summary: String(j.summary ?? "").trim(),
          highlights: list(j.highlights),
          watch: list(j.watch)
        };
      }
    } catch {
      // fall through to plain text
    }
  }
  return {
    createdAt,
    headline: "Daily review",
    summary: text.trim().slice(0, 1200),
    highlights: [],
    watch: []
  };
}
