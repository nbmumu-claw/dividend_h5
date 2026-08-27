const { ok, upstreamError } = require('../utils/response')
const db = require('../utils/db')

const COMMITMENT_COLLECTION = 'dividendCommitments'
const FORECAST_YEAR = 2026

module.exports = async function dividendCommitmentSummary() {
  try {
    const result = await db.collection(COMMITMENT_COLLECTION).limit(100).get()
    const commitments = (result.data || [])
      .filter(item => item.code && item.startYear <= FORECAST_YEAR && (!item.endYear || item.endYear >= FORECAST_YEAR))
      .sort((a, b) => Number(b.modelEligible) - Number(a.modelEligible) || String(a.code).localeCompare(String(b.code)))
    return ok(JSON.stringify({ year: FORECAST_YEAR, commitments }), { 'Content-Type': 'application/json; charset=utf-8' })
  } catch (error) {
    console.warn('[dividendCommitmentSummary] 读取分红承诺汇总失败:', error.message)
    return upstreamError(error.message)
  }
}
