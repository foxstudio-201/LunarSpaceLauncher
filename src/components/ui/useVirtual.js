import { useCallback, useEffect, useRef, useState } from 'react'

const EMPTY = { start: 0, end: 0, perRow: 1, padTop: 0, padBottom: 0 }

export default function useVirtual({ containerRef, wrapRef, contentRef, count, rowHeight = 40, gap = 0, overscan = 4, mode = 'rows', enabled = true }) {
  const [view, setView] = useState(EMPTY)
  const metrics = useRef({ perRow: 1, pitch: rowHeight, width: 0, count: -1 })

  const measure = useCallback(() => {
    const node = containerRef?.current
    if (!node || !enabled || count <= 0) {
      setView((prev) => (prev.start === 0 && prev.end === count ? prev : { start: 0, end: count, perRow: 1, padTop: 0, padBottom: 0 }))
      return
    }
    const width = node.clientWidth
    const cache = metrics.current
    if (cache.count !== count || cache.width !== width) {
      const content = contentRef?.current
      let perRow = 1
      let pitch = rowHeight
      if (mode === 'grid') {
        const template = content ? getComputedStyle(content).gridTemplateColumns : ''
        perRow = Math.max(1, template ? template.split(' ').filter(Boolean).length : 1)
        const kids = content?.children
        if (kids && kids.length > perRow && kids[perRow]) pitch = kids[perRow].offsetTop - kids[0].offsetTop
        else if (kids && kids.length) pitch = kids[0].offsetHeight + gap
        if (!pitch || pitch < 8) pitch = rowHeight
      }
      cache.perRow = perRow
      cache.pitch = pitch
      cache.width = width
      cache.count = count
    }
    const { perRow, pitch } = cache
    const rect = node.getBoundingClientRect()
    const anchor = wrapRef?.current || contentRef?.current
    const above = Math.max(0, rect.top - (anchor ? anchor.getBoundingClientRect().top : rect.top))
    const rows = Math.ceil(count / perRow)
    const startRow = Math.max(0, Math.floor(above / pitch) - overscan)
    const endRow = Math.min(rows, Math.ceil((above + rect.height) / pitch) + overscan)
    const start = startRow * perRow
    const end = Math.min(count, endRow * perRow)
    const padTop = startRow * pitch
    const padBottom = Math.max(0, (rows - endRow) * pitch)
    setView((prev) =>
      prev.start === start && prev.end === end && prev.perRow === perRow && prev.padTop === padTop && prev.padBottom === padBottom
        ? prev
        : { start, end, perRow, padTop, padBottom },
    )
  }, [containerRef, wrapRef, contentRef, count, rowHeight, gap, overscan, mode, enabled])

  useEffect(() => {
    const node = containerRef?.current
    if (!node) return undefined
    node.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(node)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      node.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [containerRef, measure])

  useEffect(() => {
    metrics.current.count = -1
    const timer = setTimeout(measure, 20)
    return () => clearTimeout(timer)
  }, [count, measure])

  return view
}
