<script setup lang="ts">
import { RouterLink } from 'vue-router'

import BrandMark from '../BrandMark.vue'

type SearchResult = {
  id: string
  label: string
  meta: string
  level: 'country' | 'admin1' | 'city'
  geoKey: string
  center?: [number, number]
  bbox?: [number, number, number, number]
}

defineProps<{
  ui: Record<string, string>
  searchQuery: string
  searchFocused: boolean
  searchResults: SearchResult[]
  locale: 'zh' | 'en'
  languageMenuOpen: boolean
}>()

const emit = defineEmits<{
  'update:searchQuery': [value: string]
  'update:languageMenuOpen': [value: boolean]
  openSearch: []
  closeSearchSoon: []
  applyFirstResult: []
  clearSearch: []
  selectResult: [result: SearchResult]
  setLocale: [locale: 'zh' | 'en']
}>()
</script>

<template>
  <header class="site-header">
    <RouterLink class="brand" to="/" :aria-label="ui.brandHome">
      <BrandMark :size="40" />
      <span>
        <strong>{{ ui.brandTitle }}</strong>
        <small>{{ ui.brandSubtitle }}</small>
      </span>
    </RouterLink>

    <div class="header-center">
      <h1 class="page-title">{{ ui.pageTitle }}</h1>
      <div class="location-search" :class="{ active: searchFocused && searchQuery }">
        <span class="search-mark" aria-hidden="true"></span>
        <input
          :value="searchQuery"
          type="search"
          :placeholder="ui.searchPlaceholder"
          :aria-label="ui.searchLabel"
          @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
          @focus="emit('openSearch')"
          @blur="emit('closeSearchSoon')"
          @keydown.enter.prevent="emit('applyFirstResult')"
        />
        <button
          v-if="searchQuery"
          type="button"
          :aria-label="ui.clearSearch"
          @mousedown.prevent
          @click="emit('clearSearch')"
        >
          ×
        </button>
        <div v-if="searchFocused && searchQuery" class="search-results">
          <button
            v-for="result in searchResults"
            :key="result.id"
            type="button"
            @mousedown.prevent
            @click.stop="emit('selectResult', result)"
          >
            <strong>{{ result.label }}</strong>
            <span>{{ result.meta }}</span>
          </button>
          <p v-if="!searchResults.length">{{ ui.noSearchResults }}</p>
        </div>
      </div>
    </div>

    <div class="header-tools">
      <div class="language-menu" :class="{ open: languageMenuOpen }">
        <button
          type="button"
          :aria-label="ui.languageMenu"
          :aria-expanded="languageMenuOpen"
          @click="emit('update:languageMenuOpen', !languageMenuOpen)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"></path>
          </svg>
          <span>{{ locale === 'zh' ? '中' : 'EN' }}</span>
        </button>
        <div v-if="languageMenuOpen" class="language-popover">
          <button type="button" :class="{ active: locale === 'zh' }" @click="emit('setLocale', 'zh')">
            {{ ui.chinese }}
          </button>
          <button type="button" :class="{ active: locale === 'en' }" @click="emit('setLocale', 'en')">
            {{ ui.english }}
          </button>
        </div>
      </div>
      <RouterLink class="login-button" to="/">{{ ui.backHome }}</RouterLink>
    </div>
  </header>
</template>
