<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import {
  TrendingUp, AlertTriangle, CheckCircle2,
  Mail, FolderOpen, Receipt, ArrowRight, Zap
} from 'lucide-vue-next'
import { dashboardService, alertService } from '../services/api'
import { useAuthStore } from '../stores/auth'
import { formatMoney } from '../services/format'

const router = useRouter()
const auth = useAuthStore()
const firstName = computed(() => {
  const n = auth.user?.name || auth.user?.email || ''
  return n.split(/[@ ]/)[0] || 'there'
})

const alerts = ref([])
const stats = ref([])
const loading = ref(true)
const toast = ref('')

const agents = [
  { name: 'Inbox Triage',     status: 'Active',     icon: Mail,        gradient: 'from-violet-500 to-purple-700',  glow: 'rgba(124,58,237,0.3)',  path: '/inbox' },
  { name: 'Project Monitor',  status: 'Analyzing',  icon: FolderOpen,  gradient: 'from-cyan-500 to-blue-700',     glow: 'rgba(6,182,212,0.3)',   path: '/projects' },
  { name: 'Billing Engine',   status: 'Monitoring', icon: Receipt,     gradient: 'from-emerald-500 to-teal-700',  glow: 'rgba(16,185,129,0.3)',  path: '/billing' },
]

async function load() {
  loading.value = true
  try {
    const data = await dashboardService.getDashboard()
    alerts.value = data.alerts || []
    stats.value = data.stats || []
  } catch (err) {
    console.error('Failed to fetch dashboard data', err)
    stats.value = []
    alerts.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function dismissAlert(id) {
  alerts.value = alerts.value.filter(a => a.id !== id)
  try { await alertService.dismiss(id) } catch { /* ignore */ }
}

function flashToast(msg) {
  toast.value = msg
  setTimeout(() => { toast.value = '' }, 2200)
}

function handleAlertAction(alert) {
  const txt = (alert.action || '').toLowerCase()
  if (txt.includes('project'))   router.push('/projects')
  else if (txt.includes('pr') || txt.includes('review'))  flashToast('Opened PR review thread')
  else if (txt.includes('invoice') || txt.includes('reminder')) router.push('/billing')
  else if (txt.includes('digest')) flashToast('Weekly digest preview drafted')
  else router.push('/inbox')
}

const severityConfig = {
  high:   { cls: 'border-rose-500/30 bg-rose-500/5',   dot: 'bg-rose-400',   text: 'text-rose-400'  },
  medium: { cls: 'border-amber-500/30 bg-amber-500/5', dot: 'bg-amber-400',  text: 'text-amber-400' },
  low:    { cls: 'border-slate-700 bg-slate-800/40',   dot: 'bg-slate-500',  text: 'text-slate-400' },
}

function quickAction(kind) {
  if (kind === 'invoice') { router.push('/billing'); return }
  if (kind === 'email')   { router.push('/inbox'); return }
  if (kind === 'risk')    { router.push('/projects'); return }
  if (kind === 'summary') { flashToast('No data yet — add projects and invoices to generate a summary'); return }
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-6 animate-fadeIn">

    <!-- Toast -->
    <transition name="fade">
      <div v-if="toast" class="fixed top-20 right-6 z-50 px-4 py-2.5 rounded-xl border border-violet-500/30 bg-slate-900/90 backdrop-blur text-sm text-violet-200 shadow-lg shadow-violet-500/20">
        {{ toast }}
      </div>
    </transition>

    <!-- Greeting -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold text-white">Welcome, <span class="gradient-text">{{ firstName }}</span></h2>
        <p class="text-sm text-slate-400 mt-1">Your workflow intelligence is active and monitoring.</p>
      </div>
    </div>

    <!-- Stats bar -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div v-for="stat in stats" :key="stat.label" class="p-4 rounded-2xl border transition-all hover:border-slate-600" style="background: var(--color-surface); border-color: var(--color-border)">
        <p class="text-xs text-slate-500 uppercase tracking-widest mb-2">{{ stat.label }}</p>
        <p class="text-2xl font-bold text-white">{{ stat.kind === 'currency' ? formatMoney(stat.amount) : stat.value }}</p>
        <p :class="['text-xs mt-1 font-medium', stat.up ? 'text-emerald-400' : 'text-rose-400']">{{ stat.change }}</p>
      </div>
    </div>

    <!-- Agent cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <RouterLink
        v-for="agent in agents"
        :key="agent.name"
        :to="agent.path"
        class="group block p-5 rounded-2xl border transition-all duration-300 hover:scale-[1.02] hover:-translate-y-0.5"
        style="background: var(--color-surface); border-color: var(--color-border);"
      >
        <div class="flex items-center justify-between mb-4">
          <div :class="['w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center transition-all group-hover:scale-110', agent.gradient]"
               :style="{ boxShadow: '0 4px 15px ' + agent.glow }">
            <component :is="agent.icon" :size="18" class="text-white" />
          </div>
          <span class="text-[10px] font-bold px-2 py-1 rounded-full tracking-wider uppercase" style="background: rgba(255,255,255,0.06); color: #94a3b8">
            {{ agent.status }}
          </span>
        </div>
        <h3 class="font-semibold text-white text-sm mb-1">{{ agent.name }}</h3>
        <p class="text-xs text-slate-500">MCP-powered agent</p>
        <div class="flex items-center gap-1 mt-3 text-xs text-violet-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
          Open <ArrowRight :size="11" />
        </div>
      </RouterLink>
    </div>

    <!-- Main grid -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">

      <!-- Priority Alerts -->
      <div class="lg:col-span-2 rounded-2xl border p-6 space-y-3" style="background: var(--color-surface); border-color: var(--color-border)">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-bold text-white flex items-center gap-2">
            <AlertTriangle :size="15" class="text-amber-400" /> Priority Alerts
          </h3>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/25 font-bold">{{ alerts.length }} active</span>
        </div>

        <p v-if="!loading && alerts.length === 0" class="text-sm text-slate-500 italic">All clear — no alerts.</p>

        <div
          v-for="alert in alerts"
          :key="alert.id"
          :class="['p-4 rounded-xl border flex items-start gap-3 transition-all hover:border-slate-600', severityConfig[alert.severity].cls]"
        >
          <div :class="['w-2 h-2 rounded-full mt-1.5 shrink-0', severityConfig[alert.severity].dot]"></div>
          <div class="flex-1">
            <p class="text-sm text-slate-200">{{ alert.message }}</p>
            <div class="flex gap-3 mt-2">
              <button
                @click="handleAlertAction(alert)"
                :class="['text-xs font-semibold hover:underline', severityConfig[alert.severity].text]"
              >
                {{ alert.action }}
              </button>
              <button @click="dismissAlert(alert.id)" class="text-xs text-slate-600 hover:text-slate-400 transition-colors">Dismiss</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="rounded-2xl border p-6 space-y-3" style="background: var(--color-surface); border-color: var(--color-border)">
        <h3 class="text-sm font-bold text-white flex items-center gap-2 mb-2">
          <Zap :size="15" class="text-violet-400" /> Quick Actions
        </h3>
        <button @click="quickAction('email')" class="w-full flex items-center justify-between p-3 rounded-xl text-sm font-medium text-slate-300 hover:text-white transition-all hover:bg-white/5 border border-transparent hover:border-slate-700">
          <span class="flex items-center gap-2"><Mail :size="14" class="text-violet-400" /> Draft Status Email</span>
          <ArrowRight :size="13" class="text-slate-600" />
        </button>
        <button @click="quickAction('invoice')" class="w-full flex items-center justify-between p-3 rounded-xl text-sm font-medium text-slate-300 hover:text-white transition-all hover:bg-white/5 border border-transparent hover:border-slate-700">
          <span class="flex items-center gap-2"><Receipt :size="14" class="text-emerald-400" /> Generate Invoice</span>
          <ArrowRight :size="13" class="text-slate-600" />
        </button>
        <button @click="quickAction('risk')" class="w-full flex items-center justify-between p-3 rounded-xl text-sm font-medium text-slate-300 hover:text-white transition-all hover:bg-white/5 border border-transparent hover:border-slate-700">
          <span class="flex items-center gap-2"><TrendingUp :size="14" class="text-cyan-400" /> Predict Deadline Risk</span>
          <ArrowRight :size="13" class="text-slate-600" />
        </button>
        <button @click="quickAction('summary')" class="w-full flex items-center justify-between p-3 rounded-xl text-sm font-medium text-slate-300 hover:text-white transition-all hover:bg-white/5 border border-transparent hover:border-slate-700">
          <span class="flex items-center gap-2"><CheckCircle2 :size="14" class="text-amber-400" /> Weekly Summary</span>
          <ArrowRight :size="13" class="text-slate-600" />
        </button>
      </div>
    </div>

  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity .25s ease, transform .25s ease; }
.fade-enter-from, .fade-leave-to       { opacity: 0; transform: translateY(-6px); }
</style>
