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

**Production API proxy:** In production (non-dev), `/api/*` routes must be handled by a reverse proxy — they are not bundled.
