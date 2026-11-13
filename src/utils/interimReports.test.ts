import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANNUAL_REPORT_YEARS, disclosureDate, fetchInterimReportData, FIRST_QUARTER_REPORT_YEARS, INTERIM_REPORT_YEARS, responseRows, THIRD_QUARTER_REPORT_YEARS, type InterimReportSnapshot } from './interimReports'

afterEach(() => vi.unstubAllGlobals())

describe('INTERIM_REPORT_YEARS', () => {
  it('covers the latest five interim-report years', () => {
    expect(INTERIM_REPORT_YEARS).toEqual([2026, 2025, 2024, 2023, 2022])
    expect(FIRST_QUARTER_REPORT_YEARS).toEqual([2026, 2025, 2024, 2023, 2022])
    expect(THIRD_QUARTER_REPORT_YEARS).toEqual([2026, 2025, 2024, 2023, 2022])
    expect(ANNUAL_REPORT_YEARS).toEqual([2025, 2024, 2023, 2022])
  })
})

describe('fetchInterimReportData', () => {
  it('derives standalone third-quarter values and year-over-year growth from cumulative reports', async () => {
    const reports: Record<string, { revenue: number; profit: number; eps: number; deduct: number }> = {
      '2026-06-30': { revenue: 100, profit: 30, eps: 0.3, deduct: 27 },
      '2026-09-30': { revenue: 160, profit: 45, eps: 0.45, deduct: 40 },
      '2025-06-30': { revenue: 80, profit: 20, eps: 0.2, deduct: 18 },
      '2025-09-30': { revenue: 120, profit: 30, eps: 0.3, deduct: 26 },
      '2024-06-30': { revenue: 70, profit: 18, eps: 0.18, deduct: 16 },
      '2024-09-30': { revenue: 105, profit: 27, eps: 0.27, deduct: 24 },
      '2023-06-30': { revenue: 60, profit: 16, eps: 0.16, deduct: 14 },
      '2023-09-30': { revenue: 90, profit: 24, eps: 0.24, deduct: 21 },
      '2022-06-30': { revenue: 50, profit: 14, eps: 0.14, deduct: 12 },
      '2022-09-30': { revenue: 75, profit: 21, eps: 0.21, deduct: 18 },
    }
    const fetchMock = vi.fn(async (url: string) => {
      const params = new URL(url, 'https://example.test').searchParams
      const filter = params.get('filter') ?? ''
      const date = Object.keys(reports).find(item => filter.includes(item))
      const data = date && params.get('reportName') === 'RPT_LICO_FN_CPD'
        ? [{ SECURITY_CODE: '600036', SECURITY_NAME_ABBR: '招商银行', NOTICE_DATE: `${date} 00:00:00`, TOTAL_OPERATE_INCOME: reports[date].revenue, PARENT_NETPROFIT: reports[date].profit, BASIC_EPS: reports[date].eps }]
        : date && params.get('reportName') === 'RPT_F10_FINANCE_GINCOME'
          ? Object.keys(reports).filter(reportDate => filter.includes(reportDate)).sort().reverse().slice(0, 4).map(reportDate => ({ SECURITY_CODE: '600036', REPORT_DATE: `${reportDate} 00:00:00`, DEDUCT_PARENT_NETPROFIT: reports[reportDate].deduct }))
          : []
      return { ok: true, json: async () => ({ success: true, result: { data } }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchInterimReportData(['600036'])
    const thirdQuarter = result.stocks['600036'].thirdQuarterReports?.[2026]
    expect(thirdQuarter).toMatchObject({
      revenue: 60,
      revenueYoy: 50,
      netProfit: 15,
      netProfitYoy: 50,
      deductNetProfit: 13,
      deductNetProfitYoy: 62.5,
      roe: null,
    })
    expect(thirdQuarter?.eps).toBeCloseTo(0.15)
    expect(result.stocks['600036'].thirdQuarterReports?.[2025]?.revenue).toBe(40)
    expect(result.stocks['600036'].thirdQuarterReports?.[2024]?.deductNetProfit).toBe(8)
    expect(result.stocks['600036'].thirdQuarterReports?.[2023]?.deductNetProfit).toBe(7)
    expect(result.stocks['600036'].thirdQuarterReports?.[2022]?.deductNetProfit).toBe(6)
    expect(result.stocks['600036'].thirdQuarterReports?.[2022]?.deductNetProfitYoy).toBeNull()
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('RPT_F10_FINANCE_GINCOME'))).toHaveLength(5)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('2026-09-30'))).toBe(true)
  })
})

describe('responseRows', () => {
  it('accepts a successful empty report result', () => {
    expect(responseRows({ success: true, result: null })).toEqual([])
  })

  it('accepts Eastmoney empty-data code 9201', () => {
    expect(responseRows({ success: false, result: null, code: 9201 })).toEqual([])
  })
})

describe('disclosureDate', () => {
  it('prefers the actual 2026 report notice date', () => {
    const snapshot: InterimReportSnapshot = {
      reports: {
        2026: {
          code: '600036',
          name: '招商银行',
          noticeDate: '2026-08-30 00:00:00',
          revenue: null,
          revenueYoy: null,
          netProfit: null,
          netProfitYoy: null,
          deductNetProfit: null,
          deductNetProfitYoy: null,
          eps: null,
          roe: null,
        },
      },
      annualReports: {},
      appointment: {
        firstDate: '2026-08-29 00:00:00',
        firstChangeDate: null,
        secondChangeDate: null,
        thirdChangeDate: null,
        currentDate: '2026-08-29 00:00:00',
        actualDate: null,
        isPublished: false,
      },
    }

    expect(disclosureDate(snapshot)).toBe('2026-08-30 00:00:00')
  })

  it('uses the current effective appointment date while pending', () => {
    const snapshot: InterimReportSnapshot = {
      reports: {},
      annualReports: {},
      appointment: {
        firstDate: '2026-08-20 00:00:00',
        firstChangeDate: '2026-08-22 00:00:00',
        secondChangeDate: null,
        thirdChangeDate: null,
        currentDate: '2026-08-22 00:00:00',
        actualDate: null,
        isPublished: false,
      },
    }

    expect(disclosureDate(snapshot)).toBe('2026-08-22 00:00:00')
  })
})
