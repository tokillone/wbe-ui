// Production requests deliberately stay on the current origin. Nginx owns the
// upstream address, so browser bundles never contain a host name or server IP.
export const API_BASE_URL = '/api'

function readBooleanFlag(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === '') return fallback
  return value.trim().toLowerCase() === 'true'
}

// Development can opt in when a backend (or Vite proxy) is available. A
// production build is safe by default even when no env file is copied.
export const HOME_OVERVIEW_API_ENABLED = readBooleanFlag(
  import.meta.env.VITE_ENABLE_HOME_OVERVIEW_API,
  import.meta.env.PROD,
)
