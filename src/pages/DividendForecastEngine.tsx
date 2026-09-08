import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchStockPrices, searchStocks, type SearchResult } from "../utils/api";
import { fetchDividendForecast, type DividendCommitment, type CommitmentSummaryRemote, type ForecastResult, type ForecastChoice, type PayoutMethod, type ForecastOptions } from "../utils/dividendForecast";
import { YIELD_GRID_STOCKS } from "../data/yieldGridStocks";
import {
  addDividendForecastLike,
  getDividendForecastLikes,
  hasDividendForecastLiked,
} from "../utils/gridLikes";

type ForecastView = ForecastResult & { price: number | null; yieldRate: number | null };

const gateway = "https://vercel-dividend-d8faqegf03442b6c.service.tcloudbase.com/stockPrice";
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const billion = (value: number) => `${(value / 1e8).toFixed(2)} 亿`;
const forecastSectors = ["全部", ...new Set(YIELD_GRID_STOCKS.map((stock) => stock.sector))];
const MANUAL_PROFIT_RATIO_KEY = "dividend-forecast-manual-profit-ratios";
const FORECAST_METHOD_KEY = "dividend-forecast-methods";

function readManualProfitRatio(code: string): number | null {
  try {
    const saved = JSON.parse(localStorage.getItem(MANUAL_PROFIT_RATIO_KEY) || "{}") as Record<string, unknown>;
    const ratio = saved[code];
    return typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : null;
  } catch {
    return null;
  }
}

function saveManualProfitRatio(code: string, ratio: number | null) {
  try {
    const saved = JSON.parse(localStorage.getItem(MANUAL_PROFIT_RATIO_KEY) || "{}") as Record<string, unknown>;
    if (ratio === null) delete saved[code];
    else saved[code] = ratio;
    localStorage.setItem(MANUAL_PROFIT_RATIO_KEY, JSON.stringify(saved));
  } catch {
    // 本地存储不可用时仍保留当前页面的手动结果。
  }
}

function readForecastMethod(code: string): ForecastChoice {
  try {
    const saved = JSON.parse(localStorage.getItem(FORECAST_METHOD_KEY) || "{}") as Record<string, unknown>;
    const method = saved[code];
    return method === "profit" || method === "interim" || method === "policy" ? method : "auto";
  } catch {
    return "auto";
  }
}

function saveForecastMethod(code: string, method: ForecastChoice) {
  try {
    const saved = JSON.parse(localStorage.getItem(FORECAST_METHOD_KEY) || "{}") as Record<string, unknown>;
    if (method === "auto") delete saved[code];
    else saved[code] = method;
    localStorage.setItem(FORECAST_METHOD_KEY, JSON.stringify(saved));
  } catch {
    // 本地存储不可用时仍保留当前页面的模型选择。
  }
}

function commitmentRule(commitment: DividendCommitment) {
  const rules = [
    commitment.minPayoutRatio !== undefined
      ? `现金分红不低于${commitment.basis || "归母净利润"}的${(commitment.minPayoutRatio * 100).toFixed(0)}%`
      : null,
    commitment.minDps !== undefined ? `每股不低于${commitment.minDps.toFixed(2)}元` : null,
    commitment.minCashAmount !== undefined
      ? `现金分红总额不低于${(commitment.minCashAmount / 1e8).toFixed(0)}亿元`
      : null,
  ].filter(Boolean);
  return rules.join("；") || commitment.commitmentText || "以原公告约定为准";
}

function BackIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M11.75 4.25 6 10l5.75 5.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M15.5 8.25A6 6 0 1 0 16 12M15.5 4.5v3.75h-3.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DividendForecastEngine() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("600941");
  const [result, setResult] = useState<ForecastView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const adjusting = useRef(false);
  const [matches, setMatches] = useState<SearchResult[]>([]);
  const [activeSector, setActiveSector] = useState("全部");
  const [payoutChoice, setPayoutChoice] = useState<"auto" | PayoutMethod>("auto");
  const [forecastChoice, setForecastChoice] = useState<ForecastChoice>("auto");
  const [manualRatioInput, setManualRatioInput] = useState("");
  const [manualRatioApplied, setManualRatioApplied] = useState(false);
  const [commitments, setCommitments] = useState<DividendCommitment[]>([]);
  const [likes, setLikes] = useState<number | null>(null);
  const [liked, setLiked] = useState(hasDividendForecastLiked);
  const [liking, setLiking] = useState(false);

  const runFor = async (keyword: string) => {
    let code = keyword.trim();
    if (!code) {
      setError("请输入 6 位 A 股代码或股票名称。");
      return;
    }
    const id = ++requestId.current;
    adjusting.current = false;
    setLoading(true);
    setError("");
    setResult(null);
    setMatches([]);
    setPayoutChoice("auto");
    setForecastChoice("auto");
    setManualRatioInput("");
    setManualRatioApplied(false);
    try {
      if (!/^\d{6}$/.test(code)) {
        const candidates = (await searchStocks(code)).filter(
          (item) => !item.isHK && !item.isUS && /^\d{6}$/.test(item.code),
        );
        if (id !== requestId.current) return;
        if (candidates.length === 0) throw new Error(`未找到“${code}”对应的 A 股标的。`);
        if (candidates.length > 1) {
          setMatches(candidates.slice(0, 8));
          return;
        }
        code = candidates[0].code;
      }
      const savedRatio = readManualProfitRatio(code);
      const savedMethod = readForecastMethod(code);
      const [prediction, prices] = await Promise.all([
        fetchDividendForecast(code, { profitRatio: savedRatio ?? undefined, forecastMethod: savedMethod }),
        fetchStockPrices([{ code }], true),
      ]);
      if (id !== requestId.current) return;
      const price = prices[code]?.price ?? null;
      setResult({ ...prediction, price, yieldRate: price && price > 0 ? prediction.annualDps / price : null });
      setForecastChoice(savedMethod);
      setManualRatioInput((prediction.profitRatio * 100).toFixed(2));
      setManualRatioApplied(savedRatio !== null);
    } catch (reason) {
      if (id === requestId.current) setError(reason instanceof Error ? reason.message : "数据请求失败，请稍后重试。");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  const run = async (event?: FormEvent) => {
    event?.preventDefault();
    await runFor(query);
  };

  const recalculate = async (options: ForecastOptions, onSuccess: () => void) => {
    if (!result || loading || adjusting.current) return;
    const current = result;
    const id = ++requestId.current;
    adjusting.current = true;
    setLoading(true);
    setError("");
    try {
      const prediction = await fetchDividendForecast(current.code, {
        profitRatio: current.profitRatio,
        payoutMethod: current.payoutMethod,
        forecastMethod: forecastChoice,
        ...options,
      });
      if (id !== requestId.current) return;
      setResult({
        ...prediction,
        // Manual edits retain the system choice made when this stock was first queried.
        systemPayoutMethod: current.systemPayoutMethod,
        price: current.price,
        yieldRate: current.price && current.price > 0 ? prediction.annualDps / current.price : null,
      });
      onSuccess();
    } catch (reason) {
      if (id === requestId.current) setError(reason instanceof Error ? reason.message : "重新计算失败，请稍后重试。");
    } finally {
      if (id === requestId.current) {
        adjusting.current = false;
        setLoading(false);
      }
    }
  };

  const selectPayout = (choice: "auto" | PayoutMethod) => {
    if (!result) return;
    void recalculate({ payoutMethod: choice === "auto" ? result.systemPayoutMethod : choice }, () => setPayoutChoice(choice));
  };

  const selectForecastMethod = (choice: ForecastChoice) => {
    if (!result) return;
    const code = result.code;
    void recalculate({ forecastMethod: choice }, () => {
      setForecastChoice(choice);
      saveForecastMethod(code, choice);
    });
  };

  const applyManualRatio = () => {
    const ratio = Number(manualRatioInput) / 100;
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      setError("请输入大于 0 且不超过 100 的 H1 / 全年利润比例。");
      return;
    }
    if (!result) return;
    const code = result.code;
    void recalculate({ profitRatio: ratio }, () => {
      saveManualProfitRatio(code, ratio);
      setManualRatioApplied(true);
    });
  };

  const restoreMedianRatio = () => {
    if (!result) return;
    const { code, medianProfitRatio } = result;
    void recalculate({ profitRatio: medianProfitRatio }, () => {
      saveManualProfitRatio(code, null);
      setManualRatioInput((medianProfitRatio * 100).toFixed(2));
      setManualRatioApplied(false);
    });
  };

  useEffect(() => {
    void runFor("600941");
    void getDividendForecastLikes().then(setLikes).catch(() => {});
    void fetch(`${gateway}?action=dividendCommitmentSummary`)
      .then((request) =>
        request.ok
          ? (request.json() as Promise<CommitmentSummaryRemote>)
          : Promise.reject(new Error("承诺汇总请求失败")),
      )
      .then((response) => setCommitments(response.commitments))
      .catch(() => setCommitments([]));
    return () => { requestId.current++; };
  }, []);

  const onLike = () => {
    if (liked || liking) return;
    setLiking(true);
    setLiked(true);
    setLikes((value) => (value ?? 0) + 1);
    void addDividendForecastLike()
      .then(setLikes)
      .catch(() => {
        setLiked(false);
        setLikes((value) => (value === null ? value : value - 1));
      })
      .finally(() => setLiking(false));
  };

  const maxDps = result
    ? Math.max(result.annualDps, ...result.history.map((item) => item.perShare), 0.01)
    : 1;
  const policyRatioDps =
    result?.commitment?.minPayoutRatio !== undefined
      ? (result.annualProfit * result.commitment.minPayoutRatio) / result.shares
      : null;
  const policyCashDps =
    result?.commitment?.minCashAmount !== undefined
      ? result.commitment.minCashAmount / result.shares
      : null;
  return (
    <main className="forecast-page" aria-busy={loading}>
      <div className="forecast-shell">
        <div className="forecast-toolbar">
          <button className="forecast-back" onClick={() => navigate("/yield-grid")}>
            <BackIcon /> 返回网格页
          </button>
          <span className="forecast-live">
            <i /> 实时数据
          </span>
        </div>
        <header className="forecast-heading">
          <p className="forecast-kicker">DIVIDEND FORECAST · 2026E</p>
          <div className="forecast-heading-title">
            <h1>分红预测引擎</h1>
            <button
              type="button"
              className={`forecast-like${liked ? " liked" : ""}`}
              onClick={onLike}
              disabled={liked || liking}
              aria-pressed={liked}
              aria-label={liked ? "已点赞" : "点赞"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                <path d="M7 10v10H4V10h3Zm0 10h9.6a2 2 0 0 0 1.94-1.5l1.2-4.5A2 2 0 0 0 17.8 11H14l.45-3.1A2.4 2.4 0 0 0 12.08 5L7 10Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{likes === null ? "…" : likes}</span>
            </button>
          </div>
          <p>用中报利润、三年季节性、常规派息率和权益股本，生成可追溯的全年每股股息预测。</p>
          <section className="forecast-risk">
            <b>⚠️ 风险提示</b>
            <span>
              本页为基于已披露财报、历史分红与中期息的模型估算，不代表公司分红承诺。利润、派息率、股本及分红方案均可能变化；股价波动也会改变预期股息率。仅供研究参考，不构成任何投资建议。
            </span>
          </section>
        </header>
        <form className="forecast-search" onSubmit={run}>
          <label htmlFor="forecast-code">证券代码 / 名称</label>
          <input
            id="forecast-code"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={20}
            placeholder="输入 6 位代码或股票名称"
          />
          <button type="submit" disabled={loading}>
            {loading ? (result ? "正在重新计算" : "正在拉取数据") : "查询并计算"}
          </button>
          <div className="forecast-examples">
            <span>试试</span>
            <button type="button" onClick={() => setQuery("000423")}>
              东阿阿胶
            </button>
            <button type="button" onClick={() => setQuery("601318")}>
              中国平安
            </button>
            <button type="button" onClick={() => setQuery("600941")}>
              中国移动
            </button>
            <button type="button" onClick={() => setQuery("601728")}>
              中国电信
            </button>
          </div>
        </form>
        <div className="forecast-rule">
          <b>本页规则</b>
          <span>
            以利润模型、中期息同比锚定和有效期内的量化分红承诺三条路径交叉校验，取全年每股股息较高的可审计下限；缺少任一核心输入即暂不覆盖。
          </span>
        </div>
        {commitments.length > 0 && (
          <section className="forecast-commitment-summary">
            <div className="forecast-commitment-summary-head">
              <div>
                <span>2026 分红承诺库</span>
                <strong>{commitments.length} 条有效量化承诺</strong>
                <p>公告规划已入库；仅与“归母净利”口径一致的承诺会作为预测下限。</p>
              </div>
              <div className="forecast-commitment-counts">
                <b>
                  {commitments.filter((item) => item.modelEligible).length}
                  <small>纳入模型</small>
                </b>
                <b>
                  {commitments.filter((item) => !item.modelEligible).length}
                  <small>仅留档</small>
                </b>
              </div>
            </div>
            <details>
              <summary>
                查看全部 {commitments.length} 条承诺 <span>展开</span>
              </summary>
              <div className="forecast-commitment-groups">
                {([true, false] as const).map((eligible) => {
                  const items = commitments.filter(
                    (item) => Boolean(item.modelEligible) === eligible,
                  );
                  return (
                    <div className="forecast-commitment-group" key={String(eligible)}>
                      <h3>
                        {eligible ? "已纳入预测下限" : "已记录，暂不直接套用"}{" "}
                        <small>{items.length} 条</small>
                      </h3>
                      <div className="forecast-commitment-table-head">
                        <span>标的</span>
                        <span>代码</span>
                        <span>有效期</span>
                        <span>承诺内容</span>
                        <span>具体承诺</span>
                      </div>
                      {items.map((item) => {
                        const stock = YIELD_GRID_STOCKS.find(
                          (candidate) => candidate.code === item.code,
                        );
                        const rule = [
                          item.minPayoutRatio !== undefined
                            ? `≥ ${(item.minPayoutRatio * 100).toFixed(0)}%`
                            : null,
                          item.minDps !== undefined ? `每股 ≥ ${item.minDps.toFixed(2)} 元` : null,
                          item.minCashAmount !== undefined
                            ? `现金 ≥ ${(item.minCashAmount / 1e8).toFixed(0)} 亿元`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <a
                            key={item.code}
                            href={item.eastmoneySourceUrl || item.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`查看${stock?.name || item.name || item.code}的分红承诺公告（新窗口打开）`}
                          >
                            <strong>{stock?.name || item.name || item.code}</strong>
                            <span className="forecast-commitment-code">{item.code}</span>
                            <span className="forecast-commitment-period">
                              {item.startYear}–{item.endYear}
                            </span>
                            <b>{rule || item.commitmentText || item.basis || "查看公告"}</b>
                            <em>{commitmentRule(item)}</em>
                          </a>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </details>
          </section>
        )}
        <section className="forecast-sector-picker">
          <div className="forecast-sector-tabs">
            {forecastSectors.map((sector) => (
              <button
                type="button"
                key={sector}
                className={activeSector === sector ? "active" : ""}
                onClick={() => setActiveSector(sector)}
              >
                {sector}
              </button>
            ))}
          </div>
          {activeSector === "全部" ? (
            <p>选择一个板块，快速带入网格页标的。</p>
          ) : (
            <div className="forecast-sector-stocks">
              {YIELD_GRID_STOCKS.filter((stock) => stock.sector === activeSector).map((stock) => (
                <button
                  type="button"
                  key={stock.code}
                  onClick={() => {
                    setQuery(stock.code);
                    void runFor(stock.code);
                  }}
                >
                  <strong>{stock.name}</strong>
                  <span>{stock.code}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        {matches.length > 0 && (
          <section className="forecast-search-results">
            <b>找到多个 A 股标的，请选择：</b>
            <div>
              {matches.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => {
                    setQuery(item.code);
                    void runFor(item.code);
                  }}
                >
                  <strong>{item.name}</strong>
                  <span>{item.code}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {error && (
          <section className="forecast-error">
            <b>暂不覆盖</b>
            <span>{error}</span>
          </section>
        )}
        {result && (
          <>
            <section className="forecast-result-head">
              <div>
                <div className="forecast-security">
                  <span>{result.code}</span>
                  <h2>{result.name}</h2>
                  <em>中报锚定 · B级</em>
                </div>
                <p>财报与分红数据可能有 5 分钟更新延迟；每股预测不随盘中行情变动，预期股息率随现价更新。</p>
              </div>
              <button className="forecast-refresh" onClick={() => run()} disabled={loading}>
                <RefreshIcon /> 刷新数据
              </button>
            </section>
            <section className="forecast-hero-grid" aria-label="预测结果">
              <article className="forecast-main-kpi">
                <span>26E 每股股息</span>
                <strong>
                  {result.annualDps.toFixed(3)}
                  <small>元</small>
                </strong>
                <p>
                  {result.terminalDps === null
                    ? "中期息尚未公告"
                    : `预计末期：${result.terminalDps.toFixed(3)} 元`}
                </p>
              </article>
              <article>
                <span>26E 预期股息率</span>
                <strong className="forecast-accent">
                  {result.yieldRate === null ? "—" : percent(result.yieldRate)}
                </strong>
                <p>现价：{result.price === null ? "未取得" : `${result.price.toFixed(2)} 元`}</p>
              </article>
              <article>
                <span>全年归母净利润</span>
                <strong>{billion(result.annualProfit)}</strong>
                <p>26H1：{billion(result.h1Profit)}</p>
              </article>
              <article className="forecast-payout-kpi">
                <span>26E 推算派息率</span>
                <strong>{percent(result.appliedPayout)}</strong>
                <p>
                  {result.usesInterimAnchor
                    ? `中期息锚定；历史基准 ${percent(result.payout)}`
                    : `历史基准：23–25 年${result.payoutMethod === "latest" ? "最近一年" : result.payoutMethod === "median" ? "中位数" : "平均值"}`}
                </p>
                <div className="forecast-payout-quick-switch">
                  <button
                    type="button" disabled={loading}
                    className={result.payoutMethod === "average" ? "active" : ""}
                    onClick={() => selectPayout("average")}
                  >
                    平均 {percent(result.payoutAverage)}
                  </button>
                  <button
                    type="button" disabled={loading}
                    className={result.payoutMethod === "median" ? "active" : ""}
                    onClick={() => selectPayout("median")}
                  >
                    中位 {percent(result.payoutMedian)}
                  </button>
                  <button
                    type="button" disabled={loading}
                    className={result.payoutMethod === "latest" ? "active" : ""}
                    onClick={() => selectPayout("latest")}
                  >
                    最近 {percent(result.payoutLatest)}
                  </button>
                </div>
                <div
                  className="forecast-info-tip"
                  tabIndex={0}
                  aria-label="查看与切换近三年派息率"
                >
                  i
                  <span role="tooltip">
                    <b>近三年常规现金派息率</b>
                    {result.payouts.map((item) => (
                      <em key={item.year}>
                        {item.year}
                        <strong>{percent(item.payoutRatio / 100)}</strong>
                      </em>
                    ))}
                    <div className="forecast-payout-switch">
                      <button
                        type="button" disabled={loading}
                        className={payoutChoice === "auto" ? "active" : ""}
                        onClick={() => {
                          selectPayout("auto");
                        }}
                      >
                        系统默认 ·{" "}
                        {result.systemPayoutMethod === "average"
                          ? "平均值"
                          : result.systemPayoutMethod === "median"
                            ? "中位数"
                            : "最近一年"}
                      </button>
                      <button
                        type="button" disabled={loading}
                        className={payoutChoice === "average" ? "active" : ""}
                        onClick={() => {
                          selectPayout("average");
                        }}
                      >
                        平均值 {percent(result.payoutAverage)}
                      </button>
                      <button
                        type="button" disabled={loading}
                        className={payoutChoice === "median" ? "active" : ""}
                        onClick={() => {
                          selectPayout("median");
                        }}
                      >
                        中位数 {percent(result.payoutMedian)}
                      </button>
                      <button
                        type="button" disabled={loading}
                        className={payoutChoice === "latest" ? "active" : ""}
                        onClick={() => {
                          selectPayout("latest");
                        }}
                      >
                        最近一年 {percent(result.payoutLatest)}
                      </button>
                    </div>
                    <small>
                      当前利润模型：<strong>{percent(result.effectivePayout)}</strong>
                    </small>
                    <small>
                      26E 推算派息率：<strong>{percent(result.appliedPayout)}</strong>
                    </small>
                  </span>
                </div>
              </article>
            </section>
            {result.commitment && (
              <section className={`forecast-policy ${result.policyApplied ? "is-applied" : ""}`}>
                <div>
                  <b>
                    {result.policyApplied
                      ? "分红承诺下限已纳入"
                      : result.commitment.modelEligible === false
                        ? "分红承诺已记录，未直接套用"
                        : "分红承诺下限校验"}
                  </b>
                  <span>
                    {result.commitment.startYear}–{result.commitment.endYear} 年有效 ·{" "}
                    {result.commitment.includesInterim ? "全年口径，含中期息" : "全年口径"} ·{" "}
                    {result.commitment.conditional ? "条件性承诺" : "量化承诺"}
                  </span>
                </div>
                <strong>
                  {result.commitment.modelEligible === false
                    ? `口径：${result.commitment.basis || "公告口径"}`
                    : `26E 政策下限 ${result.policyDpsFloor?.toFixed(3)} 元/股`}
                </strong>
                <p>
                  <b>承诺内容：</b>
                  {commitmentRule(result.commitment)}。
                  {result.commitment.conditions.length > 0
                    ? `适用条件：${result.commitment.conditions.join("；")}。`
                    : ""}
                  <a
                    href={result.commitment.eastmoneySourceUrl || result.commitment.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {result.commitment.eastmoneySourceUrl ? "查看东方财富公告" : "查看原公告"}
                  </a>
                </p>
              </section>
            )}
            {result.interimExceedsModel && (
              <section className="forecast-alert">
                <b>数据校验提示</b>
                <span>
                  模型推算的全年股息低于已公告中期息，结果未被“max”覆盖；请等待年末利润或分红方案更新后再判断。
                </span>
              </section>
            )}
            <section className="forecast-desktop-data">
              <div className="forecast-section-title">
                <div>
                  <h2>预测输入与计算过程</h2>
                  <p>所有展示值均为本次查询的原始输入或其直接计算结果。</p>
                </div>
                <span>单位：元 / 股 / 亿元</span>
              </div>
              <div className="forecast-data-layout">
                <div className="forecast-matrix">
                  <div className="forecast-matrix-head">
                    <span>利润季节性</span>
                    <span>H1 归母净利</span>
                    <span>全年归母净利</span>
                    <span>H1 / 全年</span>
                  </div>
                  <div className="forecast-matrix-row forecast-matrix-forecast">
                    <b>
                      2026E <small>{manualRatioApplied ? "手动" : "预测"}</small>
                    </b>
                    <span>{billion(result.h1Profit)}</span>
                    <span>{billion(result.annualProfit)}</span>
                    <strong>{percent(result.medianProfitRatio)}</strong>
                  </div>
                  {result.seasonality.map((item) => (
                    <div className="forecast-matrix-row" key={item.year}>
                      <b>{item.year}</b>
                      <span>{billion(item.h1Profit)}</span>
                      <span>{billion(item.annualProfit)}</span>
                      <strong>{percent(item.ratio)}</strong>
                    </div>
                  ))}
                  <div className="forecast-matrix-row forecast-matrix-result">
                    <b>中位数</b>
                    <span>—</span>
                    <span>—</span>
                    <strong>{percent(result.medianProfitRatio)}</strong>
                  </div>
                </div>
                <div className="forecast-input-list">
                  <div>
                    <span>已公告中期股息</span>
                    <b>
                      {result.interim === null ? "尚未公告" : `${result.interim.toFixed(3)} 元/股`}
                    </b>
                  </div>
                  <div>
                    <span>权益分派股本</span>
                    <b>
                      {(result.shares / 1e8).toFixed(3)} 亿股
                      <a
                        className="forecast-source-link"
                        href={`https://data.eastmoney.com/yjfp/detail/${result.code}.html`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        来源：东方财富分红方案
                      </a>
                    </b>
                  </div>
                  <div>
                    <span>下半年修正系数</span>
                    <b>
                      1.00 <small>无披露依据调整</small>
                    </b>
                  </div>
                  <div className="forecast-manual-profit">
                    <span>H1 / 全年利润比例 <small>可调节</small></span>
                    <div>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={manualRatioInput}
                        onChange={(event) => setManualRatioInput(event.target.value)}
                        placeholder="百分比"
                        aria-label="手动设定H1归母净利占全年利润比例，单位百分比"
                      />
                      <b>%</b>
                      <button type="button" disabled={loading} onClick={applyManualRatio}>采用</button>
                    </div>
                    {manualRatioApplied ? (
                      <button type="button" disabled={loading} onClick={restoreMedianRatio}>恢复中位数</button>
                    ) : (
                      <small>默认历史中位数；上下箭头每次调整 1%，也可直接输入</small>
                    )}
                  </div>
                  <div>
                    <span>预测末期股息</span>
                    <b>
                      {result.terminalDps === null
                        ? "待中期息公告后拆分"
                        : `${result.terminalDps.toFixed(3)} 元/股`}
                    </b>
                  </div>
                </div>
              </div>
              <div className="forecast-formulas">
                <div
                  className={`forecast-equation forecast-equation-selectable ${result.forecastMethod === "profit" ? "is-selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label="采用利润模型"
                  aria-pressed={result.forecastMethod === "profit"}
                  onClick={() => selectForecastMethod("profit")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectForecastMethod("profit");
                    }
                  }}
                >
                  <b className="forecast-formula-label">利润模型</b>
                  {manualRatioApplied ? (
                    <span>
                      26H1 利润 <b>{billion(result.h1Profit)}</b> ÷ 手动比例 <b>{manualRatioInput}%</b>
                    </span>
                  ) : (
                    <>
                      <span>
                        26H1 利润 <b>{billion(result.h1Profit)}</b>
                      </span>
                      <i>÷</i>
                      <span>
                        季节性中位数{" "}
                        <b>{percent(result.medianProfitRatio)}</b>
                      </span>
                    </>
                  )}
                  <i>×</i>
                  <span>
                    选择派息率 <b>{percent(result.effectivePayout)}</b>
                  </span>
                  <i>÷</i>
                  <span>
                    权益股本 <b>{(result.shares / 1e8).toFixed(3)} 亿股</b>
                  </span>
                  <i>=</i>
                  <strong>{result.profitDps.toFixed(3)} 元/股</strong>
                  <em>{result.forecastMethod === "profit" ? forecastChoice === "profit" || manualRatioApplied ? "手动采用" : "已采用" : "参考"}</em>
                </div>
                {result.interimAnchor !== null && (
                  <div
                    className={`forecast-equation forecast-equation-selectable ${result.forecastMethod === "interim" ? "is-selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-label="采用中期息同比锚定"
                    aria-pressed={result.forecastMethod === "interim"}
                    onClick={() => selectForecastMethod("interim")}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectForecastMethod("interim");
                      }
                    }}
                  >
                    <b className="forecast-formula-label">中期息同比锚定</b>
                    <span>
                      25年全年股息 <b>{result.priorAnnualDps?.toFixed(3)} 元</b>
                    </span>
                    <i>×</i>
                    <span>
                      26H1 中期息 <b>{result.interim?.toFixed(3)} 元</b>
                    </span>
                    <i>÷</i>
                    <span>
                      25H1 中期息 <b>{result.priorInterim?.toFixed(3)} 元</b>
                    </span>
                    <i>=</i>
                    <strong>{result.interimAnchor.toFixed(3)} 元/股</strong>
                    <em>
                      {result.forecastMethod === "interim"
                        ? forecastChoice === "interim" ? "手动采用" : "已采用（更保守）"
                        : "参考"}
                    </em>
                  </div>
                )}
                {result.commitment?.modelEligible && (
                  <div
                    className={`forecast-equation forecast-policy-equation forecast-equation-selectable ${result.forecastMethod === "policy" ? "is-selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-label="采用政策下限"
                    aria-pressed={result.forecastMethod === "policy"}
                    onClick={() => selectForecastMethod("policy")}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectForecastMethod("policy");
                      }
                    }}
                  >
                    <b className="forecast-formula-label">政策下限</b>
                    {policyRatioDps !== null && (
                      <span>
                        比例下限 <b>{percent(result.commitment.minPayoutRatio!)}</b> × {billion(result.annualProfit)} ÷ {(result.shares / 1e8).toFixed(3)} 亿股 = <b>{policyRatioDps.toFixed(3)} 元/股</b>
                      </span>
                    )}
                    {policyCashDps !== null && (
                      <span>
                        现金下限 <b>{billion(result.commitment.minCashAmount!)}</b> ÷ {(result.shares / 1e8).toFixed(3)} 亿股 = <b>{policyCashDps.toFixed(3)} 元/股</b>
                      </span>
                    )}
                    {result.commitment.minDps !== undefined && (
                      <span>每股下限 <b>{result.commitment.minDps.toFixed(3)} 元/股</b></span>
                    )}
                    <i>→</i>
                    <span>取较高值</span>
                    <strong>{result.policyDpsFloor?.toFixed(3)} 元/股</strong>
                    <em>{result.forecastMethod === "policy" ? forecastChoice === "policy" ? "手动采用" : "已纳入" : "下限校验"}</em>
                  </div>
                )}
                  <p>
                    手动比例仅影响本次预测，不会修改历史季节性中位数。{" "}
                  </p>
                  <p>
                    {result.commitment?.modelEligible === false
                    ? `该承诺为“${result.commitment.basis || "公告指定"}”口径或累计期间约束，无法可靠拆分为单年下限，已留档但不参与 2026E 计算。`
                    : result.policyApplied
                      ? `已纳入 ${result.commitment?.sourceName} 的有效期内量化下限；该承诺${result.commitment?.conditional ? "存在公告列明的适用条件，" : ""}不代表公司分红承诺。`
                      : result.usesInterimAnchor
                        ? `利润模型为 ${result.profitDps.toFixed(3)} 元/股；中期息同比结果为 ${result.interimAnchor?.toFixed(3)} 元/股，当前采用更保守的中期息同比结果。`
                        : "选择利润模型：未触发中期息锚定或政策下限高于模型的条件。"}
                </p>
              </div>
            </section>
            <section className="forecast-desktop-data forecast-history-panel">
              <div className="forecast-section-title">
                <div>
                  <h2>历史实际股息与派息率</h2>
                  <p>
                    股息为已公告/实施口径；派息率在异常值出现时取三年中位数，否则取平均值，不用特别分红做外推。
                  </p>
                </div>
              </div>
              <div className="forecast-history-grid">
                <div className="forecast-bar-chart">
                  {[...result.history, { year: 2026, perShare: result.annualDps }].map((item) => (
                    <div className="forecast-bar-item" key={item.year}>
                      <span className="forecast-bar-value">{item.perShare.toFixed(3)}</span>
                      <div
                        className={`forecast-bar ${item.year === 2026 ? "is-forecast" : ""}`}
                        style={{ height: `${Math.max(12, (item.perShare / maxDps) * 134)}px` }}
                      />
                      <b>{item.year === 2026 ? "2026E" : item.year}</b>
                    </div>
                  ))}
                </div>
                <div className="forecast-payout-table">
                  <div>
                    <span>年度</span>
                    <span>常规现金派息率</span>
                  </div>
                  {result.payouts.map((item) => (
                    <div key={item.year}>
                      <b>{item.year}</b>
                      <strong>{percent(item.payoutRatio / 100)}</strong>
                    </div>
                  ))}
                  <div className="forecast-payout-median">
                    <b>平均值{result.payoutMethod === "average" ? "（模型）" : "（参考）"}</b>
                    <strong>{percent(result.payoutAverage)}</strong>
                  </div>
                  <div className="forecast-payout-median">
                    <b>中位数{result.payoutMethod === "median" ? "（模型）" : "（参考）"}</b>
                    <strong>{percent(result.payoutMedian)}</strong>
                  </div>
                </div>
              </div>
            </section>
            <div className="forecast-mobile-data">
              <details open>
                <summary>
                  预测输入与计算过程 <span>展开</span>
                </summary>
                <div className="forecast-mobile-detail">
                  <div className="forecast-mobile-method-switch" aria-label="预测模型选择">
                    <button
                      type="button" disabled={loading}
                      className={result.forecastMethod === "profit" ? "active" : ""}
                      onClick={() => selectForecastMethod("profit")}
                    >
                      利润模型
                    </button>
                    {result.interimAnchor !== null && (
                      <button
                        type="button" disabled={loading}
                        className={result.forecastMethod === "interim" ? "active" : ""}
                        onClick={() => selectForecastMethod("interim")}
                      >
                        中期息锚定
                      </button>
                    )}
                    {result.commitment?.modelEligible && (
                      <button
                        type="button" disabled={loading}
                        className={result.forecastMethod === "policy" ? "active" : ""}
                        onClick={() => selectForecastMethod("policy")}
                      >
                        政策下限
                      </button>
                    )}
                  </div>
                  {result.usesInterimAnchor ? (
                    <>
                      <p>
                        模型采用 <b>中期息同比锚定</b>
                      </p>
                      <p>
                        25年全年股息 <b>{result.priorAnnualDps?.toFixed(3)} 元/股</b>
                      </p>
                      <p>
                        26H1 / 25H1 中期息{" "}
                        <b>
                          {result.interim?.toFixed(3)} ÷ {result.priorInterim?.toFixed(3)}
                        </b>
                      </p>
                      <p>
                        利润模型（参考） <b>{result.profitDps.toFixed(3)} 元/股</b>
                      </p>
                    </>
                  ) : (
                    <>
                      <p>
                        26H1 归母净利 <b>{billion(result.h1Profit)}</b>
                      </p>
                      <p>
                        季节性中位数{" "}
                        <b>{percent(result.medianProfitRatio)}</b>
                      </p>
                      <p>
                        选择派息率 <b>{percent(result.effectivePayout)}</b>
                      </p>
                      <p>
                        权益分派股本 <b>{(result.shares / 1e8).toFixed(3)} 亿股</b>
                      </p>
                    </>
                  )}
                  {result.commitment?.modelEligible && (
                    <p>
                      政策下限 <b>{result.policyDpsFloor?.toFixed(3)} 元/股</b>
                    </p>
                  )}
                  <p>
                    已公告中期股息{" "}
                    <b>
                      {result.interim === null ? "尚未公告" : `${result.interim.toFixed(3)} 元/股`}
                    </b>
                  </p>
                  <p>
                    预计末期股息{" "}
                    <b>
                      {result.terminalDps === null
                        ? "待中期息公告后拆分"
                        : `${result.terminalDps.toFixed(3)} 元/股`}
                    </b>
                  </p>
                  <div className="forecast-mobile-manual-profit">
                    <b>H1 / 全年利润比例（可调节）</b>
                    <div>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={manualRatioInput}
                        onChange={(event) => setManualRatioInput(event.target.value)}
                        placeholder="百分比"
                        aria-label="手动设定H1归母净利占全年利润比例，单位百分比"
                      />
                      <b>%</b>
                      <button type="button" disabled={loading} onClick={applyManualRatio}>采用</button>
                    </div>
                    {manualRatioApplied ? (
                      <button type="button" disabled={loading} onClick={restoreMedianRatio}>恢复中位数</button>
                    ) : (
                      <small>默认历史中位数；上下箭头每次调整 1%，也可直接输入</small>
                    )}
                  </div>
                </div>
              </details>
              <details>
                <summary>
                  23–25 年利润季节性 <span>展开</span>
                </summary>
                <div className="forecast-mobile-detail">
                  {result.seasonality.map((item) => (
                    <p key={item.year}>
                      {item.year} H1/全年 <b>{percent(item.ratio)}</b>
                    </p>
                  ))}
                </div>
              </details>
              <details>
                <summary>
                  历史股息与派息率 <span>展开</span>
                </summary>
                <div className="forecast-mobile-detail">
                  {result.history.map((item) => (
                    <p key={item.year}>
                      {item.year} 实际股息 <b>{item.perShare.toFixed(3)} 元/股</b>
                    </p>
                  ))}
                  {result.payouts.map((item) => (
                    <p key={`payout-${item.year}`}>
                      {item.year} 派息率 <b>{percent(item.payoutRatio / 100)}</b>
                    </p>
                  ))}
                </div>
              </details>
            </div>
          </>
        )}
        {!result && !error && !loading && (
          <section className="forecast-empty">
            <b>输入代码，开始一次可追溯的预测</b>
            <span>会同时核验中报利润、近三年季节性、派息率、股本、中期息和实时价格。</span>
          </section>
        )}
      </div>
    </main>
  );
}
