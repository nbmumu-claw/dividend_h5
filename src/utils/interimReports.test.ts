import { describe, expect, it } from 'vitest'
import { ANNUAL_REPORT_YEARS, disclosureDate, FIRST_QUARTER_REPORT_YEARS, INTERIM_REPORT_YEARS, responseRows, type InterimReportSnapshot } from './interimReports'

describe('INTERIM_REPORT_YEARS', () => {
  it('covers the latest five interim-report years', () => {
    expect(INTERIM_REPORT_YEARS).toEqual([2026, 2025, 2024, 2023, 2022])
    expect(FIRST_QUARTER_REPORT_YEARS).toEqual([2026, 2025, 2024, 2023, 2022])
    expect(ANNUAL_REPORT_YEARS).toEqual([2025, 2024, 2023, 2022])
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
