import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  const alerts = ref([])
  const loading = ref(false)
  const lastSync = ref(null)

  function setAlerts(newAlerts) {
    alerts.value = newAlerts
  }

  function setLoading(status) {
    loading.value = status
  }

  function setLastSync() {
    lastSync.value = new Date().toISOString()
  }

  return { alerts, loading, lastSync, setAlerts, setLoading, setLastSync }
})
