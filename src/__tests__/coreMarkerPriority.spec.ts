import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const moduleHtmlPath = resolve(process.cwd(), 'public/core-marker-priority/index.html')
const moduleHtml = readFileSync(moduleHtmlPath, 'utf8')

describe('core marker priority production shell', () => {
  it('loads production data only from the backend API', () => {
    expect(moduleHtml).toContain('/api/core-marker-priority/overview')
    expect(moduleHtml).toContain('/api/core-marker-priority/details/')
    expect(moduleHtml).toContain('cache:"no-store"')
    expect(moduleHtml).toContain('validateOverviewPayload')
    expect(moduleHtml).toContain('REQUIRED_SCORE_SCOPES')
    expect(moduleHtml).toContain('请重启后端以执行托管数据迁移')
    expect(moduleHtml).not.toContain('overview.js')
    expect(moduleHtml).not.toContain('details.js')
    expect(statSync(moduleHtmlPath).size).toBeLessThan(100 * 1024)
  })

  it('contains launch-safe loading, timeout, failure, empty and no-result states', () => {
    expect(moduleHtml).toContain('REQUEST_TIMEOUT_MS=12000')
    expect(moduleHtml).toContain('class RequestTimeoutError')
    expect(moduleHtml).toContain('id="pageState"')
    expect(moduleHtml).toContain('后端接口响应成功，但当前数据集为空')
    expect(moduleHtml).toContain('详情接口响应超时')
    expect(moduleHtml).toContain('当前筛选下没有标记物')
  })

  it('supports four independent scoring levels and smart search suggestions', () => {
    expect(moduleHtml).toContain('id="fineFilter"')
    expect(moduleHtml).toContain('data-scope="targetFine"')
    expect(moduleHtml).toContain('目标物质细类内评价')
    expect(moduleHtml).toContain('id="searchSuggestions"')
    expect(moduleHtml).toContain('editDistance')
  })

  it('has explicit intermediate and mobile responsive breakpoints', () => {
    expect(moduleHtml).toContain('@media(max-width:1220px)')
    expect(moduleHtml).toContain('@media(max-width:900px)')
    expect(moduleHtml).toContain('@media(max-width:680px)')
  })

  it('does not render the score-evidence heatmap', () => {
    expect(moduleHtml).not.toContain('id="heatmapChart"')
    expect(moduleHtml).not.toContain('五项评分证据热图')
    expect(moduleHtml).not.toContain('renderHeatmap')
  })
})
