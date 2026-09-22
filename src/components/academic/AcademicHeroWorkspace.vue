<script setup lang="ts">
const emit = defineEmits<{
  start: []
  browse: []
}>()
</script>

<template>
  <section
    id="main-content"
    class="academic-hero"
    aria-labelledby="academicHeroTitle"
    tabindex="-1"
  >
    <div class="academic-hero-main" :class="{ 'has-scope': $slots.default }">
      <div class="academic-hero-copy">
        <p class="academic-hero-kicker">WASTEWATER-BASED EPIDEMIOLOGY</p>
        <h1 id="academicHeroTitle">让污水流行病学证据可检索、可比较、可追溯</h1>
        <p class="academic-hero-lead">
          统一组织文献、空间、疾病与标记物信息，为研究检索、结果比较与证据核对提供清晰入口。
        </p>
        <div class="academic-hero-actions">
          <button type="button" class="academic-primary-action" @click="emit('start')">
            开始分析
          </button>
          <button type="button" class="academic-secondary-action" @click="emit('browse')">
            <span>查看高频因子</span>
            <i aria-hidden="true">→</i>
          </button>
        </div>
      </div>
      <div v-if="$slots.default" class="academic-hero-scope">
        <slot />
      </div>
    </div>
  </section>
</template>

<style scoped>
.academic-hero {
  --hero-ink: #08243e;
  --hero-blue: #0b5f9d;
  min-height: 570px;
  display: flex;
  align-items: center;
  overflow: hidden;
  color: var(--hero-ink);
  background: #fff;
}

.academic-hero-main {
  width: min(calc(100% - 48px), 1200px);
  display: grid;
  grid-template-columns: 1fr;
  align-items: center;
  margin: 0 auto;
  padding: 76px 0 72px;
}

.academic-hero-main.has-scope {
  grid-template-columns: minmax(0, 1.17fr) minmax(400px, 0.83fr);
  gap: clamp(48px, 5vw, 72px);
}

.academic-hero-copy {
  min-width: 0;
  width: min(100%, 980px);
  margin: 0 auto;
  text-align: center;
  animation: academic-copy-in 0.56s 0.04s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.academic-hero-main.has-scope .academic-hero-copy {
  width: 100%;
  margin: 0;
  text-align: left;
}

.academic-hero-scope {
  min-width: 0;
  align-self: center;
  animation: academic-scope-in 0.62s 0.12s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.academic-hero-kicker {
  margin: 0 0 20px;
  color: var(--hero-blue);
  font-size: 12px;
  font-weight: 760;
  letter-spacing: 0.16em;
}

.academic-hero h1 {
  max-width: 12em;
  margin: 0 auto;
  color: var(--hero-ink);
  font-size: clamp(46px, 4.35vw, 62px);
  font-weight: 700;
  letter-spacing: -0.052em;
  line-height: 1.12;
  text-wrap: balance;
}

.academic-hero-main.has-scope h1 {
  margin-inline: 0;
}

.academic-hero-lead {
  max-width: 43em;
  margin: 24px auto 0;
  color: #4c667a;
  font-size: clamp(17px, 1.25vw, 19px);
  line-height: 1.75;
  text-wrap: pretty;
}

.academic-hero-main.has-scope .academic-hero-lead {
  margin-inline: 0;
}

.academic-hero-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
  margin-top: 34px;
}

.academic-hero-main.has-scope .academic-hero-actions {
  justify-content: flex-start;
}

.academic-primary-action,
.academic-secondary-action {
  min-height: 50px;
  border-radius: 4px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}

.academic-primary-action {
  padding: 0 28px;
  border: 1px solid var(--hero-blue);
  color: #fff;
  background: var(--hero-blue);
  transition:
    transform 160ms ease,
    background-color 160ms ease,
    box-shadow 160ms ease;
}

.academic-primary-action:hover,
.academic-primary-action:focus-visible {
  background: #084e82;
  box-shadow: 0 9px 24px rgba(11, 95, 157, 0.17);
  outline: 3px solid rgba(11, 95, 157, 0.13);
  outline-offset: 3px;
}

.academic-primary-action:active {
  transform: translateY(1px);
}

.academic-secondary-action {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0 2px;
  border: 0;
  color: #084f8d;
  background: transparent;
}

.academic-secondary-action::after {
  position: absolute;
  right: 0;
  bottom: 7px;
  left: 0;
  height: 1px;
  content: '';
  background: currentColor;
  opacity: 0.28;
  transform: scaleX(0.72);
  transform-origin: left;
  transition:
    transform 180ms ease,
    opacity 180ms ease;
}

.academic-secondary-action i {
  font-size: 18px;
  font-style: normal;
  font-weight: 500;
  transition: transform 180ms ease;
}

.academic-secondary-action:hover::after,
.academic-secondary-action:focus-visible::after {
  opacity: 0.72;
  transform: scaleX(1);
}

.academic-secondary-action:hover i,
.academic-secondary-action:focus-visible i {
  transform: translateX(4px);
}

.academic-secondary-action:focus-visible {
  outline: 2px solid rgba(11, 95, 157, 0.28);
  outline-offset: 5px;
}

@keyframes academic-copy-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}

@keyframes academic-scope-in {
  from {
    opacity: 0;
    transform: translateX(18px);
  }
}

@media (max-width: 1040px) {
  .academic-hero {
    min-height: auto;
  }

  .academic-hero-main {
    grid-template-columns: 1fr;
    gap: 46px;
    padding: 72px 0 68px;
  }

  .academic-hero-copy {
    max-width: 860px;
  }

  .academic-hero-main.has-scope {
    grid-template-columns: 1fr;
  }

  .academic-hero-scope {
    width: 100%;
  }
}

@media (max-width: 820px) {
  .academic-hero {
    min-height: 470px;
  }

  .academic-hero-main {
    padding: 68px 0 64px;
  }

  .academic-hero h1 {
    max-width: 15em;
    font-size: clamp(43px, 7vw, 58px);
  }
}

@media (max-width: 520px) {
  .academic-hero {
    min-height: 480px;
  }

  .academic-hero-main {
    width: min(calc(100% - 36px), 1200px);
    padding: 66px 0 62px;
  }

  .academic-hero h1 {
    max-width: 9.4em;
    font-size: clamp(38px, 10.8vw, 47px);
    line-height: 1.13;
  }

  .academic-hero-lead {
    font-size: 16px;
    line-height: 1.7;
  }

  .academic-hero-actions {
    align-items: center;
    flex-direction: column;
    gap: 13px;
    margin-top: 30px;
  }

  .academic-hero-main.has-scope .academic-hero-actions {
    align-items: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .academic-hero-copy,
  .academic-hero-scope {
    animation: none;
  }

  .academic-primary-action,
  .academic-secondary-action::after,
  .academic-secondary-action i {
    transition: none;
  }
}
</style>
