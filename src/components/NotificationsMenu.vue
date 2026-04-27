<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, Check, Trash2, CheckCircle2, Inbox, X } from 'lucide-vue-next'
import { notificationsService } from '../services/api'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()

const open = ref(false)
const loading = ref(false)
const items = ref([])
const rootEl = ref(null)
const panelEl = ref(null)

const unread = computed(() => items.value.filter(n => !n.read).length)

// Track IDs we've already shown a desktop notification for, to avoid spamming
// on every poll. Persisted in sessionStorage so a refresh doesn't re-fire.
const SEEN_KEY = 'sushmi_notif_seen_ids'
function loadSeen() {
  try { return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]')) }
  catch { return new Set() }
}
function saveSeen(set) {
  sessionStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-100)))
}
const seenIds = loadSeen()

function maybeRequestPermission() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    // Wait a beat after first load so we don't blast the prompt on first paint.
    setTimeout(() => {
      try { Notification.requestPermission() } catch { /* ignore */ }
    }, 1500)
  }
}

function showDesktopNotification(n) {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible' && open.value) return // they can see it already
  try {
    const browserNotif = new Notification(n.title || 'Sushmi MCP', {
      body: n.body || '',
      tag: n.id,
      icon: '/favicon.ico',
      silent: false,
    })
    browserNotif.onclick = () => {
      window.focus()
      if (n.link) router.push(n.link)
      browserNotif.close()
    }
  } catch { /* ignore */ }
}

async function load() {
  if (!auth.isAuthenticated) return
  loading.value = true
  try {
    const data = await notificationsService.list()
    const fresh = data.items || []
    // Fire desktop notification for any unseen unread item
    for (const n of fresh) {
      if (!n.read && !seenIds.has(n.id)) {
        seenIds.add(n.id)
        showDesktopNotification(n)
      }
    }
    saveSeen(seenIds)
    items.value = fresh
  } catch { /* ignore */ }
  finally { loading.value = false }
}

let pollTimer = null
function startPolling() {
  stopPolling()
  pollTimer = setInterval(load, 20000)
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

onMounted(() => {
  maybeRequestPermission()
  load()
  startPolling()
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => {
  stopPolling()
  document.removeEventListener('click', onDocClick)
})

watch(() => auth.isAuthenticated, (v) => {
  if (v) { load(); startPolling() } else { stopPolling(); items.value = [] }
})

function onDocClick(e) {
  if (!open.value) return
  const insideTrigger = rootEl.value && rootEl.value.contains(e.target)
  const insidePanel = panelEl.value && panelEl.value.contains(e.target)
  if (!insideTrigger && !insidePanel) open.value = false
}

async function toggle() {
  open.value = !open.value
  if (open.value) await load()
}

async function clickNotification(n) {
  if (!n.read) {
    n.read = true
    try { await notificationsService.markRead(n.id) } catch { /* ignore */ }
  }
  if (n.link) {
    open.value = false
    router.push(n.link)
  }
}

async function markAll() {
  items.value.forEach(n => n.read = true)
  try { await notificationsService.markAllRead() } catch { /* ignore */ }
}

async function dismiss(id, ev) {
  ev?.stopPropagation()
  items.value = items.value.filter(n => n.id !== id)
  try { await notificationsService.remove(id) } catch { /* ignore */ }
}

async function clearAll() {
  items.value = []
  try { await notificationsService.clear() } catch { /* ignore */ }
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h'
  const d = Math.floor(h / 24)
  return d + 'd'
}

const kindConfig = {
  success: { dot: 'bg-emerald-400', ring: 'border-emerald-500/30' },
  info:    { dot: 'bg-violet-400',  ring: 'border-violet-500/30'  },
  warning: { dot: 'bg-amber-400',   ring: 'border-amber-500/30'   },
  error:   { dot: 'bg-rose-400',    ring: 'border-rose-500/30'    },
}
function cfg(k) { return kindConfig[k] || kindConfig.info }
</script>

<template>
  <div ref="rootEl" class="relative">
    <button
      @click="toggle"
      class="relative w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/5 transition-all"
      :aria-label="`${unread} unread notifications`"
    >
      <Bell :size="16" />
      <span v-if="unread > 0" class="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-rose-500 text-[9px] font-bold text-white flex items-center justify-center">
        {{ unread > 9 ? '9+' : unread }}
      </span>
    </button>

    <Teleport to="body">
    <transition name="fade">
      <div v-if="open"
        ref="panelEl"
        class="fixed right-6 top-16 w-[360px] max-h-[480px] flex flex-col rounded-2xl border shadow-2xl"
        style="background: var(--color-surface); border-color: var(--color-border); z-index: 2147483000"
      >
        <div class="flex items-center justify-between px-4 py-3 border-b" style="border-color: var(--color-border)">
          <div class="flex items-center gap-2">
            <Bell :size="14" class="text-violet-400" />
            <h3 class="text-sm font-bold text-white">Notifications</h3>
            <span v-if="unread > 0" class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30">{{ unread }}</span>
          </div>
          <div class="flex items-center gap-1">
            <button v-if="unread > 0" @click="markAll" title="Mark all read" class="p-1.5 rounded-lg text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10">
              <CheckCircle2 :size="14" />
            </button>
            <button v-if="items.length > 0" @click="clearAll" title="Clear all" class="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto">
          <div v-if="loading && items.length === 0" class="p-6 text-center text-xs text-slate-500">Loading…</div>
          <div v-else-if="items.length === 0" class="p-8 flex flex-col items-center text-slate-500">
            <Inbox :size="28" class="mb-2 text-slate-700" />
            <p class="text-xs">You're all caught up.</p>
          </div>
          <ul v-else class="divide-y" style="border-color: var(--color-border)">
            <li
              v-for="n in items"
              :key="n.id"
              @click="clickNotification(n)"
              :class="['group px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-white/5 transition-colors',
                !n.read ? 'bg-violet-500/5' : '']"
            >
              <div :class="['w-2 h-2 rounded-full mt-1.5 shrink-0', cfg(n.kind).dot, n.read ? 'opacity-40' : '']"></div>
              <div class="flex-1 min-w-0">
                <div class="flex items-start justify-between gap-2">
                  <p :class="['text-sm truncate', n.read ? 'text-slate-400' : 'text-white font-semibold']">{{ n.title }}</p>
                  <span class="text-[10px] text-slate-500 shrink-0 pt-0.5">{{ timeAgo(n.createdAt) }}</span>
                </div>
                <p class="text-xs text-slate-500 mt-0.5 line-clamp-2">{{ n.body }}</p>
              </div>
              <button @click="dismiss(n.id, $event)" class="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 transition-opacity">
                <X :size="12" />
              </button>
            </li>
          </ul>
        </div>

        <div class="px-4 py-2 border-t text-center" style="border-color: var(--color-border)">
          <button @click="open = false; router.push('/settings')" class="text-[11px] font-semibold text-violet-400 hover:underline flex items-center gap-1 mx-auto">
            <Check :size="11" /> Manage notification preferences
          </button>
        </div>
      </div>
    </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity .15s ease, transform .15s ease; }
.fade-enter-from, .fade-leave-to       { opacity: 0; transform: translateY(-4px); }
</style>
