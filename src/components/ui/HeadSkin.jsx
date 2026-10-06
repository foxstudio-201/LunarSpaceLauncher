import { useState } from 'react'
import { User } from '@phosphor-icons/react'

export default function HeadSkin({ name, uuid, size = 32, radius = 8, theme = 'dark', style }) {
  const [failed, setFailed] = useState(false)
  const key = String(uuid || name || '').trim()
  const src = key ? `https://mc-heads.net/avatar/${encodeURIComponent(key)}/${Math.max(32, Math.round(size * 2))}` : ''
  const isLight = theme === 'light'
  return (
    <span
      className="inline-flex items-center justify-center overflow-hidden shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: isLight ? '#f0eff0' : '#0d0d10',
        border: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'}`,
        ...style,
      }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }}
        />
      ) : (
        <User size={Math.round(size * 0.55)} weight="duotone" style={{ color: isLight ? '#8b5cf6' : '#a78bfa' }} />
      )}
    </span>
  )
}
