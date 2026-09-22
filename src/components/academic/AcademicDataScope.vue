<script setup lang="ts">
interface ScopeMetric {
  key: string
  label: string
  value: string
  unit: string
  detail: string
  trend: string
}

withDefaults(defineProps<{ metrics: ScopeMetric[]; compact?: boolean }>(), {
  compact: false,
})
</script>

<template>
  <section
    id="data-scope"
    class="academic-data-scope"
    :class="{ 'is-compact': compact }"
    aria-labelledby="dataScopeTitle"
  >
    <div class="academic-data-scope-inner">
      <header class="academic-data-scope-heading">
        <div>
          <p>{{ compact ? 'DATABASE OVERVIEW' : '02 / DATA SCOPE' }}</p>
          <h2 id="dataScopeTitle">当前数据范围</h2>
        </div>
        <span>首页指标来自当前数据库统计，用于说明文献、空间、分类与标记物的覆盖范围。</span>
      </header>

      <div class="academic-data-scope-grid" aria-label="当前数据库覆盖指标">
        <article v-for="metric in metrics" :key="metric.key" class="academic-scope-metric">
          <template v-if="compact">
            <h3>{{ metric.label }}</h3>
            <p class="academic-scope-status">
              <i aria-hidden="true"></i>
              <strong>{{ metric.trend }}</strong>
            </p>
          </template>
          <template v-else>
            <p>
              <strong>{{ metric.value }}</strong>
              <em v-if="metric.unit">{{ metric.unit }}</em>
            </p>
            <h3>{{ metric.label }}</h3>
            <span>{{ metric.detail }}</span>
          </template>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.academic-data-scope {
  position: relative;
  z-index: 1;
  color: #0b2740;
  background: #fff;
  scroll-margin-top: 92px;
}

.academic-data-scope-inner {
  width: min(calc(100% - 48px), 1200px);
  margin: 0 auto;
  padding: 78px 0 84px;
}

.academic-data-scope-heading {
  display: grid;
  grid-template-columns: minmax(320px, 0.9fr) minmax(300px, 0.72fr);
  align-items: end;
  justify-content: space-between;
  gap: 64px;
  margin-bottom: 38px;
}

.academic-data-scope-heading p {
  margin: 0 0 15px;
  color: #0d66b3;
  font-size: 12px;
  font-weight: 760;
  letter-spacing: 0.16em;
}

.academic-data-scope-heading h2 {
  margin: 0;
  color: #0b2740;
  font-size: clamp(36px, 3.2vw, 46px);
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 1.16;
}

.academic-data-scope-heading > span {
  color: #4c667a;
  font-size: 14px;
  line-height: 1.75;
  text-wrap: pretty;
}

.academic-data-scope-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-top: 1px solid #b9cfdd;
  border-bottom: 1px solid #d5e2eb;
}

.academic-scope-metric {
  min-width: 0;
  padding: 29px clamp(18px, 2.4vw, 32px) 31px;
  border-left: 1px solid #d5e2eb;
}

.academic-scope-metric:first-child {
  padding-left: 0;
  border-left: 0;
}

.academic-scope-metric:last-child {
  padding-right: 0;
}

.academic-scope-metric p {
  min-height: 48px;
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin: 0 0 13px;
  color: #07589d;
  font-variant-numeric: tabular-nums;
}

.academic-scope-metric strong {
  font-size: clamp(32px, 3vw, 42px);
  font-weight: 720;
  letter-spacing: -0.045em;
  line-height: 1;
}

.academic-scope-metric em {
  color: #557084;
  font-size: 13px;
  font-style: normal;
  font-weight: 650;
}

.academic-scope-metric h3 {
  margin: 0;
  color: #17364d;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.35;
}

.academic-scope-metric > span {
  display: block;
  margin-top: 8px;
  color: #637a8c;
  font-size: 12px;
  line-height: 1.65;
}

@media (max-width: 920px) {
  .academic-data-scope-heading {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .academic-data-scope-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .academic-scope-metric:nth-child(3) {
    padding-left: 0;
    border-left: 0;
    border-top: 1px solid #d5e2eb;
  }

  .academic-scope-metric:nth-child(4) {
    border-top: 1px solid #d5e2eb;
  }
}

@media (max-width: 620px) {
  .academic-data-scope-inner {
    width: min(calc(100% - 36px), 1200px);
    padding: 58px 0 62px;
  }

  .academic-data-scope-heading {
    margin-bottom: 28px;
  }

  .academic-data-scope-heading h2 {
    font-size: 32px;
  }

  .academic-data-scope-grid {
    grid-template-columns: 1fr;
  }

  .academic-scope-metric,
  .academic-scope-metric:first-child,
  .academic-scope-metric:last-child {
    padding: 22px 0;
    border-top: 1px solid #d5e2eb;
    border-left: 0;
  }

  .academic-scope-metric:first-child {
    border-top: 0;
  }
}
</style>

<style scoped>
.academic-data-scope.is-compact {
  border: 0;
  background: transparent;
}

.academic-data-scope.is-compact .academic-data-scope-inner {
  width: 100%;
  padding: 7px 0 7px clamp(28px, 3vw, 42px);
  border-left: 1px solid #b9cfdd;
}

.academic-data-scope.is-compact .academic-data-scope-heading {
  display: grid;
  grid-template-columns: 1fr;
  align-items: start;
  gap: 7px;
  margin-bottom: 22px;
}

.academic-data-scope.is-compact .academic-data-scope-heading p {
  margin: 0;
  font-size: 9px;
  letter-spacing: 0.13em;
}

.academic-data-scope.is-compact .academic-data-scope-heading h2 {
  font-size: 23px;
  letter-spacing: -0.025em;
}

.academic-data-scope.is-compact .academic-data-scope-heading > span {
  display: none;
}

.academic-data-scope.is-compact .academic-data-scope-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid #b9cfdd;
  border-bottom: 1px solid #d5e2eb;
  border-color: #bdd3e2;
}

.academic-data-scope.is-compact .academic-scope-metric,
.academic-data-scope.is-compact .academic-scope-metric:first-child,
.academic-data-scope.is-compact .academic-scope-metric:last-child {
  min-height: 88px;
  padding: 17px 18px 16px;
  border-top: 0;
  border-left: 1px solid #d0e0ea;
}

.academic-data-scope.is-compact .academic-scope-metric:nth-child(odd) {
  padding-left: 0;
  border-left: 0;
}

.academic-data-scope.is-compact .academic-scope-metric:nth-child(n + 3) {
  border-top: 1px solid #d0e0ea;
}

.academic-data-scope.is-compact .academic-scope-metric h3 {
  margin-bottom: 11px;
  color: #28485f;
  font-size: 12px;
  font-weight: 680;
  letter-spacing: 0.015em;
}

.academic-data-scope.is-compact .academic-scope-metric > span {
  display: none;
}

.academic-data-scope.is-compact .academic-scope-status {
  min-height: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: #07589d;
  font-variant-numeric: normal;
}

.academic-data-scope.is-compact .academic-scope-status i {
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #3c8bc5;
  box-shadow: 0 0 0 4px rgba(60, 139, 197, 0.1);
}

.academic-data-scope.is-compact .academic-scope-status strong {
  color: #07589d;
  font-size: clamp(14px, 1.15vw, 16px);
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.3;
}

@media (max-width: 1040px) and (min-width: 621px) {
  .academic-data-scope.is-compact .academic-data-scope-inner {
    padding: 27px 0 0;
    border-top: 1px solid #b9cfdd;
    border-left: 0;
  }

  .academic-data-scope.is-compact .academic-data-scope-heading {
    margin-bottom: 17px;
  }

  .academic-data-scope.is-compact .academic-data-scope-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .academic-data-scope.is-compact .academic-scope-metric,
  .academic-data-scope.is-compact .academic-scope-metric:first-child,
  .academic-data-scope.is-compact .academic-scope-metric:last-child,
  .academic-data-scope.is-compact .academic-scope-metric:nth-child(n + 3) {
    min-height: 88px;
    padding: 15px 18px;
    border-top: 0;
    border-left: 1px solid #d0e0ea;
  }

  .academic-data-scope.is-compact .academic-scope-metric:first-child {
    padding-left: 0;
    border-left: 0;
  }
}

@media (max-width: 620px) {
  .academic-data-scope.is-compact .academic-data-scope-inner {
    padding: 24px 0 0;
    border-top: 1px solid #b9cfdd;
    border-left: 0;
  }

  .academic-data-scope.is-compact .academic-data-scope-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .academic-data-scope.is-compact .academic-scope-metric,
  .academic-data-scope.is-compact .academic-scope-metric:first-child,
  .academic-data-scope.is-compact .academic-scope-metric:last-child {
    min-height: 84px;
    padding: 15px 12px;
    border-left: 1px solid #d0e0ea;
  }

  .academic-data-scope.is-compact .academic-scope-metric:nth-child(odd) {
    padding-left: 0;
    border-left: 0;
  }
}
</style>
