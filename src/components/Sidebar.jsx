import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  House, Gear, Terminal, Files, Archive, User, Trash,
  PuzzlePiece, Stack, GearSix, ArrowLeft, ChartLineUp, SidebarSimple, CaretRight, Check, Image, PaintBrush, Plus, Cloud, HardDrives,
  Database, Clock, Users, Network, Play, MapTrifold } from '@phosphor-icons/react'
import { t } from '../i18n/translations'
import { statusColor } from '../lib/status'
import { palette } from '../lib/palette'
import { loaderIcon } from '../api/client.js'
import HeadSkin from './ui/HeadSkin'

// Số đo lấy đúng từ sidebar bản Rust (src/ui/app.rs::sidebar).
export const RAIL_W = 200
export const RAIL_W_COLLAPSED = 76

const ROW_H = 48
const ANIM_MS = 320
const SPRING = 'cubic-bezier(0.34, 1.45, 0.64, 1)'
const clamp01 = (v) => Math.max(0, Math.min(1, v))

const MAIN_PAGES = [
  { key: 'home', icon: House, label: 'Home', labelVi: 'Trang chủ' },
  { key: 'host', icon: Cloud, label: 'Host', labelVi: 'Host' },
  { key: 'server-test', icon: HardDrives, label: 'ServerLocalHost', labelVi: 'ServerLocalHost' },
  { key: 'modpacks', icon: Stack, label: 'Modpack', labelVi: 'Modpack' },
]

const INSTANCE_PAGES = [
  { key: 'instance-overview', icon: ChartLineUp, label: 'Overview', labelVi: 'Tổng quan' },
  { key: 'instance-console', icon: Terminal, label: 'Console', labelVi: 'Console' },
  { key: 'instance-mods', icon: PuzzlePiece, label: 'Mods', labelVi: 'Mods' },
  { key: 'instance-resourcepacks', icon: Image, label: 'Resource packs', labelVi: 'Gói tài nguyên' },
  { key: 'instance-shaderpacks', icon: PaintBrush, label: 'Shaders', labelVi: 'Shader' },
  { key: 'instance-files', icon: Files, label: 'Files', labelVi: 'Tệp tin' },
  { key: 'instance-trash', icon: Trash, label: 'Trash', labelVi: 'Thùng rác' },
  { key: 'instance-saves', icon: Archive, label: 'Saves', labelVi: 'Bản lưu' },
  { key: 'instance-map', icon: MapTrifold, label: 'World map', labelVi: 'Bản đồ' },
  { key: 'instance-settings', icon: GearSix, label: 'Settings', labelVi: 'Cài đặt' },
]

const SUB_PAGE_PARENT = { 'instance-serverpack': 'instance-settings' }

const SERVER_LOCAL_PAGES = [
  { key: 'server-overview', icon: ChartLineUp, label: 'Overview', labelVi: 'Tổng quan' },
  { key: 'server-console', icon: Terminal, label: 'Console', labelVi: 'Bảng điều khiển' },
  { key: 'server-files', icon: Files, label: 'Files', labelVi: 'Tệp tin' },
  { key: 'server-databases', icon: Database, label: 'Databases', labelVi: 'Cơ sở dữ liệu' },
  { key: 'server-schedules', icon: Clock, label: 'Schedules', labelVi: 'Lịch trình' },
  { key: 'server-users', icon: Users, label: 'Users', labelVi: 'Người dùng' },
  { key: 'server-backups', icon: Archive, label: 'Backups', labelVi: 'Sao lưu' },
  { key: 'server-network', icon: Network, label: 'Network', labelVi: 'Mạng' },
  { key: 'server-startup', icon: Play, label: 'Startup', labelVi: 'Khởi động' },
  { key: 'server-settings', icon: GearSix, label: 'Settings', labelVi: 'Cài đặt' },
]

const loaderSlot = (inst) => (inst?.game === 'terraria' ? './terraria_slot.png' : loaderIcon(inst?.loader))

function Label({ text, progress, size, collapsed }) {
  return (
    <span
      className="relative min-w-0 flex-1 truncate text-left"
      style={{
        opacity: progress,
        transform: `translateX(${-8 * (1 - progress)}px)`,
        transition: 'opacity 110ms linear, transform 110ms linear',
        fontSize: size,
        fontWeight: 600,
        pointerEvents: collapsed ? 'none' : undefined,
      }}
    >
      {text}
    </span>
  )
}

function Pill({ y, show, c }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-0 right-0 z-0"
      style={{
        top: y,
        height: ROW_H,
        borderRadius: 15,
        background: c.surfaceActive,
        opacity: show ? 1 : 0,
        transition: `top 500ms ${SPRING}, opacity 180ms ease`,
      }}
    >
      <span
        aria-hidden
        className="absolute left-0"
        style={{
          top: 12,
          bottom: 12,
          width: 4,
          borderTopRightRadius: 4,
          borderBottomRightRadius: 4,
          background: `linear-gradient(120deg, ${c.accent}, ${c.accentHover})`,
        }}
      />
    </span>
  )
}

function NavRow({ c, icon: Icon, text, active, progress, onClick, rowKey, size = 14.5, collapsed }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      data-nav-key={rowKey}
      data-active={active ? 'true' : 'false'}
      data-tip={collapsed ? text : undefined}
      aria-label={collapsed ? text : undefined}
      aria-current={active ? 'page' : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative z-10 flex w-full shrink-0 cursor-pointer items-center"
      style={{
        height: ROW_H,
        paddingLeft: 16,
        paddingRight: 10,
        borderRadius: 15,
        gap: 14,
        opacity: active || hover ? 1 : 0.62,
        transition: 'opacity 150ms ease',
        color: c.text,
      }}
    >
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
        <Icon size={22} weight="duotone" />
      </span>
      <Label text={text} progress={progress} size={size} collapsed={collapsed} />
    </button>
  )
}

export default function Sidebar({
  theme, lang, version, account,
  instances, selectedInstance, onSelectInstance,
  isInInstance, displayPage, activePage, onNavigate, onBack,
  inLocalServer, onExitLocalServer,
  collapsed, onToggleCollapsed,
  accounts = [], activeAccountId, onSelectAccount,
}) {
  const c = palette(theme)
  const [width, setWidth] = useState(collapsed ? RAIL_W_COLLAPSED : RAIL_W)
  const widthRef = useRef(width)
  const rafRef = useRef(0)
  const [railHover, setRailHover] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState(null)
  const menuRef = useRef(null)
  const accBtnRef = useRef(null)

  // Vị trí menu tài khoản: bám theo nút, dùng position fixed để không bị card cắt.
  useEffect(() => {
    if (!menuOpen) return undefined
    const place = () => {
      const node = accBtnRef.current
      if (!node) return
      const r = node.getBoundingClientRect()
      setMenuPos({
        left: Math.round(r.left),
        bottom: Math.round(window.innerHeight - r.top + 6),
        width: collapsed ? 240 : Math.max(Math.round(r.width), 160),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [menuOpen, collapsed])

  const topGroup = useRef(null)
  const midGroup = useRef(null)
  const [hl, setHl] = useState({ top: { y: 0, show: false }, mid: { y: 0, show: false } })

  const p = clamp01((width - RAIL_W_COLLAPSED) / (RAIL_W - RAIL_W_COLLAPSED))
  const labelT = (order = 0) => clamp01((p - (0.15 + Math.min(order, 5) * 0.05)) / 0.45)
  const itemT = clamp01((p - 0.15) / 0.45)
  const nameT = clamp01((p - 0.3) / 0.5)

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    const from = widthRef.current
    const to = collapsed ? RAIL_W_COLLAPSED : RAIL_W
    if (from === to) return undefined
    const started = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - started) / ANIM_MS)
      const eased = 1 - Math.pow(1 - t, 3)
      const next = from + (to - from) * eased
      widthRef.current = next
      setWidth(next)
      if (t < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [collapsed])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // Menu tài khoản kiểu Rust: đóng khi bấm ra ngoài hoặc nhấn Esc.
  useEffect(() => {
    if (!menuOpen) return undefined
    const onDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const activeKey = inLocalServer
    ? displayPage
    : isInInstance
      ? SUB_PAGE_PARENT[displayPage] || displayPage
      : activePage

  useLayoutEffect(() => {
    const measure = (container) => {
      if (!container) return { y: 0, show: false }
      const el = container.querySelector('[data-active="true"]')
      if (!el) return { y: 0, show: false }
      const box = container.getBoundingClientRect()
      const row = el.getBoundingClientRect()
      return { y: row.top - box.top, show: true }
    }
    setHl((prev) => {
      const top = measure(topGroup.current)
      const mid = measure(midGroup.current)
      if (prev.top.show === top.show && Math.abs(prev.top.y - top.y) < 0.5 && prev.mid.show === mid.show && Math.abs(prev.mid.y - mid.y) < 0.5) {
        return prev
      }
      return { top, mid }
    })
  }, [activeKey, lang, collapsed, inLocalServer, isInInstance, instances.length])

  const row = (key, icon, text, active, order, onClick) => (
    <NavRow
      key={key}
      c={c}
      icon={icon}
      text={text}
      active={active}
      progress={labelT(order)}
      onClick={onClick}
      rowKey={key}
      collapsed={collapsed}
    />
  )

  const instanceRow = (inst) => {
    const selected = selectedInstance?.id === inst.id
    return (
      <InstanceRow
        key={inst.id}
        c={c}
        inst={inst}
        selected={selected}
        progress={itemT}
        collapsed={collapsed}
        onSelect={() => onSelectInstance(inst)}
      />
    )
  }

  const separator = (
    <div className="mx-[14px] h-px shrink-0" style={{ background: c.borderSoft }} />
  )

  return (
    <div
      className="xyo-rise absolute left-0 top-11 bottom-0 py-2 pl-2"
      style={{ width: width + 8, '--d': '.15s' }}
      onMouseEnter={() => setRailHover(true)}
      onMouseLeave={() => setRailHover(false)}
    >
      <div
        className="xyo-glass relative flex h-full flex-col overflow-hidden rounded-3xl"
        style={{ width, background: c.bar, border: `1px solid ${c.border}` }}
      >
        <div className="h-11 w-full shrink-0" />

        <div className="relative flex flex-col px-[10px] pb-[9px] pt-[2px]">
          <div ref={topGroup} className="relative flex w-full flex-col gap-1">
            <Pill y={hl.top.y} show={hl.top.show} c={c} />
            {inLocalServer
              ? row('server-list', ArrowLeft, lang === 'vi' ? 'Danh sách server' : 'Server list', false, 0, onExitLocalServer)
              : isInInstance
                ? row('back', ArrowLeft, t(lang, 'sidebar.home'), true, 0, onBack)
                : MAIN_PAGES.map((item, index) =>
                    row(
                      item.key,
                      item.icon,
                      lang === 'vi' ? item.labelVi : item.label,
                      activeKey === item.key,
                      index,
                      () => onNavigate(item.key),
                    ),
                  )}
          </div>
        </div>

        {separator}

        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-[10px] py-[9px]">
          <div ref={midGroup} className="relative flex w-full flex-col gap-1">
            <Pill y={hl.mid.y} show={hl.mid.show} c={c} />
            {inLocalServer
              ? SERVER_LOCAL_PAGES.map((item, index) =>
                  row(
                    item.key,
                    item.icon,
                    lang === 'vi' ? item.labelVi : item.label,
                    activeKey === item.key,
                    index,
                    () => onNavigate(item.key),
                  ),
                )
              : isInInstance
                ? INSTANCE_PAGES.map((item, index) =>
                    row(
                      item.key,
                      item.icon,
                      lang === 'vi' ? item.labelVi : item.label,
                      activeKey === item.key,
                      index,
                      () => onNavigate(item.key),
                    ),
                  )
                : (
                  <>
                    {row('versions', Plus, t(lang, 'sidebar.newInstance'), false, 0, () => onNavigate('versions'))}
                    {instances.length === 0 ? (
                      collapsed ? null : (
                        <p className="px-3 py-3 text-[11px] leading-relaxed" style={{ color: c.label }}>
                          {t(lang, 'sidebar.noInstances')}
                        </p>
                      )
                    ) : (
                      instances.map(instanceRow)
                    )}
                  </>
                )}
          </div>
        </div>

        {separator}

        <div className="flex shrink-0 flex-col gap-1.5 px-[10px] pb-3 pt-[9px]">
          <button
            ref={accBtnRef}
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            className="flex w-full cursor-pointer items-center"
            style={{
              height: 52,
              borderRadius: 16,
              paddingLeft: 10,
              paddingRight: 8,
              gap: 8,
              background: activeKey === 'accounts' || menuOpen ? c.surfaceActive : `${c.text}14`,
              transition: 'background 160ms ease',
            }}
            onMouseEnter={(event) => { event.currentTarget.style.background = c.hover }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = activeKey === 'accounts' || menuOpen ? c.surfaceActive : `${c.text}14`
            }}
          >
            {account ? (
              <HeadSkin name={account.name} uuid={account.uuid} type={account.type} size={34} radius={999} theme={theme} />
            ) : (
              <span
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
                style={{ background: `linear-gradient(140deg, ${c.accent}, ${c.accentHover})`, color: c.onAccent }}
              >
                ?
              </span>
            )}
            <span
              className="relative flex min-w-0 flex-1 flex-col overflow-hidden text-left"
              style={{ opacity: nameT, transform: `translateX(${-8 * (1 - nameT)}px)`, transition: 'opacity 110ms linear' }}
            >
              <span className="truncate text-[12.5px] font-semibold" style={{ color: c.text }}>
                {account ? account.name : t(lang, 'sidebar.noAccount')}
              </span>
              <span className="truncate text-[11px]" style={{ color: c.label }}>
                {lang === 'vi' ? 'Tài khoản' : 'Account'} · {version ? `v${version}` : 'v2.0.0'}
              </span>
            </span>
            <CaretRight
              size={16}
              weight="duotone"
              style={{
                color: c.label,
                transform: `rotate(${menuOpen ? 180 : 0}deg)`,
                transition: `transform 220ms ${SPRING}`,
                flexShrink: 0,
              }}
            />
          </button>
        </div>

        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          data-tip={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
            aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
          className="absolute right-0 top-[14px] z-20 flex h-9 w-8 items-center justify-center rounded-l-[10px]"
          style={{
            background: `${c.text}24`,
            opacity: collapsed && !railHover ? 0 : 1,
            transition: 'opacity 180ms ease, background 150ms ease',
            color: c.text,
          }}
          onMouseEnter={(event) => { event.currentTarget.style.background = `${c.text}38` }}
          onMouseLeave={(event) => { event.currentTarget.style.background = `${c.text}24` }}
        >
          <SidebarSimple
            size={16}
            weight="duotone"
            style={{ transform: `rotate(${collapsed ? 0 : 180}deg)`, transition: `transform 320ms ${SPRING}` }}
          />
        </button>
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          className="xyo-menu-in fixed z-[60] flex flex-col gap-0.5 rounded-[18px] p-1"
          style={{
            left: menuPos?.left ?? 18,
            bottom: menuPos?.bottom ?? 78,
            width: menuPos?.width ?? (collapsed ? 240 : Math.max(width - 20, 160)),
            background: c.surface,
            border: `1px solid ${c.border}`,
            boxShadow: c.shadow,
          }}
        >
          <div className="flex h-6 items-center px-2.5 text-[10.5px] font-bold" style={{ color: c.faint }}>
            {lang === 'vi' ? 'TÀI KHOẢN' : 'ACCOUNTS'}
          </div>

          {accounts.length === 0 ? (
            <div className="flex h-10 items-center px-2.5 text-[12px]" style={{ color: c.label }}>
              {t(lang, 'sidebar.noAccount')}
            </div>
          ) : (
            accounts.map((acc) => {
              const active = acc.id === activeAccountId
              return (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    onSelectAccount?.(acc)
                  }}
                  className="flex h-[46px] w-full cursor-pointer items-center gap-2 rounded-xl px-1.5 text-left"
                  style={{ background: 'transparent' }}
                  onMouseEnter={(event) => { event.currentTarget.style.background = c.hover }}
                  onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}
                >
                  <HeadSkin name={acc.name} uuid={acc.uuid} type={acc.type} size={30} radius={999} theme={theme} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-semibold" style={{ color: c.text }}>{acc.name}</span>
                    <span className="text-[10.5px]" style={{ color: c.label }}>
                      {acc.type === 'microsoft' ? 'Microsoft' : acc.type === 'ely' ? 'Ely.by' : 'Offline'}
                    </span>
                  </span>
                  {active && <Check size={16} weight="bold" style={{ color: c.accent, flexShrink: 0 }} />}
                </button>
              )
            })
          )}

          <div className="my-1 h-px" style={{ background: c.borderSoft }} />

          {[
            { key: 'accounts', icon: User, label: lang === 'vi' ? 'Quản lý tài khoản' : 'Manage accounts' },
            { key: 'settings', icon: Gear, label: lang === 'vi' ? 'Cài đặt hệ thống' : 'System settings' },
          ].map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  onNavigate(item.key)
                }}
                className="flex h-[46px] w-full cursor-pointer items-center gap-2 rounded-xl px-1.5 text-left"
                style={{ background: 'transparent' }}
                onMouseEnter={(event) => { event.currentTarget.style.background = c.hover }}
                onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}
              >
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center">
                  <Icon size={17} weight="duotone" style={{ color: c.label }} />
                </span>
                <span className="truncate whitespace-nowrap text-[13px] font-medium" style={{ color: c.text }}>{item.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function InstanceRow({ c, inst, selected, progress, collapsed, onSelect }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      onClick={onSelect}
      data-nav-key={inst.id}
      data-active={selected ? 'true' : 'false'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative z-10 flex w-full shrink-0 cursor-pointer items-center"
      style={{
        height: ROW_H,
        paddingLeft: 14,
        paddingRight: 10,
        borderRadius: 15,
        gap: 10,
        opacity: selected || hover ? 1 : 0.62,
        transition: 'opacity 150ms ease',
        color: c.text,
      }}
    >
      <img
        src={loaderSlot(inst)}
        alt=""
        className="h-[26px] w-[26px] shrink-0 rounded-md object-cover"
        onError={(event) => {
          const el = event.currentTarget
          if (el.dataset.fallback) return
          el.dataset.fallback = '1'
          el.src = loaderSlot(inst)
        }}
      />
      <Label text={inst.name} progress={progress} size={13.5} collapsed={collapsed} />
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: statusColor(inst.status) }} />
    </button>
  )
}
