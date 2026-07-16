import { describe, expect, it, vi } from 'vitest'

vi.mock('./cloudbase', () => ({ cbDb: {} }))
vi.mock('./cloudSync', () => ({ getCurrentUid: vi.fn() }))

import { ACCOUNT_BINDING_ALLOWED_UIDS, maskEmail } from './accountBinding'

describe('accountBinding 灰度与脱敏', () => {
  it('只对白名单中的渔人和渔人 test 开放', () => {
    expect(ACCOUNT_BINDING_ALLOWED_UIDS).toEqual(new Set([
      '2069679426588643328',
      '2069652702966587392',
    ]))
    expect(ACCOUNT_BINDING_ALLOWED_UIDS.has('other-user')).toBe(false)
  })

  it('邮箱只展示前两个字符', () => {
    expect(maskEmail('mumu@example.com')).toBe('mu***@example.com')
    expect(maskEmail('a@example.com')).toBe('a*@example.com')
    expect(maskEmail()).toBe('当前 H5 账号')
  })
})
