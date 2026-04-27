import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api, { authService } from '../services/api'
import { googleSignIn as firebaseGoogleSignIn, googleSignOut } from '../services/firebase'

const TOKEN_KEY = 'sushmi_token'
const REGISTERED_KEY = 'sushmi_registered_emails'

function loadRegistered() {
  try {
    return new Set(JSON.parse(localStorage.getItem(REGISTERED_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

function saveRegistered(set) {
  localStorage.setItem(REGISTERED_KEY, JSON.stringify([...set]))
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const token = ref(localStorage.getItem(TOKEN_KEY) || null)
  const registeredEmails = ref(loadRegistered())

  const isAuthenticated = computed(() => !!user.value && !!token.value)

  function isRegistered(email) {
    return registeredEmails.value.has((email || '').trim().toLowerCase())
  }

  function setSession(payload) {
    token.value = payload.token
    user.value = payload.user
    localStorage.setItem(TOKEN_KEY, payload.token)
  }

  function clearSession() {
    token.value = null
    user.value = null
    localStorage.removeItem(TOKEN_KEY)
  }

  async function signUp({ name, email, password }) {
    const data = await authService.signUp({ name, email, password })
    registeredEmails.value.add(email.trim().toLowerCase())
    saveRegistered(registeredEmails.value)
    setSession(data)
    return data.user
  }

  async function signIn({ email, password }) {
    if (!isRegistered(email)) {
      const err = new Error('No account found for this email on this device. Please sign up first.')
      err.code = 'NOT_REGISTERED'
      throw err
    }
    try {
      const data = await authService.signIn({ email, password })
      setSession(data)
      return data.user
    } catch (e) {
      const code = e?.response?.data?.code
      const msg = e?.response?.data?.error || e.message
      if (code === 'NOT_REGISTERED') {
        registeredEmails.value.delete(email.trim().toLowerCase())
        saveRegistered(registeredEmails.value)
      }
      const wrapped = new Error(msg)
      wrapped.code = code
      throw wrapped
    }
  }

  async function signInWithGoogle() {
    const profile = await firebaseGoogleSignIn()
    const { data } = await api.post('/auth/google', profile)
    registeredEmails.value.add(profile.email.trim().toLowerCase())
    saveRegistered(registeredEmails.value)
    setSession(data)
    return { user: data.user, isNew: data.isNew }
  }

  async function logout() {
    try { await authService.logout() } catch { /* ignore */ }
    try { await googleSignOut() } catch { /* ignore */ }
    clearSession()
  }

  async function updateProfile(payload) {
    const data = await authService.updateProfile(payload)
    user.value = data.user
    return data.user
  }

  async function changePassword(payload) {
    const data = await authService.changePassword(payload)
    if (data.token) {
      token.value = data.token
      localStorage.setItem(TOKEN_KEY, data.token)
    }
    if (data.user) user.value = data.user
    return true
  }

  async function updatePreferences(payload) {
    const data = await authService.updatePreferences(payload)
    if (user.value) user.value = { ...user.value, preferences: data.preferences }
    return data.preferences
  }

  async function deleteAccount() {
    await authService.deleteAccount()
    clearSession()
  }

  async function hydrate() {
    if (!token.value) return
    try {
      const data = await authService.me()
      user.value = data.user
    } catch {
      clearSession()
    }
  }

  return {
    user, token, isAuthenticated,
    signUp, signIn, signInWithGoogle, logout, hydrate, isRegistered,
    updateProfile, changePassword, updatePreferences, deleteAccount,
  }
})
