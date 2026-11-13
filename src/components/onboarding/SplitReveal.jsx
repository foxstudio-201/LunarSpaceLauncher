// Tách màn cuối cùng: màn đăng nhập đã tối dần trước đó, nên lớp này mở ra
// ở trạng thái đục hoàn toàn rồi trượt hai nửa để lộ launcher.
import { useEffect, useState } from 'react'

export default function SplitReveal({ ink = '#04070c', holdMs = 260, onComplete }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const timer = setTimeout(() => onComplete?.(), 140)
      return () => clearTimeout(timer)
    }
    const split = setTimeout(() => setOpen(true), holdMs)
    const done = setTimeout(() => onComplete?.(), holdMs + 980)
    return () => {
      clearTimeout(split)
      clearTimeout(done)
    }
  }, [onComplete, holdMs])

  return (
    <div className={`sr${open ? ' open' : ''}`} style={{ '--sr-ink': ink }} aria-hidden="true">
      <style>{`
.sr{position:fixed;inset:0;z-index:10000;overflow:hidden;pointer-events:auto}
.sr-h{position:absolute;left:0;right:0;height:50.5%;background:var(--sr-ink);transition:transform .92s cubic-bezier(.76,0,.24,1)}
.sr-a{top:0}
.sr-b{bottom:0}
.sr.open .sr-a{transform:translateY(-101%)}
.sr.open .sr-b{transform:translateY(101%)}
@media (prefers-reduced-motion:reduce){
  .sr-h{transition:none}
}
      `}</style>
      <div className="sr-h sr-a" />
      <div className="sr-h sr-b" />
    </div>
  )
}
