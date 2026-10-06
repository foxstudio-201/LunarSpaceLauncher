import { useEffect, useRef, useState } from 'react'
import * as api from '../../api/client.js'

const memory = new Map()

function providerOf(type) {
  return type === 'microsoft' || type === 'ely' ? type : ''
}

function CropHead({ skin, size }) {
  const ref = useRef(null)

  useEffect(() => {
    let alive = true
    const image = new Image()
    image.onload = () => {
      const canvas = ref.current
      if (!alive || !canvas) return
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, size, size)
      ctx.drawImage(image, 8, 8, 8, 8, 0, 0, size, size)
      if (image.height >= 64) ctx.drawImage(image, 40, 8, 8, 8, 0, 0, size, size)
    }
    image.src = skin
    return () => {
      alive = false
      image.onload = null
    }
  }, [skin, size])

  return <canvas ref={ref} style={{ width: size, height: size, imageRendering: 'pixelated', display: 'block' }} />
}

export default function HeadSkin({ name, uuid, type, size = 32, radius = 8, theme = 'dark', style }) {
  const username = String(name || '').trim()
  const key = `${providerOf(type)}|${uuid || ''}|${username.toLowerCase()}`
  const [skin, setSkin] = useState(() => memory.get(key) || '')
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    const cached = memory.get(key)
    if (cached !== undefined) {
      setSkin(cached)
      setIdx(0)
      return undefined
    }
    if (!uuid && !username) {
      memory.set(key, '')
      setSkin('')
      return undefined
    }
    let alive = true
    api
      .resolveSkin({ uuid, name: username, provider: providerOf(type) })
      .then((res) => {
        const next = res?.data || ''
        memory.set(key, next)
        if (alive) {
          setSkin(next)
          setIdx(0)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [key, uuid, username, type])

  const sources = []
  if (skin) sources.push({ skin })
  if (username && /^[A-Za-z0-9_]{3,16}$/.test(username)) sources.push({ url: `https://crafthead.net/avatar/${encodeURIComponent(username)}` })
  if (uuid) sources.push({ url: `https://crafthead.net/avatar/${uuid}` })
  if (username && /^[A-Za-z0-9_]{3,16}$/.test(username)) sources.push({ url: `https://minotar.net/avatar/${encodeURIComponent(username)}/${Math.max(32, Math.round(size * 2))}` })

  const current = sources[idx]
  const isLight = theme === 'light'
  const initial = (username || uuid || '?').trim().charAt(0).toUpperCase() || '?'

  return (
    <span
      className="relative inline-flex items-center justify-center overflow-hidden shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: isLight ? '#f0eff0' : '#0d0d10',
        border: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'}`,
        ...style,
      }}
    >
      {current && current.skin && <CropHead skin={current.skin} size={size} />}
      {current && current.url && (
        <img
          key={current.url}
          src={current.url}
          alt=""
          draggable={false}
          onError={() => setIdx((value) => value + 1)}
          style={{ width: size, height: size, objectFit: 'cover', imageRendering: 'pixelated', display: 'block' }}
        />
      )}
      {!current && (
        <span
          className="w-full h-full flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #fb923c, #ea580c)', color: '#fff', fontSize: Math.round(size * 0.42), fontWeight: 700 }}
        >
          {initial}
        </span>
      )}
    </span>
  )
}
