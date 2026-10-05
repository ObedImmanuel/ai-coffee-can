import { useState, type ReactNode } from "react";
import type { useAgent } from "agents/react";
import type { MCPServersState } from "agents";
import { Badge, Button, Text } from "@cloudflare/kumo";
import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  FlaskIcon,
  PlugsConnectedIcon,
  SignInIcon,
  SparkleIcon,
  TrashIcon,
  WarningIcon
} from "@phosphor-icons/react";
import type { Connector, PortfolioAgent } from "./server";
import {
  gainPct,
  inr,
  KIND_LABELS,
  pct,
  SOURCE_LABELS,
  type DashboardState,
  type HistoryPoint,
  type Slice
} from "./portfolio";

export type AgentClient = ReturnType<
  typeof useAgent<PortfolioAgent, DashboardState>
>;

const CONNECTOR_CARDS: Array<{
  id: Connector;
  label: string;
  blurb: string;
}> = [
  {
    id: "kite",
    label: "Zerodha (Kite)",
    blurb: "Stocks, ETFs and mutual funds via Kite's official MCP server."
  },
  {
    id: "indmoney",
    label: "INDmoney",
    blurb: "US stocks and other assets via INDmoney's MCP server."
  },
  {
    id: "tapetide",
    label: "Tapetide (market data)",
    blurb:
      "Lets the chat look up live prices, financials, ratios and technicals for NSE/BSE stocks. Free account."
  }
];

const signClass = (n: number) =>
  n > 0 ? "text-kumo-success" : n < 0 ? "text-kumo-danger" : "";
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short"
      })
    : "—";

function Card({
  title,
  action,
  children
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl bg-kumo-base ring ring-kumo-line p-4 sm:p-5 min-w-0">
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 mb-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = ""
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl bg-kumo-base ring ring-kumo-line p-4 min-w-0">
      <Text size="xs" variant="secondary">
        {label}
      </Text>
      <div className={`text-xl font-semibold mt-1 truncate ${tone}`}>
        {value}
      </div>
      {sub && (
        <div className={`text-xs mt-0.5 ${tone || "text-kumo-subtle"}`}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Bars({ slices }: { slices: Slice[] }) {
  return (
    <div className="space-y-2.5">
      {slices.map((s) => (
        <div key={s.label}>
          <div className="flex justify-between text-xs mb-1">
            <span>{s.label}</span>
            <span className="text-kumo-subtle">
              {inr(s.value)} · {s.pct}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-kumo-control overflow-hidden">
            <div
              className="h-full rounded-full bg-kumo-brand"
              style={{ width: `${s.pct}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Sparkline({ points }: { points: HistoryPoint[] }) {
  if (points.length < 2) {
    return (
      <Text size="xs" variant="secondary">
        The chart fills in as the daily analysis runs.
      </Text>
    );
  }
  const w = 600,
    h = 120;
  const values = points.flatMap((p) => [p.value, p.invested]);
  const min = Math.min(...values),
    max = Math.max(...values);
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - 8 - ((v - min) / (max - min || 1)) * (h - 16);
  const line = (key: "value" | "invested") =>
    points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p[key])}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-28"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={line("invested")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="4 4"
        className="text-kumo-inactive"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={line("value")}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-kumo-brand"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Connectors({ state, mcp, agent, connected }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title="Connectors"
      action={
        <Button
          size="sm"
          variant="secondary"
          icon={<ArrowsClockwiseIcon size={14} />}
          disabled={!connected || busy !== null}
          onClick={() => run("refresh", () => agent.stub.refresh())}
        >
          {busy === "refresh" ? "Refreshing…" : "Refresh"}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {CONNECTOR_CARDS.map((b) => {
          const server = Object.values(mcp.servers).find(
            (s) => s.name === b.id
          );
          // Market data connectors have no holdings, so no source status.
          const status = b.id === "tapetide" ? undefined : state.sources[b.id];
          const authUrl =
            server?.state === "authenticating" ? server.auth_url : null;
          return (
            <div
              key={b.id}
              className="rounded-lg border border-kumo-line p-3 flex flex-col gap-2 min-w-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{b.label}</span>
                {!server ? (
                  <Badge variant="secondary">Not connected</Badge>
                ) : status?.state === "ok" ? (
                  <Badge variant="primary">{status.count} holdings</Badge>
                ) : !status && server.state === "ready" ? (
                  <Badge variant="primary">Ready for chat</Badge>
                ) : status?.state === "error" || server.state === "failed" ? (
                  <Badge variant="destructive">Error</Badge>
                ) : (
                  <Badge variant="secondary">
                    {status?.state === "needs_login"
                      ? "Login needed"
                      : server.state}
                  </Badge>
                )}
              </div>
              <Text size="xs" variant="secondary">
                {status?.message ??
                  (server?.state === "failed" ? server.error : null) ??
                  b.blurb}
              </Text>
              {status?.updatedAt && server && (
                <Text size="xs" variant="secondary">
                  Updated {when(status.updatedAt)}
                </Text>
              )}
              <div className="flex flex-wrap gap-2 mt-auto pt-1">
                {!server && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<PlugsConnectedIcon size={14} />}
                    disabled={!connected || busy !== null}
                    onClick={() =>
                      run(b.id, () => agent.stub.connectBroker(b.id))
                    }
                  >
                    {busy === b.id ? "Connecting…" : "Connect"}
                  </Button>
                )}
                {authUrl && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<SignInIcon size={14} />}
                    onClick={() =>
                      window.open(authUrl, "oauth", "width=600,height=800")
                    }
                  >
                    Authorize
                  </Button>
                )}
                {status?.loginUrl && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<ArrowSquareOutIcon size={14} />}
                    onClick={() =>
                      window.open(status.loginUrl, "_blank", "noopener")
                    }
                  >
                    Log in to Kite
                  </Button>
                )}
                {server && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<TrashIcon size={14} />}
                    disabled={busy !== null}
                    onClick={() =>
                      run(b.id, () => agent.stub.disconnectBroker(b.id))
                    }
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <FlaskIcon size={14} className="text-kumo-subtle" />
        <Text size="xs" variant="secondary">
          No broker account? Try it with made-up data.
        </Text>
        {state.sources.demo ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => run("demo", () => agent.stub.clearDemo())}
          >
            Remove demo portfolio
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={!connected || busy !== null}
            onClick={() => run("demo", () => agent.stub.loadDemo())}
          >
            {busy === "demo" ? "Loading…" : "Load demo portfolio"}
          </Button>
        )}
      </div>
    </Card>
  );
}

function AnalysisCard({ state }: { state: DashboardState }) {
  const a = state.analysis;
  return (
    <Card
      title="Daily analysis"
      action={
        <Text size="xs" variant="secondary">
          Next run {when(state.nextRunAt)}
        </Text>
      }
    >
      {state.lastError && (
        <div className="flex items-start gap-2 mb-3 text-sm text-kumo-danger">
          <WarningIcon size={16} className="shrink-0 mt-0.5" />
          <span>{state.lastError}</span>
        </div>
      )}
      {state.running && !a && (
        <Text size="sm" variant="secondary">
          Analysing your portfolio…
        </Text>
      )}
      {a ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <SparkleIcon
              size={18}
              weight="duotone"
              className="text-kumo-brand shrink-0 mt-0.5"
            />
            <div>
              <div className="font-semibold">{a.headline}</div>
              <p className="text-sm text-kumo-subtle mt-1 leading-relaxed">
                {a.summary}
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {a.highlights.length > 0 && (
              <div>
                <Text size="xs" variant="secondary" bold>
                  Highlights
                </Text>
                <ul className="mt-1 space-y-1 text-sm list-disc pl-4">
                  {a.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
            )}
            {a.watch.length > 0 && (
              <div>
                <Text size="xs" variant="secondary" bold>
                  Worth a closer look
                </Text>
                <ul className="mt-1 space-y-1 text-sm list-disc pl-4">
                  {a.watch.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <Text size="xs" variant="secondary">
            Written by Workers AI on {when(a.createdAt)}. Research only, not
            financial advice.
          </Text>
        </div>
      ) : (
        !state.running && (
          <Text size="sm" variant="secondary">
            No analysis yet. It runs every day at 4:30 PM IST, or press Run
            analysis.
          </Text>
        )
      )}
    </Card>
  );
}

interface Props {
  state: DashboardState;
  mcp: MCPServersState;
  agent: AgentClient;
  connected: boolean;
}

export function Dashboard(props: Props) {
  const { state } = props;
  const m = state.metrics;
  return (
    <div className="space-y-6 min-w-0">
      {m ? (
        <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Portfolio value"
            value={inr(m.totals.value)}
            sub={`${m.totals.count} holdings`}
          />
          <Stat label="Invested" value={inr(m.totals.invested)} />
          <Stat
            label="Total gain"
            value={inr(m.totals.gain)}
            sub={pct(m.totals.gainPct)}
            tone={signClass(m.totals.gain)}
          />
          <Stat
            label="Today"
            value={inr(m.totals.dayChange)}
            sub="stocks and ETFs"
            tone={signClass(m.totals.dayChange)}
          />
        </div>
      ) : (
        <Card>
          <div className="text-center py-6">
            <div className="font-semibold">Your portfolio will appear here</div>
            <Text size="sm" variant="secondary">
              Connect Zerodha or INDmoney below, or load the demo portfolio.
            </Text>
          </div>
        </Card>
      )}

      <AnalysisCard state={state} />
      <Connectors {...props} />

      {m && (
        <>
          <div className="grid gap-6 md:grid-cols-2">
            <Card title="Allocation by type">
              <Bars slices={m.byKind} />
            </Card>
            <Card title="Value over time">
              <Sparkline points={state.history} />
              <div className="flex gap-4 mt-2 text-xs text-kumo-subtle">
                <span>
                  <span className="inline-block w-3 h-0.5 bg-kumo-brand align-middle mr-1" />
                  Value
                </span>
                <span>
                  <span className="inline-block w-3 border-t border-dashed border-kumo-inactive align-middle mr-1" />
                  Invested
                </span>
              </div>
            </Card>
          </div>

          <Card
            title="Holdings"
            action={
              <Text size="xs" variant="secondary">
                Largest position: {m.concentration}%
              </Text>
            }
          >
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left text-xs text-kumo-subtle border-b border-kumo-line">
                    <th className="py-2 px-4 sm:pl-0 font-medium">Holding</th>
                    <th className="py-2 px-2 font-medium">Type</th>
                    <th className="py-2 px-2 font-medium text-right">Value</th>
                    <th className="py-2 px-2 font-medium text-right">Weight</th>
                    <th className="py-2 px-4 sm:pr-0 font-medium text-right">
                      Gain
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.holdings.map((h) => (
                    <tr
                      key={`${h.source}-${h.symbol}`}
                      className="border-b border-kumo-line last:border-0"
                    >
                      <td className="py-2 px-4 sm:pl-0">
                        <div className="font-medium">{h.symbol}</div>
                        <div className="text-xs text-kumo-subtle truncate max-w-[220px]">
                          {h.name !== h.symbol ? `${h.name} · ` : ""}
                          {SOURCE_LABELS[h.source]}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-kumo-subtle">
                        {KIND_LABELS[h.kind]}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {inr(h.value)}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {m.totals.value
                          ? ((h.value / m.totals.value) * 100).toFixed(1)
                          : "0"}
                        %
                      </td>
                      <td
                        className={`py-2 px-4 sm:pr-0 text-right tabular-nums ${signClass(h.value - h.invested)}`}
                      >
                        {pct(gainPct(h))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
