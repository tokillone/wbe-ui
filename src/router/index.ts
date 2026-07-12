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
