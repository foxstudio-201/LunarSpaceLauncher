import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft, ArrowUp, Folder, FolderOpen, ListBullets, Trash, PencilSimple,
  DotsThreeVertical, Check, FilePlus, FolderPlus, UploadSimple, Warning, FloppyDisk, CaretRight,
} from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import { fileIcon, sizeLabel, stampLabel } from '../../lib/files'
import * as api from '../../api/client.js'

function fill(lang, key, map) {
  let text = t(lang, key)
  for (const [k, v] of Object.entries(map)) text = text.split(`{${k}}`).join(String(v))
  return text
}

const LINE_HEIGHT = 20
const FONT_SIZE = 13
const MONO = 'ui-monospace, SFMono-Regular, "JetBrains Mono", "Fira Code", Menlo, Monaco, Consolas, monospace'
const GRID = '1fr 90px 140px 36px'
const INTERNAL_DND = 'application/x-lunar-files'

const isFileDrag = (dt) => !!dt && Array.from(dt.types || []).includes('Files')

export default function FilesPage({ instance, theme, lang }) {
  const c = palette(theme)
  const [rel, setRel] = useState('')
  const [entries, setEntries] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState([])
  const [pending, setPending] = useState(null)
  const [flash, setFlash] = useState(null)
  const [editor, setEditor] = useState(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [openErr, setOpenErr] = useState('')
  const [closeAsk, setCloseAsk] = useState(false)
  const [caret, setCaret] = useState(1)
  const [creating, setCreating] = useState(null)
  const [createName, setCreateName] = useState('')
  const [dropTarget, setDropTarget] = useState(null)
  const [osDragging, setOsDragging] = useState(false)
  const [busy, setBusy] = useState(0)
  const dragItem = useRef(null)
  const gutterRef = useRef(null)
  const textRef = useRef(null)

  const parts = rel ? rel.split('/') : []
  const hover = theme === 'light' ? 'rgba(139,92,246,0.08)' : 'rgba(167,139,250,0.12)'
  const hoverStrong = theme === 'light' ? 'rgba(139,92,246,0.14)' : 'rgba(167,139,250,0.18)'

  const load = useCallback(async (target) => {
    setLoading(true)
    setError('')
    try {
      const res = await api.listDir({ id: instance.id, rel: target })
      if (!res?.ok) {
        setError(res?.error || 'error')
        setEntries([])
      } else {
        setEntries(res.entries || [])
        setRel(res.rel || '')
      }
    } catch (err) {
      setError(err.message)
      setEntries([])
    }
    setLoading(false)
  }, [instance.id])

  useEffect(() => {
    load('')
  }, [load])

  useEffect(() => {
    let depth = 0
    const onEnter = (e) => {
      if (!isFileDrag(e.dataTransfer)) return
      depth += 1
      setOsDragging(true)
    }
    const onOver = (e) => {
      if (isFileDrag(e.dataTransfer)) e.preventDefault()
    }
    const onLeave = () => {
      depth = Math.max(0, depth - 1)
      if (!depth) setOsDragging(false)
    }
    const onEnd = () => {
      depth = 0
      setOsDragging(false)
    }
    document.addEventListener('dragenter', onEnter)
    document.addEventListener('dragover', onOver)
    document.addEventListener('dragleave', onLeave)
    document.addEventListener('drop', onEnd)
    document.addEventListener('dragend', onEnd)
    return () => {
      document.removeEventListener('dragenter', onEnter)
      document.removeEventListener('dragover', onOver)
      document.removeEventListener('dragleave', onLeave)
      document.removeEventListener('drop', onEnd)
      document.removeEventListener('dragend', onEnd)
    }
  }, [])

  const notify = (message, tone = 'ok') => {
    setFlash({ message, tone })
    setTimeout(() => setFlash(null), 2600)
  }

  const resetSelection = () => {
    setSelected([])
    setPending(null)
  }

  const go = (target) => {
    setMenu(null)
    setCreating(null)
    resetSelection()
    load(target)
  }

  const openFile = async (name) => {
    setMenu(null)
    const target = [rel, name].filter(Boolean).join('/')
    setOpenErr('')
    setSaveMsg(null)
    const res = await api.readFile({ id: instance.id, rel: target })
    const text = res?.ok ? String(res.text ?? '') : ''
    setEditor({ rel: target, name, original: text })
    setDraft(text)
    setCaret(1)
    setCloseAsk(false)
    if (!res?.ok) setOpenErr(res?.error || t(lang, 'files.openError'))
  }

  const closeEditor = () => {
    setEditor(null)
    setCloseAsk(false)
    setOpenErr('')
    setSaveMsg(null)
    load(rel)
  }

  const requestClose = () => {
    if (dirty) setCloseAsk(true)
    else closeEditor()
  }

  const dirty = !!editor && draft !== editor.original

  const save = async () => {
    if (!editor || saving) return
    setSaving(true)
    setSaveMsg(null)
    const res = await api.writeFile({ id: instance.id, rel: editor.rel, text: draft })
    setSaving(false)
    if (!res?.ok) {
      setSaveMsg({ tone: 'bad', text: res?.error || 'save failed' })
      setTimeout(() => setSaveMsg(null), 3000)
      return
    }
    setEditor((prev) => (prev ? { ...prev, original: draft } : prev))
    setSaveMsg({ tone: 'ok', text: t(lang, 'files.saved') })
    setTimeout(() => setSaveMsg(null), 2000)
  }

  const runTrash = async (targets) => {
    setPending(null)
    const rels = targets.map((name) => [rel, name].filter(Boolean).join('/'))
    const res = await api.trashFiles({ id: instance.id, rels })
    if (res?.failed?.length) notify(fill(lang, 'files.trashFailed', { n: res.failed.length }), 'bad')
    else notify(fill(lang, 'files.trashed', { n: res?.trashed ?? rels.length }))
    resetSelection()
    load(rel)
  }

  const submitCreate = async () => {
    const kind = creating
    const value = createName.trim()
    if (!kind || !value) return
    const res = await api.createEntry({ id: instance.id, rel, name: value, dir: kind === 'folder' })
    if (!res?.ok) return notify(res?.error || 'error', 'bad')
    setCreating(null)
    setCreateName('')
    notify(fill(lang, 'files.created', { name: res.name }))
    await load(rel)
    if (kind === 'file') openFile(res.name)
  }

  const importDrop = async (paths, destRel) => {
    if (!paths.length) return
    setBusy((n) => n + paths.length)
    const res = await api.importPaths({ id: instance.id, rel: destRel, paths })
    setBusy((n) => Math.max(0, n - paths.length))
    if (res?.failed?.length) notify(fill(lang, 'files.importFailed', { n: res.failed.length }), 'bad')
    else notify(fill(lang, 'files.imported', { n: res?.imported ?? paths.length }))
    load(rel)
  }

  const moveInto = async (item, destRel) => {
    const res = await api.moveEntry({
      id: instance.id,
      from: [rel, item.name].filter(Boolean).join('/'),
      toRel: destRel,
    })
    if (!res?.ok) return notify(res?.error || fill(lang, 'files.moveFailed', { name: item.name }), 'bad')
    notify(fill(lang, 'files.moved', { name: item.name }))
    load(rel)
  }

  const droppedPaths = (dataTransfer) =>
    Array.from(dataTransfer?.files || [])
      .map((file) => api.pathForFile(file))
      .filter(Boolean)

  const onContainerDrop = async (e) => {
    const item = dragItem.current
    dragItem.current = null
    setDropTarget(null)
    if (item) return undefined
    if (!isFileDrag(e.dataTransfer)) return undefined
    e.preventDefault()
    return importDrop(droppedPaths(e.dataTransfer), rel)
  }

  const onRowDragStart = (e, entry) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(INTERNAL_DND, entry.name)
    e.dataTransfer.setData('text/plain', entry.name)
    dragItem.current = { name: entry.name, dir: entry.dir }
  }

  const onRowDragOver = (e, entry) => {
    if (!entry.dir) return
    const internal = !!dragItem.current
    const external = isFileDrag(e.dataTransfer)
    if (!internal && !external) return
    if (internal && dragItem.current.name === entry.name) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = internal ? 'move' : 'copy'
    if (dropTarget !== entry.name) setDropTarget(entry.name)
  }

  const onRowDrop = async (e, entry) => {
    if (!entry.dir) return
    e.preventDefault()
    e.stopPropagation()
    const item = dragItem.current
    dragItem.current = null
    setDropTarget(null)
    const destRel = [rel, entry.name].filter(Boolean).join('/')
    if (item) {
      if (item.name === entry.name) return undefined
      return moveInto(item, destRel)
    }
    if (isFileDrag(e.dataTransfer)) return importDrop(droppedPaths(e.dataTransfer), destRel)
    return undefined
  }

  const toggleSelected = (name) => {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  const needle = query.trim().toLowerCase()
  const shown = needle ? entries.filter((entry) => String(entry.name || '').toLowerCase().includes(needle)) : entries
  const allSelected = shown.length > 0 && selected.every((name) => shown.some((entry) => entry.name === name))

  const toggleAll = () => setSelected(allSelected ? [] : entries.map((e) => e.name))

  const onRowClick = (entry) => {
    setMenu(null)
    if (selectMode) return toggleSelected(entry.name)
    if (entry.dir) return go([rel, entry.name].filter(Boolean).join('/'))
    return openFile(entry.name)
  }

  const reveal = (name) => {
    const target = [instance.dir, rel, name].filter(Boolean).join('\\')
    api.revealPath(target).catch(() => {})
  }

  const syncCaret = (el) => {
    const idx = el?.selectionStart ?? 0
    setCaret(draft.slice(0, idx).split('\n').length)
  }

  const syncGutter = () => {
    if (gutterRef.current && textRef.current) gutterRef.current.scrollTop = textRef.current.scrollTop
  }

  const onEditorKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      return save()
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.target
      const start = el.selectionStart
      const end = el.selectionEnd
      setDraft(`${draft.slice(0, start)}  ${draft.slice(end)}`)
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2
        syncGutter()
      })
    }
    return undefined
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (menu) return setMenu(null)
      if (pending) return setPending(null)
      if (creating) return setCreating(null)
      if (selectMode) return setSelectMode(false)
      return undefined
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, pending, creating, selectMode])

  useEffect(() => {
    if (selectMode) resetSelection()
  }, [selectMode])

  if (editor) {
    const lines = draft ? draft.split('\n').length : 1
    return (
      <div data-surface className="h-full flex flex-col overflow-hidden" style={{ background: c.bg }}>
        <div className="shrink-0 flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${c.border}`, background: c.bar }}>
          <button
            onClick={requestClose}
            title={t(lang, 'files.back')}
            className="p-1.5 rounded-md transition-colors shrink-0"
            style={{ color: c.label }}
            onMouseEnter={(e) => { e.currentTarget.style.background = hover; e.currentTarget.style.color = c.accent }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = c.label }}
          >
            <ArrowLeft size={15} weight="bold" />
          </button>
          <div className="flex items-center gap-1.5 min-w-0 flex-1 text-[11px] font-mono">
            <span style={{ color: c.label }}>~</span>
            {editor.rel.split('/').map((part, i, arr) => (
              <span key={i} className="flex items-center gap-1 min-w-0">
                <CaretRight size={10} style={{ color: c.label, opacity: 0.5 }} />
                <span className="truncate" style={{ color: i === arr.length - 1 ? c.text : c.accent }}>{part}</span>
              </span>
            ))}
          </div>
          {dirty && (
            <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}>
              ●
            </span>
          )}
          {saveMsg && (
            <span
              className="text-[10px] px-2 py-0.5 rounded shrink-0"
              style={{
                background: saveMsg.tone === 'bad' ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)',
                color: saveMsg.tone === 'bad' ? '#ef4444' : '#22c55e',
              }}
            >
              {saveMsg.text}
            </span>
          )}
          <span className="text-[10px] shrink-0" style={{ color: c.label }}>
            {lines} {t(lang, 'files.lines')}
          </span>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="flex items-center gap-1 px-3 py-1 rounded-md text-[11px] font-semibold transition-all hover:opacity-85 disabled:opacity-35 shrink-0"
            style={{ background: c.accent, color: '#12081f' }}
            title="Ctrl+S"
          >
            <FloppyDisk size={12} weight="fill" />
            {saving ? '…' : t(lang, 'files.save')}
          </button>
        </div>

        {openErr && (
          <div
            className="shrink-0 px-4 py-2 text-[11px] flex items-center gap-2"
            style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderBottom: '1px solid rgba(239,68,68,0.3)' }}
          >
            <Warning size={12} weight="duotone" /> {openErr}
            <button onClick={() => setOpenErr('')} className="ml-auto opacity-70 hover:opacity-100">✕</button>
          </div>
        )}

        {closeAsk && (
          <div
            className="shrink-0 px-4 py-2 flex items-center gap-3 text-[11px]"
            style={{ background: 'rgba(245,158,11,0.12)', borderBottom: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}
          >
            <Warning size={13} weight="duotone" />
            <span className="flex-1">{t(lang, 'files.closeConfirm')}</span>
            <button
              onClick={() => setCloseAsk(false)}
              className="h-7 px-2.5 rounded-md text-[10px] font-semibold"
              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
            >
              {t(lang, 'files.stay')}
            </button>
            <button
              onClick={closeEditor}
              className="h-7 px-2.5 rounded-md text-[10px] font-bold"
              style={{ background: '#ef4444', color: '#fff' }}
            >
              {t(lang, 'files.closeNoSave')}
            </button>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden relative">
          <div
            ref={gutterRef}
            aria-hidden
            className="shrink-0 select-none overflow-hidden text-right"
            style={{
              background: c.bar,
              color: c.label,
              borderRight: `1px solid ${c.border}`,
              minWidth: 56,
              padding: '12px 12px 12px 8px',
              fontFamily: MONO,
              fontSize: FONT_SIZE,
              lineHeight: `${LINE_HEIGHT}px`,
            }}
          >
            {Array.from({ length: lines }, (_, i) => (
              <div key={i} style={{ height: LINE_HEIGHT }}>{i + 1}</div>
            ))}
            <div style={{ height: 12 }} />
          </div>
          <textarea
            ref={textRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              requestAnimationFrame(syncGutter)
            }}
            onScroll={syncGutter}
            onClick={(e) => syncCaret(e.target)}
            onKeyUp={(e) => { syncCaret(e.target); syncGutter() }}
            onSelect={(e) => syncCaret(e.target)}
            onKeyDown={onEditorKeyDown}
            spellCheck={false}
            wrap="off"
            className="flex-1 w-full outline-none resize-none"
            style={{
              background: c.bg,
              color: c.text,
              caretColor: c.accent,
              fontFamily: MONO,
              fontSize: FONT_SIZE,
              lineHeight: `${LINE_HEIGHT}px`,
              padding: '12px 16px 12px 12px',
              border: 'none',
              whiteSpace: 'pre',
              overflowWrap: 'normal',
              tabSize: 2,
            }}
          />
        </div>

        <div className="shrink-0 px-4 py-1.5 flex items-center gap-3 text-[10px]" style={{ borderTop: `1px solid ${c.border}`, color: c.label, background: c.bar }}>
          <span>UTF-8</span>
          <span>LF</span>
          <span>Ln {caret}</span>
          <span>{dirty ? t(lang, 'files.unsaved') : t(lang, 'files.saved')}</span>
          <div className="flex-1" />
          <span>{t(lang, 'files.tabIndent')}</span>
          <span>{t(lang, 'files.ctrlSave')}</span>
        </div>
      </div>
    )
  }

  return (
    <div data-surface className="h-full flex flex-col overflow-hidden relative" style={{ background: c.bg }}>
      {osDragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div
            className="rounded-lg p-8 flex flex-col items-center gap-4"
            style={{ background: c.surface, border: `2px dashed ${c.accent}`, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
          >
            <UploadSimple size={56} weight="fill" style={{ color: c.accent }} />
            <p className="text-xl font-semibold" style={{ color: c.text }}>{t(lang, 'files.dropHere')}</p>
            <p className="text-sm" style={{ color: c.label }}>
              {t(lang, 'files.dropCopy')} {rel ? `${instance.name}/${rel}` : instance.name}
            </p>
          </div>
        </div>
      )}

      <div className="shrink-0 flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${c.border}`, background: c.bar }}>
        <button
          onClick={() => { setCreating('file'); setCreateName(''); setMenu(null) }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-opacity hover:opacity-85"
          style={{ background: c.accent, color: '#12081f' }}
        >
          <FilePlus size={13} weight="bold" />
          {t(lang, 'files.newFile')}
        </button>
        <button
          onClick={() => { setCreating('folder'); setCreateName(''); setMenu(null) }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold"
          style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.text }}
        >
          <FolderPlus size={13} weight="bold" />
          {t(lang, 'files.newFolder')}
        </button>
        <button
          onClick={() => load(rel)}
          title={t(lang, 'files.reloadList')}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium"
          style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
        >
          <ListBullets size={13} weight="bold" />
          {t(lang, 'files.reloadList')}
        </button>

        <div className="flex-1" />

        {flash && (
          <span
            className="text-[10px] px-2 py-0.5 rounded"
            style={{
              background: flash.tone === 'bad' ? 'rgba(239,68,68,0.2)' : hover,
              color: flash.tone === 'bad' ? '#ef4444' : c.accent,
            }}
          >
            {flash.message}
          </span>
        )}
        {busy > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
            {fill(lang, 'files.uploading', { n: busy })}
          </span>
        )}
        <span className="text-[10px]" style={{ color: c.label }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(lang, 'files.searchPlaceholder')}
          className="h-7 w-40 px-2 rounded-md text-[11px] outline-none"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
        />
          {entries.length} {t(lang, 'files.items')}
        </span>
        <button
          onClick={() => reveal('')}
          title={t(lang, 'files.reveal')}
          className="w-7 h-7 rounded-md flex items-center justify-center"
          style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
        >
          <FolderOpen size={14} weight="duotone" />
        </button>
        <button
          onClick={() => setSelectMode((v) => !v)}
          aria-pressed={selectMode}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold"
          style={{
            background: selectMode ? hover : c.surface,
            border: `1px solid ${selectMode ? 'rgba(167,139,250,0.42)' : c.border}`,
            color: selectMode ? c.accent : c.label,
          }}
        >
          <Check size={13} weight={selectMode ? 'bold' : 'regular'} />
          {selectMode ? t(lang, 'files.done') : t(lang, 'files.select')}
        </button>
      </div>

      <div className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 mx-3 mt-3 rounded-lg" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
        <button
          onClick={() => go('')}
          title="Root"
          className="text-[12px] font-bold px-1.5 py-0.5 rounded"
          style={{ color: c.accent }}
        >
          ~
        </button>
        {parts.map((part, i) => (
          <span key={i} className="flex items-center gap-1 min-w-0">
            <CaretRight size={11} style={{ color: c.label, opacity: 0.45 }} />
            <button
              onClick={() => go(parts.slice(0, i + 1).join('/'))}
              className="text-[12px] font-medium truncate max-w-[160px] px-1 py-0.5 rounded"
              style={{ color: i === parts.length - 1 ? c.text : c.accent }}
            >
              {part}
            </button>
          </span>
        ))}
      </div>

      {creating && (
        <div className="shrink-0 mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: c.surface, border: `1px solid ${c.accent}` }}>
          <span className="text-[11px] font-semibold shrink-0" style={{ color: c.text }}>
            {creating === 'file' ? t(lang, 'files.fileName') : t(lang, 'files.folderName')}
          </span>
          <input
            autoFocus
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate()
              if (e.key === 'Escape') { setCreating(null); setCreateName('') }
            }}
            className="flex-1 text-[12px] font-mono px-2 py-1 rounded outline-none"
            style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
            placeholder={creating === 'file' ? 'options.txt' : 'config'}
          />
          <button onClick={submitCreate} className="px-3 py-1 rounded-md text-[11px] font-semibold" style={{ background: c.accent, color: '#12081f' }}>
            {t(lang, 'files.create')}
          </button>
          <button onClick={() => { setCreating(null); setCreateName('') }} className="px-2 py-1 rounded-md text-[11px]" style={{ color: c.label }}>
            {t(lang, 'files.cancel')}
          </button>
        </div>
      )}

      {selectMode && (
        <div className="shrink-0 mx-3 mt-2 flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: hover, border: '1px solid rgba(167,139,250,0.28)' }}>
          <span className="text-[11px] font-semibold" style={{ color: c.accent }}>
            {selected.length} {t(lang, 'files.selected')}
          </span>
          <button onClick={toggleAll} className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
            {allSelected ? t(lang, 'files.clearAll') : t(lang, 'files.selectAll')}
          </button>
          <div className="flex-1" />
          <button
            disabled={!selected.length}
            onClick={() => setPending({ names: selected })}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold disabled:opacity-40"
            style={{ background: '#ef4444', color: '#fff' }}
          >
            <Trash size={12} weight="bold" />
            {t(lang, 'files.deleteSelected')}
          </button>
        </div>
      )}

      {pending && (
        <div className="shrink-0 mx-3 mt-2 flex items-center gap-3 px-3 py-2 rounded-lg text-[11px]" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
          <Warning size={13} weight="duotone" />
          <span className="flex-1">
            {pending.names.length === 1
              ? fill(lang, 'files.confirmTrashOne', { name: pending.names[0] })
              : fill(lang, 'files.confirmTrash', { n: pending.names.length })}
          </span>
          <button
            onClick={() => setPending(null)}
            className="px-2.5 py-1 rounded-md text-[10px] font-semibold"
            style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
          >
            {t(lang, 'files.cancel')}
          </button>
          <button
            onClick={() => runTrash(pending.names)}
            className="px-2.5 py-1 rounded-md text-[10px] font-bold"
            style={{ background: '#ef4444', color: '#fff' }}
          >
            {t(lang, 'files.toTrash')}
          </button>
        </div>
      )}

      <div
        className="shrink-0 mx-3 mt-3 grid items-center px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{
          gridTemplateColumns: GRID,
          background: c.bar,
          borderTop: `1px solid ${c.border}`,
          borderLeft: `1px solid ${c.border}`,
          borderRight: `1px solid ${c.border}`,
          borderBottom: 'none',
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          color: c.label,
        }}
      >
        <span>{t(lang, 'files.name')}</span>
        <span className="text-right">{t(lang, 'files.size')}</span>
        <span className="text-right">{t(lang, 'files.modified')}</span>
        <span className="flex justify-end">
          {selectMode && (
            <button
              onClick={toggleAll}
              aria-pressed={allSelected}
              className="w-4 h-4 rounded flex items-center justify-center"
              style={{ border: `1px solid ${allSelected ? c.accent : c.border}`, background: allSelected ? c.accent : 'transparent', color: '#12081f' }}
            >
              {allSelected && <Check size={11} weight="bold" />}
            </button>
          )}
        </span>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto mx-3 mb-3 rounded-b-lg"
        style={{ background: c.surface, borderLeft: `1px solid ${c.border}`, borderRight: `1px solid ${c.border}`, borderBottom: `1px solid ${c.border}`, borderTop: 'none' }}
        onDragOver={(e) => { if (isFileDrag(e.dataTransfer) || dragItem.current) e.preventDefault() }}
        onDrop={onContainerDrop}
        onScroll={() => (menu ? setMenu(null) : undefined)}
      >
        {parts.length > 0 && (
          <button
            onClick={() => go(parts.slice(0, -1).join('/'))}
            className="w-full flex items-center gap-3 px-3 py-2.5 transition-colors"
            style={{ borderBottom: `1px solid ${c.border}` }}
            onMouseEnter={(e) => { e.currentTarget.style.background = hover }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <ArrowUp size={14} weight="bold" style={{ color: c.label }} />
            <span className="text-[12px] font-medium" style={{ color: c.label }}>..</span>
          </button>
        )}
        {error ? (
          <div className="px-3 py-4 text-[11px]" style={{ color: '#ef4444' }}>{error}</div>
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-[12px]" style={{ color: c.label }}>{t(lang, 'home.loading')}</span>
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Folder size={28} weight="duotone" style={{ color: c.label, opacity: 0.4 }} />
            <span className="text-[12px]" style={{ color: c.label }}>{t(lang, 'instance.files.empty')}</span>
          </div>
        ) : (
          shown.map((entry) => {
            const isSelected = selected.includes(entry.name)
            const isMenu = menu?.name === entry.name
            const isDropHot = entry.dir && dropTarget === entry.name
            return (
              <div
                key={entry.name}
                draggable
                onDragStart={(e) => onRowDragStart(e, entry)}
                onDragEnd={() => { dragItem.current = null; setDropTarget(null) }}
                onDragOver={(e) => onRowDragOver(e, entry)}
                onDragLeave={() => { if (dropTarget === entry.name) setDropTarget(null) }}
                onDrop={(e) => onRowDrop(e, entry)}
                onClick={() => onRowClick(entry)}
                className="grid items-center px-3 cursor-pointer group"
                style={{
                  gridTemplateColumns: GRID,
                  minHeight: 41,
                  borderBottom: `1px solid ${c.border}`,
                  background: isDropHot ? hoverStrong : isSelected ? hover : 'transparent',
                  outline: isDropHot ? `1px solid ${c.accent}` : 'none',
                  outlineOffset: -1,
                }}
                onMouseEnter={(e) => { if (!isSelected && !isDropHot) e.currentTarget.style.background = hover }}
                onMouseLeave={(e) => { if (!isSelected && !isDropHot) e.currentTarget.style.background = 'transparent' }}
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  {fileIcon(entry.name, entry.dir, c.label)}
                  <span
                    className="text-[12px] font-medium truncate"
                    style={{ color: entry.disabled ? c.label : c.text, textDecoration: entry.disabled ? 'line-through' : 'none' }}
                  >
                    {entry.name}
                  </span>
                  {entry.disabled && (
                    <span className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0" style={{ background: c.input, color: c.label }}>
                      {t(lang, 'mods.disabled')}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-right font-mono" style={{ color: c.label }}>
                  {entry.dir ? '—' : sizeLabel(entry.size)}
                </span>
                <span className="text-[11px] text-right font-mono" style={{ color: c.label }}>
                  {stampLabel(entry.mtime)}
                </span>
                <div className="relative flex items-center justify-end">
                  {selectMode ? (
                    <button
                      aria-pressed={isSelected}
                      className="w-4 h-4 rounded flex items-center justify-center"
                      style={{ border: `1px solid ${isSelected ? c.accent : c.border}`, background: isSelected ? c.accent : 'transparent', color: '#12081f' }}
                    >
                      {isSelected && <Check size={11} weight="bold" />}
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenu(isMenu ? null : { name: entry.name, rect: e.currentTarget.getBoundingClientRect(), dir: entry.dir })
                      }}
                      title={t(lang, 'files.actions')}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: c.label }}
                    >
                      <DotsThreeVertical size={14} weight="bold" />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {menu && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setMenu(null)} />
          <div
            className="fixed rounded-md overflow-hidden shadow-xl py-0.5"
            style={{
              zIndex: 9999,
              left: Math.max(8, Math.min(menu.rect.right - 168, window.innerWidth - 176)),
              top: menu.rect.bottom + 4 + 104 > window.innerHeight ? undefined : menu.rect.bottom + 4,
              bottom: menu.rect.bottom + 4 + 104 > window.innerHeight ? window.innerHeight - menu.rect.top + 4 : undefined,
              width: 168,
              background: c.surface,
              border: `1px solid ${c.border}`,
            }}
          >
            {!menu.dir && (
              <button
                onClick={() => openFile(menu.name)}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left"
                style={{ color: c.text }}
                onMouseEnter={(e) => { e.currentTarget.style.background = hover }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <PencilSimple size={13} /> {t(lang, 'files.edit')}
              </button>
            )}
            <button
              onClick={() => { reveal(menu.name); setMenu(null) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left"
              style={{ color: c.text }}
              onMouseEnter={(e) => { e.currentTarget.style.background = hover }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <FolderOpen size={13} /> {t(lang, 'files.reveal')}
            </button>
            <button
              onClick={() => { setPending({ names: [menu.name] }); setMenu(null) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left"
              style={{ color: '#ef4444' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <Trash size={13} /> {t(lang, 'files.toTrash')}
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
