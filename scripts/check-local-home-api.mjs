const baseUrl = process.env.WBE_LOCAL_WEB_URL || 'http://127.0.0.1:5173'
const endpoint = new URL('/api/home/overview', baseUrl)

try {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) {
    const proxyHint =
      response.status === 502
        ? '；Vite 无法连接后端，请核对 WBE_DEV_PROXY_TARGET 与 Spring Boot 实际端口'
        : ''
    throw new Error(`HTTP ${response.status}${proxyHint}`)
  }
  const body = await response.json()
  const result = body?.data
  if (!result || typeof result !== 'object') throw new Error('响应缺少 data 对象')
  if (!Object.prototype.hasOwnProperty.call(result, 'keywords')) {
    throw new Error('响应缺少 keywords，5173 可能仍连接旧后端')
  }
  if (!Array.isArray(result.keywords)) throw new Error('keywords 不是数组')
  console.log(`首页接口正常：${endpoint}，真实研究因子 ${result.keywords.length} 项`)
} catch (error) {
  console.error(`首页接口自检失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
