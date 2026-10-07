import { useState } from 'react'
import { Plus, Trash, Copy } from '@phosphor-icons/react'

const isElectron = typeof window !== 'undefined' && window.electronAPI

export default function DatabasePage({ server, theme, lang }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'

  const [databases, setDatabases] = useState(server?.databases || [])
  const [showCreate, setShowCreate] = useState(false)
  const [newDb, setNewDb] = useState({ name: '', user: '', pass: '' })
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(null)

  const copy = (text, key) => { navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500) }

  const handleCreate = async () => {
    if (!isElectron || !newDb.name) return
    setError('')
    try {
      const res = await window.electronAPI.databaseSetup(newDb.name, newDb.user || newDb.name, newDb.pass)
      if (res?.ok) {
        setDatabases(prev => [...prev, { name: newDb.name, user: newDb.user || newDb.name, host: '127.0.0.1', port: 5432 }])
        setShowCreate(false)
        setNewDb({ name: '', user: '', pass: '' })
      } else if (res?.error) {
        setError(res.error)
      }
    } catch (err) {
      setError(err?.message || '')
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-bold" style={{ color: textColor }}>{lang === 'vi' ? 'Cơ sở dữ liệu' : 'Databases'}</h2>
        <div className="flex-1" />
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: '#8b5cf6', color: '#fff' }}>
          <Plus size={13} weight="duotone" /> {lang === 'vi' ? 'Tạo mới' : 'Create'}
        </button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
          {error}
        </div>
      )}

      {showCreate && (
        <div className="mb-4 p-3 rounded-xl" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}` }}>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <input value={newDb.name} onChange={e => setNewDb({...newDb, name: e.target.value})} placeholder="Database name" className="px-3 py-1.5 rounded-lg text-[11px] outline-none" style={{ background: theme === 'light' ? '#fff' : '#1a1a1a', border: `1px solid ${borderColor}`, color: textColor }} />
            <input value={newDb.user} onChange={e => setNewDb({...newDb, user: e.target.value})} placeholder="User" className="px-3 py-1.5 rounded-lg text-[11px] outline-none" style={{ background: theme === 'light' ? '#fff' : '#1a1a1a', border: `1px solid ${borderColor}`, color: textColor }} />
            <input value={newDb.pass} onChange={e => setNewDb({...newDb, pass: e.target.value})} placeholder="Password" className="px-3 py-1.5 rounded-lg text-[11px] outline-none" style={{ background: theme === 'light' ? '#fff' : '#1a1a1a', border: `1px solid ${borderColor}`, color: textColor }} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-3 py-1 rounded-lg text-[11px] font-semibold" style={{ background: '#22c55e', color: '#fff' }}>{lang === 'vi' ? 'Tạo' : 'Create'}</button>
            <button onClick={() => setShowCreate(false)} className="px-3 py-1 rounded-lg text-[11px] font-semibold" style={{ background: borderColor, color: labelColor }}>{lang === 'vi' ? 'Hủy' : 'Cancel'}</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {databases.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <span className="text-[11px]" style={{ color: labelColor }}>{lang === 'vi' ? 'Chưa có database' : 'No databases yet'}</span>
          </div>
        ) : databases.map((db, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-2" style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${borderColor}` }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#8b5cf620' }}>
              <span className="text-[10px] font-bold" style={{ color: '#8b5cf6' }}>DB</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold truncate" style={{ color: textColor }}>{db.name}</p>
              <p className="text-[10px] truncate" style={{ color: labelColor }}>{db.user}@{db.host}:{db.port}</p>
            </div>
            <button onClick={() => copy(`${db.host}:${db.port}/${db.name}`, `db-${i}`)} className="p-1 rounded" style={{ color: copied === `db-${i}` ? '#22c55e' : labelColor }}>
              <Copy size={12} weight="duotone" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
