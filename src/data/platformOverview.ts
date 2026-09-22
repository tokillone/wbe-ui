export interface PlatformOverviewMetric {
  key: 'docs' | 'coverage' | 'categories' | 'markers'
  label: string
  value: string
  unit: string
  detail: string
  trend: string
  tone: 'blue' | 'green' | 'amber' | 'cyan'
  source: string
}

export const PLATFORM_OVERVIEW_METRICS: PlatformOverviewMetric[] = [
  {
    key: 'docs',
    label: '文献样本',
    value: '198',
    unit: '篇',
    detail: '覆盖 2004-2025 年 WBE 研究',
    trend: '年度持续扩展',
    tone: 'blue',
    source: 'DATA.metrics.docs',
  },
  {
    key: 'coverage',
    label: '国家 / 地区',
    value: '45 / 259',
    unit: '',
    detail: '沉淀国家、地区与城市层级信息',
    trend: '跨区域对比可用',
    tone: 'green',
    source: 'DATA.metrics.coverage',
  },
  {
    key: 'categories',
    label: '目标物质类别',
    value: '32',
    unit: '类',
    detail: '药物、消费品与暴露标志物',
    trend: '分类体系已归并',
    tone: 'amber',
    source: 'DATA.metrics.categories',
  },
  {
    key: 'markers',
    label: '生物标记物',
    value: '601',
    unit: '项',
    detail: '含名称归并、细分类型与记录追踪',
    trend: '支持后续检索',
    tone: 'cyan',
    source: 'DATA.metrics.markers',
  },
]
