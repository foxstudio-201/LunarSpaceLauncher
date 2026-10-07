const listeners = new Set()
let seq = 0

export function showToast(message, type = 'info', duration = 4500) {
  const id = ++seq
  const toast = { id, message, type, duration }
  listeners.forEach((fn) => fn(toast))
  return id
}

export function subscribeToasts(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
