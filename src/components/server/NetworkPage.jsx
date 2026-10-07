import { useState } from 'react'
import { Plus, Trash, Network } from '@phosphor-icons/react'

export default function NetworkPage({ server, theme, lang }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'

  const [allocations] = useState(server?.allocations || [{ ip: '0.0.0.0', port: server?.port || 25565 }])

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-bold" style={{ color: textColor }}>{lang === 'vi' ? 'Cổng mạng' : 'Network / Allocations'}</h2>
        <div className="flex-1" />
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: '#8b5cf6', color: '#fff' }}>
          <Plus size={13} weight="duotone" /> {lang === 'vi' ? 'Thêm port' : 'Add allocation'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {allocations.map((a, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-2" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}` }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#22c55e20' }}>
              <Network size={14} weight="duotone" style={{ color: '#22c55e' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold font-mono" style={{ color: textColor }}>{a.ip}:{a.port}</p>
              <p className="text-[10px]" style={{ color: labelColor }}>TCP/UDP</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
