# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server (with API proxy)
npm run build     # Type-check + build for production
npm run preview   # Preview production build locally
```

No test runner is configured.

## Architecture

**Stack:** React 18 + TypeScript + Vite + Tailwind CSS + Zustand + Recharts

**Single global store** (`src/store/index.ts`) using Zustand with `persist` middleware (localStorage key: `dividend-h5-store`). All app state lives here: watchlist, discovery stocks, static edits, hidden stocks, sectors, exchange rate. `getDiscoveryStocks(sector)` is a derived helper that merges STATIC_STOCKS with per-stock edits and manual additions.

**5 pages** routed via react-router-dom, all rendered inside `App.tsx` with a persistent `TabBar`:
- `Discovery` — browse stocks by sector, supports hide/show, inline editing of static data
- `Watchlist` — user's tracked stocks with shares, cost price, tax type
- `Portfolio` — aggregate holdings view with P&L
- `Matrix` — yield comparison table (uses Recharts)
- `Settings` — exchange rate, backup/restore, disclaimer

**Data flow:**
- `src/data/stocks.ts` — static stock list (`STATIC_STOCKS`) and default sectors (`DEFAULT_SECTORS`); user edits are stored as `staticEdits` overlay in the store, never mutating the source data
- `src/utils/api.ts` — fetches live prices from Tencent finance (`qt.gtimg.cn`) and stock search from `smartbox.gtimg.cn`, both proxied through Vite dev server at `/api/*`; prices cached in-memory for 5 min, exchange rate for 6 hours
- `src/utils/cache.ts` — simple in-memory TTL cache
- `src/utils/tax.ts` — dividend tax logic: A-shares are tax-free; HK stocks split by account type (港户 10%, H股沪深通 20%, 非H股沪深通 28%)

**Stock code conventions:**
- A-shares: 6-digit strings (prefix determines exchange: `6xx` → SH, `0xx`/`3xx` → SZ, `8xx`/`4xx` → BJ)
- HK stocks: `isHK: true`, codes are 4–5 digit numeric strings
- `toTxCode()` in `api.ts` converts internal codes to Tencent's `shXXXXXX`/`szXXXXXX`/`hkXXXXX` format for API calls

**Production API proxy:** In production, `/api/*` routes are handled by **Vercel Serverless Functions** in the `api/` directory (e.g., `api/stock-price.js`). Each function proxies to the corresponding external API. Vite's `server.proxy` only works in dev. When adding a new `/api/*` route, always add a corresponding `api/<name>.js` file — do NOT use `vercel.json` rewrites for this purpose.

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
