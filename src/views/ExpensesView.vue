<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { Receipt, PlusCircle, Trash2, X, Loader2, FolderOpen, AlertCircle } from 'lucide-vue-next'
import { expensesService, projectService } from '../services/api'
import { formatMoney, currencySymbol } from '../services/format'

const expenses = ref([])
const projects = ref([])
const categories = ref([])
const loading = ref(true)
const showModal = ref(false)
const submitting = ref(false)
const editingId = ref(null)
const error = ref('')
const toast = ref('')

const todayIso = () => new Date().toISOString().slice(0, 10)
const blankForm = () => ({
  amount: 0,
  date: todayIso(),
  vendor: '',
  category: 'Software',
  projectId: '',
  notes: '',
})
const form = reactive(blankForm())

async function load() {
  loading.value = true
  try {
    const [exp, prj] = await Promise.all([
      expensesService.list(),
      projectService.getProjects(),
    ])
    expenses.value = exp.items || []
    categories.value = exp.categories || []
    projects.value = prj || []
  } catch (e) {
    error.value = e?.response?.data?.error || e.message
  } finally {
    loading.value = false
  }
}

onMounted(load)

const projectMap = computed(() => new Map(projects.value.map(p => [p.id, p])))

const totalAll       = computed(() => expenses.value.reduce((s, e) => s + (Number(e.amount) || 0), 0))
const totalThisMonth = computed(() => {
  const month = new Date().toISOString().slice(0, 7)
  return expenses.value
    .filter(e => (e.date || '').startsWith(month))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0)
})
const totalUnattributed = computed(() =>
  expenses.value.filter(e => !e.projectId).reduce((s, e) => s + (Number(e.amount) || 0), 0)
)

const byCategory = computed(() => {
  const map = new Map()
  for (const e of expenses.value) {
    const c = e.category || 'Other'
    map.set(c, (map.get(c) || 0) + Number(e.amount || 0))
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
})

function flashToast(msg) { toast.value = msg; setTimeout(() => toast.value = '', 2200) }

function openCreate() {
  editingId.value = null
  Object.assign(form, blankForm())
  error.value = ''
  showModal.value = true
}

function openEdit(exp) {
  editingId.value = exp.id
  Object.assign(form, {
    amount: exp.amount,
    date: exp.date || todayIso(),
    vendor: exp.vendor || '',
    category: exp.category || 'Other',
    projectId: exp.projectId || '',
    notes: exp.notes || '',
  })
  error.value = ''
  showModal.value = true
}

async function save() {
  error.value = ''
  if (!form.vendor.trim()) { error.value = 'Vendor is required'; return }
  if (!form.amount || form.amount <= 0) { error.value = 'Amount must be greater than 0'; return }
  submitting.value = true
  try {
    const project = form.projectId ? projectMap.value.get(form.projectId) : null
    const payload = {
      amount: Number(form.amount),
      date: form.date || todayIso(),
      vendor: form.vendor.trim(),
      category: form.category,
      projectId: form.projectId || null,
      projectClient: project?.client || null,
      notes: form.notes.trim(),
    }
    if (editingId.value) {
      const updated = await expensesService.update(editingId.value, payload)
      const idx = expenses.value.findIndex(e => e.id === editingId.value)
      if (idx >= 0) expenses.value[idx] = updated
      flashToast(`Updated expense`)
    } else {
      const created = await expensesService.create(payload)
      expenses.value = [created, ...expenses.value]
      flashToast(`Logged ${formatMoney(created.amount)} expense`)
    }
    showModal.value = false
  } catch (e) {
    error.value = e?.response?.data?.error || e.message
  } finally {
    submitting.value = false
  }
}

async function remove(exp) {
  if (!confirm(`Delete the ${formatMoney(exp.amount)} expense from ${exp.vendor}?`)) return
  const original = [...expenses.value]
  expenses.value = expenses.value.filter(e => e.id !== exp.id)
  try { await expensesService.remove(exp.id) } catch {
    expenses.value = original
    flashToast('Delete failed')
  }
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-6 animate-fadeIn">

    <transition name="fade">
      <div v-if="toast" class="fixed top-20 right-6 z-50 px-4 py-2.5 rounded-xl border border-emerald-500/30 bg-slate-900/90 backdrop-blur text-sm text-emerald-200 shadow-lg shadow-emerald-500/20">
        {{ toast }}
      </div>
    </transition>

    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold text-white">Expenses</h2>
        <p class="text-sm text-slate-400 mt-1">Track spend and roll it up against your projects.</p>
      </div>
      <button @click="openCreate"
              class="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20">
        <PlusCircle :size="14" /> New Expense
      </button>
    </div>

    <div v-if="error && !showModal" class="p-3 rounded-xl border border-rose-500/30 bg-rose-500/5 text-xs text-rose-300 flex items-start gap-2">
      <AlertCircle :size="14" class="mt-0.5 shrink-0" /> <span>{{ error }}</span>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="p-5 rounded-2xl bg-slate-900 border border-slate-800">
        <p class="text-xs text-slate-500 uppercase tracking-widest mb-2">Total spend</p>
        <p class="text-3xl font-bold text-white">{{ formatMoney(totalAll) }}</p>
      </div>
      <div class="p-5 rounded-2xl bg-slate-900 border border-slate-800">
        <p class="text-xs text-slate-500 uppercase tracking-widest mb-2">This month</p>
        <p class="text-3xl font-bold text-emerald-400">{{ formatMoney(totalThisMonth) }}</p>
      </div>
      <div class="p-5 rounded-2xl bg-slate-900 border border-slate-800">
        <p class="text-xs text-slate-500 uppercase tracking-widest mb-2">Unattributed</p>
        <p class="text-3xl font-bold text-amber-400">{{ formatMoney(totalUnattributed) }}</p>
        <p class="text-[10px] text-slate-500 mt-1">Expenses not yet linked to a project</p>
      </div>
    </div>

    <!-- By category -->
    <div v-if="byCategory.length" class="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <p class="text-[11px] uppercase tracking-widest text-slate-500 font-bold mb-3">Spend by category</p>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div v-for="[cat, amt] in byCategory" :key="cat" class="p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
          <p class="text-[11px] text-slate-400 truncate">{{ cat }}</p>
          <p class="text-sm font-bold text-white mt-1">{{ formatMoney(amt) }}</p>
        </div>
      </div>
    </div>

    <!-- Loading / empty -->
    <div v-if="loading" class="text-sm text-slate-500">Loading expenses…</div>
    <div v-else-if="expenses.length === 0" class="rounded-2xl border border-slate-800 bg-slate-900 p-10 flex flex-col items-center text-center">
      <Receipt :size="36" class="mb-3 text-slate-700" />
      <p class="text-sm font-semibold text-white">No expenses logged yet</p>
      <p class="text-xs text-slate-500 mt-2 max-w-md">
        Click <span class="text-emerald-400">New Expense</span> to log software bills, hosting, subcontractors, anything you spend.
        Link an expense to a project and it'll roll up into that project's <span class="font-mono text-slate-300">Spent</span> on the Projects page.
      </p>
    </div>

    <!-- Table -->
    <div v-else class="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-800 text-slate-500 text-xs uppercase tracking-widest">
            <th class="text-left px-6 py-4 font-semibold">Date</th>
            <th class="text-left px-6 py-4 font-semibold">Vendor</th>
            <th class="text-left px-6 py-4 font-semibold">Category</th>
            <th class="text-left px-6 py-4 font-semibold">Project</th>
            <th class="text-right px-6 py-4 font-semibold">Amount</th>
            <th class="px-6 py-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in expenses" :key="e.id" class="border-b border-slate-800/50 hover:bg-slate-800/40 transition-colors">
            <td class="px-6 py-3 text-slate-400 font-mono text-xs">{{ e.date }}</td>
            <td class="px-6 py-3 text-slate-200 font-medium">{{ e.vendor }}</td>
            <td class="px-6 py-3">
              <span class="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">{{ e.category || 'Other' }}</span>
            </td>
            <td class="px-6 py-3 text-xs">
              <span v-if="projectMap.get(e.projectId)" class="text-violet-300 font-mono">
                <FolderOpen :size="11" class="inline mr-1" />{{ projectMap.get(e.projectId).name }}
              </span>
              <span v-else class="text-slate-600">— unattributed —</span>
            </td>
            <td class="px-6 py-3 text-right font-bold text-white">{{ formatMoney(e.amount) }}</td>
            <td class="px-6 py-3 text-right whitespace-nowrap">
              <button @click="openEdit(e)" class="text-xs font-semibold text-violet-400 hover:underline mr-3">Edit</button>
              <button @click="remove(e)" class="text-slate-500 hover:text-rose-400" title="Delete"><Trash2 :size="14" /></button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal -->
    <Teleport to="body">
      <div v-if="showModal" class="fixed inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" style="z-index: 2147483000" @click.self="showModal = false">
        <div class="w-full max-w-lg flex flex-col rounded-2xl border shadow-2xl overflow-hidden" style="background: var(--color-surface); border-color: var(--color-border); max-height: 90vh">
          <header class="shrink-0 px-6 py-4 border-b flex items-center justify-between" style="border-color: var(--color-border)">
            <div>
              <h3 class="text-base font-bold text-white">{{ editingId ? 'Edit expense' : 'Log a new expense' }}</h3>
              <p class="text-[11px] text-slate-500 mt-0.5">Link to a project to roll up into its spent total.</p>
            </div>
            <button @click="showModal = false" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/5"><X :size="16" /></button>
          </header>

          <form @submit.prevent="save" class="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs text-slate-400 mb-1.5">Amount ({{ currencySymbol() }})</label>
                <input v-model.number="form.amount" type="number" min="0" step="0.01"
                  class="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label class="block text-xs text-slate-400 mb-1.5">Date</label>
                <input v-model="form.date" type="date"
                  class="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white focus:outline-none focus:border-emerald-500" />
              </div>
            </div>

            <div>
              <label class="block text-xs text-slate-400 mb-1.5">Vendor</label>
              <input v-model="form.vendor" type="text" placeholder="Vercel, Stripe, AWS…"
                class="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500" />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs text-slate-400 mb-1.5">Category</label>
                <select v-model="form.category"
                  class="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white focus:outline-none focus:border-emerald-500">
                  <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
                </select>
              </div>
              <div>
                <label class="block text-xs text-slate-400 mb-1.5">Project (optional)</label>
                <select v-model="form.projectId"
                  class="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white focus:outline-none focus:border-emerald-500">
                  <option value="">— unattributed —</option>
                  <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }} ({{ p.client }})</option>
                </select>
              </div>
            </div>

            <div>
              <label class="block text-xs text-slate-400 mb-1.5">Notes (optional)</label>
              <textarea v-model="form.notes" rows="2" placeholder="Receipt details, reference number…"
                class="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"></textarea>
            </div>

            <p v-if="error" class="text-xs text-rose-400">{{ error }}</p>
          </form>

          <footer class="shrink-0 px-6 py-4 border-t flex items-center justify-end gap-2" style="border-color: var(--color-border); background: rgba(0,0,0,0.2)">
            <button type="button" @click="showModal = false" class="px-4 py-2 rounded-xl text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/5">Cancel</button>
            <button @click="save" :disabled="submitting" class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60">
              <Loader2 v-if="submitting" :size="14" class="animate-spin" />
              <PlusCircle v-else :size="14" />
              {{ submitting ? 'Saving…' : (editingId ? 'Save changes' : 'Log expense') }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity .25s ease, transform .25s ease; }
.fade-enter-from, .fade-leave-to       { opacity: 0; transform: translateY(-6px); }
</style>
