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
  })
})
