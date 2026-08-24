<script setup lang="ts">
import { RouterLink } from 'vue-router'
import BrandMark from '../BrandMark.vue'
</script>

<template>
  <header class="evidence-header">
    <div class="evidence-container evidence-header__inner">
      <RouterLink class="evidence-brand" to="/" aria-label="返回污水信息因子数据库首页">
        <BrandMark :size="40" />
        <span class="evidence-brand__copy">
          <strong>污水信息因子数据库</strong>
          <small>WASTEWATER BIOMARKER EVIDENCE</small>
        </span>
      </RouterLink>
      <nav aria-label="可视化模块导航">
        <RouterLink to="/map-visualization">空间分布</RouterLink>
        <RouterLink to="/icd11-sankey">疾病关联</RouterLink>
        <span class="active">方法学核验</span>
      </nav>
      <RouterLink class="evidence-home-link" to="/">返回首页</RouterLink>
    </div>
  </header>
</template>
