import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fetchCalendarEvents } from '../utils/dividendCalendar'
import type { DividendEvent } from '../utils/dividendCalendar'
import { afterTax, toCNY } from '../utils/tax'
import type { WatchlistStock } from '../types'

// ─── helpers ────────────────────────────────────────────────────────────────

function formatYM(year: number, month: number) {
  return `${year}年${month}月`
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function firstDayOfWeek(year: number, month: number) {
  return new Date(year, month - 1, 1).getDay() // 0=Sun
}

function toDateStr(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ─── batch fetch (5 at a time) ───────────────────────────────────────────────

async function fetchInBatches(
  stocks: WatchlistStock[],
  onProgress: (events: DividendEvent[]) => void,
) {
  const size = 5
  for (let i = 0; i < stocks.length; i += size) {
    const batch = stocks.slice(i, i + size)
    const results = await Promise.all(
      batch.map(s => fetchCalendarEvents(s.code, s.name, s.isHK))
    )
    onProgress(results.flat())
  }
}

// ─── module-level cache（跨 tab 切换保持，避免重复 fetch）────────────────────

let _cachedEvents: DividendEvent[] = []
const _cachedLoadedCodes = new Set<string>()

// ─── component ──────────────────────────────────────────────────────────────

export default function Calendar() {
  const navigate = useNavigate()
  const watchlist = useStore(s => s.watchlist)
  const exchangeRate = useStore(s => s.exchangeRate)

  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [selectedDate, setSelectedDate] = useState(toDateStr(today.getFullYear(), today.getMonth() + 1, today.getDate()))
  const dateSectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [allEvents, setAllEvents] = useState<DividendEvent[]>(_cachedEvents)
  const [loading, setLoading] = useState(false)
  const [privacyMode, setPrivacyMode] = useState(false)
  const loadedCodes = useRef<Set<string>>(_cachedLoadedCodes)

  // 增量加载：只拉新增的股票，移除已删除股票的事件
  useEffect(() => {
    const watchlistCodes = new Set(watchlist.map(s => s.code))

    // 移除已从自选删除的股票事件
    const removed = [...loadedCodes.current].filter(c => !watchlistCodes.has(c))
    if (removed.length > 0) {
      removed.forEach(c => {
        loadedCodes.current.delete(c)
        _cachedLoadedCodes.delete(c)
      })
      setAllEvents(prev => {
        const next = prev.filter(e => !removed.includes(e.code))
        _cachedEvents = next
        return next
      })
    }

    // 只拉未加载过的新股票
    const newStocks = watchlist.filter(s => !loadedCodes.current.has(s.code))
    if (newStocks.length === 0) return

    newStocks.forEach(s => {
      loadedCodes.current.add(s.code)
      _cachedLoadedCodes.add(s.code)
    })
    setLoading(true)
    fetchInBatches(newStocks, (batch) => {
      setAllEvents(prev => {
        const merged = [...prev]
        for (const e of batch) {
          if (!merged.some(x => x.code === e.code && x.recordDate === e.recordDate)) {
            merged.push(e)
          }
        }
        _cachedEvents = merged
        return merged
      })
    }).finally(() => setLoading(false))
  }, [watchlist])

  // 当月事件
  const monthEvents = useMemo(() => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`
    return allEvents.filter(e => e.recordDate.startsWith(prefix))
  }, [allEvents, year, month])

  // 当月有事件的日期集合
  const eventDates = useMemo(() => new Set(monthEvents.map(e => e.recordDate)), [monthEvents])

  // 本月总到手（CNY，税后）
  const monthTotal = useMemo(() => {
    return monthEvents.reduce((sum, e) => {
      const stock = watchlist.find(s => s.code === e.code)
      if (!stock?.shares) return sum
      const gross = e.perShare * stock.shares
      const net = afterTax(gross, stock)
      return sum + (e.isHK ? toCNY(net, exchangeRate) : net)
    }, 0)
  }, [monthEvents, watchlist, exchangeRate])

  // 当月事件按日期分组
  const groupedEvents = useMemo(() => {
    const map: Record<string, DividendEvent[]> = {}
    for (const e of monthEvents) {
      if (!map[e.recordDate]) map[e.recordDate] = []
      map[e.recordDate].push(e)
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, events]) => ({ date, events: events.sort((a, b) => a.name.localeCompare(b.name)) }))
  }, [monthEvents])

  // 点击日期 → 高亮 + 滚动到对应分组
  const handleDateClick = useCallback((dateStr: string) => {
    setSelectedDate(dateStr)
    if (eventDates.has(dateStr)) {
      setTimeout(() => {
        dateSectionRefs.current[dateStr]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }, [eventDates])

  // 切月时重置 selectedDate
  useEffect(() => {
    setSelectedDate(toDateStr(year, month, 1))
  }, [year, month])

  // 空窗期：找最近有事件的月份
  const nearestEventMonth = useMemo(() => {
    if (monthEvents.length > 0) return null
    const future = allEvents
      .map(e => e.recordDate.slice(0, 7))
      .filter(ym => ym > `${year}-${String(month).padStart(2, '0')}`)
      .sort()
    if (future.length > 0) {
      const [y, m] = future[0].split('-').map(Number)
      return { year: y, month: m }
    }
    return null
  }, [allEvents, monthEvents, year, month])

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  const todayStr = toDateStr(today.getFullYear(), today.getMonth() + 1, today.getDate())
  const firstDay = firstDayOfWeek(year, month)
  const totalDays = daysInMonth(year, month)

  if (watchlist.length === 0) {
    return (
      <div className="page-content flex flex-col items-center justify-center" style={{ minHeight: '60vh' }}>
        <div className="text-4xl mb-4">📅</div>
        <div className="text-gray-500 text-sm mb-6">自选列表为空，添加股票后查看分红日历</div>
        <button
          className="btn-primary px-6 py-2 rounded-full text-sm"
          onClick={() => navigate('/watchlist')}
        >
          去添加自选
        </button>
      </div>
    )
  }

  return (
    <div className="page-content">
      {/* Header */}
      <div className="px-4 pt-12 pb-2">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">分红日历</h1>
          {loading && <span className="text-xs text-gray-400">加载中…</span>}
        </div>
      </div>

      <div className="px-4 pb-24">
        {/* Calendar card */}
        <div className="card p-4 mb-4">
          {/* Month nav + total */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button onClick={prevMonth} className="p-1 text-gray-400 active:text-gray-700">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <span className="text-sm font-semibold text-gray-800 w-20 text-center">{formatYM(year, month)}</span>
              <button onClick={nextMonth} className="p-1 text-gray-400 active:text-gray-700">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-gray-700">
                {privacyMode ? '本月 ****' : monthTotal > 0 ? `本月 ¥${monthTotal.toFixed(0)}` : ''}
              </span>
              <button
                onClick={() => setPrivacyMode(v => !v)}
                className="p-1 text-gray-400"
              >
                {privacyMode ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" strokeLinecap="round"/>
                    <line x1="1" y1="1" x2="23" y2="23" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 mb-1">
            {['日', '一', '二', '三', '四', '五', '六'].map(d => (
              <div key={d} className="text-center text-xs text-gray-400 py-1">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {Array.from({ length: totalDays }).map((_, i) => {
              const day = i + 1
              const dateStr = toDateStr(year, month, day)
              const isToday = dateStr === todayStr
              const isPast = dateStr < todayStr
              const hasEvent = eventDates.has(dateStr)
              const isSelected = dateStr === selectedDate

              return (
                <div
                  key={day}
                  onClick={() => handleDateClick(dateStr)}
                  className="flex flex-col items-center py-1 cursor-pointer select-none"
                >
                  <div style={{
                    width: 30, height: 30,
                    borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isSelected ? 'var(--primary)' : isToday ? '#EFF6FF' : 'transparent',
                    fontSize: 13,
                    fontWeight: isSelected || isToday ? 700 : 400,
                    color: isSelected ? '#fff' : isToday ? '#3B82F6' : isPast ? '#ccc' : '#333',
                  }}>
                    {day}
                  </div>
                  <div style={{
                    width: 4, height: 4, borderRadius: '50%', marginTop: 2,
                    background: hasEvent ? (isSelected ? '#fff' : 'var(--primary)') : 'transparent',
                  }} />
                </div>
              )
            })}
          </div>

          {/* Tips */}
          <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400 space-y-1">
            <div><span className="text-gray-600 font-medium">✅ 确认</span> 公司已公告股权登记日，日期准确</div>
            <div><span className="text-gray-600 font-medium">🕐 预计</span> 已宣布分红金额但未定日期，根据近几年同期规律推算，实际以公告为准</div>
          </div>

          {/* 空窗期提示 */}
          {!loading && monthEvents.length === 0 && nearestEventMonth && (
            <div className="flex justify-center mt-3">
              <button
                onClick={() => { setYear(nearestEventMonth.year); setMonth(nearestEventMonth.month) }}
                className="text-xs text-red-500 bg-red-50 rounded-full px-4 py-1.5"
              >
                ↓ 最近分红：{nearestEventMonth.month}月
              </button>
            </div>
          )}
        </div>

        {/* Event list */}
        {groupedEvents.length > 0 ? (
          <div className="space-y-3">
            {groupedEvents.map(({ date, events }) => {
              const isActive = date === selectedDate
              return (
                <div
                  key={date}
                  ref={el => { dateSectionRefs.current[date] = el }}
                  className="card p-4"
                  style={{ outline: isActive ? '2px solid var(--primary)' : 'none', outlineOffset: -2 }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm font-semibold text-gray-800">
                      {parseInt(date.slice(5, 7))}月{parseInt(date.slice(8, 10))}日
                    </span>
                    <span className="text-xs text-gray-400">股权登记日</span>
                  </div>
                  <div className="space-y-3">
                    {events.map(e => {
                      const stock = watchlist.find(s => s.code === e.code)
                      const hasShares = stock?.shares && stock.shares > 0
                      const grossTotal = hasShares ? e.perShare * stock!.shares! : 0
                      const netTotal = hasShares ? afterTax(grossTotal, stock!) : 0
                      const netCNY = hasShares ? (e.isHK ? toCNY(netTotal, exchangeRate) : netTotal) : 0

                      return (
                        <div key={`${e.code}-${e.recordDate}`} className="flex items-start gap-3">
                          <div style={{
                            width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                            background: 'var(--primary)',
                          }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm font-semibold text-gray-900">{e.name}</span>
                                {e.status === 'confirmed'
                                  ? <span className="text-xs bg-green-100 text-green-700 rounded px-1.5 py-0.5 leading-none">确认</span>
                                  : <span className="text-xs bg-yellow-100 text-yellow-700 rounded px-1.5 py-0.5 leading-none">预计</span>
                                }
                              </div>
                              {hasShares && (
                                <div className="text-right shrink-0">
                                  <div className="text-base font-bold text-red-500">
                                    {privacyMode ? '****' : `¥${netCNY.toFixed(0)}`}
                                  </div>
                                  <div className="text-xs text-gray-400">税后到手</div>
                                </div>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {privacyMode
                                ? `每股 ****`
                                : `每股 ${e.isHK ? 'HK$' : '¥'}${e.perShare.toFixed(3)}`
                              }
                              {hasShares && (
                                <span className="ml-1">× {stock!.shares}股</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          loading ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="card p-4 animate-pulse">
                  <div className="h-3 bg-gray-100 rounded w-24 mb-3" />
                  <div className="h-4 bg-gray-100 rounded w-32" />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-xs text-gray-400 py-6">当月暂无分红记录</div>
          )
        )}
      </div>
    </div>
  )
}
