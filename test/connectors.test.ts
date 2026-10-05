import { describe, expect, it } from "vitest";
import {
  chatToolAllowed,
  chatToolName,
  chatToolOutput,
  MAX_TOOL_OUTPUT
} from "../src/connectors";

const text = (t: string, isError = false) => ({
  content: [{ type: "text", text: t }],
  isError
});

describe("chat tool policy", () => {
  it("never exposes Kite order, GTT, login or holdings tools", () => {
    for (const name of [
      "place_order",
      "modify_order",
      "cancel_order",
      "place_gtt_order",
      "modify_gtt_order",
      "delete_gtt_order",
      "login",
      "get_holdings",
      "get_orders",
      "get_margins",
      "get_profile"
    ]) {
      expect(chatToolAllowed("kite", { name }), name).toBe(false);
    }
  });

  it("exposes Kite and INDmoney market data tools only", () => {
    expect(chatToolAllowed("kite", { name: "get_ltp" })).toBe(true);
    expect(chatToolAllowed("kite", { name: "get_historical_data" })).toBe(true);
    expect(
      chatToolAllowed("indmoney", { name: "get_indian_stocks_details" })
    ).toBe(true);
    expect(chatToolAllowed("indmoney", { name: "networth_holdings" })).toBe(
      false
    );
    expect(chatToolAllowed("indmoney", { name: "save_analysis" })).toBe(false);
    expect(chatToolAllowed("indmoney", { name: "user_watchlist" })).toBe(false);
  });

  it("lets market data tools through unless they look like writes", () => {
    expect(chatToolAllowed("tapetide", { name: "get_quote" })).toBe(true);
    expect(chatToolAllowed("tapetide", { name: "screen_stocks" })).toBe(true);
    expect(chatToolAllowed("tapetide", { name: "add_to_watchlist" })).toBe(
      false
    );
    expect(chatToolAllowed("tapetide", { name: "create_alert" })).toBe(false);
    expect(
      chatToolAllowed("tapetide", {
        name: "reset_data",
        annotations: { destructiveHint: true }
      })
    ).toBe(false);
  });

  it("names tools readably and safely", () => {
    expect(chatToolName("kite", "get_ltp")).toBe("kite_get_ltp");
    expect(chatToolName("tapetide", "get-quote.v2")).toBe(
      "tapetide_get_quote_v2"
    );
  });
});

describe("chat tool output", () => {
  it("truncates large results", () => {
    const out = chatToolOutput(
      "tapetide",
      text("x".repeat(MAX_TOOL_OUTPUT + 500))
    );
    expect(typeof out).toBe("string");
    expect((out as string).length).toBeLessThan(MAX_TOOL_OUTPUT + 120);
    expect(out).toContain("truncated 500 characters");
  });

  it("reports an expired Kite session with a hint instead of throwing", () => {
    const out = chatToolOutput(
      "kite",
      text(
        "Please log in first: https://kite.zerodha.com/connect/login?x=1",
        true
      )
    ) as { error: string; hint: string; loginUrl?: string };
    expect(out.error).toMatch(/log in/);
    expect(out.hint).toMatch(/Log in to Kite/);
    expect(out.loginUrl).toBe("https://kite.zerodha.com/connect/login?x=1");
  });

  it("doesn't mistake long market text mentioning a session for a login error", () => {
    const long = `Trading session summary. ${"Price action was steady. ".repeat(20)}`;
    expect(typeof chatToolOutput("tapetide", text(long))).toBe("string");
  });

  it("falls back to structuredContent when there is no text", () => {
    expect(
      chatToolOutput("tapetide", {
        content: [],
        structuredContent: { ltp: 3920 }
      })
    ).toBe('{"ltp":3920}');
  });
});
