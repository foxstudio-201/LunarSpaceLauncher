import { useEffect, useRef, useState } from 'react'

const stepFor = (count, first) => Math.max(1, Math.min(4, Math.ceil((count - first) / 60)))

export default function useProgressive(count, { first = 12, step = 'auto', delay = 28, enabled = true } = {}) {
  const [limit, setLimit] = useState(() => (enabled ? Math.min(first, count) : count))
  const timer = useRef(0)

  useEffect(() => {
    setLimit(enabled ? Math.min(first, count) : count)
  }, [count, enabled, first])

  useEffect(() => {
    if (!enabled || limit >= count) return undefined
    const size = step === 'auto' ? stepFor(count, first) : step
    timer.current = setTimeout(() => {
      setLimit((value) => Math.min(count, value + size))
    }, delay)
    return () => clearTimeout(timer.current)
  }, [limit, count, step, delay, enabled, first])

  return enabled ? Math.min(limit, count) : count
}
