import { cacheGet, cacheSetPermanent } from './cache'
import { fetchDividendApi } from './dividendApi'

export async function fetchListingYear(code: string): Promise<number | null> {
  const key = `listingYear:${code}`
  const cached = cacheGet<number>(key)
  if (cached) return cached

  try {
    const filter = `(SECURITY_CODE="${code.padStart(6, '0')}")`
    const params = new URLSearchParams({
      reportName: 'RPT_F10_ORG_BASICINFO',
      columns: 'LISTING_DATE',
      filter,
      pageSize: '1',
    })
    const res = await fetchDividendApi(params)
    const json = await res.json()
    const row = json?.result?.data?.[0]
    if (!row?.LISTING_DATE) return null

    const year = parseInt(row.LISTING_DATE.slice(0, 4))
    if (!year) return null

    cacheSetPermanent(key, year)
    return year
  } catch {
    return null
  }
}
