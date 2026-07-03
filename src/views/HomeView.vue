<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  AuthRequestError,
  fetchCaptcha,
  fetchCurrentUser,
  login,
  logout as requestLogout,
  register,
  resetPassword,
  sendVerificationCode,
  type CaptchaResponse,
  type UserResponse,
} from '../services/auth'
import { clearSession, getStoredSession, saveSession, updateStoredUser } from '../services/session'

type AuthMode = 'login' | 'register' | 'reset'
type PendingAction = 'download' | 'operator' | null
type BiomarkerSortMode = 'frequency' | 'frequencyAsc' | 'name'
type TargetGroupMode = 'all' | 'drug' | 'consumer'

interface HeroMetric {
  key: string
  label: string
  value: string
  unit: string
  detail: string
  trend: string
  tone: 'blue' | 'green' | 'amber' | 'cyan'
  source?: string
}

interface TrendItem {
  label: string
  value: number
  width: number
  color: string
  docs?: number
  markers?: number
  targetClass?: string
}

interface FactorItem {
  name: string
  docs: number
  rows: number
  type: string
  countries?: number
  regions?: number
  tone?: string
}

interface CategoryItem {
  name: string
  count: number
  ratio: number
  tone: string
  docs?: number
  markers?: number
  countries?: number
  regions?: number
  targetClass?: string
  yearRange?: string
}

interface BiomarkerTrendPoint {
  period: string
  subclass?: string
  frequency: number
}

interface BiomarkerSubclassOption {
  name: string
  frequency: number
  biomarkerCount?: number
}

interface TargetCategoryOption {
  value: string
  name: string
  frequency?: number
  targetGroup?: TargetGroupMode | string
}

interface BiomarkerFrequencyItem {
  name: string
  frequency: number
  category?: string
  targetCategory?: string
  targetGroup?: TargetGroupMode | string
  docs?: number
  rows?: number
  tone?: string
  subclassOptions?: BiomarkerSubclassOption[]
  trend?: BiomarkerTrendPoint[]
}

interface ActivityItem {
  date: string
  title: string
  detail: string
}

interface WordCloudItem {
  name: string
  value: number
  category: string
  tone: string
  rows?: number
  docs?: number
  countries?: number
  regions?: number
  targetLabel?: string
  subcategories?: string[]
  aliases?: string[]
}

interface CatalogItem {
  title: string
  detail: string
  meta: string
}

interface AccessRuleItem {
  title: string
  detail: string
  state: string
}

interface HomeModuleItem {
  index: string
  title: string
  detail: string
  target: string
}

interface HomeData {
  metrics: HeroMetric[]
  trends: TrendItem[]
  factors: FactorItem[]
  categories: CategoryItem[]
  biomarkerFrequencies: BiomarkerFrequencyItem[]
  targetCategoryOptions?: TargetCategoryOption[]
  keywords: WordCloudItem[]
  catalogItems: CatalogItem[]
  accessRules: AccessRuleItem[]
  homeModules: HomeModuleItem[]
  activity: ActivityItem[]
}

interface ApiResponse<T> {
  code?: number
  message?: string
  data?: T
}

interface WordDetailDefaults {
  subcategories: string[]
  aliases: string[]
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HOME_OVERVIEW_ENDPOINT = '/api/home/overview'
const shouldFetchHomeOverview = import.meta.env.VITE_ENABLE_HOME_OVERVIEW_API === 'true'
const DEFAULT_SUBCLASS = '默认'
const TARGET_CATEGORY_ALL = 'all'
const DETAIL_COLUMN_WIDTH = 56
const DETAIL_COLUMN_MIN_WIDTH = 420
const BIOMARKER_CHART_PALETTE = [
  '#2f7078',
  '#0f6591',
  '#b7672c',
  '#496b9f',
  '#2f8f63',
  '#0e8f77',
  '#8a5b49',
  '#657b89',
  '#996923',
  '#377f62',
  '#245c99',
  '#6f5fa8',
]
const BIOMARKER_SORT_OPTIONS: { mode: BiomarkerSortMode; label: string }[] = [
  { mode: 'frequency', label: '高到低' },
  { mode: 'frequencyAsc', label: '低到高' },
  { mode: 'name', label: '名称' },
]

const mockHomeData: HomeData = {
  metrics: [
    { key: 'docs', label: '文献样本', value: '198', unit: '篇', detail: '覆盖 2004-2025 年 WBE 研究', trend: '年度持续扩展', tone: 'blue', source: 'DATA.metrics.docs' },
    { key: 'coverage', label: '国家/地区', value: '45 / 259', unit: '', detail: '沉淀国家、地区与城市层级信息', trend: '跨区域对比可用', tone: 'green', source: 'DATA.metrics.coverage' },
    { key: 'categories', label: '目标物质类别', value: '32', unit: '类', detail: '药物、消费品与暴露标志物', trend: '分类体系已归并', tone: 'amber', source: 'DATA.metrics.categories' },
    { key: 'markers', label: '生物标记物', value: '601', unit: '项', detail: '含名称归并、细分类型与记录追踪', trend: '支持后续检索', tone: 'cyan', source: 'DATA.metrics.markers' },
  ],
  trends: [
    { label: '抗生素', value: 4488, width: 100, color: '#1f77b4', docs: 55, markers: 133, targetClass: '药物类' },
    { label: '精神神经类药物', value: 3363, width: 75, color: '#496b9f', docs: 70, markers: 112, targetClass: '药物类' },
    { label: '降压药/心血管用药', value: 1885, width: 42, color: '#0e8f77', docs: 46, markers: 70, targetClass: '药物类' },
    { label: '烟草', value: 1799, width: 40, color: '#c67a19', docs: 64, markers: 20, targetClass: '消费品类' },
    { label: '阿片类药物', value: 1799, width: 40, color: '#6f5fa8', docs: 38, markers: 33, targetClass: '药物类' },
    { label: '平喘药/呼吸系统用药', value: 1291, width: 29, color: '#1291a8', docs: 19, markers: 13, targetClass: '药物类' },
    { label: '抗过敏药', value: 1270, width: 28, color: '#7a8792', docs: 18, markers: 9, targetClass: '药物类' },
    { label: '消炎镇痛药', value: 1263, width: 28, color: '#2f8f63', docs: 57, markers: 36, targetClass: '药物类' },
  ],
  factors: [
    { name: '可替宁', docs: 54, rows: 1296, type: '烟草', countries: 23, regions: 148, tone: '#c67a19' },
    { name: '磺胺甲噁唑', docs: 44, rows: 311, type: '抗生素', countries: 20, regions: 41, tone: '#1f77b4' },
    { name: '乙基硫酸酯', docs: 43, rows: 614, type: '酒精', countries: 27, regions: 104, tone: '#c67a19' },
    { name: '卡马西平', docs: 42, rows: 266, type: '精神神经类药物', countries: 21, regions: 41, tone: '#496b9f' },
    { name: '对乙酰氨基酚', docs: 41, rows: 290, type: '消炎镇痛药', countries: 19, regions: 35, tone: '#2f8f63' },
    { name: '甲氧苄啶', docs: 39, rows: 334, type: '抗生素', countries: 19, regions: 37, tone: '#0e8f77' },
    { name: '环丙沙星', docs: 33, rows: 280, type: '抗生素', countries: 20, regions: 27, tone: '#8a5b49' },
    { name: '阿替洛尔', docs: 33, rows: 205, type: '降压药/心血管用药', countries: 18, regions: 40, tone: '#7a8792' },
  ],
  biomarkerFrequencies: [
    {
      name: '可替宁',
      frequency: 54,
      category: '烟草',
      docs: 54,
      rows: 1296,
      tone: '#2f7078',
      trend: [
        { period: '2018', frequency: 5 },
        { period: '2019', frequency: 7 },
        { period: '2020', frequency: 8 },
        { period: '2021', frequency: 9 },
        { period: '2022', frequency: 10 },
        { period: '2023', frequency: 8 },
        { period: '2024', frequency: 7 },
      ],
    },
    {
      name: '磺胺甲噁唑',
      frequency: 44,
      category: '抗生素',
      docs: 44,
      rows: 311,
      tone: '#0f6591',
      trend: [
        { period: '2018', frequency: 3 },
        { period: '2019', frequency: 5 },
        { period: '2020', frequency: 6 },
        { period: '2021', frequency: 7 },
        { period: '2022', frequency: 8 },
        { period: '2023', frequency: 7 },
        { period: '2024', frequency: 8 },
      ],
    },
    {
      name: '乙基硫酸酯',
      frequency: 43,
      category: '酒精',
      docs: 43,
      rows: 614,
      tone: '#b7672c',
      trend: [
        { period: '2018', frequency: 4 },
        { period: '2019', frequency: 5 },
        { period: '2020', frequency: 6 },
        { period: '2021', frequency: 6 },
        { period: '2022', frequency: 7 },
        { period: '2023', frequency: 8 },
        { period: '2024', frequency: 7 },
      ],
    },
    {
      name: '卡马西平',
      frequency: 42,
      category: '精神神经类药物',
      docs: 42,
      rows: 266,
      tone: '#496b9f',
      trend: [
        { period: '2018', frequency: 3 },
        { period: '2019', frequency: 4 },
        { period: '2020', frequency: 6 },
        { period: '2021', frequency: 7 },
        { period: '2022', frequency: 7 },
        { period: '2023', frequency: 8 },
        { period: '2024', frequency: 7 },
      ],
    },
    {
      name: '对乙酰氨基酚',
      frequency: 41,
      category: '消炎镇痛药',
      docs: 41,
      rows: 290,
      tone: '#2f8f63',
      trend: [
        { period: '2018', frequency: 2 },
        { period: '2019', frequency: 5 },
        { period: '2020', frequency: 5 },
        { period: '2021', frequency: 7 },
        { period: '2022', frequency: 8 },
        { period: '2023', frequency: 8 },
        { period: '2024', frequency: 6 },
      ],
    },
    {
      name: '甲氧苄啶',
      frequency: 39,
      category: '抗生素',
      docs: 39,
      rows: 334,
      tone: '#0e8f77',
      trend: [
        { period: '2018', frequency: 4 },
        { period: '2019', frequency: 4 },
        { period: '2020', frequency: 5 },
        { period: '2021', frequency: 6 },
        { period: '2022', frequency: 7 },
        { period: '2023', frequency: 7 },
        { period: '2024', frequency: 6 },
      ],
    },
    {
      name: '环丙沙星',
      frequency: 33,
      category: '抗生素',
      docs: 33,
      rows: 280,
      tone: '#8a5b49',
      trend: [
        { period: '2018', frequency: 2 },
        { period: '2019', frequency: 4 },
        { period: '2020', frequency: 4 },
        { period: '2021', frequency: 5 },
        { period: '2022', frequency: 6 },
        { period: '2023', frequency: 6 },
        { period: '2024', frequency: 6 },
      ],
    },
    {
      name: '阿替洛尔',
      frequency: 33,
      category: '降压药/心血管用药',
      docs: 33,
      rows: 205,
      tone: '#657b89',
      trend: [
        { period: '2018', frequency: 3 },
        { period: '2019', frequency: 3 },
        { period: '2020', frequency: 5 },
        { period: '2021', frequency: 6 },
        { period: '2022', frequency: 6 },
        { period: '2023', frequency: 5 },
        { period: '2024', frequency: 5 },
      ],
    },
    {
      name: '咖啡因',
      frequency: 33,
      category: '咖啡因',
      docs: 33,
      rows: 277,
      tone: '#996923',
      trend: [
        { period: '2018', frequency: 2 },
        { period: '2019', frequency: 4 },
        { period: '2020', frequency: 5 },
        { period: '2021', frequency: 5 },
        { period: '2022', frequency: 6 },
        { period: '2023', frequency: 6 },
        { period: '2024', frequency: 5 },
      ],
    },
    {
      name: '萘普生',
      frequency: 31,
      category: '消炎镇痛药',
      docs: 31,
      rows: 211,
      tone: '#377f62',
      trend: [
        { period: '2018', frequency: 2 },
        { period: '2019', frequency: 3 },
        { period: '2020', frequency: 5 },
        { period: '2021', frequency: 5 },
        { period: '2022', frequency: 6 },
        { period: '2023', frequency: 5 },
        { period: '2024', frequency: 5 },
      ],
    },
    {
      name: '克拉霉素',
      frequency: 29,
      category: '抗生素',
      docs: 29,
      rows: 227,
      tone: '#245c99',
      trend: [
        { period: '2018', frequency: 2 },
        { period: '2019', frequency: 3 },
        { period: '2020', frequency: 3 },
        { period: '2021', frequency: 5 },
        { period: '2022', frequency: 6 },
        { period: '2023', frequency: 5 },
        { period: '2024', frequency: 5 },
      ],
    },
    {
      name: '文拉法辛',
      frequency: 29,
      category: '精神神经类药物',
      docs: 29,
      rows: 243,
      tone: '#6f5fa8',
      trend: [
        { period: '2018', frequency: 1 },
        { period: '2019', frequency: 3 },
        { period: '2020', frequency: 4 },
        { period: '2021', frequency: 5 },
        { period: '2022', frequency: 5 },
        { period: '2023', frequency: 6 },
        { period: '2024', frequency: 5 },
      ],
    },
  ],
  categories: [
    { name: '抗生素', count: 4488, docs: 55, markers: 133, ratio: 100, tone: '#1f77b4', targetClass: '药物类', countries: 25, regions: 49, yearRange: '2004 ~ 2024' },
    { name: '精神神经类药物', count: 3363, docs: 70, markers: 112, ratio: 75, tone: '#496b9f', targetClass: '药物类', countries: 28, regions: 85, yearRange: '2004 ~ 2024' },
    { name: '降压药/心血管用药', count: 1885, docs: 46, markers: 70, ratio: 42, tone: '#0e8f77', targetClass: '药物类', countries: 21, regions: 79, yearRange: '2004 ~ 2024' },
    { name: '烟草', count: 1799, docs: 64, markers: 20, ratio: 40, tone: '#c67a19', targetClass: '消费品类', countries: 30, regions: 176, yearRange: '2009 ~ 2025' },
    { name: '阿片类药物', count: 1799, docs: 38, markers: 33, ratio: 40, tone: '#6f5fa8', targetClass: '药物类', countries: 19, regions: 72, yearRange: '2006 ~ 2024' },
    { name: '平喘药/呼吸系统用药', count: 1291, docs: 19, markers: 13, ratio: 29, tone: '#1291a8', targetClass: '药物类', countries: 11, regions: 78, yearRange: '2004 ~ 2024' },
    { name: '抗过敏药', count: 1270, docs: 18, markers: 9, ratio: 28, tone: '#8a5b49', targetClass: '药物类', countries: 13, regions: 48, yearRange: '2012 ~ 2024' },
    { name: '消炎镇痛药', count: 1263, docs: 57, markers: 36, ratio: 28, tone: '#2f8f63', targetClass: '药物类', countries: 23, regions: 52, yearRange: '2004 ~ 2024' },
  ],
  keywords: [
    { name: '可替宁', value: 54, rows: 1296, docs: 54, countries: 23, regions: 148, category: '烟草', tone: '#c67a19', targetLabel: '消费品类' },
    { name: '磺胺甲噁唑', value: 44, rows: 311, docs: 44, countries: 20, regions: 41, category: '抗生素', tone: '#1f77b4', targetLabel: '药物类' },
    { name: '乙基硫酸酯', value: 43, rows: 614, docs: 43, countries: 27, regions: 104, category: '酒精', tone: '#c67a19', targetLabel: '消费品类' },
    { name: '卡马西平', value: 42, rows: 266, docs: 42, countries: 21, regions: 41, category: '精神神经类药物', tone: '#496b9f', targetLabel: '药物类' },
    { name: '对乙酰氨基酚', value: 41, rows: 290, docs: 41, countries: 19, regions: 35, category: '消炎镇痛药', tone: '#2f8f63', targetLabel: '药物类' },
    { name: '甲氧苄啶', value: 39, rows: 334, docs: 39, countries: 19, regions: 37, category: '抗生素', tone: '#0e8f77', targetLabel: '药物类' },
    { name: '环丙沙星', value: 33, rows: 280, docs: 33, countries: 20, regions: 27, category: '抗生素', tone: '#8a5b49', targetLabel: '药物类' },
    { name: '阿替洛尔', value: 33, rows: 205, docs: 33, countries: 18, regions: 40, category: '降压药/心血管用药', tone: '#7a8792', targetLabel: '药物类' },
    { name: '咖啡因', value: 33, rows: 277, docs: 33, countries: 18, regions: 54, category: '咖啡因', tone: '#c67a19', targetLabel: '消费品类' },
    { name: '萘普生', value: 31, rows: 211, docs: 31, countries: 15, regions: 28, category: '消炎镇痛药', tone: '#2f8f63', targetLabel: '药物类' },
    { name: '克拉霉素', value: 29, rows: 227, docs: 29, countries: 16, regions: 28, category: '抗生素', tone: '#1f77b4', targetLabel: '药物类' },
    { name: '文拉法辛', value: 29, rows: 243, docs: 29, countries: 17, regions: 46, category: '精神神经类药物', tone: '#496b9f', targetLabel: '药物类' },
    { name: '双氯芬酸', value: 28, rows: 178, docs: 28, countries: 16, regions: 30, category: '消炎镇痛药', tone: '#2f8f63', targetLabel: '药物类' },
    { name: '布洛芬', value: 28, rows: 171, docs: 28, countries: 15, regions: 26, category: '消炎镇痛药', tone: '#2f8f63', targetLabel: '药物类' },
    { name: '西酞普兰', value: 26, rows: 281, docs: 26, countries: 16, regions: 46, category: '精神神经类药物', tone: '#496b9f', targetLabel: '药物类' },
    { name: '美托洛尔', value: 25, rows: 146, docs: 25, countries: 16, regions: 30, category: '降压药/心血管用药', tone: '#7a8792', targetLabel: '药物类' },
    { name: '可待因', value: 25, rows: 780, docs: 25, countries: 14, regions: 33, category: '阿片类药物', tone: '#0e8f77', targetLabel: '药物类' },
    { name: '曲马多', value: 24, rows: 284, docs: 24, countries: 16, regions: 43, category: '阿片类药物', tone: '#0e8f77', targetLabel: '药物类' },
    { name: '氧氟沙星', value: 22, rows: 218, docs: 22, countries: 14, regions: 18, category: '抗生素', tone: '#8a5b49', targetLabel: '药物类' },
    { name: '红霉素', value: 21, rows: 185, docs: 21, countries: 12, regions: 26, category: '抗生素', tone: '#1f77b4', targetLabel: '药物类' },
    { name: '酮洛芬', value: 21, rows: 125, docs: 21, countries: 13, regions: 13, category: '消炎镇痛药', tone: '#2f8f63', targetLabel: '药物类' },
    { name: '加巴喷丁', value: 20, rows: 106, docs: 20, countries: 11, regions: 15, category: '精神神经类药物', tone: '#496b9f', targetLabel: '药物类' },
    { name: '诺氟沙星', value: 19, rows: 171, docs: 19, countries: 15, regions: 18, category: '抗生素', tone: '#8a5b49', targetLabel: '药物类' },
    { name: '奥沙西泮', value: 18, rows: 182, docs: 18, countries: 13, regions: 24, category: '精神神经类药物', tone: '#6f5fa8', targetLabel: '药物类' },
    { name: '普萘洛尔', value: 17, rows: 109, docs: 17, countries: 10, regions: 23, category: '降压药/心血管用药', tone: '#7a8792', targetLabel: '药物类' },
    { name: '厄贝沙坦', value: 17, rows: 89, docs: 17, countries: 11, regions: 21, category: '降压药/心血管用药', tone: '#6f5fa8', targetLabel: '药物类' },
    { name: '阿奇霉素', value: 15, rows: 106, docs: 15, countries: 9, regions: 19, category: '抗生素', tone: '#1f77b4', targetLabel: '药物类' },
    { name: '磺胺吡啶', value: 15, rows: 135, docs: 15, countries: 9, regions: 17, category: '抗生素', tone: '#1f77b4', targetLabel: '药物类' },
    { name: '二甲双胍', value: 15, rows: 669, docs: 15, countries: 9, regions: 70, category: '抗糖尿病药', tone: '#6f5fa8', targetLabel: '药物类' },
    { name: '氟西汀', value: 15, rows: 128, docs: 15, countries: 10, regions: 14, category: '精神神经类药物', tone: '#496b9f', targetLabel: '药物类' },
    { name: '缬沙坦', value: 15, rows: 69, docs: 15, countries: 10, regions: 19, category: '降压药/心血管用药', tone: '#6f5fa8', targetLabel: '药物类' },
    { name: '安赛蜜', value: 15, rows: 262, docs: 15, countries: 8, regions: 18, category: '人工甜味剂', tone: '#0e8f77', targetLabel: '暴露/生活方式标志物' },
    { name: '罗红霉素', value: 14, rows: 81, docs: 14, countries: 6, regions: 17, category: '抗生素', tone: '#1f77b4', targetLabel: '药物类' },
    { name: '磺胺嘧啶', value: 14, rows: 98, docs: 14, countries: 10, regions: 20, category: '抗生素', tone: '#1f77b4', targetLabel: '药物类' },
    { name: '氢氯噻嗪', value: 14, rows: 144, docs: 14, countries: 8, regions: 34, category: '降压药/心血管用药', tone: '#7a8792', targetLabel: '药物类' },
    { name: '苯扎贝特', value: 14, rows: 66, docs: 14, countries: 9, regions: 26, category: '降血脂药', tone: '#8a5b49', targetLabel: '药物类' },
    { name: '阿米替林', value: 14, rows: 116, docs: 14, countries: 8, regions: 21, category: '精神神经类药物', tone: '#496b9f', targetLabel: '药物类' },
    { name: '尼古丁', value: 14, rows: 82, docs: 14, countries: 9, regions: 9, category: '烟草', tone: '#c67a19', targetLabel: '消费品类' },
    { name: '克林霉素', value: 13, rows: 135, docs: 13, countries: 10, regions: 19, category: '抗生素', tone: '#8a5b49', targetLabel: '药物类' },
    { name: "反式-3'-羟基可替宁", value: 13, rows: 205, docs: 13, countries: 12, regions: 42, category: '烟草', tone: '#c67a19', targetLabel: '消费品类' },
    { name: '地尔硫卓', value: 12, rows: 75, docs: 12, countries: 8, regions: 17, category: '降压药/心血管用药', tone: '#6f5fa8', targetLabel: '药物类' },
    { name: '利多卡因', value: 12, rows: 49, docs: 12, countries: 9, regions: 8, category: '麻醉药', tone: '#0e8f77', targetLabel: '药物类' },
    { name: '非索非那定', value: 12, rows: 490, docs: 12, countries: 11, regions: 43, category: '抗过敏药', tone: '#8a5b49', targetLabel: '药物类' },
    { name: '沙丁胺醇', value: 11, rows: 570, docs: 11, countries: 7, regions: 65, category: '平喘药/呼吸系统用药', tone: '#6f5fa8', targetLabel: '药物类' },
    { name: '比索洛尔', value: 11, rows: 63, docs: 11, countries: 8, regions: 15, category: '降压药/心血管用药', tone: '#7a8792', targetLabel: '药物类' },
    { name: '呋塞米', value: 11, rows: 67, docs: 11, countries: 7, regions: 12, category: '降压药/心血管用药', tone: '#8a5b49', targetLabel: '药物类' },
    { name: '水杨酸', value: 11, rows: 47, docs: 11, countries: 7, regions: 14, category: '消炎镇痛药', tone: '#2f8f63', targetLabel: '药物类' },
    { name: '吗啡', value: 11, rows: 57, docs: 11, countries: 9, regions: 15, category: '阿片类药物', tone: '#0e8f77', targetLabel: '药物类' },
    { name: '四环素', value: 10, rows: 137, docs: 10, countries: 9, regions: 8, category: '抗生素', tone: '#8a5b49', targetLabel: '药物类' },
    { name: '米氮平', value: 10, rows: 137, docs: 10, countries: 9, regions: 21, category: '精神神经类药物', tone: '#496b9f', targetLabel: '药物类' },
    { name: '索他洛尔', value: 10, rows: 71, docs: 10, countries: 7, regions: 15, category: '降压药/心血管用药', tone: '#7a8792', targetLabel: '药物类' },
    { name: '替米沙坦', value: 10, rows: 77, docs: 10, countries: 8, regions: 13, category: '降压药/心血管用药', tone: '#6f5fa8', targetLabel: '药物类' },
    { name: '西替利嗪', value: 10, rows: 461, docs: 10, countries: 9, regions: 41, category: '抗过敏药', tone: '#8a5b49', targetLabel: '药物类' },
    { name: '雷尼替丁', value: 10, rows: 71, docs: 10, countries: 7, regions: 6, category: '抗消化性溃疡药', tone: '#7a8792', targetLabel: '药物类' },
    { name: '美沙酮', value: 10, rows: 99, docs: 10, countries: 7, regions: 31, category: '阿片类药物', tone: '#6f5fa8', targetLabel: '药物类' },
    { name: '氯霉素', value: 9, rows: 30, docs: 9, countries: 4, regions: 8, category: '抗生素', tone: '#6f5fa8', targetLabel: '药物类' },
    { name: '劳拉西泮', value: 9, rows: 38, docs: 9, countries: 5, regions: 7, category: '精神神经类药物', tone: '#6f5fa8', targetLabel: '药物类' },
    { name: '舍曲林', value: 9, rows: 99, docs: 9, countries: 8, regions: 10, category: '精神神经类药物', tone: '#496b9f', targetLabel: '药物类' },
    { name: 'O-去甲基文拉法辛', value: 9, rows: 57, docs: 9, countries: 6, regions: 9, category: '精神神经类药物', tone: '#496b9f', targetLabel: '药物类' },
    { name: '吉非贝齐', value: 9, rows: 24, docs: 9, countries: 6, regions: 7, category: '降血脂药', tone: '#8a5b49', targetLabel: '药物类' },
    { name: '吲哚美辛', value: 9, rows: 28, docs: 9, countries: 7, regions: 6, category: '消炎镇痛药', tone: '#2f8f63', targetLabel: '药物类' },
    { name: '1,7-二甲基黄嘌呤（副黄嘌呤）', value: 9, rows: 44, docs: 9, countries: 7, regions: 11, category: '咖啡因', tone: '#c67a19', targetLabel: '消费品类' },
    { name: 'Azithromycin', value: 9, rows: 30, docs: 9, countries: 7, regions: 9, category: '抗生素', tone: '#1f77b4', targetLabel: '药物类' },
    { name: '阿托伐他汀', value: 9, rows: 82, docs: 9, countries: 7, regions: 15, category: '降血脂药', tone: '#6f5fa8', targetLabel: '药物类' },
  ],
  catalogItems: [
    { title: '目标物质与类别', detail: '32 类目标物质，覆盖药物类、消费品类和暴露/生活方式标志物。', meta: '类别、别名、归并规则' },
    { title: '生物标记物', detail: '601 项生物标记物，保留去重文献数、数据行数和覆盖地区。', meta: '中文名、英文名、代谢物' },
    { title: '空间覆盖', detail: '45 个国家/地区与 259 个省级或城市层级地区。', meta: '国家、地区、城市、流域' },
    { title: '文献证据', detail: '198 篇 WBE 文献，覆盖 2004-2025 年。', meta: '题名、年份、DOI、期刊' },
  ],
  accessRules: [
    { title: '开放检索', detail: '目标物质、词云、类别分布和字段说明对访客开放。', state: '公开' },
    { title: '受控下载', detail: '按筛选条件导出完整数据包前需要登录并记录用途。', state: '登录后' },
    { title: '数据维护', detail: '上传、批量校验、字段修订和版本发布仅面向操作员。', state: '操作员' },
  ],
  homeModules: [
    { index: '01', title: '数据说明', detail: '查看开放字段、权限边界和来源说明。', target: 'about' },
    { index: '02', title: '词云图谱', detail: '按 DOI 去重研究数理解高频标记物。', target: 'visual' },
    { index: '03', title: '类别分布', detail: '对比目标物质类别的数据行数和覆盖范围。', target: 'visual' },
    { index: '04', title: '方法质量', detail: '查看字段口径、质量控制和版本说明。', target: 'methods' },
  ],
  activity: [
    {
      date: '2026 Q2',
      title: '数据结构预留更新接口',
      detail: '首页概览读取 /api/home/overview，后端接入后可替换 mock 数据。',
    },
    {
      date: '2026 Q3',
      title: '下载权限与操作员入口',
      detail: '下载数据包、维护字段和批量校验需要账号认证。',
    },
  ],
}

const homeData = ref<HomeData>(mockHomeData)
const searchQuery = ref('')
const isSearchOpen = ref(false)
const isAuthOpen = ref(false)
const isAuthenticated = ref(false)
const currentUser = ref('')
const currentUserRole = ref<UserResponse['role'] | ''>('')
const currentUserCanUpload = ref(false)
const currentUserCanDownload = ref(true)
const pendingAction = ref<PendingAction>(null)
const actionNotice = ref('')
const loginComplete = ref(false)
const isUploadWorkspaceOpen = ref(false)
const selectedFileName = ref('')
const uploadNotice = ref('')
const currentOverviewIndex = ref(0)
const isOverviewPaused = ref(false)
const activeKeyword = ref<string | null>(null)
const selectedBiomarkerName = ref('')
const selectedTargetCategory = ref(TARGET_CATEGORY_ALL)
const selectedSubclassName = ref('')
const biomarkerSortMode = ref<BiomarkerSortMode>('frequency')
const selectedWord = ref<WordCloudItem | null>(null)
const wordPopoverStyle = ref<Record<string, string>>({})

const mode = ref<AuthMode>('login')
const isSubmitting = ref(false)
const isSendingCode = ref(false)
const isLoadingCaptcha = ref(false)
const loginPasswordVisible = ref(false)
const countdown = ref(0)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const loginCaptcha = ref<CaptchaResponse | null>(null)
const loginForm = reactive({
  account: '',
  password: '',
  captchaCode: '',
})
const registerForm = reactive({
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  code: '',
})
const resetForm = reactive({
  email: '',
  password: '',
  confirmPassword: '',
  code: '',
})
const uploadForm = reactive({
  datasetType: 'factor',
  batchName: '',
  notes: '',
})
const router = useRouter()

let codeTimer: number | undefined
let overviewTimer: number | undefined

const isLogin = computed(() => mode.value === 'login')
const isRegister = computed(() => mode.value === 'register')
const isReset = computed(() => mode.value === 'reset')
const canAccessDataEntry = computed(
  () =>
    isAuthenticated.value &&
    (currentUserRole.value === 'admin' || currentUserRole.value === 'editor' || currentUserCanUpload.value),
)
const needsCode = computed(() => isRegister.value || isReset.value)
const pageTitle = computed(() => {
  if (isRegister.value) return '注册账号'
  if (isReset.value) return '重置密码'
  return '登录平台'
})
const authLead = computed(() => {
  if (pendingAction.value === 'download') return '登录后将继续下载当前数据包。'
  if (pendingAction.value === 'operator') return '登录后可进入数据上传与批量校验。'
  return '用于受控下载、字段维护和数据版本发布。'
})
const submitText = computed(() => {
  if (isRegister.value) return '创建账号'
  if (isReset.value) return '重置密码'
  return '登录'
})
const defaultMetric: HeroMetric = {
  key: 'docs',
  label: '文献样本',
  value: '198',
  unit: '篇',
  detail: '覆盖 2004-2025 年 WBE 研究',
  trend: '年度持续扩展',
  tone: 'blue',
  source: 'DATA.metrics.docs',
}
const WORD_DETAIL_DEFAULTS: Record<string, WordDetailDefaults> = {
  '可替宁': { subcategories: ['尼古丁及代谢物'], aliases: ['cotinine（可替宁）'] },
  '磺胺甲噁唑': { subcategories: ['磺胺类'], aliases: ['磺胺甲恶唑'] },
  '乙基硫酸酯': { subcategories: ['酒精消费标志物'], aliases: [] },
  '卡马西平': { subcategories: ['抗癫痫/神经痛用药'], aliases: [] },
  '对乙酰氨基酚': { subcategories: ['非甾体抗炎药'], aliases: [] },
  '甲氧苄啶': { subcategories: ['二氨基嘧啶类'], aliases: [] },
  '环丙沙星': { subcategories: ['喹诺酮类'], aliases: [] },
  '阿替洛尔': { subcategories: ['β受体阻滞剂'], aliases: [] },
  '咖啡因': { subcategories: ['咖啡因及代谢物'], aliases: [] },
  '萘普生': { subcategories: ['非甾体抗炎药'], aliases: [] },
  '克拉霉素': { subcategories: ['大环内酯类'], aliases: [] },
  '文拉法辛': { subcategories: ['抗抑郁药'], aliases: [] },
  '双氯芬酸': { subcategories: ['非甾体抗炎药'], aliases: [] },
  '布洛芬': { subcategories: ['非甾体抗炎药'], aliases: [] },
  '西酞普兰': { subcategories: ['抗抑郁药'], aliases: [] },
  '美托洛尔': { subcategories: ['β受体阻滞剂'], aliases: [] },
  '可待因': { subcategories: ['阿片类镇痛药'], aliases: [] },
  '曲马多': { subcategories: ['阿片类镇痛药'], aliases: [] },
  '氧氟沙星': { subcategories: ['喹诺酮类'], aliases: [] },
  '红霉素': { subcategories: ['大环内酯类'], aliases: [] },
  '酮洛芬': { subcategories: ['非甾体抗炎药'], aliases: [] },
  '加巴喷丁': { subcategories: ['抗癫痫/神经痛用药'], aliases: [] },
  '诺氟沙星': { subcategories: ['喹诺酮类'], aliases: [] },
  '奥沙西泮': { subcategories: ['镇静催眠/抗焦虑药'], aliases: [] },
  '普萘洛尔': { subcategories: ['β受体阻滞剂'], aliases: [] },
  '厄贝沙坦': { subcategories: ['血管紧张素II受体阻滞剂'], aliases: [] },
  '阿奇霉素': { subcategories: ['大环内酯类'], aliases: [] },
  '磺胺吡啶': { subcategories: ['磺胺类'], aliases: [] },
  '二甲双胍': { subcategories: ['双胍类'], aliases: [] },
  '氟西汀': { subcategories: ['抗抑郁药'], aliases: [] },
  '缬沙坦': { subcategories: ['血管紧张素II受体阻滞剂'], aliases: [] },
  '安赛蜜': { subcategories: ['人工甜味剂'], aliases: [] },
  '罗红霉素': { subcategories: ['大环内酯类'], aliases: [] },
  '磺胺嘧啶': { subcategories: ['磺胺类'], aliases: [] },
  '氢氯噻嗪': { subcategories: ['利尿剂'], aliases: [] },
  '苯扎贝特': { subcategories: ['调脂药'], aliases: [] },
  '阿米替林': { subcategories: ['抗抑郁药'], aliases: [] },
  '尼古丁': { subcategories: ['尼古丁及代谢物'], aliases: [] },
  '克林霉素': { subcategories: ['林可酰胺类'], aliases: [] },
  "反式-3'-羟基可替宁": {
    subcategories: ['尼古丁及代谢物'],
    aliases: ["trans-3'-hydroxycotinine（反式-3'-羟基可替宁）"],
  },
  '地尔硫卓': { subcategories: ['钙通道阻滞剂'], aliases: [] },
  '利多卡因': { subcategories: ['酰胺类局部麻醉药'], aliases: [] },
  '非索非那定': { subcategories: ['抗组胺药'], aliases: [] },
  '沙丁胺醇': { subcategories: ['β受体激动剂'], aliases: [] },
  '比索洛尔': { subcategories: ['β受体阻滞剂'], aliases: [] },
  '呋塞米': { subcategories: ['利尿剂'], aliases: [] },
  '水杨酸': { subcategories: ['非甾体抗炎药'], aliases: [] },
  '吗啡': { subcategories: ['阿片类镇痛药'], aliases: [] },
  '四环素': { subcategories: ['四环素类'], aliases: [] },
  '米氮平': { subcategories: ['抗抑郁药'], aliases: [] },
  '索他洛尔': { subcategories: ['β受体阻滞剂'], aliases: [] },
  '替米沙坦': { subcategories: ['血管紧张素II受体阻滞剂'], aliases: [] },
  '西替利嗪': { subcategories: ['抗组胺药'], aliases: [] },
  '雷尼替丁': { subcategories: ['H2受体拮抗剂'], aliases: [] },
  '美沙酮': { subcategories: ['阿片维持治疗药物'], aliases: [] },
  '氯霉素': { subcategories: ['酰胺醇类'], aliases: [] },
  '劳拉西泮': { subcategories: ['镇静催眠/抗焦虑药'], aliases: [] },
  '舍曲林': { subcategories: ['抗抑郁药'], aliases: [] },
  'O-去甲基文拉法辛': { subcategories: ['抗抑郁药'], aliases: [] },
  '吉非贝齐': { subcategories: ['调脂药'], aliases: [] },
  '吲哚美辛': { subcategories: ['非甾体抗炎药'], aliases: [] },
  '1,7-二甲基黄嘌呤（副黄嘌呤）': { subcategories: ['咖啡因及代谢物'], aliases: [] },
  Azithromycin: { subcategories: ['大环内酯类'], aliases: [] },
  '阿托伐他汀': { subcategories: ['他汀类调脂药'], aliases: [] },
}
const codeScene = computed(() => (isReset.value ? 'reset-password' : 'register'))
const activeCodeEmail = computed(() => (isReset.value ? resetForm.email : registerForm.email))
const canSendCode = computed(
  () =>
    needsCode.value &&
    EMAIL_PATTERN.test(activeCodeEmail.value) &&
    countdown.value === 0 &&
    !isSendingCode.value,
)
const activeMetric = computed<HeroMetric>(
  () => homeData.value.metrics[currentOverviewIndex.value] ?? homeData.value.metrics[0] ?? defaultMetric,
)
const overviewFocusCopy = computed(() => {
  const metric = activeMetric.value
  const valueText = `${metric.value}${metric.unit}`

  if (metric.key === 'docs') {
    return `${valueText}文献构成证据底座，可继续追踪 DOI、年份和研究来源。`
  }
  if (metric.key === 'coverage') {
    return `${valueText}空间索引用于连接国家、地区与城市层级记录。`
  }
  if (metric.key === 'categories') {
    return `${valueText}目标物质分类已归并，可向下钻取类别与 biomarker 明细。`
  }
  if (metric.key === 'markers') {
    return `${valueText}标记物条目可连接类别、文献和地区覆盖信息。`
  }

  return `${metric.label}作为当前概览指标，用于定位数据库的主要覆盖面。`
})
const categoryFrequencyFallback = computed<BiomarkerFrequencyItem[]>(() => {
  const categories = homeData.value.categories?.length ? homeData.value.categories : mockHomeData.categories
  const keywords = homeData.value.keywords?.length ? homeData.value.keywords : mockHomeData.keywords

  return categories.map((category, index) => {
    const categoryDocs = normalizeCount(category.docs)
    const categoryRows = normalizeCount(category.count)
    const trend = keywords
      .filter((item) => item.category === category.name)
      .sort(
        (a, b) =>
          normalizeCount(b.docs ?? b.value) - normalizeCount(a.docs ?? a.value) ||
          a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }),
      )
      .slice(0, 12)
      .map((item) => ({
        period: item.name,
        frequency: normalizeCount(item.docs ?? item.value),
      }))

    return {
      name: category.name,
      frequency: categoryDocs || categoryRows,
      category: category.targetClass ?? '未分类',
      docs: categoryDocs || categoryRows,
      rows: categoryRows,
      tone: category.tone ?? BIOMARKER_CHART_PALETTE[index % BIOMARKER_CHART_PALETTE.length],
      trend,
    }
  })
})
const targetCategoryOptions = computed<TargetCategoryOption[]>(() => {
  const supplied = homeData.value.targetCategoryOptions ?? []
  const normalized = supplied
    .map((option) => {
      const value = `${option.value ?? option.name ?? ''}`.trim()
      const name = `${option.name ?? option.value ?? ''}`.trim()
      return {
        ...option,
        value,
        name,
        frequency: normalizeCount(option.frequency),
      }
    })
    .filter((option) => option.value && option.name)

  const options = normalized.length ? normalized : [{ value: TARGET_CATEGORY_ALL, name: '全部' }]
  const hasAllOption = options.some((option) => option.value === TARGET_CATEGORY_ALL)

  return hasAllOption ? options : [{ value: TARGET_CATEGORY_ALL, name: '全部' }, ...options]
})
const selectedTargetCategoryOption = computed(
  () =>
    targetCategoryOptions.value.find((option) => option.value === selectedTargetCategory.value) ??
    targetCategoryOptions.value[0] ??
    { value: TARGET_CATEGORY_ALL, name: '全部' },
)
const rawBiomarkerFrequencies = computed<BiomarkerFrequencyItem[]>(() => {
  const fallback = categoryFrequencyFallback.value
  const supplied = homeData.value.biomarkerFrequencies ?? []
  const source = supplied.length && hasCategoryFrequencySource(supplied, fallback) ? supplied : fallback

  const normalizedItems = source
    .map((item, index) => {
      const frequency = normalizeCount(item.frequency)
      const trend =
        item.trend?.map((point) => ({
          ...point,
          period: point.period,
          subclass: point.subclass?.trim() || DEFAULT_SUBCLASS,
          frequency: normalizeCount(point.frequency),
        })) ?? []
      const subclassOptions =
        item.subclassOptions
          ?.map((option) => ({
            ...option,
            name: option.name?.trim() || DEFAULT_SUBCLASS,
            frequency: normalizeCount(option.frequency),
            biomarkerCount: normalizeCount(option.biomarkerCount),
          }))
          .filter((option) => option.name && option.frequency > 0) ?? []

      return {
        ...item,
        frequency,
        docs: frequency,
        rows: normalizeCount(item.rows),
        tone: item.tone ?? BIOMARKER_CHART_PALETTE[index % BIOMARKER_CHART_PALETTE.length],
        trend,
        subclassOptions,
      }
    })
    .filter((item) => item.name && item.frequency > 0 && matchesTargetCategory(item))

  return normalizedItems.sort((a, b) => {
    if (biomarkerSortMode.value === 'name') {
      return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    }

    if (biomarkerSortMode.value === 'frequencyAsc') {
      return (
        a.frequency - b.frequency ||
        normalizeCount(a.docs) - normalizeCount(b.docs) ||
        a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
      )
    }

    return (
      b.frequency - a.frequency ||
      normalizeCount(b.docs) - normalizeCount(a.docs) ||
      a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    )
  })
})
const biomarkerFrequencyAxisTop = computed(() =>
  getAxisTop(Math.max(...rawBiomarkerFrequencies.value.map((item) => item.frequency), 1)),
)
const biomarkerFrequencyItems = computed(() =>
  rawBiomarkerFrequencies.value.map((item) => ({
    ...item,
    barWidth: `${Math.max((item.frequency / biomarkerFrequencyAxisTop.value) * 100, 3)}%`,
  })),
)
const biomarkerFrequencyAxisTicks = computed(() => [...buildAxisTicks(biomarkerFrequencyAxisTop.value)].reverse())
const selectedBiomarker = computed(
  () =>
    biomarkerFrequencyItems.value.find((item) => item.name === selectedBiomarkerName.value) ??
    biomarkerFrequencyItems.value[0] ??
    null,
)
const selectedBiomarkerSubclasses = computed<BiomarkerSubclassOption[]>(() => {
  const selected = selectedBiomarker.value
  if (!selected) return []
  if (selected.subclassOptions?.length) return selected.subclassOptions

  const subclassMap = new Map<string, { doiCount: number; biomarkers: number }>()
  selected.trend?.forEach((item) => {
    const subclass = item.subclass?.trim() || DEFAULT_SUBCLASS
    const current = subclassMap.get(subclass) ?? { doiCount: 0, biomarkers: 0 }
    current.doiCount += normalizeCount(item.frequency)
    current.biomarkers += 1
    subclassMap.set(subclass, current)
  })

  return Array.from(subclassMap, ([name, value]) => ({
    name,
    frequency: value.doiCount,
    biomarkerCount: value.biomarkers,
  })).sort(
    (a, b) =>
      b.frequency - a.frequency ||
      normalizeCount(b.biomarkerCount) - normalizeCount(a.biomarkerCount) ||
      a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }),
  )
})
const selectedSubclass = computed(
  () =>
    selectedBiomarkerSubclasses.value.find((item) => item.name === selectedSubclassName.value) ??
    selectedBiomarkerSubclasses.value[0] ??
    null,
)
const selectedBiomarkerTrend = computed(
  () =>
    selectedBiomarker.value?.trend
      ?.map((item) => ({
        name: item.period,
        subclass: item.subclass?.trim() || DEFAULT_SUBCLASS,
        frequency: normalizeCount(item.frequency),
      }))
      .filter(
        (item) =>
          item.name &&
          item.frequency > 0 &&
          (!selectedSubclass.value || item.subclass === selectedSubclass.value.name),
      ) ?? [],
)
const biomarkerTotalFrequency = computed(() =>
  biomarkerFrequencyItems.value.reduce((sum, item) => sum + item.frequency, 0),
)
const selectedCategoryBiomarkerAxisTop = computed(() =>
  getAxisTop(Math.max(...selectedBiomarkerTrend.value.map((item) => item.frequency), 1)),
)
const selectedCategoryBiomarkerItems = computed(() =>
  [...selectedBiomarkerTrend.value]
    .sort(
      (a, b) =>
        b.frequency - a.frequency ||
        a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }),
    )
    .map((item, index) => ({
      ...item,
      tone: BIOMARKER_CHART_PALETTE[index % BIOMARKER_CHART_PALETTE.length],
      barHeight: `${Math.max((item.frequency / selectedCategoryBiomarkerAxisTop.value) * 100, 7)}%`,
    })),
)
const detailColumnPlotWidth = computed(
  () =>
    `${Math.max(
      DETAIL_COLUMN_MIN_WIDTH,
      selectedCategoryBiomarkerItems.value.length * DETAIL_COLUMN_WIDTH,
    )}px`,
)
const visualEntryItems = computed(() => [
  {
    icon: 'map',
    title: '地图可视化',
    value: coverageText(),
    detail: '按空间层级查看 PNDL 分布',
    target: 'map-visualization',
    route: '/map-visualization',
  },
  {
    icon: 'sankey',
    title: 'ICD11 桑基图',
    value: '10 类',
    detail: '串联疾病分类、药物与生物标记物',
    target: 'icd11-sankey',
    route: '/icd11-sankey',
  },
  {
    icon: 'cloud',
    title: '因子词云',
    value: metricText('markers', '601', '项'),
    detail: '浏览高频生物标记物',
    target: 'visual',
  },
  {
    icon: 'coverage',
    title: '研究图谱',
    value: `${homeData.value.biomarkerFrequencies.length || mockHomeData.biomarkerFrequencies.length} 类样例`,
    detail: '比较目标物质类别累计研究走势',
    target: 'visual',
  },
  {
    icon: 'evidence',
    title: '文献/地区证据',
    value: `${metricText('docs', '198', '篇')} / ${coverageText()}`,
    detail: '追踪来源与空间覆盖',
    target: 'about',
  },
])
const quickSearchItems = computed(() => [
  ...homeData.value.factors.map((item) => ({
    title: item.name,
    meta: `${item.type} · ${item.docs} 篇文献 · ${item.rows} 行数据`,
  })),
  ...homeData.value.categories.map((item) => ({
    title: item.name,
    meta: `${item.count} 条记录 · 覆盖率 ${item.ratio}%`,
  })),
])
const wordCloudItems = computed(() => {
  const keywords = homeData.value.keywords
    .map((item) => enrichWordItem(item))
    .sort((a, b) => stableHash(a.name) - stableHash(b.name))
  const values = keywords.map((item) => item.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const spread = Math.max(max - min, 1)

  return keywords.map((item, index) => ({
    ...item,
    size: 14 + ((item.value - min) / spread) * 20,
    delay: `${(index % 7) * -0.5}s`,
  }))
})
const wordCloudRows = computed(() => {
  const rows: [typeof wordCloudItems.value, typeof wordCloudItems.value, typeof wordCloudItems.value] = [
    [],
    [],
    [],
  ]
  wordCloudItems.value.forEach((item, index) => {
    const rowIndex = index % rows.length
    if (rowIndex === 0) rows[0].push(item)
    else if (rowIndex === 1) rows[1].push(item)
    else rows[2].push(item)
  })

  return rows.map((items, index) => ({
    key: `word-row-${index}`,
    duration: `${155 + index * 30}s`,
    reverse: index % 2 === 1,
    items: [...items, ...items],
  }))
})
const activeWord = computed(() =>
  activeKeyword.value
    ? wordCloudItems.value.find((item) => item.name === activeKeyword.value)
    : null,
)
const searchResults = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()
  if (!keyword) return quickSearchItems.value.slice(0, 5)

  return quickSearchItems.value
    .filter((item) => `${item.title} ${item.meta}`.toLowerCase().includes(keyword))
    .slice(0, 5)
})

function metricText(key: string, fallbackValue: string, fallbackUnit = '') {
  const metric = homeData.value.metrics.find((item) => item.key === key)
  const value = metric?.value ?? fallbackValue
  const unit = metric?.unit ?? fallbackUnit
  return unit ? `${value} ${unit}` : value
}

function coverageText() {
  const coverage = homeData.value.metrics.find((item) => item.key === 'coverage')?.value ?? '45 / 259'
  return coverage.replace(/\s*\/\s*/g, '·')
}

function normalizeCount(value?: number) {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 0
}

function isYearBucket(period: string) {
  return /^(19|20)\d{2}$/.test(period.trim())
}

function hasCategoryFrequencySource(
  items: BiomarkerFrequencyItem[],
  categoryItems: BiomarkerFrequencyItem[],
) {
  const categoryNames = new Set(categoryItems.map((item) => item.name))

  return items.some((item) => categoryNames.has(item.name)) || items.some((item) =>
    item.trend?.some((point) => !isYearBucket(point.period)),
  )
}

function shortBiomarkerName(name: string) {
  const normalized = name.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 8) return normalized

  const isMostlyAscii = /^[\u0000-\u00ff]+$/.test(normalized)
  if (isMostlyAscii) {
    return normalized.length <= 14 ? normalized : `${normalized.slice(0, 12)}…`
  }

  return `${normalized.slice(0, 4)}…${normalized.slice(-2)}`
}

function matchesTargetCategory(item: BiomarkerFrequencyItem) {
  if (selectedTargetCategory.value === TARGET_CATEGORY_ALL) return true
  const itemCategory = item.targetCategory ?? item.category

  return itemCategory === selectedTargetCategory.value
}

function formatTargetCategoryOption(option: TargetCategoryOption) {
  if (option.value === TARGET_CATEGORY_ALL) return option.name
  return `${option.name}（${formatNumber(option.frequency)}）`
}

function getAxisTop(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 4
  if (value <= 4) return 4

  const stepBase = value <= 20 ? 1 : value <= 100 ? 5 : value <= 1000 ? 25 : 100
  return Math.ceil(value / 4 / stepBase) * stepBase * 4
}

function buildAxisTicks(axisTop: number) {
  const top = Math.max(Math.round(axisTop), 4)
  return [top, Math.round(top * 0.75), Math.round(top * 0.5), Math.round(top * 0.25), 0]
}

function stableHash(text: string) {
  let hash = 0
  for (const char of text) {
    hash = (hash * 31 + char.charCodeAt(0)) % 9973
  }
  return hash
}

function enrichWordItem(item: WordCloudItem): WordCloudItem {
  const defaults = WORD_DETAIL_DEFAULTS[item.name]
  return {
    ...item,
    subcategories: item.subcategories?.length ? item.subcategories : defaults?.subcategories ?? [],
    aliases: item.aliases?.length ? item.aliases : defaults?.aliases ?? [],
  }
}

function formatNumber(value?: number) {
  return new Intl.NumberFormat('zh-CN').format(value ?? 0)
}

function uniqueTags(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter(Boolean))) as string[]
}

function detailTags(values?: string[]) {
  return values?.length ? values : ['暂无']
}

function belongingTags(word: WordCloudItem) {
  return uniqueTags([word.targetLabel ?? '其他', word.category])
}

async function loadHomeData() {
  if (!shouldFetchHomeOverview) return

  try {
    const params = new URLSearchParams()
    params.set('targetCategory', selectedTargetCategory.value)
    const endpoint = `${HOME_OVERVIEW_ENDPOINT}?${params.toString()}`
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
      },
    })
    if (!response.ok) return

    const body = (await response.json()) as ApiResponse<Partial<HomeData>> | Partial<HomeData> | null
    if (!body) return

    const result: Partial<HomeData> =
      'data' in body
        ? ((body.code === undefined || body.code === 200 ? body.data : null) ?? {})
        : (body as Partial<HomeData>)

    homeData.value = {
      metrics: result.metrics?.length ? result.metrics : mockHomeData.metrics,
      trends: result.trends?.length ? result.trends : mockHomeData.trends,
      factors: result.factors?.length ? result.factors : mockHomeData.factors,
      categories: result.categories?.length ? result.categories : mockHomeData.categories,
      biomarkerFrequencies: result.biomarkerFrequencies?.length
        ? result.biomarkerFrequencies
        : mockHomeData.biomarkerFrequencies,
      targetCategoryOptions: result.targetCategoryOptions?.length
        ? result.targetCategoryOptions
        : (homeData.value.targetCategoryOptions ?? mockHomeData.targetCategoryOptions),
      keywords: result.keywords?.length ? result.keywords : mockHomeData.keywords,
      catalogItems: result.catalogItems?.length ? result.catalogItems : mockHomeData.catalogItems,
      accessRules: result.accessRules?.length ? result.accessRules : mockHomeData.accessRules,
      homeModules: result.homeModules?.length ? result.homeModules : mockHomeData.homeModules,
      activity: result.activity?.length ? result.activity : mockHomeData.activity,
    }

    const hasSelectedTargetCategory = targetCategoryOptions.value.some(
      (option) => option.value === selectedTargetCategory.value,
    )
    if (!hasSelectedTargetCategory) {
      selectedTargetCategory.value = TARGET_CATEGORY_ALL
    }

    const hasSelectedBiomarker = homeData.value.biomarkerFrequencies.some(
      (item) => item.name === selectedBiomarkerName.value,
    )
    if (!hasSelectedBiomarker) {
      selectedBiomarkerName.value = ''
      selectedSubclassName.value = ''
    }
  } catch {
    homeData.value = mockHomeData
  }
}

function focusOverview(index: number) {
  if (index < 0 || index >= homeData.value.metrics.length) return
  currentOverviewIndex.value = index
  isOverviewPaused.value = true
}

function releaseOverview() {
  isOverviewPaused.value = false
}

function focusKeyword(name: string) {
  activeKeyword.value = name
}

function releaseKeyword() {
  activeKeyword.value = selectedWord.value?.name ?? null
}

function selectBiomarker(name: string) {
  selectedBiomarkerName.value = name
  selectedSubclassName.value = ''
}

function selectTargetCategory(event: Event) {
  const value = (event.target as HTMLSelectElement).value || TARGET_CATEGORY_ALL
  if (selectedTargetCategory.value === value) return
  selectedTargetCategory.value = value
  selectedBiomarkerName.value = ''
  selectedSubclassName.value = ''
  void loadHomeData()
}

function selectSubclass(event: Event) {
  selectedSubclassName.value = (event.target as HTMLSelectElement).value
}

function openWordPopover(item: WordCloudItem, event: MouseEvent) {
  selectedWord.value = enrichWordItem(item)
  activeKeyword.value = item.name

  const width = Math.min(380, window.innerWidth - 40)
  const height = 430
  const margin = 14
  let left = event.clientX + 16
  let top = event.clientY + 16

  if (left + width > window.innerWidth - margin) left = event.clientX - width - 16
  if (top + height > window.innerHeight - margin) top = event.clientY - height - 16

  wordPopoverStyle.value = {
    left: `${Math.max(margin, left)}px`,
    top: `${Math.max(margin, top)}px`,
  }
}

function closeWordPopover() {
  selectedWord.value = null
  activeKeyword.value = null
}

function setMode(nextMode: AuthMode) {
  mode.value = nextMode
  message.value = ''
  loginComplete.value = false
  isSubmitting.value = false
  if (nextMode !== 'login') {
    loginPasswordVisible.value = false
    clearLoginCaptcha()
  }
}

function setMessage(type: 'success' | 'error', text: string) {
  messageType.value = type
  message.value = text
}

function clearLoginCaptcha() {
  loginCaptcha.value = null
  loginForm.captchaCode = ''
}

async function refreshLoginCaptcha() {
  try {
    isLoadingCaptcha.value = true
    loginCaptcha.value = await fetchCaptcha()
    loginForm.captchaCode = ''
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '图形验证码获取失败')
  } finally {
    isLoadingCaptcha.value = false
  }
}

function isCaptchaRequiredError(error: unknown) {
  return (
    (error instanceof AuthRequestError && error.code === 428) ||
    (error instanceof Error && error.message.includes('图形验证码'))
  )
}

function openAuth(action: PendingAction = null) {
  pendingAction.value = action
  loginComplete.value = false
  message.value = ''
  mode.value = 'login'
  loginPasswordVisible.value = false

  if (isAuthenticated.value && action) {
    runProtectedAction(action)
    return
  }

  isAuthOpen.value = true
}

function closeAuth() {
  isAuthOpen.value = false
  if (!loginComplete.value) pendingAction.value = null
}

async function handleLogout() {
  const token = getStoredSession()?.token
  try {
    if (token) await requestLogout(token)
    actionNotice.value = '已退出登录。'
  } catch {
    actionNotice.value = '本地登录状态已清除，服务端会话可能已过期。'
  } finally {
    clearSession()
    isAuthenticated.value = false
    currentUser.value = ''
    currentUserRole.value = ''
    currentUserCanUpload.value = false
    currentUserCanDownload.value = true
    pendingAction.value = null
    loginComplete.value = false
    isAuthOpen.value = false
    isUploadWorkspaceOpen.value = false
  }
}

function returnToPrevious() {
  isAuthOpen.value = false
  actionNotice.value = `登录成功，已显示账号状态。`
  pendingAction.value = null
}

function continueProtectedAction() {
  const action = pendingAction.value
  isAuthOpen.value = false
  pendingAction.value = null
  if (action) runProtectedAction(action)
}

function runProtectedAction(action: Exclude<PendingAction, null>) {
  if (action === 'download') {
    if (!currentUserCanDownload.value) {
      actionNotice.value = '当前账号已被禁止下载，请联系系统管理员调整权限。'
      return
    }
    actionNotice.value = '已通过认证：可按筛选条件发起受控下载。'
    return
  }

  openUploadWorkspace()
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function openMapVisualization() {
  router.push('/map-visualization')
}

function preloadMapVisualization() {
  void import('./MapVisualizationView.vue')
}

function preloadIcd11Sankey() {
  void import('./Icd11SankeyView.vue')
}

function preloadVisualRoute(route?: string) {
  if (route === '/map-visualization') preloadMapVisualization()
  if (route === '/icd11-sankey') preloadIcd11Sankey()
}

function handleVisualEntry(item: { target: string; route?: string }) {
  if (item.route) {
    router.push(item.route)
    return
  }

  scrollToSection(item.target)
}

async function openUploadWorkspace() {
  if (!isAuthenticated.value) {
    openAuth('operator')
    return
  }

  if (!canAccessDataEntry.value) {
    actionNotice.value = '当前账号没有数据录入权限，请联系系统管理员赋予管理人员角色。'
    return
  }

  await router.push('/data-entry')
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  selectedFileName.value = input.files?.[0]?.name ?? ''
}

function submitUploadDraft() {
  uploadNotice.value = selectedFileName.value
    ? '上传记录已进入待校验队列。'
    : '请先选择需要上传的数据文件。'
}

function validateEmail() {
  if (isLogin.value) {
    if (!loginForm.account.trim()) {
      setMessage('error', '请输入用户名或邮箱')
      return false
    }

    return true
  }

  if (!EMAIL_PATTERN.test(activeCodeEmail.value)) {
    setMessage('error', '请输入正确的邮箱地址')
    return false
  }

  return true
}

function validateUsername() {
  if (!isRegister.value) return true

  const username = registerForm.username.trim()
  if (username.length < 3 || username.length > 50) {
    setMessage('error', '用户名长度应为 3-50 位')
    return false
  }

  return true
}

function validatePassword() {
  if (isLogin.value) {
    if (!loginForm.password.trim()) {
      setMessage('error', '请输入密码')
      return false
    }

    return true
  }

  const password = isRegister.value ? registerForm.password : resetForm.password
  const confirmPassword = isRegister.value ? registerForm.confirmPassword : resetForm.confirmPassword

  if (password.trim().length < 6) {
    setMessage('error', '密码至少需要 6 位')
    return false
  }

  if (password !== confirmPassword) {
    setMessage('error', '两次输入的密码不一致')
    return false
  }

  return true
}

function validateCode() {
  const emailCode = isRegister.value ? registerForm.code : resetForm.code
  if (needsCode.value && emailCode.trim().length !== 6) {
    setMessage('error', '请输入 6 位邮箱验证码')
    return false
  }

  if (isLogin.value && loginCaptcha.value && loginForm.captchaCode.trim().length < 4) {
    setMessage('error', '请输入图形验证码')
    return false
  }

  return true
}

function startCountdown() {
  if (codeTimer) window.clearInterval(codeTimer)

  countdown.value = 60
  codeTimer = window.setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0 && codeTimer) {
      window.clearInterval(codeTimer)
      codeTimer = undefined
    }
  }, 1000)
}

async function handleSendCode() {
  if (!validateEmail()) return

  try {
    isSendingCode.value = true
    const result = await sendVerificationCode(activeCodeEmail.value, codeScene.value)
    setMessage(result.success ? 'success' : 'error', result.message || '验证码已发送')
    startCountdown()
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '验证码发送失败')
  } finally {
    isSendingCode.value = false
  }
}

async function handleSubmit() {
  if (!validateEmail() || !validateUsername() || !validatePassword() || !validateCode()) return

  try {
    isSubmitting.value = true
    if (isRegister.value) {
      const result = await register({
        username: registerForm.username,
        email: registerForm.email,
        password: registerForm.password,
        code: registerForm.code,
      })
      setMessage(result.success ? 'success' : 'error', result.message || '操作成功')
      return
    }

    if (isReset.value) {
      const result = await resetPassword({
        email: resetForm.email,
        newPassword: resetForm.password,
        code: resetForm.code,
      })
      setMessage(result.success ? 'success' : 'error', result.message || '操作成功')
      return
    }

    const result = await login({
      account: loginForm.account,
      password: loginForm.password,
      captchaId: loginCaptcha.value?.captchaId,
      captchaCode: loginCaptcha.value ? loginForm.captchaCode : undefined,
    })
    setMessage(result.success ? 'success' : 'error', result.message || '操作成功')

    if (result.success && result.data) {
      clearLoginCaptcha()
      loginPasswordVisible.value = false
      saveSession(result.data)
      isAuthenticated.value = true
      currentUser.value = result.data.user.username || result.data.user.email
      currentUserRole.value = result.data.user.role
      currentUserCanUpload.value = result.data.user.canUpload === true
      currentUserCanDownload.value = result.data.user.canDownload !== false
      loginComplete.value = true
      isAuthOpen.value = false
      const action = pendingAction.value
      pendingAction.value = null
      if (action) {
        runProtectedAction(action)
      } else {
        actionNotice.value = result.message || '登录成功，已显示账号入口。'
      }
    }
  } catch (error) {
    if (isCaptchaRequiredError(error)) {
      await refreshLoginCaptcha()
      setMessage('error', error instanceof Error ? error.message : '请完成图形验证码后重试')
      return
    }
    setMessage('error', error instanceof Error ? error.message : '请求失败，请稍后再试')
  } finally {
    isSubmitting.value = false
  }
}

async function hydrateSession() {
  const session = getStoredSession()
  if (!session) return
  isAuthenticated.value = true
  currentUser.value = session.user.username || session.user.email
  currentUserRole.value = session.user.role
  currentUserCanUpload.value = session.user.canUpload === true
  currentUserCanDownload.value = session.user.canDownload !== false
  try {
    const user = await fetchCurrentUser(session.token)
    updateStoredUser(user)
    currentUser.value = user.username || user.email
    currentUserRole.value = user.role
    currentUserCanUpload.value = user.canUpload === true
    currentUserCanDownload.value = user.canDownload !== false
  } catch {
    clearSession()
    isAuthenticated.value = false
    currentUser.value = ''
    currentUserRole.value = ''
    currentUserCanUpload.value = false
    currentUserCanDownload.value = true
  }
}

onMounted(() => {
  void hydrateSession()
  void loadHomeData()
  overviewTimer = window.setInterval(() => {
    if (isOverviewPaused.value) return
    const length = homeData.value.metrics.length || 1
    currentOverviewIndex.value = (currentOverviewIndex.value + 1) % length
  }, 3600)
})

onBeforeUnmount(() => {
  if (codeTimer) window.clearInterval(codeTimer)
  if (overviewTimer) window.clearInterval(overviewTimer)
})
</script>

<template>
  <main class="site-shell">
    <header class="site-header">
      <a class="brand" href="#top" aria-label="污水信息因子数据库首页">
        <span class="brand-logo" aria-hidden="true">
          <span class="brand-drop"></span>
          <span class="brand-bars"><i></i><i></i><i></i></span>
          <span class="brand-line"><i></i><i></i></span>
        </span>
        <span>
          <strong>污水信息因子数据库</strong>
          <small>Wastewater Biomarker Evidence</small>
        </span>
      </a>

      <nav class="main-nav" aria-label="主导航">
        <a href="#about">数据说明</a>
        <RouterLink
          to="/map-visualization"
          @mouseenter="preloadMapVisualization"
          @focus="preloadMapVisualization"
        >
          地图可视化
        </RouterLink>
        <RouterLink
          to="/icd11-sankey"
          @mouseenter="preloadIcd11Sankey"
          @focus="preloadIcd11Sankey"
        >
          ICD11 桑基图
        </RouterLink>
        <RouterLink v-if="canAccessDataEntry" to="/data-entry">数据录入</RouterLink>
        <a href="#visual">图谱分析</a>
        <a href="#methods">方法与质量</a>
        <a href="#news">更新</a>
      </nav>

      <div class="header-tools">
        <label class="search-box">
          <span aria-hidden="true">⌕</span>
          <input
            v-model="searchQuery"
            type="search"
            placeholder="搜索因子、类别或文献"
            @focus="isSearchOpen = true"
            @blur="isSearchOpen = false"
          />
        </label>
        <div v-if="isSearchOpen && searchQuery" class="search-results">
          <button v-for="item in searchResults" :key="item.title" type="button">
            <strong>{{ item.title }}</strong>
            <span>{{ item.meta }}</span>
          </button>
          <p v-if="!searchResults.length">暂无匹配结果</p>
        </div>
        <div v-if="isAuthenticated" class="user-tools">
          <span class="account-pill">
            <span>已登录</span>
            <strong>{{ currentUser }}</strong>
          </span>
          <RouterLink v-if="canAccessDataEntry" class="upload-entry" to="/data-entry">
            数据录入
          </RouterLink>
          <button class="logout-button" type="button" @click="handleLogout">退出</button>
        </div>
        <button v-else class="login-button" type="button" @click="openAuth()">登录</button>
      </div>
    </header>

    <section id="top" class="hero-section" aria-labelledby="heroTitle">
      <div class="hero-copy">
        <p class="section-kicker">WBE DATA RESOURCE</p>
        <h1 id="heroTitle">面向污水流行病学的信息因子知识平台</h1>
        <p>
          整合 WBE 文献、目标物质、地区覆盖和生物标记物关系，支持数据检索、证据追踪和可视化分析。
        </p>
        <div class="hero-actions">
          <button type="button" class="primary-action" @click="scrollToSection('about')">
            查看数据说明
          </button>
          <button
            type="button"
            class="secondary-action"
            @mouseenter="preloadMapVisualization"
            @focus="preloadMapVisualization"
            @click="scrollToSection('visual-entry')"
          >
            探索可视化
          </button>
        </div>
        <p v-if="actionNotice" class="action-notice">{{ actionNotice }}</p>
      </div>

      <div class="insight-board" aria-label="首页数据横幅">
        <div class="board-head">
          <span>数据库概览</span>
          <strong>{{ activeMetric.label }}</strong>
        </div>
        <div class="metric-summary-grid">
          <button
            v-for="(metric, index) in homeData.metrics"
            :key="metric.key"
            type="button"
            class="metric-card"
            :class="[metric.tone, { active: index === currentOverviewIndex }]"
            @mouseenter="focusOverview(index)"
            @mouseleave="releaseOverview"
            @focus="focusOverview(index)"
            @blur="releaseOverview"
          >
            <span>{{ metric.label }}</span>
            <strong
              >{{ metric.value }}<small>{{ metric.unit }}</small></strong
            >
            <em>{{ metric.detail }}</em>
            <i>{{ metric.trend }}</i>
          </button>
        </div>
        <div class="overview-focus">
          <span>当前聚焦</span>
          <strong>{{ activeMetric.value }}{{ activeMetric.unit }}</strong>
          <p>{{ overviewFocusCopy }}</p>
        </div>
        <div class="board-foot">
          <span>开放检索，受控下载。</span>
          <button type="button" @click="scrollToSection('about')">查看说明</button>
        </div>
      </div>
    </section>

    <section id="visual-entry" class="glance-section" aria-labelledby="glanceTitle">
      <div class="glance-inner">
        <div class="glance-heading">
          <div class="glance-title">
          <p class="section-kicker">VISUAL ENTRY</p>
            <h2 id="glanceTitle">可视化与数据入口</h2>
          </div>
          <p class="glance-lead">空间分布、ICD11 桑基图、标记物词云、类别走势与文献证据集中检索。</p>
        </div>
        <div class="glance-grid">
          <button
            v-for="item in visualEntryItems"
            :key="item.title"
            type="button"
            class="glance-item"
            @mouseenter="preloadVisualRoute(item.route)"
            @focus="preloadVisualRoute(item.route)"
            @click="handleVisualEntry(item)"
          >
            <span class="glance-icon" :class="item.icon" aria-hidden="true"></span>
            <span class="glance-copy">
              <strong>{{ item.title }}</strong>
              <em>{{ item.detail }}</em>
            </span>
            <span class="glance-value">{{ item.value }}</span>
          </button>
        </div>
      </div>
    </section>

    <section id="about" class="about-band" aria-label="数据说明">
      <div class="data-dossier">
        <div class="dossier-header">
          <div class="about-intro">
            <p class="section-kicker">ABOUT DATA</p>
            <h2>数据说明</h2>
            <p>
              面向污水流行病学研究，按目标物质、地区覆盖、研究年份和来源文献组织字段，
              支持开放检索、证据追踪和受控下载。
            </p>
          </div>
          <div class="dossier-guide" aria-label="数据说明导览">
            <article>
              <span>可检索内容</span>
              <strong>查字段与对象</strong>
              <p>访客可检索目标物质、标记物、地区覆盖和文献证据字段。</p>
            </article>
            <article>
              <span>使用边界</span>
              <strong>分级开放使用</strong>
              <p>检索开放，完整下载需登录；数据录入和维护仅限操作员。</p>
            </article>
            <article>
              <span>证据追踪</span>
              <strong>来源与版本可查</strong>
              <p>保留 DOI、年份、期刊、地区覆盖和字段版本用于复核。</p>
            </article>
          </div>
        </div>

        <div class="dossier-body">
          <article class="metadata-panel field-panel">
            <header>
              <span>字段结构</span>
              <strong>开放检索字段</strong>
            </header>
            <div class="field-table" role="table" aria-label="开放检索字段">
              <div class="field-table-head" role="row">
                <span role="columnheader">对象</span>
                <span role="columnheader">覆盖说明</span>
                <span role="columnheader">开放字段</span>
              </div>
              <article v-for="item in homeData.catalogItems" :key="item.title">
                <strong>{{ item.title }}</strong>
                <span>{{ item.detail }}</span>
                <em>{{ item.meta }}</em>
              </article>
            </div>
          </article>

          <article class="metadata-panel access-panel">
            <header>
              <span>权限边界</span>
              <strong>检索开放，下载受控</strong>
            </header>
            <div class="permission-table" aria-label="权限边界">
              <article v-for="item in homeData.accessRules" :key="item.title">
                <span>{{ item.state }}</span>
                <div>
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.detail }}</p>
                </div>
              </article>
            </div>
            <div class="permission-actions">
              <button type="button" @click="openAuth('download')">下载申请</button>
              <button v-if="canAccessDataEntry" type="button" @click="openUploadWorkspace">
                数据录入
              </button>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section id="visual" class="visual-section" aria-labelledby="visualTitle">
      <div class="section-heading">
        <p class="section-kicker">VISUAL EXPLORER</p>
        <h2 id="visualTitle">因子词云与目标物质类别研究图谱。</h2>
      </div>

      <div class="visual-grid">
        <article class="word-cloud-panel">
          <header>
            <span>因子词云</span>
            <strong>真实因子词条</strong>
          </header>
          <div class="word-cloud-viewport" :class="{ paused: activeKeyword }" aria-label="高频因子词云">
            <div
              v-for="row in wordCloudRows"
              :key="row.key"
              class="word-cloud-row"
              :class="{ reverse: row.reverse }"
              :style="{ '--marquee-duration': row.duration }"
            >
              <div class="word-cloud-trackline">
                <button
                  v-for="(item, index) in row.items"
                  :key="`${row.key}-${item.name}-${index}`"
                  type="button"
                  class="word-chip"
                  :class="{
                    active: item.name === activeKeyword,
                    dimmed: !!activeKeyword && item.name !== activeKeyword,
                  }"
                  :style="{ '--word-color': item.tone, '--word-size': `${item.size}px`, '--float-delay': item.delay }"
                  :title="`${item.category} · ${item.docs ?? item.value} 篇文献 · ${item.rows ?? 0} 行`"
                  @pointerenter="focusKeyword(item.name)"
                  @pointerleave="releaseKeyword"
                  @mouseenter="focusKeyword(item.name)"
                  @mouseleave="releaseKeyword"
                  @click="openWordPopover(item, $event)"
                  @focus="focusKeyword(item.name)"
                  @blur="releaseKeyword"
                >
                  <strong>{{ item.name }}</strong>
                  <small>{{ item.docs ?? item.value }} 篇</small>
                </button>
              </div>
            </div>
          </div>
          <div class="word-inspector">
            <span>{{ activeWord ? '当前词条' : '词云概览' }}</span>
            <strong>{{ activeWord?.name ?? '高频生物标记物' }}</strong>
            <p>
              {{
                activeWord
                  ? `${activeWord.category} · ${activeWord.docs ?? activeWord.value} 篇文献 · ${activeWord.rows ?? 0} 行 · ${activeWord.countries ?? 0} / ${activeWord.regions ?? 0} 国家/地区`
                  : `${formatNumber(wordCloudItems.length)} 个词条 · DOI 去重文献数、数据行与地区覆盖同步展示`
              }}
            </p>
          </div>
        </article>

        <article class="biomarker-chart-panel">
          <header class="biomarker-panel-head">
            <span>目标物质类别研究数</span>
            <strong>累计研究数横向柱状图</strong>
            <em>{{ formatNumber(biomarkerTotalFrequency) }} 次 DOI 去重研究 · {{ biomarkerFrequencyItems.length }} 类目标物质</em>
          </header>

          <div class="biomarker-chart-layout">
            <section class="biomarker-bar-section" aria-label="目标物质类别 DOI 去重累计研究数">
              <div class="frequency-chart-shell">
                <div class="frequency-chart-toolbar" aria-label="目标物质类别图表控制">
                  <label class="biomarker-filter-control" aria-label="目标范围筛选">
                    <span>范围</span>
                    <select
                      :value="selectedTargetCategory"
                      :title="selectedTargetCategoryOption.name"
                      @change="selectTargetCategory"
                    >
                      <option
                        v-for="option in targetCategoryOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ formatTargetCategoryOption(option) }}
                      </option>
                    </select>
                  </label>
                  <div class="biomarker-sort-control" role="group" aria-label="排序方式">
                    <span>排序</span>
                    <button
                      v-for="option in BIOMARKER_SORT_OPTIONS"
                      :key="option.mode"
                      type="button"
                      :class="{ active: biomarkerSortMode === option.mode }"
                      :aria-pressed="biomarkerSortMode === option.mode"
                      @click="biomarkerSortMode = option.mode"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>
                <div class="frequency-x-axis" aria-hidden="true">
                  <span v-for="tick in biomarkerFrequencyAxisTicks" :key="tick">
                    {{ formatNumber(tick) }}
                  </span>
                </div>
                <div class="frequency-plot-scroll">
                  <div class="frequency-plot">
                    <button
                      v-for="item in biomarkerFrequencyItems"
                      :key="item.name"
                      type="button"
                      class="frequency-bar"
                      :class="{ active: item.name === selectedBiomarker?.name }"
                      :style="{ '--bar-width': item.barWidth, '--bar-color': item.tone }"
                      :aria-pressed="item.name === selectedBiomarker?.name"
                      :aria-label="`${item.name}，DOI 去重累计研究数 ${item.frequency}`"
                      @click="selectBiomarker(item.name)"
                    >
                      <strong>{{ item.name }}</strong>
                      <span><i></i></span>
                      <em>{{ formatNumber(item.frequency) }}</em>
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section class="biomarker-detail-section" aria-live="polite">
              <header>
                <span>当前查看</span>
                <strong>{{ selectedBiomarker?.name ?? '暂无数据' }}</strong>
                <em>DOI 去重研究数 {{ formatNumber(selectedBiomarker?.frequency) }} · {{ selectedBiomarker?.category ?? '未分类' }}</em>
              </header>

              <div class="line-stat-grid">
                <article>
                  <span>累计研究数</span>
                  <strong>{{ formatNumber(selectedBiomarker?.frequency) }}</strong>
                </article>
                <article>
                  <span>去重文献</span>
                  <strong>{{ formatNumber(selectedBiomarker?.docs) }}</strong>
                </article>
                <article>
                  <span>数据行</span>
                  <strong>{{ formatNumber(selectedBiomarker?.rows) }}</strong>
                </article>
              </div>

              <div
                v-if="selectedCategoryBiomarkerItems.length"
                :key="selectedBiomarker?.name"
                class="detail-bar-shell"
              >
                <div class="detail-chart-head">
                  <div>
                    <span>类别下生物标记物研究数</span>
                    <em>{{ selectedSubclass?.name ?? DEFAULT_SUBCLASS }} · {{ selectedCategoryBiomarkerItems.length }} 项</em>
                  </div>
                  <label class="subclass-filter">
                    <span>目标物质子类</span>
                    <select :value="selectedSubclass?.name ?? ''" @change="selectSubclass">
                      <option
                        v-for="option in selectedBiomarkerSubclasses"
                        :key="option.name"
                        :value="option.name"
                      >
                        {{ option.name }}（{{ formatNumber(option.frequency) }}）
                      </option>
                    </select>
                  </label>
                </div>
                <div class="detail-column-scroll" role="img" :aria-label="`${selectedBiomarker?.name ?? '目标物质类别'}下${selectedSubclass?.name ?? DEFAULT_SUBCLASS}子类生物标记物 DOI 去重累计研究数`">
                  <div class="detail-column-plot" :style="{ '--detail-plot-width': detailColumnPlotWidth }">
                    <article
                      v-for="item in selectedCategoryBiomarkerItems"
                      :key="item.name"
                      class="detail-column-bar"
                      :style="{ '--detail-bar-height': item.barHeight, '--detail-color': item.tone }"
                      :aria-label="`${item.name}，DOI 去重研究数 ${formatNumber(item.frequency)}`"
                    >
                      <strong>{{ formatNumber(item.frequency) }}</strong>
                      <div>
                        <i></i>
                      </div>
                      <span :title="item.name">{{ shortBiomarkerName(item.name) }}</span>
                    </article>
                  </div>
                </div>
              </div>
              <p v-else class="line-empty">暂无标记物数据</p>
            </section>
          </div>
        </article>
      </div>
    </section>

    <section
      v-if="isUploadWorkspaceOpen"
      id="upload"
      class="upload-workspace"
      aria-labelledby="uploadTitle"
    >
      <div class="section-heading">
        <p class="section-kicker">OPERATOR WORKSPACE</p>
        <h2 id="uploadTitle">数据上传与批量校验。</h2>
      </div>

      <div class="upload-layout">
        <article class="upload-panel">
          <header>
            <span>上传批次</span>
            <strong>新增或修订数据</strong>
          </header>
          <form class="upload-form" @submit.prevent="submitUploadDraft">
            <label>
              <span>数据类型</span>
              <select v-model="uploadForm.datasetType">
                <option value="factor">因子词典</option>
                <option value="concentration">浓度与负荷记录</option>
                <option value="literature">文献元数据</option>
                <option value="method">方法与质量字段</option>
              </select>
            </label>
            <label>
              <span>批次名称</span>
              <input v-model.trim="uploadForm.batchName" type="text" placeholder="例如 2026-Q2 修订" />
            </label>
            <label class="file-drop">
              <span>数据文件</span>
              <input type="file" accept=".csv,.xlsx,.xls" @change="handleFileChange" />
              <strong>{{ selectedFileName || '选择 CSV 或 Excel 文件' }}</strong>
            </label>
            <label>
              <span>版本说明</span>
              <textarea
                v-model.trim="uploadForm.notes"
                rows="4"
                placeholder="记录数据来源、字段变更或审核备注"
              ></textarea>
            </label>
            <button type="submit" class="auth-submit">提交校验</button>
            <p v-if="uploadNotice" class="form-message success">{{ uploadNotice }}</p>
          </form>
        </article>

        <aside class="review-panel">
          <header>
            <span>校验队列</span>
            <strong>待处理状态</strong>
          </header>
          <div class="review-steps">
            <article>
              <span>01</span>
              <strong>字段匹配</strong>
              <p>校验必填字段、单位和类别编码。</p>
            </article>
            <article>
              <span>02</span>
              <strong>重复识别</strong>
              <p>比对目标物质、文献 DOI 和采样时间。</p>
            </article>
            <article>
              <span>03</span>
              <strong>版本发布</strong>
              <p>审核通过后写入数据库和更新日志。</p>
            </article>
          </div>
        </aside>
      </div>
    </section>

    <section id="methods" class="updates-section" aria-labelledby="updatesTitle">
      <div class="section-heading">
        <p class="section-kicker">METHODS & QUALITY</p>
        <h2 id="updatesTitle">方法说明、字段版本和数据更新保持可追溯。</h2>
      </div>
      <div class="update-list">
        <article v-for="item in homeData.activity" :key="item.title">
          <time>{{ item.date }}</time>
          <div>
            <h3>{{ item.title }}</h3>
            <p>{{ item.detail }}</p>
          </div>
        </article>
      </div>
    </section>

    <footer id="news" class="site-footer">
      <div class="footer-brand">
        <span class="brand-logo small" aria-hidden="true">
          <span class="brand-drop"></span>
          <span class="brand-bars"><i></i><i></i><i></i></span>
          <span class="brand-line"><i></i><i></i></span>
        </span>
        <span>
          <strong>污水信息因子数据库</strong>
          <p>服务于污水流行病学数据整合、公共健康研究和证据型决策。</p>
        </span>
      </div>
      <nav aria-label="页脚导航">
        <a href="#about">数据说明</a>
        <a href="#visual">图谱分析</a>
        <a href="#methods">方法与质量</a>
        <button type="button" @click="openAuth('download')">下载申请</button>
      </nav>
      <small>© 2026 WBE Information Platform · 字段版本与数据更新保持可追溯</small>
    </footer>

    <div v-if="selectedWord" class="word-popover-layer" @click.self="closeWordPopover">
      <div
        class="word-popover"
        :style="wordPopoverStyle"
        role="dialog"
        aria-modal="false"
        aria-labelledby="wordPopoverTitle"
        @keydown.esc="closeWordPopover"
      >
        <header class="word-popover-head">
          <span id="wordPopoverTitle">生物标记物详情</span>
          <button type="button" aria-label="关闭词条详情" @click="closeWordPopover">×</button>
        </header>
        <strong class="word-popover-name" :style="{ color: selectedWord.tone }">
          {{ selectedWord.name }}
        </strong>
        <div class="word-popover-metrics">
          <article>
            <span>文献数</span>
            <strong>{{ formatNumber(selectedWord.docs ?? selectedWord.value) }}</strong>
          </article>
          <article>
            <span>数据行</span>
            <strong>{{ formatNumber(selectedWord.rows) }}</strong>
          </article>
          <article>
            <span>国家</span>
            <strong>{{ formatNumber(selectedWord.countries) }}</strong>
          </article>
          <article>
            <span>地区</span>
            <strong>{{ formatNumber(selectedWord.regions) }}</strong>
          </article>
        </div>
        <section class="word-popover-section">
          <span>归属</span>
          <div>
            <em v-for="tag in belongingTags(selectedWord)" :key="tag">{{ tag }}</em>
          </div>
        </section>
        <section class="word-popover-section">
          <span>细分类型</span>
          <div>
            <em v-for="tag in detailTags(selectedWord.subcategories)" :key="tag">{{ tag }}</em>
          </div>
        </section>
        <section class="word-popover-section">
          <span>名称归并</span>
          <div>
            <em v-for="tag in detailTags(selectedWord.aliases)" :key="tag">{{ tag }}</em>
          </div>
        </section>
      </div>
    </div>

    <div
      v-if="isAuthOpen"
      class="auth-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="authTitle"
    >
      <section class="auth-card">
        <button class="close-button" type="button" aria-label="关闭登录窗口" @click="closeAuth">
          ×
        </button>
        <header class="auth-header">
          <span class="auth-logo" aria-hidden="true">
            <span class="auth-logo-drop"></span>
            <span class="auth-logo-bars"><i></i><i></i><i></i></span>
          </span>
          <h2 id="authTitle">{{ pageTitle }}</h2>
          <p>{{ authLead }}</p>
        </header>

        <form class="auth-form" @submit.prevent="handleSubmit">
          <div v-if="!isReset" class="auth-mode-tabs" role="tablist" aria-label="账号操作">
            <button
              type="button"
              role="tab"
              :aria-selected="isLogin"
              :class="{ active: isLogin }"
              @click="setMode('login')"
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="isRegister"
              :class="{ active: isRegister }"
              @click="setMode('register')"
            >
              注册
            </button>
          </div>

          <Transition name="auth-panel" mode="out-in">
            <div v-if="isLogin" key="login" class="auth-fields">
              <label>
                <span>用户名 / 邮箱</span>
                <input
                  v-model.trim="loginForm.account"
                  type="text"
                  autocomplete="email"
                  placeholder="用户名或 name@example.com"
                />
              </label>

              <label>
                <span>密码</span>
                <div class="password-field">
                  <input
                    v-model.trim="loginForm.password"
                    :type="loginPasswordVisible ? 'text' : 'password'"
                    autocomplete="current-password"
                    placeholder="至少 6 位"
                  />
                  <button
                    type="button"
                    :aria-label="loginPasswordVisible ? '隐藏密码' : '显示密码'"
                    @click="loginPasswordVisible = !loginPasswordVisible"
                  >
                    <span class="eye-icon" :class="{ visible: loginPasswordVisible }" aria-hidden="true">
                      <i></i>
                    </span>
                  </button>
                </div>
              </label>

              <label v-if="loginCaptcha" class="captcha-field">
                <span>图形验证码</span>
                <div class="captcha-row">
                  <input
                    v-model.trim="loginForm.captchaCode"
                    type="text"
                    inputmode="numeric"
                    maxlength="4"
                    placeholder="输入验证码"
                  />
                  <img
                    :src="`data:image/png;base64,${loginCaptcha.imageBase64}`"
                    alt="图形验证码"
                  />
                  <button type="button" :disabled="isLoadingCaptcha" @click="refreshLoginCaptcha">
                    {{ isLoadingCaptcha ? '刷新中' : '刷新' }}
                  </button>
                </div>
              </label>
            </div>

            <div v-else-if="isRegister" key="register" class="auth-fields">
              <label>
                <span>邮箱</span>
                <input
                  v-model.trim="registerForm.email"
                  type="email"
                  autocomplete="email"
                  placeholder="name@example.com"
                />
              </label>

              <label>
                <span>用户名</span>
                <input
                  v-model.trim="registerForm.username"
                  type="text"
                  autocomplete="username"
                  placeholder="3-50 位用户名"
                />
              </label>

              <label>
                <span>密码</span>
                <input
                  v-model.trim="registerForm.password"
                  type="password"
                  autocomplete="new-password"
                  placeholder="至少 6 位"
                />
              </label>

              <label>
                <span>确认密码</span>
                <input
                  v-model.trim="registerForm.confirmPassword"
                  type="password"
                  autocomplete="new-password"
                  placeholder="再次输入密码"
                />
              </label>

              <label>
                <span>邮箱验证码</span>
                <div class="split-row code-row">
                  <input
                    v-model.trim="registerForm.code"
                    type="text"
                    inputmode="numeric"
                    maxlength="6"
                    placeholder="6 位验证码"
                  />
                  <button type="button" :disabled="!canSendCode" @click="handleSendCode">
                    {{ countdown > 0 ? `${countdown}s` : isSendingCode ? '发送中' : '发送验证码' }}
                  </button>
                </div>
              </label>
            </div>

            <div v-else key="reset" class="auth-fields">
              <label>
                <span>邮箱</span>
                <input
                  v-model.trim="resetForm.email"
                  type="email"
                  autocomplete="email"
                  placeholder="name@example.com"
                />
              </label>

              <label>
                <span>新密码</span>
                <input
                  v-model.trim="resetForm.password"
                  type="password"
                  autocomplete="new-password"
                  placeholder="至少 6 位"
                />
              </label>

              <label>
                <span>确认密码</span>
                <input
                  v-model.trim="resetForm.confirmPassword"
                  type="password"
                  autocomplete="new-password"
                  placeholder="再次输入密码"
                />
              </label>

              <label>
                <span>邮箱验证码</span>
                <div class="split-row code-row">
                  <input
                    v-model.trim="resetForm.code"
                    type="text"
                    inputmode="numeric"
                    maxlength="6"
                    placeholder="6 位验证码"
                  />
                  <button type="button" :disabled="!canSendCode" @click="handleSendCode">
                    {{ countdown > 0 ? `${countdown}s` : isSendingCode ? '发送中' : '发送验证码' }}
                  </button>
                </div>
              </label>
            </div>
          </Transition>

          <p v-if="message" class="form-message" :class="messageType">{{ message }}</p>

          <button
            v-if="!loginComplete"
            type="submit"
            class="auth-submit"
            :disabled="isSubmitting"
            :aria-busy="isSubmitting"
          >
            <span>{{ submitText }}</span>
            <span v-if="isSubmitting" class="submit-loader" aria-hidden="true">
              <i></i><i></i><i></i>
            </span>
          </button>

          <div v-else class="post-login-actions">
            <button type="button" class="auth-submit" @click="returnToPrevious">返回首页</button>
            <button
              v-if="pendingAction"
              type="button"
              class="ghost-action"
              @click="continueProtectedAction"
            >
              {{ pendingAction === 'download' ? '继续下载' : '进入数据上传' }}
            </button>
          </div>

          <div v-if="!loginComplete" class="action-links">
            <button v-if="!isReset" type="button" @click="setMode('reset')">忘记密码</button>
            <button v-else type="button" @click="setMode('login')">返回登录</button>
          </div>
        </form>
      </section>
    </div>
  </main>
</template>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(html) {
  scroll-behavior: smooth;
}

:global(body) {
  min-width: 320px;
  margin: 0;
  color: #172b3a;
  background: #f4f8fb;
  font-family: Inter, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;
}

button,
input,
select,
textarea {
  font: inherit;
}

button,
a {
  -webkit-tap-highlight-color: transparent;
}

.site-shell {
  min-height: 100vh;
  max-width: 100%;
  overflow-x: hidden;
  overflow-x: clip;
  background:
    linear-gradient(180deg, rgba(238, 246, 250, 0.96), rgba(255, 255, 255, 0.96) 42%),
    radial-gradient(circle at 10% 5%, rgba(17, 116, 158, 0.11), transparent 30%),
    radial-gradient(circle at 90% 12%, rgba(14, 143, 119, 0.1), transparent 24%);
}

#top,
#visual-entry,
#about,
#visual,
#upload,
#methods,
#news {
  scroll-margin-top: 92px;
}

.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: auto minmax(360px, 1fr) auto;
  align-items: center;
  gap: 24px;
  padding: 14px clamp(20px, 5vw, 70px);
  border-bottom: 1px solid rgba(96, 124, 143, 0.26);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 10px 34px rgba(21, 52, 72, 0.08);
  backdrop-filter: blur(18px);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: #132e3f;
  text-decoration: none;
}

.brand-logo {
  position: relative;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  display: block;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.76);
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(15, 101, 145, 0.94), rgba(14, 143, 119, 0.92)), #0f6591;
  box-shadow: 0 14px 30px rgba(15, 101, 145, 0.2);
}

.brand-logo.small {
  width: 38px;
  height: 38px;
}

.brand-drop {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 19px;
  height: 19px;
  border: 2px solid rgba(255, 255, 255, 0.92);
  border-radius: 60% 60% 62% 10%;
  background: rgba(255, 255, 255, 0.13);
  transform: rotate(-45deg);
}

.brand-bars {
  position: absolute;
  right: 8px;
  bottom: 9px;
  height: 18px;
  display: inline-flex;
  align-items: end;
  gap: 3px;
}

.brand-bars i {
  width: 4px;
  border-radius: 999px 999px 2px 2px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1);
}

.brand-bars i:nth-child(1) {
  height: 8px;
}

.brand-bars i:nth-child(2) {
  height: 14px;
}

.brand-bars i:nth-child(3) {
  height: 11px;
}

.brand-line {
  position: absolute;
  right: 7px;
  bottom: 26px;
  width: 20px;
  height: 10px;
  border-top: 2px solid rgba(198, 237, 232, 0.95);
  border-right: 2px solid rgba(198, 237, 232, 0.95);
  transform: skewX(-18deg) rotate(-9deg);
}

.brand-line i {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ffffff;
}

.brand-line i:first-child {
  top: -4px;
  left: -2px;
}

.brand-line i:last-child {
  right: -4px;
  bottom: -3px;
}

.brand-logo.small .brand-drop {
  top: 7px;
  left: 7px;
  width: 16px;
  height: 16px;
}

.brand-logo.small .brand-bars {
  right: 7px;
  bottom: 8px;
  height: 16px;
}

.brand-logo.small .brand-line {
  right: 6px;
  bottom: 23px;
  width: 17px;
}

.brand strong,
.site-footer strong {
  display: block;
  font-size: 17px;
  line-height: 1.2;
}

.brand small {
  display: block;
  margin-top: 3px;
  color: #697d8a;
  font-size: 11px;
  letter-spacing: 0;
  text-transform: uppercase;
}

.main-nav {
  display: flex;
  justify-content: center;
  gap: clamp(14px, 2vw, 30px);
}

.main-nav a,
.site-footer a,
.site-footer button {
  color: #385466;
  text-decoration: none;
  font-size: 14px;
  font-weight: 800;
}

.main-nav a {
  position: relative;
  padding: 10px 0;
}

.main-nav a::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 5px;
  height: 2px;
  background: #0e8f77;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.2s ease;
}

.main-nav a:hover::after {
  transform: scaleX(1);
}

.header-tools {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-box {
  width: min(280px, 24vw);
  min-width: 210px;
  height: 42px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  border: 1px solid rgba(95, 124, 143, 0.22);
  border-radius: 8px;
  background: #ffffff;
}

.search-box span {
  color: #6f8593;
  text-align: center;
  font-size: 20px;
  line-height: 1;
}

.search-box input {
  min-width: 0;
  border: 0;
  outline: 0;
  color: #182f40;
  background: transparent;
  font-size: 14px;
}

.search-results {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  z-index: 10;
  width: min(360px, 84vw);
  padding: 8px;
  border: 1px solid rgba(102, 133, 153, 0.2);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 20px 50px rgba(32, 58, 78, 0.16);
}

.search-results button,
.factor-list button {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.search-results button {
  display: grid;
  gap: 4px;
  padding: 10px;
  border-radius: 6px;
}

.search-results button:hover {
  background: #eef6f7;
}

.search-results strong {
  color: #173247;
  font-size: 14px;
}

.search-results span,
.search-results p {
  margin: 0;
  color: #6e8391;
  font-size: 12px;
}

.login-button,
.upload-entry,
.logout-button,
.primary-action,
.secondary-action,
.auth-submit,
.ghost-action {
  border: 0;
  cursor: pointer;
  font-weight: 900;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}

.login-button {
  max-width: 220px;
  height: 42px;
  overflow: hidden;
  padding: 0 16px;
  border-radius: 8px;
  color: #ffffff;
  background: #173247;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.account-pill {
  max-width: 210px;
  min-height: 42px;
  display: grid;
  justify-content: start;
  gap: 2px;
  overflow: hidden;
  padding: 6px 12px;
  border: 1px solid rgba(95, 124, 143, 0.2);
  border-radius: 8px;
  background: #ffffff;
}

.account-pill span {
  color: #6a7f8d;
  font-size: 11px;
  font-weight: 900;
}

.account-pill strong {
  overflow: hidden;
  color: #173247;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-entry {
  display: inline-flex;
  align-items: center;
  height: 42px;
  padding: 0 14px;
  border-radius: 8px;
  color: #ffffff;
  background: #0e8f77;
  text-decoration: none;
  white-space: nowrap;
}

.logout-button {
  height: 42px;
  padding: 0 14px;
  border: 1px solid rgba(95, 124, 143, 0.24);
  border-radius: 8px;
  color: #173247;
  background: #ffffff;
  white-space: nowrap;
}

.login-button:hover,
.upload-entry:hover,
.logout-button:hover,
.primary-action:hover,
.secondary-action:hover,
.auth-submit:hover,
.ghost-action:hover {
  transform: translateY(-1px);
}

.hero-section {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-columns: minmax(320px, 0.86fr) minmax(520px, 1.14fr);
  align-items: center;
  gap: clamp(32px, 6vw, 76px);
  min-height: clamp(560px, calc(78vh - 74px), 700px);
  padding: clamp(28px, 3.8vw, 50px) clamp(20px, 5vw, 70px) clamp(24px, 3vw, 38px);
  border-bottom: 1px solid rgba(104, 135, 154, 0.24);
  overflow: hidden;
}

.hero-section::before {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(90deg, rgba(244, 248, 251, 0.96) 0%, rgba(244, 248, 251, 0.78) 44%, rgba(244, 248, 251, 0.54) 100%),
    url('/home-overview-bg.png') right center / min(980px, 62vw) auto no-repeat;
  content: '';
  opacity: 0.92;
  pointer-events: none;
}

.hero-copy {
  position: relative;
  z-index: 1;
  max-width: 660px;
}

.section-kicker {
  margin: 0 0 12px;
  color: #0e8f77;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.hero-copy h1 {
  margin: 0;
  color: #102a3b;
  font-size: clamp(36px, 4.8vw, 62px);
  line-height: 1.08;
  letter-spacing: 0;
}

.hero-copy > p:not(.section-kicker, .action-notice) {
  max-width: 590px;
  margin: 18px 0 0;
  color: #506a7c;
  font-size: 17px;
  line-height: 1.75;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}

.primary-action,
.secondary-action {
  height: 46px;
  padding: 0 20px;
  border-radius: 8px;
}

.primary-action {
  color: #ffffff;
  background: #0f6591;
  box-shadow: 0 16px 34px rgba(15, 101, 145, 0.24);
}

.secondary-action,
.ghost-action {
  border: 1px solid rgba(32, 68, 90, 0.2);
  color: #173247;
  background: #ffffff;
}

.action-notice {
  width: fit-content;
  max-width: 100%;
  margin: 18px 0 0;
  padding: 10px 12px;
  border: 1px solid rgba(14, 143, 119, 0.22);
  border-radius: 8px;
  color: #0b6f5f;
  background: rgba(235, 249, 245, 0.88);
  font-size: 13px;
  line-height: 1.6;
}

.insight-board {
  position: relative;
  z-index: 1;
  min-height: 398px;
  display: grid;
  align-content: stretch;
  overflow: hidden;
  border: 1px solid rgba(109, 139, 158, 0.22);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.86), rgba(244, 250, 251, 0.78)),
    #ffffff;
  backdrop-filter: blur(2px);
  box-shadow: 0 18px 48px rgba(37, 73, 96, 0.12);
}

.board-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 22px 22px 0;
}

.board-head span {
  color: #657b89;
  font-size: 14px;
  font-weight: 800;
}

.board-head strong {
  color: #183347;
  font-size: 20px;
  white-space: nowrap;
}

.metric-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 16px;
}

.metric-card {
  min-height: 104px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px 12px;
  padding: 15px 16px;
  border: 1px solid rgba(118, 147, 164, 0.18);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(2px);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease,
    background 0.2s ease;
}

.metric-card span,
.metric-card em,
.metric-card i {
  color: #607684;
  font-style: normal;
}

.metric-card span {
  grid-column: 1;
  font-size: 15px;
  font-weight: 900;
  white-space: nowrap;
}

.metric-card strong {
  grid-row: 1 / span 2;
  grid-column: 2;
  color: #112d40;
  font-size: clamp(26px, 2.8vw, 36px);
  line-height: 1;
  text-align: right;
  white-space: nowrap;
}

.metric-card small {
  margin-left: 4px;
  color: #536c7d;
  font-size: 14px;
}

.metric-card em {
  grid-column: 1;
  display: -webkit-box;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.metric-card i {
  display: none;
}

.metric-card.blue,
.metric-card.green,
.metric-card.amber,
.metric-card.cyan {
  border-color: rgba(118, 147, 164, 0.18);
}

.metric-card.active {
  transform: translateY(-2px);
  border-color: rgba(14, 143, 119, 0.36);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(246, 251, 253, 0.94));
  box-shadow: 0 18px 46px rgba(29, 83, 115, 0.18);
}

.metric-card.active i {
  color: #0b6f5f;
  background: #e5f7f2;
}

.overview-focus {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  column-gap: 14px;
  min-height: 66px;
  margin: 0 16px 12px;
  padding: 12px 14px;
  border: 1px solid rgba(14, 143, 119, 0.18);
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(14, 143, 119, 0.12), rgba(15, 101, 145, 0.08)),
    #f7fbfc;
  backdrop-filter: blur(2px);
}

.overview-focus span,
.word-inspector span {
  color: #0e8f77;
  font-size: 12px;
  font-weight: 900;
}

.overview-focus strong,
.word-inspector strong {
  display: block;
  color: #173247;
  font-size: 20px;
  white-space: nowrap;
}

.overview-focus p,
.word-inspector p {
  margin: 5px 0 0;
  color: #5d7382;
  line-height: 1.6;
}

.overview-focus p {
  grid-column: 3;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.board-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 0 16px 16px;
  color: #607684;
  font-size: 13px;
  font-weight: 800;
}

.board-foot button {
  min-height: 34px;
  border: 1px solid rgba(14, 143, 119, 0.22);
  border-radius: 6px;
  color: #0b6f5f;
  background: #eef8f6;
  cursor: pointer;
  font-weight: 900;
  backdrop-filter: blur(2px);
}

.glance-section {
  padding: 30px clamp(20px, 5vw, 70px);
  border-top: 1px solid rgba(104, 135, 154, 0.18);
  border-bottom: 1px solid rgba(104, 135, 154, 0.24);
  background:
    linear-gradient(180deg, #ffffff 0%, #f7fbfc 100%),
    #ffffff;
}

.glance-inner {
  display: grid;
  gap: 16px;
}

.glance-heading {
  display: grid;
  grid-template-columns: minmax(320px, max-content) minmax(0, 1fr);
  align-items: flex-start;
  gap: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(109, 139, 158, 0.18);
}

.glance-title {
  min-width: 0;
}

.glance-heading h2 {
  margin: 0;
  color: #173247;
  font-size: clamp(26px, 2.4vw, 34px);
  line-height: 1.14;
  white-space: nowrap;
}

.glance-lead {
  justify-self: end;
  max-width: 560px;
  margin: 0;
  color: #526c7c;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.65;
  text-align: right;
}

.glance-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
}

.glance-item {
  position: relative;
  min-height: 124px;
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
  padding: 16px 16px 42px;
  border: 1px solid rgba(109, 139, 158, 0.18);
  border-radius: 8px;
  color: #173247;
  background: #ffffff;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.glance-item:hover,
.glance-item:focus-visible {
  border-color: rgba(14, 143, 119, 0.56);
  background:
    linear-gradient(135deg, rgba(239, 250, 247, 0.96), rgba(255, 255, 255, 0.98)),
    #ffffff;
  box-shadow: 0 18px 38px rgba(20, 73, 96, 0.16);
  outline: none;
  transform: translateY(-4px);
}

.glance-icon {
  position: relative;
  width: 54px;
  height: 54px;
  grid-row: 1;
  display: grid;
  place-items: center;
  border: 2px solid #1f638d;
  border-radius: 8px;
  background: #ffffff;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.glance-icon::before {
  color: #1f638d;
  font-size: 22px;
  font-weight: 900;
  transition: color 0.2s ease;
}

.glance-item:hover .glance-icon,
.glance-item:focus-visible .glance-icon {
  border-color: #0f6591;
  background: #0f6591;
  box-shadow: 0 10px 22px rgba(15, 101, 145, 0.22);
}

.glance-item:hover .glance-icon::before,
.glance-item:focus-visible .glance-icon::before {
  color: #ffffff;
}

.glance-icon.map::before {
  content: '◎';
}

.glance-icon.sankey::before {
  content: 'S';
}

.glance-icon.cloud::before {
  content: 'W';
}

.glance-icon.coverage::before {
  content: '%';
}

.glance-icon.evidence::before {
  content: 'D';
}

.glance-value {
  position: absolute;
  bottom: 15px;
  left: 84px;
  justify-self: start;
  padding: 3px 8px;
  border-radius: 999px;
  color: #ffffff;
  background: #0e8f77;
  font-size: 13px;
  font-weight: 900;
  white-space: nowrap;
  transition:
    background 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.glance-item:hover .glance-value,
.glance-item:focus-visible .glance-value {
  background: #0f6591;
  box-shadow: 0 8px 18px rgba(15, 101, 145, 0.2);
  transform: translateY(-1px);
}

.glance-copy {
  display: grid;
  gap: 7px;
}

.glance-copy strong {
  color: #173247;
  font-size: 18px;
  line-height: 1.2;
  white-space: nowrap;
}

.glance-copy em {
  display: -webkit-box;
  overflow: hidden;
  color: #657b89;
  font-size: 14px;
  font-style: normal;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.about-band,
.visual-section,
.upload-workspace,
.updates-section,
.site-footer {
  padding-inline: clamp(20px, 5vw, 70px);
}

.about-band {
  display: grid;
  gap: 20px;
  padding-block: 54px;
  border-top: 1px solid rgba(104, 135, 154, 0.2);
  border-bottom: 1px solid rgba(104, 135, 154, 0.24);
  background:
    linear-gradient(180deg, #eef6f8 0%, #f7fbfc 100%),
    #f6fafb;
}

.about-band h2,
.section-heading h2 {
  margin: 0;
  color: #122f42;
  font-size: clamp(26px, 3vw, 42px);
  line-height: 1.2;
  letter-spacing: 0;
}

.about-band h2 {
  white-space: nowrap;
}

.about-intro > p {
  max-width: 680px;
  margin: 0;
  color: #526c7c;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.78;
}

.about-intro h2 {
  margin-bottom: 12px;
}

.data-dossier {
  display: grid;
  gap: 22px;
  padding: clamp(20px, 2.2vw, 30px);
  border: 1px solid rgba(93, 126, 147, 0.22);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(246, 251, 252, 0.96)),
    #ffffff;
  box-shadow: 0 22px 58px rgba(37, 73, 96, 0.1);
}

.dossier-header {
  display: grid;
  grid-template-columns: minmax(360px, 0.82fr) minmax(520px, 1.18fr);
  gap: clamp(22px, 3.6vw, 48px);
  align-items: stretch;
  padding-bottom: 22px;
  border-bottom: 1px solid rgba(109, 139, 158, 0.2);
}

.dossier-guide {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.dossier-guide article {
  display: grid;
  align-content: start;
  grid-template-rows: auto auto 1fr;
  gap: 9px;
  min-height: 118px;
  padding: 16px;
  border: 1px solid rgba(109, 139, 158, 0.16);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(237, 249, 246, 0.76), rgba(255, 255, 255, 0.96)),
    #ffffff;
}

.dossier-guide span {
  width: fit-content;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 5px 8px;
  border-radius: 999px;
  color: #0b6f5f;
  background: #e5f7f2;
  font-size: 12px;
  font-weight: 900;
}

.dossier-guide strong {
  color: #173247;
  font-size: 17px;
  line-height: 1.25;
  white-space: nowrap;
}

.dossier-guide p {
  margin: 0;
  color: #607684;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.65;
}

.review-steps span {
  width: 36px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: #ffffff;
  background: #173247;
  font-size: 12px;
  font-weight: 900;
}

.review-steps strong,
.update-list h3 {
  margin: 0;
  color: #173247;
  font-size: 20px;
}

.metadata-panel p,
.review-steps p,
.update-list p,
.site-footer p {
  margin: 0;
  color: #5d7382;
  line-height: 1.75;
}

.dossier-body {
  display: grid;
  grid-template-columns: minmax(560px, 1.18fr) minmax(380px, 0.82fr);
  align-items: stretch;
  gap: 18px;
}

.visual-section,
.upload-workspace,
.updates-section {
  padding-block: 56px;
}

.section-heading {
  max-width: min(1120px, 100%);
  margin-bottom: 22px;
}

.section-heading h2 {
  text-wrap: balance;
}

.visual-grid,
.upload-layout {
  display: grid;
  gap: 16px;
}

.visual-grid {
  grid-template-columns: minmax(0, 1fr);
}

.upload-layout {
  grid-template-columns: minmax(360px, 1.18fr) minmax(320px, 0.82fr);
}

.metadata-panel,
.word-cloud-panel,
.factor-panel,
.category-panel,
.biomarker-chart-panel,
.upload-panel,
.review-panel,
.update-list article {
  border: 1px solid rgba(109, 139, 158, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 18px 48px rgba(32, 62, 82, 0.08);
}

.metadata-panel,
.word-cloud-panel,
.factor-panel,
.category-panel,
.biomarker-chart-panel,
.upload-panel,
.review-panel {
  padding: 22px;
}

.metadata-panel {
  padding: 0;
}

.metadata-panel {
  display: grid;
  align-content: start;
  gap: 0;
  height: 100%;
  overflow: hidden;
}

.access-panel {
  grid-template-rows: auto 1fr auto;
}

.metadata-panel header,
.word-cloud-panel header,
.factor-panel header,
.category-panel header,
.biomarker-panel-head,
.upload-panel header,
.review-panel header {
  display: grid;
  gap: 6px;
  margin-bottom: 22px;
}

.metadata-panel header {
  margin-bottom: 0;
  min-height: 88px;
  padding: 18px 20px 16px;
  border-bottom: 1px solid rgba(109, 139, 158, 0.16);
  background:
    linear-gradient(90deg, rgba(14, 143, 119, 0.08), rgba(15, 101, 145, 0.04)),
    #ffffff;
}

.metadata-panel header span,
.word-cloud-panel header span,
.factor-panel header span,
.category-panel header span,
.biomarker-panel-head span,
.upload-panel header span,
.review-panel header span {
  color: #0e8f77;
  font-size: 13px;
  font-weight: 900;
}

.metadata-panel header strong,
.word-cloud-panel header strong,
.factor-panel header strong,
.category-panel header strong,
.biomarker-panel-head strong,
.upload-panel header strong,
.review-panel header strong {
  color: #173247;
  font-size: 22px;
}

.field-table,
.permission-table,
.factor-list {
  display: grid;
  gap: 0;
}

.permission-table {
  align-content: start;
}

.factor-list {
  gap: 8px;
}

.field-table-head,
.field-table article,
.factor-list button {
  display: grid;
  gap: 6px;
  align-items: center;
  min-height: 58px;
  padding: 12px 20px;
  border: 0;
  border-top: 1px solid rgba(118, 147, 164, 0.12);
  border-radius: 0;
  background: #ffffff;
}

.field-table-head,
.field-table article {
  grid-template-columns: minmax(138px, 0.28fr) minmax(0, 1fr) minmax(128px, 0.34fr);
}

.field-table-head {
  min-height: 42px;
  padding-block: 10px;
  color: #5d7382;
  background: #f5fafb;
  font-size: 12px;
  font-weight: 900;
  border-top: 0;
}

.factor-list button {
  min-height: 48px;
  grid-template-columns: minmax(86px, 0.7fr) minmax(110px, 1fr) auto;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid rgba(118, 147, 164, 0.14);
  border-radius: 8px;
  background: #f9fcfd;
}

.factor-list button:hover {
  border-color: rgba(14, 143, 119, 0.3);
  background: #f1faf7;
}

.field-table strong,
.factor-list strong {
  color: #183347;
  font-size: 16px;
}

.factor-list strong {
  font-size: inherit;
}

.field-table span,
.field-table em,
.factor-list span,
.factor-list em {
  color: #657b89;
  font-size: 13px;
  font-style: normal;
  line-height: 1.6;
}

.factor-list span,
.factor-list em {
  font-size: 12px;
}

.field-table em {
  justify-self: end;
  max-width: 100%;
  padding: 5px 9px;
  border-radius: 6px;
  background: #edf4f7;
  color: #496171;
  font-weight: 800;
  text-align: right;
  white-space: normal;
}

.permission-table article {
  position: relative;
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
  min-height: 88px;
  padding: 18px 20px;
  border: 0;
  border-top: 1px solid rgba(109, 139, 158, 0.14);
  border-radius: 0;
  background: #ffffff;
}

.permission-table article:first-child {
  border-top: 0;
}

.permission-table article::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 62px;
  width: 1px;
  background: rgba(14, 143, 119, 0.14);
  content: '';
}

.permission-table article span {
  position: relative;
  z-index: 1;
  padding: 7px 8px;
  border-radius: 6px;
  color: #0b6f5f;
  background: #e5f7f2;
  font-size: 12px;
  font-weight: 900;
  text-align: center;
}

.permission-table article strong {
  color: #173247;
  font-size: 17px;
}

.permission-table article p {
  margin-top: 4px;
  font-size: 13px;
}

.permission-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 16px 20px 20px;
  border-top: 1px solid rgba(109, 139, 158, 0.14);
  background: #f7fbfc;
}

.permission-actions button {
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid rgba(15, 101, 145, 0.18);
  border-radius: 8px;
  color: #0f6591;
  background: #eef7fb;
  cursor: pointer;
  font-weight: 900;
}

.visual-section {
  border-bottom: 1px solid rgba(122, 150, 166, 0.18);
  background: #f6fafb;
}

.upload-workspace,
.updates-section {
  background: #ffffff;
}

.word-cloud-panel {
  min-height: 500px;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto 330px auto;
  overflow: hidden;
}

.word-cloud-panel > * {
  min-width: 0;
}

.word-cloud-viewport {
  position: relative;
  height: 330px;
  min-height: 330px;
  max-width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: center;
  gap: 14px;
  overflow: hidden;
  overflow: clip;
  contain: paint;
  border: 1px solid rgba(109, 139, 158, 0.12);
  border-radius: 8px;
  background:
    radial-gradient(circle at 18% 20%, rgba(14, 143, 119, 0.1), transparent 28%),
    linear-gradient(135deg, rgba(240, 248, 250, 0.92), rgba(255, 255, 255, 0.98)),
    #f8fbfc;
}

.word-cloud-viewport > * {
  min-width: 0;
}

.word-cloud-viewport::before,
.word-cloud-viewport::after {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 2;
  height: 42px;
  content: '';
  pointer-events: none;
}

.word-cloud-viewport::before {
  top: 0;
  background: linear-gradient(180deg, #f8fbfc, rgba(248, 251, 252, 0));
}

.word-cloud-viewport::after {
  bottom: 0;
  background: linear-gradient(0deg, #f8fbfc, rgba(248, 251, 252, 0));
}

.word-cloud-row {
  position: relative;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 62px;
  overflow: hidden;
  overflow: clip;
  contain: paint;
}

.word-cloud-trackline {
  position: absolute;
  top: 50%;
  left: 0;
  width: max-content;
  display: flex;
  gap: 12px;
  padding-inline: 16px;
  translate: 0 -50%;
  animation: word-marquee var(--marquee-duration) linear infinite;
}

.word-cloud-row.reverse .word-cloud-trackline {
  animation-direction: reverse;
}

.word-cloud-viewport.paused .word-cloud-trackline,
.word-cloud-viewport.paused .word-chip {
  animation-play-state: paused;
}

.word-chip {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 7px 10px;
  border: 1px solid rgba(109, 139, 158, 0.12);
  border-radius: 999px;
  color: var(--word-color);
  background: rgba(255, 255, 255, 0.76);
  cursor: pointer;
  font-weight: 900;
  line-height: 1;
  box-shadow: 0 8px 18px rgba(32, 62, 82, 0.06);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease;
  animation: word-float 7.5s ease-in-out infinite;
  animation-delay: var(--float-delay);
}

.word-chip strong {
  display: inline-flex;
  align-items: center;
  line-height: 1;
  overflow-wrap: anywhere;
  white-space: nowrap;
  font-size: var(--word-size);
}

.word-chip small {
  display: inline-flex;
  align-items: center;
  color: #6b7f8d;
  font-size: 11px;
  line-height: 1;
}

.word-chip:hover,
.word-chip:focus-visible,
.word-chip.active {
  z-index: 3;
  color: var(--word-color);
  background: #ffffff;
  box-shadow: 0 16px 34px rgba(32, 62, 82, 0.16);
  outline: none;
  transform: translateY(-3px) scale(1.04);
}

.word-chip.dimmed {
  opacity: 0.28;
  filter: saturate(0.6);
}

.word-inspector {
  margin-top: 14px;
  padding: 14px 16px;
  border: 1px solid rgba(14, 143, 119, 0.16);
  border-radius: 8px;
  background: #f7fbfc;
}

.biomarker-chart-panel {
  display: grid;
  gap: 16px;
}

.biomarker-panel-head {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  margin-bottom: 0;
}

.biomarker-panel-head strong {
  grid-column: 1;
}

.biomarker-panel-head em {
  grid-column: 2;
  grid-row: 1;
  justify-self: end;
  align-self: start;
  padding: 7px 10px;
  border-radius: 6px;
  color: #36546d;
  background: #edf4f7;
  font-size: 13px;
  font-style: normal;
  font-weight: 900;
}

.frequency-chart-toolbar {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 2px 0 4px;
  border-bottom: 1px solid rgba(109, 139, 158, 0.12);
  background: transparent;
}

.biomarker-filter-control,
.biomarker-sort-control {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.biomarker-filter-control > span,
.biomarker-sort-control > span {
  padding-right: 2px;
  color: #7b8e9b;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0;
  white-space: nowrap;
}

.biomarker-filter-control select {
  width: min(360px, 38vw);
  max-width: 100%;
  height: 28px;
  padding: 0 30px 0 10px;
  border: 1px solid rgba(109, 139, 158, 0.2);
  border-radius: 999px;
  color: #173247;
  background: #f8fbfc;
  font: inherit;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.biomarker-filter-control button,
.biomarker-sort-control button {
  min-width: 48px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  color: #526c7c;
  background: rgba(237, 244, 247, 0.7);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
  transition:
    color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease;
}

.biomarker-filter-control button:hover,
.biomarker-sort-control button:hover {
  color: #173247;
  background: #e8f2f5;
}

.biomarker-filter-control button.active,
.biomarker-sort-control button.active {
  color: #ffffff;
  background: #173247;
  box-shadow: 0 6px 14px rgba(23, 50, 71, 0.14);
}

.biomarker-chart-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(320px, 0.88fr);
  gap: 18px;
  align-items: start;
}

.biomarker-bar-section,
.biomarker-detail-section {
  min-width: 0;
}

.biomarker-detail-section header {
  display: grid;
  gap: 5px;
}

.biomarker-detail-section header span,
.line-stat-grid span {
  color: #6b7f8d;
  font-size: 12px;
  font-weight: 900;
}

.biomarker-detail-section header strong {
  color: #173247;
  font-size: 20px;
}

.frequency-chart-shell {
  display: grid;
  gap: 8px;
}

.frequency-x-axis {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  padding: 0 48px 0 clamp(132px, 28%, 210px);
  color: #768b98;
  font-size: 12px;
  font-weight: 800;
}

.frequency-x-axis span {
  text-align: right;
}

.frequency-plot-scroll {
  min-width: 0;
  overflow: auto hidden;
  padding-bottom: 4px;
}

.frequency-plot {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 8px;
  padding: 5px 0;
  background: linear-gradient(180deg, #ffffff, #f8fbfc);
}

.frequency-bar {
  min-height: 34px;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(128px, 0.32fr) minmax(0, 1fr) 46px;
  align-items: center;
  gap: 12px;
  padding: 3px 6px;
  border: 0;
  border-radius: 8px;
  color: #354f61;
  background: transparent;
  cursor: pointer;
  transition:
    background 0.18s ease,
    transform 0.18s ease;
}

.frequency-bar strong {
  min-width: 0;
  color: #536977;
  font-size: 13px;
  font-weight: 900;
  line-height: 1.28;
  text-align: right;
  word-break: keep-all;
  overflow-wrap: anywhere;
}

.frequency-bar span {
  position: relative;
  height: 16px;
  overflow: hidden;
  border-radius: 999px;
  background: #edf4f7;
}

.frequency-bar i {
  position: relative;
  width: var(--bar-width);
  height: 100%;
  display: block;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--bar-color) 86%, #ffffff),
    var(--bar-color)
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.34),
    0 10px 20px rgba(36, 84, 105, 0.12);
  transition:
    filter 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.frequency-bar i::after {
  content: '';
  position: absolute;
  top: 50%;
  right: -4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #173247;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--bar-color) 16%, transparent);
  opacity: 0;
  pointer-events: none;
  transform: translate(5px, -50%) scale(0.8);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.frequency-bar em {
  color: #173247;
  font-size: 13px;
  font-style: normal;
  font-weight: 900;
  text-align: right;
}

.frequency-bar:hover i,
.frequency-bar:focus-visible i,
.frequency-bar.active i {
  filter: saturate(1.15);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.82),
    0 0 0 1px color-mix(in srgb, var(--bar-color) 54%, #ffffff),
    0 14px 26px rgba(28, 72, 96, 0.18);
}

.frequency-bar:active i {
  transform: scaleX(0.98);
}

.frequency-bar:hover,
.frequency-bar:focus-visible,
.frequency-bar.active {
  background: rgba(235, 244, 248, 0.82);
  outline: none;
}

.frequency-bar:hover,
.frequency-bar:focus-visible {
  transform: translateX(2px);
}

.frequency-bar.active strong,
.frequency-bar.active em {
  color: #102f42;
}

.frequency-bar.active i::after {
  opacity: 1;
  transform: translate(0, -50%) scale(1);
  animation: bar-selected-pulse 0.48s ease;
}

.biomarker-detail-section {
  position: sticky;
  top: 84px;
  align-self: start;
  max-height: calc(100vh - 96px);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 12px;
  overflow-y: auto;
  overflow-x: clip;
  padding: 2px 0 0;
  scrollbar-color: rgba(109, 139, 158, 0.28) transparent;
  scrollbar-width: thin;
}

.biomarker-detail-section header {
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(109, 139, 158, 0.18);
}

.biomarker-detail-section header em {
  width: fit-content;
  max-width: 100%;
  padding: 4px 9px;
  border-radius: 999px;
  color: #0b6f5f;
  background: #e5f7f2;
  font-size: 12px;
  font-style: normal;
  font-weight: 900;
}

.line-stat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.line-stat-grid article {
  min-height: 64px;
  display: grid;
  align-content: center;
  gap: 5px;
  padding: 10px;
  border: 1px solid rgba(109, 139, 158, 0.16);
  border-radius: 8px;
  background: #f8fbfc;
}

.line-stat-grid strong {
  color: #173247;
  font-size: 21px;
  line-height: 1;
}

.detail-bar-shell {
  min-height: 374px;
  display: grid;
  align-content: start;
  gap: 10px;
  animation: trend-chart-enter 0.36s ease both;
}

.detail-chart-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
}

.detail-chart-head > div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.detail-chart-head span {
  color: #6b7f8d;
  font-size: 12px;
  font-weight: 900;
}

.detail-chart-head em {
  color: #36546d;
  font-size: 12px;
  font-style: normal;
  font-weight: 900;
}

.subclass-filter {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #6b7f8d;
  font-size: 12px;
  font-weight: 900;
}

.subclass-filter select {
  max-width: min(220px, 42vw);
  height: 32px;
  padding: 0 30px 0 10px;
  border: 1px solid rgba(109, 139, 158, 0.22);
  border-radius: 7px;
  color: #173247;
  background: #f8fbfc;
  font: inherit;
  cursor: pointer;
}

.detail-column-scroll {
  min-width: 0;
  overflow-x: auto;
  overflow-y: visible;
  padding: 4px 2px 18px;
  scrollbar-color: rgba(109, 139, 158, 0.36) transparent;
  scrollbar-width: thin;
}

.detail-column-plot {
  width: var(--detail-plot-width);
  min-width: 100%;
  height: 360px;
  display: flex;
  align-items: stretch;
  gap: 8px;
  overflow: visible;
  padding: 8px 6px 0;
  border-bottom: 1px solid rgba(109, 139, 158, 0.18);
}

.detail-column-bar {
  width: 48px;
  flex: 0 0 48px;
  min-width: 0;
  display: grid;
  grid-template-rows: 26px minmax(174px, 1fr) 112px;
  justify-items: center;
  align-items: end;
  gap: 6px;
  overflow: visible;
}

.detail-column-bar > strong {
  align-self: end;
  max-width: 100%;
  padding: 3px 6px;
  border: 1px solid rgba(109, 139, 158, 0.16);
  border-radius: 999px;
  color: #173247;
  background: #ffffff;
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
  box-shadow: 0 6px 14px rgba(32, 62, 82, 0.08);
}

.detail-column-bar > div {
  width: 20px;
  height: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
  border-radius: 999px 999px 5px 5px;
  background: linear-gradient(180deg, rgba(237, 244, 247, 0.52), rgba(237, 244, 247, 0.12));
  box-shadow: inset 0 0 0 1px rgba(109, 139, 158, 0.08);
}

.detail-column-bar i {
  width: 100%;
  height: var(--detail-bar-height);
  display: block;
  border-radius: 999px 999px 5px 5px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--detail-color) 78%, #ffffff),
    var(--detail-color)
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.42),
    0 10px 18px color-mix(in srgb, var(--detail-color) 14%, transparent);
}

.detail-column-bar > span {
  align-self: start;
  width: 86px;
  max-width: 86px;
  color: #4f6777;
  font-size: 12px;
  font-weight: 900;
  line-height: 1.18;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transform: rotate(-34deg) translate(-7px, 10px);
  transform-origin: top right;
}

.line-empty {
  min-height: 220px;
  display: grid;
  place-items: center;
  margin: 0;
  border: 1px dashed rgba(109, 139, 158, 0.28);
  border-radius: 8px;
  color: #718793;
  background: #f8fbfc;
  font-weight: 800;
}

.word-popover-layer {
  position: fixed;
  inset: 0;
  z-index: 59;
  background: transparent;
}

.word-popover {
  position: fixed;
  z-index: 60;
  width: min(380px, calc(100vw - 40px));
  padding: 14px 16px 16px;
  border: 1px solid #cfe0f1;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgba(18, 42, 67, 0.24);
}

.word-popover-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 9px;
}

.word-popover-head span {
  color: #607287;
  font-size: 13px;
  font-weight: 800;
}

.word-popover-head button {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  color: #375067;
  background: #eef4fb;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
}

.word-popover-name {
  display: block;
  margin-bottom: 12px;
  font-size: 24px;
  line-height: 1.25;
  word-break: break-word;
}

.word-popover-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.word-popover-metrics article {
  padding: 8px 10px;
  border: 1px solid #dce8f4;
  border-radius: 8px;
  background: #f6faff;
}

.word-popover-metrics span,
.word-popover-section > span {
  color: #607287;
  font-size: 12px;
  font-weight: 800;
}

.word-popover-metrics strong {
  display: block;
  margin-top: 2px;
  color: #075cac;
  font-size: 18px;
}

.word-popover-section {
  display: grid;
  gap: 6px;
  margin-top: 12px;
}

.word-popover-section div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.word-popover-section em {
  padding: 3px 9px;
  border-radius: 999px;
  color: #36546d;
  background: #eef5fd;
  font-size: 12px;
  font-style: normal;
}

@keyframes word-marquee {
  0% {
    transform: translateX(0);
  }

  100% {
    transform: translateX(-50%);
  }
}

@keyframes word-float {
  0%,
  100% {
    translate: 0 0;
  }

  50% {
    translate: 0 -3px;
  }
}

@keyframes bar-selected-pulse {
  0% {
    opacity: 0.25;
    transform: translate(5px, -50%) scale(0.78);
  }

  55% {
    opacity: 1;
    transform: translate(0, -50%) scale(1.18);
  }

  100% {
    opacity: 1;
    transform: translate(0, -50%) scale(1);
  }
}

@keyframes trend-chart-enter {
  0% {
    opacity: 0;
    transform: translateY(8px);
  }

  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

.category-rings {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.ring-item {
  min-height: 104px;
  display: grid;
  place-items: center;
  gap: 5px;
  padding: 12px 8px;
  border-radius: 8px;
  background: #f7fbfc;
  text-align: center;
}

.ring-item i {
  width: 40px;
  height: 40px;
  display: block;
  border-radius: 50%;
}

.ring-item span {
  color: #354f61;
  font-size: 12px;
  font-weight: 800;
}

.ring-item strong {
  color: #173247;
  font-size: 20px;
}

.ring-item em {
  color: #708696;
  font-size: 11px;
  font-style: normal;
}

.upload-form {
  display: grid;
  gap: 15px;
}

.upload-form label {
  display: grid;
  gap: 8px;
  color: #2f4b5e;
  font-size: 14px;
  font-weight: 800;
}

.upload-form input,
.upload-form select,
.upload-form textarea {
  width: 100%;
  border: 1px solid rgba(98, 128, 148, 0.28);
  border-radius: 8px;
  color: #173247;
  background: #ffffff;
  outline: 0;
}

.upload-form input,
.upload-form select {
  height: 46px;
  padding: 0 13px;
}

.upload-form textarea {
  resize: vertical;
  padding: 12px 13px;
  line-height: 1.6;
}

.upload-form input:focus,
.upload-form select:focus,
.upload-form textarea:focus {
  border-color: #0f6591;
  box-shadow: 0 0 0 4px rgba(15, 101, 145, 0.12);
}

.file-drop {
  padding: 16px;
  border: 1px dashed rgba(15, 101, 145, 0.28);
  border-radius: 8px;
  background: #f4fafc;
}

.file-drop input {
  height: auto;
  padding: 0;
  border: 0;
  background: transparent;
}

.file-drop strong {
  color: #173247;
  font-size: 15px;
}

.review-steps {
  display: grid;
  gap: 12px;
}

.review-steps article {
  display: grid;
  gap: 8px;
  padding: 16px;
  border-radius: 8px;
  background: #f8fbfc;
}

.update-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.update-list article {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 18px;
  padding: 24px;
}

.update-list time {
  color: #0e8f77;
  font-weight: 900;
}

.site-footer {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) auto;
  gap: 22px;
  padding-block: 34px;
  color: #dce7ed;
  background: #132b3d;
}

.footer-brand {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

.site-footer p {
  margin-top: 8px;
  color: #b6c6d0;
}

.site-footer nav {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 16px;
}

.site-footer a,
.site-footer button {
  color: #e7f0f4;
}

.site-footer button {
  border: 0;
  background: transparent;
  cursor: pointer;
}

.site-footer small {
  grid-column: 1 / -1;
  color: #90a5b2;
}

.auth-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(11, 26, 36, 0.48);
  backdrop-filter: blur(12px);
}

.auth-card {
  position: relative;
  width: min(420px, 100%);
  max-height: min(720px, calc(100vh - 48px));
  overflow: auto;
  padding: 24px;
  border: 1px solid rgba(204, 219, 226, 0.84);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 252, 253, 0.98)),
    #ffffff;
  box-shadow: 0 24px 62px rgba(10, 29, 42, 0.24);
}

.close-button {
  position: absolute;
  top: 14px;
  right: 14px;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid rgba(87, 116, 134, 0.22);
  border-radius: 50%;
  color: #5b7180;
  background: rgba(255, 255, 255, 0.72);
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  transition:
    border-color 0.18s ease,
    color 0.18s ease,
    background 0.18s ease;
}

.close-button:hover {
  border-color: rgba(15, 101, 145, 0.36);
  color: #173247;
  background: #ffffff;
}

.auth-header {
  display: grid;
  justify-items: start;
  gap: 7px;
  margin-bottom: 18px;
  padding-right: 44px;
}

.auth-logo {
  position: relative;
  display: grid;
  width: 36px;
  height: 36px;
  overflow: hidden;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.56);
  border-radius: 8px;
  background: #0f8291;
  box-shadow: 0 10px 24px rgba(15, 101, 145, 0.2);
}

.auth-logo-drop {
  position: absolute;
  top: 7px;
  left: 8px;
  width: 13px;
  height: 18px;
  border: 3px solid #d8f5f1;
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
  border-bottom-right-radius: 12px;
  border-bottom-left-radius: 4px;
  transform: rotate(38deg);
}

.auth-logo-bars {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: flex;
  align-items: end;
  gap: 3px;
}

.auth-logo-bars i {
  display: block;
  width: 4px;
  border-radius: 999px 999px 1px 1px;
  background: #ffffff;
}

.auth-logo-bars i:nth-child(1) {
  height: 10px;
}

.auth-logo-bars i:nth-child(2) {
  height: 16px;
}

.auth-logo-bars i:nth-child(3) {
  height: 22px;
}

.auth-header p {
  margin: 0;
  color: #607888;
  font-size: 13px;
  line-height: 1.55;
}

.auth-header h2 {
  margin: 0;
  color: #173247;
  font-size: 24px;
  line-height: 1.22;
}

.auth-form {
  display: grid;
  gap: 13px;
}

.auth-mode-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(98, 128, 148, 0.18);
  border-radius: 8px;
  background: #eef5f7;
}

.auth-mode-tabs button {
  min-height: 36px;
  border: 0;
  border-radius: 6px;
  color: #5f7481;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  font-weight: 900;
  transition:
    color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease;
}

.auth-mode-tabs button.active {
  color: #173247;
  background: #ffffff;
  box-shadow: 0 6px 18px rgba(32, 68, 88, 0.12);
}

.auth-fields {
  display: grid;
  gap: 13px;
}

.auth-panel-enter-active,
.auth-panel-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.auth-panel-enter-from,
.auth-panel-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.auth-form label {
  display: grid;
  gap: 7px;
  color: #2f4b5e;
  font-size: 13px;
  font-weight: 800;
}

.auth-form input {
  width: 100%;
  height: 42px;
  border: 1px solid rgba(98, 128, 148, 0.28);
  border-radius: 8px;
  padding: 0 12px;
  color: #173247;
  outline: 0;
  background: #ffffff;
  font-size: 14px;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.auth-form input:focus {
  border-color: #0f6591;
  box-shadow: 0 0 0 4px rgba(15, 101, 145, 0.12);
}

.password-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px;
  border: 1px solid rgba(98, 128, 148, 0.28);
  border-radius: 8px;
  background: #ffffff;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.password-field:focus-within {
  border-color: #0f6591;
  box-shadow: 0 0 0 4px rgba(15, 101, 145, 0.12);
}

.password-field input {
  border: 0;
  border-radius: 8px 0 0 8px;
  box-shadow: none;
}

.password-field input:focus {
  box-shadow: none;
}

.password-field button {
  display: grid;
  min-height: 42px;
  place-items: center;
  border: 0;
  border-left: 1px solid rgba(98, 128, 148, 0.16);
  border-radius: 0 8px 8px 0;
  color: #5d7482;
  background: transparent;
  cursor: pointer;
}

.eye-icon {
  position: relative;
  width: 20px;
  height: 13px;
  border: 2px solid currentColor;
  border-radius: 50%;
}

.eye-icon::after {
  content: '';
  position: absolute;
  left: -3px;
  right: -3px;
  top: 5px;
  height: 2px;
  border-radius: 999px;
  background: currentColor;
  transform: rotate(-36deg);
}

.eye-icon.visible::after {
  opacity: 0;
}

.eye-icon i {
  position: absolute;
  top: 3px;
  left: 6px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}

.split-row {
  display: grid;
  gap: 10px;
}

.code-row {
  grid-template-columns: minmax(0, 1fr) 112px;
}

.captcha-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 104px 58px;
  gap: 8px;
}

.captcha-row img {
  width: 104px;
  height: 42px;
  border: 1px solid rgba(98, 128, 148, 0.22);
  border-radius: 8px;
  object-fit: cover;
  background: #eef5f7;
}

.split-row button,
.captcha-row button,
.ghost-action {
  min-height: 42px;
  border: 1px solid rgba(15, 101, 145, 0.18);
  border-radius: 8px;
  color: #0f6591;
  background: #eef7fb;
  cursor: pointer;
  font-size: 13px;
  font-weight: 900;
}

.split-row button:disabled,
.auth-submit:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.form-message {
  min-height: 20px;
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

.form-message.success {
  color: #0b7b67;
}

.form-message.error {
  color: #b2454d;
}

.auth-submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  border-radius: 8px;
  color: #ffffff;
  background: #0f6591;
  box-shadow: 0 16px 34px rgba(15, 101, 145, 0.22);
}

.submit-loader {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}

.submit-loader i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: submitPulse 0.9s ease-in-out infinite;
}

.submit-loader i:nth-child(2) {
  animation-delay: 0.12s;
}

.submit-loader i:nth-child(3) {
  animation-delay: 0.24s;
}

@keyframes submitPulse {
  0%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }

  50% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

.post-login-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}

.action-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px;
}

.action-links button {
  border: 0;
  color: #0f6591;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  font-weight: 900;
}

@media (max-width: 1120px) {
  .site-header {
    grid-template-columns: 1fr;
  }

  .main-nav {
    justify-content: flex-start;
    overflow-x: auto;
  }

  .header-tools {
    justify-content: space-between;
  }

  .search-box {
    width: min(520px, 100%);
  }

  .hero-section,
  .dossier-header,
  .dossier-body,
  .upload-layout {
    grid-template-columns: 1fr;
  }

  .glance-heading {
    grid-template-columns: 1fr;
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(109, 139, 158, 0.18);
  }

  .glance-lead {
    justify-self: start;
    text-align: left;
  }

  .visual-grid,
  .biomarker-chart-layout {
    grid-template-columns: 1fr;
  }

  .dossier-guide,
  .glance-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .site-header {
    padding: 14px 16px;
  }

  .header-tools {
    display: grid;
    grid-template-columns: 1fr auto;
  }

  .user-tools {
    grid-column: 1 / -1;
    justify-content: space-between;
  }

  .search-box {
    min-width: 0;
  }

  .hero-section {
    min-height: auto;
    padding-top: 34px;
  }

  .metric-summary-grid,
  .glance-grid,
  .visual-grid,
  .update-list,
  .site-footer {
    grid-template-columns: 1fr;
  }

  .metric-summary-grid {
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 12px;
  }

  .metric-card {
    min-height: 94px;
    padding: 13px 14px;
  }

  .metric-card span {
    font-size: 13px;
  }

  .metric-card strong {
    font-size: 24px;
  }

  .metric-card small,
  .metric-card em {
    font-size: 13px;
  }

  .category-panel {
    grid-column: auto;
  }

  .factor-list button,
  .field-table-head,
  .field-table article,
  .permission-table article,
  .update-list article,
  .post-login-actions {
    grid-template-columns: 1fr;
  }

  .about-band,
  .glance-section {
    padding-block: 34px;
  }

  .data-dossier {
    padding: 18px;
  }

  .dossier-guide {
    grid-template-columns: 1fr;
  }

  .field-table-head {
    display: none;
  }

  .field-table em {
    justify-self: start;
    text-align: left;
  }

  .permission-table article::before {
    display: none;
  }

  .permission-table article span {
    width: fit-content;
  }

  .overview-focus {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .overview-focus p {
    grid-column: 1;
  }

  .category-rings {
    grid-template-columns: 1fr;
  }

  .glance-heading {
    grid-template-columns: 1fr;
    display: grid;
    justify-items: start;
  }

  .glance-heading h2 {
    white-space: normal;
  }

  .glance-lead {
    font-size: 14px;
  }

  .glance-item {
    grid-template-columns: 46px minmax(0, 1fr);
    min-height: 118px;
  }

  .glance-value {
    left: 78px;
  }

  .glance-icon {
    width: 46px;
    height: 46px;
  }

  .word-cloud-panel {
    min-height: 420px;
    grid-template-rows: auto 260px auto;
  }

  .word-cloud-viewport {
    height: 260px;
    min-height: 260px;
  }

  .biomarker-chart-panel {
    padding: 18px;
  }

  .biomarker-panel-head {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .biomarker-panel-head em {
    grid-column: 1;
    grid-row: auto;
    justify-self: start;
  }

  .frequency-chart-toolbar {
    align-items: stretch;
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: 8px 12px;
    padding: 2px 0 5px;
  }

  .biomarker-filter-control,
  .biomarker-sort-control {
    max-width: 100%;
    overflow-x: auto;
  }

  .biomarker-filter-control {
    width: 100%;
  }

  .biomarker-filter-control select {
    width: min(320px, 100%);
  }

  .biomarker-filter-control button,
  .biomarker-sort-control button {
    min-width: 48px;
    height: 26px;
    padding: 0 9px;
  }

  .frequency-x-axis {
    min-width: 0;
    padding-left: clamp(96px, 34%, 116px);
    padding-right: 34px;
  }

  .frequency-plot {
    min-width: 0;
    gap: 7px;
  }

  .frequency-bar {
    grid-template-columns: minmax(86px, 104px) minmax(0, 1fr) 34px;
    gap: 8px;
  }

  .frequency-bar strong {
    font-size: 12px;
  }

  .frequency-bar em {
    font-size: 12px;
  }

  .detail-chart-head {
    display: grid;
    align-items: start;
  }

  .biomarker-detail-section {
    position: static;
    max-height: none;
    overflow: visible;
  }

  .subclass-filter {
    justify-content: start;
  }

  .subclass-filter select {
    max-width: min(220px, 64vw);
  }

  .detail-column-scroll {
    padding-bottom: 16px;
  }

  .detail-column-plot {
    height: 320px;
    gap: 7px;
    padding-inline: 4px;
  }

  .detail-column-bar {
    width: 46px;
    flex-basis: 46px;
    grid-template-rows: 24px minmax(150px, 1fr) 102px;
    gap: 6px;
  }

  .detail-column-bar > strong,
  .detail-column-bar > span {
    font-size: 11px;
  }

  .detail-column-bar > div {
    width: 18px;
  }

  .line-stat-grid {
    grid-template-columns: repeat(3, minmax(84px, 1fr));
    overflow-x: auto;
  }

  .word-cloud-viewport {
    gap: 10px;
  }

  .word-cloud-trackline {
    gap: 10px;
    padding-inline: 12px;
  }

  .word-chip strong {
    font-size: min(var(--word-size), 28px);
  }

  .site-footer nav {
    justify-content: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .word-cloud-trackline,
  .word-chip {
    animation: none;
  }
}

@media (max-width: 460px) {
  .brand small,
  .main-nav {
    display: none;
  }

  .hero-copy h1 {
    font-size: 34px;
  }

  .auth-card {
    padding: 26px 18px;
  }

  .code-row,
  .captcha-row {
    grid-template-columns: 1fr;
  }

  .captcha-row img {
    width: 100%;
  }
}
</style>
