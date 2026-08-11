import { describe, expect, it } from 'vitest'

import { mount } from '@vue/test-utils'
import App from '../App.vue'
import router from '../router'

describe('App', () => {
  it('mounts renders the home route', async () => {
    router.push('/')
    await router.isReady()
    const wrapper = mount(App, {
      global: {
        plugins: [router],
      },
    })

    expect(wrapper.text()).toContain('污水信息因子数据库')
    expect(wrapper.text()).toContain('ICD11 桑基图')
    expect(wrapper.text()).toContain('核心标记物优先级')
    expect(wrapper.text()).toContain('方法学核验')
    expect(wrapper.text()).not.toContain('数据说明')
    expect(wrapper.text()).not.toContain('下载申请')
    expect(router.getRoutes().some((route) => route.path === '/icd11-sankey')).toBe(true)
    expect(router.getRoutes().some((route) => route.path === '/core-marker-priority')).toBe(true)
    expect(router.getRoutes().some((route) => route.path === '/methodology-verification')).toBe(true)
  })
})
