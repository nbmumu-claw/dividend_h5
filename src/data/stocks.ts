import type { Stock } from '../types'

export const DEFAULT_SECTORS = ['电力', '银行', '保险', '白酒', '通讯', '白色家电', '中药', '运输', '能源', '其他']

export const STATIC_STOCKS: Stock[] = [
  { sector: '电力', name: '中国广核', code: '003816', price: 4.48, dividendPerShare: 0.086, yieldRate: 1.92, confirmed: true, targetYield: 4.0, targetPrice: 2.15, price2026: 3.77, change2026: 18.83 },
  { sector: '电力', name: '中国核电', code: '601985', price: 8.71, dividendPerShare: 0.2, yieldRate: 2.3, confirmed: false, targetYield: 4.0, targetPrice: 5.0, price2026: 8.71, change2026: 0 },
  { sector: '电力', name: '长江电力', code: '600900', price: 26.4, dividendPerShare: 1.0, yieldRate: 3.79, confirmed: false, targetYield: 4.0, targetPrice: 25.0, price2026: 27.28, change2026: -3.23 },
  { sector: '电力', name: '国投电力', code: '600886', price: 13.41, dividendPerShare: 0.5, yieldRate: 3.73, confirmed: false, targetYield: 4.0, targetPrice: 12.5, price2026: 13.15, change2026: 1.98 },
  { sector: '电力', name: '川投能源', code: '600674', price: 14.65, dividendPerShare: 0.5, yieldRate: 3.41, confirmed: false, targetYield: 4.0, targetPrice: 12.5, price2026: 13.99, change2026: 4.72 },
  { sector: '电力', name: '内蒙华电', code: '600863', price: 5.0, dividendPerShare: 0.22, yieldRate: 4.4, confirmed: false, targetYield: 5.5, targetPrice: 4.0, price2026: 4.45, change2026: 12.36 },
  { sector: '电力', name: '国电电力', code: '600795', price: 4.8, dividendPerShare: 0.23, yieldRate: 4.79, confirmed: false, targetYield: 5.0, targetPrice: 4.6, price2026: 5.02, change2026: -4.38 },
  { sector: '银行', name: '农业银行', code: '601288', price: 6.59, dividendPerShare: 0.2492, yieldRate: 3.78, confirmed: true, targetYield: 5.0, targetPrice: 4.98, price2026: 7.57, change2026: -12.95 },
  { sector: '银行', name: '工商银行', code: '601398', price: 7.31, dividendPerShare: 0.3103, yieldRate: 4.24, confirmed: true, targetYield: 5.0, targetPrice: 6.21, price2026: 7.82, change2026: -6.52 },
  { sector: '银行', name: '中国银行', code: '601988', price: 5.65, dividendPerShare: 0.24, yieldRate: 4.25, confirmed: true, targetYield: 5.0, targetPrice: 4.8, price2026: 5.67, change2026: -0.35 },
  { sector: '银行', name: '建设银行', code: '601939', price: 9.24, dividendPerShare: 0.3887, yieldRate: 4.21, confirmed: true, targetYield: 5.0, targetPrice: 7.77, price2026: 9.25, change2026: -0.11 },
  { sector: '银行', name: '交通银行', code: '601328', price: 6.8, dividendPerShare: 0.3247, yieldRate: 4.78, confirmed: true, targetYield: 5.0, targetPrice: 6.49, price2026: 7.23, change2026: -5.95 },
  { sector: '银行', name: '招商银行', code: '600036', price: 39.21, dividendPerShare: 2.016, yieldRate: 5.14, confirmed: true, targetYield: 5.0, targetPrice: 40.32, price2026: 42.35, change2026: -7.41 },
  { sector: '银行', name: '华夏银行', code: '600015', price: 7.26, dividendPerShare: 0.42, yieldRate: 5.79, confirmed: true, targetYield: 5.0, targetPrice: 8.4, price2026: 6.86, change2026: 5.83 },
  { sector: '银行', name: '邮储银行', code: '601658', price: 5.0, dividendPerShare: 0.2183, yieldRate: 4.37, confirmed: true, targetYield: 5.0, targetPrice: 4.37, price2026: 5.45, change2026: -8.26 },
  { sector: '银行', name: '成都银行', code: '601838', price: 17.43, dividendPerShare: 0.92, yieldRate: 5.28, confirmed: false, targetYield: 5.0, targetPrice: 18.4, price2026: 16.24, change2026: 7.33 },
  { sector: '银行', name: '宁波银行', code: '002142', price: 30.25, dividendPerShare: 1.0, yieldRate: 3.31, confirmed: false, targetYield: 4.5, targetPrice: 22.22, price2026: 28.15, change2026: 7.46 },
  { sector: '银行', name: '江苏银行', code: '600919', price: 10.78, dividendPerShare: 0.55, yieldRate: 5.1, confirmed: false, targetYield: 5.0, targetPrice: 11.0, price2026: 10.46, change2026: 3.06 },
  { sector: '银行', name: '兴业银行', code: '601166', price: 18.53, dividendPerShare: 1.066, yieldRate: 5.75, confirmed: true, targetYield: 5.0, targetPrice: 21.32, price2026: 21.05, change2026: -11.97 },
  { sector: '保险', name: '中国平安', code: '601318', price: 58.82, dividendPerShare: 2.7, yieldRate: 4.59, confirmed: true, targetYield: 5.0, targetPrice: 54.0, price2026: 72.36, change2026: -18.71 },
  { sector: '保险', name: '中国太保', code: '601601', price: 38.63, dividendPerShare: 1.15, yieldRate: 2.98, confirmed: true, targetYield: 5.0, targetPrice: 23.0, price2026: 45.06, change2026: -14.27 },
  { sector: '白酒', name: '贵州茅台', code: '600519', price: 1453.96, dividendPerShare: 56.0, yieldRate: 3.85, confirmed: false, targetYield: 4.0, targetPrice: 1400.0, price2026: 1426.0, change2026: 1.96 },
  { sector: '白酒', name: '五粮液', code: '000858', price: 102.07, dividendPerShare: 5.8, yieldRate: 5.68, confirmed: false, targetYield: 5.0, targetPrice: 116.0, price2026: 107.9, change2026: -5.4 },
  { sector: '白酒', name: '泸州老窖', code: '000568', price: 102.51, dividendPerShare: 5.8, yieldRate: 5.66, confirmed: false, targetYield: 5.0, targetPrice: 116.0, price2026: 118.0, change2026: -13.13 },
  { sector: '通讯', name: '中国移动', code: '600941', price: 94.0, dividendPerShare: 4.73, yieldRate: 5.03, confirmed: true, targetYield: 5.0, targetPrice: 94.6, price2026: 100.58, change2026: -6.54 },
  { sector: '通讯', name: '中国电信', code: '601728', price: 5.79, dividendPerShare: 0.272, yieldRate: 4.7, confirmed: true, targetYield: 5.0, targetPrice: 5.44, price2026: 6.34, change2026: -8.68 },
  { sector: '白色家电', name: '美的集团', code: '000333', price: 76.41, dividendPerShare: 4.3, yieldRate: 5.63, confirmed: true, targetYield: 5.0, targetPrice: 86.0, price2026: 78.68, change2026: -2.89 },
  { sector: '白色家电', name: '格力电器', code: '000651', price: 37.34, dividendPerShare: 3.0, yieldRate: 8.03, confirmed: false, targetYield: 6.0, targetPrice: 50.0, price2026: 40.76, change2026: -8.39 },
  { sector: '白色家电', name: '海尔智家', code: '600690', price: 20.88, dividendPerShare: 1.1559, yieldRate: 5.54, confirmed: true, targetYield: 5.0, targetPrice: 23.12, price2026: 26.32, change2026: -20.67 },
  { sector: '中药', name: '云南白药', code: '000538', price: 54.92, dividendPerShare: 2.6, yieldRate: 4.73, confirmed: true, targetYield: 5.0, targetPrice: 52.0, price2026: 57.32, change2026: -4.19 },
  { sector: '中药', name: '羚锐制药', code: '600285', price: 21.68, dividendPerShare: 1.0, yieldRate: 4.61, confirmed: false, targetYield: 6.0, targetPrice: 16.67, price2026: 21.72, change2026: -0.18 },
  { sector: '中药', name: '东阿阿胶', code: '000423', price: 54.76, dividendPerShare: 2.7, yieldRate: 4.93, confirmed: true, targetYield: 5.0, targetPrice: 54.0, price2026: 49.73, change2026: 10.11 },
  { sector: '运输', name: '中远海控', code: '601919', price: 15.2, dividendPerShare: 1.0, yieldRate: 6.58, confirmed: true, targetYield: 6.0, targetPrice: 16.67, price2026: 14.9, change2026: 2.01 },
  { sector: '运输', name: '大秦铁路', code: '601006', price: 5.2, dividendPerShare: 0.22, yieldRate: 4.23, confirmed: false, targetYield: 5.0, targetPrice: 4.4, price2026: 5.16, change2026: 0.78 },
  { sector: '运输', name: '招商公路', code: '001965', price: 8.72, dividendPerShare: 0.373, yieldRate: 4.28, confirmed: true, targetYield: 5.0, targetPrice: 7.46, price2026: 9.92, change2026: -12.1 },
  { sector: '运输', name: '粤高速A', code: '000429', price: 12.53, dividendPerShare: 0.604, yieldRate: 4.82, confirmed: true, targetYield: 5.0, targetPrice: 12.08, price2026: 11.6, change2026: 8.02 },
  { sector: '能源', name: '中国神华', code: '601088', price: 46.38, dividendPerShare: 2.01, yieldRate: 4.33, confirmed: true, targetYield: 5.5, targetPrice: 36.55, price2026: 40.26, change2026: 15.2 },
  { sector: '能源', name: '陕西煤业', code: '601225', price: 25.23, dividendPerShare: 1.1, yieldRate: 4.36, confirmed: false, targetYield: 5.0, targetPrice: 22.0, price2026: 21.62, change2026: 16.7 },
  { sector: '能源', name: '中煤能源', code: '601898', price: 17.14, dividendPerShare: 0.383, yieldRate: 2.23, confirmed: true, targetYield: 5.0, targetPrice: 7.66, price2026: 12.5, change2026: 37.12 },
  { sector: '能源', name: '中国海油', code: '600938', price: 38.1, dividendPerShare: 1.152, yieldRate: 3.02, confirmed: true, targetYield: 5.0, targetPrice: 23.04, price2026: 29.04, change2026: 31.2 },
  { sector: '能源', name: '中国石化', code: '600028', price: 5.81, dividendPerShare: 0.2, yieldRate: 3.44, confirmed: true, targetYield: 5.0, targetPrice: 5.0, price2026: 6.09, change2026: -4.6 },
  { sector: '能源', name: '中国石油', code: '601857', price: 11.99, dividendPerShare: 0.47, yieldRate: 3.92, confirmed: true, targetYield: 5.0, targetPrice: 9.0, price2026: 10.07, change2026: 19.07 },
  { sector: '其他', name: '分众传媒', code: '002027', price: 6.47, dividendPerShare: 0.35, yieldRate: 5.41, confirmed: false, targetYield: 5.0, targetPrice: 7.0, price2026: 7.24, change2026: -10.64 },
  { sector: '其他', name: '伊利股份', code: '600887', price: 26.14, dividendPerShare: 1.35, yieldRate: 5.16, confirmed: false, targetYield: 5.0, targetPrice: 27.0, price2026: 28.61, change2026: -8.63 },
]

export function getStocksBySector(sector: string, stocks: Stock[] = STATIC_STOCKS): Stock[] {
  return stocks.filter(s => s.sector === sector)
}
