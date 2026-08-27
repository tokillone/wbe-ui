<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  mobile: boolean
  open: boolean
  title: string
}>()

const emit = defineEmits<{
  close: []
}>()

const dialogEl = ref<HTMLElement | null>(null)
let previousActive: HTMLElement | null = null
let previousOverflow = ''

function focusableElements() {
  return [...(dialogEl.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ) ?? [])].filter((element) => !element.hidden)
}

function handleKeydown(event: KeyboardEvent) {
  if (!props.mobile || !props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const items = focusableElements()
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

watch(
  () => [props.mobile, props.open] as const,
  async ([mobile, open]) => {
    if (mobile && open) {
      previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      document.addEventListener('keydown', handleKeydown)
      await nextTick()
      focusableElements()[0]?.focus({ preventScroll: true })
      return
    }
    document.removeEventListener('keydown', handleKeydown)
    document.body.style.overflow = previousOverflow
    if (previousActive?.isConnected) previousActive.focus({ preventScroll: true })
    previousActive = null
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = previousOverflow
})
</script>

<template>
  <div v-if="!mobile" class="sankey-drawer-desktop-slot"><slot /></div>
  <Teleport v-else-if="open" to="body">
    <div class="sankey-mobile-drawer-layer">
      <button class="sankey-mobile-drawer-backdrop" type="button" aria-label="关闭详情" @click="emit('close')"></button>
      <section
        ref="dialogEl"
        class="sankey-mobile-drawer"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header class="sankey-mobile-drawer-header">
          <span class="sankey-mobile-drawer-handle" aria-hidden="true"></span>
          <strong>{{ title }}</strong>
          <button type="button" aria-label="关闭详情" @click="emit('close')">×</button>
        </header>
        <div class="sankey-mobile-drawer-content"><slot /></div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.sankey-drawer-desktop-slot { display: contents; }
</style>

<style>
.sankey-mobile-drawer-layer { position: fixed; inset: 0; z-index: 2800; }
.sankey-mobile-drawer-backdrop { position: absolute; inset: 0; width: 100%; border: 0; background: rgba(19, 35, 47, .42); }
.sankey-mobile-drawer {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  max-height: min(78dvh, 720px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border-radius: 16px 16px 0 0;
  background: #fff;
  box-shadow: 0 -18px 44px rgba(16, 35, 49, .24);
  overflow: hidden;
}
.sankey-mobile-drawer-header {
  position: relative;
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid #e0e7ec;
}
.sankey-mobile-drawer-handle {
  position: absolute;
  top: 6px;
  left: 50%;
  width: 38px;
  height: 4px;
  transform: translateX(-50%);
  border-radius: 99px;
  background: #c8d2da;
}
.sankey-mobile-drawer-header strong { min-width: 0; overflow: hidden; color: #243b4c; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.sankey-mobile-drawer-header button {
  width: 32px; height: 32px; flex: 0 0 auto; border: 1px solid #d5dde4; border-radius: 50%;
  background: #fff; color: #405563; font-size: 22px; line-height: 1; cursor: pointer;
}
.sankey-mobile-drawer-content { min-height: 0; overflow: auto; padding: 0 12px max(16px, env(safe-area-inset-bottom)); }
.sankey-mobile-drawer-content > .side-panel { display: block !important; width: 100% !important; max-height: none !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; box-sizing: border-box !important; }
.sankey-mobile-drawer-content > .side-panel::before { display: none !important; }
</style>
