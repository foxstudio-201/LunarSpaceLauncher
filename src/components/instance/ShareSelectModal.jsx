import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CaretDown, CaretRight, Check, Minus, FolderSimple, FileArrowUp, X, ShareNetwork,
  ArrowsClockwise, WarningCircle,
} from '@phosphor-icons/react'
import { palette } from '../../lib/palette'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

const TONES = {
  mod: '#a78bfa',
  config: '#60a5fa',
  script: '#f59e0b',
  data: '#34d399',
  pack: '#22d3ee',
  world: '#fb7185',
  other: '#94a3b8',
}

const SHARE_DEFAULT = new Set(['mods', 'config', 'defaultconfigs', 'scripts', 'kubejs', 'datapacks', 'global_packs', 'resourcepacks', 'shaderpacks'])
const SKIP_FILE = /\.(disabled|log|tmp|part|lock)$/i

function usable(files) {
  return (files || []).filter((file) => !SKIP_FILE.test(file.rel) && !/\.zip\.txt$/i.test(file.rel))
}

export default function ShareSelectModal({ open, instance, theme, lang, initial, onClose, onContinue }) {
  const c = palette(theme)
  const [entries, setEntries] = useState([])
  const [children, setChildren] = useState({})
  const [expanded, setExpanded] = useState(() => new Set())
  const [sel, setSel] = useState(() => new Set(initial || []))
  const [walked, setWalked] = useState({})
  const [busyRel, setBusyRel] = useState('')
  const [booting, setBooting] = useState(true)
  const [error, setError] = useState('')
  const cache = useRef(new Map())

  const filesOf = useCallback(async (rel) => {
    if (cache.current.has(rel)) return cache.current.get(rel)
    const res = await api.serverpackWalk({ id: instance.id, rel }).catch(() => null)
    const files = usable(res?.files)
    cache.current.set(rel, files)
    setWalked((prev) => ({ ...prev, [rel]: files.length }))
    return files
  }, [instance.id])

  const loadDir = useCallback(async (rel) => {
    if (children[rel]) return
    setBusyRel(rel)
    const res = await api.instanceTree({ id: instance.id, rel }).catch(() => null)
    setBusyRel('')
    if (res?.ok) setChildren((prev) => ({ ...prev, [rel]: res.entries || [] }))
  }, [instance.id, children])

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    setBooting(true)
    setError('')
    ;(async () => {
      const res = await api.instanceTree({ id: instance.id }).catch((err) => ({ ok: false, error: err.message }))
      if (!alive) return
      if (!res?.ok) {
        setError(res?.error || 'error')
        setBooting(false)
        return
      }
      const rows = res.entries || []
      setEntries(rows)
      if (!initial || !initial.length) {
        const picks = rows.filter((row) => row.dir && SHARE_DEFAULT.has(row.name))
        const picked = []
        for (const row of picks) {
          const files = await filesOf(row.rel)
          if (!alive) return
          picked.push(...files)
        }
        setSel(new Set(picked.map((file) => file.rel)))
      }
      setBooting(false)
    })()
    return () => { alive = false }
  }, [open, instance.id])

  const counts = useMemo(() => {
    const map = {}
    for (const rel of sel) {
      const parts = rel.split('/')
      let acc = ''
      for (let i = 0; i < parts.length - 1; i += 1) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i]
        map[acc] = (map[acc] || 0) + 1
      }
    }
    return map
  }, [sel])

  const rows = useMemo(() => {
    const out = []
    const visit = (list, depth, tone) => {
      for (const entry of list) {
        out.push({ ...entry, depth, tone: entry.tone || tone || 'other' })
        if (entry.dir && expanded.has(entry.rel) && children[entry.rel]) {
          visit(children[entry.rel], depth + 1, entry.tone || tone)
        }
      }
    }
    visit(entries, 0, 'other')
    return out
  }, [entries, children, expanded])

  if (!open) return null

  const toggleOpen = async (rel) => {
    if (expanded.has(rel)) {
      setExpanded((prev) => {
        const next = new Set(prev)
        for (const key of [...next]) if (key === rel || key.startsWith(`${rel}/`)) next.delete(key)
        return next
      })
      return
    }
    await loadDir(rel)
    setExpanded((prev) => new Set([...prev, rel]))
  }

  const stateOf = (rel) => {
    const picked = counts[rel] || 0
    const total = walked[rel]
    if (!picked) return 'off'
    if (total != null) return picked >= total ? 'on' : 'partial'
    return 'partial'
  }

  const toggleFolder = async (rel) => {
    const files = await filesOf(rel)
    const state = stateOf(rel)
    setSel((prev) => {
      const next = new Set(prev)
      for (const file of files) {
        if (state === 'on') next.delete(file.rel)
        else next.add(file.rel)
      }
      return next
    })
  }

  const toggleFile = (rel) => {
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(rel)) next.delete(rel)
      else next.add(rel)
      return next
    })
  }

  const clearAll = () => setSel(new Set())

  const Box = ({ state, onClick }) => (
    <button
      type="button"
      onClick={onClick}
      className="w-[15px] h-[15px] rounded-[4px] flex items-center justify-center shrink-0"
      style={{
        background: state === 'off' ? c.input : c.accent,
        border: `1px solid ${state === 'off' ? c.border : c.accent}`,
        color: '#0b0b0f',
      }}
    >
      {state === 'on' ? <Check size={10} weight="bold" /> : state === 'partial' ? <Minus size={10} weight="bold" /> : null}
    </button>
  )

  const total = sel.size

  return (
    <div className="modal-backdrop fixed inset-0 z-[215] flex items-center justify-center p-4" onClick={() => { if (!booting) onClose?.() }}>
      <div
        className="modal-content w-full max-w-[720px] max-h-[88vh] rounded-2xl flex flex-col overflow-hidden"
        style={{ background: c.surface, border: `1px solid ${c.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${c.border}` }}>
          <ShareNetwork size={15} weight="duotone" style={{ color: c.accent }} />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold truncate" style={{ color: c.text }}>
              {vn(lang, 'Chọn nội dung chia sẻ', 'Choose what to share')}
            </p>
            <p className="text-[10px] truncate" style={{ color: c.faint }}>
              {instance.name} · {vn(lang, 'chỉ những tệp được chọn mới nằm trong gói chia sẻ', 'only selected files are included')}
            </p>
          </div>
          <button onClick={() => { if (!booting) onClose?.() }} className="w-6 h-6 rounded-md flex items-center justify-center" style={{ color: c.faint }}>
            <X size={13} weight="bold" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {error && (
            <div className="m-2 px-3 py-2 rounded-lg text-[11px] flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>
              <WarningCircle size={13} /> {error}
            </div>
          )}
          {booting ? (
            <div className="h-40 flex items-center justify-center gap-2 text-[11px]" style={{ color: c.label }}>
              <ArrowsClockwise size={14} className="animate-spin" />
              {vn(lang, 'Đang quét tệp…', 'Scanning files…')}
            </div>
          ) : (
            rows.map((row) => {
              const tone = TONES[row.tone] || TONES.other
              const isOpen = expanded.has(row.rel)
              const state = row.dir ? stateOf(row.rel) : (sel.has(row.rel) ? 'on' : 'off')
              const totalFiles = walked[row.rel]
              return (
                <div
                  key={row.rel}
                  className="flex items-center gap-2 h-8 rounded-lg px-1.5"
                  style={{ paddingLeft: 6 + row.depth * 14 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = c.hover }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {row.dir ? (
                    <button type="button" onClick={() => toggleOpen(row.rel)} className="w-5 h-5 flex items-center justify-center shrink-0" style={{ color: c.faint }}>
                      {busyRel === row.rel ? <ArrowsClockwise size={11} className="animate-spin" /> : isOpen ? <CaretDown size={11} weight="bold" /> : <CaretRight size={11} weight="bold" />}
                    </button>
                  ) : (
                    <span className="w-5 shrink-0" />
                  )}
                  <Box state={state} onClick={() => (row.dir ? toggleFolder(row.rel) : toggleFile(row.rel))} />
                  {row.dir ? (
                    <FolderSimple size={14} weight="duotone" style={{ color: tone }} className="shrink-0" />
                  ) : (
                    <FileArrowUp size={13} weight="duotone" style={{ color: c.faint }} className="shrink-0" />
                  )}
                  <span className="text-[11px] truncate flex-1 min-w-0" style={{ color: row.dir ? c.text : c.label }}>{row.name}</span>
                  {row.tag ? (
                    <span className="h-[16px] px-1.5 rounded text-[9px] font-semibold shrink-0" style={{ background: `${tone}22`, color: tone }}>
                      {lang === 'vi' ? row.tag : (row.tagEn || row.tag)}
                    </span>
                  ) : null}
                  {row.dir && (totalFiles != null || counts[row.rel]) ? (
                    <span className="text-[9px] font-mono shrink-0" style={{ color: c.faint }}>
                      {counts[row.rel] || 0}/{totalFiles != null ? totalFiles : '?'}
                    </span>
                  ) : null}
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: `1px solid ${c.border}` }}>
          <span className="text-[10px] font-mono" style={{ color: c.label }}>
            {vn(lang, 'Đã chọn', 'Selected')} <b style={{ color: c.text }}>{total}</b> {vn(lang, 'tệp', 'files')}
          </span>
          <button onClick={clearAll} className="h-7 px-2.5 rounded-md text-[10px] font-semibold" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
            {vn(lang, 'Bỏ chọn', 'Clear')}
          </button>
          <div className="flex-1" />
          <button onClick={() => { if (!booting) onClose?.() }} className="h-8 px-3 rounded-lg text-[11px] font-semibold" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
            {vn(lang, 'Huỷ', 'Cancel')}
          </button>
          <button
            onClick={() => onContinue?.([...sel])}
            disabled={booting || !total}
            className="h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-40"
            style={{ background: c.accent, color: '#0b0b0f' }}
          >
            <ShareNetwork size={13} weight="bold" />
            {vn(lang, 'Tiếp tục', 'Continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
