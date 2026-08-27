<script setup lang="ts">
defineProps<{
  stages: string[]
  activeIndex: number
}>()

const emit = defineEmits<{
  select: [index: number]
}>()
</script>

<template>
  <nav class="sankey-stage-navigator" aria-label="桑基图阶段定位">
    <button
      v-for="(stage, index) in stages"
      :key="stage"
      type="button"
      :class="{ 'is-active': index === activeIndex, 'is-past': index < activeIndex }"
      :aria-current="index === activeIndex ? 'step' : undefined"
      @click="emit('select', index)"
    >
      <span aria-hidden="true"></span>
      <b>{{ stage }}</b>
    </button>
  </nav>
</template>

<style scoped>
.sankey-stage-navigator { display: none; }

@media (max-width: 720px) {
  .sankey-stage-navigator {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0;
    padding: 9px 12px 8px;
    border-bottom: 1px solid #dce4ea;
    background: #fff;
  }
  button {
    position: relative;
    min-width: 0;
    display: grid;
    justify-items: center;
    gap: 4px;
    padding: 0 2px;
    border: 0;
    background: transparent;
    color: #7a8995;
    font: inherit;
    cursor: pointer;
  }
  button::before {
    content: '';
    position: absolute;
    top: 4px;
    left: -50%;
    width: 100%;
    height: 1px;
    background: #d7e0e7;
  }
  button:first-child::before { display: none; }
  button > span {
    position: relative;
    z-index: 1;
    width: 9px;
    height: 9px;
    border: 2px solid #b7c4cf;
    border-radius: 50%;
    background: #fff;
  }
  button b {
    max-width: 100%;
    overflow: hidden;
    font-size: 10px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button.is-past::before,
  button.is-active::before { background: #85a9cc; }
  button.is-past > span { border-color: #789fc5; background: #789fc5; }
  button.is-active { color: #245f8e; }
  button.is-active > span { border-color: #245f8e; background: #245f8e; box-shadow: 0 0 0 3px #e8f0f8; }
  button:focus-visible { outline: 2px solid #2566d4; outline-offset: 3px; border-radius: 4px; }
}
</style>
