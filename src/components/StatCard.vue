<script setup>
defineProps({
  label: String,
  value: String,
  change: String,
  up: Boolean
})
</script>

<template>
  <div class="p-4 rounded-2xl border transition-all hover:border-slate-600" style="background: var(--color-surface); border-color: var(--color-border)">
    <p class="text-xs text-slate-500 uppercase tracking-widest mb-2">{{ label }}</p>
    <p class="text-2xl font-bold text-white">{{ value }}</p>
    <p :class="['text-xs mt-1 font-medium', up ? 'text-emerald-400' : 'text-rose-400']">{{ change }}</p>
  </div>
</template>
