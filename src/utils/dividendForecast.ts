/// <reference types="vite/client" />
import type { DividendPayoutRecord } from "./dividendPayout";
import type { DividendYearRecord } from "./dividendHistory";

export type DividendCommitment = {
  code: string;
  name?: string;
  startYear: number;
  endYear: number;
  minPayoutRatio?: number;
  minDps?: number;
  minCashAmount?: number;
  modelEligible?: boolean;
  basis?: string;
  includesInterim: boolean;
  conditional: boolean;
  conditions: string[];
  announcementDate: string;
  sourceUrl: string;
  eastmoneySourceUrl?: string;
  sourceName: string;
  commitmentText?: string;
};
export type CommitmentSummaryRemote = { year: number; commitments: DividendCommitment[] };
export type Seasonality = { year: number; h1Profit: number; annualProfit: number; ratio: number };
export type PayoutMethod = "average" | "median" | "latest";
export type ForecastChoice = "auto" | "profit" | "interim" | "policy";
export type ForecastMethod = Exclude<ForecastChoice, "auto">;
export const DIVIDEND_FORECAST_MODEL_VERSION = "2026-v1";
export type ForecastResult = {
  code: string;
  name: string;
  year: number;
  modelVersion: string;
  calculatedAt: string;
  profitRatio: number;
  medianProfitRatio: number;
  annualDps: number;
  terminalDps: number | null;
  annualProfit: number;
  h1Profit: number;
  payout: number;
  effectivePayout: number;
  appliedPayout: number;
  payoutAverage: number;
  payoutMedian: number;
  payoutLatest: number;
  payoutMethod: PayoutMethod;
  systemPayoutMethod: PayoutMethod;
  shares: number;
  shareSourceDate: string | null;
  interim: number | null;
  priorInterim: number | null;
  priorAnnualDps: number | null;
  profitDps: number;
  forecastMethod: ForecastMethod;
  interimAnchor: number | null;
  usesInterimAnchor: boolean;
  commitment: DividendCommitment | null;
  policyDpsFloor: number | null;
  policyApplied: boolean;
  seasonality: Seasonality[];
  payouts: DividendPayoutRecord[];
  history: DividendYearRecord[];
  interimExceedsModel: boolean;
};


export interface ForecastOptions {
  profitRatio?: number;
  payoutMethod?: "auto" | PayoutMethod;
  forecastMethod?: ForecastChoice;
}

export type ForecastBatchResult = {
  year: number;
  modelVersion: string;
  calculatedAt: string;
  results: Record<string, Pick<ForecastResult, "code" | "annualDps">>;
  errors: Record<string, string>;
};

const endpoint = "/api/dividend-forecast";

export async function fetchDividendForecast(code: string, options: ForecastOptions = {}): Promise<ForecastResult> {
  const params = new URLSearchParams({ code, year: "2026" });
  if (options.profitRatio !== undefined) params.set("profitRatio", String(options.profitRatio));
  if (options.payoutMethod) params.set("payoutMethod", options.payoutMethod);
  if (options.forecastMethod) params.set("forecastMethod", options.forecastMethod);
  const response = await fetch(endpoint + "?" + params, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "预测请求失败（" + response.status + "）");
  }
  return response.json() as Promise<ForecastResult>;
}

export async function fetchDividendForecasts(codes: string[]): Promise<ForecastBatchResult> {
  const uniqueCodes = [...new Set(codes)];
  if (uniqueCodes.length === 0) {
    return { year: 2026, modelVersion: "2026-v1", calculatedAt: new Date().toISOString(), results: {}, errors: {} };
  }
  const params = new URLSearchParams({ codes: uniqueCodes.join(","), year: "2026" });
  const response = await fetch(endpoint + "?" + params, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || "批量预测请求失败（" + response.status + "）");
  }
  return response.json() as Promise<ForecastBatchResult>;
}
