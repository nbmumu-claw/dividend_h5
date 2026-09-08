// Extracted from DividendForecastEngine; preserve 2026-v1 calculation rules.
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
function calculateAnnualDps(annualProfit, shares, payout, interimAnchor, commitment, choice) {
    const policyReferenceRatio = commitment?.minPayoutRatio ?? 0;
    const effectivePayout = payout;
    const profitDps = (annualProfit * payout) / shares;
    const usesInterimAnchor = interimAnchor !== null && interimAnchor < profitDps * 0.9;
    const beforePolicy = usesInterimAnchor ? interimAnchor : profitDps;
    const policyCanApply = commitment?.modelEligible === true;
    const policyDpsFloor = policyCanApply
        ? Math.max(commitment?.minDps ?? 0, commitment?.minCashAmount ? commitment.minCashAmount / shares : 0, policyReferenceRatio ? (annualProfit * policyReferenceRatio) / shares : 0)
        : null;
    const automaticMethod = policyCanApply && (policyDpsFloor ?? 0) > beforePolicy
        ? "policy"
        : usesInterimAnchor
            ? "interim"
            : "profit";
    const forecastMethod = choice === "profit" ||
        (choice === "interim" && interimAnchor !== null) ||
        (choice === "policy" && policyCanApply)
        ? choice
        : automaticMethod;
    const annualDps = forecastMethod === "profit"
        ? profitDps
        : forecastMethod === "interim"
            ? interimAnchor
            : forecastMethod === "policy"
                ? policyDpsFloor
                : profitDps;
    return {
        annualDps,
        effectivePayout,
        profitDps,
        policyDpsFloor,
        forecastMethod,
        policyApplied: forecastMethod === "policy",
        usesInterimAnchor: forecastMethod === "interim",
    };
}
function forecast(code, { response, payouts, history }, options = {}) {
    const report = (date) => response.reports.find((item) => item.REPORTDATE.startsWith(date))?.PARENT_NETPROFIT;
    const h1Profit = report("2026-06-30");
    const seasonality = [2025, 2024, 2023].map((year) => {
        const h1 = report(`${year}-06-30`), annual = report(`${year}-12-31`);
        if (!h1 || !annual)
            throw new Error(`缺少 ${year} 年中报或年报归母净利润。`);
        return { year, h1Profit: h1, annualProfit: annual, ratio: h1 / annual };
    });
    if (!h1Profit)
        throw new Error("尚未取得 2026 年中报归母净利润。");
    if (!response.latestShare?.TOTAL_SHARES)
        throw new Error("尚未取得最新权益分派股本。");
    if (payouts.length < 3)
        throw new Error("尚未取得连续三年的常规现金派息率。");
    const medianRatio = median(seasonality.map((item) => item.ratio));
    const savedManualRatio = options.profitRatio ?? null;
    const appliedRatio = savedManualRatio ?? medianRatio;
    const annualProfit = h1Profit / appliedRatio;
    const payoutRates = payouts.map((item) => item.payoutRatio / 100);
    const payoutAverage = average(payoutRates), payoutMedian = median(payoutRates);
    const payoutLatest = payouts.reduce((latest, item) => (item.year > latest.year ? item : latest)).payoutRatio /
        100;
    const profitSurge = annualProfit > seasonality[0].annualProfit * 1.15;
    const systemPayoutMethod = profitSurge && payoutLatest < payoutAverage - 0.03
        ? "latest"
        : Math.max(...payoutRates) > 1 ||
            Math.max(...payoutRates) - Math.min(...payoutRates) > 0.3
            ? "median"
            : "average";
    const payoutMethod = options.payoutMethod && options.payoutMethod !== "auto" ? options.payoutMethod : systemPayoutMethod;
    const payout = payoutMethod === "latest"
        ? payoutLatest
        : payoutMethod === "median"
            ? payoutMedian
            : payoutAverage;
    const shares = response.latestShare.TOTAL_SHARES, interim = response.interimDividend?.PRETAX_BONUS_RMB
        ? response.interimDividend.PRETAX_BONUS_RMB / 10
        : null;
    const priorInterim = response.priorInterimDividend?.PRETAX_BONUS_RMB
        ? response.priorInterimDividend.PRETAX_BONUS_RMB / 10
        : null;
    const priorAnnualDps = history?.records.find((item) => item.year === 2025)?.perShare ?? null;
    const interimAnchor = interim !== null && priorInterim !== null && priorAnnualDps !== null
        ? (priorAnnualDps * interim) / priorInterim
        : null;
    const savedForecastChoice = options.forecastMethod ?? "auto";
    const calculation = calculateAnnualDps(annualProfit, shares, payout, interimAnchor, response.dividendCommitment, savedForecastChoice);
    const { annualDps, effectivePayout, profitDps, forecastMethod, policyDpsFloor, policyApplied, usesInterimAnchor, } = calculation;
    const appliedPayout = (annualDps * shares) / annualProfit;
    return {
        code,
        year: 2026,
        modelVersion: "2026-v1",
        calculatedAt: new Date().toISOString(),
        profitRatio: appliedRatio,
        medianProfitRatio: medianRatio,
        name: response.name || code,
        annualDps,
        terminalDps: interim === null ? null : Math.max(annualDps - interim, 0),
        annualProfit,
        h1Profit,
        payout,
        effectivePayout,
        appliedPayout,
        payoutAverage,
        payoutMedian,
        payoutLatest,
        payoutMethod,
        systemPayoutMethod,
        shares,
        shareSourceDate: response.latestShare.REPORT_DATE || response.latestShare.NOTICE_DATE || null,
        interim,
        priorInterim,
        priorAnnualDps,
        profitDps,
        forecastMethod,
        interimAnchor,
        usesInterimAnchor,
        commitment: response.dividendCommitment,
        policyDpsFloor,
        policyApplied,
        seasonality,
        payouts: [...payouts].sort((a, b) => a.year - b.year),
        history: (history?.records ?? [])
            .filter((item) => item.year >= 2023 && item.year <= 2025)
            .sort((a, b) => a.year - b.year),
        interimExceedsModel: interim !== null && interim > annualDps,
    };
}
module.exports = { forecast, calculateAnnualDps };
