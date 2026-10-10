import { useState, useEffect, useRef, useCallback } from 'react'
import {
  File, Folder, ArrowLeft, ArrowUp, Trash, Plus, FilePlus, FolderPlus,
  FloppyDisk, Warning, CaretRight, ListBullets, DotsThreeVertical, Download, PencilSimple,
  UploadSimple, MagnifyingGlass, X,
} from '@phosphor-icons/react'
import useVirtual from '../ui/useVirtual'

const isElectron = typeof window !== 'undefined' && window.electronAPI

const EDITOR_BG = '#1e1e1e'
const GUTTER_BG = '#1e1e1e'
const GUTTER_TEXT = '#6e7681'
const EDITOR_TEXT = '#d4d4d4'
const BORDER = '#2d2d2d'
const BLUE = '#228be6'
const BLUE_LIGHT = 'rgba(34, 139, 230, 0.15)'
const GREEN = '#22c55e'
const YELLOW = '#eab308'
const RED = '#ef4444'
const FONT_MONO = 'ui-monospace, SFMono-Regular, "JetBrains Mono", "Fira Code", Menlo, Monaco, Consolas, "Liberation Mono", monospace'
const LINE_HEIGHT = 20
const FONT_SIZE = 13

function formatSize(bytes) {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < 3) { size /= 1024; i++ }
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

function formatModified(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`
  } catch { return '—' }
}

function joinPath(dir, name) {
  const base = (dir || '/').replace(/\/+$/, '') || ''
  return `${base}/${name}`.replace(/\/+/g, '/')
}

function baseName(p) {
  const parts = String(p || '').split('/').filter(Boolean)
  return parts[parts.length - 1] || '/'
}

const INTERNAL_DND = 'application/x-terver-file-manager'

function dataTransferHasFiles(dataTransfer) {
  if (!dataTransfer) return false
  return (
    Array.from(dataTransfer.types || []).includes('Files') ||
    Array.from(dataTransfer.items || []).some((item) => item.kind === 'file')
  )
}

function withUploadPath(file, relPath) {
  try {
    Object.defineProperty(file, 'webkitRelativePath', { configurable: true, value: relPath })
  } catch {}
  return file
}

function traverseDirectory(entry, out, pathPrefix = '') {
  return new Promise((resolve) => {
    const reader = entry.createReader()
    const readBatch = () => {
      reader.readEntries(
        async (entries) => {
          if (!entries.length) { resolve(); return }
          await Promise.all(
            entries.map((child) => {
              if (child.isFile) {
                return new Promise((resFile) => {
                  child.file((file) => {
                    out.push({ file: withUploadPath(file, `${pathPrefix}/${file.name}`), relPath: `${pathPrefix}/${file.name}` })
                    resFile()
                  }, () => resFile())
                })
              }
              return traverseDirectory(child, out, `${pathPrefix}/${child.name}`)
            }),
          )
          readBatch()
        },
        () => resolve(),
      )
    }
    readBatch()
  })
}

async function getDroppedFiles(dataTransfer) {
  const items = Array.from(dataTransfer.items || []).filter((item) => item.kind === 'file')
  const out = []
  for (const item of items) {
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
    const file = item.getAsFile()
    if (entry && entry.isDirectory) {
      await traverseDirectory(entry, out, entry.name)
    } else if (file) {
      const rel = file.webkitRelativePath || file.name
      out.push({ file, relPath: rel })
    }
  }
  if (out.length > 0) return out
  return Array.from(dataTransfer.files || []).map((file) => ({
    file,
    relPath: file.webkitRelativePath || file.name,
  }))
}

function useFileDragAndDrop({ onDrop, enabled = true }) {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)
  const dragResetTimerRef = useRef(null)
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop

  const resetDragState = useCallback(() => {
    if (dragResetTimerRef.current != null) {
      window.clearTimeout(dragResetTimerRef.current)
      dragResetTimerRef.current = null
    }
    dragCounterRef.current = 0
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (!enabled) { resetDragState(); return undefined }

    const scheduleDragReset = () => {
      if (dragResetTimerRef.current != null) window.clearTimeout(dragResetTimerRef.current)
      dragResetTimerRef.current = window.setTimeout(resetDragState, 750)
    }

    const handleDragEnter = (e) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current++
      if (dataTransferHasFiles(e.dataTransfer)) {
        setIsDragging(true)
        scheduleDragReset()
      }
    }

    const handleDragLeave = (e) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
      if (dragCounterRef.current === 0) resetDragState()
    }

    const handleDragOver = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (dataTransferHasFiles(e.dataTransfer)) scheduleDragReset()
    }

    const handleDrop = async (e) => {
      if (!e.dataTransfer) return
      const hasFiles = dataTransferHasFiles(e.dataTransfer)
      if (!hasFiles) return
      e.preventDefault()
      e.stopPropagation()
      resetDragState()
      try {
        const dropped = await getDroppedFiles(e.dataTransfer)
        if (dropped.length > 0) await onDropRef.current(dropped, null)
      } catch {}
    }

    const handleVisibility = () => { if (document.hidden) resetDragState() }

    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('drop', handleDrop)
    document.addEventListener('drop', resetDragState, true)
    document.addEventListener('dragend', resetDragState, true)
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('blur', resetDragState)
    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('drop', handleDrop)
      document.removeEventListener('drop', resetDragState, true)
      document.removeEventListener('dragend', resetDragState, true)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('blur', resetDragState)
      if (dragResetTimerRef.current != null) window.clearTimeout(dragResetTimerRef.current)
      dragResetTimerRef.current = null
      dragCounterRef.current = 0
    }
  }, [enabled, resetDragState])

  return { isDragging: enabled && isDragging }
}

function UploadDropOverlay({ visible, title, subtitle }) {
  if (!visible) return null
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
    >
      <div
        className="rounded-lg p-8 shadow-2xl"
        style={{
          background: '#161616',
          border: `2px dashed ${BLUE}`,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        }}
      >
        <div className="flex flex-col items-center gap-4">
          <span style={{ color: BLUE }}>
            <UploadSimple size={56} weight="fill" className="animate-bounce" />
          </span>
          <p className="text-xl font-semibold text-white">{title}</p>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

export default function FileManagerPage({ server, theme, lang }) {
  const isLight = theme === 'light'
  const textColor = isLight ? '#111' : '#fff'
  const labelColor = isLight ? '#555' : 'rgba(255,255,255,0.55)'
  const borderColor = isLight ? 'rgba(0,0,0,0.08)' : BORDER
  const surface = isLight ? '#f8f9fa' : '#161616'
  const surfaceHover = isLight ? 'rgba(34,139,230,0.08)' : BLUE_LIGHT
  const headerBg = isLight ? '#f0eff0' : '#111111'
  const bodyBg = isLight ? '#f0eff0' : '#0a0a0a'

  const [files, setFiles] = useState([])
  const [currentPath, setCurrentPath] = useState('/')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [contextFor, setContextFor] = useState(null)
  const [editingFile, setEditingFile] = useState(null)
  const [editContent, setEditContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [openErr, setOpenErr] = useState('')
  const [dirty, setDirty] = useState(false)
  const [actionMsg, setActionMsg] = useState('')
  const [showCreate, setShowCreate] = useState(null) // 'file' | 'folder'
  const [createName, setCreateName] = useState('')
  const [uploading, setUploading] = useState(0)
  const [dropTarget, setDropTarget] = useState(null) // folder name under cursor
  const [search, setSearch] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [closeAsk, setCloseAsk] = useState(false)
  const draggingRef = useRef(null) // internal drag: { name, isDir }
  const taRef = useRef(null)
  const gutterRef = useRef(null)

  const lineCount = editContent ? editContent.split('\n').length : 1

  const syncGutterScroll = useCallback(() => {
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop
    }
  }, [])

  const loadFiles = async (path) => {
    if (!isElectron) return
    setLoading(true)
    try {
      const res = await window.electronAPI.wingsListFiles(server.id, path)
      if (res?.files && Array.isArray(res.files)) setFiles(res.files)
      else setFiles([])
    } catch { setFiles([]) }
    setLoading(false)
  }

  useEffect(() => { loadFiles(currentPath); setSelected(null); setContextFor(null) }, [server?.id, currentPath])

  const filteredFiles = (() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return files
    return files.filter((f) => String(f.name || '').toLowerCase().includes(needle))
  })()
  const listRef = useRef(null)
  const rowsRef = useRef(null)
  const virtual = useVirtual({ containerRef: listRef, wrapRef: rowsRef, count: filteredFiles.length, rowHeight: 41, overscan: 6 })

  useEffect(() => {
    if (editingFile) {
      requestAnimationFrame(() => {
        if (taRef.current) taRef.current.scrollTop = 0
        if (gutterRef.current) gutterRef.current.scrollTop = 0
      })
    }
  }, [editingFile])

  const flash = (msg) => {
    setActionMsg(msg)
    setTimeout(() => setActionMsg(''), 2500)
  }

  const uploadDropped = useCallback(async (dropped, targetDir) => {
    if (!isElectron || !server?.id) return
    const destDir = targetDir != null ? targetDir : currentPath
    if (!dropped?.length) return
    setUploading((n) => n + dropped.length)
    let ok = 0
    let fail = 0
    for (const item of dropped) {
      const rel = item.relPath || item.file.webkitRelativePath || item.file.name
      const dest = joinPath(destDir, rel)
      try {
        const buf = await item.file.arrayBuffer()
        const res = await window.electronAPI.wingsUploadFile(server.id, dest, new Uint8Array(buf))
        if (res?.ok) ok += 1
        else fail += 1
      } catch { fail += 1 }
    }
    setUploading((n) => Math.max(0, n - dropped.length))
    loadFiles(currentPath)
    if (fail === 0) flash(lang === 'vi' ? `Đã tải lên ${ok} tệp` : `Uploaded ${ok} file${ok === 1 ? '' : 's'}`)
    else if (ok === 0) flash(lang === 'vi' ? 'Tải lên thất bại' : 'Upload failed')
    else flash(lang === 'vi' ? `Lên ${ok}, lỗi ${fail}` : `Uploaded ${ok}, failed ${fail}`)
  }, [server?.id, currentPath, lang])

  const { isDragging: dropOverlay } = useFileDragAndDrop({
    onDrop: uploadDropped,
    enabled: !editingFile && !!server?.id && !loading,
  })

  const handleFileDragStart = (e, f) => {
    if (dropOverlay) { e.preventDefault(); return }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(INTERNAL_DND, f.name)
    e.dataTransfer.setData('text/plain', f.name)
    draggingRef.current = { name: f.name, isDir: !!f.is_dir }
  }

  const handleFolderDragOver = (e, f) => {
    if (!f.is_dir) return
    const internal = draggingRef.current || e.dataTransfer.types.includes(INTERNAL_DND)
    const external = dataTransferHasFiles(e.dataTransfer)
    if (!internal && !external) return
    if (internal && draggingRef.current?.name === f.name) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = internal ? 'move' : 'copy'
    if (dropTarget !== f.name) setDropTarget(f.name)
  }

  const handleFolderDragLeave = (e, f) => {
    e.stopPropagation()
    if (dropTarget === f.name) setDropTarget(null)
  }

  const handleFolderDrop = async (e, f) => {
    if (!f.is_dir) return
    e.preventDefault()
    e.stopPropagation()
    const destDir = joinPath(currentPath, f.name)
    setDropTarget(null)

    const internal = e.dataTransfer.getData(INTERNAL_DND) || draggingRef.current?.name
    if (internal && internal !== f.name) {
      const from = joinPath(currentPath, internal)
      const to = joinPath(destDir, baseName(internal))
      try {
        const res = await window.electronAPI.wingsMoveFile(server.id, from, to)
        if (res?.ok) {
          loadFiles(currentPath)
          flash(lang === 'vi' ? 'Đã di chuyển' : 'Moved')
        } else {
          flash(res?.error || (lang === 'vi' ? 'Di chuyển thất bại' : 'Move failed'))
        }
      } catch (err) {
        flash(err.message || 'Move failed')
      }
      draggingRef.current = null
      return
    }

    if (dataTransferHasFiles(e.dataTransfer)) {
      const dropped = await getDroppedFiles(e.dataTransfer)
      if (dropped.length) await uploadDropped(dropped, destDir)
    }
    draggingRef.current = null
  }

  const handleClick = (f) => {
    setSelected(f.name)
    setContextFor(null)
    if (f.is_dir) {
      setCurrentPath(joinPath(currentPath, f.name))
      return
    }
    if (!f.size && /^(world|logs|plugins|config|mods|saves|datapacks|defaultconfigs|libraries|crash-reports|scripts)$/i.test(f.name)) {
      setCurrentPath(joinPath(currentPath, f.name))
      return
    }
    handleOpenFile(f)
  }

  const handleOpenFile = async (f) => {
    if (!isElectron) return
    const filePath = joinPath(currentPath, f.name)
    setOpenErr('')
    setSaveMsg('')
    try {
      const res = await window.electronAPI.wingsReadFile(server.id, filePath)
      if (res?.ok && res.content !== undefined && res.content !== null && !res.is_dir) {
        setEditingFile(filePath)
        setEditContent(String(res.content))
        setOriginalContent(String(res.content))
        setDirty(false)
      } else if (res?.is_dir) {
        setCurrentPath(filePath)
      } else {
        const err = res?.error || (lang === 'vi' ? 'Không đọc được file' : 'Cannot read file')
        if (/directory|is a directory|path not found|EISDIR/i.test(String(err))) {
          flash(err)
          loadFiles(currentPath)
          return
        }
        setOpenErr(err)
        setEditingFile(filePath)
        setEditContent('')
        setOriginalContent('')
        setDirty(false)
      }
    } catch (err) {
      setOpenErr(err.message || 'Read failed')
      setEditingFile(filePath)
      setEditContent('')
      setOriginalContent('')
      setDirty(false)
    }
  }

  const handleSaveFile = async () => {
    if (!isElectron || !editingFile) return
    setSaving(true)
    setSaveMsg('')
    try {
      const res = await window.electronAPI.wingsWriteFile(server.id, editingFile, editContent)
      if (res?.ok) {
        setOriginalContent(editContent)
        setDirty(false)
        setSaveMsg(lang === 'vi' ? 'Đã lưu' : 'Saved')
        setTimeout(() => setSaveMsg(''), 2000)
      } else {
        setSaveMsg(`ERROR: ${res?.error || 'save failed'}`)
      }
    } catch (err) {
      setSaveMsg(`ERROR: ${err.message}`)
    }
    setSaving(false)
  }

  const handleCloseEditor = () => {
    if (dirty) {
      setCloseAsk(true)
      return
    }
    closeEditorNow()
  }

  const closeEditorNow = () => {
    setCloseAsk(false)
    setEditingFile(null)
    setSaveMsg('')
    setOpenErr('')
    loadFiles(currentPath)
  }

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      handleSaveFile()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.target
      const { selectionStart, selectionEnd } = ta
      const next = editContent.slice(0, selectionStart) + '  ' + editContent.slice(selectionEnd)
      setEditContent(next)
      setDirty(next !== originalContent)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = selectionStart + 2
      })
    }
  }

  const handleDelete = async (f) => {
    if (!isElectron) return
    setPendingDelete(f)
  }

  const confirmDelete = async () => {
    const f = pendingDelete
    if (!f) return
    setPendingDelete(null)
    try {
      await window.electronAPI.wingsDeleteFile(server.id, joinPath(currentPath, f.name))
      setSelected(null)
      setContextFor(null)
      loadFiles(currentPath)
      flash(lang === 'vi' ? 'Đã xóa' : 'Deleted')
    } catch {}
  }

  const handleCreate = async () => {
    if (!isElectron || !showCreate) return
    const name = createName.trim()
    if (!name) return
    try {
      const api = showCreate === 'file' ? window.electronAPI.wingsCreateFile : window.electronAPI.wingsCreateFolder
      const res = await api(server.id, currentPath, name)
      if (res?.ok) {
        setShowCreate(null)
        setCreateName('')
        loadFiles(currentPath)
        flash(lang === 'vi' ? 'Đã tạo' : 'Created')
        if (showCreate === 'file') {
          const filePath = joinPath(currentPath, name)
          handleOpenFile({ name })
        }
      } else {
        flash(res?.error || (lang === 'vi' ? 'Tạo thất bại' : 'Create failed'))
      }
    } catch (err) {
      flash(err.message || 'Create failed')
    }
  }

  const goUp = () => {
    const parts = currentPath.split('/').filter(Boolean)
    parts.pop()
    setCurrentPath('/' + parts.join('/'))
  }

  const crumbs = currentPath.split('/').filter(Boolean)

  if (editingFile) {
    const lines = Array.from({ length: lineCount }, (_, i) => i + 1)
    const caretLine = (() => {
      try {
        const ta = taRef.current
        if (!ta) return 1
        return editContent.slice(0, ta.selectionStart || 0).split('\n').length
      } catch { return 1 }
    })()

    return (
      <div className="h-full flex flex-col overflow-hidden" style={{ background: bodyBg }}>
        {/* Editor header — Calagopus-style */}
        <div
          className="shrink-0 flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: `1px solid ${borderColor}`, background: headerBg }}
        >
          <button
            onClick={handleCloseEditor}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: labelColor }}
            onMouseEnter={(e) => { e.currentTarget.style.background = surfaceHover; e.currentTarget.style.color = BLUE }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = labelColor }}
            title={lang === 'vi' ? 'Quay lại' : 'Back'}
          >
            <ArrowLeft size={15} weight="bold" />
          </button>
          <div className="flex items-center gap-1.5 min-w-0 flex-1 text-[11px] font-mono">
            <span style={{ color: labelColor }}>~</span>
            {editingFile.split('/').filter(Boolean).map((part, i, arr) => (
              <span key={i} className="flex items-center gap-1 min-w-0">
                <CaretRight size={10} style={{ color: labelColor, opacity: 0.5 }} />
                <span
                  className="truncate"
                  style={{ color: i === arr.length - 1 ? textColor : BLUE }}
                >{part}</span>
              </span>
            ))}
          </div>
          {dirty && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}>
              ●
            </span>
          )}
          {saveMsg && (
            <span
              className="text-[10px] px-2 py-0.5 rounded"
              style={{
                background: saveMsg.startsWith('ERROR') ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)',
                color: saveMsg.startsWith('ERROR') ? RED : GREEN,
              }}
            >
              {saveMsg}
            </span>
          )}
          <span className="text-[10px] shrink-0" style={{ color: labelColor }}>
            {lineCount} {lang === 'vi' ? 'dòng' : 'lines'}
          </span>
          <button
            onClick={handleSaveFile}
            disabled={saving || !dirty}
            className="flex items-center gap-1 px-3 py-1 rounded-md text-[11px] font-semibold transition-all hover:opacity-85 disabled:opacity-35"
            style={{ background: BLUE, color: '#fff' }}
            title="Ctrl+S"
          >
            <FloppyDisk size={12} weight="fill" />
            {saving ? '…' : (lang === 'vi' ? 'Lưu' : 'Save')}
          </button>
        </div>

        {openErr && (
          <div
            className="shrink-0 px-4 py-2 text-[11px] flex items-center gap-2"
            style={{ background: 'rgba(239,68,68,0.15)', color: RED, borderBottom: `1px solid rgba(239,68,68,0.3)` }}
          >
            <Warning size={12} weight="duotone" /> {openErr}
            <button onClick={() => setOpenErr('')} className="ml-auto opacity-70 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Editor body: gutter + textarea share scroll */}
        <div className="flex-1 flex overflow-hidden relative" style={{ background: EDITOR_BG }}>
          <div
            ref={gutterRef}
            className="shrink-0 select-none overflow-hidden text-right"
            style={{
              background: GUTTER_BG,
              color: GUTTER_TEXT,
              borderRight: `1px solid ${BORDER}`,
              minWidth: 56,
              paddingTop: 12,
              paddingBottom: 12,
              paddingLeft: 8,
              paddingRight: 12,
              fontFamily: FONT_MONO,
              fontSize: FONT_SIZE,
              lineHeight: `${LINE_HEIGHT}px`,
            }}
            aria-hidden
          >
            {lines.map((n) => (
              <div key={n} style={{ height: LINE_HEIGHT }}>{n}</div>
            ))}
            {/* spacer matching textarea horizontal scrollbar room */}
            <div style={{ height: 12 }} />
          </div>
          <textarea
            ref={taRef}
            value={editContent}
            onChange={(e) => {
              setEditContent(e.target.value)
              setDirty(e.target.value !== originalContent)
              requestAnimationFrame(syncGutterScroll)
            }}
            onScroll={syncGutterScroll}
            onKeyDown={handleKeyDown}
            onClick={syncGutterScroll}
            onKeyUp={syncGutterScroll}
            className="fm-editor-textarea flex-1 w-full outline-none resize-none"
            style={{
              background: EDITOR_BG,
              color: EDITOR_TEXT,
              caretColor: '#fff',
              fontFamily: FONT_MONO,
              fontSize: FONT_SIZE,
              lineHeight: `${LINE_HEIGHT}px`,
              padding: '12px 16px 12px 12px',
              border: 'none',
              whiteSpace: 'pre',
              overflowWrap: 'normal',
              tabSize: 2,
            }}
            spellCheck={false}
            wrap="off"
          />
        </div>

        {/* Status bar */}
        <div
          className="shrink-0 flex items-center gap-3 px-4 py-1.5 text-[10px]"
          style={{ borderTop: `1px solid ${borderColor}`, color: labelColor, background: headerBg }}
        >
          <span>UTF-8</span>
          <span>LF</span>
          <span>Ln {caretLine}</span>
          <span>{dirty ? (lang === 'vi' ? 'Chưa lưu' : 'Unsaved') : (lang === 'vi' ? 'Đã lưu' : 'Saved')}</span>
          <div className="flex-1" />
          <span>Tab {lang === 'vi' ? 'thụt lề' : 'indent'}</span>
          <span>Ctrl+S {lang === 'vi' ? 'để lưu' : 'to save'}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden relative" style={{ background: bodyBg }}>
      <UploadDropOverlay
        visible={dropOverlay && !editingFile}
        title={lang === 'vi' ? 'Thả tệp vào đây' : 'Drop files here'}
        subtitle={lang === 'vi' ? `Tải lên ${currentPath}` : `Upload to ${currentPath}`}
      />
      {/* Toolbar */}
      <div
        className="shrink-0 flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: `1px solid ${borderColor}`, background: headerBg }}
      >
        <button
          onClick={() => setShowCreate('file')}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-opacity hover:opacity-85"
          style={{ background: BLUE, color: '#fff' }}
        >
          <FilePlus size={13} weight="bold" />
          {lang === 'vi' ? 'Tệp mới' : 'New file'}
        </button>
        <button
          onClick={() => setShowCreate('folder')}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors"
          style={{ border: `1px solid ${borderColor}`, color: textColor, background: surface }}
        >
          <FolderPlus size={13} weight="bold" />
          {lang === 'vi' ? 'Thư mục' : 'Folder'}
        </button>
        <button
          onClick={() => loadFiles(currentPath)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
          style={{ color: labelColor, background: surface, border: `1px solid ${borderColor}` }}
          title={lang === 'vi' ? 'Tải lại' : 'Reload'}
        >
          <ListBullets size={13} weight="bold" />
          {lang === 'vi' ? 'Tải lại' : 'Reload'}
        </button>
        <div className="flex-1" />
        {actionMsg && (
          <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: BLUE_LIGHT, color: BLUE }}>
            {actionMsg}
          </span>
        )}
        {uploading > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: GREEN }}>
            {lang === 'vi' ? `Đang tải lên ${uploading}…` : `Uploading ${uploading}…`}
          </span>
        )}
        <span className="text-[10px]" style={{ color: labelColor }}>
          {search.trim()
            ? (lang === 'vi' ? `${filteredFiles.length}/${files.length} mục` : `${filteredFiles.length}/${files.length} items`)
            : `${files.length} ${lang === 'vi' ? 'mục' : 'items'}`}
        </span>
        <div className="flex items-center gap-1.5 px-2 h-7 rounded-lg" style={{ background: theme === 'light' ? '#fff' : '#1a1a1a', border: `1px solid ${borderColor}` }}>
          <MagnifyingGlass size={12} style={{ color: labelColor }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={lang === 'vi' ? 'Tìm tệp/thư mục…' : 'Search files…'}
            className="w-40 bg-transparent outline-none text-[11px]"
            style={{ color: textColor }}
          />
          {search && (
            <button onClick={() => setSearch('')} title={lang === 'vi' ? 'Xoá lọc' : 'Clear'} style={{ color: labelColor }}>
              <X size={11} weight="bold" />
            </button>
          )}
        </div>
      </div>

      {/* Breadcrumb card */}
      <div
        className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 mx-3 mt-3 rounded-lg"
        style={{ background: surface, border: `1px solid ${borderColor}` }}
      >
        <button
          onClick={() => setCurrentPath('/')}
          className="text-[12px] font-bold px-1.5 py-0.5 rounded"
          style={{ color: BLUE }}
          title="Root"
        >~</button>
        {crumbs.map((part, i, arr) => (
          <span key={i} className="flex items-center gap-1 min-w-0">
            <CaretRight size={11} style={{ color: labelColor, opacity: 0.45 }} />
            <button
              onClick={() => setCurrentPath('/' + arr.slice(0, i + 1).join('/'))}
              className="text-[12px] font-medium truncate max-w-[160px] px-1 py-0.5 rounded"
              style={{ color: i === arr.length - 1 ? textColor : BLUE }}
            >{part}</button>
          </span>
        ))}
      </div>

      {/* Create inline prompt */}
      {showCreate && (
        <div
          className="shrink-0 mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: surface, border: `1px solid ${BLUE}` }}
        >
          <span className="text-[11px] font-semibold" style={{ color: textColor }}>
            {showCreate === 'file'
              ? (lang === 'vi' ? 'Tên tệp' : 'File name')
              : (lang === 'vi' ? 'Tên thư mục' : 'Folder name')}
          </span>
          <input
            autoFocus
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
              if (e.key === 'Escape') { setShowCreate(null); setCreateName('') }
            }}
            className="flex-1 text-[12px] font-mono px-2 py-1 rounded outline-none"
            style={{ background: isLight ? '#fff' : '#0a0a0a', color: textColor, border: `1px solid ${borderColor}` }}
            placeholder={showCreate === 'file' ? 'server.properties' : 'plugins'}
          />
          <button
            onClick={handleCreate}
            className="px-3 py-1 rounded-md text-[11px] font-semibold"
            style={{ background: BLUE, color: '#fff' }}
          >{lang === 'vi' ? 'Tạo' : 'Create'}</button>
          <button
            onClick={() => { setShowCreate(null); setCreateName('') }}
            className="px-2 py-1 rounded-md text-[11px]"
            style={{ color: labelColor }}
          >{lang === 'vi' ? 'Hủy' : 'Cancel'}</button>
        </div>
      )}

      {/* Table header */}
      <div
        className="shrink-0 mx-3 mt-3 grid items-center px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider"
        style={{
          gridTemplateColumns: '1fr 90px 140px 36px',
          background: headerBg,
          border: `1px solid ${borderColor}`,
          borderBottom: 'none',
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          color: labelColor,
        }}
      >
        <span>{lang === 'vi' ? 'Tên' : 'Name'}</span>
        <span className="text-right">{lang === 'vi' ? 'Kích thước' : 'Size'}</span>
        <span className="text-right">{lang === 'vi' ? 'Sửa đổi' : 'Modified'}</span>
        <span />
      </div>

      {/* File list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto mx-3 mb-3 rounded-b-lg"
        style={{ background: surface, border: `1px solid ${borderColor}`, borderTop: 'none' }}
      >
        {currentPath !== '/' && (
          <button
            onClick={goUp}
            className="w-full flex items-center gap-3 px-3 py-2.5 transition-colors"
            style={{ borderBottom: `1px solid ${borderColor}` }}
            onMouseEnter={(e) => { e.currentTarget.style.background = surfaceHover }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <ArrowUp size={14} weight="bold" style={{ color: labelColor }} />
            <span className="text-[12px] font-medium" style={{ color: labelColor }}>..</span>
          </button>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-[12px]" style={{ color: labelColor }}>
              {lang === 'vi' ? 'Đang tải…' : 'Loading…'}
            </span>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Folder size={28} weight="duotone" style={{ color: labelColor, opacity: 0.4 }} />
            <span className="text-[12px]" style={{ color: labelColor }}>
              {lang === 'vi' ? 'Thư mục trống' : 'Empty directory'}
            </span>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <MagnifyingGlass size={26} weight="duotone" style={{ color: labelColor, opacity: 0.4 }} />
            <span className="text-[12px]" style={{ color: labelColor }}>
              {lang === 'vi' ? 'Không có tệp nào khớp' : 'No matching files'}
            </span>
            <button onClick={() => setSearch('')} className="text-[11px] font-semibold transition-opacity hover:opacity-80" style={{ color: BLUE }}>
              {lang === 'vi' ? 'Xoá lọc' : 'Clear search'}
            </button>
          </div>
        ) : (
          <div ref={rowsRef} className="stream-items">
          <div style={{ height: virtual.padTop }} aria-hidden />
          {filteredFiles.slice(virtual.start, virtual.end).map((f) => {
            const isSelected = selected === f.name
            const isDropHot = f.is_dir && dropTarget === f.name
            return (
              <div
                key={f.name}
                className="grid items-center px-3 cursor-pointer group"
                style={{
                  gridTemplateColumns: '1fr 90px 140px 36px',
                  minHeight: 41,
                  borderBottom: `1px solid ${borderColor}`,
                  background: isDropHot
                    ? (isLight ? 'rgba(34,197,94,0.18)' : 'rgba(34,197,94,0.18)')
                    : (isSelected ? BLUE_LIGHT : 'transparent'),
                  outline: isDropHot ? `1px solid ${GREEN}` : 'none',
                  outlineOffset: -1,
                }}
                draggable={!loading && !dropOverlay}
                onDragStart={(e) => handleFileDragStart(e, f)}
                onDragEnd={() => { draggingRef.current = null; setDropTarget(null) }}
                onDragOver={(e) => handleFolderDragOver(e, f)}
                onDragLeave={(e) => handleFolderDragLeave(e, f)}
                onDrop={(e) => handleFolderDrop(e, f)}
                onClick={() => handleClick(f)}
                onMouseEnter={(e) => { if (!isSelected && !isDropHot) e.currentTarget.style.background = surfaceHover }}
                onMouseLeave={(e) => { if (!isSelected && !isDropHot) e.currentTarget.style.background = 'transparent' }}
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  {f.is_dir
                    ? <Folder size={16} weight="fill" style={{ color: YELLOW, flexShrink: 0 }} />
                    : <File size={16} weight="duotone" style={{ color: labelColor, flexShrink: 0 }} />}
                  <span className="text-[12px] font-medium truncate" style={{ color: textColor }}>{f.name}</span>
                </div>
                <span className="text-[11px] text-right font-mono" style={{ color: labelColor }}>
                  {f.is_dir ? '—' : formatSize(f.size)}
                </span>
                <span className="text-[11px] text-right font-mono" style={{ color: labelColor }}>
                  {formatModified(f.modified)}
                </span>
                <div className="relative flex items-center justify-end">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setContextFor(contextFor === f.name ? null : f.name)
                    }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: labelColor }}
                  >
                    <DotsThreeVertical size={14} weight="bold" />
                  </button>
                  {contextFor === f.name && (
                    <div
                      className="absolute right-0 top-full z-20 mt-0.5 min-w-[140px] rounded-md overflow-hidden shadow-xl"
                      style={{ background: isLight ? '#fff' : '#1a1a1a', border: `1px solid ${borderColor}` }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!f.is_dir && (
                        <button
                          onClick={() => { setContextFor(null); handleOpenFile(f) }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left"
                          style={{ color: textColor }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = BLUE_LIGHT }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                        >
                          <PencilSimple size={13} /> {lang === 'vi' ? 'Chỉnh sửa' : 'Edit'}
                        </button>
                      )}
                      <button
                        onClick={() => { setContextFor(null); handleDelete(f) }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left"
                        style={{ color: RED }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <Trash size={13} /> {lang === 'vi' ? 'Xóa' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          <div style={{ height: virtual.padBottom }} aria-hidden />
          </div>
        )}
      </div>

      {pendingDelete && (
        <ConfirmModal
          theme={theme}
          lang={lang}
          icon={Trash}
          danger
          title={lang === 'vi' ? 'Xoá tệp / thư mục' : 'Delete file / folder'}
          message={
            pendingDelete.is_dir
              ? (lang === 'vi'
                  ? `Xoá thư mục “${pendingDelete.name}” và toàn bộ nội dung bên trong?`
                  : `Delete folder “${pendingDelete.name}” and everything inside it?`)
              : (lang === 'vi' ? `Xoá tệp “${pendingDelete.name}”?` : `Delete file “${pendingDelete.name}”?`)
          }
          hint={lang === 'vi' ? 'Không khôi phục được từ trong server.' : 'This cannot be undone from the server.'}
          confirmLabel={lang === 'vi' ? 'Xoá' : 'Delete'}
          cancelLabel={lang === 'vi' ? 'Huỷ' : 'Cancel'}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}

      {closeAsk && (
        <ConfirmModal
          theme={theme}
          lang={lang}
          icon={Warning}
          title={lang === 'vi' ? 'Tệp chưa lưu' : 'Unsaved file'}
          message={lang === 'vi' ? `“${editingFile?.name || ''}” có thay đổi chưa lưu. Đóng mà không lưu?` : `“${editingFile?.name || ''}” has unsaved changes. Close without saving?`}
          confirmLabel={lang === 'vi' ? 'Đóng không lưu' : 'Close without saving'}
          cancelLabel={lang === 'vi' ? 'Ở lại' : 'Stay'}
          onCancel={() => setCloseAsk(false)}
          onConfirm={closeEditorNow}
        />
      )}
    </div>
  )
}

function ConfirmModal({ theme, lang, icon: Icon, title, message, hint, confirmLabel, cancelLabel, onConfirm, onCancel, danger }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const accent = danger ? RED : BLUE
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onCancel}>
      <div
        className="w-full max-w-[440px] rounded-xl overflow-hidden shadow-2xl"
        style={{ background: theme === 'light' ? '#fff' : '#171717', border: `1px solid ${danger ? 'rgba(239,68,68,0.35)' : borderColor}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${borderColor}` }}>
          {Icon && <Icon size={15} weight="duotone" style={{ color: accent }} />}
          <p className="text-[12px] font-bold flex-1" style={{ color: textColor }}>{title}</p>
          <button onClick={onCancel} className="transition-opacity hover:opacity-70" style={{ color: labelColor }}>
            <X size={13} weight="bold" />
          </button>
        </div>
        <div className="px-4 py-3.5 flex flex-col gap-1.5">
          <p className="text-[11px] leading-relaxed break-words" style={{ color: textColor }}>{message}</p>
          {hint && <p className="text-[10px] leading-relaxed" style={{ color: labelColor }}>{hint}</p>}
        </div>
        <div className="px-4 py-3 flex items-center justify-end gap-2" style={{ borderTop: `1px solid ${borderColor}` }}>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-opacity hover:opacity-85"
            style={{ background: theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)', color: labelColor }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="px-3.5 py-1.5 rounded-lg text-[11px] font-bold transition-opacity hover:opacity-90"
            style={{ background: accent, color: '#fff' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
