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
    expect(wrapper.text()).toContain('空间分布查询')
    expect(wrapper.text()).toContain('疾病关联分析')
    expect(wrapper.text()).toContain('标记物优先级评估')
    expect(wrapper.text()).not.toContain('采样与分析方法核验')
    expect(wrapper.text()).toContain('从国家到城市定位研究证据，并比较人群归一化负荷')
    expect(wrapper.text()).toContain('沿 ICD-11 层级追踪疾病、药物与生物标记物的证据路径')
    expect(wrapper.text()).toContain('用分层证据评分识别核心标记物，并定位证据缺口')
    expect(wrapper.text()).not.toContain('核对采样策略、分析技术与报告完整性，判断研究是否可比')
    expect(wrapper.text()).not.toContain('集中为四个真实功能入口')
    expect(wrapper.text()).not.toContain('数据说明')
    expect(wrapper.text()).not.toContain('下载申请')
    expect(router.getRoutes().some((route) => route.path === '/icd11-sankey')).toBe(true)
    expect(router.getRoutes().some((route) => route.path === '/core-marker-priority')).toBe(true)
    expect(router.getRoutes().find((route) => route.path === '/methodology-verification')?.redirect).toEqual({ path: '/icd11-sankey', hash: '#reading-guide' })
  })
})
