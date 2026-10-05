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

  it("parses INDmoney networth_holdings, unwrapping { result: json }", () => {
    const payload = {
      holdings: [
        {
          investment_code: "AAPL",
          investment: "Apple Inc",
          asset_type: "US_STOCK",
          invested_amount: 90000,
          market_value: 120000,
          total_units: 5,
          broker: "Alpaca",
          one_day_change_percentage: 0.4
        },
        {
          investment_code: "NIFTYBEES",
          investment: "Nippon India Nifty 50 BeES",
          asset_type: "IND_STOCK",
          invested_amount: 20000,
          market_value: 26000,
          total_units: 100,
          broker: "Zerodha"
        },
        {
          investment_code: "120503",
          investment: "Axis Small Cap Fund",
          asset_type: "MF",
          invested_amount: 40000,
          market_value: 50000,
          total_units: 600
        }
      ],
      derivative_positions: [
        { position_id: "x", ind_stock_id: "y", avg_price: 1 }
      ],
      asset_summary: { total_value: 196000 }
    };
    const res = {
      structuredContent: { result: JSON.stringify(payload) },
      content: []
    };
    const all = parseIndmoneyHoldings(resultData(res));
    expect(all.map((h) => h.kind)).toEqual(["us_stock", "etf", "mutual_fund"]);
    expect(all[0]).toMatchObject({
      symbol: "AAPL",
      name: "Apple Inc",
      quantity: 5,
      value: 120000,
      invested: 90000,
      dayChangePct: 0.4
    });
    // With Kite connected, Zerodha rows are left to Kite.
    expect(parseIndmoneyHoldings(payload, { skipZerodha: true })).toHaveLength(
      2
    );
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
