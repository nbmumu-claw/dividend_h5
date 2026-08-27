const commitments = {
  '600795': {
    code: '600795',
    startYear: 2025,
    endYear: 2027,
    minPayoutRatio: 0.6,
    minDps: 0.22,
    includesInterim: true,
    conditional: true,
    conditions: ['当年盈利且累计未分配利润为正', '无重大投资计划或其他重大现金支出'],
    announcementDate: '2025-08-19',
    sourceUrl: 'https://vip.stock.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?id=11310158&stockid=600795',
    sourceName: '国电电力 2025–2027 年现金分红规划',
  },
  '600900': {
    code: '600900',
    startYear: 2026,
    endYear: 2030,
    minPayoutRatio: 0.7,
    includesInterim: false,
    conditional: true,
    conditions: ['当年实现盈利'],
    announcementDate: '2025-08-15',
    sourceUrl: 'https://money.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?id=11301071&stockid=600900',
    sourceName: '长江电力 2026–2030 年股东分红回报规划',
  },
}

function getDividendCommitment(code, year) {
  const commitment = commitments[code]
  if (!commitment || year < commitment.startYear || year > commitment.endYear) return null
  return commitment
}

module.exports = { getDividendCommitment }
