<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { logout as requestLogout, type UserResponse } from '../services/auth'
import { canManageData, clearSession, getStoredSession } from '../services/session'
import {
  cancelScheduledMapExperiencePrefetch,
  preloadMapExperience,
  scheduleMapExperiencePrefetch,
} from '../utils/mapPrefetch'
import BrandMark from './BrandMark.vue'

type ModuleKey = 'home' | 'map' | 'sankey' | 'priority' | 'methodology' | 'data'
type HeaderVariant = 'auto' | 'legacy' | 'academic'

const props = withDefaults(
  defineProps<{
    active?: ModuleKey
    pageTitle?: string
    pageSubtitle?: string
    showContext?: boolean
    sticky?: boolean
    variant?: HeaderVariant
    showHomeGuide?: boolean
    autoHideOnScroll?: boolean
  }>(),
  {
    active: undefined,
    pageTitle: '',
    pageSubtitle: '',
    showContext: false,
    sticky: true,
    variant: 'auto',
    showHomeGuide: false,
    autoHideOnScroll: false,
  },
)

const emit = defineEmits<{
  requestAuth: []
  requestHomeGuide: []
  logout: []
  visibilityChange: [hidden: boolean]
}>()

const route = useRoute()
const router = useRouter()
const activeRoutePath = computed(() => route?.path ?? '/')
const homeGuideTrigger = ref<HTMLButtonElement | null>(null)
const scrollHidden = ref(false)
let lastScrollY = 0
let scrollFrame = 0
defineExpose({ homeGuideTrigger })
const mobileMenuOpen = ref(false)
const mobileAnalysisOpen = ref(false)
const sessionUser = ref<UserResponse | null>(getStoredSession()?.user ?? null)
const isLoggingOut = ref(false)

const navigation = [
  { key: 'home' as const, label: '首页', to: '/' },
  { key: 'map' as const, label: '空间分布查询', to: '/map-visualization' },
  { key: 'sankey' as const, label: '疾病关联分析', to: '/icd11-sankey' },
  { key: 'priority' as const, label: '标记物优先级评估', to: '/core-marker-priority' },
]

const academicAnalysisNavigation = navigation.filter((item) => item.key !== 'home')

const isAcademicHeader = computed(() => props.variant === 'academic' || props.variant === 'auto')

const academicHomeDestination = computed(() => ({ path: '/' }))

const brandDestination = computed(() =>
  isAcademicHeader.value ? academicHomeDestination.value : { path: '/' },
)

function academicSectionDestination(hash: string) {
  return {
    path: '/',
    hash,
  }
}

const currentModule = computed<ModuleKey>(() => {
  if (props.active) return props.active
  if (route.path === '/') return 'home'
  if (route.path.startsWith('/map-visualization')) return 'map'
  if (route.path.startsWith('/icd11-sankey')) return 'sankey'
  if (route.path.startsWith('/core-marker-priority')) return 'priority'
  if (route.path.startsWith('/methodology-verification')) return 'methodology'
  if (route.path.startsWith('/data-entry')) return 'data'
  return 'home'
})

const isAnalysisRoute = computed(() =>
  ['map', 'sankey', 'priority', 'methodology'].includes(currentModule.value),
)

const roleLabel = computed(() => {
  if (sessionUser.value?.role === 'admin') return '系统管理员'
  if (sessionUser.value?.role === 'editor') return '数据维护员'
  return '研究用户'
})

const canOpenWorkspace = computed(() => canManageData(sessionUser.value))

function syncSession() {
  sessionUser.value = getStoredSession()?.user ?? null
}

function closeMobileMenu() {
  mobileMenuOpen.value = false
  mobileAnalysisOpen.value = false
}

function setScrollHidden(hidden: boolean) {
  if (scrollHidden.value === hidden) return
  scrollHidden.value = hidden
  emit('visibilityChange', hidden)
}

function updateScrollVisibility() {
  scrollFrame = 0
  if (!props.autoHideOnScroll) return
  const currentScrollY = Math.max(0, window.scrollY)
  const delta = currentScrollY - lastScrollY
  if (currentScrollY <= 24) setScrollHidden(false)
  else if (currentScrollY > 80 && delta > 8) setScrollHidden(true)
  else if (delta < -6) setScrollHidden(false)
  lastScrollY = currentScrollY
}

function scheduleScrollVisibility() {
  if (!scrollFrame) scrollFrame = window.requestAnimationFrame(updateScrollVisibility)
}

function revealHeaderForFocus() {
  if (props.autoHideOnScroll) setScrollHidden(false)
}

function requestHomeGuide() {
  closeMobileMenu()
  emit('requestHomeGuide')
}

function prefetchNavigationItem(key: ModuleKey) {
  if (key === 'map') void preloadMapExperience()
}

async function requestAuth() {
  closeMobileMenu()
  emit('requestAuth')
  if (activeRoutePath.value !== '/') {
    await router.push({
      path: '/',
      query: { auth: 'login' },
    })
  }
}

async function handleDefaultLogout() {
  if (isLoggingOut.value) return
  isLoggingOut.value = true
  const token = getStoredSession()?.token
  try {
    if (token) await requestLogout(token)
  } catch {
    // Clearing the local session is still safe when the server session has expired.
  } finally {
    clearSession()
    sessionUser.value = null
    isLoggingOut.value = false
    emit('logout')
  }
}

onMounted(() => {
  syncSession()
  window.addEventListener('storage', syncSession)
  window.addEventListener('wbe-auth-changed', syncSession)
  if (!route?.path?.startsWith('/map-visualization')) scheduleMapExperiencePrefetch()
  if (props.autoHideOnScroll) {
    lastScrollY = Math.max(0, window.scrollY)
    window.addEventListener('scroll', scheduleScrollVisibility, { passive: true })
  }
})

onBeforeUnmount(() => {
  cancelScheduledMapExperiencePrefetch()
  window.removeEventListener('storage', syncSession)
  window.removeEventListener('wbe-auth-changed', syncSession)
  window.removeEventListener('scroll', scheduleScrollVisibility)
  if (scrollFrame) window.cancelAnimationFrame(scrollFrame)
})
</script>

<template>
  <div
    class="platform-header-shell"
    :class="{
      'is-sticky': sticky,
      'has-context': showContext,
      'is-academic': isAcademicHeader,
      'is-home': isAcademicHeader && activeRoutePath === '/',
      'is-scroll-hidden': autoHideOnScroll && scrollHidden,
    }"
    @focusin="revealHeaderForFocus"
  >
    <a class="platform-skip-link" href="#main-content">跳到主要内容</a>

    <header class="platform-global-header">
      <RouterLink class="platform-brand" :to="brandDestination" aria-label="污水信息因子数据库首页">
        <BrandMark :size="40" compact :variant="isAcademicHeader ? 'academic' : 'default'" />
        <span class="platform-brand-copy">
          <strong class="platform-brand-name"> 污水信息因子数据库 </strong>
          <strong v-if="isAcademicHeader" class="platform-brand-name-mobile"
            >污水信息因子数据库</strong
          >
          <small v-if="!isAcademicHeader">WASTEWATER BIOMARKER EVIDENCE</small>
        </span>
      </RouterLink>

      <nav
        v-if="!isAcademicHeader"
        id="platform-navigation"
        class="platform-navigation"
        :class="{ 'is-open': mobileMenuOpen }"
        aria-label="平台模块导航"
      >
        <RouterLink
          v-for="item in navigation"
          :key="item.key"
          :to="item.to"
          :aria-current="currentModule === item.key ? 'page' : undefined"
          :class="{ active: currentModule === item.key }"
          @pointerenter="prefetchNavigationItem(item.key)"
          @focus="prefetchNavigationItem(item.key)"
          @click="closeMobileMenu"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <nav
        v-else
        id="platform-navigation"
        class="platform-navigation academic-navigation"
        :class="{ 'is-open': mobileMenuOpen }"
        aria-label="平台主导航"
      >
        <RouterLink
          :to="academicHomeDestination"
          :aria-current="activeRoutePath === '/' ? 'page' : undefined"
          :class="{ active: activeRoutePath === '/' }"
          @click="closeMobileMenu"
        >
          首页
        </RouterLink>

        <div class="academic-analysis-menu" :class="{ 'is-open': mobileAnalysisOpen }">
          <RouterLink
            class="academic-analysis-trigger"
            :class="{ active: isAnalysisRoute }"
            :to="academicSectionDestination('#visual-entry')"
            :aria-current="isAnalysisRoute ? 'page' : undefined"
            @click="closeMobileMenu"
          >
            可视化分析
          </RouterLink>
          <button
            type="button"
            class="academic-analysis-toggle"
            :aria-expanded="mobileAnalysisOpen"
            aria-controls="academic-analysis-submenu"
            :aria-label="mobileAnalysisOpen ? '收起可视化分析选项' : '展开可视化分析选项'"
            @click="mobileAnalysisOpen = !mobileAnalysisOpen"
          >
            <span aria-hidden="true"></span>
          </button>
          <div id="academic-analysis-submenu" class="academic-analysis-submenu">
            <RouterLink
              v-for="item in academicAnalysisNavigation"
              :key="item.key"
              :to="item.to"
              @pointerenter="prefetchNavigationItem(item.key)"
              @focus="prefetchNavigationItem(item.key)"
              @click="closeMobileMenu"
            >
              <span>{{ item.label }}</span>
            </RouterLink>
          </div>
        </div>

        <RouterLink
          to="/guide"
          :aria-current="activeRoutePath === '/guide' ? 'page' : undefined"
          :class="{ active: activeRoutePath === '/guide' }"
          @click="closeMobileMenu"
        >
          使用说明
        </RouterLink>
        <RouterLink
          to="/about"
          :aria-current="activeRoutePath === '/about' ? 'page' : undefined"
          :class="{ active: activeRoutePath === '/about' }"
          @click="closeMobileMenu"
        >
          关于
        </RouterLink>
      </nav>

      <div class="platform-global-tools">
        <button
          v-if="showHomeGuide && activeRoutePath === '/'"
          ref="homeGuideTrigger"
          class="platform-home-guide-button"
          type="button"
          aria-label="首页导览"
          title="首页导览"
          @click="requestHomeGuide"
        >
          <span class="platform-home-guide-label">首页导览</span>
          <span class="platform-home-guide-icon" aria-hidden="true">?</span>
        </button>
        <div class="platform-account-slot">
          <slot name="account">
            <details v-if="sessionUser" class="platform-account-menu">
              <summary :aria-label="`账号菜单，当前用户 ${sessionUser.username}`">
                <span class="platform-avatar" aria-hidden="true">{{
                  sessionUser.username.slice(0, 1).toUpperCase()
                }}</span>
                <span class="platform-account-copy">
                  <strong>{{ sessionUser.username }}</strong>
                  <small>{{ roleLabel }}</small>
                </span>
                <span class="platform-account-chevron" aria-hidden="true"></span>
              </summary>
              <div class="platform-account-panel">
                <div>
                  <strong>{{ sessionUser.username }}</strong>
                  <small>{{ roleLabel }}</small>
                </div>
                <RouterLink v-if="canOpenWorkspace" to="/data-entry">进入数据工作台</RouterLink>
                <button type="button" :disabled="isLoggingOut" @click="handleDefaultLogout">
                  {{ isLoggingOut ? '正在退出' : '退出当前账号' }}
                </button>
              </div>
            </details>
            <button
              v-else
              class="platform-login-button"
              type="button"
              aria-label="登录 WBE 数据平台"
              @click="requestAuth"
            >
              <span class="platform-login-icon" aria-hidden="true"></span>
              <span>登录</span>
            </button>
          </slot>
        </div>

        <button
          class="platform-menu-button"
          type="button"
          aria-controls="platform-navigation"
          :aria-expanded="mobileMenuOpen"
          :aria-label="mobileMenuOpen ? '关闭模块导航' : '打开模块导航'"
          @click="mobileMenuOpen = !mobileMenuOpen"
        >
          <i></i><i></i><i></i>
        </button>
      </div>
    </header>

    <div v-if="showContext" class="platform-context-bar">
      <div class="platform-context-heading">
        <strong>{{ pageTitle }}</strong>
        <small v-if="pageSubtitle">{{ pageSubtitle }}</small>
      </div>
      <div class="platform-context-content">
        <slot name="context"></slot>
      </div>
      <div class="platform-context-actions">
        <slot name="context-actions"></slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.platform-header-shell {
  position: relative;
  z-index: 80;
  width: 100%;
  color: var(--platform-navy-900, #173247);
  background: #ffffff;
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
}

.platform-header-shell,
.platform-header-shell *,
.platform-header-shell *::before,
.platform-header-shell *::after {
  box-sizing: border-box;
}

.platform-header-shell.is-sticky {
  position: sticky;
  top: 0;
}

.platform-header-shell.is-sticky.is-scroll-hidden {
  pointer-events: none;
  transform: translateY(-100%);
}

.platform-header-shell.is-sticky {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .platform-header-shell.is-sticky {
    transition: none;
  }
}

.platform-header-shell.is-academic,
.platform-header-shell.is-academic .platform-global-header {
  background: #ffffff;
}

.platform-header-shell.is-academic .platform-global-header {
  min-height: 70px;
  border-bottom-color: #d7e0e6;
  box-shadow: none;
}

.platform-header-shell.is-academic .platform-brand {
  color: #0b1f33;
}

.platform-header-shell.is-academic .platform-brand-copy strong {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.015em;
}

.platform-header-shell.is-academic .platform-brand-copy small {
  color: #6a7b89;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.platform-header-shell.is-academic .platform-login-button {
  min-width: 90px;
  height: 44px;
  padding-inline: 20px;
  border-color: #1263a8;
  border-radius: 10px;
  color: #ffffff;
  background: #1263a8;
  box-shadow: 0 8px 20px rgba(18, 99, 168, 0.16);
}

.platform-header-shell.is-academic .platform-login-button:hover,
.platform-header-shell.is-academic .platform-login-button:focus-visible {
  color: #ffffff;
  background: #0d528f;
  box-shadow:
    0 0 0 3px rgba(18, 99, 168, 0.12),
    0 10px 24px rgba(18, 99, 168, 0.2);
}

.platform-header-shell.is-academic .platform-login-icon {
  display: none;
}

.platform-skip-link {
  position: absolute;
  top: 8px;
  left: 12px;
  z-index: 100;
  padding: 8px 12px;
  color: #ffffff;
  background: #173247;
  text-decoration: none;
  transform: translateY(-160%);
  transition: transform 0.16s ease;
}

.platform-skip-link:focus {
  transform: translateY(0);
}

.platform-global-header {
  min-height: var(--platform-header-height, 68px);
  display: grid;
  grid-template-columns: minmax(236px, 1fr) auto minmax(236px, 1fr);
  align-items: center;
  gap: clamp(18px, 2.6vw, 38px);
  padding: 8px clamp(20px, 4vw, 58px);
  border-bottom: 1px solid var(--platform-border, #d8e3e8);
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 2px 10px rgba(21, 52, 72, 0.07);
}

.platform-brand {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 11px;
  color: #173247;
  text-decoration: none;
}

.platform-brand-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.platform-brand-copy strong,
.platform-brand-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.platform-brand-copy strong {
  font-size: 16px;
  font-weight: 800;
  line-height: 1.2;
}

.platform-brand-name-mobile {
  display: none;
}

.platform-brand-copy small {
  color: var(--platform-text-secondary, #607684);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.015em;
}

.platform-navigation {
  min-width: 0;
  display: flex;
  align-items: stretch;
  justify-content: center;
  align-self: stretch;
  gap: clamp(12px, 2vw, 28px);
}

.platform-navigation a {
  position: relative;
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  color: #385466;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
}

.platform-navigation a::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
  border-radius: 3px 3px 0 0;
  content: '';
  background: var(--platform-teal-600, #0e8f77);
  opacity: 0;
  transform: scaleX(0.4);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.platform-navigation a:hover,
.platform-navigation a:focus-visible,
.platform-navigation a.active {
  color: var(--platform-navy-900, #173247);
  outline: none;
}

.platform-navigation a:hover::after,
.platform-navigation a:focus-visible::after,
.platform-navigation a.active::after {
  opacity: 1;
  transform: scaleX(1);
}

.academic-navigation {
  gap: clamp(22px, 2.8vw, 44px);
}

.academic-navigation > a,
.academic-navigation > .academic-analysis-menu > .academic-analysis-trigger {
  color: #40586b;
  font-size: 16px;
  font-weight: 650;
  line-height: 1;
}

.academic-navigation > a::after,
.academic-navigation > .academic-analysis-menu > .academic-analysis-trigger::after {
  height: 2px;
  border-radius: 0;
  background: #1263a8;
}

.academic-analysis-menu {
  position: relative;
  min-height: 48px;
  display: grid;
  grid-template-columns: auto 22px;
  align-items: stretch;
}

.academic-analysis-trigger {
  min-width: 0;
}

.academic-analysis-toggle {
  position: relative;
  width: 22px;
  min-height: 44px;
  padding: 0;
  border: 0;
  color: #385466;
  background: transparent;
  cursor: pointer;
}

.academic-analysis-toggle span::before,
.academic-analysis-toggle span::after {
  position: absolute;
  top: 50%;
  width: 7px;
  height: 1.5px;
  content: '';
  background: currentColor;
  transition: transform 0.18s ease;
}

.academic-analysis-toggle span::before {
  right: 8px;
  transform: rotate(42deg);
}

.academic-analysis-toggle span::after {
  right: 3px;
  transform: rotate(-42deg);
}

.academic-analysis-menu.is-open .academic-analysis-toggle span::before,
.academic-analysis-menu:hover .academic-analysis-toggle span::before,
.academic-analysis-menu:focus-within .academic-analysis-toggle span::before {
  transform: rotate(-42deg);
}

.academic-analysis-menu.is-open .academic-analysis-toggle span::after,
.academic-analysis-menu:hover .academic-analysis-toggle span::after,
.academic-analysis-menu:focus-within .academic-analysis-toggle span::after {
  transform: rotate(42deg);
}

.academic-analysis-submenu {
  position: absolute;
  top: calc(100% - 1px);
  left: 50%;
  z-index: 24;
  width: min(280px, 70vw);
  display: grid;
  grid-template-columns: 1fr;
  padding: 8px;
  border: 1px solid #d7e0e6;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 18px 42px rgba(20, 48, 70, 0.12);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 8px);
  transition:
    opacity 0.2s ease,
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.academic-analysis-menu:hover .academic-analysis-submenu,
.academic-analysis-menu:focus-within .academic-analysis-submenu,
.academic-analysis-menu.is-open .academic-analysis-submenu {
  opacity: 1;
  pointer-events: auto;
  transform: translate(-50%, 0);
}

.platform-navigation .academic-analysis-submenu a {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 13px;
  border-radius: 8px;
  color: #173247;
  white-space: normal;
}

.platform-navigation .academic-analysis-submenu a::after {
  display: none;
}

.academic-analysis-submenu a:hover,
.academic-analysis-submenu a:focus-visible {
  color: #1263a8;
  background: #f4f8fb;
}

.platform-global-tools {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  justify-self: end;
  gap: 10px;
}

.platform-account-slot {
  position: relative;
  min-width: 0;
}

.platform-login-button {
  min-width: 116px;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 13px;
  border: 1px solid rgba(15, 101, 145, 0.28);
  border-radius: 8px;
  color: #ffffff;
  background: var(--platform-blue-700, #0f6591);
  box-shadow: 0 7px 16px rgba(15, 101, 145, 0.16);
  font-size: 15px;
  font-weight: 800;
  white-space: nowrap;
  cursor: pointer;
  transition:
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 180ms ease,
    color 180ms ease,
    background 180ms ease,
    box-shadow 180ms ease;
}

.platform-login-button:hover,
.platform-login-button:focus-visible {
  background: #0c567c;
  outline: none;
  box-shadow: var(--platform-focus, 0 0 0 3px rgba(14, 143, 119, 0.18));
}

.platform-login-button:active {
  transform: translateY(1px) scale(0.985);
}

.platform-login-icon {
  position: relative;
  width: 18px;
  height: 18px;
  border: 1.8px solid currentColor;
  border-radius: 50%;
}

.platform-login-icon::before {
  position: absolute;
  top: 3px;
  left: 5px;
  width: 5px;
  height: 5px;
  border: 1.4px solid currentColor;
  border-radius: 50%;
  content: '';
}

.platform-login-icon::after {
  position: absolute;
  right: 3px;
  bottom: 2px;
  left: 3px;
  height: 5px;
  border: 1.4px solid currentColor;
  border-bottom: 0;
  border-radius: 6px 6px 0 0;
  content: '';
}

.platform-account-menu {
  position: relative;
}

.platform-account-menu summary {
  min-width: 144px;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 11px 5px 6px;
  border: 1px solid #d2dee6;
  border-radius: 10px;
  color: #173247;
  background: #ffffff;
  box-shadow: 0 5px 16px rgba(18, 55, 79, 0.07);
  cursor: pointer;
  list-style: none;
  transition:
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 180ms ease,
    background 180ms ease,
    box-shadow 180ms ease;
}

.platform-account-menu summary::-webkit-details-marker {
  display: none;
}

.platform-account-menu summary:hover,
.platform-account-menu summary:focus-visible,
.platform-account-menu[open] summary {
  border-color: #9ebbd0;
  outline: none;
  background: #f8fbfd;
  box-shadow:
    0 0 0 3px rgba(18, 99, 168, 0.1),
    0 8px 22px rgba(18, 55, 79, 0.09);
}

.platform-account-menu summary:active {
  transform: translateY(1px) scale(0.99);
}

.platform-avatar {
  width: 32px;
  height: 32px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid #c8dce9;
  border-radius: 50%;
  color: #1263a8;
  background: #eaf3f9;
  font-size: 13px;
  font-weight: 800;
}

.platform-account-copy {
  min-width: 0;
  display: grid;
}

.platform-account-copy strong,
.platform-account-copy small {
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.platform-account-copy strong {
  font-size: 12px;
}

.platform-account-copy small {
  color: #728593;
  font-size: 10px;
}

.platform-account-chevron {
  width: 7px;
  height: 7px;
  margin-left: auto;
  flex: 0 0 auto;
  border-right: 1.5px solid #718695;
  border-bottom: 1.5px solid #718695;
  transform: translateY(-2px) rotate(45deg);
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}

.platform-account-menu[open] .platform-account-chevron {
  transform: translateY(2px) rotate(225deg);
}

.platform-account-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 20;
  width: 248px;
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid #cfdae2;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 22px 54px rgba(17, 48, 70, 0.16);
  transform-origin: top right;
  animation: platform-account-panel-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.platform-account-panel > div {
  display: grid;
  gap: 3px;
}

.platform-account-panel small {
  color: #607684;
  font-size: 11px;
}

.platform-account-panel a,
.platform-account-panel button {
  min-height: 40px;
  display: flex;
  align-items: center;
  padding: 0 11px;
  border: 1px solid var(--platform-border, #d8e3e8);
  border-radius: 8px;
  color: #173247;
  background: #f7fafb;
  font-size: 12px;
  font-weight: 700;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    color 160ms ease,
    background 160ms ease,
    transform 160ms ease;
}

.platform-account-panel a:hover,
.platform-account-panel a:focus-visible,
.platform-account-panel button:hover,
.platform-account-panel button:focus-visible {
  border-color: #acc4d5;
  color: #0d568f;
  outline: none;
  background: #edf5fa;
}

.platform-account-panel a:active,
.platform-account-panel button:active {
  transform: translateY(1px);
}

@keyframes platform-account-panel-in {
  from {
    opacity: 0;
    transform: translateY(-7px) scale(0.98);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.platform-menu-button {
  width: 42px;
  height: 42px;
  display: none;
  place-items: center;
  border: 1px solid var(--platform-border, #d8e3e8);
  border-radius: 8px;
  background: #ffffff;
  cursor: pointer;
}

.platform-menu-button i {
  width: 17px;
  height: 2px;
  display: block;
  margin: 2px auto;
  border-radius: 999px;
  background: #385466;
}

.platform-context-bar {
  min-height: var(--platform-context-height, 50px);
  display: grid;
  grid-template-columns: minmax(220px, auto) minmax(260px, 1fr) auto;
  align-items: center;
  gap: 20px;
  padding: 3px clamp(20px, 4vw, 58px);
  border-bottom: 1px solid var(--platform-border, #d8e3e8);
  background: #f7fafb;
}

.platform-context-heading {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 9px;
  padding-left: 11px;
  border-left: 3px solid var(--platform-teal-600, #0e8f77);
}

.platform-context-heading strong,
.platform-context-heading small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.platform-context-heading strong {
  color: #173247;
  font-size: 16px;
  font-weight: 800;
}

.platform-context-heading small {
  color: #607684;
  font-size: 11px;
  font-weight: 600;
}

.platform-context-content {
  min-width: 0;
  justify-self: center;
  width: min(720px, 100%);
}

.platform-context-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.platform-home-guide-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 40px;
  padding: 8px 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #456a84;
  font: inherit;
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;
}
.platform-home-guide-button:hover {
  color: #1263a8;
  background: #eff5f9;
}
.platform-home-guide-button:focus-visible {
  outline: 2px solid #1263a8;
  outline-offset: 2px;
}
.platform-home-guide-icon {
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  border: 1px solid #9aafbd;
  border-radius: 50%;
  font-size: 12px;
  line-height: 1;
}

@media (max-width: 1260px) {
  .platform-global-header {
    grid-template-columns: minmax(210px, 1fr) auto minmax(210px, 1fr);
    gap: 18px;
  }

  .platform-navigation {
    gap: 16px;
  }

  .platform-brand-copy small {
    display: none;
  }
}

@media (max-width: 1020px) {
  .platform-global-header {
    position: relative;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .platform-navigation {
    position: absolute;
    top: calc(100% + 1px);
    right: 18px;
    z-index: 30;
    width: min(320px, calc(100vw - 36px));
    display: none;
    padding: 8px;
    border: 1px solid var(--platform-border, #d8e3e8);
    border-radius: 10px;
    background: #ffffff;
    box-shadow: var(--platform-shadow-md, 0 12px 34px rgba(21, 52, 72, 0.12));
  }

  .platform-navigation.is-open {
    display: grid;
  }

  .platform-navigation a {
    min-height: 44px;
    padding: 0 12px;
    border-radius: 7px;
  }

  .platform-navigation a::after {
    top: 8px;
    right: auto;
    bottom: 8px;
    left: 0;
    width: 3px;
    height: auto;
  }

  .academic-navigation {
    gap: 2px;
  }

  .academic-analysis-menu {
    min-height: auto;
    grid-template-columns: 1fr 44px;
  }

  .academic-analysis-trigger {
    min-height: 44px;
    padding: 0 12px;
    border-radius: 7px;
  }

  .academic-analysis-toggle {
    width: 44px;
  }

  .academic-analysis-submenu {
    position: static;
    width: auto;
    display: none;
    grid-column: 1 / -1;
    grid-template-columns: 1fr;
    margin: 2px 0 6px;
    padding: 5px 8px 8px 18px;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }

  .academic-analysis-menu:hover .academic-analysis-submenu,
  .academic-analysis-menu:focus-within .academic-analysis-submenu {
    display: none;
    transform: none;
  }

  .academic-analysis-menu.is-open .academic-analysis-submenu,
  .academic-analysis-menu.is-open:hover .academic-analysis-submenu,
  .academic-analysis-menu.is-open:focus-within .academic-analysis-submenu {
    display: grid;
  }

  .platform-navigation .academic-analysis-submenu a {
    min-height: 44px;
    padding: 8px 12px;
    font-size: 13px;
  }

  .platform-menu-button {
    display: block;
  }

  .platform-context-bar {
    grid-template-columns: minmax(180px, auto) minmax(220px, 1fr) auto;
    gap: 12px;
  }
}

@media (max-width: 760px) {
  .platform-home-guide-button {
    width: 36px;
    min-height: 40px;
    padding: 0;
  }
  .platform-home-guide-label {
    display: none;
  }
  .platform-home-guide-icon {
    width: 20px;
    height: 20px;
    font-size: 13px;
  }

  .platform-global-header {
    min-height: 56px;
    padding: 7px 14px;
  }

  .platform-brand :deep(.site-emblem) {
    --emblem-size: 36px !important;
  }

  .platform-brand-copy strong {
    max-width: 154px;
    font-size: 14px;
  }

  .platform-header-shell.is-academic .platform-brand-copy strong {
    font-size: 15px;
  }

  .platform-header-shell.is-academic .platform-brand-name {
    display: none;
  }

  .platform-header-shell.is-academic .platform-brand-name-mobile {
    display: block;
  }

  .platform-account-copy {
    display: none;
  }

  .platform-account-chevron {
    display: none;
  }

  .platform-account-menu summary,
  .platform-login-button {
    min-width: 42px;
    width: 42px;
    padding: 0;
    font-size: 0;
  }

  .platform-login-icon {
    width: 19px;
    height: 19px;
  }

  .platform-header-shell.is-academic .platform-login-button {
    width: auto;
    min-width: 64px;
    padding: 0 12px;
    font-size: 13px;
  }

  .platform-context-bar {
    min-height: 52px;
    grid-template-columns: minmax(130px, auto) minmax(0, 1fr) auto;
    padding: 5px 14px;
  }

  .platform-context-heading {
    display: grid;
    gap: 1px;
  }

  .platform-context-heading strong {
    font-size: 14px;
  }

  .platform-context-heading small {
    max-width: 145px;
    font-size: 10px;
  }
}

@media (max-width: 520px) {
  .platform-global-header {
    gap: 10px;
  }

  .platform-brand-copy strong {
    max-width: 132px;
  }

  .platform-context-bar {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .platform-context-content {
    grid-row: 2;
    grid-column: 1 / -1;
  }

  .platform-context-bar:has(.platform-context-content:not(:empty)) {
    padding-block: 8px;
  }
}

.platform-header-shell.is-academic.is-home,
.platform-header-shell.is-academic.is-home .platform-global-header {
  color: #f7fbfd;
  background: #176ca7;
}

.platform-header-shell.is-academic.is-home .platform-global-header {
  border-bottom-color: rgba(222, 238, 248, 0.3);
  box-shadow: 0 3px 12px rgba(17, 72, 110, 0.16);
}

.platform-header-shell.is-academic.is-home .platform-brand,
.platform-header-shell.is-academic.is-home .platform-brand-copy strong {
  color: #f7fbfd;
}

.platform-header-shell.is-academic.is-home .platform-brand :deep(.site-emblem.is-academic) {
  color: #f7fbfd;
}

.platform-header-shell.is-academic.is-home .platform-brand :deep(.site-emblem-path) {
  stroke: #f4f9fc;
}

.platform-header-shell.is-academic.is-home .platform-brand :deep(.site-emblem-node) {
  fill: #9bd4f1;
  stroke: #176ca7;
}

.platform-header-shell.is-academic.is-home .academic-navigation > a,
.platform-header-shell.is-academic.is-home
  .academic-navigation
  > .academic-analysis-menu
  > .academic-analysis-trigger {
  color: #e2eff6;
}

.platform-header-shell.is-academic.is-home .academic-navigation > a:hover,
.platform-header-shell.is-academic.is-home .academic-navigation > a:focus-visible,
.platform-header-shell.is-academic.is-home .academic-navigation > a.active,
.platform-header-shell.is-academic.is-home
  .academic-navigation
  > .academic-analysis-menu
  > .academic-analysis-trigger:hover,
.platform-header-shell.is-academic.is-home
  .academic-navigation
  > .academic-analysis-menu
  > .academic-analysis-trigger:focus-visible,
.platform-header-shell.is-academic.is-home
  .academic-navigation
  > .academic-analysis-menu
  > .academic-analysis-trigger.active {
  color: #ffffff;
}

.platform-header-shell.is-academic.is-home .academic-navigation > a::after,
.platform-header-shell.is-academic.is-home
  .academic-navigation
  > .academic-analysis-menu
  > .academic-analysis-trigger::after {
  background: #c4e7f8;
}

.platform-header-shell.is-academic.is-home .academic-analysis-toggle,
.platform-header-shell.is-academic.is-home .platform-home-guide-button {
  color: #e0eef6;
}

.platform-header-shell.is-academic.is-home .platform-home-guide-button:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.12);
}

.platform-header-shell.is-academic.is-home .platform-home-guide-button:focus-visible {
  outline-color: #3b91c3;
}

.platform-header-shell.is-academic.is-home .platform-home-guide-icon {
  border-color: rgba(226, 241, 249, 0.72);
}

.platform-header-shell.is-academic.is-home .platform-login-button {
  border-color: rgba(255, 255, 255, 0.9);
  color: #115f95;
  background: #f8fbfd;
  box-shadow: 0 6px 16px rgba(12, 61, 94, 0.16);
}

.platform-header-shell.is-academic.is-home .platform-login-button:hover,
.platform-header-shell.is-academic.is-home .platform-login-button:focus-visible {
  color: #0d5688;
  background: #eaf5fb;
  box-shadow:
    0 0 0 3px rgba(65, 143, 190, 0.15),
    0 8px 20px rgba(22, 91, 136, 0.2);
}

.platform-header-shell.is-academic.is-home .platform-account-menu summary {
  border-color: rgba(224, 239, 247, 0.48);
  color: #f7fbfd;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: none;
}

.platform-header-shell.is-academic.is-home .platform-account-menu summary:hover,
.platform-header-shell.is-academic.is-home .platform-account-menu summary:focus-visible,
.platform-header-shell.is-academic.is-home .platform-account-menu[open] summary {
  border-color: rgba(232, 244, 250, 0.78);
  background: rgba(255, 255, 255, 0.16);
}

.platform-header-shell.is-academic.is-home .platform-account-copy small {
  color: #d2e6f1;
}

.platform-header-shell.is-academic.is-home .platform-avatar {
  border-color: #8cb6ce;
  color: #ffffff;
  background: #297ead;
}

.platform-header-shell.is-academic.is-home .platform-account-chevron {
  border-color: #e2f0f7;
}

.platform-header-shell.is-academic.is-home .platform-menu-button {
  border-color: rgba(225, 240, 248, 0.54);
  background: rgba(255, 255, 255, 0.08);
}

.platform-header-shell.is-academic.is-home .platform-menu-button i {
  background: #f2f8fb;
}

@media (max-width: 1020px) {
  .platform-header-shell.is-academic.is-home .academic-navigation {
    border-color: #cbdbe5;
    background: #ffffff;
  }

  .platform-header-shell.is-academic.is-home .academic-navigation > a,
  .platform-header-shell.is-academic.is-home
    .academic-navigation
    > .academic-analysis-menu
    > .academic-analysis-trigger,
  .platform-header-shell.is-academic.is-home .academic-analysis-toggle {
    color: #294b63;
  }

  .platform-header-shell.is-academic.is-home .academic-navigation > a:hover,
  .platform-header-shell.is-academic.is-home .academic-navigation > a:focus-visible,
  .platform-header-shell.is-academic.is-home .academic-navigation > a.active,
  .platform-header-shell.is-academic.is-home
    .academic-navigation
    > .academic-analysis-menu
    > .academic-analysis-trigger:hover,
  .platform-header-shell.is-academic.is-home
    .academic-navigation
    > .academic-analysis-menu
    > .academic-analysis-trigger:focus-visible,
  .platform-header-shell.is-academic.is-home
    .academic-navigation
    > .academic-analysis-menu
    > .academic-analysis-trigger.active {
    color: #0d5e9e;
  }
}

@media (prefers-reduced-motion: reduce) {
  .platform-login-button,
  .platform-account-menu summary,
  .platform-account-chevron,
  .platform-account-panel,
  .platform-account-panel a,
  .platform-account-panel button,
  .platform-navigation a::after,
  .platform-skip-link,
  .academic-analysis-toggle span::before,
  .academic-analysis-toggle span::after,
  .academic-analysis-submenu {
    animation: none;
    transition: none;
  }
}
</style>
