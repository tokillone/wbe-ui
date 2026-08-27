import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MapFilterSelect from '../components/MapFilterSelect.vue'
import type { MapBiomarkerPath, MapFilterSelection } from '../types/map'
import {
  ALL_BIOMARKER_PATH_KEY,
  biomarkerFilterOptions,
  biomarkerPathKey,
  selectionForAllBiomarkers,
  selectionForBiomarkerPath,
  selectionForCategory,
} from '../utils/mapFilters'

const cotininePaths: MapBiomarkerPath[] = [
  {
    targetClass: '消费/生活方式类',
    category: '烟草使用标志物',
    subcategory: '尼古丁及代谢物',
    biomarkerKey: 'COTININE',
    biomarkerLabel: '可替宁',
    biomarkerCas: '486-56-6',
  },
  {
    targetClass: '人体暴露类',
    category: '生物标记物',
    subcategory: '烟草暴露',
    biomarkerKey: 'COTININE',
    biomarkerLabel: '可替宁',
    biomarkerCas: '486-56-6',
  },
]

describe('map biomarker reverse filtering', () => {
  it('atomically fills the unique parent when a concrete substance category is selected', () => {
    const current: MapFilterSelection = {
      targetClass: 'ALL',
      category: '全部目标物质类别',
      subcategory: '已有小类',
      biomarkerKey: 'EXISTING',
      year: '2024',
    }
    const defaults = {
      allCategory: '全部目标物质类别',
      allSubcategory: '全部小类',
      allBiomarker: 'ALL',
      allYear: '全部年份',
    }

    expect(
      selectionForCategory(
        current,
        'N02 镇痛药',
        {
          'N 神经系统药物': ['全部目标物质类别', 'N02 镇痛药'],
          'A 消化道和代谢系统药物': ['全部目标物质类别', 'A10 糖尿病用药'],
        },
        defaults,
      ),
    ).toEqual({
      targetClass: 'N 神经系统药物',
      category: 'N02 镇痛药',
      subcategory: '全部小类',
      biomarkerKey: 'ALL',
      year: '全部年份',
    })

    expect(
      selectionForCategory(
        { ...current, targetClass: 'N 神经系统药物' },
        '全部目标物质类别',
        {},
        defaults,
      ),
    ).toEqual({
      targetClass: 'N 神经系统药物',
      category: '全部目标物质类别',
      subcategory: '全部小类',
      biomarkerKey: 'ALL',
      year: '全部年份',
    })
  })

  it('rejects missing or ambiguous category parents without changing the draft', () => {
    const current: MapFilterSelection = {
      targetClass: 'ALL',
      category: '全部目标物质类别',
      subcategory: '全部小类',
      biomarkerKey: 'ALL',
      year: '全部年份',
    }
    const defaults = {
      allCategory: '全部目标物质类别',
      allSubcategory: '全部小类',
      allBiomarker: 'ALL',
      allYear: '全部年份',
    }

    expect(selectionForCategory(current, '未知类别', {}, defaults)).toBeNull()
    expect(
      selectionForCategory(
        current,
        '重复类别',
        { '父级 A': ['重复类别'], '父级 B': ['重复类别'] },
        defaults,
      ),
    ).toBeNull()
    expect(current.category).toBe('全部目标物质类别')
  })

  it('keeps duplicate biomarkers as separate full-path options searchable by name, CAS and parents', async () => {
    const options = biomarkerFilterOptions(cotininePaths, [], '全部生物标记物')
    expect(options).toHaveLength(3)
    expect(options.slice(1).map((option) => option.value)).toEqual(
      cotininePaths.map(biomarkerPathKey),
    )

    const wrapper = mount(MapFilterSelect, {
      props: {
        id: 'biomarker-test',
        label: '生物标记物',
        modelValue: ALL_BIOMARKER_PATH_KEY,
        options,
      },
    })
    await wrapper.get('.map-filter-select-trigger').trigger('click')
    const search = wrapper.get('input[type="search"]')

    await search.setValue('可替宁')
    const matchingOptions = wrapper.findAll('.map-filter-select-option')
    expect(matchingOptions).toHaveLength(2)
    expect(new Set(matchingOptions.map((option) => option.attributes('id'))).size).toBe(2)
    await search.setValue('486-56-6')
    expect(wrapper.findAll('.map-filter-select-option')).toHaveLength(2)
    await search.setValue('人体暴露类')
    expect(wrapper.findAll('.map-filter-select-option')).toHaveLength(1)
    expect(wrapper.get('.map-filter-select-option').text()).toContain('生物标记物 › 烟草暴露')

    await wrapper.get('.map-filter-select-option').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([biomarkerPathKey(cotininePaths[1]!)])
  })

  it('atomically fills every parent and resets the year for the selected path', () => {
    const current: MapFilterSelection = {
      targetClass: 'ALL',
      category: '全部目标物质类别',
      subcategory: '全部小类',
      biomarkerKey: 'ALL',
      year: '2024',
    }

    expect(selectionForBiomarkerPath(current, cotininePaths[1]!, '全部年份')).toEqual({
      targetClass: '人体暴露类',
      category: '生物标记物',
      subcategory: '烟草暴露',
      biomarkerKey: 'COTININE',
      year: '全部年份',
    })
  })

  it('falls back to the current-path legacy list only when biomarkerPaths is absent', () => {
    const legacy = [{ key: 'COTININE', label: '可替宁', cas: '486-56-6' }]

    expect(biomarkerFilterOptions(undefined, legacy, '全部生物标记物')).toEqual([
      {
        value: 'COTININE',
        label: '可替宁',
        searchText: 'COTININE 486-56-6',
      },
    ])
    expect(biomarkerFilterOptions([], legacy, '全部生物标记物')).toEqual([
      { value: ALL_BIOMARKER_PATH_KEY, label: '全部生物标记物' },
    ])
  })

  it('clears only the biomarker and year when all biomarkers is selected', () => {
    const current: MapFilterSelection = {
      targetClass: '人体暴露类',
      category: '生物标记物',
      subcategory: '烟草暴露',
      biomarkerKey: 'COTININE',
      year: '2024',
    }

    expect(selectionForAllBiomarkers(current, '全部年份')).toEqual({
      targetClass: '人体暴露类',
      category: '生物标记物',
      subcategory: '烟草暴露',
      biomarkerKey: 'ALL',
      year: '全部年份',
    })
  })
})
