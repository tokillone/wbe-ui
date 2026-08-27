<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { logout as requestLogout, type UserResponse } from '../services/auth'
import { canManageData, clearSession, getStoredSession } from '../services/session'
import BrandMark from './BrandMark.vue'

type ModuleKey = 'home' | 'map' | 'sankey' | 'priority' | 'methodology' | 'data'

const props = withDefaults(
  defineProps<{
    active?: ModuleKey
    pageTitle?: string
    pageSubtitle?: string
    showContext?: boolean
    sticky?: boolean
  }>(),
  {
    active: undefined,
    pageTitle: '',
    pageSubtitle: '',
    showContext: false,
    sticky: true,
  },
)

const emit = defineEmits<{
  requestAuth: []
  logout: []
}>()

const route = useRoute()
const router = useRouter()
const mobileMenuOpen = ref(false)
const sessionUser = ref<UserResponse | null>(getStoredSession()?.user ?? null)
const isLoggingOut = ref(false)

const navigation = [
  { key: 'home' as const, label: '首页', to: '/' },
  { key: 'map' as const, label: '空间分布查询', to: '/map-visualization' },
  { key: 'sankey' as const, label: '疾病关联分析', to: '/icd11-sankey' },
  { key: 'priority' as const, label: '标记物优先级评估', to: '/core-marker-priority' },
  {
    key: 'methodology' as const,
    label: '采样与分析方法核验',
    to: '/methodology-verification',
  },
]

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
}

async function requestAuth() {
  closeMobileMenu()
  emit('requestAuth')
  if (route.path !== '/') {
    await router.push({ path: '/', query: { auth: 'login' } })
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
})

onBeforeUnmount(() => {
  window.removeEventListener('storage', syncSession)
  window.removeEventListener('wbe-auth-changed', syncSession)
})
</script>

<template>
  <div class="platform-header-shell" :class="{ 'is-sticky': sticky, 'has-context': showContext }">
    <a class="platform-skip-link" href="#main-content">跳到主要内容</a>

    <header class="platform-global-header">
      <RouterLink class="platform-brand" to="/" aria-label="污水信息因子数据库首页">
        <BrandMark :size="40" compact />
        <span class="platform-brand-copy">
          <strong>污水信息因子数据库</strong>
          <small>WASTEWATER BIOMARKER EVIDENCE</small>
        </span>
      </RouterLink>

      <nav
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
          @click="closeMobileMenu"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="platform-global-tools">
        <div class="platform-account-slot">
          <slot name="account">
            <details v-if="sessionUser" class="platform-account-menu">
              <summary>
                <span class="platform-avatar" aria-hidden="true">{{
                  sessionUser.username.slice(0, 1).toUpperCase()
                }}</span>
                <span class="platform-account-copy">
                  <strong>{{ sessionUser.username }}</strong>
                  <small>{{ roleLabel }}</small>
                </span>
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
            <button v-else class="platform-login-button" type="button" @click="requestAuth">
              <span class="platform-login-icon" aria-hidden="true"></span>
              <span>登录 / 注册</span>
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
  font-family:
    Inter, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;
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
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
  cursor: pointer;
}

.platform-login-button:hover,
.platform-login-button:focus-visible {
  background: #0c567c;
  outline: none;
  box-shadow: var(--platform-focus, 0 0 0 3px rgba(14, 143, 119, 0.18));
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
  min-width: 128px;
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 5px;
  border: 1px solid rgba(14, 143, 119, 0.24);
  border-radius: 8px;
  background: #f4faf8;
  cursor: pointer;
  list-style: none;
}

.platform-account-menu summary::-webkit-details-marker {
  display: none;
}

.platform-avatar {
  width: 32px;
  height: 32px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 7px;
  color: #ffffff;
  background: var(--platform-teal-700, #0b7868);
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
  color: #607684;
  font-size: 10px;
}

.platform-account-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 20;
  width: 220px;
  display: grid;
  gap: 9px;
  padding: 13px;
  border: 1px solid var(--platform-border, #d8e3e8);
  border-radius: 10px;
  background: #ffffff;
  box-shadow: var(--platform-shadow-md, 0 12px 34px rgba(21, 52, 72, 0.12));
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
  min-height: 38px;
  display: flex;
  align-items: center;
  padding: 0 11px;
  border: 1px solid var(--platform-border, #d8e3e8);
  border-radius: 7px;
  color: #173247;
  background: #f7fafb;
  font-size: 12px;
  font-weight: 700;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
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

  .platform-menu-button {
    display: block;
  }

  .platform-context-bar {
    grid-template-columns: minmax(180px, auto) minmax(220px, 1fr) auto;
    gap: 12px;
  }
}

@media (max-width: 760px) {
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

  .platform-account-copy {
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

@media (prefers-reduced-motion: reduce) {
  .platform-navigation a::after,
  .platform-skip-link {
    transition: none;
  }
}
</style>
