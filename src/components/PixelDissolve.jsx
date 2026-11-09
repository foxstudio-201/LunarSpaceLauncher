// Lucian UX/UI Prompt #349 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#349
import { useEffect, useMemo, useRef, useState } from 'react'

const COLS = 12
const ROWS = 9
const POP_MS = 380
const SPREAD_MS = 380

// Bảng màu kiểu "block grass": lớp trên xanh cỏ, lớp dưới nâu đất — đục hoàn toàn.
const GRASS = ['#7CBD56', '#6DB24A', '#5D9C3F', '#4E8A34', '#86C962']
const DIRT = ['#8B5A2B', '#7A5230', '#6B4423', '#5C3A21', '#9C6B3F']

const pick = (list) => list[Math.floor(Math.random() * list.length)]

function cellColor(y) {
  // hàng trên cùng giống mặt cỏ, càng xuống càng nhiều đất
  const grassChance = y <= 1 ? 0.9 : y <= 3 ? 0.65 : y <= 5 ? 0.3 : 0.12
  return Math.random() < grassChance ? pick(GRASS) : pick(DIRT)
}

// Lưới phủ kín rồi tan dần để lộ nội dung mới (chỉ dùng kiểu chia ô ngẫu nhiên của bản mẫu).
export default function PixelDissolve({ onMid, onDone }) {
  const [phase, setPhase] = useState('cover')
  const doneRef = useRef(false)
  const midRef = useRef(onMid)
  const doneCbRef = useRef(onDone)
  midRef.current = onMid
  doneCbRef.current = onDone

  const cells = useMemo(() => {
    const list = []
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        list.push({
          key: `${x}-${y}`,
          color: cellColor(y),
          delay: Math.round(Math.random() * SPREAD_MS),
        })
      }
    }
    return list
  }, [])

  const [outDelays] = useState(() => cells.map(() => Math.round(Math.random() * SPREAD_MS)))

  useEffect(() => {
    const midTimer = window.setTimeout(() => {
      midRef.current?.()
      setPhase('reveal')
    }, POP_MS + SPREAD_MS)
    const endTimer = window.setTimeout(() => {
      if (doneRef.current) return
      doneRef.current = true
      doneCbRef.current?.()
    }, POP_MS + SPREAD_MS + POP_MS + SPREAD_MS)
    return () => {
      window.clearTimeout(midTimer)
      window.clearTimeout(endTimer)
    }
  }, [])

  return (
    <div className="u349" aria-hidden="true">
      <style>{`
.u349{position:fixed;inset:0;z-index:10000;overflow:hidden;pointer-events:auto}
.u349-cells{position:absolute;inset:0;display:grid;grid-template-columns:repeat(12,1fr);grid-template-rows:repeat(9,1fr)}
.u349-cells i{display:block;background:var(--u349-c);transform:scale(0);border-radius:2px}
.u349-cells.cover i{animation:u349-pop .38s cubic-bezier(.3,1.5,.5,1) both;animation-delay:var(--d)}
.u349-cells.reveal i{animation:u349-unpop .38s cubic-bezier(.3,1.5,.5,1) both;animation-delay:var(--d)}
@keyframes u349-pop{0%{transform:scale(0);border-radius:50%}70%{transform:scale(1.12)}100%{transform:scale(1.02);border-radius:0}}
@keyframes u349-unpop{0%{transform:scale(1.02);border-radius:0}30%{transform:scale(1.12)}100%{transform:scale(0);border-radius:50%}}
@media (prefers-reduced-motion:reduce){
  .u349-cells.cover i,.u349-cells.reveal i{animation-duration:.001ms;animation-delay:0ms}
}
      `}</style>
      <div className={`u349-cells ${phase}`}>
        {cells.map((cell, index) => (
          <i
            key={cell.key}
            style={{
              '--d': `${phase === 'cover' ? cell.delay : outDelays[index]}ms`,
              '--u349-c': cell.color,
            }}
          />
        ))}
      </div>
    </div>
  )
}
