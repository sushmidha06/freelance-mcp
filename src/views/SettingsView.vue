<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  User, Mail, Lock, Bell, Globe, Trash2, Save, Loader2, Shield, Palette, CheckCircle2, AlertCircle
} from 'lucide-vue-next'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()

const profile = reactive({ name: '', email: '' })
const passwords = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const prefs = reactive({
  theme: 'dark',
  emailNotifications: true,
  pushNotifications: true,
  weeklyDigest: true,
  timezone: 'UTC',
  currency: 'USD',
})

const savingProfile = ref(false)
const savingPassword = ref(false)
const savingPrefs = ref(false)
const deleting = ref(false)
const confirmDelete = ref(false)
const status = ref({ kind: '', msg: '' })

const isGoogleAccount = computed(() => auth.user?.provider === 'google')

function flash(kind, msg) {
  status.value = { kind, msg }
  setTimeout(() => { status.value = { kind: '', msg: '' } }, 2600)
}

function syncFromUser() {
  const u = auth.user || {}
  profile.name = u.name || ''
  profile.email = u.email || ''
  const p = u.preferences || {}
  prefs.theme = p.theme || 'dark'
  prefs.emailNotifications = p.emailNotifications ?? true
  prefs.pushNotifications = p.pushNotifications ?? true
  prefs.weeklyDigest = p.weeklyDigest ?? true
  prefs.timezone = p.timezone || 'UTC'
  prefs.currency = p.currency || 'USD'
}

onMounted(async () => {
  if (auth.token && !auth.user) await auth.hydrate()
  syncFromUser()
})

watch(() => auth.user, syncFromUser, { deep: true })

async function saveProfile() {
  savingProfile.value = true
  try {
    await auth.updateProfile({ name: profile.name, email: profile.email })
    flash('success', 'Profile updated')
  } catch (e) {
    flash('error', e?.response?.data?.error || e.message || 'Could not save profile')
  } finally {
    savingProfile.value = false
  }
}

async function savePassword() {
  if (!passwords.newPassword || passwords.newPassword.length < 6) {
    flash('error', 'New password must be at least 6 characters')
    return
  }
  if (passwords.newPassword !== passwords.confirmPassword) {
    flash('error', 'New passwords do not match')
    return
  }
  savingPassword.value = true
  try {
    await auth.changePassword({
      currentPassword: passwords.currentPassword,
      newPassword: passwords.newPassword,
    })
    passwords.currentPassword = ''
    passwords.newPassword = ''
    passwords.confirmPassword = ''
    flash('success', 'Password changed')
  } catch (e) {
    flash('error', e?.response?.data?.error || e.message || 'Could not change password')
  } finally {
    savingPassword.value = false
  }
}

async function savePrefs() {
  savingPrefs.value = true
  try {
    await auth.updatePreferences({ ...prefs })
    flash('success', 'Preferences saved')
  } catch (e) {
    flash('error', e?.response?.data?.error || e.message || 'Could not save preferences')
  } finally {
    savingPrefs.value = false
  }
}

async function doDelete() {
  deleting.value = true
  try {
    await auth.deleteAccount()
    router.replace({ name: 'auth', query: { mode: 'signup' } })
  } catch (e) {
    flash('error', e?.response?.data?.error || e.message || 'Could not delete account')
  } finally {
    deleting.value = false
  }
}

const timezones = [
  'UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Singapore',
  'Asia/Tokyo', 'Australia/Sydney',
]
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 animate-fadeIn">

    <!-- Toast -->
    <transition name="fade">
      <div v-if="status.msg"
        :class="['fixed top-20 right-6 z-50 px-4 py-2.5 rounded-xl border backdrop-blur text-sm shadow-lg flex items-center gap-2',
          status.kind === 'success' ? 'border-emerald-500/30 bg-slate-900/90 text-emerald-200 shadow-emerald-500/20'
          : 'border-rose-500/30 bg-slate-900/90 text-rose-200 shadow-rose-500/20']">
        <CheckCircle2 v-if="status.kind === 'success'" :size="14" />
        <AlertCircle v-else :size="14" />
        {{ status.msg }}
      </div>
    </transition>

    <div>
      <h2 class="text-2xl font-bold text-white">Settings</h2>
      <p class="text-sm text-slate-400 mt-1">Manage your account, security and preferences.</p>
    </div>

    <!-- Profile -->
    <section class="rounded-2xl border p-6" style="background: var(--color-surface); border-color: var(--color-border)">
      <div class="flex items-center gap-2 mb-5">
        <User :size="16" class="text-violet-400" />
        <h3 class="text-sm font-bold text-white">Profile</h3>
      </div>
      <form @submit.prevent="saveProfile" class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">Full name</label>
          <input v-model="profile.name" type="text" class="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white focus:outline-none focus:border-violet-500" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
          <div class="relative">
            <Mail :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input v-model="profile.email" type="email" :disabled="isGoogleAccount"
              class="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white focus:outline-none focus:border-violet-500 disabled:opacity-60 disabled:cursor-not-allowed" />
          </div>
          <p v-if="isGoogleAccount" class="text-[11px] text-slate-500 mt-1.5">Email is managed by your Google account.</p>
        </div>
        <div class="flex justify-end">
          <button type="submit" :disabled="savingProfile" class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-60">
            <Loader2 v-if="savingProfile" :size="14" class="animate-spin" />
            <Save v-else :size="14" />
            {{ savingProfile ? 'Saving…' : 'Save profile' }}
          </button>
        </div>
      </form>
    </section>

    <!-- Security -->
    <section class="rounded-2xl border p-6" style="background: var(--color-surface); border-color: var(--color-border)">
      <div class="flex items-center gap-2 mb-5">
        <Shield :size="16" class="text-cyan-400" />
        <h3 class="text-sm font-bold text-white">Security</h3>
      </div>

      <div v-if="isGoogleAccount" class="text-sm text-slate-400 p-4 rounded-xl border border-slate-700 bg-slate-900/40 flex items-start gap-3">
        <Lock :size="15" class="text-slate-500 mt-0.5 shrink-0" />
        <p>This account signs in with Google. Password is managed by Google.</p>
      </div>

      <form v-else @submit.prevent="savePassword" class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">Current password</label>
          <input v-model="passwords.currentPassword" type="password" autocomplete="current-password"
            class="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white focus:outline-none focus:border-cyan-500" />
        </div>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium text-slate-400 mb-1.5">New password</label>
            <input v-model="passwords.newPassword" type="password" autocomplete="new-password"
              class="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white focus:outline-none focus:border-cyan-500" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-400 mb-1.5">Confirm new password</label>
            <input v-model="passwords.confirmPassword" type="password" autocomplete="new-password"
              class="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white focus:outline-none focus:border-cyan-500" />
          </div>
        </div>
        <div class="flex justify-end">
          <button type="submit" :disabled="savingPassword" class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60">
            <Loader2 v-if="savingPassword" :size="14" class="animate-spin" />
            <Lock v-else :size="14" />
            {{ savingPassword ? 'Updating…' : 'Change password' }}
          </button>
        </div>
      </form>
    </section>

    <!-- Preferences -->
    <section class="rounded-2xl border p-6" style="background: var(--color-surface); border-color: var(--color-border)">
      <div class="flex items-center gap-2 mb-5">
        <Palette :size="16" class="text-amber-400" />
        <h3 class="text-sm font-bold text-white">Preferences</h3>
      </div>
      <form @submit.prevent="savePrefs" class="space-y-5">

        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium text-slate-400 mb-1.5">Theme</label>
            <select v-model="prefs.theme" class="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white focus:outline-none focus:border-amber-500">
              <option value="dark">Dark</option>
              <option value="light">Light (coming soon)</option>
              <option value="system">System</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-400 mb-1.5 flex items-center gap-1.5"><Globe :size="12" /> Timezone</label>
            <select v-model="prefs.timezone" class="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white focus:outline-none focus:border-amber-500">
              <option v-for="tz in timezones" :key="tz" :value="tz">{{ tz }}</option>
            </select>
          </div>
        </div>

        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium text-slate-400 mb-1.5">Currency</label>
            <select v-model="prefs.currency" class="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white focus:outline-none focus:border-amber-500">
              <option value="USD">US Dollar ($)</option>
              <option value="INR">Indian Rupee (₹)</option>
            </select>
            <p class="text-[11px] text-slate-500 mt-1.5">Used to format amounts across Dashboard, Projects, and Billing.</p>
          </div>
        </div>

        <div class="space-y-3">
          <label class="flex items-center justify-between p-3 rounded-xl border border-slate-700 bg-slate-900/40">
            <span class="flex items-center gap-2 text-sm text-slate-200"><Mail :size="14" class="text-violet-400" /> Email notifications</span>
            <input v-model="prefs.emailNotifications" type="checkbox" class="accent-violet-500 w-4 h-4" />
          </label>
          <label class="flex items-center justify-between p-3 rounded-xl border border-slate-700 bg-slate-900/40">
            <span class="flex items-center gap-2 text-sm text-slate-200"><Bell :size="14" class="text-cyan-400" /> Push notifications</span>
            <input v-model="prefs.pushNotifications" type="checkbox" class="accent-violet-500 w-4 h-4" />
          </label>
          <label class="flex items-center justify-between p-3 rounded-xl border border-slate-700 bg-slate-900/40">
            <span class="flex items-center gap-2 text-sm text-slate-200"><CheckCircle2 :size="14" class="text-emerald-400" /> Weekly digest email</span>
            <input v-model="prefs.weeklyDigest" type="checkbox" class="accent-violet-500 w-4 h-4" />
          </label>
        </div>

        <div class="flex justify-end">
          <button type="submit" :disabled="savingPrefs" class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-60">
            <Loader2 v-if="savingPrefs" :size="14" class="animate-spin" />
            <Save v-else :size="14" />
            {{ savingPrefs ? 'Saving…' : 'Save preferences' }}
          </button>
        </div>
      </form>
    </section>

    <!-- Danger zone -->
    <section class="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6">
      <div class="flex items-center gap-2 mb-3">
        <Trash2 :size="16" class="text-rose-400" />
        <h3 class="text-sm font-bold text-rose-200">Danger zone</h3>
      </div>
      <p class="text-sm text-slate-300 mb-4">Permanently delete your account. This cannot be undone.</p>
      <button v-if="!confirmDelete" @click="confirmDelete = true" class="px-4 py-2 rounded-xl text-sm font-semibold text-rose-200 border border-rose-500/40 hover:bg-rose-500/10">
        Delete account
      </button>
      <div v-else class="flex items-center gap-3">
        <button @click="confirmDelete = false" class="px-4 py-2 rounded-xl text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/5">Cancel</button>
        <button @click="doDelete" :disabled="deleting" class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-60">
          <Loader2 v-if="deleting" :size="14" class="animate-spin" />
          <Trash2 v-else :size="14" />
          {{ deleting ? 'Deleting…' : 'Yes, delete my account' }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity .25s ease, transform .25s ease; }
.fade-enter-from, .fade-leave-to       { opacity: 0; transform: translateY(-6px); }
</style>
