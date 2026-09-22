<script setup lang="ts">
import { RouterLink } from 'vue-router'

import BrandMark from '../BrandMark.vue'

const currentYear = new Date().getFullYear()
</script>

<template>
  <footer class="academic-site-footer">
    <div class="academic-footer-main">
      <div class="academic-footer-brand">
        <BrandMark :size="40" compact variant="academic" />
        <strong>污水信息因子数据库</strong>
        <p>整合文献、标记物、空间分布与疾病关联信息，为研究检索、比较和核验提供统一入口。</p>
      </div>

      <nav aria-label="分析工具">
        <strong>可视化分析</strong>
        <RouterLink to="/map-visualization">空间分布查询</RouterLink>
        <RouterLink to="/icd11-sankey">疾病关联分析</RouterLink>
        <RouterLink to="/core-marker-priority">标记物优先级评估</RouterLink>
      </nav>

      <nav aria-label="平台信息">
        <strong>平台信息</strong>
        <RouterLink to="/guide">使用说明</RouterLink>
        <RouterLink to="/about">关于数据库</RouterLink>
        <RouterLink to="/about#principles">维护原则</RouterLink>
        <RouterLink :to="{ path: '/', hash: '#visual' }">证据结构</RouterLink>
      </nav>

      <div class="academic-footer-scope">
        <strong>适用边界</strong>
        <p>
          平台用于证据检索、研究比较与方法核验，不替代临床诊断、实验室质量控制或公共卫生决策程序。
        </p>
      </div>
    </div>

    <div class="academic-footer-bottom">
      <small>© {{ currentYear }} WBE Evidence Database</small>
      <small>数据字段、统计口径与更新记录保持可追溯</small>
    </div>
  </footer>
</template>

<style scoped>
.academic-site-footer {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 clamp(22px, 4.5vw, 72px);
  border-top: 1px solid var(--academic-line, #d7e0e6);
  color: var(--academic-ink, #0b1f33);
  background: #fff;
  font-family: var(
    --academic-font,
    'Microsoft YaHei',
    '微软雅黑',
    Arial,
    sans-serif
  );
}

.academic-footer-main {
  display: grid;
  grid-template-columns: minmax(280px, 1.45fr) minmax(180px, 0.72fr) minmax(150px, 0.62fr) minmax(
      230px,
      0.9fr
    );
  gap: clamp(30px, 5vw, 72px);
  padding: 52px 0 46px;
}

.academic-footer-brand {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-content: start;
  align-items: center;
  gap: 0 12px;
}

.academic-footer-brand > strong,
.academic-footer-main nav > strong,
.academic-footer-scope > strong {
  color: var(--academic-ink, #0b1f33);
  font-size: 14px;
  font-weight: 720;
}

.academic-footer-brand p {
  grid-column: 1 / -1;
  max-width: 38em;
  margin: 20px 0 0;
  color: var(--academic-muted, #56697a);
  font-size: 12px;
  line-height: 1.72;
}

.academic-footer-main nav,
.academic-footer-scope {
  display: grid;
  align-content: start;
  gap: 11px;
}

.academic-footer-main nav > strong,
.academic-footer-scope > strong {
  margin-bottom: 5px;
}

.academic-footer-main a {
  color: var(--academic-muted, #56697a);
  font-size: 12px;
  line-height: 1.5;
  text-decoration: none;
}

.academic-footer-main a:hover,
.academic-footer-main a:focus-visible {
  color: var(--academic-accent, #1263a8);
  outline: none;
}

.academic-footer-scope p {
  margin: 0;
  color: var(--academic-muted, #56697a);
  font-size: 12px;
  line-height: 1.72;
}

.academic-footer-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 0 24px;
  border-top: 1px solid #e6ecf0;
}

.academic-footer-bottom small {
  color: #71818f;
  font-size: 10px;
}

@media (max-width: 980px) {
  .academic-footer-main {
    grid-template-columns: minmax(280px, 1.4fr) repeat(2, minmax(150px, 0.7fr));
  }

  .academic-footer-scope {
    grid-column: 1 / -1;
    padding-top: 24px;
    border-top: 1px solid #e6ecf0;
  }
}

@media (max-width: 620px) {
  .academic-site-footer {
    padding-inline: 20px;
  }

  .academic-footer-main {
    grid-template-columns: 1fr 1fr;
    gap: 34px 24px;
    padding-block: 42px 36px;
  }

  .academic-footer-brand,
  .academic-footer-scope {
    grid-column: 1 / -1;
  }

  .academic-footer-bottom {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
