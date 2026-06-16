<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import { login, register, resetPassword, sendVerificationCode } from './services/auth'

type AuthMode = 'login' | 'register' | 'reset'
type PendingAction = 'download' | 'operator' | null

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
  keywords: WordCloudItem[]
  catalogItems: CatalogItem[]
  accessRules: AccessRuleItem[]
  homeModules: HomeModuleItem[]
  activity: ActivityItem[]
}

interface WordDetailDefaults {
  subcategories: string[]
  aliases: string[]
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HOME_OVERVIEW_ENDPOINT = '/api/home/overview'
const shouldFetchHomeOverview = import.meta.env.VITE_ENABLE_HOME_OVERVIEW_API === 'true'

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
    { title: '生物标记物', detail: '601 项生物标记物，保留文献频次、数据行数和覆盖地区。', meta: '中文名、英文名、代谢物' },
    { title: '空间覆盖', detail: '45 个国家/地区与 259 个省级或城市层级地区。', meta: '国家、地区、城市、流域' },
    { title: '文献证据', detail: '198 篇 WBE 文献，覆盖 2004-2025 年。', meta: '题名、年份、DOI、期刊' },
  ],
  accessRules: [
    { title: '开放检索', detail: '目标物质、词云、类别分布和字段说明对访客开放。', state: '公开' },
    { title: '受控下载', detail: '按筛选条件导出完整数据包前需要登录并记录用途。', state: '登录后' },
    { title: '数据维护', detail: '上传、批量校验、字段修订和版本发布仅面向操作员。', state: '操作员' },
  ],
  homeModules: [
    { index: '01', title: '数据目录', detail: '按目标物质、地区、年份和来源定位记录。', target: 'database' },
    { index: '02', title: '词云图谱', detail: '按文献去重频次理解高频标记物。', target: 'visual' },
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
const pendingAction = ref<PendingAction>(null)
const actionNotice = ref('')
const loginComplete = ref(false)
const isUploadWorkspaceOpen = ref(false)
const selectedFileName = ref('')
const uploadNotice = ref('')
const currentOverviewIndex = ref(0)
const isOverviewPaused = ref(false)
const activeKeyword = ref<string | null>(null)
const selectedWord = ref<WordCloudItem | null>(null)
const wordPopoverStyle = ref<Record<string, string>>({})

const mode = ref<AuthMode>('login')
const isSubmitting = ref(false)
const isSendingCode = ref(false)
const isPasswordVisible = ref(false)
const countdown = ref(0)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const form = reactive({
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  verificationCode: '',
})
const uploadForm = reactive({
  datasetType: 'factor',
  batchName: '',
  notes: '',
})

let codeTimer: number | undefined
let overviewTimer: number | undefined

const isLogin = computed(() => mode.value === 'login')
const isRegister = computed(() => mode.value === 'register')
const isReset = computed(() => mode.value === 'reset')
const needsCode = computed(() => isRegister.value || isReset.value)
const pageTitle = computed(() => {
  if (isRegister.value) return '注册账号'
  if (isReset.value) return '找回密码'
  return '登录平台'
})
const authLead = computed(() => {
  if (pendingAction.value === 'download') return '登录后将继续下载当前数据包。'
  if (pendingAction.value === 'operator') return '登录后可进入数据上传与批量校验。'
  return '用于受控下载、字段维护和数据版本发布。'
})
const submitText = computed(() => {
  if (isSubmitting.value) return '提交中'
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
const canSendCode = computed(
  () =>
    needsCode.value &&
    EMAIL_PATTERN.test(form.email) &&
    countdown.value === 0 &&
    !isSendingCode.value,
)
const activeMetric = computed<HeroMetric>(
  () => homeData.value.metrics[currentOverviewIndex.value] ?? homeData.value.metrics[0] ?? defaultMetric,
)
const visualEntryItems = computed(() => [
  {
    icon: 'structure',
    title: '目标物质结构',
    value: metricText('categories', '32', '类'),
    detail: '按类别查看数据行与覆盖',
    target: 'database',
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
    title: '类别覆盖',
    value: `${homeData.value.categories.length || mockHomeData.categories.length} 类样例`,
    detail: '比较类别与文献覆盖',
    target: 'visual',
  },
  {
    icon: 'evidence',
    title: '文献/地区证据',
    value: `${metricText('docs', '198', '篇')} / ${coverageText()}`,
    detail: '追踪来源与空间覆盖',
    target: 'database',
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
    duration: `${42 + index * 7}s`,
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
    const response = await fetch(HOME_OVERVIEW_ENDPOINT, {
      headers: {
        Accept: 'application/json',
      },
    })
    if (!response.ok) return

	    const result = (await response.json()) as Partial<HomeData>
    homeData.value = {
      metrics: result.metrics?.length ? result.metrics : mockHomeData.metrics,
      trends: result.trends?.length ? result.trends : mockHomeData.trends,
      factors: result.factors?.length ? result.factors : mockHomeData.factors,
      categories: result.categories?.length ? result.categories : mockHomeData.categories,
      keywords: result.keywords?.length ? result.keywords : mockHomeData.keywords,
      catalogItems: result.catalogItems?.length ? result.catalogItems : mockHomeData.catalogItems,
      accessRules: result.accessRules?.length ? result.accessRules : mockHomeData.accessRules,
      homeModules: result.homeModules?.length ? result.homeModules : mockHomeData.homeModules,
      activity: result.activity?.length ? result.activity : mockHomeData.activity,
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
}

function setMessage(type: 'success' | 'error', text: string) {
  messageType.value = type
  message.value = text
}

function openAuth(action: PendingAction = null) {
  pendingAction.value = action
  loginComplete.value = false
  message.value = ''
  mode.value = 'login'

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

function returnToPrevious() {
  isAuthOpen.value = false
  actionNotice.value = `登录成功，顶部账号区已显示数据上传入口。`
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
    actionNotice.value = '已通过认证：可在数据目录中按筛选条件发起受控下载。'
    return
  }

  openUploadWorkspace()
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function openUploadWorkspace() {
  if (!isAuthenticated.value) {
    openAuth('operator')
    return
  }

  isUploadWorkspaceOpen.value = true
  actionNotice.value = '已进入数据维护区，可上传数据并提交校验。'
  await nextTick()
  scrollToSection('upload')
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
    if (!form.email.trim()) {
      setMessage('error', '请输入用户名或邮箱')
      return false
    }

    return true
  }

  if (!EMAIL_PATTERN.test(form.email)) {
    setMessage('error', '请输入正确的邮箱地址')
    return false
  }

  return true
}

function validateUsername() {
  if (!isRegister.value) return true

  const username = form.username.trim()
  if (username.length < 3 || username.length > 50) {
    setMessage('error', '用户名长度应为 3-50 位')
    return false
  }

  return true
}

function validatePassword() {
  if (isLogin.value) {
    if (!form.password.trim()) {
      setMessage('error', '请输入密码')
      return false
    }

    return true
  }

  if (form.password.trim().length < 6) {
    setMessage('error', '密码至少需要 6 位')
    return false
  }

  if (form.password !== form.confirmPassword) {
    setMessage('error', '两次输入的密码不一致')
    return false
  }

  return true
}

function validateCode() {
  if (needsCode.value && form.verificationCode.trim().length !== 6) {
    setMessage('error', '请输入 6 位邮箱验证码')
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
    const result = await sendVerificationCode(form.email, codeScene.value)
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
    const result = isRegister.value
      ? await register({
          username: form.username,
          email: form.email,
          password: form.password,
          code: form.verificationCode,
        })
      : isReset.value
        ? await resetPassword({
            email: form.email,
            newPassword: form.password,
            code: form.verificationCode,
          })
        : await login({
            account: form.email,
            password: form.password,
          })

    setMessage(result.success ? 'success' : 'error', result.message || '操作成功')

    if (result.success && isLogin.value) {
      isAuthenticated.value = true
      currentUser.value = form.email
      loginComplete.value = true
      setMessage('success', result.message || '登录成功，已显示账号入口。')
    }
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '请求失败，请稍后再试')
  } finally {
    isSubmitting.value = false
  }
}

onMounted(() => {
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
        <span class="brand-logo" aria-hidden="true">W</span>
        <span>
          <strong>污水信息因子数据库</strong>
          <small>Wastewater Biomarker Evidence</small>
        </span>
      </a>

      <nav class="main-nav" aria-label="主导航">
        <a href="#about">数据说明</a>
        <a href="#database">数据目录</a>
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
          <button class="upload-entry" type="button" @click="openUploadWorkspace">数据上传</button>
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
          <button type="button" class="primary-action" @click="scrollToSection('database')">
            浏览数据目录
          </button>
          <button type="button" class="secondary-action" @click="scrollToSection('visual')">
            查看图谱分析
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
          <p>{{ activeMetric.detail }} · {{ activeMetric.trend }}</p>
        </div>
        <div class="board-foot">
          <span>开放检索，受控下载，维护入口登录后显示。</span>
          <button type="button" @click="scrollToSection('database')">查看目录</button>
        </div>
      </div>
    </section>

    <section class="glance-section" aria-labelledby="glanceTitle">
      <div class="glance-inner">
        <div class="glance-heading">
          <p class="section-kicker">AT A GLANCE</p>
          <h2 id="glanceTitle">数据可视化入口</h2>
        </div>
        <div class="glance-grid">
          <button
            v-for="item in visualEntryItems"
            :key="item.title"
            type="button"
            class="glance-item"
            @click="scrollToSection(item.target)"
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

    <section id="about" class="about-band" aria-label="数据库说明">
      <div class="about-intro">
        <p class="section-kicker">ABOUT DATA</p>
        <h2>面向污水流行病学研究的因子、文献与监测证据数据库。</h2>
        <p>
          数据库围绕目标物质、采样地区、研究年份、检测方法和文献来源建立索引，
          便于研究人员追踪证据、比较地区差异并复用结构化字段。
        </p>
      </div>
      <div class="about-cards">
        <article>
          <span>01</span>
          <h3>收录范围</h3>
          <p>覆盖 WBE 相关文献、目标物质、生物标记物、国家地区和城市层级记录。</p>
        </article>
        <article>
          <span>02</span>
          <h3>字段结构</h3>
          <p>保留中文名、英文名、类别、浓度、负荷、人口归一化和来源文献信息。</p>
        </article>
        <article>
          <span>03</span>
          <h3>质量控制</h3>
          <p>通过名称归并、类别校验、批量审核和版本发布保持数据可追溯。</p>
        </article>
      </div>
    </section>

    <section id="database" class="dashboard-section" aria-labelledby="dashboardTitle">
      <div class="section-heading">
        <p class="section-kicker">DATA CATALOG</p>
        <h2 id="dashboardTitle">按数据目录、覆盖结构和来源状态浏览数据库。</h2>
      </div>

      <div class="dashboard-grid">
        <article class="trend-panel">
          <header>
            <span>目标物质结构</span>
            <strong>按数据行数归并</strong>
          </header>
          <div class="trend-list">
            <div v-for="item in homeData.trends" :key="item.label" class="trend-row">
              <span>
                <strong>{{ item.label }}</strong>
                <small>{{ item.targetClass }} · {{ item.docs }} 篇 · {{ item.markers }} 项</small>
              </span>
              <div class="trend-track">
                <i :style="{ width: `${item.width}%`, background: item.color }"></i>
              </div>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
        </article>

        <article class="catalog-panel">
          <header>
            <span>数据目录</span>
            <strong>开放检索字段</strong>
          </header>
          <div class="catalog-list">
            <button v-for="item in homeData.catalogItems" :key="item.title" type="button">
              <strong>{{ item.title }}</strong>
              <span>{{ item.detail }}</span>
              <em>{{ item.meta }}</em>
            </button>
          </div>
        </article>

        <article class="access-panel">
          <header>
            <span>权限边界</span>
            <strong>检索开放，下载受控</strong>
          </header>
          <div class="access-rule-list">
            <article v-for="item in homeData.accessRules" :key="item.title">
              <span>{{ item.state }}</span>
              <strong>{{ item.title }}</strong>
              <p>{{ item.detail }}</p>
            </article>
          </div>
          <div class="access-actions">
            <button type="button" @click="openAuth('download')">下载申请</button>
            <button type="button" @click="openUploadWorkspace">数据上传</button>
          </div>
        </article>
      </div>
    </section>

    <section id="visual" class="visual-section" aria-labelledby="visualTitle">
      <div class="section-heading">
        <p class="section-kicker">VISUAL EXPLORER</p>
        <h2 id="visualTitle">词云、类别覆盖与高频因子总览。</h2>
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
            <span>{{ activeWord ? '当前词条' : '悬停词条查看详情' }}</span>
            <strong>{{ activeWord?.name ?? '生物标记物总体词云' }}</strong>
            <p>
              {{
                activeWord
                  ? `${activeWord.category} · ${activeWord.docs ?? activeWord.value} 篇文献 · ${activeWord.rows ?? 0} 行 · ${activeWord.countries ?? 0} / ${activeWord.regions ?? 0} 国家/地区`
                  : '词云横向滚动，鼠标悬停会暂停并高亮，点击词条查看详情。'
              }}
            </p>
          </div>
        </article>

        <article class="factor-panel">
          <header>
            <span>高频生物标记物</span>
            <strong>文献去重频次</strong>
          </header>
          <div class="factor-list">
            <button v-for="item in homeData.factors" :key="item.name" type="button">
              <strong>{{ item.name }}</strong>
              <span>{{ item.type }}</span>
              <em>{{ item.docs }} 篇 / {{ item.rows }} 行</em>
            </button>
          </div>
        </article>

        <article class="category-panel">
          <header>
            <span>类别覆盖</span>
            <strong>前八类样例</strong>
          </header>
          <div class="category-rings">
            <div v-for="item in homeData.categories" :key="item.name" class="ring-item">
              <i
                :style="{
                  background: `conic-gradient(${item.tone} ${item.ratio}%, #e4edf3 0)`,
                }"
              ></i>
              <span>{{ item.name }}</span>
              <strong>{{ item.count }}</strong>
              <em>{{ item.docs }} 篇 · {{ item.markers }} 项</em>
            </div>
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
              <p>审核通过后写入数据目录和更新日志。</p>
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
      <div>
        <strong>污水信息因子数据库</strong>
        <p>服务于污水流行病学数据整合、公共健康研究和证据型决策。</p>
      </div>
      <nav aria-label="页脚导航">
        <a href="#about">数据说明</a>
        <a href="#database">数据目录</a>
        <a href="#visual">图谱分析</a>
        <a href="#methods">方法与质量</a>
        <button type="button" @click="openAuth('download')">下载申请</button>
      </nav>
      <small>© 2026 WBE Information Platform · 字段版本与数据更新保持可追溯</small>
    </footer>

    <div
      v-if="selectedWord"
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
          <span class="brand-logo small" aria-hidden="true">W</span>
          <p>{{ authLead }}</p>
          <h2 id="authTitle">{{ pageTitle }}</h2>
        </header>

        <form class="auth-form" @submit.prevent="handleSubmit">
          <label>
            <span>用户名 / 邮箱</span>
            <input
              v-model.trim="form.email"
              :type="isLogin ? 'text' : 'email'"
              autocomplete="email"
              :placeholder="isLogin ? '用户名或 name@example.com' : 'name@example.com'"
            />
          </label>

          <label v-if="isRegister">
            <span>用户名</span>
            <input
              v-model.trim="form.username"
              type="text"
              autocomplete="username"
              placeholder="3-50 位用户名"
            />
          </label>

          <label>
            <span>{{ isReset ? '新密码' : '密码' }}</span>
            <div class="split-row password-row">
              <input
                v-model.trim="form.password"
                :type="isPasswordVisible ? 'text' : 'password'"
                :autocomplete="isLogin ? 'current-password' : 'new-password'"
                placeholder="至少 6 位"
              />
              <button type="button" @click="isPasswordVisible = !isPasswordVisible">
                {{ isPasswordVisible ? '隐藏' : '显示' }}
              </button>
            </div>
          </label>

          <label v-if="!isLogin">
            <span>确认密码</span>
            <input
              v-model.trim="form.confirmPassword"
              :type="isPasswordVisible ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="再次输入密码"
            />
          </label>

          <label v-if="needsCode">
            <span>邮箱验证码</span>
            <div class="split-row code-row">
              <input
                v-model.trim="form.verificationCode"
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

          <p v-if="message" class="form-message" :class="messageType">{{ message }}</p>

          <button v-if="!loginComplete" type="submit" class="auth-submit" :disabled="isSubmitting">
            {{ submitText }}
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
            <button v-if="!isRegister" type="button" @click="setMode('register')">注册账号</button>
            <button v-if="!isLogin" type="button" @click="setMode('login')">返回登录</button>
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
  background:
    linear-gradient(180deg, rgba(238, 246, 250, 0.96), rgba(255, 255, 255, 0.96) 42%),
    radial-gradient(circle at 10% 5%, rgba(17, 116, 158, 0.11), transparent 30%),
    radial-gradient(circle at 90% 12%, rgba(14, 143, 119, 0.1), transparent 24%);
}

#top,
#about,
#database,
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
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 8px;
  color: #ffffff;
  background: linear-gradient(135deg, rgba(15, 101, 145, 0.94), rgba(14, 143, 119, 0.92)), #0f6591;
  box-shadow: 0 14px 30px rgba(15, 101, 145, 0.2);
  font-weight: 900;
}

.brand-logo.small {
  width: 38px;
  height: 38px;
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
  height: 42px;
  padding: 0 14px;
  border-radius: 8px;
  color: #ffffff;
  background: #0e8f77;
  white-space: nowrap;
}

.login-button:hover,
.upload-entry:hover,
.primary-action:hover,
.secondary-action:hover,
.auth-submit:hover,
.ghost-action:hover {
  transform: translateY(-1px);
}

.hero-section {
  display: grid;
  grid-template-columns: minmax(320px, 0.86fr) minmax(520px, 1.14fr);
  align-items: center;
  gap: clamp(32px, 6vw, 76px);
  min-height: calc(100vh - 132px);
  padding: clamp(34px, 5.2vw, 68px) clamp(20px, 5vw, 70px) clamp(30px, 4vw, 54px);
}

.hero-copy {
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
  margin: 22px 0 0;
  color: #506a7c;
  font-size: 17px;
  line-height: 1.9;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 30px;
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
  border: 1px solid rgba(109, 139, 158, 0.22);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(241, 248, 250, 0.94)), #ffffff;
  box-shadow: 0 28px 80px rgba(37, 73, 96, 0.14);
}

.board-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 20px 22px 0;
}

.board-head span {
  color: #657b89;
  font-size: 13px;
  font-weight: 800;
}

.board-head strong {
  color: #183347;
  font-size: 22px;
}

.metric-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 16px;
}

.metric-card {
  min-height: 126px;
  display: grid;
  align-content: space-between;
  gap: 7px;
  padding: 13px 14px;
  border: 1px solid rgba(118, 147, 164, 0.18);
  border-radius: 8px;
  background: #ffffff;
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
  font-size: 14px;
  font-weight: 900;
}

.metric-card strong {
  color: #112d40;
  font-size: clamp(26px, 3vw, 36px);
  line-height: 1;
}

.metric-card small {
  margin-left: 4px;
  color: #536c7d;
  font-size: 16px;
}

.metric-card em {
  display: -webkit-box;
  overflow: hidden;
  font-size: 14px;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.metric-card i {
  width: fit-content;
  padding: 4px 8px;
  border-radius: 6px;
  background: #f1f6f8;
  font-size: 12px;
  font-weight: 800;
}

.metric-card.blue,
.metric-card.green,
.metric-card.amber,
.metric-card.cyan {
  border-color: rgba(118, 147, 164, 0.18);
}

.metric-card.active {
  transform: translateY(-5px) scale(1.015);
  border-color: rgba(14, 143, 119, 0.36);
  background: linear-gradient(180deg, #ffffff, #f6fbfd);
  box-shadow: 0 18px 46px rgba(29, 83, 115, 0.18);
}

.metric-card.active i {
  color: #0b6f5f;
  background: #e5f7f2;
}

.overview-focus {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  column-gap: 14px;
  margin: 0 16px 14px;
  padding: 10px 12px;
  border: 1px solid rgba(14, 143, 119, 0.18);
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(14, 143, 119, 0.1), rgba(15, 101, 145, 0.06)),
    #f7fbfc;
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
  font-size: 22px;
}

.overview-focus p,
.word-inspector p {
  margin: 5px 0 0;
  color: #5d7382;
  line-height: 1.6;
}

.overview-focus p {
  grid-column: 2;
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
}

.glance-section {
  padding: 34px clamp(20px, 5vw, 70px) 46px;
  background:
    linear-gradient(180deg, rgba(246, 251, 252, 0.96), rgba(255, 255, 255, 0.98)),
    #ffffff;
}

.glance-inner {
  display: grid;
  gap: 22px;
  padding: 30px clamp(18px, 4vw, 44px);
  border: 1px solid rgba(109, 139, 158, 0.16);
  border-radius: 8px;
  background: #fbfdfd;
}

.glance-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
}

.glance-heading h2 {
  margin: 0;
  color: #173247;
  font-size: clamp(26px, 3vw, 38px);
}

.glance-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.glance-item {
  min-height: 124px;
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  grid-template-rows: auto auto;
  gap: 8px 14px;
  align-items: center;
  padding: 18px;
  border: 1px solid rgba(109, 139, 158, 0.16);
  border-radius: 8px;
  color: #173247;
  background: #ffffff;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.glance-item:hover,
.glance-item:focus-visible {
  border-color: rgba(14, 143, 119, 0.34);
  box-shadow: 0 16px 34px rgba(32, 62, 82, 0.1);
  outline: none;
  transform: translateY(-3px);
}

.glance-icon {
  position: relative;
  width: 54px;
  height: 54px;
  grid-row: 1 / span 2;
  display: grid;
  place-items: center;
  border: 2px solid #1f638d;
  border-radius: 8px;
}

.glance-icon::before {
  color: #1f638d;
  font-size: 20px;
  font-weight: 900;
}

.glance-icon.structure::before {
  content: '32';
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
  justify-self: start;
  padding: 4px 9px;
  border-radius: 999px;
  color: #ffffff;
  background: #0e8f77;
  font-size: 13px;
  font-weight: 900;
}

.glance-copy {
  display: grid;
  gap: 4px;
}

.glance-copy strong {
  color: #173247;
  font-size: 17px;
}

.glance-copy em {
  color: #657b89;
  font-size: 13px;
  font-style: normal;
  line-height: 1.5;
}

.about-band,
.dashboard-section,
.visual-section,
.upload-workspace,
.updates-section,
.site-footer {
  padding-inline: clamp(20px, 5vw, 70px);
}

.about-band {
  display: grid;
  grid-template-columns: minmax(280px, 0.86fr) minmax(340px, 1.14fr);
  gap: clamp(28px, 5vw, 64px);
  padding-block: 58px;
  border-top: 1px solid rgba(122, 150, 166, 0.18);
  border-bottom: 1px solid rgba(122, 150, 166, 0.18);
  background: #ffffff;
}

.about-band h2,
.section-heading h2 {
  margin: 0;
  color: #122f42;
  font-size: clamp(26px, 3vw, 42px);
  line-height: 1.2;
  letter-spacing: 0;
}

.about-intro > p {
  margin: 0;
  color: #526c7c;
  font-size: 16px;
  line-height: 1.9;
}

.about-intro h2 {
  margin-bottom: 18px;
}

.about-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.about-cards article {
  min-height: 190px;
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 20px;
  border: 1px solid rgba(109, 139, 158, 0.18);
  border-radius: 8px;
  background: #f8fbfc;
}

.about-cards span,
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

.about-cards h3,
.review-steps strong,
.update-list h3 {
  margin: 0;
  color: #173247;
  font-size: 20px;
}

.about-cards p,
.catalog-panel p,
.access-panel p,
.review-steps p,
.update-list p,
.site-footer p {
  margin: 0;
  color: #5d7382;
  line-height: 1.75;
}

.dashboard-section,
.visual-section,
.upload-workspace,
.updates-section {
  padding-block: 68px;
}

.section-heading {
  max-width: 820px;
  margin-bottom: 28px;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(320px, 1.08fr) minmax(300px, 0.92fr);
  gap: 18px;
}

.visual-grid,
.upload-layout {
  display: grid;
  gap: 18px;
}

.visual-grid {
  grid-template-columns: minmax(420px, 1.2fr) minmax(280px, 0.78fr) minmax(260px, 0.7fr);
}

.upload-layout {
  grid-template-columns: minmax(360px, 1.18fr) minmax(320px, 0.82fr);
}

.trend-panel,
.catalog-panel,
.access-panel,
.word-cloud-panel,
.factor-panel,
.category-panel,
.upload-panel,
.review-panel,
.update-list article {
  border: 1px solid rgba(109, 139, 158, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 18px 48px rgba(32, 62, 82, 0.08);
}

.trend-panel {
  min-height: 420px;
  padding: 24px;
  grid-row: span 2;
}

.catalog-panel,
.access-panel,
.word-cloud-panel,
.factor-panel,
.category-panel,
.upload-panel,
.review-panel {
  padding: 22px;
}

.access-panel {
  display: grid;
  align-content: space-between;
  gap: 18px;
}

.trend-panel header,
.catalog-panel header,
.access-panel header,
.word-cloud-panel header,
.factor-panel header,
.category-panel header,
.upload-panel header,
.review-panel header {
  display: grid;
  gap: 6px;
  margin-bottom: 22px;
}

.trend-panel header span,
.catalog-panel header span,
.access-panel header span,
.word-cloud-panel header span,
.factor-panel header span,
.category-panel header span,
.upload-panel header span,
.review-panel header span {
  color: #0e8f77;
  font-size: 13px;
  font-weight: 900;
}

.trend-panel header strong,
.catalog-panel header strong,
.access-panel header strong,
.word-cloud-panel header strong,
.factor-panel header strong,
.category-panel header strong,
.upload-panel header strong,
.review-panel header strong {
  color: #173247;
  font-size: 22px;
}

.trend-list {
  display: grid;
  gap: 22px;
}

.trend-row {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr) 72px;
  align-items: center;
  gap: 14px;
}

.trend-row > span {
  display: grid;
  gap: 4px;
}

.trend-row > span strong,
.trend-row > strong {
  color: #314b5f;
  font-size: 14px;
}

.trend-row small {
  color: #7b8d99;
  font-size: 12px;
}

.trend-row > strong {
  text-align: right;
}

.trend-track {
  height: 18px;
  overflow: hidden;
  border-radius: 999px;
  background: #e5eef4;
}

.trend-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.catalog-list,
.factor-list {
  display: grid;
  gap: 10px;
}

.catalog-list button,
.factor-list button {
  display: grid;
  gap: 6px;
  align-items: center;
  min-height: 54px;
  padding: 12px;
  border: 1px solid rgba(118, 147, 164, 0.14);
  border-radius: 8px;
  background: #f9fcfd;
}

.catalog-list button {
  grid-template-columns: minmax(108px, 0.34fr) minmax(0, 1fr) auto;
}

.factor-list button {
  grid-template-columns: minmax(86px, 0.7fr) minmax(110px, 1fr) auto;
  gap: 12px;
}

.catalog-list button:hover,
.factor-list button:hover {
  border-color: rgba(14, 143, 119, 0.3);
  background: #f1faf7;
}

.catalog-list strong,
.factor-list strong {
  color: #183347;
}

.catalog-list span,
.catalog-list em,
.factor-list span,
.factor-list em {
  color: #657b89;
  font-size: 13px;
  font-style: normal;
}

.catalog-list em {
  justify-self: end;
  padding: 4px 7px;
  border-radius: 6px;
  background: #edf4f7;
  color: #496171;
  font-weight: 800;
}

.access-rule-list {
  display: grid;
  gap: 10px;
}

.access-rule-list article {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  gap: 4px 12px;
  padding: 13px;
  border: 1px solid rgba(109, 139, 158, 0.16);
  border-radius: 8px;
  background: #f8fbfc;
}

.access-rule-list article span {
  grid-row: span 2;
  align-self: start;
  padding: 5px 6px;
  border-radius: 6px;
  color: #0b6f5f;
  background: #e5f7f2;
  font-size: 12px;
  font-weight: 900;
  text-align: center;
}

.access-rule-list article strong {
  color: #173247;
}

.access-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.access-actions button {
  min-height: 40px;
  border: 1px solid rgba(15, 101, 145, 0.18);
  border-radius: 8px;
  color: #0f6591;
  background: #eef7fb;
  cursor: pointer;
  font-weight: 900;
}

.visual-section,
.upload-workspace {
  background: #ffffff;
}

.word-cloud-panel {
  min-height: 500px;
  display: grid;
  grid-template-rows: auto 330px auto;
}

.word-cloud-viewport {
  position: relative;
  height: 330px;
  min-height: 330px;
  display: grid;
  align-content: center;
  gap: 14px;
  overflow: hidden;
  border: 1px solid rgba(109, 139, 158, 0.12);
  border-radius: 8px;
  background:
    radial-gradient(circle at 18% 20%, rgba(14, 143, 119, 0.1), transparent 28%),
    linear-gradient(135deg, rgba(240, 248, 250, 0.92), rgba(255, 255, 255, 0.98)),
    #f8fbfc;
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
  width: 100%;
  overflow: hidden;
}

.word-cloud-trackline {
  width: max-content;
  display: flex;
  gap: 12px;
  padding-inline: 16px;
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
  align-items: baseline;
  gap: 6px;
  max-width: 100%;
  padding: 6px 10px;
  border: 1px solid rgba(109, 139, 158, 0.12);
  border-radius: 999px;
  color: var(--word-color);
  background: rgba(255, 255, 255, 0.76);
  cursor: pointer;
  font-weight: 900;
  line-height: 1.1;
  box-shadow: 0 8px 18px rgba(32, 62, 82, 0.06);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease;
  animation: word-float 5.5s ease-in-out infinite;
  animation-delay: var(--float-delay);
}

.word-chip strong {
  overflow-wrap: anywhere;
  white-space: nowrap;
  font-size: var(--word-size);
}

.word-chip small {
  color: #6b7f8d;
  font-size: 11px;
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
  padding: 20px;
  background: rgba(11, 26, 36, 0.48);
  backdrop-filter: blur(10px);
}

.auth-card {
  position: relative;
  width: min(460px, 100%);
  max-height: min(760px, calc(100vh - 40px));
  overflow: auto;
  padding: 30px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 30px 80px rgba(10, 29, 42, 0.28);
}

.close-button {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 6px;
  color: #5b7180;
  background: #edf4f7;
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
}

.auth-header {
  display: grid;
  gap: 10px;
  margin-bottom: 22px;
}

.auth-header p {
  margin: 0;
  color: #607888;
  font-size: 14px;
  line-height: 1.7;
}

.auth-header h2 {
  margin: 0;
  color: #173247;
  font-size: 28px;
}

.auth-form {
  display: grid;
  gap: 15px;
}

.auth-form label {
  display: grid;
  gap: 8px;
  color: #2f4b5e;
  font-size: 14px;
  font-weight: 800;
}

.auth-form input {
  width: 100%;
  height: 46px;
  border: 1px solid rgba(98, 128, 148, 0.28);
  border-radius: 8px;
  padding: 0 13px;
  color: #173247;
  outline: 0;
}

.auth-form input:focus {
  border-color: #0f6591;
  box-shadow: 0 0 0 4px rgba(15, 101, 145, 0.12);
}

.split-row {
  display: grid;
  gap: 10px;
}

.password-row {
  grid-template-columns: minmax(0, 1fr) 72px;
}

.code-row {
  grid-template-columns: minmax(0, 1fr) 120px;
}

.split-row button,
.ghost-action {
  min-height: 46px;
  border: 1px solid rgba(15, 101, 145, 0.18);
  border-radius: 8px;
  color: #0f6591;
  background: #eef7fb;
  cursor: pointer;
  font-weight: 900;
}

.split-row button:disabled,
.auth-submit:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.form-message {
  min-height: 22px;
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
}

.form-message.success {
  color: #0b7b67;
}

.form-message.error {
  color: #b2454d;
}

.auth-submit {
  min-height: 48px;
  border-radius: 8px;
  color: #ffffff;
  background: #0f6591;
  box-shadow: 0 16px 34px rgba(15, 101, 145, 0.22);
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
  gap: 16px;
}

.action-links button {
  border: 0;
  color: #0f6591;
  background: transparent;
  cursor: pointer;
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
  .about-band,
  .dashboard-grid,
  .upload-layout {
    grid-template-columns: 1fr;
  }

  .visual-grid {
    grid-template-columns: minmax(0, 1fr) minmax(280px, 0.72fr);
  }

  .category-panel {
    grid-column: 1 / -1;
  }

  .about-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

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
  .about-cards,
  .update-list,
  .site-footer {
    grid-template-columns: 1fr;
  }

  .metric-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding: 12px;
  }

  .metric-card {
    min-height: 118px;
    padding: 12px;
  }

  .metric-card span {
    font-size: 13px;
  }

  .metric-card strong {
    font-size: 28px;
  }

  .metric-card small,
  .metric-card em {
    font-size: 13px;
  }

  .category-panel {
    grid-column: auto;
  }

  .trend-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .trend-row strong {
    text-align: left;
  }

  .factor-list button,
  .catalog-list button,
  .update-list article,
  .post-login-actions {
    grid-template-columns: 1fr;
  }

  .category-rings {
    grid-template-columns: 1fr;
  }

  .glance-heading {
    display: grid;
    justify-items: start;
  }

  .glance-item {
    grid-template-columns: 48px minmax(0, 1fr);
    min-height: 106px;
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

  .password-row,
  .code-row {
    grid-template-columns: 1fr;
  }
}
</style>
