<script setup lang="ts">
defineProps<{ sourceText: string }>()
</script>

<template>
  <section id="main-content" class="evidence-hero" aria-labelledby="methodologyTitle" tabindex="-1">
    <div class="evidence-container evidence-hero__inner">
      <div class="evidence-hero__copy">
        <p class="evidence-eyebrow">METHODOLOGY EVIDENCE</p>
        <h1 id="methodologyTitle">采样与分析方法核验</h1>
        <p>追溯每项研究的处方属性、采样方案与分析技术，检查分类一致性、报告完整性和证据覆盖范围。</p>
      </div>
      <aside class="evidence-hero__card" aria-label="数据处理流程">
        <span>数据处理流程</span>
        <strong>原始记录 → 术语标准化 → 去重统计 → 覆盖率</strong>
        <p>{{ sourceText }}</p>
      </aside>
    </div>
  </section>
</template>
