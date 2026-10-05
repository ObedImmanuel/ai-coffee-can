import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  generateText,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
import { z } from "zod";
import {
  ADVISER_NOTE,
  ANALYSIS_SYSTEM,
  parseAnalysis,
  portfolioContext
} from "./analysis";
import {
  computeMetrics,
  demoHoldings,
  EMPTY_STATE,
  firstUrl,
  INDMONEY_ASSET_TYPES,
  needsLogin,
  parseIndmoneyHoldings,
  parseKiteHoldings,
  parseKiteMfHoldings,
  resultData,
  resultText,
  type Analysis,
  type DashboardState,
  type HistoryPoint,
  type Holding,
  type Kind,
  type Source,
  type SourceStatus
} from "./portfolio";

/** Broker MCP servers users can connect. Fixed, so the agent never talks to arbitrary URLs. */
export const BROKERS = {
  kite: { label: "Zerodha (Kite)", url: "https://mcp.kite.trade/mcp" },
  indmoney: { label: "INDmoney", url: "https://mcp.indmoney.com/mcp" }
} as const;
export type Broker = keyof typeof BROKERS;

/**
 * Available on the Workers Free plan, with tool calling. (Llama 3.3 streams each
 * token in two formats, which workers-ai-provider 3.3 emits twice.)
 */
const MODEL = "@cf/openai/gpt-oss-120b";
/** Workers AI defaults to 256 output tokens, which the model's reasoning alone can use up. */
const MAX_TOKENS = 4096;
/** Every day at 11:00 UTC = 4:30 PM IST, after the Indian market closes. */
const DAILY_CRON = "0 11 * * *";

const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One PortfolioAgent (a Durable Object with its own SQLite database) per user.
 * It holds the user's broker MCP connections, their holdings, the daily
 * analysis and the chat history, and pushes the dashboard to the browser as state.
 */
export class PortfolioAgent extends AIChatAgent<Env, DashboardState> {
  initialState = EMPTY_STATE;
  maxPersistedMessages = 100;
  chatRecovery = true;
  waitForMcpConnections = true;

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS holdings (
      source TEXT NOT NULL, symbol TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
      quantity REAL NOT NULL, invested REAL NOT NULL, value REAL NOT NULL, day_change_pct REAL)`;
    this
      .sql`CREATE TABLE IF NOT EXISTS analyses (created_at TEXT PRIMARY KEY, json TEXT NOT NULL)`;
    this
      .sql`CREATE TABLE IF NOT EXISTS history (date TEXT PRIMARY KEY, value REAL NOT NULL, invested REAL NOT NULL)`;

    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        if (result.authSuccess) {
          // Fetch holdings once the new connection has finished its handshake.
          void this.schedule(5, "refreshAndSync");
          return new Response(
            "<script>window.close();</script>Connected. You can close this window.",
            {
              headers: { "content-type": "text/html" }
            }
          );
        }
        return new Response(
          "Connection failed. Close this window and try again.",
          {
            headers: { "content-type": "text/plain" },
            status: 400
          }
        );
      }
    });

    await this.schedule(DAILY_CRON, "dailyAnalysis", undefined, {
      idempotent: true
    });
    this.sync();
  }

  // ── Storage ─────────────────────────────────────────────────────────

  private loadHoldings(): Holding[] {
    return this.sql<{
      source: Source;
      symbol: string;
      name: string;
      kind: Kind;
      quantity: number;
      invested: number;
      value: number;
      day_change_pct: number | null;
    }>`SELECT * FROM holdings ORDER BY value DESC`.map((r) => ({
      source: r.source,
      symbol: r.symbol,
      name: r.name,
      kind: r.kind,
      quantity: r.quantity,
      invested: r.invested,
      value: r.value,
      dayChangePct: r.day_change_pct
    }));
  }

  private saveHoldings(source: Source, holdings: Holding[]) {
    this.sql`DELETE FROM holdings WHERE source = ${source}`;
    for (const h of holdings) {
      this
        .sql`INSERT INTO holdings (source, symbol, name, kind, quantity, invested, value, day_change_pct)
        VALUES (${source}, ${h.symbol}, ${h.name}, ${h.kind}, ${h.quantity}, ${h.invested}, ${h.value}, ${h.dayChangePct})`;
    }
  }

  private latestAnalysis(): Analysis | null {
    const row = this.sql<{
      json: string;
    }>`SELECT json FROM analyses ORDER BY created_at DESC LIMIT 1`[0];
    return row ? (JSON.parse(row.json) as Analysis) : null;
  }

  private setStatus(
    source: Source,
    status: Omit<SourceStatus, "updatedAt"> | null
  ) {
    const sources = { ...this.state.sources };
    if (status)
      sources[source] = { ...status, updatedAt: new Date().toISOString() };
    else delete sources[source];
    this.setState({ ...this.state, sources });
  }

  /** Rebuilds the dashboard state from the database and pushes it to connected browsers. */
  private sync(patch: Partial<DashboardState> = {}) {
    const holdings = this.loadHoldings();
    const metrics = holdings.length ? computeMetrics(holdings) : null;
    if (metrics) {
      this.sql`INSERT OR REPLACE INTO history (date, value, invested)
        VALUES (${today()}, ${metrics.totals.value}, ${metrics.totals.invested})`;
    }
    const history = this
      .sql<HistoryPoint>`SELECT date, value, invested FROM history ORDER BY date DESC LIMIT 90`.reverse();
    const next = this.getSchedules({ type: "cron" }).find(
      (s) => s.callback === "dailyAnalysis"
    );
    this.setState({
      ...this.state,
      holdings,
      metrics,
      history,
      analysis: this.latestAnalysis(),
      nextRunAt: next
        ? new Date(
            next.time < 1e12 ? next.time * 1000 : next.time
          ).toISOString()
        : null,
      ...patch
    });
  }

  // ── Brokers ─────────────────────────────────────────────────────────

  private serverId(broker: Broker): string | undefined {
    const servers = this.getMcpServers().servers;
    return Object.keys(servers).find((id) => servers[id].name === broker);
  }

  private async callTool(
    serverId: string,
    name: string,
    args: Record<string, unknown> = {}
  ) {
    return this.mcp.callTool({ serverId, name, arguments: args });
  }

  /** Fetches one broker's holdings over MCP and stores them. Never throws; failures go into the source status. */
  private async refreshBroker(broker: Broker) {
    const id = this.serverId(broker);
    if (!id) return;
    const server = this.getMcpServers().servers[id];
    if (server.state !== "ready") {
      this.setStatus(broker, {
        state: "needs_login",
        message: "Finish connecting: press Authorize."
      });
      return;
    }
    try {
      let holdings: Holding[];
      if (broker === "kite") {
        const equity = await this.callTool(id, "get_holdings");
        if (equity.isError || needsLogin(equity)) {
          // Kite sessions expire every morning; the login tool returns a fresh link.
          const login = await this.callTool(id, "login");
          this.setStatus("kite", {
            state: "needs_login",
            message:
              "Kite needs today's login. Open the link, log in, then press Refresh.",
            loginUrl: firstUrl(resultText(login))
          });
          return;
        }
        const funds = await this.callTool(id, "get_mf_holdings").catch(
          () => null
        );
        holdings = [
          ...parseKiteHoldings(resultData(equity)),
          ...(funds && !funds.isError
            ? parseKiteMfHoldings(resultData(funds))
            : [])
        ];
      } else {
        holdings = [];
        const skipZerodha = this.serverId("kite") !== undefined;
        for (const assetType of INDMONEY_ASSET_TYPES) {
          const res = await this.callTool(id, "networth_holdings", {
            asset_type: assetType
          });
          if (needsLogin(res)) {
            this.setStatus("indmoney", {
              state: "needs_login",
              message:
                "INDmoney's session expired. Disconnect and connect again."
            });
            return;
          }
          if (res.isError) {
            throw new Error(resultText(res).slice(0, 200) || "INDmoney error");
          }
          holdings.push(
            ...parseIndmoneyHoldings(resultData(res), { skipZerodha })
          );
        }
      }
      this.saveHoldings(broker, holdings);
      this.setStatus(broker, { state: "ok", count: holdings.length });
    } catch (e) {
      this.setStatus(broker, {
        state: "error",
        message: errMsg(e).slice(0, 200)
      });
    }
  }

  private async refreshAll() {
    await this.mcp.waitForConnections({ timeout: 15_000 });
    for (const broker of Object.keys(BROKERS) as Broker[])
      await this.refreshBroker(broker);
  }

  async refreshAndSync() {
    await this.refreshAll();
    this.sync();
  }

  // ── Daily analysis ──────────────────────────────────────────────────

  private model() {
    return createWorkersAI({ binding: this.env.AI })(MODEL, {
      sessionAffinity: this.sessionAffinity
    });
  }

  /** Scheduled every day: refresh holdings from the brokers, then write a short review with Workers AI. */
  async dailyAnalysis() {
    if (this.state.running) return;
    this.setState({ ...this.state, running: true, lastError: null });
    let lastError: string | null = null;
    try {
      await this.refreshAll();
      const holdings = this.loadHoldings();
      if (!holdings.length) {
        lastError =
          "No holdings yet. Connect a broker or load the demo portfolio.";
        return;
      }
      this.sync();
      const { text } = await generateText({
        model: this.model(),
        system: ANALYSIS_SYSTEM,
        maxOutputTokens: MAX_TOKENS,
        prompt: `Today is ${today()}. Broker status: ${JSON.stringify(this.state.sources)}.\nPortfolio JSON:\n${portfolioContext(holdings, this.state.metrics, this.state.history)}`
      });
      const analysis = parseAnalysis(text, new Date().toISOString());
      this
        .sql`INSERT INTO analyses (created_at, json) VALUES (${analysis.createdAt}, ${JSON.stringify(analysis)})`;
      this
        .sql`DELETE FROM analyses WHERE created_at NOT IN (SELECT created_at FROM analyses ORDER BY created_at DESC LIMIT 60)`;
    } catch (e) {
      lastError = `Analysis failed: ${errMsg(e)}`;
      console.error(lastError);
    } finally {
      this.sync({
        running: false,
        lastRunAt: new Date().toISOString(),
        lastError
      });
    }
  }

  // ── Methods the dashboard calls ─────────────────────────────────────

  @callable()
  async connectBroker(broker: Broker) {
    if (!(broker in BROKERS)) throw new Error("Unknown broker");
    const existing = this.serverId(broker);
    if (existing) await this.removeMcpServer(existing);
    const result = await this.addMcpServer(broker, BROKERS[broker].url);
    if (result.state === "ready") await this.refreshAndSync();
    else
      this.setStatus(broker, {
        state: "needs_login",
        message: "Finish connecting: press Authorize."
      });
    return result;
  }

  @callable()
  async disconnectBroker(broker: Broker) {
    const id = this.serverId(broker);
    if (id) await this.removeMcpServer(id);
    this.saveHoldings(broker, []);
    this.setStatus(broker, null);
    this.sync();
  }

  @callable()
  async refresh() {
    await this.refreshAndSync();
  }

  @callable()
  async runAnalysis() {
    await this.dailyAnalysis();
  }

  @callable()
  async loadDemo() {
    this.saveHoldings("demo", demoHoldings());
    this.setStatus("demo", { state: "ok", count: demoHoldings().length });
    await this.dailyAnalysis();
  }

  @callable()
  async clearDemo() {
    this.saveHoldings("demo", []);
    this.setStatus("demo", null);
    this.sync();
  }

  // ── Chat ────────────────────────────────────────────────────────────

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const holdings = this.loadHoldings();
    const result = streamText({
      model: this.model(),
      maxOutputTokens: MAX_TOKENS,
      system: `You are the investing assistant inside Coffee Can, a portfolio dashboard for a long-term "coffee can" investor in India.
${ADVISER_NOTE}
- Answer from the portfolio data below or from tool results. Never invent prices, ratios, news or holdings; if data is missing, say so.
- Amounts are already formatted in Indian rupees (L = lakh, Cr = crore); quote them exactly as given, never convert them.
- Be concise: short answers with the key numbers.
- You can't place orders or change anything at the broker.

Today is ${today()}. Broker status: ${JSON.stringify(this.state.sources)}.
Latest daily analysis: ${JSON.stringify(this.state.analysis)}
Portfolio JSON:
${holdings.length ? portfolioContext(holdings, this.state.metrics, this.state.history) : "(empty: the user hasn't connected a broker or loaded the demo yet)"}`,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
        reasoning: "before-last-message"
      }),
      // Only these tools: broker MCP tools (which include placing orders) are never given to the model.
      tools: {
        refreshPortfolio: tool({
          description:
            "Fetch fresh holdings from the connected brokers. Use when the user asks for the latest numbers.",
          inputSchema: z.object({}),
          execute: async () => {
            await this.refreshAndSync();
            return {
              sources: this.state.sources,
              totals: this.state.metrics?.totals ?? null
            };
          }
        }),
        getPastAnalyses: tool({
          description:
            "Read previous daily analyses, newest first, to compare how the portfolio has changed.",
          inputSchema: z.object({
            limit: z.number().int().min(1).max(30).default(7)
          }),
          execute: async ({ limit }) =>
            this.sql<{
              json: string;
            }>`SELECT json FROM analyses ORDER BY created_at DESC LIMIT ${limit}`.map(
              (r) => JSON.parse(r.json)
            )
        }),
        runDailyAnalysis: tool({
          description:
            "Run the daily analysis now and write a new review on the dashboard. Only use this when the user explicitly asks for a new analysis; to answer questions, use the portfolio data you already have.",
          inputSchema: z.object({}),
          execute: async () => {
            await this.dailyAnalysis();
            return this.state.analysis ?? { error: this.state.lastError };
          }
        })
      },
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal
    });
    // Show the real reason (e.g. a Workers AI quota error) instead of a generic message.
    return result.toUIMessageStreamResponse({ onError: errMsg });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
