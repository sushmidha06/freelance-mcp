<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Bot, Mail, Lock, User, Loader2, AlertCircle, ArrowRight, Zap, Chrome } from 'lucide-vue-next'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const mode = ref(route.query.mode === 'signin' ? 'signin' : 'signup')
const submitting = ref(false)
const googleSubmitting = ref(false)
const error = ref('')
const info = ref('')

const form = reactive({
  name: '',
  email: '',
  password: '',
  confirm: '',
})

const isSignUp = computed(() => mode.value === 'signup')

function switchMode(next) {
  mode.value = next
  error.value = ''
  info.value = ''
  router.replace({ query: { mode: next } })
}

function emailValid(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim())
}

async function submit() {
  error.value = ''
  info.value = ''

  if (!emailValid(form.email)) {
    error.value = 'Please enter a valid email address.'
    return
  }
  if (form.password.length < 6) {
    error.value = 'Password must be at least 6 characters.'
    return
  }

  submitting.value = true
  try {
    if (isSignUp.value) {
      if (!form.name.trim()) { error.value = 'Please enter your name.'; return }
      if (form.password !== form.confirm) { error.value = 'Passwords do not match.'; return }
      await auth.signUp({ name: form.name, email: form.email, password: form.password })
      router.replace('/')
    } else {
      if (!auth.isRegistered(form.email)) {
        error.value = 'No account found for this email. Please sign up first.'
        return
      }
      await auth.signIn({ email: form.email, password: form.password })
      router.replace('/')
    }
  } catch (e) {
    if (e.code === 'NOT_REGISTERED') {
      error.value = 'No account found for this email. Please sign up first.'
    } else {
      error.value = e.message || 'Something went wrong. Please try again.'
    }
  } finally {
    submitting.value = false
  }
}

async function continueWithGoogle() {
  error.value = ''
  info.value = ''
  googleSubmitting.value = true
  try {
    await auth.signInWithGoogle()
    router.replace('/')
  } catch (e) {
    if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') {
      return
    }
    error.value = e?.response?.data?.error || e.message || 'Google sign-in failed.'
  } finally {
    googleSubmitting.value = false
  }
}

function prefillSignIn() {
  switchMode('signin')
  form.password = ''
  form.confirm = ''
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4 py-10" style="background: var(--color-bg)">
    <div class="w-full max-w-md">

      <!-- Logo -->
      <div class="flex flex-col items-center mb-8">
        <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center animate-pulse-glow mb-4">
          <Bot :size="22" class="text-white" />
        </div>
        <h1 class="text-2xl font-bold gradient-text">Sushmi MCP</h1>
        <p class="text-xs text-slate-500 mt-1">Freelance Intelligence Platform</p>
      </div>

      <!-- Card -->
      <div class="rounded-2xl border p-6 sm:p-8" style="background: var(--color-surface); border-color: var(--color-border)">

        <!-- Tabs -->
        <div class="grid grid-cols-2 mb-6 p-1 rounded-xl border" style="border-color: var(--color-border); background: rgba(255,255,255,0.02)">
          <button
            type="button"
            @click="switchMode('signup')"
            :class="['px-4 py-2 text-sm font-semibold rounded-lg transition-all',
              isSignUp ? 'bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20' : 'text-slate-400 hover:text-slate-200']"
          >Sign Up</button>
          <button
            type="button"
            @click="switchMode('signin')"
            :class="['px-4 py-2 text-sm font-semibold rounded-lg transition-all',
              !isSignUp ? 'bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20' : 'text-slate-400 hover:text-slate-200']"
          >Sign In</button>
        </div>

        <h2 class="text-lg font-bold text-white mb-1">
          {{ isSignUp ? 'Create your account' : 'Welcome back' }}
        </h2>
        <p class="text-xs text-slate-500 mb-6">
          {{ isSignUp ? 'Start automating your freelance workflow in seconds.' : 'Sign in to continue to your dashboard.' }}
        </p>

        <button
          type="button"
          @click="continueWithGoogle"
          :disabled="googleSubmitting || submitting"
          class="w-full flex items-center justify-center gap-2 py-2.5 mb-5 rounded-xl bg-white hover:bg-slate-100 text-slate-800 text-sm font-semibold border border-slate-200 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Loader2 v-if="googleSubmitting" :size="15" class="animate-spin" />
          <Chrome v-else :size="15" class="text-[#4285F4]" />
          <span>{{ googleSubmitting ? 'Connecting…' : (isSignUp ? 'Sign up with Google' : 'Continue with Google') }}</span>
        </button>

        <div class="flex items-center gap-3 mb-5">
          <div class="flex-1 h-px bg-slate-700/60"></div>
          <span class="text-[10px] uppercase tracking-widest text-slate-500">or {{ isSignUp ? 'sign up' : 'sign in' }} with email</span>
          <div class="flex-1 h-px bg-slate-700/60"></div>
        </div>

        <form @submit.prevent="submit" class="space-y-4">
          <div v-if="isSignUp">
            <label class="block text-xs font-medium text-slate-400 mb-1.5">Full name</label>
            <div class="relative">
              <User :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                v-model="form.name"
                type="text"
                autocomplete="name"
                placeholder="Sushmidha Vikraman"
                class="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all"
              />
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
            <div class="relative">
              <Mail :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                v-model="form.email"
                type="email"
                autocomplete="email"
                placeholder="you@studio.com"
                class="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all"
              />
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
            <div class="relative">
              <Lock :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                v-model="form.password"
                type="password"
                :autocomplete="isSignUp ? 'new-password' : 'current-password'"
                placeholder="At least 6 characters"
                class="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all"
              />
            </div>
          </div>

          <div v-if="isSignUp">
            <label class="block text-xs font-medium text-slate-400 mb-1.5">Confirm password</label>
            <div class="relative">
              <Lock :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                v-model="form.confirm"
                type="password"
                autocomplete="new-password"
                placeholder="Repeat your password"
                class="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm bg-slate-900/60 border border-slate-700 text-white placeholder-slate-600 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all"
              />
            </div>
          </div>

          <div v-if="error" class="flex items-start gap-2 p-3 rounded-xl border border-rose-500/30 bg-rose-500/5 text-rose-300 text-xs">
            <AlertCircle :size="14" class="mt-0.5 shrink-0" />
            <div class="flex-1">
              <p>{{ error }}</p>
              <button v-if="!isSignUp && error.toLowerCase().includes('sign up')"
                      type="button"
                      @click="switchMode('signup')"
                      class="mt-1 font-semibold underline hover:text-rose-200">Go to sign up →</button>
            </div>
          </div>

          <div v-if="info" class="flex items-start gap-2 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-emerald-300 text-xs">
            <Zap :size="14" class="mt-0.5 shrink-0" />
            <p>{{ info }}</p>
          </div>

          <button
            type="submit"
            :disabled="submitting"
            class="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-sm font-semibold shadow-lg shadow-violet-500/25 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Loader2 v-if="submitting" :size="15" class="animate-spin" />
            <span>{{ submitting ? 'Please wait…' : (isSignUp ? 'Create account' : 'Sign in') }}</span>
            <ArrowRight v-if="!submitting" :size="15" />
          </button>
        </form>

        <div class="mt-6 text-center text-xs text-slate-500">
          <template v-if="isSignUp">
            Already have an account?
            <button type="button" class="text-violet-400 font-semibold hover:underline" @click="prefillSignIn">Sign in</button>
          </template>
          <template v-else>
            New here?
            <button type="button" class="text-violet-400 font-semibold hover:underline" @click="switchMode('signup')">Create an account</button>
          </template>
        </div>
      </div>

      <p class="text-center text-[11px] text-slate-600 mt-6">
        By continuing you agree to the Sushmi MCP Terms of Service.
      </p>
    </div>
  </div>
</template>
