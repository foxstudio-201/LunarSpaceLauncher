import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, CaretDown, CaretRight, FloppyDisk, ArrowCounterClockwise, ArrowClockwise, MagnifyingGlass,
  Cube, Users, Database, FileArrowDown, Plus, X, WarningCircle, CheckCircle, Trash, Hash,
  ArrowsOutLineVertical, ArrowsInLineVertical, Copy, Clipboard, ShieldCheck,
  ArrowsDownUp, ArrowLineUp, ArrowLineDown, Keyboard, SidebarSimple,
} from '@phosphor-icons/react'
import { palette } from '../../lib/palette'
import { formatBytes } from '../../lib/status'
import * as api from '../../api/client.js'
import {
  walk, stepPath, parentOf, childIndexOf, expandChain, newTag, cloneNode, coerceScalar,
  defaultFor, countOf, summaryOf, snbtValue, snbtParseValue, isContainer, isArrayType, ARRAYS,
  ARRAY_ELEMENT, CONTAINERS, PRIMITIVES, ALL_TYPES, typeLabel, TYPE_TONE, num,
} from '../../lib/nbt'
import { TypeChip, Field, TextField, Drop, Empty } from './nbt/kit'
import { TABS, PanelFor } from './nbt/panels'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)
const join = (base, key) => (base ? stepPath(base, key) : key)

const GROUPS = [
  { key: 'level', label: 'Cấp thế giới', labelEn: 'Level', icon: Cube, test: (rel) => rel.startsWith('level.dat') },
  { key: 'playerdata', label: 'Người chơi', labelEn: 'Players', icon: Users, test: (rel) => rel.startsWith('playerdata/') },
  { key: 'data', label: 'Dữ liệu', labelEn: 'Data', icon: Database, test: (rel) => rel.startsWith('data/') || rel.includes('/data/') },
]

const QUICK_PATHS = [
  'Data|GameRules', 'Data|WorldBorder', 'Data|WorldGenSettings', 'Data|DataPacks', 'Data|Player',
  'Data|Player|Inventory', 'Data|Player|Attributes', 'Data|Player|ActiveEffects', 'Data|Player|EnderItems',
  'Data|ScheduledEvents', 'Data|CustomBossEvents', 'Data|DragonFight', 'Inventory', 'Attributes', 'ActiveEffects',
]

const GRID = 'minmax(170px, 1fr) 64px 150px'

function ArrayRows({ node, target, depth, index, env }) {
  const { c, lang, vn, mutate, hairline, limitAt, setLimitAt } = env
  const limit = limitAt[target] || 120
  const element = ARRAY_ELEMENT[node.type]
  return (
    <>
      <div className="grid gap-1.5 px-2 py-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', background: `${c.bar}66`, ...hairline }}>
        {(node.value || []).slice(0, limit).map((item, i) => (
          <div key={i} className="flex items-center gap-1 min-w-0">
            <span className="text-[10px] font-mono w-7 text-right shrink-0" style={{ color: c.faint }}>{i}</span>
            <input
              value={String(item)}
              onChange={(e) => mutate(() => { node.value[i] = coerceScalar(element, e.target.value) }, `arr:${target}:${i}`)}
              spellCheck={false}
              className="h-[24px] px-1.5 rounded text-[11.5px] font-mono outline-none w-full min-w-0"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: TYPE_TONE[node.type] }}
              aria-label={`${target}[${i}]`}
            />
            <button
              onClick={() => mutate(() => { node.value.splice(i, 1) })}
              title={vn(lang, 'Bỏ phần tử', 'Remove entry')}
              className="w-5 h-5 rounded flex items-center justify-center shrink-0"
              style={{ color: '#f87171' }}
            >
              <X size={11} weight="bold" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ paddingLeft: 28 + depth * 16, ...hairline }}>
        <button
          onClick={() => mutate(() => { node.value.push(0) })}
          className="h-7 px-2.5 rounded text-[11px] font-semibold inline-flex items-center gap-1.5"
          style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
        >
          <Plus size={11} weight="bold" />
          {vn(lang, 'Thêm phần tử', 'Append')}
        </button>
        {node.value.length > limit ? (
          <button
            onClick={() => setLimitAt((prev) => ({ ...prev, [target]: limit + 240 }))}
            className="h-7 px-2.5 rounded text-[11px] font-mono"
            style={{ color: c.accent }}
          >
            {vn(lang, `Hiện thêm (còn ${node.value.length - limit})`, `Show more (${node.value.length - limit} left)`)}
          </button>
        ) : null}
        <span className="text-[10px] font-mono" style={{ color: c.faint }}>{typeLabel(node.type)}</span>
      </div>
    </>
  )
}

function Row({ node, target, depth, index, env }) {
  const {
    c, lang, vn, tree, open, path, matchSet, found, limitAt, rowHover, hairline,
    mutate, ops, setPath, setOpen, setAddAsk, setLimitAt,
  } = env
  const expanded = open.has(target)
  const expandable = CONTAINERS.includes(node.type) || ARRAYS.includes(node.type)
  const isSelected = path === target
  const isMatch = matchSet.has(target)
  const isCurrentMatch = found.list[found.at] === target
  const count = countOf(node)
  const limit = limitAt[target] || 200
  const parent = walk(tree, parentOf(target))
  const position = childIndexOf(target, parent)
  const segment = String(target).split('|').pop()
  const label = index !== null ? `[${index}]` : node.name
  return (
    <>
      <div
        className="group grid items-center"
        data-nbt-selected={isSelected ? '1' : undefined}
        style={{
          gridTemplateColumns: GRID,
          minHeight: 30,
          ...hairline,
          background: isSelected ? `${c.accent}14` : isCurrentMatch ? 'rgba(251,191,36,0.12)' : isMatch ? `${c.accent}08` : 'transparent',
        }}
        onMouseEnter={(e) => { if (!isSelected && !isMatch) e.currentTarget.style.background = rowHover }}
        onMouseLeave={(e) => { if (!isSelected && !isMatch) e.currentTarget.style.background = 'transparent' }}
      >
        <div className="flex items-center gap-2 min-w-0" style={{ paddingLeft: 8 + depth * 16 }}>
          {expandable ? (
            <button
              onClick={() => setOpen((prev) => {
                const next = new Set(prev)
                if (next.has(target)) next.delete(target)
                else next.add(target)
                return next
              })}
              className="w-5 h-5 rounded flex items-center justify-center shrink-0"
              style={{ color: c.faint }}
            >
              {expanded ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <button
            onClick={() => setPath(target)}
            className="text-[12.5px] font-mono truncate text-left"
            style={{ color: expandable ? c.text : c.label }}
            title={target}
          >
            {label}
          </button>
          {expandable ? <span className="text-[10px] font-mono shrink-0" style={{ color: c.faint }}>{summaryOf(node)}</span> : null}
          {isCurrentMatch ? <span className="text-[10px] font-mono shrink-0" style={{ color: '#fbbf24' }}>•</span> : null}
        </div>
        <span className="flex items-center gap-1.5">
          <TypeChip type={node.type} />
        </span>
        <div className="relative flex items-center pr-2 min-w-0">
          {PRIMITIVES.includes(node.type) && node.type !== 'string' ? (
            <input
              value={String(node.value ?? '')}
              onChange={(e) => mutate(() => { node.value = coerceScalar(node.type, e.target.value) }, `val:${target}`)}
              spellCheck={false}
              className="w-full h-[24px] px-1.5 rounded bg-transparent outline-none text-[12.5px] font-mono focus:bg-black/20 min-w-0"
              style={{ color: TYPE_TONE[node.type] || c.text, border: '1px solid transparent' }}
              aria-label={target}
            />
          ) : ARRAYS.includes(node.type) ? (
            <span className="text-[12px] font-mono truncate" style={{ color: c.faint }}>{count}</span>
          ) : null}
          <div
            className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pl-3 py-0.5"
            style={{ background: `linear-gradient(to right, transparent, ${c.bar} 22%)` }}
          >
            {CONTAINERS.includes(node.type) ? (
              <button onClick={() => setAddAsk({ parent: target, isList: node.type === 'list' })} title={vn(lang, 'Thêm tag con', 'Add child tag')} className="w-5 h-5 rounded flex items-center justify-center" style={{ color: c.label, background: c.bar, border: `1px solid ${c.border}` }}>
                <Plus size={12} weight="bold" />
              </button>
            ) : null}
            <button onClick={() => ops.copy(target)} title={vn(lang, 'Sao chép SNBT (F3)', 'Copy SNBT (F3)')} className="w-5 h-5 rounded flex items-center justify-center" style={{ color: c.label, background: c.bar, border: `1px solid ${c.border}` }}>
              <Copy size={11} weight="bold" />
            </button>
            <button onClick={() => ops.duplicate(target)} title={vn(lang, 'Nhân bản (F4)', 'Duplicate (F4)')} className="w-5 h-5 rounded flex items-center justify-center" style={{ color: c.label, background: c.bar, border: `1px solid ${c.border}` }}>
              <ArrowsDownUp size={11} weight="bold" />
            </button>
            <button
              onClick={() => ops.move(target, -1)}
              disabled={position <= 0}
              title={vn(lang, 'Lên', 'Up')}
              className="w-5 h-5 rounded flex items-center justify-center disabled:opacity-25"
              style={{ color: c.label, background: c.bar, border: `1px solid ${c.border}` }}
            >
              <ArrowLineUp size={11} weight="bold" />
            </button>
            <button
              onClick={() => ops.move(target, 1)}
              disabled={position < 0 || position >= countOf(parent) - 1}
              title={vn(lang, 'Xuống', 'Down')}
              className="w-5 h-5 rounded flex items-center justify-center disabled:opacity-25"
              style={{ color: c.label, background: c.bar, border: `1px solid ${c.border}` }}
            >
              <ArrowLineDown size={11} weight="bold" />
            </button>
            <button onClick={() => ops.remove(target)} title={vn(lang, 'Xoá tag (Delete)', 'Remove tag (Delete)')} className="w-5 h-5 rounded flex items-center justify-center" style={{ color: '#f87171', background: c.bar, border: `1px solid rgba(248,113,113,0.35)` }}>
              <X size={12} weight="bold" />
            </button>
          </div>
        </div>
      </div>
      {expanded && ARRAYS.includes(node.type) ? <ArrayRows node={node} target={target} depth={depth} env={env} /> : null}
      {expanded && CONTAINERS.includes(node.type) ? (node.value || []).slice(0, limit).map((child, i) => (
        <Row
          key={`${target}#${i}`}
          node={child}
          target={node.type === 'list' ? stepPath(target, `#${i}`) : stepPath(target, child.name)}
          depth={depth + 1}
          index={node.type === 'list' ? i : null}
          env={env}
        />
      )) : null}
      {expanded && CONTAINERS.includes(node.type) && count > limit ? (
        <button
          onClick={() => setLimitAt((prev) => ({ ...prev, [target]: limit + 400 }))}
          className="w-full text-left text-[11.5px] font-mono py-1.5"
          style={{ paddingLeft: 28 + depth * 16, color: c.accent, ...hairline }}
        >
          {vn(lang, `Hiện thêm 400 mục (còn ${count - limit})`, `Show 400 more (${count - limit} left)`)}
        </button>
      ) : null}
    </>
  )
}

export default function WorldEditorPage({ instance, world, theme, lang, onClose }) {
  const c = palette(theme)
  const [info, setInfo] = useState(null)
  const [file, setFile] = useState('level.dat')
  const [tree, setTree] = useState(null)
  const [version, setVersion] = useState(0)
  const [open, setOpen] = useState(() => new Set(['']))
  const [path, setPath] = useState('')
  const [query, setQuery] = useState('')
  const [found, setFound] = useState({ list: [], at: -1, needle: '' })
  const [dirty, setDirty] = useState(0)
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState(null)
  const [askDiscard, setAskDiscard] = useState(false)
  const [limitAt, setLimitAt] = useState({})
  const [addAsk, setAddAsk] = useState(null)
  const [clip, setClip] = useState(null)
  const [tab, setTab] = useState('quick')
  const [closing, setClosing] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const searchRef = useRef(null)
  const lastPush = useRef({ key: '', time: 0 })

  const bump = () => setVersion((value) => value + 1)

  const loadInfo = useCallback(async () => {
    const res = await api.worldTree({ id: instance.id, world }).catch((err) => ({ ok: false, error: err.message }))
    if (res?.ok) setInfo(res.world)
    else setNote({ tone: 'bad', text: res?.error || 'error' })
    return res
  }, [instance.id, world])

  const loadFile = useCallback(async (rel) => {
    setLoading(true)
    setNote(null)
    const res = await api.worldRead({ id: instance.id, world, file: rel }).catch((err) => ({ ok: false, error: err.message }))
    setLoading(false)
    if (!res?.ok) {
      setTree(null)
      setNote({ tone: 'bad', text: res?.error || 'error' })
      return
    }
    setTree(res.root)
    setFile(rel)
    setDirty(0)
    setPast([])
    setFuture([])
    setPath('')
    const seed = new Set([''])
    const first = (res.root.value || []).find((node) => node.type === 'compound')
    if (first) seed.add(first.name)
    setOpen(seed)
    setQuery('')
    setFound({ list: [], at: -1, needle: '' })
  }, [instance.id, world])

  useEffect(() => { loadInfo() }, [loadInfo])
  useEffect(() => { loadFile('level.dat') }, [loadFile])

  const pushHistory = (key) => {
    if (!tree) return
    const now = Date.now()
    if (key && key === lastPush.current.key && now - lastPush.current.time < 1200) {
      lastPush.current.time = now
      return
    }
    lastPush.current = { key, time: now }
    setPast((prev) => [...prev.slice(-24), structuredClone(tree)])
    setFuture([])
  }

  const mutate = useCallback((fn, key) => {
    if (!tree) return
    pushHistory(key)
    try {
      fn()
    } catch (err) {
      setNote({ tone: 'bad', text: err.message })
      return
    }
    setDirty((value) => value + 1)
    bump()
  }, [tree])

  const undo = () => {
    if (!past.length) return
    const previous = past[past.length - 1]
    setFuture((prev) => [...prev, structuredClone(tree)])
    setPast((prev) => prev.slice(0, -1))
    setTree(previous)
    setDirty((value) => Math.max(0, value - 1))
    setNote(null)
    bump()
  }

  const redo = () => {
    if (!future.length) return
    const next = future[future.length - 1]
    setPast((prev) => [...prev, structuredClone(tree)])
    setFuture((prev) => prev.slice(0, -1))
    setTree(next)
    setDirty((value) => value + 1)
    setNote(null)
    bump()
  }

  const ops = useMemo(() => ({
    get: (target) => walk(tree, target),
    jump: (target) => {
      setOpen((prev) => new Set([...prev, ...expandChain(target)]))
      setPath(target)
    },
    mutate,
    mark: () => { setDirty((value) => value + 1); bump() },
    ensure: (base, key, type, value) => mutate(() => {
      let parent = walk(tree, base)
      if (!parent) {
        if (!base) return
        let node = tree
        let acc = ''
        for (const segment of String(base).split('|')) {
          const nextPath = join(acc, segment)
          let child = walk(tree, nextPath)
          if (!child) {
            if (!Array.isArray(node.value)) return
            child = newTag('compound', segment, [])
            node.value.push(child)
          }
          node = child
          acc = nextPath
        }
        parent = node
      }
      if (!Array.isArray(parent.value)) return
      const existing = parent.value.find((item) => item.name === key)
      const next = value === undefined ? defaultFor(type) : value
      if (existing) {
        existing.type = type
        existing.value = next
      } else {
        parent.value.push(newTag(type, key, next))
      }
    }, `ensure:${join(base, key)}`),
    toggle: (base, key) => mutate(() => {
      const parent = walk(tree, base)
      if (!parent || !Array.isArray(parent.value)) return
      const existing = parent.value.find((item) => item.name === key)
      if (existing) existing.value = num(existing.value) ? 0 : 1
      else parent.value.push(newTag('byte', key, 1))
    }, `toggle:${join(base, key)}`),
    setScalar: (target, raw) => mutate(() => {
      const node = walk(tree, target)
      if (node) node.value = coerceScalar(node.type, raw)
    }, `val:${target}`),
    setValue: (target, value) => mutate(() => {
      const node = walk(tree, target)
      if (node) node.value = value
    }, `set:${target}`),
    remove: (target) => {
      mutate(() => {
        const parentPath = parentOf(target)
        const parent = walk(tree, parentPath)
        if (!parent || !Array.isArray(parent.value)) return
        const index = childIndexOf(target, parent)
        if (index < 0) return
        parent.value.splice(index, 1)
      })
      if (path === target || path.startsWith(`${target}|`)) setPath(parentOf(target))
    },
    rename: (target, name) => {
      const trimmed = String(name || '').trim()
      if (!trimmed) return
      mutate(() => {
        const parent = walk(tree, parentOf(target))
        const node = walk(tree, target)
        if (!parent || !node) return
        if (parent.type !== 'compound') throw new Error(vn(lang, 'Chỉ tag con của compound mới có tên khoá.', 'Only compound children have key names.'))
        if (parent.value.some((item) => item !== node && item.name === trimmed)) throw new Error(vn(lang, `Khoá “${trimmed}” đã tồn tại.`, `Key “${trimmed}” already exists.`))
        node.name = trimmed
      })
      if (path === target) setPath(join(parentOf(target), trimmed))
    },
    duplicate: (target) => mutate(() => {
      const parent = walk(tree, parentOf(target))
      if (!parent || !Array.isArray(parent.value)) return
      const index = childIndexOf(target, parent)
      const source = parent.value[index]
      if (!source) return
      const copy = cloneNode(source)
      if (parent.type === 'compound') {
        const taken = new Set(parent.value.map((item) => item.name))
        let name = `${source.name}_copy`
        let counter = 2
        while (taken.has(name)) {
          name = `${source.name}_copy${counter}`
          counter += 1
        }
        copy.name = name
      }
      parent.value.splice(index + 1, 0, copy)
    }),
    move: (target, delta) => {
      mutate(() => {
        const parent = walk(tree, parentOf(target))
        if (!parent || !Array.isArray(parent.value)) return
        const index = childIndexOf(target, parent)
        const next = index + delta
        if (index < 0 || next < 0 || next >= parent.value.length) return
        const [item] = parent.value.splice(index, 1)
        parent.value.splice(next, 0, item)
      })
      const parentPath = parentOf(target)
      const segment = String(target).split('|').pop() || ''
      if (segment.startsWith('#')) {
        const next = Number(segment.slice(1)) + delta
        if (path === target) setPath(stepPath(parentPath, `#${next}`))
      } else if (path === target) {
        const parent = walk(tree, parentPath)
        const index = childIndexOf(target, parent) + delta
        if (parent && parent.value[index]) setPath(stepPath(parentPath, parent.value[index].name))
      }
    },
    copy: (target) => {
      const node = walk(tree, target)
      if (!node) return
      setClip(cloneNode(node))
      navigator.clipboard?.writeText(snbtValue(node)).catch(() => {})
      setNote({ tone: 'ok', text: vn(lang, `Đã sao chép “${node.name || target}” vào clipboard.`, `Copied “${node.name || target}” to the clipboard.`) })
    },
    pasteInto: (target) => {
      if (!clip) return
      mutate(() => {
        const parent = walk(tree, target)
        if (!parent || !Array.isArray(parent.value)) throw new Error(vn(lang, 'Chỉ dán được vào compound hoặc list.', 'Paste target must be a compound or list.'))
        const copy = cloneNode(clip)
        if (parent.type === 'list' && parent.value.length && parent.value[0].type !== copy.type) parent.value = []
        if (parent.type === 'compound') {
          copy.name = copy.name || 'tag'
          const taken = new Set(parent.value.map((item) => item.name))
          if (taken.has(copy.name)) {
            let name = `${copy.name}_copy`
            let counter = 2
            while (taken.has(name)) {
              name = `${copy.name}_copy${counter}`
              counter += 1
            }
            copy.name = name
          }
        }
        parent.value.push(copy)
      })
    },
    pasteOver: (target) => {
      if (!clip) return
      mutate(() => {
        const node = walk(tree, target)
        if (!node) return
        const copy = cloneNode(clip)
        node.type = copy.type
        node.value = copy.value
      })
    },
    applySnbt: (target, text) => mutate(() => {
      const node = walk(tree, target)
      if (!node) return
      const parsed = snbtParseValue(text)
      node.type = parsed.type
      node.value = parsed.value
    }),
  }), [tree, mutate, lang, clip, path])

  useEffect(() => {
    if (!path) return
    const timer = setTimeout(() => {
      const node = document.querySelector('[data-nbt-selected="1"]')
      node?.scrollIntoView({ block: 'nearest' })
    }, 40)
    return () => clearTimeout(timer)
  }, [path])

  const runSearch = (from = 0) => {
    const needle = query.trim().toLowerCase()
    if (!needle || !tree) {
      setFound({ list: [], at: -1, needle: '' })
      return
    }
    const [keyPart, valuePart] = needle.includes('=') ? needle.split('=') : [needle, null]
    const results = []
    const scan = (node, target) => {
      if (results.length > 600) return
      const children = Array.isArray(node.value) ? node.value : []
      children.forEach((child, index) => {
        if (typeof child !== 'object') return
        const childPath = node.type === 'list' ? stepPath(target, `#${index}`) : stepPath(target, child.name)
        const nameHit = keyPart ? String(child.name || '').toLowerCase().includes(keyPart) : false
        const valueHit = valuePart !== null && !isContainer(child.type)
          ? String(child.value ?? '').toLowerCase().includes(valuePart)
          : false
        if (nameHit || valueHit) results.push(childPath)
        if (CONTAINERS.includes(child.type)) scan(child, childPath)
      })
    }
    scan(tree, '')
    setFound({ list: results, at: results.length ? from % results.length : -1, needle })
    if (results.length) {
      setNote(null)
      ops.jump(results[from % results.length])
    } else {
      setNote({ tone: 'bad', text: vn(lang, `Không thấy khoá nào khớp “${query}”.`, `No key matches “${query}”.`) })
    }
  }

  const stepFind = (delta) => {
    if (!found.list.length) return
    const at = (found.at + delta + found.list.length) % found.list.length
    setFound((prev) => ({ ...prev, at }))
    ops.jump(found.list[at])
  }

  const save = async () => {
    if (!tree || saving) return
    setSaving(true)
    setNote(null)
    const res = await api.worldWrite({ id: instance.id, world, file, root: tree }).catch((err) => ({ ok: false, error: err.message }))
    setSaving(false)
    if (!res?.ok) {
      setNote({ tone: 'bad', text: res?.error || 'error' })
      return
    }
    setDirty(0)
    setPast([])
    setFuture([])
    setNote({ tone: 'ok', text: vn(lang, `Đã ghi ${file} · ${formatBytes(res.bytes)} · bản sao ${res.backup}`, `Wrote ${file} · ${formatBytes(res.bytes)} · backup ${res.backup}`) })
    loadInfo()
  }

  const restore = async () => {
    setNote(null)
    const res = await api.worldRestore({ id: instance.id, world, file }).catch((err) => ({ ok: false, error: err.message }))
    if (!res?.ok) {
      setNote({ tone: 'bad', text: res?.error || 'error' })
      return
    }
    setNote({ tone: 'ok', text: vn(lang, `Đã khôi phục ${file} từ bản sao.`, `Restored ${file} from backup.`) })
    loadFile(file)
    loadInfo()
  }

  const shutdown = () => {
    setClosing(true)
    setTimeout(() => onClose(), 170)
  }

  const attemptClose = () => {
    if (closing) return
    if (dirty) setAskDiscard(true)
    else shutdown()
  }

  useEffect(() => {
    const onKey = (event) => {
      const tag = (event.target?.tagName || '').toLowerCase()
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select'
      const meta = event.ctrlKey || event.metaKey
      if (meta && event.key.toLowerCase() === 'z' && !(tag === 'textarea')) {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (meta && event.key.toLowerCase() === 'y' && !(tag === 'textarea')) {
        event.preventDefault()
        redo()
        return
      }
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault()
        save()
        return
      }
      if (meta && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key === 'Delete' && !typing && path) ops.remove(path)
      if (event.key === 'F3' && !typing && path) ops.copy(path)
      if (event.key === 'F4' && !typing && path) ops.duplicate(path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const rootData = useMemo(() => (tree ? (tree.value || []).find((node) => node.name === 'Data') : null), [tree])
  const dataPath = rootData ? 'Data' : null
  const playerBase = useMemo(() => {
    if (!tree) return null
    if (walk(tree, 'Data|Player')) return 'Data|Player'
    const root = tree.value || []
    if (['Health', 'foodLevel', 'Inventory', 'XpLevel'].some((key) => root.some((node) => node.name === key))) return ''
    return null
  }, [tree])

  const grouped = useMemo(() => {
    const files = info?.files || []
    return GROUPS.map((group) => ({
      ...group,
      items: files.filter((item) => group.test(item.rel)),
    }))
  }, [info])

  const quickPaths = useMemo(() => {
    if (!tree) return []
    return QUICK_PATHS.filter((target) => walk(tree, target))
  }, [tree])

  const matchSet = useMemo(() => new Set(found.list), [found.list])
  const selectedNode = path ? walk(tree, path) : null

  const rowHover = theme === 'light' ? 'rgba(139,92,246,0.07)' : 'rgba(167,139,250,0.10)'
  const hairline = { borderBottom: `1px solid ${c.border}` }
  const env = {
    c, lang, vn, theme, tree, open, path, matchSet, found, limitAt, rowHover, hairline,
    mutate, ops, setPath, setOpen, setAddAsk, setLimitAt,
  }

  const crumbs = useMemo(() => {
    if (!path) return []
    const segments = String(path).split('|')
    const out = []
    let acc = ''
    for (const segment of segments) {
      acc = acc ? `${acc}|${segment}` : segment
      out.push({ target: acc, label: segment.startsWith('#') ? `[${segment.slice(1)}]` : segment })
    }
    return out
  }, [path])

  const ctx = {
    c,
    lang,
    vn,
    theme,
    ops,
    tree,
    file,
    world,
    info,
    dataPath,
    playerBase,
    selection: { path, node: selectedNode },
    version,
    dirty,
    clip,
    onRestore: restore,
  }

  return (
    <div className={`nbt-page h-full flex flex-col overflow-hidden ${closing ? 'closing' : ''}`} style={{ background: c.bg }}>
      <div className="shrink-0 flex items-center gap-3 px-4 h-14" style={{ borderBottom: `1px solid ${c.border}`, background: c.bar }}>
        <button onClick={attemptClose} title={vn(lang, 'Về danh sách', 'Back to worlds')} className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ color: c.label }}>
          <ArrowLeft size={17} weight="bold" />
        </button>
        <Cube size={19} weight="duotone" style={{ color: c.accent }} />
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold truncate" style={{ color: c.text }}>{info?.summary?.name || world}</p>
          <p className="text-[11px] font-mono truncate" style={{ color: c.faint }}>
            saves/{world} · {file} · {info ? `${info.files.length} NBT · ${info.players} ${vn(lang, 'người chơi', 'players')} · ${formatBytes(info.bytes)}${info.partial ? '+' : ''}` : '…'}
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={undo}
          disabled={!past.length}
          title={vn(lang, 'Hoàn tác (Ctrl+Z)', 'Undo (Ctrl+Z)')}
          className="h-8 px-2.5 rounded-md text-[11.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-30"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
        >
          <ArrowCounterClockwise size={14} weight="bold" />
          {past.length}
        </button>
        <button
          onClick={redo}
          disabled={!future.length}
          title={vn(lang, 'Làm lại (Ctrl+Y)', 'Redo (Ctrl+Y)')}
          className="h-8 px-2.5 rounded-md text-[11.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-30"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
        >
          <ArrowClockwise size={14} weight="bold" />
          {future.length}
        </button>
        <span className="hidden xl:flex items-center gap-1.5 text-[11px] font-mono" style={{ color: info?.summary?.version ? c.label : c.faint }}>
          <Hash size={13} /> {info?.summary?.version || '—'}
        </span>
        {dirty ? (
          <span className="h-8 px-2.5 rounded-md text-[11.5px] font-bold inline-flex items-center gap-1.5 whitespace-nowrap" style={{ background: 'rgba(251,191,36,0.14)', color: '#fbbf24' }}>
            {dirty} {vn(lang, 'thay đổi chưa ghi', 'unsaved')}
          </span>
        ) : null}
      </div>

      {info?.running && (
        <div className="shrink-0 px-4 py-2.5 flex items-start gap-2" style={{ background: 'rgba(251,191,36,0.10)', borderBottom: '1px solid rgba(251,191,36,0.28)' }}>
          <WarningCircle size={15} weight="duotone" style={{ color: '#fbbf24' }} className="mt-0.5 shrink-0" />
          <p className="text-[11.5px] leading-relaxed" style={{ color: '#fbbf24' }}>
            {vn(lang, 'Phiên bản này đang chạy. Hãy thoát game trước khi ghi NBT, nếu không thế giới có thể bị ghi đè hoặc hỏng.', 'This instance is running. Quit the game before writing NBT, otherwise the world can be overwritten or corrupted.')}
          </p>
        </div>
      )}

      {note && (
        <div className="shrink-0 px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: `1px solid ${c.border}`, background: note.tone === 'ok' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)' }}>
          {note.tone === 'ok' ? <CheckCircle size={14} weight="fill" style={{ color: '#22c55e' }} /> : <WarningCircle size={14} weight="duotone" style={{ color: '#f87171' }} />}
          <span className="text-[11.5px] truncate" style={{ color: note.tone === 'ok' ? '#22c55e' : '#f87171' }}>{note.text}</span>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <aside className="w-[224px] shrink-0 flex flex-col overflow-y-auto" style={{ borderRight: `1px solid ${c.border}`, background: c.bar }}>
          {grouped.map((group) => (
            <div key={group.key} className="py-1.5">
              <p className="px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: c.faint }}>
                <group.icon size={13} weight="duotone" />
                {lang === 'vi' ? group.label : group.labelEn}
              </p>
              {group.items.length === 0 ? (
                <p className="px-3.5 pb-1 text-[11px] font-mono" style={{ color: c.faint }}>—</p>
              ) : group.items.map((item) => {
                const on = file === item.rel
                const hasBackup = !!item.bak
                return (
                  <button
                    key={item.rel}
                    onClick={() => { if (dirty) setAskDiscard({ next: item.rel }); else loadFile(item.rel) }}
                    className="w-full text-left px-3.5 py-[7px] flex items-center gap-2"
                    style={{ background: on ? `${c.accent}1a` : 'transparent', borderLeft: `3px solid ${on ? c.accent : 'transparent'}` }}
                  >
                    <FileArrowDown size={13} weight="duotone" style={{ color: on ? c.accent : c.faint }} />
                    <span className="text-[11.5px] font-mono truncate flex-1" style={{ color: on ? c.text : c.label }} title={item.rel}>
                      {item.rel.replace(/^playerdata\//, '')}
                    </span>
                    {hasBackup ? <ShieldCheck size={12} weight="duotone" style={{ color: '#4ade80' }} title={vn(lang, 'Có bản sao .bak', 'Has .bak backup')} /> : null}
                    <span className="text-[10px] font-mono shrink-0" style={{ color: c.faint }}>{formatBytes(item.size)}</span>
                  </button>
                )
              })}
            </div>
          ))}
          {quickPaths.length ? (
            <div className="py-1.5 mt-auto" style={{ borderTop: `1px solid ${c.border}` }}>
              <p className="px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: c.faint }}>
                {vn(lang, 'Nhảy nhanh', 'Quick jump')}
              </p>
              <div className="px-3.5 pb-2.5 flex flex-wrap gap-1.5">
                {quickPaths.map((target) => (
                  <button
                    key={target}
                    onClick={() => ops.jump(target)}
                    className="h-7 px-2 rounded text-[10.5px] font-mono truncate max-w-full"
                    style={{ background: path === target ? `${c.accent}22` : c.input, border: `1px solid ${c.border}`, color: path === target ? c.accent : c.label }}
                  >
                    {target.replace(/\|/g, '.')}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="shrink-0 flex items-center gap-2 px-3.5 h-12" style={{ borderBottom: `1px solid ${c.border}` }}>
            <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto">
              <button onClick={() => setPath('')} className="text-[11.5px] font-mono shrink-0" style={{ color: c.accent }}>{file}</button>
              {crumbs.map((crumb) => (
                <span key={crumb.target} className="flex items-center gap-1.5 shrink-0">
                  <CaretRight size={11} weight="bold" style={{ color: c.faint }} />
                  <button onClick={() => ops.jump(crumb.target)} className="text-[11.5px] font-mono" style={{ color: c.label }}>{crumb.label}</button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 h-8 px-2.5 rounded-md shrink-0" style={{ background: c.input, border: `1px solid ${c.border}` }}>
              <MagnifyingGlass size={14} style={{ color: c.faint }} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runSearch(0) }}
                placeholder={vn(lang, 'khoá hoặc =giá trị', 'key or =value')}
                className="w-44 bg-transparent outline-none text-[11.5px] font-mono"
                style={{ color: c.text }}
              />
              {found.list.length ? (
                <span className="text-[10.5px] font-mono shrink-0" style={{ color: '#fbbf24' }}>{found.at + 1}/{found.list.length}</span>
              ) : null}
            </div>
            <button
              onClick={() => runSearch(0)}
              className="h-8 px-3 rounded-md text-[11.5px] font-semibold shrink-0"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
            >
              {vn(lang, 'Tìm', 'Find')}
            </button>
            <button
              onClick={() => stepFind(-1)}
              disabled={!found.list.length}
              title={vn(lang, 'Kết quả trước', 'Previous match')}
              className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 disabled:opacity-30"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
            >
              <CaretRight size={13} weight="bold" className="rotate-180" />
            </button>
            <button
              onClick={() => stepFind(1)}
              disabled={!found.list.length}
              title={vn(lang, 'Kết quả sau', 'Next match')}
              className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 disabled:opacity-30"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
            >
              <CaretRight size={13} weight="bold" />
            </button>
            <button
              onClick={() => setOpen(new Set(['', ...(tree ? (tree.value || []).map((node) => node.name) : [])]))}
              title={vn(lang, 'Mở cấp 1', 'Expand one level')}
              className="h-8 w-8 rounded-md flex items-center justify-center shrink-0"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
            >
              <ArrowsOutLineVertical size={13} weight="bold" />
            </button>
            <button
              onClick={() => setOpen(new Set(['']))}
              title={vn(lang, 'Thu gọn tất cả', 'Collapse all')}
              className="h-8 w-8 rounded-md flex items-center justify-center shrink-0"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
            >
              <ArrowsInLineVertical size={13} weight="bold" />
            </button>
            <button
              onClick={() => ops.copy(path || '')}
              disabled={!selectedNode}
              title={vn(lang, 'Sao chép SNBT tag đang chọn (F3)', 'Copy selected SNBT (F3)')}
              className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 disabled:opacity-30"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
            >
              <Copy size={13} weight="bold" />
            </button>
            <button
              onClick={() => (isContainer(selectedNode?.type) ? ops.pasteInto(path) : ops.pasteOver(path))}
              disabled={!clip || !selectedNode}
              title={vn(lang, 'Dán clipboard vào/thay tag đang chọn', 'Paste clipboard into/over selection')}
              className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 disabled:opacity-30"
              style={{ background: clip ? `${c.accent}22` : c.input, border: `1px solid ${c.border}`, color: clip ? c.accent : c.label }}
            >
              <Clipboard size={13} weight="bold" />
            </button>
            <button
              onClick={() => setPanelOpen((value) => !value)}
              title={vn(lang, panelOpen ? 'Thu gọn bảng bên phải' : 'Mở bảng bên phải', panelOpen ? 'Collapse right panel' : 'Show right panel')}
              className="h-8 w-8 rounded-md flex items-center justify-center shrink-0"
              style={{ background: panelOpen ? c.input : `${c.accent}22`, border: `1px solid ${c.border}`, color: panelOpen ? c.label : c.accent }}
            >
              <SidebarSimple size={13} weight="bold" />
            </button>
          </div>

          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 overflow-y-auto" style={{ opacity: loading ? 0.5 : 1 }}>
              <div className="grid items-center px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider sticky top-0 z-10" style={{ gridTemplateColumns: GRID, background: c.bar, color: c.faint, borderBottom: `1px solid ${c.border}` }}>
                <span className="pl-1">{vn(lang, 'Khoá', 'Key')}</span>
                <span className="pl-1">{vn(lang, 'Kiểu', 'Type')}</span>
                <span>{vn(lang, 'Giá trị', 'Value')}</span>
              </div>
              {tree ? (tree.value || []).map((node, i) => (
                <Row key={`root#${i}`} node={node} target={node.name} depth={0} index={null} env={env} />
              )) : (
                <p className="px-4 py-8 text-[12.5px] font-mono" style={{ color: c.label }}>{loading ? vn(lang, 'Đang đọc NBT…', 'Reading NBT…') : '—'}</p>
              )}
            </div>

            {panelOpen ? (
            <aside className="w-[330px] shrink-0 flex flex-col" style={{ borderLeft: `1px solid ${c.border}`, background: c.bar }}>
              <div className="shrink-0 grid grid-cols-4 gap-1 p-1.5" style={{ borderBottom: `1px solid ${c.border}` }}>
                {TABS.map((item) => {
                  const on = tab === item.key
                  return (
                    <button
                      key={item.key}
                      onClick={() => setTab(item.key)}
                      title={item.label}
                      className="h-11 rounded-md flex flex-col items-center justify-center gap-0.5"
                      style={{ background: on ? `${c.accent}1f` : 'transparent', border: `1px solid ${on ? `${c.accent}55` : 'transparent'}`, color: on ? c.accent : c.label }}
                    >
                      <item.icon size={16} weight="duotone" />
                      <span className="text-[9.5px] font-semibold">{item.label}</span>
                    </button>
                  )
                })}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-3">
                <PanelFor tab={tab} ctx={ctx} />
              </div>
              {clip ? (
                <div className="shrink-0 px-3 py-2 flex items-center gap-2 text-[10.5px] font-mono" style={{ borderTop: `1px solid ${c.border}`, color: c.faint }}>
                  <Clipboard size={12} />
                  {vn(lang, 'Clipboard', 'Clipboard')}: {clip.name || typeLabel(clip.type)} · {typeLabel(clip.type)}
                  <span className="flex-1" />
                  <button onClick={() => setClip(null)} style={{ color: '#f87171' }}>{vn(lang, 'bỏ', 'clear')}</button>
                </div>
              ) : null}
            </aside>
            ) : null}
          </div>

          <div className="shrink-0 flex items-center gap-2 px-4 h-14" style={{ borderTop: `1px solid ${c.border}`, background: c.bar }}>
            {selectedNode ? (
              <span className="text-[11.5px] font-mono truncate" style={{ color: c.faint }}>
                {String(path).replace(/\|/g, ' › ')} = {CONTAINERS.includes(selectedNode.type) || isArrayType(selectedNode.type) ? summaryOf(selectedNode) : String(selectedNode.value).slice(0, 48)}
              </span>
            ) : (
              <span className="hidden xl:inline-flex text-[11.5px] font-mono items-center gap-2" style={{ color: c.faint }}>
                <Keyboard size={14} />
                {vn(lang, 'Ctrl+Z · Ctrl+S · Ctrl+F · Delete · F3 · F4', 'Ctrl+Z · Ctrl+S · Ctrl+F · Delete · F3 · F4')}
              </span>
            )}
            <span className="flex-1" />
            <button
              onClick={() => loadFile(file)}
              disabled={loading || saving}
              className="h-9 px-3.5 rounded-lg text-[12px] font-semibold inline-flex items-center gap-2 disabled:opacity-50"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
            >
              <ArrowCounterClockwise size={14} weight="bold" />
              {vn(lang, 'Đọc lại', 'Reload')}
            </button>
            <button
              onClick={attemptClose}
              className="h-9 px-3.5 rounded-lg text-[12px] font-semibold"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
            >
              {vn(lang, 'Đóng', 'Close')}
            </button>
            <button
              onClick={save}
              disabled={!tree || saving || !dirty}
              className="h-9 px-4 rounded-lg text-[12px] font-bold inline-flex items-center gap-2 disabled:opacity-50"
              style={{ background: c.accent, color: c.ink }}
            >
              <FloppyDisk size={15} weight="bold" />
              {saving ? vn(lang, 'Đang ghi…', 'Writing…') : vn(lang, 'Ghi vào thế giới', 'Write to world')}
            </button>
          </div>
        </div>
      </div>

      {addAsk ? (
        <div className="modal-backdrop fixed inset-0 z-[220] flex items-center justify-center p-6" onClick={() => setAddAsk(null)}>
          <div className="modal-content w-full max-w-[400px] rounded-2xl overflow-hidden" style={{ background: c.surface, border: `1px solid ${c.border}` }} onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${c.border}` }}>
              <Plus size={16} weight="duotone" style={{ color: c.accent }} />
              <p className="text-[13px] font-bold flex-1" style={{ color: c.text }}>
                {addAsk.isList ? vn(lang, 'Thêm phần tử vào list', 'Add list entry') : vn(lang, 'Thêm tag con', 'Add child tag')}
              </p>
              <button onClick={() => setAddAsk(null)} style={{ color: c.faint }}><X size={15} weight="bold" /></button>
            </div>
            <div className="p-4">
              <AddTagForm
                c={c}
                theme={theme}
                lang={lang}
                isList={addAsk.isList}
                parentPath={addAsk.parent}
                onCancel={() => setAddAsk(null)}
                onSubmit={(node, target) => {
                  mutate(() => {
                    const parent = walk(tree, target)
                    if (!parent) return
                    if (parent.type === 'list' && parent.value.length && parent.value[0].type !== node.type) parent.value = []
                    parent.value.push(node)
                  })
                  setOpen((prev) => new Set([...prev, target]))
                  setAddAsk(null)
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {askDiscard ? (
        <div className="modal-backdrop fixed inset-0 z-[220] flex items-center justify-center p-6" onClick={() => setAskDiscard(false)}>
          <div className="modal-content w-full max-w-[460px] rounded-2xl overflow-hidden" style={{ background: c.surface, border: `1px solid ${c.border}` }} onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${c.border}` }}>
              <WarningCircle size={16} weight="duotone" style={{ color: '#f59e0b' }} />
              <p className="text-[13px] font-bold flex-1" style={{ color: c.text }}>
                {vn(lang, 'Bỏ thay đổi chưa ghi?', 'Discard unsaved changes?')}
              </p>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-[12px] leading-relaxed" style={{ color: c.label }}>
                {vn(lang, `${dirty} thay đổi trong ${file} chưa được ghi. Nếu tiếp tục, chúng sẽ mất.`, `${dirty} change(s) in ${file} are not written yet. Continuing discards them.`)}
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setAskDiscard(false)}
                  className="h-9 px-3.5 rounded-lg text-[12px] font-semibold"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                >
                  {vn(lang, 'Ở lại', 'Stay')}
                </button>
                <button
                  onClick={() => {
                    const next = askDiscard.next
                    setAskDiscard(false)
                    if (next) loadFile(next)
                    else shutdown()
                  }}
                  className="h-9 px-4 rounded-lg text-[12px] font-bold"
                  style={{ background: '#ef4444', color: '#fff' }}
                >
                  {vn(lang, 'Bỏ thay đổi', 'Discard')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AddTagForm({ c, theme, lang, isList, parentPath, onSubmit, onCancel }) {
  const vn = (l, vi, en) => (l === 'vi' ? vi : en)
  const [type, setType] = useState('string')
  const [name, setName] = useState('newTag')
  const [value, setValue] = useState('')
  const build = () => {
    const entry = newTag(type, isList ? '' : name || 'newTag', undefined)
    if (PRIMITIVES.includes(type)) entry.value = coerceScalar(type, value)
    return entry
  }
  return (
    <div className="flex flex-col gap-3">
      <Field c={c} label={vn(lang, 'Kiểu tag', 'Tag type')}>
        <Drop
          c={c}
          theme={theme}
          value={type}
          onChange={setType}
          options={ALL_TYPES.map((item) => ({ value: item, label: typeLabel(item), tone: TYPE_TONE[item] }))}
        />
      </Field>
      {!isList ? (
        <Field c={c} label={vn(lang, 'Tên khoá', 'Key name')}>
          <TextField c={c} value={name} onChange={setName} />
        </Field>
      ) : null}
      {PRIMITIVES.includes(type) ? (
        <Field c={c} label={vn(lang, 'Giá trị đầu', 'Initial value')}>
          <TextField c={c} value={value} onChange={setValue} placeholder={type === 'string' ? '' : '0'} />
        </Field>
      ) : null}
      {type === 'list' || type === 'compound' ? (
        <Empty c={c}>{vn(lang, 'Tag rỗng — mở nó trong cây rồi thêm tiếp.', 'Empty container — open it in the tree to fill.')}</Empty>
      ) : null}
      {ARRAYS.includes(type) ? <Empty c={c}>{vn(lang, 'Mảng rỗng — sửa từng phần tử trong bảng Nhanh.', 'Empty array — edit entries in the Quick panel.')}</Empty> : null}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="h-9 px-3.5 rounded-lg text-[12px] font-semibold"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
        >
          {vn(lang, 'Huỷ', 'Cancel')}
        </button>
        <button
          onClick={() => onSubmit(build(), parentPath)}
          className="h-9 px-4 rounded-lg text-[12px] font-bold"
          style={{ background: c.accent, color: c.ink }}
        >
          {vn(lang, 'Thêm', 'Add')}
        </button>
      </div>
    </div>
  )
}
