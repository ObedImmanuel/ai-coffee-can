import { describe, expect, it } from "vitest";
import {
  computeMetrics,
  demoHoldings,
  firstUrl,
  inr,
  needsLogin,
  parseIndmoneyHoldings,
  parseKiteHoldings,
  parseKiteMfHoldings,
  resultData
} from "../src/portfolio";
import { parseAnalysis } from "../src/analysis";

const text = (t: string) => ({ content: [{ type: "text", text: t }] });

describe("MCP results", () => {
  it("reads JSON from text content, even with prose around it", () => {
    expect(resultData(text('[{"a":1}]'))).toEqual([{ a: 1 }]);
    expect(resultData(text('Holdings:\n{"data":[1]}\nDone'))).toEqual({
      data: [1]
    });
    expect(resultData({ structuredContent: { x: 1 }, content: [] })).toEqual({
      x: 1
    });
  });

  it("detects an expired Kite session and finds the login link", () => {
    expect(needsLogin(text("Please log in first using the login tool"))).toBe(
      true
    );
    expect(needsLogin(text('[{"tradingsymbol":"TCS"}]'))).toBe(false);
    expect(
      firstUrl(
        "Open https://kite.zerodha.com/connect/login?api_key=x&v=3 to log in."
      )
    ).toBe("https://kite.zerodha.com/connect/login?api_key=x&v=3");
  });
});

describe("parsers", () => {
  it("parses Kite equity holdings, including T1 quantity and ETFs", () => {
    const h = parseKiteHoldings({
      data: [
        {
          tradingsymbol: "TCS",
          quantity: 10,
          t1_quantity: 2,
          average_price: 3000,
          last_price: 3500,
          day_change_percentage: 1.5
        },
        {
          tradingsymbol: "NIFTYBEES",
          quantity: 100,
          average_price: 200,
          last_price: 250
        },
        {
          tradingsymbol: "SOLD",
          quantity: 0,
          average_price: 10,
          last_price: 12
        }
      ]
    });
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({
      symbol: "TCS",
      quantity: 12,
      invested: 36000,
      value: 42000,
      kind: "stock",
      dayChangePct: 1.5
    });
    expect(h[1].kind).toBe("etf");
  });

  it("parses Kite mutual fund holdings", () => {
    const h = parseKiteMfHoldings([
      {
        tradingsymbol: "INF879O01027",
        fund: "Parag Parikh Flexi Cap",
        quantity: 100.5,
        average_price: 50,
        last_price: 80
      }
    ]);
    expect(h[0]).toMatchObject({
      kind: "mutual_fund",
      name: "Parag Parikh Flexi Cap",
      value: 8040
    });
  });

  it("parses INDmoney holdings with varied field names and skips Zerodha rows", () => {
    const h = parseIndmoneyHoldings({
      holdings: [
        {
          name: "Apple Inc",
          symbol: "AAPL",
          asset_class: "US Stocks",
          current_value: "1,20,000",
          invested_value: 90000,
          quantity: 5
        },
        {
          scheme_name: "Axis Small Cap",
          asset_type: "Mutual Fund",
          currentValue: { amount: 50000 },
          investedAmount: 40000
        },
        { name: "TCS", broker: "Zerodha", current_value: 1000 }
      ]
    });
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({
      symbol: "AAPL",
      kind: "us_stock",
      value: 120000,
      invested: 90000
    });
    expect(h[1]).toMatchObject({ kind: "mutual_fund", value: 50000 });
  });
});

describe("metrics", () => {
  it("computes totals, allocation and concentration", () => {
    const m = computeMetrics(demoHoldings());
    const value = demoHoldings().reduce((s, h) => s + h.value, 0);
    expect(m.totals.value).toBeCloseTo(value, 0);
    expect(m.byKind.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 0);
    expect(m.concentration).toBe(m.top[0].pct);
    expect(m.losers.every((l) => l.gainPct < 0)).toBe(true);
    expect(m.losers[0].symbol).toBe("ASIANPAINT");
  });

  it("formats rupees lakh/crore style", () => {
    expect(inr(1378000)).toBe("₹13.78 L");
    expect(inr(25000000)).toBe("₹2.50 Cr");
    expect(inr(-45300)).toBe("-₹45,300");
  });
});

describe("analysis parsing", () => {
  it("reads JSON wrapped in a code fence", () => {
    const a = parseAnalysis(
      '```json\n{"headline":"Steady","summary":"Fine.","highlights":["a"],"watch":[]}\n```',
      "t"
    );
    expect(a).toMatchObject({
      headline: "Steady",
      highlights: ["a"],
      watch: []
    });
  });
  it("falls back to plain text", () => {
    expect(parseAnalysis("Just prose.", "t").summary).toBe("Just prose.");
  });
});
