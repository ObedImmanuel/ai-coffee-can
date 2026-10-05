import { Suspense, useCallback, useState } from "react";
import { useAgent } from "agents/react";
import type { MCPServersState } from "agents";
import { Button, Text } from "@cloudflare/kumo";
import {
  CircleIcon,
  CoffeeIcon,
  MoonIcon,
  SparkleIcon,
  SunIcon
} from "@phosphor-icons/react";
import type { PortfolioAgent } from "./server";
import { EMPTY_STATE, type DashboardState } from "./portfolio";
import { Dashboard } from "./dashboard";
import { Chat } from "./chat";

/** No login: each browser gets its own private agent, named by a random id kept in localStorage. */
function userId(): string {
  try {
    let id = localStorage.getItem("coffee-can-user");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("coffee-can-user", id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
  );
  const toggle = useCallback(() => {
    const mode = dark ? "light" : "dark";
    setDark(!dark);
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    try {
      localStorage.setItem("theme", mode);
    } catch {
      // theme just won't persist
    }
  }, [dark]);
  return (
    <Button
      variant="secondary"
      shape="square"
      icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      onClick={toggle}
      aria-label="Toggle theme"
    />
  );
}

function Home() {
  const [name] = useState(userId);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<DashboardState>(EMPTY_STATE);
  const [mcp, setMcp] = useState<MCPServersState>({
    prompts: [],
    resources: [],
    servers: {},
    tools: []
  });

  const agent = useAgent<PortfolioAgent, DashboardState>({
    agent: "PortfolioAgent",
    name,
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onStateUpdate: useCallback((s: DashboardState) => setState(s), []),
    onMcpUpdate: useCallback((s: MCPServersState) => setMcp(s), [])
  });

  return (
    <div className="min-h-screen bg-kumo-elevated text-kumo-default">
      <header className="sticky top-0 z-20 px-4 sm:px-6 py-3 bg-kumo-base border-b border-kumo-line">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <CoffeeIcon
              size={22}
              weight="duotone"
              className="text-kumo-brand shrink-0"
            />
            <h1 className="text-lg font-semibold truncate">Coffee Can</h1>
            <span className="hidden sm:flex items-center gap-1.5 ml-3">
              <CircleIcon
                size={8}
                weight="fill"
                className={connected ? "text-kumo-success" : "text-kumo-danger"}
              />
              <Text size="xs" variant="secondary">
                {connected ? "Live" : "Connecting…"}
              </Text>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              icon={<SparkleIcon size={16} />}
              disabled={!connected || state.running}
              onClick={() => void agent.stub.runAnalysis()}
            >
              {state.running ? "Analysing…" : "Run analysis"}
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Dashboard
          state={state}
          mcp={mcp}
          agent={agent}
          connected={connected}
        />
        <aside className="lg:sticky lg:top-20 lg:h-[calc(100vh-6.5rem)] min-h-[520px]">
          <Chat agent={agent} connected={connected} />
        </aside>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen text-kumo-inactive">
          Loading…
        </div>
      }
    >
      <Home />
    </Suspense>
  );
}
