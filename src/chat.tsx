import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { Button, InputArea, PoweredByCloudflare, Text } from "@cloudflare/kumo";
import { Streamdown } from "streamdown";
import {
  ChatCircleDotsIcon,
  GearIcon,
  PaperPlaneRightIcon,
  StopIcon,
  TrashIcon
} from "@phosphor-icons/react";
import type { AgentClient } from "./dashboard";

const SUGGESTIONS = [
  "How is my portfolio doing?",
  "Which holding is my biggest risk?",
  "How much do I have in US stocks?",
  "What's TCS trading at, and its P/E?",
  "Summarise today's analysis"
];

const CONNECTOR_LABELS: Record<string, string> = {
  kite: "Kite",
  indmoney: "INDmoney",
  tapetide: "Tapetide"
};

/** "tapetide_get_quote" → "Tapetide: get quote". */
function toolLabel(name: string): string {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  const [prefix, ...rest] = name.split("_");
  const source = CONNECTOR_LABELS[prefix];
  return source ? `${source}: ${rest.join(" ")}` : name;
}

const TOOL_LABELS: Record<string, string> = {
  refreshPortfolio: "Fetching fresh holdings",
  getPastAnalyses: "Reading past analyses",
  runDailyAnalysis: "Running the daily analysis"
};

export function Chat({
  agent,
  connected
}: {
  agent: AgentClient;
  connected: boolean;
}) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, clearHistory, stop, status, error } =
    useAgentChat({
      agent,
      experimental_throttle: 100
    });
  const streaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || streaming) return;
      setInput("");
      sendMessage({ role: "user", parts: [{ type: "text", text: t }] });
    },
    [streaming, sendMessage]
  );

  return (
    <div className="flex flex-col h-full rounded-xl bg-kumo-base ring ring-kumo-line overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-kumo-line">
        <div className="flex items-center gap-2">
          <ChatCircleDotsIcon size={18} className="text-kumo-brand" />
          <span className="text-sm font-semibold">
            Ask about your investments
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          shape="square"
          aria-label="Clear chat"
          icon={<TrashIcon size={14} />}
          onClick={clearHistory}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <Text size="sm" variant="secondary">
              Answers come from your stored portfolio and the latest analysis.
              Research only, not financial advice.
            </Text>
            <div className="flex flex-wrap gap-2 pt-1">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="outline"
                  disabled={!connected || streaming}
                  onClick={() => send(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message: UIMessage, index) => {
          const isUser = message.role === "user";
          const isLast = index === messages.length - 1;
          return (
            <div key={message.id} className="space-y-2">
              {message.parts.map((part, i) => {
                const key = `${message.id}-${i}`;
                if (isToolUIPart(part)) {
                  const name = getToolName(part);
                  const done = part.state === "output-available";
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-2 text-xs text-kumo-subtle"
                    >
                      <GearIcon
                        size={12}
                        className={done ? "" : "animate-spin"}
                      />
                      {toolLabel(name)}
                      {done
                        ? " ✓"
                        : part.state === "output-error"
                          ? " (failed)"
                          : "…"}
                    </div>
                  );
                }
                if (part.type !== "text" || !part.text) return null;
                return isUser ? (
                  <div key={key} className="flex justify-end">
                    <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-md bg-kumo-contrast text-kumo-inverse text-sm leading-relaxed">
                      {part.text}
                    </div>
                  </div>
                ) : (
                  <div key={key} className="text-sm leading-relaxed">
                    <Streamdown
                      className="sd-theme"
                      controls={false}
                      isAnimating={isLast && streaming}
                    >
                      {part.text}
                    </Streamdown>
                  </div>
                );
              })}
            </div>
          );
        })}
        {status === "submitted" && (
          <Text size="xs" variant="secondary">
            Thinking…
          </Text>
        )}
        {error && (
          <div className="text-xs text-kumo-danger">
            Couldn't get a reply: {error.message}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="border-t border-kumo-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border border-kumo-line p-2 focus-within:ring-2 focus-within:ring-kumo-ring">
          <InputArea
            value={input}
            onValueChange={setInput}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask a question…"
            disabled={!connected}
            rows={1}
            className="flex-1 ring-0! focus:ring-0! shadow-none! bg-transparent! outline-none! resize-none max-h-32 text-sm"
          />
          {streaming ? (
            <Button
              type="button"
              variant="secondary"
              shape="square"
              aria-label="Stop"
              icon={<StopIcon size={16} />}
              onClick={stop}
            />
          ) : (
            <Button
              type="submit"
              variant="primary"
              shape="square"
              aria-label="Send"
              disabled={!input.trim() || !connected}
              icon={<PaperPlaneRightIcon size={16} />}
            />
          )}
        </div>
        <div className="flex justify-center pt-2">
          <PoweredByCloudflare href="https://developers.cloudflare.com/agents/" />
        </div>
      </form>
    </div>
  );
}
