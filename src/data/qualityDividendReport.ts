export type QualityDividendRow = {
  name: string
  code: string
  dividend: number
  expectedYield: number
  isHK?: boolean
  featured?: boolean
}

export type QualityDividendSection = {
  title: string
  rows: QualityDividendRow[]
}

export const QUALITY_DIVIDEND_HIGHLIGHTED_YIELDS: Record<string, number[]> = {
  '长江电力': [4, 5], '国投电力': [4, 5], '川投能源': [4, 5], '华能水电': [3], '中国核电': [3, 4], '中国广核': [3],
  '中国移动': [5, 6, 7], '中国电信': [4, 5, 6], '中国联通': [4, 5], '农业银行': [5, 6], '工商银行': [5, 6],
  '招商银行': [5, 6, 7], '兴业银行': [5, 6, 7], '中信银行': [5, 6, 7], '建设银行': [5, 6, 7], '交通银行': [5, 6, 7],
  '江苏银行': [5, 6, 7], '邮储银行': [5, 6, 7], '招商公路': [4, 5], '粤高速A': [5, 6, 7],
  '美的集团': [5, 6, 7], '格力电器': [5, 6, 7, 8], '海尔智家': [5, 6], '贵州茅台': [4, 5], '五粮液': [5, 6, 7],
  '泸州老窖': [5, 6, 7], '伊利股份': [5, 6, 7], '分众传媒': [5, 6, 7], '洽洽食品': [5, 6], '云南白药': [5, 6],
  '羚锐制药': [5, 6], '东阿阿胶': [5, 6], '江中药业': [5, 6], '老凤祥': [5, 6], '达仁堂': [4, 5, 6],
  '华润三九': [4, 5, 6], '济川药业': [5, 6], '雅戈尔': [6, 7, 8], '海澜之家': [6, 7, 8], '中国平安': [5, 6, 7],
  '吉比特': [5, 6, 7], '三七互娱': [5, 6], '宇通客车': [7, 8],
  '中创智领': [6, 7, 8], '中国神华': [5, 6, 7], '陕西煤业': [5, 6], '中煤能源': [3, 4, 5], '中国海油': [5, 6, 7],
  '中国石油': [5, 6], '中国石化': [5, 6], '大秦铁路': [5, 6], '中远海控': [7, 8, 9], '渤海轮渡': [8, 9],
  '国电电力': [4, 5, 6], '内蒙华电': [4, 5, 6], '华能国际': [5, 6, 7], '新能泰山': [5, 6], '中国宏桥': [6, 7, 8],
  '神火股份': [6, 7], '紫金矿业': [4, 5], '藏格矿业': [5, 6, 7], '云铝股份': [6, 7], '中谷物流': [6, 7],
  '中金黄金': [4, 5, 6], '中国神华H': [5, 6], '中国海洋石油': [5, 6, 7], '中国移动H': [4, 5, 6], '中国平安H': [5, 6, 7],
  '新华保险H': [5, 6, 7], '中煤能源H': [4, 5], '工商银行H': [4, 5, 6], '华能国际H': [6, 7, 8],
}

// 资料来源：优质红利周点评及股息率表（26.8.30）。目标价格在页面按「预计分红 ÷ 目标股息率」计算。
export const QUALITY_DIVIDEND_SECTIONS: QualityDividendSection[] = [
  {
    title: '弱周期红利',
    rows: [
      { name: '长江电力', code: '600900', dividend: 1.05, expectedYield: 3.7 },
      { name: '国投电力', code: '600886', dividend: 0.52, expectedYield: 3.8 },
      { name: '川投能源', code: '600674', dividend: 0.5, expectedYield: 3.2 },
      { name: '华能水电', code: '600025', dividend: 0.22, expectedYield: 2.3 },
      { name: '中国核电', code: '601985', dividend: 0.2, expectedYield: 2.2 },
      { name: '中国广核', code: '003816', dividend: 0.09, expectedYield: 2.1 },
      { name: '中国移动', code: '600941', dividend: 4.7, expectedYield: 4.8 },
      { name: '中国电信', code: '601728', dividend: 0.25, expectedYield: 4 },
      { name: '中国联通', code: '600050', dividend: 0.15, expectedYield: 3.5 },
      { name: '农业银行', code: '601288', dividend: 0.26, expectedYield: 3.8 },
      { name: '工商银行', code: '601398', dividend: 0.32, expectedYield: 4.1 },
      { name: '招商银行', code: '600036', dividend: 2.05, expectedYield: 5.2 },
      { name: '兴业银行', code: '601166', dividend: 1.05, expectedYield: 6 },
      { name: '中信银行', code: '601998', dividend: 0.24, expectedYield: 3.9 },
      { name: '建设银行', code: '601939', dividend: 0.4, expectedYield: 3.7 },
      { name: '交通银行', code: '601328', dividend: 0.33, expectedYield: 4.6 },
      { name: '江苏银行', code: '600919', dividend: 0.6, expectedYield: 5 },
      { name: '邮储银行', code: '601658', dividend: 0.23, expectedYield: 4.6 },
      { name: '招商公路', code: '001965', dividend: 0.38, expectedYield: 3.9 },
      { name: '粤高速A', code: '000429', dividend: 0.6, expectedYield: 4.5 },
    ],
  },
  {
    title: '消费与医药红利',
    rows: [
      { name: '美的集团', code: '000333', dividend: 4.6, expectedYield: 5.3 },
      { name: '格力电器', code: '000651', dividend: 3, expectedYield: 7.7 },
      { name: '海尔智家', code: '600690', dividend: 1.15, expectedYield: 5.5 },
      { name: '贵州茅台', code: '600519', dividend: 53, expectedYield: 4.1 },
      { name: '五粮液', code: '000858', dividend: 5.16, expectedYield: 7.2 },
      { name: '泸州老窖', code: '000568', dividend: 5.8, expectedYield: 7.4 },
      { name: '伊利股份', code: '600887', dividend: 1.25, expectedYield: 4.6 },
      { name: '分众传媒', code: '002027', dividend: 0.36, expectedYield: 7.2 },
      { name: '洽洽食品', code: '002557', dividend: 1, expectedYield: 5.3 },
      { name: '云南白药', code: '000538', dividend: 2.8, expectedYield: 5.6 },
      { name: '羚锐制药', code: '600285', dividend: 1.12, expectedYield: 5.6 },
      { name: '东阿阿胶', code: '000423', dividend: 2.8, expectedYield: 5.7 },
      { name: '江中药业', code: '600750', dividend: 1.35, expectedYield: 5.6 },
      { name: '老凤祥', code: '600612', dividend: 1.6, expectedYield: 4.7 },
      { name: '达仁堂', code: '600329', dividend: 1.5, expectedYield: 4.2 },
      { name: '华润三九', code: '000999', dividend: 1, expectedYield: 4.1 },
      { name: '济川药业', code: '600566', dividend: 1.5, expectedYield: 6 },
      { name: '雅戈尔', code: '600177', dividend: 0.45, expectedYield: 5.7 },
      { name: '海澜之家', code: '600398', dividend: 0.4, expectedYield: 6.7 },
      { name: '中国平安', code: '601318', dividend: 2.85, expectedYield: 5.1 },
      { name: '吉比特', code: '603444', dividend: 22, expectedYield: 5.7 },
      { name: '三七互娱', code: '002555', dividend: 1, expectedYield: 5.5 },
      { name: '宇通客车', code: '600066', dividend: 2.5, expectedYield: 8.3 },
    ],
  },
  {
    title: '周期红利',
    rows: [
      { name: '中创智领', code: '601717', dividend: 1.05, expectedYield: 7 },
      { name: '中国神华', code: '601088', dividend: 2.2, expectedYield: 4.6 },
      { name: '陕西煤业', code: '601225', dividend: 1.25, expectedYield: 4.6 },
      { name: '中煤能源', code: '601898', dividend: 0.45, expectedYield: 2.9 },
      { name: '中国海油', code: '600938', dividend: 1.55, expectedYield: 4.5 },
      { name: '中国石油', code: '601857', dividend: 0.52, expectedYield: 4.6 },
      { name: '中国石化', code: '600028', dividend: 0.26, expectedYield: 4.7 },
      { name: '大秦铁路', code: '601006', dividend: 0.24, expectedYield: 5 },
      { name: '中远海控', code: '601919', dividend: 1.3, expectedYield: 7.7 },
      { name: '渤海轮渡', code: '603167', dividend: 0.75, expectedYield: 9.3 },
      { name: '国电电力', code: '600795', dividend: 0.22, expectedYield: 4.3 },
      { name: '内蒙华电', code: '600863', dividend: 0.22, expectedYield: 4.7 },
      { name: '华能国际', code: '600011', dividend: 0.35, expectedYield: 5.1, featured: true },
      { name: '新能泰山', code: '000720', dividend: 0.3, expectedYield: 6.1 },
      { name: '中国宏桥', code: '1378', dividend: 2.2, expectedYield: 8.4, isHK: true, featured: true },
      { name: '神火股份', code: '000933', dividend: 1.6, expectedYield: 5.8, featured: true },
      { name: '紫金矿业', code: '601899', dividend: 1.1, expectedYield: 3.2 },
      { name: '藏格矿业', code: '000408', dividend: 3.2, expectedYield: 4.1 },
      { name: '云铝股份', code: '000807', dividend: 1.56, expectedYield: 6.3, featured: true },
      { name: '中谷物流', code: '603565', dividend: 0.7, expectedYield: 5.3 },
      { name: '中金黄金', code: '600489', dividend: 1, expectedYield: 3.7 },
      { name: '中国神华H', code: '1088', dividend: 2.5, expectedYield: 4.9, isHK: true },
      { name: '中国海洋石油', code: '883', dividend: 1.85, expectedYield: 6.6, isHK: true },
      { name: '中国移动H', code: '941', dividend: 5.2, expectedYield: 5.9, isHK: true },
      { name: '中国平安H', code: '2318', dividend: 3.3, expectedYield: 5.2, isHK: true },
      { name: '新华保险H', code: '1336', dividend: 3.1, expectedYield: 5.9, isHK: true },
      { name: '中煤能源H', code: '1898', dividend: 0.52, expectedYield: 3.9, isHK: true },
      { name: '工商银行H', code: '1398', dividend: 0.37, expectedYield: 4.5, isHK: true },
      { name: '华能国际H', code: '902', dividend: 0.41, expectedYield: 6.6, isHK: true },
    ],
  },
]
