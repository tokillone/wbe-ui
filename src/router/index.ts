import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

import { fetchCurrentUser } from '../services/auth'
import { canManageData, clearSession, getStoredSession, updateStoredUser } from '../services/session'

const optionalViews = import.meta.glob('../views/DataEntryView.vue')
const dataEntryView = optionalViews['../views/DataEntryView.vue']

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
  },
  {
    path: '/map-visualization',
    name: 'map-visualization',
    component: () => import('../views/MapVisualizationView.vue'),
  },
  {
    path: '/icd11-sankey',
    name: 'icd11-sankey',
    component: () => import('../views/Icd11SankeyView.vue'),
  },
  {
    path: '/core-marker-priority',
    name: 'core-marker-priority',
    component: () => import('../views/CoreMarkerPriorityView.vue'),
  },
  {
    path: '/methodology-verification',
    name: 'methodology-verification',
    redirect: { path: '/icd11-sankey', hash: '#reading-guide' },
  },
  {
    path: '/guide',
    name: 'guide',
    component: () => import('../views/GuideView.vue'),
  },
  {
    path: '/about',
    name: 'about',
    component: () => import('../views/AboutView.vue'),
  },
  {
    path: '/ui-home-academic',
    redirect: {
      path: '/',
      query: { ui: 'academic-home' },
    },
  },
]

if (dataEntryView) {
  routes.push({
    path: '/data-entry',
    name: 'data-entry',
    component: dataEntryView,
    meta: { requiresManager: true },
  })
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) {
      return {
        el: to.hash,
        top: 120,
        behavior: 'smooth',
      }
    }
    return { top: 0 }
  },
})

router.beforeEach(async (to) => {
  if (!to.meta.requiresManager) {
    return true
  }
  const session = getStoredSession()
  if (!session) {
    return '/'
  }
  try {
    const user = await fetchCurrentUser(session.token)
    updateStoredUser(user)
    if (!canManageData(user)) {
      return '/'
    }
  } catch {
    clearSession()
    return '/'
  }
  return true
})

export default router
