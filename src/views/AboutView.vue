<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import PlatformHeader from '../components/PlatformHeader.vue'
import AcademicFooter from '../components/academic/AcademicFooter.vue'
import { HOME_OVERVIEW_API_ENABLED } from '../config/api'
import { PLATFORM_OVERVIEW_METRICS, type PlatformOverviewMetric } from '../data/platformOverview'
import { fetchHomeOverview } from '../services/home'

const metrics = ref<PlatformOverviewMetric[]>(PLATFORM_OVERVIEW_METRICS)
const metricStatus = ref<'baseline' | 'loading' | 'live' | 'error'>('baseline')

const metricStatusText = computed(() => {
  if (metricStatus.value === 'loading') return '正在同步首页统计'
  if (metricStatus.value === 'live') return '已同步首页实时统计'
  if (metricStatus.value === 'error') return '实时统计暂不可用，显示平台基准数据'
  return '与首页使用同一统计口径'
})

onMounted(async () => {
  if (!HOME_OVERVIEW_API_ENABLED) return
  metricStatus.value = 'loading'
  try {
    const result = await fetchHomeOverview<{ metrics?: PlatformOverviewMetric[] }>()
    if (result.metrics?.length) metrics.value = result.metrics
    metricStatus.value = 'live'
  } catch {
    metricStatus.value = 'error'
  }
})

const evidenceFlow = ['文献汇集', '术语标准化', '去重与关联', '方法核验', '可视化分析']
</script>

<template>
  <main class="about-page">
    <PlatformHeader variant="academic" />

    <section id="main-content" class="about-hero" tabindex="-1">
      <p>关于数据库</p>
      <h1>把分散的污水研究记录，组织成可追踪、可比较的证据网络</h1>
      <span>
        平台服务于污水流行病学研究与公共健康分析，连接目标物质、空间、疾病、标记物和来源文献信息。
      </span>
    </section>

    <section class="about-metrics" aria-labelledby="coverageTitle">
      <header>
        <h2 id="coverageTitle">当前数据覆盖</h2>
        <p aria-live="polite">{{ metricStatusText }}</p>
      </header>
      <div>
        <article v-for="metric in metrics" :key="metric.key">
          <span>{{ metric.label }}</span>
          <strong
            >{{ metric.value }}<small>{{ metric.unit }}</small></strong
          >
          <p>{{ metric.detail }}</p>
        </article>
      </div>
    </section>

    <section class="about-positioning" aria-labelledby="positioningTitle">
      <div>
        <h2 id="positioningTitle">数据库解决什么问题</h2>
        <p>
          污水流行病学证据通常分散在不同文献、地域层级和方法描述中。平台通过统一术语与关系索引，让研究者能够从一个问题进入，并回到可核验的来源记录。
        </p>
      </div>
      <dl>
        <div>
          <dt>科研人员</dt>
          <dd>检索研究覆盖、比较标记物证据、追踪疾病关联和方法差异。</dd>
        </div>
        <div>
          <dt>疾控人员</dt>
          <dd>理解空间信号和人群归一化负荷的证据来源与适用边界。</dd>
        </div>
        <div>
          <dt>数据维护人员</dt>
          <dd>依据字段规范完成数据校验、版本记录和持续更新。</dd>
        </div>
      </dl>
    </section>

    <section class="about-flow" aria-labelledby="flowTitle">
      <h2 id="flowTitle">证据如何进入分析</h2>
      <ol>
        <li v-for="(step, index) in evidenceFlow" :key="step">
          <span>{{ String(index + 1).padStart(2, '0') }}</span>
          <strong>{{ step }}</strong>
        </li>
      </ol>
    </section>

    <section id="principles" class="about-principles" aria-labelledby="principlesTitle">
      <div>
        <h2 id="principlesTitle">维护原则与适用边界</h2>
        <p>平台提供证据组织和分析入口，不替代原始研究判断、实验室质量控制或公共卫生决策程序。</p>
      </div>
      <div class="about-principle-grid">
        <article>
          <strong>来源可追踪</strong>
          <p>关键统计与关系应能够回到文献、记录或方法字段。</p>
        </article>
        <article>
          <strong>口径先说明</strong>
          <p>文献数、数据行和文献与方法组合分别标注，避免混用。</p>
        </article>
        <article>
          <strong>版本可复核</strong>
          <p>字段版本、数据修订和方法更新持续保留记录。</p>
        </article>
        <article>
          <strong>结论有边界</strong>
          <p>数据覆盖不等同于风险水平，研究频次也不等同于因果强度。</p>
        </article>
      </div>
    </section>

    <section class="about-scope-note" aria-labelledby="scopeNoteTitle">
      <div>
        <h2 id="scopeNoteTitle">研究覆盖与药物属性</h2>
        <p>
          首页词频按因子关联的 DOI 去重文献数计算。桑基图药物构成按路径权重汇总，处方比例按完整范围的去重药物数计算；属性冲突与未知单独展示。
        </p>
      </div>
      <RouterLink to="/icd11-sankey#reading-guide">查看图表说明</RouterLink>
    </section>

    <AcademicFooter />
  </main>
</template>

<style scoped>
:global(body) {
  margin: 0;
  color: #0b1f33;
  background: #ffffff;
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
}

.about-page {
  min-height: 100dvh;
  color: #0b1f33;
  background: #ffffff;
}

.about-hero,
.about-metrics,
.about-positioning,
.about-flow,
.about-principles,
.about-scope-note {
  max-width: 1340px;
  margin: 0 auto;
  padding-inline: clamp(22px, 4.5vw, 68px);
}

.about-hero {
  min-height: min(510px, calc(100dvh - 70px));
  display: grid;
  align-content: center;
  padding-top: 48px;
  padding-bottom: 60px;
}

.about-hero > p {
  margin: 0 0 16px;
  color: #1263a8;
  font-size: 13px;
  font-weight: 700;
}

.about-hero h1 {
  max-width: 15em;
  margin: 0;
  font-size: clamp(38px, 4.6vw, 60px);
  font-weight: 680;
  letter-spacing: -0.05em;
  line-height: 1.1;
  text-wrap: balance;
}

.about-hero > span {
  max-width: 46em;
  margin-top: 30px;
  color: #56697a;
  font-size: 17px;
  line-height: 1.72;
}

.about-metrics,
.about-positioning,
.about-flow,
.about-principles,
.about-scope-note {
  border-top: 1px solid #d7e0e6;
}

.about-metrics {
  padding-top: 70px;
  padding-bottom: 100px;
}

.about-metrics header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 20px;
}

.about-metrics h2,
.about-positioning h2,
.about-flow h2,
.about-principles h2,
.about-scope-note h2 {
  margin: 0;
  font-size: clamp(30px, 3.8vw, 52px);
  letter-spacing: -0.05em;
}

.about-metrics header p {
  color: #627887;
  font-size: 13px;
}

.about-metrics > div {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 42px;
  border-top: 1px solid #d7e0e6;
  border-bottom: 1px solid #d7e0e6;
}

.about-metrics article {
  min-height: 176px;
  padding: 24px;
  border-right: 1px solid #d7e0e6;
}

.about-metrics article:last-child {
  border-right: 0;
}

.about-metrics article > span,
.about-metrics article p {
  color: #56697a;
  font-size: 12px;
}

.about-metrics article strong {
  display: block;
  margin-top: 14px;
  font-size: clamp(30px, 3vw, 44px);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.04em;
}

.about-metrics article strong small {
  margin-left: 3px;
  font-size: 14px;
}

.about-metrics article p {
  margin: 12px 0 0;
  line-height: 1.55;
}

.about-positioning,
.about-principles,
.about-scope-note {
  display: grid;
  grid-template-columns: minmax(300px, 0.78fr) minmax(0, 1.22fr);
  gap: clamp(48px, 8vw, 110px);
  padding-top: 100px;
  padding-bottom: 110px;
}

.about-positioning > div p,
.about-principles > div > p,
.about-scope-note p {
  max-width: 44em;
  color: #56697a;
  line-height: 1.8;
}

.about-positioning dl {
  margin: 0;
}

.about-positioning dl div {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 22px;
  padding: 22px 0;
  border-bottom: 1px solid #d7e0e6;
}

.about-positioning dt {
  font-weight: 760;
}

.about-positioning dd {
  margin: 0;
  color: #56697a;
  line-height: 1.7;
}

.about-flow {
  padding-top: 100px;
  padding-bottom: 120px;
}

.about-flow ol {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin: 50px 0 0;
  padding: 0;
  list-style: none;
}

.about-flow li {
  position: relative;
  min-height: 160px;
  display: grid;
  align-content: space-between;
  padding: 20px;
  border-top: 1px solid #1263a8;
  border-right: 1px solid #d7e0e6;
}

.about-flow li:last-child {
  border-right: 0;
}

.about-flow li span {
  color: #5e7785;
  font-size: 12px;
}

.about-flow li strong {
  font-size: 18px;
}

.about-principle-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 34px;
}

.about-principle-grid article {
  padding-top: 16px;
  border-top: 1px solid #d7e0e6;
}

.about-principle-grid article strong {
  font-size: 17px;
}

.about-principle-grid article p {
  margin: 9px 0 0;
  color: #56697a;
  line-height: 1.7;
}

.about-scope-note {
  align-items: start;
  padding-bottom: 140px;
}

.about-scope-note a {
  min-height: 48px;
  width: max-content;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0 21px;
  border: 1px solid #1263a8;
  border-radius: 9px;
  color: #f9fbfd;
  background: #1263a8;
  font-weight: 760;
  text-decoration: none;
}

.about-scope-note a:hover,
.about-scope-note a:focus-visible {
  background: #10558f;
  outline: 3px solid rgba(23, 104, 176, 0.2);
  outline-offset: 3px;
}

@media (max-width: 850px) {
  .about-metrics > div {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .about-metrics article:nth-child(2) {
    border-right: 0;
  }

  .about-metrics article:nth-child(-n + 2) {
    border-bottom: 1px solid #d7e0e6;
  }

  .about-positioning,
  .about-principles,
  .about-scope-note {
    grid-template-columns: 1fr;
    gap: 36px;
  }

  .about-flow ol {
    grid-template-columns: 1fr;
  }

  .about-flow li {
    min-height: 92px;
    grid-template-columns: 48px 1fr;
    align-items: center;
    align-content: center;
    border-right: 0;
    border-bottom: 1px solid #d7e0e6;
  }
}

@media (max-width: 560px) {
  .about-hero {
    min-height: auto;
  }

  .about-hero h1 {
    font-size: clamp(36px, 10vw, 42px);
  }

  .about-metrics header {
    align-items: flex-start;
    flex-direction: column;
  }

  .about-principle-grid {
    grid-template-columns: 1fr;
  }
}
</style>
