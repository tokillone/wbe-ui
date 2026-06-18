<template>
  <RouterView v-slot="{ Component, route }">
    <Transition name="route-fade" mode="out-in">
      <component :is="Component" :key="route.path" />
    </Transition>
  </RouterView>
</template>

<style>
.route-fade-enter-active {
  transition:
    opacity 0.26s ease,
    transform 0.26s ease;
}

.route-fade-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.route-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.route-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .route-fade-enter-active,
  .route-fade-leave-active {
    transition: none;
  }

  .route-fade-enter-from,
  .route-fade-leave-to {
    transform: none;
  }
}
</style>
