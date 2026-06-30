/**
 * 板块预判器（纯函数）— 移植自小程序 utils/sectorPredictor.js
 *
 * 输入：股票名称 / 代码 / 市场标识，输出预测板块名（对齐 H5 DEFAULT_SECTORS），
 * 无法判断时返回 '其他'。排序原则：易混淆的关键词靠前
 *   - "平安银行" 命中"银行"（在"保险"的"平安"前）
 *   - "中国电信" 命中"通讯"（在"电力"的"电"前）
 *   - "中国石油"/"中国神华" 命中"能源"（在"电力"之前）
 */

export type Market = 'A' | 'HK' | 'ETF' | 'US'

// 市场维度规则（先于名称匹配）；返回 H5 板块名
function predictByMarket(mkt?: Market): string | null {
  if (mkt === 'ETF') return '红利基金'
  if (mkt === 'US') return '美股'
  return null
}

// 名称关键词规则（顺序敏感：先专一，后泛化）
const NAME_RULES: { sector: string; kws: string[] }[] = [
  { sector: '银行', kws: ['银行'] },
  { sector: '通讯', kws: ['电信', '联通', '移动', '通信', '通讯', '铁塔'] },
  { sector: '保险', kws: ['保险', '人寿', '太保', '平安', '太平', '人保'] },
  { sector: '白酒', kws: ['茅台', '五粮液', '老窖', '汾酒', '洋河', '酒鬼酒', '古井', '酱酒'] },
  { sector: '中药', kws: ['同仁堂', '片仔癀', '云南白药', '白药', '阿胶', '中药', '太极'] },
  { sector: '白色家电', kws: ['美的', '格力', '海尔', '海信', '老板电器', '苏泊尔', '九阳'] },
  { sector: '运输', kws: ['航运', '海控', '远海', '航空', '国航', '东航', '南航', '机场', '铁路', '高速', '港口', '集装箱', '物流'] },
  { sector: '能源', kws: ['石油', '石化', '煤业', '煤炭', '神华', '油气', '天然气', '燃气'] },
  { sector: '有色', kws: ['有色', '紫金', '矿业', '铜业', '铝业', '钼业', '镍业', '锌业', '铅业', '稀土', '锂业', '钴业'] },
  { sector: '电力', kws: ['电力', '核电', '水电', '风电', '电网', '电投', '华电', '国电'] },
]

function predictByName(name?: string): string | null {
  if (!name) return null
  for (const rule of NAME_RULES) {
    if (rule.kws.some(kw => name.includes(kw))) return rule.sector
  }
  return null
}

/** 主入口：按名称 / 代码 / 市场预测板块（必返回一个板块名，兜底 '其他'） */
export function predictSector(name?: string, _code?: string, mkt?: Market): string {
  return predictByMarket(mkt) ?? predictByName(name) ?? '其他'
}
