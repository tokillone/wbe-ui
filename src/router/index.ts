import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

import { canManageData, getStoredSession } from '../services/session'

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

router.beforeEach((to) => {
  if (to.meta.requiresManager && !canManageData(getStoredSession()?.user)) {
    return '/'
  }
  return true
})

export default router
