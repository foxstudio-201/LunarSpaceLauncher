import { useEffect, useState } from 'react'

const PARKED = 'data-tip-parked'

export default function TooltipProvider() {
  const [tip, setTip] = useState(null)

  useEffect(() => {
    let moveRaf = 0

    function read(el) {
      const custom = el.getAttribute('data-tip')
      if (custom) return custom
      const native = el.getAttribute('title')
      return native || ''
    }

    function park(el) {
      const native = el.getAttribute('title')
      if (native) {
        el.setAttribute(PARKED, native)
        el.removeAttribute('title')
      }
    }

    function unpark(el) {
      const parked = el.getAttribute(PARKED)
      if (parked != null) {
        el.setAttribute('title', parked)
        el.removeAttribute(PARKED)
      }
    }

    function compute(el) {
      const text = read(el)
      if (!text) return null
      const r = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      let dir = 'top'
      if (r.left < 90) dir = 'right'
      else if (r.right > vw - 90) dir = 'left'
      else if (r.top > vh / 2) dir = 'top'
      else dir = 'bottom'
      return { text, r, dir }
    }

    function onOver(e) {
      const el = e.target.closest('[data-tip], [title]')
      if (!el) {
        setTip(null)
        return
      }
      const next = compute(el)
      park(el)
      setTip(next)
    }

    function onMove(e) {
      const el = e.target.closest('[data-tip], [title], [' + PARKED + ']')
      if (!el) return
      cancelAnimationFrame(moveRaf)
      moveRaf = requestAnimationFrame(() => {
        const c = compute(el)
        park(el)
        if (c) setTip((t) => (t ? { ...t, r: c.r, dir: c.dir } : t))
      })
    }

    function onOut(e) {
      const el = e.target.closest('[data-tip], [title], [' + PARKED + ']')
      if (el && !el.contains(e.relatedTarget)) {
        unpark(el)
        setTip(null)
      }
    }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseout', onOut)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseout', onOut)
      cancelAnimationFrame(moveRaf)
    }
  }, [])

  if (!tip) return null

  const { r, dir } = tip
  const centerX = r.left + r.width / 2
  const centerY = r.top + r.height / 2
  const GAP = 8
  const long = tip.text.length > 42

  let pos
  if (dir === 'top') pos = { left: centerX, top: r.top - GAP, transform: 'translate(-50%, -100%)' }
  else if (dir === 'bottom') pos = { left: centerX, top: r.bottom + GAP, transform: 'translate(-50%, 0)' }
  else if (dir === 'left') pos = { left: r.left - GAP, top: centerY, transform: 'translate(-100%, -50%)' }
  else pos = { left: r.right + GAP, top: centerY, transform: 'translate(0, -50%)' }

  const ARROW = 'rgba(26,22,37,0.92)'
  const triBase = {
    position: 'absolute',
    width: 0,
    height: 0,
    borderTop: '5px solid transparent',
    borderRight: '5px solid transparent',
    borderBottom: '5px solid transparent',
    borderLeft: '5px solid transparent',
  }
  const arrowEl =
    dir === 'top' ? <span style={{ ...triBase, borderTop: `6px solid ${ARROW}`, left: '50%', bottom: '-6px', transform: 'translateX(-50%)' }} />
    : dir === 'bottom' ? <span style={{ ...triBase, borderBottom: `6px solid ${ARROW}`, left: '50%', top: '-6px', transform: 'translateX(-50%)' }} />
    : dir === 'left' ? <span style={{ ...triBase, borderLeft: `6px solid ${ARROW}`, top: '50%', right: '-6px', transform: 'translateY(-50%)' }} />
    : <span style={{ ...triBase, borderRight: `6px solid ${ARROW}`, top: '50%', left: '-6px', transform: 'translateY(-50%)' }} />

  return (
    <div className="fixed z-[2147483000] pointer-events-none" style={pos}>
      <div
        className={`px-3 py-1.5 rounded-lg border border-white/10 text-[11px] font-semibold text-white/95 ${
          long ? 'max-w-[300px] leading-relaxed' : 'whitespace-nowrap'
        }`}
        style={{ background: ARROW, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', boxShadow: '0 10px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(167,139,250,0.08)' }}
      >
        {tip.text}
        {arrowEl}
      </div>
    </div>
  )
}
