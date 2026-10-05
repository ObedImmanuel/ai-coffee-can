# AI prompts

## How AI was used to build this project

This project was built with help from Claude (Anthropic) in Claude Code. I designed the product earlier in a larger personal project, "Coffee Can" (zero-knowledge encrypted portfolio tracking with a Claude agent). For this assignment I asked Claude to make a smaller version that runs entirely on Cloudflare. Claude scaffolded it from the official `agents-starter` template and wrote most of the code. I made the product decisions, reviewed the code, and tested it.

The main prompts I gave, lightly edited:

1. "I'm applying to Cloudflare and they are asking me to do an assignment that needs to use Cloudflare. If I need to submit this project as my assignment, list down all the changes I will need to make."
2. "Create a new repository and make some changes. Keep the features limited. Everything should be kept in Cloudflare. Just make: the dashboard where the user will see their portfolio, fetched from MCP and stored in the Cloudflare DB; connectors to help users connect to the MCP servers (Zerodha/Kite and INDmoney); a chat bot where the user can ask questions about their investments; a scheduled analysis that runs every day from the platform and updates the dashboard. Just keep it simple. Let me know if something is missing before starting the implementation."
3. Decisions I made when Claude asked:
   - brokers: Zerodha (Kite) and INDmoney
   - model: Workers AI rather than Claude via AI Gateway
   - sign-in: none, one portfolio per browser
   - privacy: simplified instead of end-to-end encryption, with the trade-off documented
4. "Use ai-coffee-can as the repo name. Keep it in the go/src directory."

## Prompts used at runtime

These live in the code.

### Daily analysis (`src/analysis.ts`, `ANALYSIS_SYSTEM`)

The model gets a system prompt asking for a review that:

- suits a long-term coffee-can investor in India
- uses only the numbers in the portfolio JSON
- writes amounts lakh/crore style
- never tells the user to buy or sell

It must reply with strict JSON: `headline`, `summary`, `highlights[]` and `watch[]`. The user message is today's date, the broker status and a compact portfolio JSON (totals, allocation, 14 days of history, and every holding with its gain).

### Chat (`src/server.ts`, `onChatMessage`)

The system prompt:

- describes the assistant and its not-an-adviser rule
- asks for concise answers that never invent numbers
- states that it can't place orders

It then adds the broker status, the latest analysis and the portfolio JSON. Tools: `refreshPortfolio`, `getPastAnalyses` and `runDailyAnalysis`.
