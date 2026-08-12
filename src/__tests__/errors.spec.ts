import { describe, expect, it } from 'vitest'

import {
  ApiError,
  apiErrorFromResponse,
  getUserErrorMessage,
  safeServerMessage,
} from '../services/errors'

describe('user-facing error boundary', () => {
  it('keeps actionable 4xx business messages', () => {
    expect(safeServerMessage('仅支持 .xlsx 文件', 400, '上传失败')).toBe('仅支持 .xlsx 文件')
  })

  it('hides server internals and all 5xx response messages', () => {
    expect(
      safeServerMessage('java.sql.SQLException: table upload_rows not found', 400, '操作失败'),
    ).toBe('操作失败')
    expect(apiErrorFromResponse(500, 500, '地图聚合刷新失败：SQL syntax').message).toBe(
      '服务暂时不可用，请稍后重试',
    )
  })

  it('never renders an arbitrary Error message', () => {
    expect(getUserErrorMessage(new Error('sensitive stack detail'), '加载失败')).toBe('加载失败')
    expect(
      getUserErrorMessage(new ApiError('登录状态已失效', { kind: 'unauthorized' }), '加载失败'),
    ).toBe('登录状态已失效')
  })
})
