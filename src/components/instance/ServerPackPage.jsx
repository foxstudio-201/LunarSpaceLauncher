import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, CaretDown, CaretRight, Check, Minus, MagnifyingGlass, Package, FileArrowUp,
  ArrowsClockwise, WarningCircle, CheckCircle, CloudArrowDown, ListChecks, SlidersHorizontal,
  ArrowCounterClockwise, Code, FolderSimple, X, HardDrives,
} from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import { fileIcon, sizeLabel } from '../../lib/files'
import { EnvChip } from './catalogBits'
import ProgressBar from '../ui/ProgressBar'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

const TONES = {
  mod: '#a78bfa',
  config: '#60a5fa',
  script: '#f59e0b',
  data: '#34d399',
  pack: '#f472b6',
  world: '#22d3ee',
  noise: '#94a3b8',
  lib: '#94a3b8',
  server: '#4ade80',
  client: '#fb923c',
  other: '#94a3b8',
}

const ROW_GRID = '1fr 124px 84px 78px'

const PROP_GROUPS = [
  {
    vi: 'Kết nối',
    en: 'Connection',
    fields: [
      { key: 'server-ip', vi: 'IP máy chủ', en: 'Server IP', type: 'text', hintVi: 'Để trống nếu chạy trên mọi card mạng.', hintEn: 'Leave empty to bind all interfaces.' },
      { key: 'server-port', vi: 'Cổng', en: 'Port', type: 'number' },
      { key: 'motd', vi: 'Dòng mô tả', en: 'MOTD', type: 'text' },
      { key: 'online-mode', vi: 'Kiểm tra tài khoản Mojang', en: 'Online mode', type: 'bool', hintVi: 'Tắt khi chơi qua mạng LAN/offline — người chơi ngoài không cần tài khoản chính chủ.', hintEn: 'Turn off for LAN/offline play — outside players need no Mojang account.' },
      { key: 'max-players', vi: 'Số người tối đa', en: 'Max players', type: 'number' },
      { key: 'enable-status', vi: 'Hiện trong danh sách server', en: 'Show in server list', type: 'bool' },
      { key: 'hide-online-players', vi: 'Ẩn danh sách người chơi', en: 'Hide player list', type: 'bool' },
      { key: 'network-compression-threshold', vi: 'Ngưỡng nén gói tin', en: 'Compression threshold', type: 'number' },
    ],
  },
  {
    vi: 'Thế giới',
    en: 'World',
    fields: [
      { key: 'level-name', vi: 'Tên thế giới', en: 'Level name', type: 'text' },
      { key: 'level-seed', vi: 'Seed', en: 'Seed', type: 'text' },
      {
        key: 'level-type',
        vi: 'Kiểu thế giới',
        en: 'Level type',
        type: 'select',
        options: ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified', 'minecraft:single_biome_surface'],
      },
      { key: 'spawn-protection', vi: 'Vùng bảo vệ quanh điểm spawn', en: 'Spawn protection', type: 'number' },
      { key: 'allow-nether', vi: 'Cho vào Nether', en: 'Allow Nether', type: 'bool' },
      { key: 'generate-structures', vi: 'Sinh công trình', en: 'Generate structures', type: 'bool' },
      { key: 'max-world-size', vi: 'Bán kính thế giới tối đa', en: 'Max world size', type: 'number' },
      { key: 'sync-chunk-writes', vi: 'Ghi chunk đồng bộ', en: 'Sync chunk writes', type: 'bool' },
    ],
  },
  {
    vi: 'Luật chơi',
    en: 'Gameplay',
    fields: [
      { key: 'gamemode', vi: 'Chế độ chơi', en: 'Gamemode', type: 'select', options: ['survival', 'creative', 'adventure', 'spectator'] },
      { key: 'force-gamemode', vi: 'Ép chế độ chơi', en: 'Force gamemode', type: 'bool' },
      { key: 'difficulty', vi: 'Độ khó', en: 'Difficulty', type: 'select', options: ['peaceful', 'easy', 'normal', 'hard'] },
      { key: 'hardcore', vi: 'Một mạng (hardcore)', en: 'Hardcore', type: 'bool' },
      { key: 'pvp', vi: 'Cho phép PvP', en: 'PvP', type: 'bool' },
      { key: 'allow-flight', vi: 'Cho phép bay', en: 'Allow flight', type: 'bool' },
      { key: 'spawn-monsters', vi: 'Sinh quái', en: 'Spawn monsters', type: 'bool' },
      { key: 'spawn-animals', vi: 'Sinh động vật', en: 'Spawn animals', type: 'bool' },
      { key: 'spawn-npcs', vi: 'Sinh dân làng', en: 'Spawn NPCs', type: 'bool' },
      { key: 'enable-command-block', vi: 'Cho dùng command block', en: 'Command blocks', type: 'bool' },
      { key: 'player-idle-timeout', vi: 'Đá người chơi treo (phút)', en: 'Idle timeout (min)', type: 'number' },
    ],
  },
  {
    vi: 'Quyền & hiệu năng',
    en: 'Access & performance',
    fields: [
      { key: 'white-list', vi: 'Bật danh sách trắng', en: 'Whitelist', type: 'bool' },
      { key: 'enforce-whitelist', vi: 'Buộc theo danh sách trắng', en: 'Enforce whitelist', type: 'bool' },
      { key: 'op-permission-level', vi: 'Quyền OP', en: 'OP level', type: 'select', options: ['1', '2', '3', '4'] },
      { key: 'function-permission-level', vi: 'Quyền function', en: 'Function level', type: 'select', options: ['1', '2', '3', '4'] },
      { key: 'view-distance', vi: 'Tầm nhìn (chunk)', en: 'View distance', type: 'number' },
      { key: 'simulation-distance', vi: 'Tầm mô phỏng (chunk)', en: 'Simulation distance', type: 'number' },
      { key: 'rate-limit', vi: 'Giới hạn gói tin (0 = tắt)', en: 'Packet rate limit', type: 'number' },
    ],
  },
]

const LOADER_NAMES = { vanilla: 'Vanilla', forge: 'Forge', neoforge: 'NeoForge', fabric: 'Fabric', quilt: 'Quilt' }

function escapeValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/[^\x20-\x7E]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

function unescapeValue(value) {
  return String(value)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\\/g, '\\')
}

function serializeProps(values, order) {
  const keys = (order || []).filter((key) => values[key] !== undefined)
  const extra = Object.keys(values)
    .filter((key) => !keys.includes(key))
    .sort((a, b) => a.localeCompare(b))
  const lines = ['#Minecraft server properties', `#${new Date().toString()}`]
  for (const key of [...keys, ...extra]) lines.push(`${key}=${escapeValue(values[key])}`)
  return `${lines.join('\n')}\n`
}

function parsePropsText(text) {
  const map = {}
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('!')) continue
    const idx = line.indexOf('=')
    if (idx < 1) continue
    map[line.slice(0, idx).trim()] = unescapeValue(line.slice(idx + 1))
  }
  return map
}

function Toggle({ on, onClick, c, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className="relative shrink-0 rounded-full transition-colors disabled:opacity-40"
      style={{ width: 34, height: 19, background: on ? c.accent : c.input, border: `1px solid ${on ? c.accent : c.border}` }}
    >
      <span
        className="absolute rounded-full transition-all"
        style={{ top: 2, width: 13, height: 13, left: on ? 17 : 3, background: on ? c.ink : c.label }}
      />
    </button>
  )
}

function TagChip({ entry, lang }) {
  const tone = TONES[entry.tone] || TONES.other
  return (
    <span
      className="h-[18px] px-1.5 rounded text-[9px] font-bold uppercase tracking-wide shrink-0 inline-flex items-center whitespace-nowrap"
      style={{ background: `${tone}22`, color: tone }}
    >
      {lang === 'vi' ? entry.tag : entry.tagEn}
    </span>
  )
}

function CheckBox({ state, onClick, c, disabled, title }) {
  const on = state === 'on'
  const partial = state === 'partial'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={on}
      className="w-[15px] h-[15px] rounded-[4px] shrink-0 flex items-center justify-center disabled:opacity-30"
      style={{
        border: `1px solid ${on || partial ? c.accent : c.border}`,
        background: on || partial ? c.accent : 'transparent',
        color: c.ink,
      }}
    >
      {on ? <Check size={10} weight="bold" /> : partial ? <Minus size={10} weight="bold" /> : null}
    </button>
  )
}

export default function ServerPackPage({ instance, serverId, theme, lang, progress, onNavigate, onOpenLocalServer, onClose }) {
  const c = palette(theme)
  const localMode = !!serverId
  const sourceId = serverId || instance.id
  const ref = localMode ? { serverId } : { id: instance.id }
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('files')
  const [children, setChildren] = useState({})
  const [open, setOpen] = useState(() => new Set(['']))
  const [busyRel, setBusyRel] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [envs, setEnvs] = useState({})
  const [query, setQuery] = useState('')
  const [withServer, setWithServer] = useState(false)
  const [values, setValues] = useState({})
  const [rawMode, setRawMode] = useState(false)
  const [rawText, setRawText] = useState('')
  const [exporting, setExporting] = useState(false)
  const [creatingTest, setCreatingTest] = useState(false)
  const [done, setDone] = useState(null)
  const [exportError, setExportError] = useState('')
  const touched = useRef(false)
  const walks = useRef({})

  const instProgress = progress?.[instance.id]

  useEffect(() => {
    let alive = true
    const load = async () => {
      setLoading(true)
      const res = await api.serverpackPlan(ref).catch((err) => ({ ok: false, error: err.message }))
      if (!alive) return
      setLoading(false)
      if (!res?.ok) {
        setError(res?.error || 'error')
        return
      }
      setPlan(res)
      setValues(res.props || {})
      setRawText(res.propsText || '')
      setWithServer(!localMode && !!res.server?.ok)
    }
    load()
    api.instanceModEnvs(ref).then((res) => {
      if (alive && res?.ok) setEnvs(res.envs || {})
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [sourceId])

  const defaults = useMemo(() => {
    const next = new Set()
    for (const file of plan?.files || []) {
      if (!file.def) continue
      const name = file.rel.split('/').pop()
      if (file.rel.startsWith('mods/') && envs[name] === 'client') continue
      next.add(file.rel)
    }
    return next
  }, [plan, envs])

  useEffect(() => {
    if (plan && !touched.current) setSel(new Set(defaults))
  }, [plan, defaults])

  const loadDir = async (rel) => {
    const res = await api.instanceTree({ ...ref, rel }).catch((err) => ({ ok: false, error: err.message }))
    if (!res?.ok) {
      setError(res?.error || 'error')
      return []
    }
    setChildren((prev) => ({ ...prev, [rel]: res.entries || [] }))
    return res.entries || []
  }

  useEffect(() => {
    loadDir('')
  }, [sourceId])

  const toggleOpen = async (rel) => {
    if (open.has(rel)) {
      setOpen((prev) => {
        const next = new Set(prev)
        for (const key of [...next]) if (key === rel || key.startsWith(`${rel}/`)) next.delete(key)
        return next
      })
      return
    }
    if (!children[rel]) {
      setBusyRel(rel)
      await loadDir(rel)
      setBusyRel('')
    }
    setOpen((prev) => new Set([...prev, rel]))
  }

  const folderFiles = async (rel) => {
    if (walks.current[rel]) return walks.current[rel]
    const res = await api.serverpackWalk({ ...ref, rel }).catch(() => ({ ok: false, files: [] }))
    walks.current[rel] = res?.files || []
    return walks.current[rel]
  }

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

  const stateOf = (rel, total) => {
    const picked = counts[rel] || 0
    if (!total || !picked) return 'off'
    return picked >= total ? 'on' : 'partial'
  }

  const toggleFolder = async (rel) => {
    touched.current = true
    const total = plan?.folders?.[rel]?.count || 0
    const state = stateOf(rel, total)
    const list = await folderFiles(rel)
    setSel((prev) => {
      const next = new Set(prev)
      for (const file of list) {
        if (state === 'on') next.delete(file.rel)
        else next.add(file.rel)
      }
      return next
    })
  }

  const toggleFile = (rel) => {
    touched.current = true
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(rel)) next.delete(rel)
      else next.add(rel)
      return next
    })
  }

  const toneOf = (rel) => {
    if (!rel) return ''
    const top = rel.split('/')[0]
    if (plan?.folders?.[top]) return plan.folders[top].tone
    const rootEntry = (children[''] || []).find((e) => e.rel === top)
    return rootEntry?.tone || ''
  }

  const tagInfoOf = (rel) => {
    const top = rel.split('/')[0]
    const folder = plan?.folders?.[top]
    if (folder) return folder
    return (children[''] || []).find((e) => e.rel === top) || null
  }

  const rows = useMemo(() => {
    const out = []
    const walk = (rel) => {
      for (const entry of children[rel] || []) {
        out.push({ ...entry, depth: rel ? rel.split('/').length : 0, parentTone: toneOf(rel) })
        if (entry.dir && open.has(entry.rel)) walk(entry.rel)
      }
    }
    walk('')
    return out
  }, [children, open, plan])

  const needle = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!needle || !plan) return []
    return plan.files
      .filter((file) => file.rel.toLowerCase().includes(needle))
      .slice(0, 400)
      .map((file) => {
        const info = tagInfoOf(file.rel) || {}
        return {
          rel: file.rel,
          name: file.rel.split('/').pop(),
          dir: false,
          size: file.size,
          depth: 0,
          tone: info.tone || 'other',
          tag: info.tag || 'Khác',
          tagEn: info.tagEn || 'Other',
          parentTone: toneOf(file.rel.split('/').slice(0, -1).join('/')),
        }
      })
  }, [needle, plan, children])

  const shown = needle ? matches : rows

  const sizeOf = useMemo(() => {
    const map = new Map()
    for (const file of plan?.files || []) map.set(file.rel, file.size)
    return map
  }, [plan])

  const selBytes = useMemo(() => {
    let sum = 0
    for (const rel of sel) sum += sizeOf.get(rel) || 0
    return sum
  }, [sel, sizeOf])

  const breakdown = useMemo(() => {
    if (!plan) return []
    const tops = new Map()
    for (const file of plan.files) {
      const top = file.rel.includes('/') ? file.rel.split('/')[0] : null
      const key = top || '.'
      const row = tops.get(key) || { key, total: 0, picked: 0, size: 0, tone: 'other', tag: vn(lang, 'Tệp ở gốc', 'Root files'), tagEn: 'Root files' }
      const folder = plan.folders[key]
      if (folder) {
        row.tone = folder.tone
        row.tag = lang === 'vi' ? folder.tag : folder.tagEn
        row.total = folder.count
      } else {
        row.total += 1
      }
      row.size += sizeOf.get(file.rel) || 0
      if (sel.has(file.rel)) row.picked += 1
      tops.set(key, row)
    }
    return [...tops.values()]
      .filter((row) => row.total > 0)
      .sort((a, b) => Number(b.key === '.') - Number(a.key === '.') || b.picked - a.picked || a.key.localeCompare(b.key))
  }, [plan, sel, sizeOf, lang])

  const setPreset = (kind) => {
    touched.current = true
    if (kind === 'none') return setSel(new Set())
    if (kind === 'default') return setSel(new Set(defaults))
    return setSel(new Set((plan?.files || []).map((file) => file.rel)))
  }

  const expandAll = async () => {
    const tops = (children[''] || []).filter((entry) => entry.dir)
    for (const entry of tops) {
      if (!children[entry.rel]) await loadDir(entry.rel)
    }
    setOpen(new Set(['', ...tops.map((entry) => entry.rel)]))
  }

  const enterRaw = () => {
    setRawText(serializeProps(values, plan?.propsOrder))
    setRawMode(true)
  }

  const leaveRaw = () => {
    setValues((prev) => ({ ...prev, ...parsePropsText(rawText) }))
    setRawMode(false)
  }

  const createTestServer = async () => {
    if (creatingTest || !plan) return
    setCreatingTest(true)
    setExportError('')
    const suggest = await api.serverTestSuggest({ instanceId: instance.id }).catch(() => null)
    const res = await api
      .serverTestCreate({
        name: `${instance.name} · test`,
        eggId: suggest?.eggId || 'vanilla',
        mc: plan.mc || instance.version,
        loaderVersion: suggest?.loaderVersion || plan.loaderVersion || '',
        ramMb: suggest?.ramMb || instance.memoryMb || 4096,
        port: suggest?.port || 25565,
        include: [...sel],
        instanceId: instance.id,
        vars: { ...(suggest?.vars || {}), MC_VERSION: plan.mc || instance.version, port: suggest?.port || 25565 },
      })
      .catch((err) => ({ ok: false, error: err.message }))
    setCreatingTest(false)
    if (!res?.ok) {
      setExportError(res?.error || 'error')
      return
    }
    const cfg = await api.getServerConfig(res.server.id).catch(() => null)
    api.installServer(res.server.id).catch(() => {})
    if (cfg?.server && onOpenLocalServer) onOpenLocalServer(cfg.server)
    else onNavigate?.('server-test')
  }

  const runExport = async () => {
    if (exporting || !plan) return
    setExporting(true)
    setExportError('')
    setDone(null)
    const res = await api
      .serverpackExport({
        ...ref,
        name: instance.name,
        include: [...sel],
        props: rawMode ? null : values,
        raw: rawMode ? rawText : null,
        server: { ...plan.server, download: withServer, memoryMb: instance.memoryMb || 4096 },
      })
      .catch((err) => ({ ok: false, error: err.message }))
    setExporting(false)
    if (!res?.ok) {
      if (!res?.canceled) setExportError(res?.error || 'error')
      return
    }
    setDone(res)
  }

  const serverOk = !!plan?.server?.ok
  const loaderName = LOADER_NAMES[plan?.loader] || plan?.loader || ''
  const changed = useMemo(() => {
    if (!plan) return 0
    return Object.keys(values).filter((key) => values[key] !== plan.props?.[key]).length
  }, [values, plan])
  const rowHover = c.hover
  const hairline = { borderBottom: `1px solid ${c.border}` }

  return (
    <div data-surface className="h-full flex flex-col overflow-hidden" style={{ background: c.bg }}>
      <div className="shrink-0 flex items-center gap-3 px-4 h-12" style={{ borderBottom: `1px solid ${c.border}`, background: c.bar }}>
        <button
          onClick={() => { if (!exporting) onClose?.() }}
          title={vn(lang, 'Quay lại', 'Back')}
          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ color: c.label }}
        >
          <ArrowLeft size={15} weight="bold" />
        </button>
        <Package size={17} weight="duotone" style={{ color: c.accent }} />
        <div className="min-w-0">
          <p className="text-[12px] font-bold truncate" style={{ color: c.text }}>
            {vn(lang, 'Xuất serverpack', 'Export server pack')}
          </p>
          <p className="text-[10px] font-mono truncate" style={{ color: c.faint }}>
            {instance.name} · {loaderName}{plan?.loaderVersion ? ` ${plan.loaderVersion}` : ''} · Minecraft {plan?.mc || instance.version}
          </p>
        </div>
        <div className="flex-1" />
        {!localMode && (
          <span className="h-7 px-2.5 max-w-[380px] rounded-md text-[10px] font-mono inline-flex items-center gap-1.5" style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}>
            <CloudArrowDown size={12} weight="duotone" className="shrink-0" style={{ color: serverOk ? c.accent : '#f59e0b' }} />
            <span className="truncate">{plan?.server?.name || vn(lang, 'chưa rõ tệp server', 'server file unknown')}</span>
          </span>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-1 px-3 h-10" style={{ borderBottom: `1px solid ${c.border}` }}>
        {[
          { id: 'files', icon: ListChecks, vi: 'Nội dung gói', en: 'Pack contents', count: `${sel.size}/${plan?.totalFiles ?? 0}` },
          { id: 'props', icon: SlidersHorizontal, vi: 'Cấu hình server', en: 'Server config', count: rawMode ? 'raw' : changed ? vn(lang, `${changed} đổi`, `${changed} changed`) : '' },
        ].map((item) => {
          const on = tab === item.id
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className="h-7 px-2.5 rounded-md text-[11px] font-semibold inline-flex items-center gap-1.5"
              style={{ background: on ? `${c.accent}1f` : 'transparent', color: on ? c.accent : c.label, border: `1px solid ${on ? `${c.accent}55` : 'transparent'}` }}
            >
              <item.icon size={13} weight="duotone" />
              {vn(lang, item.vi, item.en)}
              {item.count && <span className="text-[9px] font-mono opacity-70">{item.count}</span>}
            </button>
          )
        })}
        <div className="flex-1" />
        <span className="text-[10px] font-mono" style={{ color: c.faint }}>
          {vn(lang, 'Đã chọn', 'Selected')} {sel.size} · {sizeLabel(selBytes)}
        </span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-[12px]" style={{ color: c.label }}>{t(lang, 'home.loading')}</span>
        </div>
      ) : error && !plan ? (
        <div className="flex-1 flex items-center justify-center gap-2 px-6">
          <WarningCircle size={16} weight="duotone" style={{ color: '#f87171' }} />
          <span className="text-[12px]" style={{ color: '#f87171' }}>{error}</span>
        </div>
      ) : tab === 'files' ? (
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="shrink-0 flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${c.border}` }}>
              <div className="flex items-center gap-1.5 h-7 px-2 rounded-md" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                <MagnifyingGlass size={12} style={{ color: c.faint }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={vn(lang, 'Lọc theo tên tệp', 'Filter by file name')}
                  className="w-44 bg-transparent outline-none text-[11px]"
                  style={{ color: c.text }}
                />
                {query && (
                  <button onClick={() => setQuery('')} style={{ color: c.faint }}>
                    <X size={11} weight="bold" />
                  </button>
                )}
              </div>
              <div className="flex-1" />
              {[
                { kind: 'default', label: vn(lang, 'Mặc định', 'Default'), icon: ArrowCounterClockwise },
                { kind: 'all', label: vn(lang, 'Tất cả', 'All'), icon: Check },
                { kind: 'none', label: vn(lang, 'Bỏ chọn', 'Clear'), icon: X },
              ].map((item) => (
                <button
                  key={item.kind}
                  onClick={() => setPreset(item.kind)}
                  className="h-7 px-2 rounded-md text-[10px] font-semibold inline-flex items-center gap-1"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
                >
                  <item.icon size={11} weight="bold" />
                  {item.label}
                </button>
              ))}
              <button
                onClick={expandAll}
                className="h-7 px-2 rounded-md text-[10px] font-semibold"
                style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
              >
                {vn(lang, 'Mở rộng', 'Expand')}
              </button>
            </div>

            <div className="shrink-0 grid items-center px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider" style={{ gridTemplateColumns: ROW_GRID, background: c.bar, color: c.faint, borderBottom: `1px solid ${c.border}` }}>
              <span>{vn(lang, 'Thư mục & tệp', 'Folders & files')}</span>
              <span>{vn(lang, 'Loại', 'Type')}</span>
              <span className="text-right">{vn(lang, 'Kích thước', 'Size')}</span>
              <span className="text-right">{vn(lang, 'Chọn', 'Pick')}</span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {shown.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <FolderSimple size={26} weight="duotone" style={{ color: c.label, opacity: 0.4 }} />
                  <span className="text-[11px]" style={{ color: c.label }}>
                    {needle ? vn(lang, 'Không có tệp nào khớp', 'No file matches') : vn(lang, 'Thư mục trống', 'Empty folder')}
                  </span>
                </div>
              ) : (
                shown.map((entry) => {
                  const folder = plan?.folders?.[entry.rel]
                  const total = entry.dir ? folder?.count || 0 : 0
                  const state = entry.dir ? stateOf(entry.rel, total) : sel.has(entry.rel) ? 'on' : 'off'
                  const expanded = open.has(entry.rel)
                  const name = entry.name || entry.rel.split('/').pop()
                  const env = !entry.dir && entry.rel.startsWith('mods/') ? envs[name] : null
                  const showTag = entry.tone && entry.tone !== entry.parentTone
                  return (
                    <div
                      key={entry.rel}
                      className="grid items-center px-3 group"
                      style={{ gridTemplateColumns: ROW_GRID, minHeight: 34, ...hairline, paddingLeft: 12 + entry.depth * 14 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = rowHover }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {entry.dir ? (
                          <button
                            onClick={() => toggleOpen(entry.rel)}
                            className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                            style={{ color: c.faint }}
                          >
                            {busyRel === entry.rel ? (
                              <ArrowsClockwise size={11} weight="bold" className="animate-spin" />
                            ) : expanded ? (
                              <CaretDown size={11} weight="bold" />
                            ) : (
                              <CaretRight size={11} weight="bold" />
                            )}
                          </button>
                        ) : (
                          <span className="w-4 shrink-0" />
                        )}
                        <CheckBox
                          state={state}
                          onClick={() => (entry.dir ? toggleFolder(entry.rel) : toggleFile(entry.rel))}
                          c={c}
                          disabled={entry.dir && !total}
                          title={entry.dir && !total ? vn(lang, 'Thư mục trống — zip không giữ thư mục rỗng', 'Empty folder — zips keep no empty folders') : undefined}
                        />
                        {fileIcon(name, entry.dir, entry.dir ? c.accent : c.label, 14)}
                        <button
                          onClick={() => (entry.dir ? toggleOpen(entry.rel) : toggleFile(entry.rel))}
                          className="text-[11px] font-medium truncate text-left"
                          style={{
                            color: entry.disabled ? c.faint : c.text,
                            textDecoration: entry.disabled ? 'line-through' : 'none',
                          }}
                          title={entry.rel}
                        >
                          {name}
                        </button>
                        {entry.disabled && (
                          <span className="h-[18px] px-1.5 rounded text-[9px] font-bold shrink-0 inline-flex items-center" style={{ background: c.input, color: c.faint }}>
                            {t(lang, 'mods.disabled')}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex items-center overflow-hidden">
                        {env ? <EnvChip c={c} env={env} lang={lang} /> : showTag ? <TagChip entry={entry} lang={lang} /> : null}
                      </div>
                      <span className="text-right text-[10px] font-mono" style={{ color: c.faint }}>
                        {entry.dir ? (total ? sizeLabel(folder?.size || 0) : '—') : sizeLabel(entry.size)}
                      </span>
                      <span className="text-right text-[10px] font-mono" style={{ color: entry.dir && total ? c.label : c.faint }}>
                        {entry.dir ? (total ? `${counts[entry.rel] || 0}/${total}` : '—') : sel.has(entry.rel) ? '1' : '0'}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <aside className="w-[286px] shrink-0 flex flex-col gap-3 p-3 overflow-y-auto" style={{ borderLeft: `1px solid ${c.border}`, background: c.bar }}>
            <div className="rounded-xl p-3" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
              <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: c.faint }}>
                {vn(lang, 'Gói sẽ xuất', 'Pack summary')}
              </p>
              <p className="mt-1.5 text-[15px] font-bold" style={{ color: c.text }}>
                {sel.size} <span className="text-[11px] font-normal" style={{ color: c.label }}>{vn(lang, 'tệp', 'files')}</span> · {sizeLabel(selBytes)}
              </p>
              <p className="mt-0.5 text-[10px]" style={{ color: c.faint }}>
                {vn(lang, 'server.properties luôn được ghi từ tab Cấu hình server.', 'server.properties is always written from the Server config tab.')}
              </p>
            </div>

            {!localMode && (
            <div className="rounded-xl overflow-hidden" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
              <div className="flex items-start gap-2 px-3 pt-3">
                <CloudArrowDown size={14} weight="duotone" style={{ color: serverOk ? c.accent : '#f59e0b' }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold" style={{ color: c.text }}>
                    {vn(lang, 'Kèm tệp server', 'Include server file')}
                  </p>
                  <p className="text-[10px] font-mono break-all mt-0.5" style={{ color: c.faint }}>
                    {plan?.server?.name || '—'}
                  </p>
                </div>
                <Toggle on={withServer} disabled={!serverOk} onClick={() => setWithServer((v) => !v)} c={c} />
              </div>
              <p className="px-3 pt-1.5 text-[10px] leading-relaxed" style={{ color: serverOk ? c.label : '#f59e0b' }}>
                {serverOk
                  ? plan?.server?.installer
                    ? vn(
                        lang,
                        `Tải sẵn ${plan.server.name} (${sizeLabel(plan.server.size)}) + start.bat/start.sh — chạy một lần để dựng server.`,
                        `Bundles ${plan.server.name} (${sizeLabel(plan.server.size)}) + start.bat/start.sh — run once to build the server.`,
                      )
                    : vn(
                        lang,
                        `Tải sẵn ${plan.server.name} (${sizeLabel(plan.server.size)}) + script khởi chạy no-GUI.`,
                        `Bundles ${plan.server.name} (${sizeLabel(plan.server.size)}) + no-GUI start scripts.`,
                      )
                  : vn(
                      lang,
                      `Không lấy được tệp server cho ${loaderName} ${plan?.loaderVersion || ''}: ${plan?.server?.error || 'không rõ lý do'}. Vẫn xuất được gói, thêm tệp server thủ công sau.`,
                      `Could not resolve the server file for ${loaderName} ${plan?.loaderVersion || ''}: ${plan?.server?.error || 'unknown reason'}. The pack still exports; add the server file manually later.`,
                    )}
              </p>
              <p className="px-3 pb-3 pt-2 text-[10px] leading-relaxed" style={{ color: c.faint }}>
                {plan?.server?.kind === 'forge' || plan?.server?.kind === 'neoforge' || plan?.server?.kind === 'quilt'
                  ? vn(lang, 'Bản cài đặt của loader nằm trong gói — chạy start.bat một lần để dựng server.', 'The loader installer is inside the pack — run start.bat once to set up the server.')
                  : vn(lang, 'Tệp server chạy được ngay bằng start.bat hoặc start.sh.', 'The server file runs straight away with start.bat or start.sh.')}
              </p>
            </div>
            )}

            {localMode && (
              <div className="rounded-xl p-3 flex items-start gap-2" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                <HardDrives size={14} weight="duotone" className="shrink-0 mt-0.5" style={{ color: c.accent }} />
                <p className="text-[10px] leading-relaxed" style={{ color: c.label }}>
                  {vn(
                    lang,
                    'Gói lấy trực tiếp từ thư mục server đang chạy — cây bên trái là toàn bộ nội dung server (mods, config, world, tệp server đã cài…).',
                    'The pack reads straight from the running server folder — the tree is the whole server content (mods, config, world, installed server files…).',
                  )}
                </p>
              </div>
            )}

            <div className="rounded-xl overflow-hidden" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
              <p className="px-3 pt-3 text-[9px] font-bold uppercase tracking-wider" style={{ color: c.faint }}>
                {vn(lang, 'Theo mục', 'By folder')}
              </p>
              <div className="pt-1 pb-2">
                {breakdown.map((row) => {
                  const tone = TONES[row.tone] || TONES.other
                  const pct = row.total ? Math.round((row.picked / row.total) * 100) : 0
                  return (
                    <div key={row.key} className="flex items-center gap-2 px-3 py-1" title={row.key}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tone }} />
                      <span className="text-[10px] truncate flex-1" style={{ color: row.picked ? c.text : c.faint }}>{row.tag}</span>
                      <span className="text-[10px] font-mono shrink-0" style={{ color: c.faint }}>
                        {row.picked}/{row.total}
                      </span>
                      <span className="w-9 h-1 rounded-full overflow-hidden shrink-0" style={{ background: c.input }}>
                        <span className="block h-full" style={{ width: `${pct}%`, background: tone }} />
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            <p className="text-[10px] leading-relaxed px-1" style={{ color: c.faint }}>
              {vn(
                lang,
                'Thư mục rỗng không được đưa vào gói (zip không lưu thư mục rỗng). Mod đang tắt và dữ liệu máy khách mặc định bị bỏ chọn.',
                'Empty folders are skipped (zips keep no empty folders). Disabled mods and client-only data are unchecked by default.',
              )}
            </p>
            {error && (
              <div className="flex items-start gap-2 rounded-lg px-3 py-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.28)' }}>
                <WarningCircle size={12} weight="duotone" className="shrink-0 mt-0.5" style={{ color: '#f87171' }} />
                <span className="text-[10px]" style={{ color: '#f87171' }}>{error}</span>
              </div>
            )}
          </aside>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <p className="text-[11px] flex-1" style={{ color: c.label }}>
                {vn(
                  lang,
                  plan?.hasProps
                    ? `${localMode ? 'Server' : 'Instance'} đã có server.properties — form lấy sẵn giá trị trong đó, sửa rồi xuất là ghi vào gói.`
                    : `Chưa có server.properties trong ${localMode ? 'server' : 'instance'} — form đang dùng giá trị gốc của Minecraft.`,
                  plan?.hasProps
                    ? `This ${localMode ? 'server' : 'instance'} already has server.properties — the form started from it, edits are written into the pack.`
                    : `No server.properties in this ${localMode ? 'server' : 'instance'} — the form uses Minecraft defaults.`,
                )}
              </p>
              <button
                onClick={() => { setValues(plan?.props || {}); setRawText(plan?.propsText || '') }}
                className="h-7 px-2.5 rounded-md text-[10px] font-semibold inline-flex items-center gap-1.5"
                style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
              >
                <ArrowCounterClockwise size={11} weight="bold" />
                {plan?.hasProps
                  ? vn(lang, localMode ? 'Lấy lại từ server' : 'Lấy lại từ instance', localMode ? 'Reset from server' : 'Reset from instance')
                  : vn(lang, 'Về mặc định', 'Reset to defaults')}
              </button>
              <button
                onClick={() => (rawMode ? leaveRaw() : enterRaw())}
                className="h-7 px-2.5 rounded-md text-[10px] font-semibold inline-flex items-center gap-1.5"
                style={{
                  background: rawMode ? `${c.accent}1f` : c.input,
                  border: `1px solid ${rawMode ? `${c.accent}55` : c.border}`,
                  color: rawMode ? c.accent : c.label,
                }}
              >
                <Code size={11} weight="bold" />
                {rawMode ? vn(lang, 'Xem dạng form', 'Form view') : vn(lang, 'Xem tệp thô', 'Raw view')}
              </button>
            </div>

            {rawMode ? (
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                spellCheck={false}
                className="w-full outline-none resize-none rounded-xl p-3 text-[12px] leading-relaxed"
                style={{
                  minHeight: 420,
                  background: c.surface,
                  border: `1px solid ${c.border}`,
                  color: c.text,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                }}
              />
            ) : (
              PROP_GROUPS.map((group) => (
                <section key={group.vi} className="rounded-xl overflow-hidden" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
                  <p className="px-3.5 pt-3 text-[9px] font-bold uppercase tracking-wider" style={{ color: c.faint }}>
                    {vn(lang, group.vi, group.en)}
                  </p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 p-3.5">
                    {group.fields.map((field) => {
                      const value = values[field.key] ?? ''
                      const on = String(value) === 'true'
                      const hint = field.hintVi ? (
                        <span className="text-[9px] leading-snug" style={{ color: c.faint }}>
                          {vn(lang, field.hintVi, field.hintEn)}
                        </span>
                      ) : null
                      if (field.type === 'bool') {
                        return (
                          <div key={field.key} className="flex flex-col gap-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <label className="text-[10px] font-semibold flex-1 min-w-0" style={{ color: c.label }}>
                                {vn(lang, field.vi, field.en)}
                              </label>
                              <Toggle
                                on={on}
                                c={c}
                                onClick={() => setValues((prev) => ({ ...prev, [field.key]: on ? 'false' : 'true' }))}
                              />
                            </div>
                            {hint}
                          </div>
                        )
                      }
                      return (
                        <div key={field.key} className="flex flex-col gap-1 min-w-0">
                          <label className="text-[10px] font-semibold" style={{ color: c.label }} htmlFor={`sp-${field.key}`}>
                            {vn(lang, field.vi, field.en)}
                          </label>
                          {field.type === 'select' ? (
                            <select
                              id={`sp-${field.key}`}
                              value={value}
                              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                              className="h-7 px-2 rounded-md text-[11px] outline-none"
                              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
                            >
                              {field.options.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={`sp-${field.key}`}
                              value={value}
                              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                              className="h-7 px-2 rounded-md text-[11px] font-mono outline-none"
                              style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
                            />
                          )}
                          {hint}
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>
      )}

      <div className="shrink-0 px-4 py-2.5 flex items-center gap-3" style={{ borderTop: `1px solid ${c.border}`, background: c.bar }}>
        {instProgress && (
          <div className="w-56">
            <ProgressBar theme={theme} lang={lang} progress={instProgress} compact />
          </div>
        )}
        {done ? (
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle size={13} weight="fill" style={{ color: '#22c55e' }} />
            <span className="text-[10px] font-semibold" style={{ color: '#22c55e' }}>
              {sizeLabel(done.bytes)} · {done.files} {vn(lang, 'tệp', 'files')}
              {done.server ? ` · ${done.server.name}` : ''}
            </span>
            <button onClick={() => api.revealPath(done.path).catch(() => {})} className="text-[10px] font-bold" style={{ color: c.accent }}>
              {t(lang, 'settings.openFolder')}
            </button>
          </div>
        ) : exportError ? (
          <div className="flex items-center gap-2 min-w-0">
            <WarningCircle size={13} weight="duotone" style={{ color: '#f87171' }} />
            <span className="text-[10px] truncate" style={{ color: '#f87171' }}>{exportError}</span>
          </div>
        ) : (
          <span className="text-[10px] font-mono truncate" style={{ color: c.faint }}>
            {sel.size} {vn(lang, 'tệp', 'files')} · {sizeLabel(selBytes)}
            {withServer && serverOk ? ` · + ${plan?.server?.name}` : ''}
          </span>
        )}
        {done?.serverError && (
          <span className="text-[10px]" style={{ color: '#f59e0b' }}>
            {vn(lang, 'Không tải được tệp server', 'Server file failed')}: {done.serverError}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => { if (!exporting) onClose?.() }}
          disabled={exporting}
          className="h-8 px-3 rounded-lg text-[11px] font-semibold disabled:opacity-50"
          style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
        >
          {vn(lang, 'Đóng', 'Close')}
        </button>
        {!localMode && (
          <button
            onClick={createTestServer}
            disabled={creatingTest || exporting || !plan || (sel.size === 0 && !(withServer && serverOk))}
            className="h-8 px-3.5 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: c.input, border: `1px solid ${c.border}`, color: c.label }}
            title={vn(lang, 'Tạo server thử trên máy từ đúng nội dung đang chọn (cài bằng script egg rồi chạy như panel)', 'Create a local test server from the current selection (installed with the egg script, run like the panel)')}
          >
            {creatingTest ? <ArrowsClockwise size={13} weight="bold" className="animate-spin" /> : <HardDrives size={13} weight="duotone" />}
            {creatingTest ? vn(lang, 'Đang tạo…', 'Creating…') : vn(lang, 'Chạy thử trên máy', 'Test locally')}
          </button>
        )}
        <button
          onClick={runExport}
          disabled={exporting || !plan || (sel.size === 0 && !(withServer && serverOk))}
          className="h-8 px-4 rounded-lg text-[11px] font-bold inline-flex items-center gap-2 disabled:opacity-50"
          style={{ background: c.accent, color: c.ink }}
        >
          {exporting ? <ArrowsClockwise size={13} weight="bold" className="animate-spin" /> : <FileArrowUp size={13} weight="bold" />}
          {exporting ? vn(lang, 'Đang xuất…', 'Exporting…') : vn(lang, 'Xuất serverpack', 'Export server pack')}
        </button>
      </div>
    </div>
  )
}
