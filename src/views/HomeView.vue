<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import BrandMark from '../components/BrandMark.vue'
import PlatformHeader from '../components/PlatformHeader.vue'
import AcademicAnalysisModules from '../components/academic/AcademicAnalysisModules.vue'
import AcademicFactorCloud from '../components/academic/AcademicFactorCloud.vue'
import AcademicHomeGuide from '../components/academic/AcademicHomeGuide.vue'
import type { FactorCloudState, FactorKeyword } from '../utils/factorCloud'
import { homeReveal } from '../directives/homeReveal'
import AcademicFooter from '../components/academic/AcademicFooter.vue'
import AcademicHeroWorkspace from '../components/academic/AcademicHeroWorkspace.vue'
import AcademicIntroStage from '../components/academic/AcademicIntroStage.vue'
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
import { HOME_OVERVIEW_API_ENABLED } from '../config/api'
import { PLATFORM_OVERVIEW_METRICS } from '../data/platformOverview'
import { fetchHomeOverview, HomeOverviewRequestError } from '../services/home'
import { getUserErrorMessage } from '../services/errors'
import { clearSession, getStoredSession, saveSession, updateStoredUser } from '../services/session'

type AuthMode = 'login' | 'register' | 'reset'
type PendingAction = 'operator' | null
type BiomarkerSortMode = 'frequency' | 'frequencyAsc' | 'name'
type TargetGroupMode = 'all' | 'drug' | 'consumer'
type ActionNoticeTone = 'success' | 'info' | 'warning'
type HomeLoadState =
  | 'disabled'
  | 'idle'
  | 'loading'
  | 'success'
  | 'empty'
  | 'error'
  | 'timeout'
  | 'unauthorized'

interface RolePresentation {
  label: string
  shortLabel: string
  description: string
}

const ROLE_PRESENTATIONS: Record<UserResponse['role'], RolePresentation> = {
  admin: {
    label: '系统管理员',
    shortLabel: '管理',
    description: '拥有系统配置、数据维护与审核权限',
  },
  editor: {
    label: '数据维护员',
    shortLabel: '维护',
    description: '负责数据录入、校验与版本维护',
  },
  viewer: {
    label: '研究用户',
    shortLabel: '研究',
    description: '可检索证据并使用已授权的数据能力',
  },
}

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

interface HomeData {
  metrics: HeroMetric[]
  trends: TrendItem[]
  factors: FactorItem[]
  categories: CategoryItem[]
  biomarkerFrequencies: BiomarkerFrequencyItem[]
  targetCategoryOptions?: TargetCategoryOption[]
  keywords: FactorKeyword[]
  activity: ActivityItem[]
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEFAULT_SUBCLASS = '默认'
const TARGET_CATEGORY_ALL = 'all'
const DETAIL_COLUMN_WIDTH = 56
const DETAIL_COLUMN_MIN_WIDTH = 420
const BIOMARKER_CHART_PALETTE = [
  '#21669a',
  '#2c8584',
  '#52865f',
  '#7d8e47',
  '#b08036',
  '#aa6252',
  '#915e7c',
  '#67649a',
  '#477f9d',
  '#627f72',
  '#7f6e91',
  '#526e82',
]
const BIOMARKER_SORT_OPTIONS: { mode: BiomarkerSortMode; label: string }[] = [
  { mode: 'frequency', label: '高到低' },
  { mode: 'frequencyAsc', label: '低到高' },
  { mode: 'name', label: '名称' },
]

const mockHomeData: HomeData = {
  metrics: PLATFORM_OVERVIEW_METRICS.map((metric) => ({ ...metric })),
  trends: [
    {
      label: '抗生素',
      value: 4488,
      width: 100,
      color: '#1f77b4',
      docs: 55,
      markers: 133,
      targetClass: '药物类',
    },
    {
      label: '精神神经类药物',
      value: 3363,
      width: 75,
      color: '#496b9f',
      docs: 70,
      markers: 112,
      targetClass: '药物类',
    },
    {
      label: '降压药/心血管用药',
      value: 1885,
      width: 42,
      color: '#0e8f77',
      docs: 46,
      markers: 70,
      targetClass: '药物类',
    },
    {
      label: '烟草',
      value: 1799,
      width: 40,
      color: '#c67a19',
      docs: 64,
      markers: 20,
      targetClass: '消费品类',
    },
    {
      label: '阿片类药物',
      value: 1799,
      width: 40,
      color: '#6f5fa8',
      docs: 38,
      markers: 33,
      targetClass: '药物类',
    },
    {
      label: '平喘药/呼吸系统用药',
      value: 1291,
      width: 29,
      color: '#1291a8',
      docs: 19,
      markers: 13,
      targetClass: '药物类',
    },
    {
      label: '抗过敏药',
      value: 1270,
      width: 28,
      color: '#7a8792',
      docs: 18,
      markers: 9,
      targetClass: '药物类',
    },
    {
      label: '消炎镇痛药',
      value: 1263,
      width: 28,
      color: '#2f8f63',
      docs: 57,
      markers: 36,
      targetClass: '药物类',
    },
  ],
  factors: [
    {
      name: '可替宁',
      docs: 54,
      rows: 1296,
      type: '烟草',
      countries: 23,
      regions: 148,
      tone: '#c67a19',
    },
    {
      name: '磺胺甲噁唑',
      docs: 44,
      rows: 311,
      type: '抗生素',
      countries: 20,
      regions: 41,
      tone: '#1f77b4',
    },
    {
      name: '乙基硫酸酯',
      docs: 43,
      rows: 614,
      type: '酒精',
      countries: 27,
      regions: 104,
      tone: '#c67a19',
    },
    {
      name: '卡马西平',
      docs: 42,
      rows: 266,
      type: '精神神经类药物',
      countries: 21,
      regions: 41,
      tone: '#496b9f',
    },
    {
      name: '对乙酰氨基酚',
      docs: 41,
      rows: 290,
      type: '消炎镇痛药',
      countries: 19,
      regions: 35,
      tone: '#2f8f63',
    },
    {
      name: '甲氧苄啶',
      docs: 39,
      rows: 334,
      type: '抗生素',
      countries: 19,
      regions: 37,
      tone: '#0e8f77',
    },
    {
      name: '环丙沙星',
      docs: 33,
      rows: 280,
      type: '抗生素',
      countries: 20,
      regions: 27,
      tone: '#8a5b49',
    },
    {
      name: '阿替洛尔',
      docs: 33,
      rows: 205,
      type: '降压药/心血管用药',
      countries: 18,
      regions: 40,
      tone: '#7a8792',
    },
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
    {
      name: '抗生素',
      count: 4488,
      docs: 55,
      markers: 133,
      ratio: 100,
      tone: '#1f77b4',
      targetClass: '药物类',
      countries: 25,
      regions: 49,
      yearRange: '2004 ~ 2024',
    },
    {
      name: '精神神经类药物',
      count: 3363,
      docs: 70,
      markers: 112,
      ratio: 75,
      tone: '#496b9f',
      targetClass: '药物类',
      countries: 28,
      regions: 85,
      yearRange: '2004 ~ 2024',
    },
    {
      name: '降压药/心血管用药',
      count: 1885,
      docs: 46,
      markers: 70,
      ratio: 42,
      tone: '#0e8f77',
      targetClass: '药物类',
      countries: 21,
      regions: 79,
      yearRange: '2004 ~ 2024',
    },
    {
      name: '烟草',
      count: 1799,
      docs: 64,
      markers: 20,
      ratio: 40,
      tone: '#c67a19',
      targetClass: '消费品类',
      countries: 30,
      regions: 176,
      yearRange: '2009 ~ 2025',
    },
    {
      name: '阿片类药物',
      count: 1799,
      docs: 38,
      markers: 33,
      ratio: 40,
      tone: '#6f5fa8',
      targetClass: '药物类',
      countries: 19,
      regions: 72,
      yearRange: '2006 ~ 2024',
    },
    {
      name: '平喘药/呼吸系统用药',
      count: 1291,
      docs: 19,
      markers: 13,
      ratio: 29,
      tone: '#1291a8',
      targetClass: '药物类',
      countries: 11,
      regions: 78,
      yearRange: '2004 ~ 2024',
    },
    {
      name: '抗过敏药',
      count: 1270,
      docs: 18,
      markers: 9,
      ratio: 28,
      tone: '#8a5b49',
      targetClass: '药物类',
      countries: 13,
      regions: 48,
      yearRange: '2012 ~ 2024',
    },
    {
      name: '消炎镇痛药',
      count: 1263,
      docs: 57,
      markers: 36,
      ratio: 28,
      tone: '#2f8f63',
      targetClass: '药物类',
      countries: 23,
      regions: 52,
      yearRange: '2004 ~ 2024',
    },
  ],
  keywords: [],
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
const homeGuideOpen = ref(false)
const homeHeader = ref<InstanceType<typeof PlatformHeader> | null>(null)
const homeGuide = ref<InstanceType<typeof AcademicHomeGuide> | null>(null)
const authCard = ref<HTMLElement | null>(null)
const authPrimaryInput = ref<HTMLInputElement | null>(null)
const isAuthOpen = ref(false)
const isAuthenticated = ref(false)
const currentUser = ref('')
const currentUserRole = ref<UserResponse['role'] | ''>('')
const currentUserCanUpload = ref(false)
const currentUserCanReviewUploads = ref(false)
const currentUserCanSyncData = ref(false)
const currentUserCanDownload = ref(true)
const pendingAction = ref<PendingAction>(null)
const actionNotice = ref('')
const actionNoticeTitle = ref('')
const actionNoticeTone = ref<ActionNoticeTone>('success')
const loginComplete = ref(false)
const isUploadWorkspaceOpen = ref(false)
const selectedFileName = ref('')
const uploadNotice = ref('')
const currentOverviewIndex = ref(0)
const isOverviewPaused = ref(false)
const selectedBiomarkerName = ref('')
const selectedTargetCategory = ref(TARGET_CATEGORY_ALL)
const selectedSubclassName = ref('')
const biomarkerSortMode = ref<BiomarkerSortMode>('frequency')
const homeLoadState = ref<HomeLoadState>(HOME_OVERVIEW_API_ENABLED ? 'idle' : 'disabled')
const factorCloudState = ref<FactorCloudState>(
  HOME_OVERVIEW_API_ENABLED ? 'loading' : 'incompatible',
)
const homeLoadMessage = ref(
  HOME_OVERVIEW_API_ENABLED ? '' : '开发模式未启用首页接口，当前展示内置基准数据。',
)

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
const route = useRoute()
const vHomeReveal = homeReveal

const isAcademicHome = computed(() => true)

let codeTimer: number | undefined
let overviewTimer: number | undefined
let actionNoticeTimer: number | undefined
let homeRequestSequence = 0
let pendingRouteHashAlignment = ''
let authReturnFocus: HTMLElement | null = null

const isLogin = computed(() => mode.value === 'login')
const isRegister = computed(() => mode.value === 'register')
const isReset = computed(() => mode.value === 'reset')
const canAccessDataEntry = computed(
  () =>
    isAuthenticated.value &&
    (currentUserRole.value === 'admin' ||
      currentUserCanUpload.value ||
      currentUserCanReviewUploads.value ||
      currentUserCanSyncData.value),
)
const currentRolePresentation = computed<RolePresentation>(() => {
  if (currentUserRole.value) return ROLE_PRESENTATIONS[currentUserRole.value]
  return ROLE_PRESENTATIONS.viewer
})
const currentUserCapabilities = computed(() => {
  const capabilities: string[] = []
  if (currentUserCanDownload.value) capabilities.push('数据下载')
  if (currentUserCanUpload.value) capabilities.push('数据录入')
  if (currentUserCanReviewUploads.value) capabilities.push('上传审核')
  if (currentUserCanSyncData.value) capabilities.push('数据同步')
  return capabilities.length ? capabilities : ['开放检索']
})
const showHomeLoadFeedback = computed(() => homeLoadState.value !== 'success')
const canRetryHomeData = computed(() => ['empty', 'error', 'timeout'].includes(homeLoadState.value))
const needsCode = computed(() => isRegister.value || isReset.value)
const pageTitle = computed(() => {
  if (isRegister.value) return '注册账号'
  if (isReset.value) return '重置密码'
  return '登录 WBE 数据平台'
})
const authLead = computed(() => {
  if (pendingAction.value === 'operator') return '登录后可进入数据工作台，继续上传和校验数据。'
  return '登录后可按账号权限使用数据下载与维护功能。'
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
  () =>
    homeData.value.metrics[currentOverviewIndex.value] ??
    homeData.value.metrics[0] ??
    defaultMetric,
)
const overviewFocusCopy = computed(() => {
  const metric = activeMetric.value
  const valueText = `${metric.value}${metric.unit}`

  if (metric.key === 'docs') {
    return `${valueText}文献构成证据底座，可继续核对 DOI、研究年份与来源。`
  }
  if (metric.key === 'coverage') {
    return `${valueText}空间索引连接国家、地区与城市层级记录，支持跨尺度比较。`
  }
  if (metric.key === 'categories') {
    return `${valueText}目标物质已完成分类归并，可继续查看类别、子类与标记物证据。`
  }
  if (metric.key === 'markers') {
    return `${valueText}标记物条目连接类别、文献与空间覆盖信息，可回溯至原始证据。`
  }

  return `${metric.label}作为当前概览指标，用于定位数据库的主要覆盖面。`
})
const categoryFrequencyFallback = computed<BiomarkerFrequencyItem[]>(() => {
  const categories = homeData.value.categories?.length
    ? homeData.value.categories
    : mockHomeData.categories
  const keywords = homeData.value.keywords

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
    targetCategoryOptions.value[0] ?? { value: TARGET_CATEGORY_ALL, name: '全部' },
)
const rawBiomarkerFrequencies = computed<BiomarkerFrequencyItem[]>(() => {
  const fallback = categoryFrequencyFallback.value
  const supplied = homeData.value.biomarkerFrequencies ?? []
  const source =
    supplied.length && hasCategoryFrequencySource(supplied, fallback) ? supplied : fallback

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
        tone: BIOMARKER_CHART_PALETTE[index % BIOMARKER_CHART_PALETTE.length],
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
const biomarkerFrequencyAxisTicks = computed(() =>
  [...buildAxisTicks(biomarkerFrequencyAxisTop.value)].reverse(),
)
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
    title: '空间分布查询',
    value: '国家 · 地区 · 城市',
    detail: '按空间层级查看 PNDL 分布',
    target: 'map-visualization',
    route: '/map-visualization',
  },
  {
    icon: 'sankey',
    title: '疾病关联分析',
    value: 'ICD-11 五层关系',
    detail: '基于 ICD-11 分析疾病、药物与生物标记物的关联路径',
    target: 'icd11-sankey',
    route: '/icd11-sankey',
  },
  {
    icon: 'priority',
    title: '标记物优先级评估',
    value: '证据评分 · 证据缺口',
    detail: '依据证据评分识别核心标记物及证据短板',
    target: 'core-marker-priority',
    route: '/core-marker-priority',
  },
])
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

  return (
    items.some((item) => categoryNames.has(item.name)) ||
    items.some((item) => item.trend?.some((point) => !isYearBucket(point.period)))
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

function formatNumber(value?: number) {
  return new Intl.NumberFormat('zh-CN').format(value ?? 0)
}

async function loadHomeData() {
  if (!HOME_OVERVIEW_API_ENABLED) return

  const requestSequence = ++homeRequestSequence
  homeLoadState.value = 'loading'
  factorCloudState.value = 'loading'
  homeLoadMessage.value = '正在读取最新首页统计…'

  try {
    const result = await fetchHomeOverview<HomeData>({
      targetCategory: selectedTargetCategory.value,
    })
    if (requestSequence !== homeRequestSequence) return

    const hasOverviewData =
      Array.isArray(result.biomarkerFrequencies) && result.biomarkerFrequencies.length > 0

    const hasKeywordsField = Object.prototype.hasOwnProperty.call(result, 'keywords')
    const hasCompatibleKeywords = hasKeywordsField && Array.isArray(result.keywords)
    const keywords = hasCompatibleKeywords ? result.keywords! : []

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
      keywords,
      activity: result.activity?.length ? result.activity : mockHomeData.activity,
    }
    homeLoadState.value = hasOverviewData ? 'success' : 'empty'
    factorCloudState.value = !hasCompatibleKeywords
      ? 'incompatible'
      : keywords.length
        ? 'ready'
        : 'empty'
    homeLoadMessage.value = hasOverviewData
      ? ''
      : '首页接口暂时没有可展示的统计数据，当前保留内置基准数据。'

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
  } catch (error) {
    if (requestSequence !== homeRequestSequence) return
    if (error instanceof HomeOverviewRequestError) {
      const nextState: HomeLoadState =
        error.kind === 'timeout' || error.kind === 'unauthorized' ? error.kind : 'error'
      homeLoadState.value = nextState
      factorCloudState.value = 'error'
      homeLoadMessage.value = `${error.message} 当前保留内置基准数据。`
      return
    }
    homeLoadState.value = 'error'
    factorCloudState.value = 'error'
    homeLoadMessage.value = '首页数据加载失败，当前保留内置基准数据。'
  } finally {
    if (requestSequence === homeRequestSequence && pendingRouteHashAlignment) {
      const pendingHash = pendingRouteHashAlignment
      pendingRouteHashAlignment = ''
      scrollToRouteHash(pendingHash, false)
    }
  }
}

function retryHomeData() {
  void loadHomeData()
}

function focusOverview(index: number) {
  if (index < 0 || index >= homeData.value.metrics.length) return
  currentOverviewIndex.value = index
  isOverviewPaused.value = true
}

function releaseOverview() {
  isOverviewPaused.value = false
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
    setMessage('error', getUserErrorMessage(error, '图形验证码获取失败，请稍后重试'))
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

function focusAuthPrimaryInput() {
  void nextTick(() => authPrimaryInput.value?.focus({ preventScroll: true }))
}

function restoreAuthFocus() {
  if (authReturnFocus?.isConnected) authReturnFocus.focus({ preventScroll: true })
  authReturnFocus = null
}

function handleAuthKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeAuth()
    return
  }
  if (event.key !== 'Tab' || !authCard.value) return

  const focusable = [
    ...authCard.value.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]'),
  ].filter(
    (element) =>
      !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true',
  )
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
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

  authReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  homeGuide.value?.pause()
  isAuthOpen.value = true
  focusAuthPrimaryInput()
}

function closeAuth() {
  isAuthOpen.value = false
  if (!loginComplete.value) pendingAction.value = null
}

function dismissActionNotice() {
  actionNotice.value = ''
  actionNoticeTitle.value = ''
  if (actionNoticeTimer) {
    window.clearTimeout(actionNoticeTimer)
    actionNoticeTimer = undefined
  }
}

function showActionNotice(title: string, detail: string, tone: ActionNoticeTone = 'success') {
  dismissActionNotice()
  actionNoticeTitle.value = title
  actionNotice.value = detail
  actionNoticeTone.value = tone
  actionNoticeTimer = window.setTimeout(dismissActionNotice, 5200)
}

async function handleLogout() {
  const token = getStoredSession()?.token
  try {
    if (token) await requestLogout(token)
    showActionNotice('已退出登录', '已清除当前设备上的登录状态。', 'info')
  } catch {
    showActionNotice('已退出本地登录', '服务端会话已失效或暂不可用。', 'warning')
  } finally {
    clearSession()
    isAuthenticated.value = false
    currentUser.value = ''
    currentUserRole.value = ''
    currentUserCanUpload.value = false
    currentUserCanReviewUploads.value = false
    currentUserCanSyncData.value = false
    currentUserCanDownload.value = true
    pendingAction.value = null
    loginComplete.value = false
    isAuthOpen.value = false
    isUploadWorkspaceOpen.value = false
    window.dispatchEvent(new Event('wbe-auth-changed'))
  }
}

function returnToPrevious() {
  isAuthOpen.value = false
  showActionNotice(
    '登录成功',
    `${currentUser.value}，当前身份为${currentRolePresentation.value.label}。`,
  )
  pendingAction.value = null
}

function continueProtectedAction() {
  const action = pendingAction.value
  isAuthOpen.value = false
  pendingAction.value = null
  if (action) runProtectedAction(action)
}

function runProtectedAction(_action: Exclude<PendingAction, null>) {
  openUploadWorkspace()
}

function scrollToSection(id: string) {
  const target = document.getElementById(id)
  if (!target) return
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const top = target.getBoundingClientRect().top + window.scrollY - 120
  window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' })
}

function scrollToRouteHash(hash: string, trackDataShift = true) {
  const id = decodeURIComponent(hash.replace(/^#/, ''))
  if (!id) return
  if (trackDataShift) pendingRouteHashAlignment = hash
  void nextTick(() => {
    window.requestAnimationFrame(() => scrollToSection(id))
  })
}

function preloadMapVisualization() {
  void import('./MapVisualizationView.vue')
}

function preloadIcd11Sankey() {
  void import('./Icd11SankeyView.vue')
}

function preloadCoreMarkerPriority() {
  void import('./CoreMarkerPriorityView.vue')
}

function preloadVisualRoute(route?: string) {
  if (route === '/map-visualization') preloadMapVisualization()
  if (route === '/icd11-sankey') preloadIcd11Sankey()
  if (route === '/core-marker-priority') preloadCoreMarkerPriority()
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
    showActionNotice(
      '暂无工作台权限',
      '当前账号未开通上传、审核或同步能力，请联系系统管理员。',
      'warning',
    )
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
  const confirmPassword = isRegister.value
    ? registerForm.confirmPassword
    : resetForm.confirmPassword

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
    setMessage('error', getUserErrorMessage(error, '验证码发送失败，请稍后重试'))
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
      window.dispatchEvent(new Event('wbe-auth-changed'))
      isAuthenticated.value = true
      currentUser.value = result.data.user.username || result.data.user.email
      currentUserRole.value = result.data.user.role
      currentUserCanUpload.value = result.data.user.canUpload === true
      currentUserCanReviewUploads.value = result.data.user.canReviewUploads === true
      currentUserCanSyncData.value = result.data.user.canSyncData === true
      currentUserCanDownload.value = result.data.user.canDownload !== false
      if (homeLoadState.value === 'unauthorized') {
        void loadHomeData()
      }
      loginComplete.value = true
      isAuthOpen.value = false
      const action = pendingAction.value
      pendingAction.value = null
      if (action) {
        runProtectedAction(action)
      } else {
        showActionNotice(
          '登录成功',
          `${currentUser.value}，当前身份为${currentRolePresentation.value.label}。可用功能：${currentUserCapabilities.value.join('、')}。`,
        )
      }
    }
  } catch (error) {
    if (isCaptchaRequiredError(error)) {
      await refreshLoginCaptcha()
      setMessage('error', getUserErrorMessage(error, '请完成图形验证码后重试'))
      return
    }
    setMessage('error', getUserErrorMessage(error, '操作未完成，请稍后重试'))
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
  currentUserCanReviewUploads.value = session.user.canReviewUploads === true
  currentUserCanSyncData.value = session.user.canSyncData === true
  currentUserCanDownload.value = session.user.canDownload !== false
  try {
    const user = await fetchCurrentUser(session.token)
    updateStoredUser(user)
    currentUser.value = user.username || user.email
    currentUserRole.value = user.role
    currentUserCanUpload.value = user.canUpload === true
    currentUserCanReviewUploads.value = user.canReviewUploads === true
    currentUserCanSyncData.value = user.canSyncData === true
    currentUserCanDownload.value = user.canDownload !== false
  } catch {
    clearSession()
    isAuthenticated.value = false
    currentUser.value = ''
    currentUserRole.value = ''
    currentUserCanUpload.value = false
    currentUserCanReviewUploads.value = false
    currentUserCanSyncData.value = false
    currentUserCanDownload.value = true
  }
}

onMounted(() => {
  void hydrateSession()
  void loadHomeData()
  if (route.query.auth === 'login') openAuth()
  overviewTimer = window.setInterval(() => {
    if (isOverviewPaused.value) return
    const length = homeData.value.metrics.length || 1
    currentOverviewIndex.value = (currentOverviewIndex.value + 1) % length
  }, 3600)
  if (route.hash) scrollToRouteHash(route.hash)
})

watch(
  () => route.query.auth,
  (authMode) => {
    if (authMode === 'login') openAuth()
  },
)

watch(
  () => route.hash,
  (hash) => {
    if (hash) scrollToRouteHash(hash)
  },
)

onBeforeUnmount(() => {
  homeRequestSequence += 1
  if (codeTimer) window.clearInterval(codeTimer)
  if (overviewTimer) window.clearInterval(overviewTimer)
  if (actionNoticeTimer) window.clearTimeout(actionNoticeTimer)
})
</script>

<template>
  <main class="site-shell" :class="{ 'academic-home': isAcademicHome }">
    <PlatformHeader
      ref="homeHeader"
      active="home"
      :sticky="false"
      show-home-guide
      @request-home-guide="homeGuide?.start()"
      :variant="isAcademicHome ? 'academic' : 'legacy'"
      @request-auth="openAuth()"
      @logout="handleLogout"
    />

    <Transition name="account-notice">
      <aside
        v-if="actionNotice"
        class="account-notice"
        :class="`is-${actionNoticeTone}`"
        role="status"
        aria-live="polite"
      >
        <span class="account-notice-icon" aria-hidden="true"></span>
        <span class="account-notice-copy">
          <strong>{{ actionNoticeTitle }}</strong>
          <small>{{ actionNotice }}</small>
        </span>
        <button type="button" aria-label="关闭提示" @click="dismissActionNotice">×</button>
      </aside>
    </Transition>

    <AcademicHomeGuide
      ref="homeGuide"
      :return-focus-to="homeHeader?.homeGuideTrigger ?? null"
      :ready="!['idle', 'loading'].includes(homeLoadState)"
      :blocked="isAuthOpen"
      @open-change="homeGuideOpen = $event"
    />

    <AcademicIntroStage v-if="isAcademicHome">
      <AcademicHeroWorkspace
        @start="scrollToSection('visual-entry')"
        @browse="scrollToSection('visual')"
      />
      <AcademicAnalysisModules
        v-home-reveal
        :modules="visualEntryItems"
        @preload="preloadVisualRoute"
      />
    </AcademicIntroStage>

    <section
      v-else
      id="main-content"
      class="hero-section"
      aria-labelledby="heroTitle"
      tabindex="-1"
    >
      <div class="hero-copy">
        <p class="section-kicker">WBE DATA RESOURCE</p>
        <h1 id="heroTitle">面向污水流行病学的信息因子知识平台</h1>
        <p>
          整合 WBE 文献、目标物质、地区覆盖和生物标记物关系，支持数据检索、证据追踪和可视化分析。
        </p>
        <div class="hero-actions">
          <button type="button" class="primary-action" @click="scrollToSection('visual-entry')">
            进入可视化中心
          </button>
          <button type="button" class="secondary-action" @click="scrollToSection('visual')">
            浏览数据图谱
          </button>
        </div>
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
          <span>{{
            isAuthenticated
              ? '已登录：可按账号权限使用数据能力。'
              : '访客模式：公开检索与分析功能可用。'
          }}</span>
          <button type="button" @click="scrollToSection('visual')">查看图谱</button>
        </div>
      </div>
    </section>

    <section
      v-if="!isAcademicHome"
      id="visual-entry"
      class="glance-section"
      aria-labelledby="glanceTitle"
    >
      <div class="glance-inner">
        <div class="glance-heading">
          <div class="glance-title">
            <p class="section-kicker">VISUAL EVIDENCE</p>
            <h2 id="glanceTitle">可视化与证据分析</h2>
          </div>
        </div>
        <div class="glance-grid">
          <button
            v-for="item in visualEntryItems"
            :key="item.title"
            type="button"
            class="glance-item"
            :class="item.icon"
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

    <div :class="{ 'academic-factor-band': isAcademicHome }">
      <AcademicFactorCloud
        v-home-reveal="100"
        :items="homeData.keywords"
        :state="factorCloudState"
        :paused="homeGuideOpen"
        @retry="retryHomeData"
      />
    </div>

    <section
      v-home-reveal="100"
      id="evidence-distribution"
      class="evidence-chart-section"
      aria-labelledby="evidenceChartTitle"
    >
      <header class="academic-evidence-heading">
        <h2 id="evidenceChartTitle">类别与标记物证据分布</h2>
      </header>

      <article class="biomarker-chart-panel">
        <header class="biomarker-panel-head">
          <div>
            <strong>累计研究数</strong>
            <em
              >{{ formatNumber(biomarkerTotalFrequency) }} 次 DOI 去重研究，覆盖
              {{ biomarkerFrequencyItems.length }} 类目标物质</em
            >
          </div>
          <div class="joint-chart-toolbar" aria-label="证据分布图表控制">
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
            <label class="subclass-filter">
              <span>子类</span>
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
        </header>

        <div
          v-if="showHomeLoadFeedback"
          class="home-load-feedback"
          :class="`is-${homeLoadState}`"
          role="status"
          aria-live="polite"
        >
          <span class="home-load-feedback-icon" aria-hidden="true"></span>
          <p>{{ homeLoadMessage }}</p>
          <button v-if="canRetryHomeData" type="button" @click="retryHomeData">重新加载</button>
          <button v-else-if="homeLoadState === 'unauthorized'" type="button" @click="openAuth()">
            登录后重试
          </button>
        </div>

        <div class="biomarker-chart-layout">
          <section class="biomarker-bar-section" aria-label="目标物质类别 DOI 去重累计研究数">
            <header class="chart-column-heading">
              <strong>目标物质类别</strong>
              <span>点击类别更新右侧标记物分布</span>
            </header>
            <div class="frequency-chart-shell">
              <div class="frequency-x-axis" aria-hidden="true">
                <span v-for="tick in biomarkerFrequencyAxisTicks" :key="tick">{{
                  formatNumber(tick)
                }}</span>
              </div>
              <div class="frequency-plot-scroll">
                <TransitionGroup name="frequency-reorder" tag="div" class="frequency-plot">
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
                    <strong :title="item.name">{{ item.name }}</strong>
                    <span><i></i></span>
                    <em>{{ formatNumber(item.frequency) }}</em>
                  </button>
                </TransitionGroup>
              </div>
            </div>
          </section>

          <Transition name="evidence-detail" mode="out-in">
            <section
              :key="`${selectedBiomarker?.name ?? 'empty'}:${selectedSubclass?.name ?? DEFAULT_SUBCLASS}`"
              class="biomarker-detail-section"
              aria-live="polite"
            >
              <header class="chart-column-heading">
                <strong>{{ selectedBiomarker?.name ?? '暂无数据' }}</strong>
                <span
                  >{{ selectedBiomarker?.category ?? '未分类' }}，当前子类
                  {{ selectedSubclass?.name ?? DEFAULT_SUBCLASS }}</span
                >
              </header>

              <div class="line-stat-grid">
                <article>
                  <span>累计研究数</span
                  ><strong>{{ formatNumber(selectedBiomarker?.frequency) }}</strong>
                </article>
                <article>
                  <span>去重文献</span><strong>{{ formatNumber(selectedBiomarker?.docs) }}</strong>
                </article>
                <article>
                  <span>数据行</span><strong>{{ formatNumber(selectedBiomarker?.rows) }}</strong>
                </article>
              </div>

              <div
                v-if="selectedCategoryBiomarkerItems.length"
                :key="selectedBiomarker?.name"
                class="detail-bar-shell"
              >
                <div class="detail-chart-head">
                  <span>类别下生物标记物研究数</span>
                  <em>{{ selectedCategoryBiomarkerItems.length }} 项</em>
                </div>
                <div
                  class="detail-column-scroll"
                  role="img"
                  :aria-label="`${selectedBiomarker?.name ?? '目标物质类别'}下${selectedSubclass?.name ?? DEFAULT_SUBCLASS}子类生物标记物 DOI 去重累计研究数`"
                >
                  <div
                    class="detail-column-plot"
                    :style="{ '--detail-plot-width': detailColumnPlotWidth }"
                  >
                    <article
                      v-for="item in selectedCategoryBiomarkerItems"
                      :key="item.name"
                      class="detail-column-bar"
                      :style="{
                        '--detail-bar-height': item.barHeight,
                        '--detail-color': item.tone,
                      }"
                      :aria-label="`${item.name}，DOI 去重研究数 ${formatNumber(item.frequency)}`"
                    >
                      <strong>{{ formatNumber(item.frequency) }}</strong>
                      <div><i></i></div>
                      <span :title="item.name">{{ shortBiomarkerName(item.name) }}</span>
                    </article>
                  </div>
                </div>
              </div>
              <p v-else class="line-empty">暂无标记物数据</p>
            </section>
          </Transition>
        </div>
      </article>
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
              <input
                v-model.trim="uploadForm.batchName"
                type="text"
                placeholder="例如 2026-Q2 修订"
              />
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

    <span id="methods" class="route-anchor-sentinel" aria-hidden="true"></span>

    <AcademicFooter v-if="isAcademicHome" id="news" />

    <footer v-else id="news" class="site-footer">
      <div class="footer-brand">
        <BrandMark :size="32" compact />
        <span>
          <strong>污水信息因子数据库</strong>
          <p>服务于污水流行病学数据整合、公共健康研究和证据型决策。</p>
        </span>
      </div>
      <nav aria-label="页脚导航">
        <a href="#visual-entry">分析入口</a>
        <a href="#visual">图谱分析</a>
        <a href="#methods">方法与质量</a>
      </nav>
      <small>© 2026 Wastewater Biomarker Evidence · 字段版本与数据更新保持可追溯</small>
    </footer>

    <Teleport to="body">
      <Transition
        name="auth-modal"
        appear
        @after-enter="focusAuthPrimaryInput"
        @after-leave="restoreAuthFocus"
      >
        <div v-if="isAuthOpen" class="auth-overlay" role="presentation" @click.self="closeAuth">
        <section
          ref="authCard"
          class="auth-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="authTitle"
          tabindex="-1"
          @keydown="handleAuthKeydown"
        >
          <button class="close-button" type="button" aria-label="关闭登录窗口" @click="closeAuth">
            ×
          </button>
          <header class="auth-header">
            <BrandMark :size="44" variant="academic" />
            <h2 id="authTitle">{{ pageTitle }}</h2>
            <p>{{ authLead }}</p>
          </header>

          <form class="auth-form" @submit.prevent="handleSubmit">
            <Transition name="auth-panel" mode="out-in" @after-enter="focusAuthPrimaryInput">
              <div v-if="isLogin" key="login" class="auth-fields">
                <label>
                  <span>用户名 / 邮箱</span>
                  <input
                    ref="authPrimaryInput"
                    v-model.trim="loginForm.account"
                    type="text"
                    autocomplete="username"
                    placeholder="请输入用户名或邮箱"
                  />
                </label>

                <label>
                  <span>密码</span>
                  <div class="password-field">
                    <input
                      v-model.trim="loginForm.password"
                      :type="loginPasswordVisible ? 'text' : 'password'"
                      autocomplete="current-password"
                      placeholder="请输入密码"
                    />
                    <button
                      type="button"
                      :aria-label="loginPasswordVisible ? '隐藏密码' : '显示密码'"
                      @click="loginPasswordVisible = !loginPasswordVisible"
                    >
                      <span
                        class="eye-icon"
                        :class="{ visible: loginPasswordVisible }"
                        aria-hidden="true"
                      >
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
                    ref="authPrimaryInput"
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
                      {{
                        countdown > 0 ? `${countdown}s` : isSendingCode ? '发送中' : '发送验证码'
                      }}
                    </button>
                  </div>
                </label>
              </div>

              <div v-else key="reset" class="auth-fields">
                <label>
                  <span>邮箱</span>
                  <input
                    ref="authPrimaryInput"
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
                      {{
                        countdown > 0 ? `${countdown}s` : isSendingCode ? '发送中' : '发送验证码'
                      }}
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
                进入数据上传
              </button>
            </div>

            <div v-if="!loginComplete" class="action-links">
              <template v-if="isLogin">
                <button type="button" @click="setMode('reset')">忘记密码</button>
                <button type="button" @click="setMode('register')">没有账号？创建账号</button>
              </template>
              <button v-else-if="isRegister" type="button" @click="setMode('login')">
                已有账号？返回登录
              </button>
              <button v-else type="button" @click="setMode('login')">返回登录</button>
            </div>
          </form>
          </section>
        </div>
      </Transition>
    </Teleport>
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
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
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

#main-content,
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

.factor-list button {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
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
  min-width: 142px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 16px 0 13px;
  border: 1px solid rgba(12, 125, 111, 0.26);
  border-radius: 12px;
  color: #0a6f63;
  background: linear-gradient(145deg, #ffffff, #f1faf8);
  box-shadow: 0 8px 22px rgba(16, 71, 87, 0.08);
  white-space: nowrap;
}

.login-button-icon {
  position: relative;
  width: 27px;
  height: 27px;
  flex: 0 0 auto;
  border-radius: 9px;
  background: linear-gradient(145deg, #0e8d7b, #087063);
  box-shadow: 0 6px 14px rgba(11, 120, 104, 0.2);
}

.login-button-icon::before {
  position: absolute;
  top: 6px;
  left: 9px;
  width: 7px;
  height: 7px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  content: '';
}

.login-button-icon::after {
  position: absolute;
  right: 6px;
  bottom: 5px;
  left: 6px;
  height: 6px;
  border: 2px solid #ffffff;
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  content: '';
}

.login-button-copy {
  display: grid;
  gap: 1px;
  text-align: left;
}

.login-button-copy strong {
  font-size: 13px;
  line-height: 1.2;
}

.login-button-copy small {
  color: #68808d;
  font-size: 10px;
  font-weight: 800;
  line-height: 1.2;
}

.user-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.account-menu {
  position: relative;
  min-width: 148px;
}

.account-menu summary {
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 11px 5px 6px;
  border: 1px solid rgba(12, 125, 111, 0.2);
  border-radius: 12px;
  background: linear-gradient(145deg, #ffffff, #f4faf9);
  box-shadow: 0 8px 22px rgba(16, 71, 87, 0.07);
  cursor: pointer;
  list-style: none;
}

.account-menu summary::-webkit-details-marker {
  display: none;
}

.account-menu summary::after {
  margin-left: auto;
  color: #607684;
  content: '⌄';
  font-size: 13px;
  transition: transform 0.18s ease;
}

.account-menu[open] summary::after {
  transform: rotate(180deg);
}

.account-avatar {
  width: 35px;
  height: 35px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: #ffffff;
  background: linear-gradient(145deg, #159483, #087064);
  box-shadow: 0 6px 16px rgba(11, 120, 104, 0.2);
  font-size: 14px;
  font-weight: 900;
}

.account-avatar.large {
  width: 43px;
  height: 43px;
  border-radius: 13px;
  font-size: 17px;
}

.account-summary-copy {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.account-summary-copy small {
  color: #0b7868;
  font-size: 11px;
  font-weight: 900;
}

.account-summary-copy strong {
  max-width: 96px;
  overflow: hidden;
  color: #173247;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-menu-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 30;
  right: 0;
  left: auto;
  width: 286px;
  display: grid;
  gap: 13px;
  padding: 16px;
  border: 1px solid rgba(95, 124, 143, 0.18);
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 22px 54px rgba(21, 52, 72, 0.18);
}

.account-panel-head {
  display: flex;
  align-items: center;
  gap: 11px;
}

.account-panel-head > span:last-child {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.account-panel-head strong {
  overflow: hidden;
  color: #173247;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-panel-head small {
  color: #0b7868;
  font-size: 11px;
  font-weight: 900;
}

.account-menu-panel > p {
  margin: 0;
  color: #667e8c;
  font-size: 12px;
  line-height: 1.6;
}

.account-capabilities {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.account-capabilities span {
  padding: 4px 8px;
  border: 1px solid rgba(11, 120, 104, 0.15);
  border-radius: 999px;
  color: #0b6f63;
  background: #eef9f6;
  font-size: 10px;
  font-weight: 900;
}

.upload-entry {
  display: inline-flex;
  align-items: center;
  height: 42px;
  padding: 0 14px;
  border-radius: 8px;
  color: #ffffff;
  background: #0b7868;
  text-decoration: none;
  white-space: nowrap;
}

.logout-button {
  width: 100%;
  height: 40px;
  margin-top: 1px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid rgba(104, 126, 140, 0.14);
  border-radius: 10px;
  color: #173247;
  background: #eef4f7;
  text-align: left;
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

.login-button:hover {
  border-color: rgba(12, 125, 111, 0.42);
  background: #f2fbf9;
  box-shadow: 0 12px 28px rgba(13, 104, 95, 0.14);
}

.hero-section {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-columns: minmax(320px, 0.86fr) minmax(520px, 1.14fr);
  align-items: center;
  gap: clamp(32px, 6vw, 76px);
  min-height: clamp(480px, calc(72vh - 68px), 560px);
  padding: clamp(28px, 3.4vw, 44px) clamp(20px, 5vw, 70px) clamp(24px, 2.8vw, 34px);
  border-bottom: 1px solid rgba(104, 135, 154, 0.24);
  overflow: hidden;
}

.hero-section::before {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(
      90deg,
      rgba(246, 250, 252, 0.9) 0%,
      rgba(246, 250, 252, 0.68) 48%,
      rgba(246, 250, 252, 0.5) 100%
    ),
    url('/hero-research-bg-v2.webp') center bottom / cover no-repeat;
  content: '';
  opacity: 0.96;
  pointer-events: none;
}

.hero-copy {
  position: relative;
  z-index: 1;
  max-width: 660px;
}

.section-kicker {
  margin: 0 0 12px;
  color: #0b6f5f;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.hero-copy h1 {
  margin: 0;
  color: #102a3b;
  font-size: clamp(38px, 4vw, 54px);
  line-height: 1.1;
  letter-spacing: 0;
  text-wrap: balance;
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

.account-notice {
  position: fixed;
  top: 86px;
  right: clamp(16px, 3vw, 44px);
  z-index: 80;
  width: min(390px, calc(100vw - 32px));
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 28px;
  gap: 11px;
  align-items: center;
  padding: 13px 12px 13px 14px;
  border: 1px solid rgba(13, 128, 111, 0.2);
  border-radius: 15px;
  color: #173247;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 22px 60px rgba(17, 55, 74, 0.2);
  backdrop-filter: blur(16px);
}

.account-notice-icon {
  position: relative;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: #ffffff;
  background: linear-gradient(145deg, #159483, #087064);
}

.account-notice-icon::before {
  width: 13px;
  height: 7px;
  border-bottom: 2px solid currentColor;
  border-left: 2px solid currentColor;
  content: '';
  transform: translateY(-2px) rotate(-45deg);
}

.account-notice.is-info .account-notice-icon {
  background: linear-gradient(145deg, #3487b5, #21668d);
}

.account-notice.is-info .account-notice-icon::before {
  width: auto;
  height: auto;
  border: 0;
  content: 'i';
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
  font-size: 19px;
  font-weight: 900;
  transform: none;
}

.account-notice.is-warning {
  border-color: rgba(190, 126, 27, 0.25);
}

.account-notice.is-warning .account-notice-icon {
  background: linear-gradient(145deg, #d89b38, #ad6e18);
}

.account-notice.is-warning .account-notice-icon::before {
  width: auto;
  height: auto;
  border: 0;
  content: '!';
  font-size: 19px;
  font-weight: 900;
  transform: none;
}

.account-notice-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.account-notice-copy strong {
  color: #173247;
  font-size: 14px;
}

.account-notice-copy small {
  color: #607684;
  font-size: 12px;
  line-height: 1.5;
}

.account-notice > button {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  color: #758894;
  background: transparent;
  cursor: pointer;
  font-size: 19px;
}

.account-notice > button:hover {
  color: #173247;
  background: #edf4f5;
}

.account-notice-enter-active,
.account-notice-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}

.account-notice-enter-from,
.account-notice-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.98);
}

.insight-board {
  position: relative;
  z-index: 1;
  min-height: 364px;
  display: grid;
  align-content: stretch;
  overflow: hidden;
  border: 1px solid rgba(109, 139, 158, 0.22);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.86), rgba(244, 250, 251, 0.78)), #ffffff;
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
  background: linear-gradient(90deg, rgba(14, 143, 119, 0.12), rgba(15, 101, 145, 0.08)), #f7fbfc;
  backdrop-filter: blur(2px);
}

.overview-focus span {
  color: #0b6f5f;
  font-size: 12px;
  font-weight: 900;
}

.overview-focus strong {
  display: block;
  color: #173247;
  font-size: 20px;
  white-space: nowrap;
}

.overview-focus p {
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
  padding: 28px clamp(20px, 5vw, 70px) 34px;
  border-top: 1px solid rgba(104, 135, 154, 0.18);
  border-bottom: 1px solid rgba(104, 135, 154, 0.24);
  background: linear-gradient(180deg, #ffffff 0%, #f7fbfc 100%), #ffffff;
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
}

.glance-item {
  position: relative;
  min-height: 160px;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
  padding: 21px 18px 52px;
  border: 1px solid rgba(109, 139, 158, 0.18);
  border-radius: 10px;
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
    linear-gradient(135deg, rgba(239, 250, 247, 0.96), rgba(255, 255, 255, 0.98)), #ffffff;
  box-shadow: 0 18px 38px rgba(20, 73, 96, 0.16);
  outline: none;
  transform: translateY(-4px);
}

.glance-icon {
  position: relative;
  width: 64px;
  height: 64px;
  grid-row: 1;
  display: grid;
  place-items: center;
  border: 2px solid #1f638d;
  border-radius: 14px;
  background: #ffffff;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.glance-icon::before {
  color: #1f638d;
  font-size: 25px;
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

.glance-icon.priority::before {
  content: 'P';
}

.glance-icon.method::before {
  content: 'M';
}

.glance-item.priority .glance-copy strong {
  white-space: normal;
}

.glance-value {
  position: absolute;
  bottom: 22px;
  left: 102px;
  justify-self: start;
  padding: 5px 10px;
  border-radius: 999px;
  color: #ffffff;
  background: #0b7868;
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
  font-size: 20px;
  line-height: 1.2;
  white-space: normal;
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
  background: linear-gradient(180deg, #eef6f8 0%, #f7fbfc 100%), #f6fafb;
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
    linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(246, 251, 252, 0.96)), #ffffff;
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
    linear-gradient(135deg, rgba(237, 249, 246, 0.76), rgba(255, 255, 255, 0.96)), #ffffff;
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
  background: linear-gradient(90deg, rgba(14, 143, 119, 0.08), rgba(15, 101, 145, 0.04)), #ffffff;
}

.metadata-panel header span,
.factor-panel header span,
.category-panel header span,
.biomarker-panel-head span,
.upload-panel header span,
.review-panel header span {
  color: #0b6f5f;
  font-size: 13px;
  font-weight: 900;
}

.metadata-panel header strong,
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

.home-load-feedback {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(47, 112, 120, 0.18);
  border-radius: 8px;
  color: #36546d;
  background: #f4f9fa;
}

.home-load-feedback.is-error,
.home-load-feedback.is-timeout,
.home-load-feedback.is-unauthorized {
  border-color: rgba(183, 103, 44, 0.24);
  color: #7b4b27;
  background: #fff8f1;
}

.home-load-feedback-icon {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #2f7078;
  box-shadow: 0 0 0 4px rgba(47, 112, 120, 0.1);
}

.home-load-feedback.is-loading .home-load-feedback-icon {
  animation: feedback-pulse 1.2s ease-in-out infinite;
}

.home-load-feedback.is-error .home-load-feedback-icon,
.home-load-feedback.is-timeout .home-load-feedback-icon,
.home-load-feedback.is-unauthorized .home-load-feedback-icon {
  background: #b7672c;
  box-shadow: 0 0 0 4px rgba(183, 103, 44, 0.1);
}

.home-load-feedback p {
  min-width: 0;
  flex: 1;
  margin: 0;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.6;
}

.home-load-feedback button {
  flex: 0 0 auto;
  padding: 6px 10px;
  border: 1px solid currentColor;
  border-radius: 6px;
  color: inherit;
  background: transparent;
  font-size: 11px;
  font-weight: 900;
}

@keyframes feedback-pulse {
  50% {
    opacity: 0.45;
    transform: scale(0.8);
  }
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
  color: #0b6f5f;
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
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 252, 253, 0.98)), #ffffff;
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
  .account-notice {
    top: 140px;
  }

  .site-header {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 12px 24px;
  }

  .brand {
    grid-column: 1;
    grid-row: 1;
  }

  .main-nav {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-content: flex-start;
    overflow-x: auto;
  }

  .header-tools {
    grid-column: 2;
    grid-row: 1;
    justify-content: flex-end;
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
  .account-notice {
    top: 132px;
    right: 12px;
    width: calc(100vw - 24px);
  }

  .site-header {
    grid-template-columns: 1fr;
    padding: 14px 16px;
  }

  .brand {
    grid-column: 1;
    grid-row: 1;
  }

  .main-nav {
    display: none;
  }

  .header-tools {
    grid-column: 1;
    grid-row: 2;
    display: grid;
    grid-template-columns: 1fr auto;
  }

  .user-tools {
    grid-column: 1 / -1;
    justify-content: space-between;
  }

  .account-menu-panel {
    right: auto;
    left: 0;
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

  .home-load-feedback {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .home-load-feedback p {
    flex-basis: calc(100% - 24px);
  }

  .home-load-feedback button {
    margin-left: 18px;
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

  .site-footer nav {
    justify-content: flex-start;
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

.academic-home {
  min-height: 100dvh;
  color: #0b1f33;
  background: #ffffff;
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
}

:global(html:has(.academic-home)) {
  scroll-behavior: auto;
}

.academic-home .academic-evidence-section {
  max-width: 1440px;
  margin: 0 auto;
  padding: clamp(82px, 9vw, 124px) clamp(22px, 4.5vw, 72px) 96px;
  border-bottom: 0;
  background: transparent;
  scroll-margin-top: 92px;
}

.academic-home .academic-evidence-heading {
  max-width: none;
  display: grid;
  grid-template-columns: minmax(320px, 0.9fr) minmax(340px, 1.1fr);
  align-items: end;
  gap: clamp(28px, 5vw, 72px);
  margin-bottom: 42px;
  padding-top: 18px;
  border-top: 1px solid #bdc9d2;
}

.academic-home .academic-evidence-heading h2 {
  color: #0b1f33;
  font-size: clamp(32px, 3.5vw, 48px);
  font-weight: 710;
  letter-spacing: -0.043em;
  line-height: 1.12;
}

.academic-home .academic-evidence-heading > p {
  max-width: 46em;
  margin: 0;
  color: #56697a;
  font-size: 15px;
  line-height: 1.75;
  text-wrap: pretty;
}

.academic-home .visual-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 0 36px;
  align-items: start;
}

.academic-home .biomarker-panel-head {
  margin-bottom: 22px;
}

.academic-home .biomarker-panel-head span {
  color: #0b5f9d;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.academic-home .biomarker-panel-head strong {
  color: #0b1f33;
  font-size: 20px;
  font-weight: 720;
}

.academic-home .biomarker-chart-panel,
.academic-home .biomarker-chart-layout {
  display: contents;
}

.academic-home .biomarker-panel-head {
  grid-column: 6 / -1;
  grid-row: 1;
  align-self: start;
  padding: 26px 0 18px;
  border-top: 1px solid #bdc9d2;
}

.academic-home .biomarker-panel-head em {
  color: #637584;
  background: transparent;
}

.academic-home .home-load-feedback {
  grid-column: 6 / -1;
  grid-row: 2;
  margin-bottom: 14px;
  border-radius: 12px;
}

.academic-home .biomarker-bar-section {
  grid-column: 6 / -1;
  grid-row: 3;
  min-height: 490px;
  padding-bottom: 30px;
  border-bottom: 1px solid #d7e0e6;
}

.academic-home .frequency-plot {
  background: #ffffff;
}

.academic-home .frequency-bar {
  border-radius: 5px;
}

.academic-home .frequency-bar span {
  height: 14px;
  border-radius: 3px;
  background: #e8eef3;
}

.academic-home .frequency-bar i {
  border-radius: 3px;
  background: #3c82b5;
  box-shadow: none;
}

.academic-home .frequency-bar:hover i,
.academic-home .frequency-bar:focus-visible i,
.academic-home .frequency-bar.active i {
  background: #0b5f9d;
  box-shadow: none;
  filter: none;
}

.academic-home .frequency-bar:hover,
.academic-home .frequency-bar:focus-visible,
.academic-home .frequency-bar.active {
  background: #f5f8fa;
}

.academic-home .biomarker-filter-control select,
.academic-home .biomarker-sort-control button,
.academic-home .subclass-filter select {
  border-radius: 6px;
}

.academic-home .biomarker-sort-control button.active {
  background: #0b5f9d;
  box-shadow: none;
}

.academic-home .biomarker-detail-section {
  position: static;
  grid-column: 1 / -1;
  grid-row: 4;
  max-height: none;
  grid-template-columns: minmax(250px, 0.7fr) minmax(310px, 0.6fr) minmax(0, 1.7fr);
  grid-template-rows: auto;
  gap: clamp(28px, 4vw, 60px);
  align-items: start;
  margin-top: 52px;
  padding: 42px 0 0;
  border-top: 1px solid #bdc9d2;
  overflow: visible;
}

.academic-home .biomarker-detail-section > header {
  padding: 0;
  border: 0;
}

.academic-home .biomarker-detail-section > header strong {
  font-size: clamp(26px, 2.6vw, 38px);
  letter-spacing: -0.04em;
}

.academic-home .line-stat-grid {
  grid-template-columns: 1fr;
  gap: 0;
  border-top: 1px solid #c5d2d7;
}

.academic-home .line-stat-grid article {
  min-height: 70px;
  grid-template-columns: 1fr auto;
  align-items: center;
  padding: 10px 0;
  border: 0;
  border-bottom: 1px solid #c5d2d7;
  background: transparent;
}

.academic-home .line-stat-grid article strong {
  font-variant-numeric: tabular-nums;
  font-size: 22px;
}

.academic-home .detail-bar-shell {
  min-width: 0;
}

.academic-home .detail-column-bar > strong {
  border-radius: 4px;
  box-shadow: none;
}

.academic-home .detail-column-bar > div {
  border-radius: 4px 4px 0 0;
  background: #eef3f6;
  box-shadow: none;
}

.academic-home .detail-column-bar i {
  border-radius: 4px 4px 0 0;
  background: #3c82b5;
  box-shadow: none;
}

.academic-home .upload-workspace,
.academic-home .updates-section {
  max-width: 1440px;
  margin: 0 auto;
  padding: 92px clamp(22px, 4.5vw, 72px);
  background: transparent;
}

.academic-home .upload-panel,
.academic-home .review-panel {
  border-color: #c5d2d7;
  border-radius: 12px;
  box-shadow: none;
}

.academic-home .updates-section {
  border-top: 1px solid #bdc9d2;
}

.academic-home .updates-section .section-kicker {
  display: none;
}

.academic-home .updates-section .section-heading {
  max-width: 820px;
  margin-bottom: 46px;
}

.academic-home .updates-section .section-heading h2 {
  color: #0b1f33;
  font-size: clamp(30px, 3.4vw, 48px);
  font-weight: 710;
  letter-spacing: -0.043em;
}

.academic-home .update-list {
  grid-template-columns: 1fr;
  gap: 0;
}

.academic-home .update-list article {
  grid-template-columns: minmax(120px, 0.24fr) minmax(0, 1.76fr);
  gap: 34px;
  padding: 28px 0;
  border: 0;
  border-top: 1px solid #c5d2d7;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.academic-home .academic-site-footer {
  max-width: 1440px;
  display: block;
  margin: 0 auto;
  padding: 0 clamp(22px, 4.5vw, 72px);
  border-top: 1px solid #bdc9d2;
  color: #0b1f33;
  background: #ffffff;
}

.academic-footer-main {
  display: grid;
  grid-template-columns: minmax(280px, 1.5fr) minmax(170px, 0.72fr) minmax(150px, 0.62fr) minmax(
      230px,
      0.9fr
    );
  gap: clamp(30px, 5vw, 76px);
  padding: 52px 0 46px;
}

.academic-footer-brand {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-content: start;
  align-items: center;
  gap: 3px 12px;
}

.academic-footer-brand strong,
.academic-footer-main nav > strong,
.academic-footer-scope > strong {
  color: #0b1f33;
  font-size: 14px;
  font-weight: 740;
}

.academic-footer-brand small {
  display: block;
  margin-top: 3px;
  color: #71818f;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.academic-footer-brand p {
  grid-column: 1 / -1;
  max-width: 37em;
  margin: 20px 0 0;
  color: #607280;
  font-size: 12px;
  line-height: 1.72;
}

.academic-footer-main nav,
.academic-footer-scope {
  display: grid;
  align-content: start;
  justify-content: stretch;
  gap: 11px;
}

.academic-footer-main nav > strong,
.academic-footer-scope > strong {
  margin-bottom: 5px;
}

.academic-home .academic-footer-main a {
  color: #5b6d7c;
  font-size: 12px;
  font-weight: 580;
  line-height: 1.5;
  text-decoration: none;
}

.academic-home .academic-footer-main a:hover,
.academic-home .academic-footer-main a:focus-visible {
  color: #0b5f9d;
  outline: none;
}

.academic-footer-scope p {
  margin: 0;
  color: #607280;
  font-size: 12px;
  line-height: 1.72;
}

.academic-footer-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 0 24px;
  border-top: 1px solid #e0e7ec;
}

.academic-home .academic-footer-bottom small {
  color: #7a8996;
  font-size: 10px;
}

@media (max-width: 980px) {
  .academic-home .academic-evidence-heading {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .academic-home .visual-grid {
    grid-template-columns: 1fr;
    gap: 42px;
  }

  .academic-home .biomarker-panel-head,
  .academic-home .home-load-feedback,
  .academic-home .biomarker-bar-section,
  .academic-home .biomarker-detail-section {
    grid-column: 1;
    grid-row: auto;
  }

  .academic-home .biomarker-detail-section {
    grid-template-columns: 1fr;
    gap: 30px;
    margin-top: 4px;
  }

  .academic-home .line-stat-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .academic-home .line-stat-grid article {
    min-height: 84px;
    display: grid;
    grid-template-columns: 1fr;
    padding: 12px;
    border: 1px solid #c5d2d7;
  }

  .academic-footer-main {
    grid-template-columns: minmax(280px, 1.4fr) repeat(2, minmax(150px, 0.7fr));
  }

  .academic-footer-scope {
    grid-column: 1 / -1;
    padding-top: 24px;
    border-top: 1px solid #e0e7ec;
  }
}

@media (max-width: 620px) {
  .academic-home .academic-evidence-section {
    padding-inline: 20px;
  }

  .academic-home .biomarker-panel-head {
    grid-template-columns: 1fr;
  }

  .academic-home .line-stat-grid {
    grid-template-columns: 1fr;
  }

  .academic-home .update-list article {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .academic-footer-main {
    grid-template-columns: 1fr 1fr;
    gap: 34px 24px;
    padding-block: 42px 36px;
  }

  .academic-footer-brand,
  .academic-footer-scope {
    grid-column: 1 / -1;
  }

  .academic-footer-scope {
    padding-top: 22px;
  }

  .academic-footer-bottom {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .academic-home .frequency-bar,
  .academic-home .frequency-bar i {
    animation: none;
    transition: none;
  }
}

/* Academic home v2: pure white Swiss evidence layout. */
.academic-home {
  --academic-ink: #0b1f33;
  --academic-muted: #56697a;
  --academic-accent: #0b5f9d;
  --academic-line: #d7e0e6;
  --academic-soft: #f6f9fc;
  color: var(--academic-ink);
  background: #fff;
  font-family: var(--academic-font, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
}

.academic-home .evidence-chart-section {
  max-width: 1440px;
  margin: 0 auto;
  padding-inline: clamp(22px, 4.5vw, 72px);
  background: #fff;
}

.academic-home .academic-evidence-heading h2 {
  margin: 0;
  color: var(--academic-ink);
  font-weight: 680;
  letter-spacing: -0.04em;
  line-height: 1.12;
}

.academic-home .academic-evidence-heading p {
  margin: 0;
  color: var(--academic-muted);
  line-height: 1.65;
}

.academic-home .evidence-chart-section {
  padding-top: 66px;
  padding-bottom: 80px;
}

.academic-home .academic-evidence-heading {
  max-width: 760px;
  display: block;
  margin-bottom: 30px;
  padding-top: 16px;
  border-top: 1px solid #bdc9d2;
}

.academic-home .academic-evidence-heading h2 {
  font-size: clamp(31px, 3.5vw, 48px);
}

.academic-home .academic-evidence-heading p {
  max-width: 44em;
  margin-top: 14px;
  font-size: 15px;
}

.academic-home .biomarker-chart-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  border: 1px solid var(--academic-line);
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}

.academic-home .biomarker-panel-head {
  grid-column: auto;
  grid-row: auto;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 28px;
  margin: 0;
  padding: 20px 22px;
  border: 0;
  border-bottom: 1px solid var(--academic-line);
  background: #fff;
}

.academic-home .biomarker-panel-head > div:first-child {
  min-width: 170px;
  display: grid;
  gap: 5px;
}

.academic-home .biomarker-panel-head strong {
  color: var(--academic-ink);
  font-size: 18px;
  font-weight: 680;
}

.academic-home .biomarker-panel-head em {
  color: #677988;
  background: transparent;
  font-size: 11px;
  font-style: normal;
  font-weight: 560;
}

.academic-home .joint-chart-toolbar {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px 16px;
}

.academic-home .biomarker-filter-control,
.academic-home .biomarker-sort-control,
.academic-home .subclass-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #687b8b;
  font-size: 11px;
  font-weight: 650;
}

.academic-home .biomarker-filter-control > span,
.academic-home .biomarker-sort-control > span,
.academic-home .subclass-filter > span {
  color: #687b8b;
  font-size: 11px;
  font-weight: 650;
}

.academic-home .biomarker-filter-control select,
.academic-home .subclass-filter select {
  width: auto;
  max-width: 210px;
  height: 34px;
  padding: 0 30px 0 10px;
  border: 1px solid #cbd7df;
  border-radius: 7px;
  color: var(--academic-ink);
  background: #fff;
  font-size: 12px;
  font-weight: 600;
}

.academic-home .biomarker-sort-control button {
  min-width: 46px;
  height: 32px;
  padding: 0 9px;
  border: 1px solid #d4dee5;
  border-radius: 7px;
  color: #4e6475;
  background: #fff;
  font-size: 11px;
  font-weight: 650;
  box-shadow: none;
}

.academic-home .biomarker-sort-control button:hover,
.academic-home .biomarker-sort-control button:focus-visible {
  color: var(--academic-accent);
  border-color: #8eabc1;
  background: #f6f9fc;
  outline: none;
}

.academic-home .biomarker-sort-control button.active {
  color: #fff;
  border-color: var(--academic-accent);
  background: var(--academic-accent);
  box-shadow: none;
}

.academic-home .home-load-feedback {
  grid-column: auto;
  grid-row: auto;
  margin: 16px 22px 0;
  border-color: #cbd7df;
  border-radius: 8px;
  color: #40586b;
  background: #f6f9fc;
}

.academic-home .biomarker-chart-layout {
  grid-column: auto;
  grid-row: auto;
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  gap: 0;
  align-items: stretch;
}

.academic-home .biomarker-bar-section,
.academic-home .biomarker-detail-section {
  grid-column: auto;
  grid-row: auto;
  min-width: 0;
  min-height: 600px;
  padding: 22px;
  background: #fff;
}

.academic-home .biomarker-detail-section {
  position: static;
  top: auto;
  max-height: none;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr);
  align-self: stretch;
  gap: 16px;
  margin-top: 0;
  overflow: hidden;
  border-top: 0;
  border-left: 1px solid var(--academic-line);
}

.academic-home .chart-column-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  padding: 0 0 13px;
  border: 0;
  border-bottom: 1px solid #e3e9ed;
}

.academic-home .chart-column-heading strong {
  min-width: 0;
  color: var(--academic-ink);
  font-size: 15px;
  font-weight: 700;
}

.academic-home .chart-column-heading span {
  color: #71818f;
  font-size: 10px;
  font-weight: 560;
  text-align: right;
}

.academic-home .frequency-chart-shell {
  gap: 8px;
}

.academic-home .frequency-x-axis {
  padding-right: 42px;
  padding-left: clamp(120px, 36%, 178px);
  color: #7a8996;
  font-size: 10px;
  font-weight: 580;
}

.academic-home .frequency-plot {
  gap: 7px;
  background: #fff;
}

.academic-home .frequency-bar {
  min-height: 34px;
  grid-template-columns: minmax(110px, 0.38fr) minmax(0, 1fr) 38px;
  gap: 9px;
  padding: 3px 4px;
  border-radius: 6px;
  transform: none;
}

.academic-home .frequency-bar strong {
  overflow: hidden;
  color: #53697a;
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.academic-home .frequency-bar span {
  height: 12px;
  border-radius: 3px;
  background: #e8eef3;
}

.academic-home .frequency-bar i {
  border-radius: 3px;
  background: #3c82b5;
  box-shadow: none;
}

.academic-home .frequency-bar i::after {
  display: none;
}

.academic-home .frequency-bar:hover,
.academic-home .frequency-bar:focus-visible,
.academic-home .frequency-bar.active {
  background: #f5f8fa;
  transform: none;
}

.academic-home .frequency-bar:hover i,
.academic-home .frequency-bar:focus-visible i,
.academic-home .frequency-bar.active i {
  background: var(--academic-accent);
  filter: none;
  box-shadow: none;
}

.academic-home .frequency-bar em {
  color: #314b60;
  font-size: 11px;
  font-weight: 680;
}

.academic-home .line-stat-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  border-top: 1px solid var(--academic-line);
  border-bottom: 1px solid var(--academic-line);
}

.academic-home .line-stat-grid article {
  min-height: 72px;
  display: grid;
  align-content: center;
  gap: 6px;
  padding: 10px 14px;
  border: 0;
  border-right: 1px solid var(--academic-line);
  border-radius: 0;
  background: #fff;
}

.academic-home .line-stat-grid article:last-child {
  border-right: 0;
}

.academic-home .line-stat-grid span {
  color: #71818f;
  font-size: 10px;
  font-weight: 600;
}

.academic-home .line-stat-grid strong {
  color: var(--academic-ink);
  font-size: 21px;
  font-weight: 660;
  font-variant-numeric: tabular-nums;
}

.academic-home .detail-bar-shell {
  min-height: 0;
  gap: 10px;
  animation: trend-chart-enter 0.36s ease both;
}

.academic-home .detail-chart-head {
  align-items: baseline;
}

.academic-home .detail-chart-head span,
.academic-home .detail-chart-head em {
  color: #687b8b;
  font-size: 11px;
  font-weight: 620;
}

.academic-home .detail-column-plot {
  height: 350px;
  border-bottom-color: var(--academic-line);
}

.academic-home .detail-column-bar > strong {
  border-color: #d7e0e6;
  border-radius: 5px;
  color: #29445a;
  box-shadow: none;
}

.academic-home .detail-column-bar > div {
  border-radius: 4px 4px 0 0;
  background: #eef3f6;
  box-shadow: none;
}

.academic-home .detail-column-bar i {
  border-radius: 4px 4px 0 0;
  background: #3c82b5;
  box-shadow: none;
}

.academic-home .auth-card {
  border-color: #cbd7df;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 24px 62px rgba(11, 31, 51, 0.18);
}

.academic-home .auth-header h2 {
  color: var(--academic-ink);
  font-weight: 680;
}

.academic-home .auth-submit {
  background: var(--academic-accent);
  box-shadow: none;
}

.academic-home .action-links {
  justify-content: space-between;
}

.academic-home .action-links button {
  color: var(--academic-accent);
  font-size: 12px;
  font-weight: 650;
}

@media (max-width: 980px) {
  .academic-home .biomarker-panel-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .academic-home .joint-chart-toolbar {
    justify-content: flex-start;
  }

  .academic-home .biomarker-chart-layout {
    grid-template-columns: 1fr;
  }

  .academic-home .biomarker-bar-section,
  .academic-home .biomarker-detail-section {
    min-height: 0;
  }

  .academic-home .biomarker-detail-section {
    border-top: 1px solid var(--academic-line);
    border-left: 0;
  }
}

@media (max-width: 720px) {
  .academic-home .evidence-chart-section {
    padding-inline: 20px;
  }

  .academic-home .biomarker-panel-head,
  .academic-home .biomarker-bar-section,
  .academic-home .biomarker-detail-section {
    padding: 18px;
  }

  .academic-home .joint-chart-toolbar {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .academic-home .biomarker-filter-control,
  .academic-home .subclass-filter {
    display: grid;
    grid-template-columns: 46px minmax(0, 1fr);
  }

  .academic-home .biomarker-filter-control select,
  .academic-home .subclass-filter select {
    width: 100%;
    max-width: none;
  }

  .academic-home .biomarker-sort-control {
    flex-wrap: wrap;
  }

  .academic-home .chart-column-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }

  .academic-home .chart-column-heading span {
    text-align: left;
  }

  .academic-home .frequency-plot {
    min-width: 520px;
  }

  .academic-home .frequency-x-axis {
    min-width: 520px;
  }

  .academic-home .line-stat-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .academic-home .line-stat-grid article {
    min-height: 70px;
    padding-inline: 9px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .academic-home .detail-bar-shell,
  .academic-home .frequency-bar,
  .academic-home .frequency-bar i {
    animation: none;
    transition: none;
  }
}
</style>

<style scoped>
/* Authentication surface: calm institutional hierarchy with a clear modal layer. */
.auth-overlay {
  z-index: 2400;
  padding: 28px;
  background: rgba(8, 25, 38, 0.58);
  backdrop-filter: blur(10px) saturate(0.86);
  -webkit-backdrop-filter: blur(10px) saturate(0.86);
}

.auth-card {
  position: relative;
  width: min(560px, 100%);
  max-height: min(760px, calc(100dvh - 56px));
  padding: 38px 42px 34px;
  overflow: auto;
  border: 1px solid rgba(207, 221, 230, 0.96);
  border-radius: 10px;
  outline: none;
  background: rgba(255, 255, 255, 0.985);
  box-shadow: 0 24px 70px rgba(5, 25, 39, 0.28);
}

.auth-card::before {
  position: absolute;
  top: 0;
  right: 42px;
  left: 42px;
  height: 3px;
  content: '';
  background: #0b5f9d;
}

.close-button {
  top: 18px;
  right: 18px;
  width: 36px;
  height: 36px;
  border-color: #d4e0e7;
  border-radius: 10px;
  color: #718391;
  background: #f7fafc;
  font-size: 20px;
}

.close-button:hover,
.close-button:focus-visible {
  border-color: #a9c1d2;
  color: #173247;
  outline: none;
  background: #edf4f8;
  box-shadow: 0 0 0 3px rgba(11, 95, 157, 0.1);
}

.auth-header {
  gap: 9px;
  margin-bottom: 28px;
  padding-right: 52px;
}

.auth-header :deep(.site-emblem) {
  margin-bottom: 7px;
}

.auth-header h2,
.academic-home .auth-header h2 {
  color: #102c42;
  font-size: clamp(26px, 3vw, 30px);
  font-weight: 690;
  letter-spacing: -0.035em;
  line-height: 1.18;
}

.auth-header p {
  max-width: 42ch;
  color: #667c8b;
  font-size: 14px;
  line-height: 1.65;
  text-wrap: pretty;
}

.auth-form {
  gap: 18px;
}

.auth-fields {
  gap: 18px;
}

.auth-form label {
  gap: 8px;
  color: #29475b;
  font-size: 13px;
  font-weight: 680;
}

.auth-form input {
  height: 50px;
  padding: 0 15px;
  border-color: #c9d7e0;
  border-radius: 10px;
  color: #173247;
  background: #ffffff;
  font-size: 15px;
}

.auth-form input::placeholder {
  color: #8b9ca8;
  opacity: 1;
  transition: opacity 140ms ease;
}

.auth-form input:focus::placeholder {
  opacity: 0;
}

.auth-form input:focus,
.password-field:focus-within {
  border-color: #317bad;
  box-shadow: 0 0 0 4px rgba(11, 95, 157, 0.11);
}

.password-field {
  grid-template-columns: minmax(0, 1fr) 48px;
  border-color: #c9d7e0;
  border-radius: 10px;
}

.password-field input {
  border-radius: 10px 0 0 10px;
}

.password-field button {
  min-height: 48px;
  border-left: 0;
  border-radius: 8px;
  color: #708594;
  transition:
    color 160ms ease,
    background 160ms ease;
}

.password-field button:hover,
.password-field button:focus-visible {
  color: #245f8e;
  outline: none;
  background: #edf4f8;
}

.eye-icon {
  width: 18px;
  height: 11px;
  border-width: 1.4px;
  border-radius: 55% / 70%;
}

.eye-icon i {
  top: 2.6px;
  left: 6.1px;
  width: 3.5px;
  height: 3.5px;
}

.eye-icon::after {
  right: -2px;
  left: -2px;
  top: 4px;
  height: 1.4px;
  box-shadow: 0 0 0 1.5px #ffffff;
  transform: rotate(-34deg);
  transition: opacity 140ms ease;
}

.auth-submit,
.academic-home .auth-submit {
  min-height: 52px;
  border-radius: 10px;
  background: #0b5f9d;
  box-shadow: none;
  font-size: 15px;
  font-weight: 700;
}

.auth-submit:hover,
.auth-submit:focus-visible {
  outline: none;
  background: #0d568f;
  box-shadow: 0 0 0 4px rgba(11, 95, 157, 0.1);
}

.auth-submit:active {
  transform: translateY(1px) scale(0.995);
}

.action-links {
  justify-content: space-between;
  gap: 12px 20px;
  padding-top: 2px;
}

.action-links button,
.academic-home .action-links button {
  min-height: 32px;
  padding: 0;
  border-radius: 0;
  color: #24638f;
  font-size: 12px;
  font-weight: 650;
}

.action-links button:hover,
.action-links button:focus-visible {
  color: #0b3f68;
  outline: none;
  text-decoration: underline;
  text-underline-offset: 4px;
}

.auth-modal-enter-active,
.auth-modal-leave-active {
  transition: opacity 280ms ease;
}

.auth-modal-enter-active .auth-card,
.auth-modal-leave-active .auth-card {
  transition:
    opacity 260ms ease,
    transform 380ms cubic-bezier(0.22, 1, 0.36, 1);
}

.auth-modal-enter-from,
.auth-modal-leave-to,
.auth-modal-enter-from .auth-card,
.auth-modal-leave-to .auth-card {
  opacity: 0;
}

.auth-modal-enter-from .auth-card {
  transform: translateY(22px) scale(0.965);
}

.auth-modal-leave-to .auth-card {
  transform: translateY(12px) scale(0.985);
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .auth-overlay {
    background: rgba(8, 25, 38, 0.78);
  }
}

@media (max-width: 600px) {
  .auth-overlay {
    align-items: end;
    padding: 14px;
  }

  .auth-card {
    width: 100%;
    max-height: calc(100dvh - 28px);
    padding: 30px 22px 24px;
    border-radius: 10px;
  }

  .auth-card::before {
    right: 22px;
    left: 22px;
  }

  .auth-header {
    margin-bottom: 22px;
    padding-right: 42px;
  }

  .auth-header h2,
  .academic-home .auth-header h2 {
    font-size: 25px;
  }

  .auth-form input {
    height: 48px;
  }

  .auth-submit,
  .academic-home .auth-submit {
    min-height: 50px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-modal-enter-active,
  .auth-modal-leave-active,
  .auth-modal-enter-active .auth-card,
  .auth-modal-leave-active .auth-card,
  .auth-form input::placeholder,
  .password-field button,
  .eye-icon::after {
    transition: none;
  }
}
</style>

<style scoped>
/* Keep the sharp homepage radius contract authoritative after legacy layers. */
.academic-home .biomarker-chart-panel,
.academic-home .biomarker-filter-control select,
.academic-home .subclass-filter select,
.academic-home .biomarker-sort-control button,
.academic-home .home-load-feedback,
.academic-home .frequency-bar,
.academic-home .frequency-bar span,
.academic-home .frequency-bar i,
.academic-home .detail-column-bar > strong,
.academic-home .detail-column-bar > div,
.academic-home .detail-column-bar i {
  border-radius: 0;
}
</style>

<style scoped>
/* Light scientific homepage: sharp structure, restrained viewport motion. */
:global(.home-reveal) {
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 600ms cubic-bezier(0.22, 1, 0.36, 1) var(--home-reveal-delay, 0ms),
    transform 600ms cubic-bezier(0.22, 1, 0.36, 1) var(--home-reveal-delay, 0ms);
}

:global(.home-reveal.is-revealed) {
  opacity: 1;
  transform: translateY(0);
}

:global(.academic-modules.home-reveal .academic-module) {
  opacity: 0;
  transform: translateY(14px);
  transition:
    opacity 520ms ease,
    transform 520ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 200ms ease,
    box-shadow 200ms ease;
}

:global(.academic-modules.home-reveal.is-revealed .academic-module) {
  opacity: 1;
  transform: translateY(0);
}

:global(.academic-modules.home-reveal.is-revealed .academic-module:nth-child(2)) {
  transition-delay: 100ms;
}

:global(.academic-modules.home-reveal.is-revealed .academic-module:nth-child(3)) {
  transition-delay: 200ms;
}

.academic-home .evidence-chart-section {
  position: relative;
  max-width: 1200px;
  isolation: isolate;
  background: linear-gradient(180deg, #edf3f6 0%, #f2f6f8 55%, #eef4f6 100%);
  box-shadow: 0 0 0 100vmax #edf3f6;
  clip-path: inset(0 -100vmax);
}

.academic-home .evidence-chart-section::before {
  position: absolute;
  top: -42px;
  right: -100vw;
  left: -100vw;
  z-index: -1;
  height: 72px;
  content: '';
  background: linear-gradient(180deg, rgba(237, 243, 246, 0) 0, #edf3f6 100%);
  pointer-events: none;
}

.academic-home .evidence-chart-section::after {
  display: none;
}

.academic-home .academic-evidence-heading {
  padding-top: 22px;
}

.academic-home .biomarker-chart-panel {
  border-radius: 0;
  box-shadow: 0 10px 30px rgba(29, 65, 87, 0.055);
}

.academic-home .biomarker-filter-control select,
.academic-home .subclass-filter select,
.academic-home .biomarker-sort-control button,
.academic-home .home-load-feedback,
.academic-home .frequency-bar,
.academic-home .frequency-bar span,
.academic-home .frequency-bar i,
.academic-home .detail-column-bar > strong,
.academic-home .detail-column-bar > div,
.academic-home .detail-column-bar i {
  border-radius: 0;
}

.academic-home :deep(.academic-analysis-submenu),
.academic-home :deep(.academic-analysis-submenu a),
.academic-home :deep(.platform-menu-button),
.academic-home :deep(.platform-navigation),
.academic-home :deep(.platform-navigation a),
.academic-home :deep(.platform-home-guide-button) {
  border-radius: 0;
}

@media (prefers-reduced-motion: reduce) {
  :global(.home-reveal),
  :global(.academic-modules.home-reveal .academic-module) {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
</style>

<style scoped>
/* Final v3 ordering overrides. Kept separate so the latest academic layer remains authoritative. */
.route-anchor-sentinel {
  display: block;
  width: 1px;
  height: 0;
  overflow: hidden;
  scroll-margin-top: 92px;
}

.academic-home .evidence-chart-section {
  padding-top: 42px;
  padding-bottom: 72px;
  scroll-margin-top: 92px;
}

.academic-home .academic-evidence-heading {
  max-width: 700px;
  margin-bottom: 24px;
  border-top: 0;
}

.academic-home .academic-evidence-heading h2 {
  font-size: clamp(29px, 3vw, 41px);
}

.academic-home .biomarker-chart-panel {
  border-radius: 0;
}

.academic-home .frequency-bar i {
  background: var(--bar-color, #21669a);
  opacity: 1;
}

.academic-home .frequency-bar:hover i,
.academic-home .frequency-bar:focus-visible i,
.academic-home .frequency-bar.active i {
  background: var(--bar-color, #21669a);
  opacity: 1;
  filter: saturate(1.12) brightness(0.88);
}

.academic-home .detail-column-bar i {
  background: var(--detail-color, #21669a);
  opacity: 1;
}

.academic-home .detail-column-bar:hover i,
.academic-home .detail-column-bar:focus-within i {
  opacity: 1;
  filter: saturate(1.1) brightness(0.9);
}

@media (max-width: 620px) {
  .academic-home .evidence-chart-section {
    padding-top: 34px;
    padding-bottom: 58px;
  }
}
</style>

<style scoped>
/* Continuous scientific canvas and final homepage motion layer. */
.academic-home {
  position: relative;
  isolation: isolate;
  overflow: clip;
  background: linear-gradient(180deg, #ffffff 0, #f8fbfc 37%, #f4f9fa 72%, #ffffff 100%);
}

.academic-home :deep(.academic-intro-stage) {
  background: #fff;
}

.academic-home :deep(.academic-intro-stage::after) {
  display: none;
}

.academic-home .evidence-chart-section {
  position: relative;
  max-width: 1200px;
  padding-right: clamp(20px, 3vw, 40px);
  padding-left: clamp(20px, 3vw, 40px);
  padding-top: 88px;
  padding-bottom: 96px;
  background: transparent;
  box-shadow: none;
  clip-path: none;
}

.academic-home .evidence-chart-section::before {
  top: 0;
  right: clamp(20px, 3vw, 40px);
  left: clamp(20px, 3vw, 40px);
  z-index: 0;
  width: auto;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(94, 128, 147, 0.34) 14%,
    rgba(94, 128, 147, 0.34) 86%,
    transparent
  );
}

.academic-home .academic-evidence-heading {
  position: relative;
  z-index: 1;
  max-width: 820px;
  margin-bottom: 34px;
  padding-top: 0;
}

.academic-home .academic-evidence-heading h2 {
  font-size: clamp(40px, 4.25vw, 52px);
  line-height: 1.08;
  letter-spacing: -0.052em;
}

.academic-home .biomarker-chart-panel {
  position: relative;
  z-index: 1;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 24px 72px rgba(19, 57, 78, 0.08);
}

:global(.home-reveal) {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity 650ms cubic-bezier(0.22, 1, 0.36, 1) var(--home-reveal-delay, 0ms),
    transform 650ms cubic-bezier(0.22, 1, 0.36, 1) var(--home-reveal-delay, 0ms);
}

:global(.academic-modules.home-reveal .academic-modules-heading),
:global(.academic-modules.home-reveal .academic-module-copy),
:global(.academic-modules.home-reveal .academic-module-visual) {
  opacity: 0;
  transform: translateY(18px);
  clip-path: inset(0 4% 0 4%);
}

:global(.academic-modules.home-reveal.is-revealed .academic-modules-heading),
:global(.academic-modules.home-reveal.is-revealed .academic-module-copy),
:global(.academic-modules.home-reveal.is-revealed .academic-module-visual) {
  opacity: 1;
  transform: translateY(0);
  clip-path: inset(0);
  transition:
    opacity 650ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 650ms cubic-bezier(0.22, 1, 0.36, 1),
    clip-path 720ms cubic-bezier(0.22, 1, 0.36, 1);
}

:global(.academic-modules.home-reveal.is-revealed .academic-module::before) {
  transform: scaleX(1);
}

:global(.academic-modules.home-reveal.is-revealed .academic-module-copy) {
  transition-delay: 80ms;
}

:global(.academic-modules.home-reveal.is-revealed .academic-module-visual) {
  transition-delay: 160ms;
}

@media (max-width: 720px) {
  .academic-home .evidence-chart-section {
    padding-top: 62px;
    padding-bottom: 68px;
  }

  .academic-home .academic-evidence-heading h2 {
    font-size: clamp(30px, 9vw, 34px);
  }
}

@media (prefers-reduced-motion: reduce) {
  :global(.home-reveal),
  :global(.academic-modules.home-reveal .academic-modules-heading),
  :global(.academic-modules.home-reveal .academic-module-copy),
  :global(.academic-modules.home-reveal .academic-module-visual) {
    opacity: 1;
    transform: none;
    clip-path: none;
    transition: none;
  }
}
</style>

<style scoped>
/* Evidence workspace refinement: open layout, balanced type and animated reordering. */
.academic-home .biomarker-chart-panel {
  overflow: visible;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.academic-home .biomarker-panel-head {
  position: relative;
  align-items: center;
  gap: 28px;
  padding: 0 0 25px 18px;
  border-bottom: 1px solid rgba(113, 143, 160, 0.32);
  background: transparent;
}

.academic-home .biomarker-panel-head::before {
  position: absolute;
  top: 2px;
  bottom: 25px;
  left: 0;
  width: 3px;
  content: '';
  background: linear-gradient(180deg, #2378a8, #2f9a80);
}

.academic-home .biomarker-panel-head > div:first-child {
  min-width: 210px;
  gap: 7px;
}

.academic-home .biomarker-panel-head strong {
  font-size: 20px;
  line-height: 1.25;
}

.academic-home .biomarker-panel-head em {
  font-size: 12px;
  line-height: 1.6;
}

.academic-home .joint-chart-toolbar {
  display: grid;
  grid-template-columns: minmax(190px, 1fr) auto minmax(210px, 1fr);
  align-items: center;
  justify-content: end;
  gap: 12px;
}

.academic-home .biomarker-filter-control,
.academic-home .biomarker-sort-control,
.academic-home .subclass-filter {
  min-width: 0;
  gap: 7px;
}

.academic-home .biomarker-filter-control > span,
.academic-home .biomarker-sort-control > span,
.academic-home .subclass-filter > span {
  flex: 0 0 auto;
  white-space: nowrap;
}

.academic-home .biomarker-filter-control select,
.academic-home .subclass-filter select {
  width: 100%;
  max-width: none;
  height: 38px;
  background-color: rgba(255, 255, 255, 0.72);
  transition:
    border-color 180ms ease,
    background-color 180ms ease;
}

.academic-home .biomarker-sort-control {
  display: grid;
  grid-template-columns: auto repeat(3, minmax(48px, auto));
  gap: 4px;
}

.academic-home .biomarker-sort-control button {
  min-width: 50px;
  height: 38px;
  transition:
    color 180ms ease,
    border-color 180ms ease,
    background-color 180ms ease,
    transform 180ms ease;
}

.academic-home .biomarker-sort-control button:active {
  transform: translateY(1px);
}

.academic-home .biomarker-sort-control button.active {
  border-color: #2b816f;
  background: #2b816f;
  animation: evidence-sort-select 320ms cubic-bezier(0.22, 1, 0.36, 1);
}

.academic-home .biomarker-chart-layout {
  position: relative;
  gap: 28px;
  padding-top: 28px;
  background: transparent;
}

.academic-home .biomarker-chart-layout::after {
  position: absolute;
  top: 50%;
  left: calc(41.666% + 1px);
  width: 25px;
  height: 1px;
  content: '';
  background: linear-gradient(90deg, rgba(48, 124, 111, 0.16), rgba(48, 124, 111, 0.6));
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.academic-home .biomarker-bar-section,
.academic-home .biomarker-detail-section {
  min-height: 580px;
  padding: 26px;
  border: 0;
  border-top: 1px solid rgba(113, 143, 160, 0.28);
  background:
    linear-gradient(180deg, rgba(246, 250, 251, 0.78), rgba(255, 255, 255, 0.48)),
    rgba(255, 255, 255, 0.34);
  box-shadow: 0 18px 52px rgba(23, 62, 83, 0.035);
}

.academic-home .biomarker-detail-section {
  position: relative;
  border-left: 0;
}

.academic-home .biomarker-detail-section::before {
  position: absolute;
  top: -1px;
  left: 0;
  width: 86px;
  height: 2px;
  content: '';
  background: linear-gradient(90deg, #2f8f79, rgba(47, 143, 121, 0));
}

.academic-home .chart-column-heading {
  min-height: 52px;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
}

.academic-home .chart-column-heading strong {
  max-width: 68%;
  overflow-wrap: anywhere;
  font-size: clamp(18px, 1.6vw, 24px);
  line-height: 1.28;
  letter-spacing: -0.025em;
}

.academic-home .biomarker-detail-section > .chart-column-heading strong {
  font-size: clamp(21px, 1.85vw, 28px);
  letter-spacing: -0.03em;
}

.academic-home .chart-column-heading span {
  max-width: 44%;
  font-size: 11px;
  line-height: 1.55;
}

.academic-home .frequency-plot {
  position: relative;
}

.academic-home .frequency-bar {
  transition:
    transform 480ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 180ms ease;
}

:global(.frequency-reorder-move) {
  transition: transform 480ms cubic-bezier(0.22, 1, 0.36, 1);
}

:global(.frequency-reorder-enter-active),
:global(.frequency-reorder-leave-active) {
  transition:
    opacity 260ms ease,
    transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
}

:global(.frequency-reorder-enter-from),
:global(.frequency-reorder-leave-to) {
  opacity: 0;
  transform: translateY(10px);
}

:global(.evidence-detail-enter-active),
:global(.evidence-detail-leave-active) {
  transition:
    opacity 230ms ease,
    transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
}

:global(.evidence-detail-enter-from) {
  opacity: 0;
  transform: translateX(16px);
}

:global(.evidence-detail-leave-to) {
  opacity: 0;
  transform: translateX(-8px);
}

@keyframes evidence-sort-select {
  0% {
    transform: scale(0.96);
  }
  64% {
    transform: scale(1.035);
  }
  100% {
    transform: scale(1);
  }
}

@media (max-width: 1120px) {
  .academic-home .biomarker-panel-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .academic-home .joint-chart-toolbar {
    width: 100%;
    grid-template-columns: minmax(190px, 1fr) auto minmax(210px, 1fr);
    justify-content: stretch;
  }
}

@media (max-width: 980px) {
  .academic-home .biomarker-chart-layout {
    gap: 22px;
  }

  .academic-home .biomarker-chart-layout::after {
    display: none;
  }

  .academic-home .biomarker-detail-section {
    border-top: 1px solid rgba(113, 143, 160, 0.28);
  }
}

@media (max-width: 700px) {
  .academic-home .biomarker-panel-head {
    padding-left: 14px;
  }

  .academic-home .joint-chart-toolbar {
    grid-template-columns: 1fr;
  }

  .academic-home .biomarker-sort-control {
    grid-template-columns: 46px repeat(3, 1fr);
  }

  .academic-home .biomarker-bar-section,
  .academic-home .biomarker-detail-section {
    min-height: 0;
    padding: 20px 16px;
  }

  .academic-home .chart-column-heading {
    align-items: flex-start;
    flex-direction: column;
    min-height: 0;
    gap: 6px;
  }

  .academic-home .chart-column-heading strong,
  .academic-home .chart-column-heading span {
    max-width: 100%;
    text-align: left;
  }
}

@media (prefers-reduced-motion: reduce) {
  .academic-home .frequency-bar,
  .academic-home .biomarker-sort-control button.active,
  :global(.frequency-reorder-move),
  :global(.frequency-reorder-enter-active),
  :global(.frequency-reorder-leave-active),
  :global(.evidence-detail-enter-active),
  :global(.evidence-detail-leave-active) {
    transition: none;
    animation: none;
  }
}
</style>

<style scoped>
/* Authoritative full-width blue/white section separation. */
.academic-home {
  background: #fff;
}

.academic-home .academic-factor-band {
  position: relative;
  z-index: 1;
  width: 100%;
  border: 0;
  background: #ffffff;
}

.academic-home .academic-factor-band :deep(.factor-cloud-section) {
  padding-top: 44px;
  padding-bottom: 48px;
}

.academic-home .academic-factor-band :deep(.factor-cloud-section::before) {
  display: none;
}

.academic-home .evidence-chart-section {
  position: relative;
  max-width: 1200px;
  padding-top: 82px;
  padding-bottom: 92px;
  background: #176ca7;
  box-shadow: 0 0 0 100vmax #176ca7;
  clip-path: inset(0 -100vmax);
}

.academic-home .evidence-chart-section::before,
.academic-home .evidence-chart-section::after {
  display: none;
}

.academic-home .academic-evidence-heading {
  max-width: none;
  display: block;
  margin-bottom: 38px;
}

.academic-home .academic-evidence-heading h2 {
  color: #ffffff;
  font-size: clamp(36px, 3.2vw, 46px);
  letter-spacing: -0.045em;
  line-height: 1.16;
}

.academic-home .academic-evidence-heading p {
  max-width: none;
  margin: 0;
  color: #e5f2f8;
  font-size: 14px;
  line-height: 1.75;
}

.academic-home .evidence-chart-section .biomarker-chart-panel {
  display: grid;
  gap: 0;
  padding: clamp(24px, 3vw, 36px);
  background: #ffffff;
  box-shadow: 0 22px 56px rgba(4, 37, 62, 0.24);
}

.academic-home .evidence-chart-section .biomarker-chart-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(320px, 0.88fr);
}

@media (max-width: 980px) {
  .academic-home .evidence-chart-section .biomarker-chart-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  .academic-home .academic-factor-band :deep(.factor-cloud-section) {
    padding-top: 36px;
    padding-bottom: 40px;
  }

  .academic-home .evidence-chart-section {
    padding-top: 58px;
    padding-bottom: 66px;
  }

  .academic-home .evidence-chart-section .biomarker-chart-panel {
    padding: 20px 16px 24px;
  }

  .academic-home .academic-evidence-heading h2 {
    font-size: 32px;
  }
}
</style>
