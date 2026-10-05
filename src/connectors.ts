// The MCP servers users can connect, and the policy for which of their tools
// the chat model may call. Kept free of Workers imports so it's unit-testable.

import { firstUrl, needsLogin, resultText } from "./portfolio";

/**
 * Fixed list, so the agent never connects to a URL the client sends.
 * "portfolio" connectors supply holdings; "market" connectors only answer questions.
 */
export const CONNECTORS = {
  kite: {
    label: "Zerodha (Kite)",
    url: "https://mcp.kite.trade/mcp",
    role: "portfolio"
  },
  indmoney: {
    label: "INDmoney",
    url: "https://mcp.indmoney.com/mcp",
    role: "portfolio"
  },
  tapetide: {
    label: "Tapetide",
    url: "https://mcp.tapetide.com/mcp",
    role: "market"
  }
} as const;

export type Connector = keyof typeof CONNECTORS;
export type Broker = {
  [K in Connector]: (typeof CONNECTORS)[K]["role"] extends "portfolio"
    ? K
    : never;
}[Connector];
export const BROKER_IDS = (Object.keys(CONNECTORS) as Connector[]).filter(
  (c) => CONNECTORS[c].role === "portfolio"
) as Broker[];

/**
 * Broker tools the chat may call: market data only. Holdings come from the
 * database (normalised, matches the dashboard); order, GTT, login and write
 * tools are never exposed.
 */
const BROKER_ALLOW: Record<Broker, ReadonlySet<string>> = {
  kite: new Set([
    "get_ltp",
    "get_quotes",
    "get_ohlc",
    "get_historical_data",
    "search_instruments"
  ]),
  indmoney: new Set([
    "get_indian_stocks_details",
    "get_us_stocks_details",
    "get_indian_stocks_ohlc",
    "get_us_stocks_ohlc",
    "get_indian_stocks_movers",
    "get_us_stocks_movers",
    "get_mf_funds_details",
    "get_mf_by_category",
    "lookup_ind_keys"
  ])
};

/** Names that suggest a tool changes something. A hard block, even for allow-listed or read-only tools. */
const WRITE_VERB =
  /(^|_)(place|modify|cancel|delete|create|update|save|set|add|remove|edit|transfer|order|orders|gtt|login|logout|buy|sell|trade|execute|subscribe|alert|alerts|watchlist|portfolio)(_|$)/i;

export interface McpToolInfo {
  name: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

/**
 * Whether the chat model may call this tool.
 * - Brokers: explicit allow-list of market-data tools.
 * - Market data servers: any tool, unless it declares itself destructive or
 *   its name looks like a write.
 * The write-verb check applies to everything, as a second guard.
 */
export function chatToolAllowed(
  connector: Connector,
  tool: McpToolInfo
): boolean {
  if (WRITE_VERB.test(tool.name)) return false;
  if (tool.annotations?.destructiveHint) return false;
  if (CONNECTORS[connector].role === "portfolio") {
    return BROKER_ALLOW[connector as Broker].has(tool.name);
  }
  return true;
}

/** Tool name the model sees: readable and unique, e.g. "kite_get_ltp". */
export function chatToolName(connector: Connector, tool: string): string {
  return `${connector}_${tool}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64);
}

/** Max characters of tool output handed back to the model; raw market data can be huge. */
export const MAX_TOOL_OUTPUT = 6000;

/**
 * Turns an MCP tool result into what the model reads: text, truncated, with
 * errors and expired sessions reported as data instead of exceptions.
 */
export function chatToolOutput(connector: Connector, result: unknown) {
  const structured = (result as { structuredContent?: unknown })
    ?.structuredContent;
  const text = (
    resultText(result) || (structured ? JSON.stringify(structured) : "")
  ).trim();
  const isError = (result as { isError?: boolean })?.isError === true;
  // Only short or error replies count as "log in": market text can mention a "session".
  if ((isError || text.length < 300) && needsLogin(result)) {
    return {
      error: `${CONNECTORS[connector].label} needs the user to log in again.`,
      hint:
        connector === "kite"
          ? 'Ask the user to press Refresh on the dashboard and use the "Log in to Kite" link.'
          : "Ask the user to disconnect and reconnect it on the dashboard.",
      loginUrl: firstUrl(text)
    };
  }
  if (isError) {
    return { error: text.slice(0, 500) || "The tool call failed." };
  }
  if (text.length <= MAX_TOOL_OUTPUT) return text;
  return `${text.slice(0, MAX_TOOL_OUTPUT)}\n…[truncated ${text.length - MAX_TOOL_OUTPUT} characters; ask a narrower question for more]`;
}
