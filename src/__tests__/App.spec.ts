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
    expect(wrapper.text()).toContain('采样与分析方法核验')
    expect(wrapper.text()).toContain('按空间层级查看 PNDL 分布')
    expect(wrapper.text()).toContain('基于 ICD-11 分析疾病、药物与生物标记物的关联路径')
    expect(wrapper.text()).toContain('依据证据评分识别核心标记物及证据短板')
    expect(wrapper.text()).toContain('核查处方属性、采样路径与分析方法覆盖')
    expect(wrapper.text()).not.toContain('集中为四个真实功能入口')
    expect(wrapper.text()).not.toContain('数据说明')
    expect(wrapper.text()).not.toContain('下载申请')
    expect(router.getRoutes().some((route) => route.path === '/icd11-sankey')).toBe(true)
    expect(router.getRoutes().some((route) => route.path === '/core-marker-priority')).toBe(true)
    expect(router.getRoutes().some((route) => route.path === '/methodology-verification')).toBe(true)
  })
})
