export const INTERIM_REPORT_YEARS = [2026, 2025, 2024, 2023, 2022] as const
export const FIRST_QUARTER_REPORT_YEARS = [2026, 2025, 2024, 2023, 2022] as const
export const ANNUAL_REPORT_YEARS = [2025, 2024, 2023, 2022] as const

export type InterimReportYear = (typeof INTERIM_REPORT_YEARS)[number]
export type FirstQuarterReportYear = (typeof FIRST_QUARTER_REPORT_YEARS)[number]
export type AnnualReportYear = (typeof ANNUAL_REPORT_YEARS)[number]

export interface InterimReportRecord {
  code: string
  name: string
  noticeDate: string | null
  revenue: number | null
  revenueYoy: number | null
  netProfit: number | null
  netProfitYoy: number | null
  deductNetProfit: number | null
  deductNetProfitYoy: number | null
  eps: number | null
  roe: number | null
}

export interface InterimAppointment {
  firstDate: string | null
  firstChangeDate: string | null
  secondChangeDate: string | null
  thirdChangeDate: string | null
  currentDate: string | null
  actualDate: string | null
  isPublished: boolean
}

export interface InterimReportSnapshot {
  reports: Partial<Record<InterimReportYear, InterimReportRecord>>
  firstQuarterReports?: Partial<Record<FirstQuarterReportYear, InterimReportRecord>>
  annualReports?: Partial<Record<AnnualReportYear, InterimReportRecord>>
  appointment?: InterimAppointment
}

export interface InterimReportResult {
  generatedAt: string
  stocks: Record<string, InterimReportSnapshot>
}

export interface InterimStockSearchResult {
  name: string
  code: string
}

type JsonRecord = Record<string, unknown>

const REPORT_COLUMNS = [
  'SECURITY_CODE',
  'SECURITY_NAME_ABBR',
  'NOTICE_DATE',
  'TOTAL_OPERATE_INCOME',
  'YSTZ',
  'PARENT_NETPROFIT',
  'SJLTZ',
  'BASIC_EPS',
  'WEIGHTAVG_ROE',
].join(',')

const DEDUCT_REPORT_COLUMNS = [
  'SECURITY_CODE',
  'REPORT_DATE',
  'DEDUCT_PARENT_NETPROFIT',
  'DEDUCT_PARENT_NETPROFIT_YOY',
].join(',')

const APPOINTMENT_COLUMNS = [
  'SECURITY_CODE',
  'FIRST_APPOINT_DATE',
  'FIRST_CHANGE_DATE',
  'SECOND_CHANGE_DATE',
  'THIRD_CHANGE_DATE',
  'APPOINT_PUBLISH_DATE',
  'ACTUAL_PUBLISH_DATE',
  'IS_PUBLISH',
].join(',')

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function responseRows(value: unknown): JsonRecord[] {
  if (isRecord(value) && value.result === null && value.code === 9201) return []
  if (!isRecord(value) || value.success !== true) {
    throw new Error('东方财富返回了无效数据')
  }
  if (value.result === null) return []
  if (!isRecord(value.result)) throw new Error('东方财富返回了无效数据')
  const data = value.result.data
  if (!Array.isArray(data)) return []
  return data.filter(isRecord)
}

function codeFilter(codes: string[]): string {
  const safeCodes = codes.filter(code => /^\d{6}$/.test(code))
  return `(SECURITY_CODE in (${safeCodes.map(code => `"${code}"`).join(',')}))`
}

function toReportRecord(row: JsonRecord, code: string): InterimReportRecord {
  return {
    code,
    name: stringOrNull(row.SECURITY_NAME_ABBR) ?? code,
    noticeDate: stringOrNull(row.NOTICE_DATE),
    revenue: numberOrNull(row.TOTAL_OPERATE_INCOME),
    revenueYoy: numberOrNull(row.YSTZ),
    netProfit: numberOrNull(row.PARENT_NETPROFIT),
    netProfitYoy: numberOrNull(row.SJLTZ),
    deductNetProfit: null,
    deductNetProfitYoy: null,
    eps: numberOrNull(row.BASIC_EPS),
    roe: numberOrNull(row.WEIGHTAVG_ROE),
  }
}

async function fetchDeductReports(codes: string[]): Promise<JsonRecord[]> {
  const reportDates = [
    ...FIRST_QUARTER_REPORT_YEARS.map(year => `${year}-03-31`),
    ...INTERIM_REPORT_YEARS.map(year => `${year}-06-30`),
    ...ANNUAL_REPORT_YEARS.map(year => `${year}-12-31`),
  ]
  return fetchRows(new URLSearchParams({
    reportName: 'RPT_F10_FINANCE_GINCOME',
    columns: DEDUCT_REPORT_COLUMNS,
    filter: `(REPORT_DATE in (${reportDates.map(date => `'${date}'`).join(',')}))${codeFilter(codes)}`,
    pageNumber: '1',
    pageSize: String(codes.length * reportDates.length),
  }))
}

async function fetchRows(params: URLSearchParams): Promise<JsonRecord[]> {
  const response = await fetch(`/api/dividend-history?${params}`)
  if (!response.ok) throw new Error(`财报接口请求失败（${response.status}）`)
  const json: unknown = await response.json()
  return responseRows(json)
}

async function fetchReportDate(reportDate: string, codes: string[]): Promise<JsonRecord[]> {
  return fetchRows(new URLSearchParams({
    reportName: 'RPT_LICO_FN_CPD',
    columns: REPORT_COLUMNS,
    filter: `(REPORTDATE='${reportDate}')${codeFilter(codes)}`,
    pageNumber: '1',
    pageSize: String(codes.length),
  }))
}

async function fetchAppointments(codes: string[]): Promise<JsonRecord[]> {
  return fetchRows(new URLSearchParams({
    reportName: 'RPT_PUBLIC_BS_APPOIN',
    columns: APPOINTMENT_COLUMNS,
    filter: `(REPORT_DATE='2026-06-30')${codeFilter(codes)}`,
    pageNumber: '1',
    pageSize: String(codes.length),
  }))
}

export async function fetchInterimReportData(codes: string[]): Promise<InterimReportResult> {
  const uniqueCodes = [...new Set(codes)].filter(code => /^\d{6}$/.test(code))
  if (!uniqueCodes.length) return { generatedAt: new Date().toISOString(), stocks: {} }

  const [firstQuarterRows, interimRows, annualRows, appointmentRows, deductRows] = await Promise.all([
    Promise.all(FIRST_QUARTER_REPORT_YEARS.map(year => fetchReportDate(`${year}-03-31`, uniqueCodes))),
    Promise.all(INTERIM_REPORT_YEARS.map(year => fetchReportDate(`${year}-06-30`, uniqueCodes))),
    Promise.all(ANNUAL_REPORT_YEARS.map(year => fetchReportDate(`${year}-12-31`, uniqueCodes))),
    fetchAppointments(uniqueCodes),
    fetchDeductReports(uniqueCodes),
  ])

  const stocks: Record<string, InterimReportSnapshot> = Object.fromEntries(
    uniqueCodes.map(code => [code, { reports: {}, firstQuarterReports: {}, annualReports: {} }]),
  )

  FIRST_QUARTER_REPORT_YEARS.forEach((year, index) => {
    for (const row of firstQuarterRows[index]) {
      const code = stringOrNull(row.SECURITY_CODE)
      if (!code || !stocks[code]?.firstQuarterReports) continue
      stocks[code].firstQuarterReports[year] = toReportRecord(row, code)
    }
  })

  INTERIM_REPORT_YEARS.forEach((year, index) => {
    for (const row of interimRows[index]) {
      const code = stringOrNull(row.SECURITY_CODE)
      if (!code || !stocks[code]) continue
      stocks[code].reports[year] = toReportRecord(row, code)
    }
  })

  ANNUAL_REPORT_YEARS.forEach((year, index) => {
    for (const row of annualRows[index]) {
      const code = stringOrNull(row.SECURITY_CODE)
      if (!code || !stocks[code]) continue
      const annualReports = stocks[code].annualReports
      if (!annualReports) continue
      annualReports[year] = toReportRecord(row, code)
    }
  })

  for (const row of deductRows) {
    const code = stringOrNull(row.SECURITY_CODE)
    const reportDate = stringOrNull(row.REPORT_DATE)
    if (!code || !reportDate || !stocks[code]) continue
    const year = Number(reportDate.slice(0, 4))
    const monthDay = reportDate.slice(5, 10)
    const report = monthDay === '03-31'
      ? stocks[code].firstQuarterReports?.[year as FirstQuarterReportYear]
      : monthDay === '06-30'
        ? stocks[code].reports[year as InterimReportYear]
        : monthDay === '12-31'
          ? stocks[code].annualReports?.[year as AnnualReportYear]
          : undefined
    if (!report) continue
    report.deductNetProfit = numberOrNull(row.DEDUCT_PARENT_NETPROFIT)
    report.deductNetProfitYoy = numberOrNull(row.DEDUCT_PARENT_NETPROFIT_YOY)
  }

  for (const row of appointmentRows) {
    const code = stringOrNull(row.SECURITY_CODE)
    if (!code || !stocks[code]) continue
    stocks[code].appointment = {
      firstDate: stringOrNull(row.FIRST_APPOINT_DATE),
      firstChangeDate: stringOrNull(row.FIRST_CHANGE_DATE),
      secondChangeDate: stringOrNull(row.SECOND_CHANGE_DATE),
      thirdChangeDate: stringOrNull(row.THIRD_CHANGE_DATE),
      currentDate: stringOrNull(row.APPOINT_PUBLISH_DATE),
      actualDate: stringOrNull(row.ACTUAL_PUBLISH_DATE),
      isPublished: String(row.IS_PUBLISH) === '1',
    }
  }

  return { generatedAt: new Date().toISOString(), stocks }
}

export function disclosureDate(snapshot?: InterimReportSnapshot): string | null {
  const reportDate = snapshot?.reports[2026]?.noticeDate
  if (reportDate) return reportDate
  const appointment = snapshot?.appointment
  return appointment?.actualDate
    ?? appointment?.currentDate
    ?? appointment?.thirdChangeDate
    ?? appointment?.secondChangeDate
    ?? appointment?.firstChangeDate
    ?? appointment?.firstDate
    ?? null
}

export async function searchInterimStocks(keyword: string): Promise<InterimStockSearchResult[]> {
  const params = new URLSearchParams({
    input: keyword,
    type: '14',
    token: 'D43BF722C8E33BDC906FB84D85E32628',
    count: '8',
  })
  const response = await fetch(`/api/stock-search-em?${params}`)
  if (!response.ok) throw new Error(`股票搜索失败（${response.status}）`)
  const json: unknown = await response.json()
  if (!isRecord(json) || !isRecord(json.QuotationCodeTable)) return []
  const data = json.QuotationCodeTable.Data
  if (!Array.isArray(data)) return []

  return data
    .filter(isRecord)
    .filter(item => item.Classify === 'AStock')
    .map(item => ({
      name: stringOrNull(item.Name) ?? '',
      code: stringOrNull(item.Code)?.padStart(6, '0') ?? '',
    }))
    .filter(item => item.name && /^[03468]\d{5}$/.test(item.code))
    .slice(0, 6)
}
