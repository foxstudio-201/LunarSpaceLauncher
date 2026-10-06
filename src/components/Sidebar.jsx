import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  House, Gear, List, Terminal, Files, Archive, User, Trash,
  Cube, PuzzlePiece, Stack, GearSix, ArrowLeft, ChartLineUp, SidebarSimple, Image, PaintBrush, Plus,
} from '@phosphor-icons/react'
import { t } from '../i18n/translations'
import { statusColor } from '../lib/status'
import { palette } from '../lib/palette'
import { loaderIcon } from '../api/client.js'
import HeadSkin from './ui/HeadSkin'

export const RAIL_W = 180
export const RAIL_W_COLLAPSED = 64

const ACCENT = '#a78bfa'
const ICON = 28
const HEAD = 28
const LABEL_W = 124
const FILLET = 14
const EDGE = 8
const RADIUS = 10
const HOOK = 14
const GAP = 12
const SWEEP_MS = 300
const SWEEP = `${SWEEP_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`
const LINE_TOP = -44

const MAIN_PAGES = [
  { key: 'home', icon: House, label: 'Home', labelVi: 'Trang chủ' },
  { key: 'versions', icon: Cube, label: 'Versions', labelVi: 'Phiên bản' },
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
  { key: 'instance-settings', icon: GearSix, label: 'Settings', labelVi: 'Cài đặt' },
]

export default function Sidebar({
  theme, lang, version, account,
  instances, selectedInstance, onSelectInstance,
  isInInstance, displayPage, activePage, onNavigate, onBack,
  collapsed, onToggleCollapsed,
}) {
  const navRef = useRef(null)
  const listRef = useRef(null)
  const [pill, setPill] = useState({ y: 0, h: 0, show: false })

  const c = palette(theme)
  const px = c.pixel
  const sidebarBg = px ? c.bg : theme === 'light' ? '#f5f5f5' : '#0a0a0a'
  const labelColor = px ? c.label : theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = px ? c.border : theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const pillBg = px ? c.surface : theme === 'light' ? '#ece8f6' : '#1d1927'
  const handleBg = px ? c.input : theme === 'light' ? '#ffffff' : '#1a1a1a'
  const accent = px ? c.accent : ACCENT

  const activeKey = isInInstance ? displayPage : activePage
  const railW = collapsed ? RAIL_W_COLLAPSED : RAIL_W

  const measure = useCallback(() => {
    const nav = navRef.current
    if (!nav) return
    const el = nav.querySelector(`[data-nav-key="${activeKey}"]`)
    if (!el) {
      setPill((p) => (p.show ? { ...p, show: false } : p))
      return
    }
    const navBox = nav.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    const group = el.closest('[data-nav-group]')
    const rows = group ? [...group.querySelectorAll('[data-nav-row]')] : []
    setPill({
      y: box.top - navBox.top,
      h: box.height,
      show: true,
      flareTop: rows.length > 0 && rows[0] !== el,
      flareBottom: rows.length > 0 && rows[rows.length - 1] !== el,
    })
  }, [activeKey])

  useLayoutEffect(() => {
    measure()
  }, [measure, collapsed, lang, instances.length, isInInstance, version])

  useEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    list.addEventListener('scroll', measure, { passive: true })
    return () => list.removeEventListener('scroll', measure)
  }, [measure])

  useEffect(() => {
    const nav = navRef.current
    if (!nav || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => measure())
    for (const group of nav.querySelectorAll('[data-nav-group]')) observer.observe(group)
    return () => observer.disconnect()
  }, [measure])

  const rowClass = (tall, extra = '') =>
    `group relative w-full shrink-0 flex items-center pl-5.5 pr-3.5 text-left cursor-pointer ` +
    `[&:first-of-type_.flare-top]:hidden [&:last-of-type_.flare-bottom]:hidden ` +
    `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[${accent}] ` +
    `${tall ? 'h-10' : 'h-9'} ${extra}`

  const flare = (top, bottom, color) => (
    <>
      {top && (
        <span
          data-px-hair
          className="flare-top absolute right-0"
          style={{
            width: FILLET,
            height: FILLET,
            top: -FILLET,
            background: `radial-gradient(circle at 0% 0%, transparent ${FILLET}px, ${color} ${FILLET}px)`,
          }}
        />
      )}
      {bottom && (
        <span
          data-px-hair
          className="flare-bottom absolute right-0"
          style={{
            width: FILLET,
            height: FILLET,
            bottom: -FILLET,
            background: `radial-gradient(circle at 0% 100%, transparent ${FILLET}px, ${color} ${FILLET}px)`,
          }}
        />
      )}
    </>
  )

  const block = (color) => (
    <span
      data-px-hair
      className="absolute inset-y-0 left-0 right-0"
      style={{
        background: color,
        borderTopLeftRadius: RADIUS,
        borderBottomLeftRadius: RADIUS,
      }}
    />
  )

  const blockOutline = (color, flareTop, flareBottom) => (
    <>
      <span
        data-nav-tab
        className="absolute inset-y-0 left-0"
        style={{
          right: FILLET + 1,
          borderTop: `1px solid ${color}`,
          borderBottom: `1px solid ${color}`,
          borderLeft: `1px solid ${color}`,
          borderRight: 'none',
          borderTopLeftRadius: RADIUS,
          borderBottomLeftRadius: RADIUS,
        }}
      />
      {!flareTop && (
        <span data-nav-tab className="absolute right-0" style={{ top: 0, width: FILLET + 1, height: 1, background: color }} />
      )}
      {!flareBottom && (
        <span data-nav-tab className="absolute right-0" style={{ bottom: 0, width: FILLET + 1, height: 1, background: color }} />
      )}
    </>
  )

  const flareOutline = (top, bottom, color) => (
    <>
      {top && (
        <span
          data-nav-tab
          className="flare-top absolute"
          style={{
            right: 1, width: FILLET, height: FILLET, top: -FILLET + 1,
            borderBottom: `1px solid ${color}`,
            borderRight: `1px solid ${color}`,
            borderTop: 'none',
            borderLeft: 'none',
            borderBottomRightRadius: '100%',
          }}
        />
      )}
      {bottom && (
        <span
          data-nav-tab
          className="flare-bottom absolute"
          style={{
            right: 1, width: FILLET, height: FILLET, bottom: -FILLET + 1,
            borderTop: `1px solid ${color}`,
            borderRight: `1px solid ${color}`,
            borderBottom: 'none',
            borderLeft: 'none',
            borderTopRightRadius: '100%',
          }}
        />
      )}
    </>
  )

  const rowTint = () => (
    <span aria-hidden className="absolute inset-y-0 right-[-1px]" style={{ left: EDGE }}>
      {block(pillBg)}
      {flare(true, true, pillBg)}
    </span>
  )

  const hoverBar = (inset = EDGE) => (
    <span
      aria-hidden
      className="nav-bar-grow absolute rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-150"
      style={{ left: inset, width: 3, height: 18, top: 'calc(50% - 9px)', background: accent }}
    />
  )

  const rowPad = (iconW) =>
    collapsed
      ? { paddingLeft: Math.max(0, (RAIL_W_COLLAPSED - iconW) / 2), transition: `padding-left ${SWEEP}` }
      : undefined

  const label = (text, active) => (
    <span
      className="relative z-20 overflow-hidden whitespace-nowrap"
      style={{ maxWidth: collapsed ? 0 : LABEL_W, transition: `max-width ${SWEEP}` }}
    >
      <span className={`pl-2.5 text-xs ${active ? 'font-semibold' : 'font-medium'}`}>{text}</span>
    </span>
  )

  const navKeyProps = (key, text) => ({
    'data-nav-key': key,
    'data-tip': collapsed ? text : undefined,
    'aria-current': activeKey === key ? 'page' : undefined,
  })

  const loaderSlot = (inst) => (inst?.game === 'terraria' ? './terraria_slot.png' : loaderIcon(inst?.loader))
  const slotIcon = (inst) => inst?.icon || loaderSlot(inst)

  const list = (
    <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-0.5">
      {(
        INSTANCE_PAGES.map((p) => {
          const Icon = p.icon
          const text = lang === 'vi' ? p.labelVi : p.label
          const isActive = activeKey === p.key
          return (
            <button
              type="button"
              key={p.key}
              onClick={() => onNavigate(p.key)}
              {...navKeyProps(p.key, text)}
              data-nav-row
              className={rowClass(false)}
              style={{ ...rowPad(ICON), color: isActive ? accent : labelColor }}
            >
              {!isActive && hoverBar()}
              <Icon size={ICON} weight="duotone" className="relative z-20 shrink-0" />
              {label(text, isActive)}
            </button>
          )
        })
      )}
    </div>
  )

  return (
    <nav
      ref={navRef}
      className="absolute left-0 top-11 bottom-0 z-50 flex flex-col py-3"
      data-surface
      style={{ width: railW, backgroundColor: sidebarBg, gap: GAP, transition: `width ${SWEEP}` }}
    >
      <div
        aria-hidden
        data-nav-pill
        className="absolute z-10 pointer-events-none"
        style={{
          left: EDGE,
          right: px ? 8 : -1,
          top: 0,
          height: pill.h,
          opacity: pill.show ? 1 : 0,
          transform: `translateY(${pill.y}px)`,
          border: px ? `2px solid ${c.border}` : undefined,
          borderRadius: px ? RADIUS : undefined,
          boxShadow: px ? c.shadowSm : undefined,
          transition: `transform ${SWEEP}, height ${SWEEP}, opacity 150ms linear`,
        }}
      >
        <span className="absolute inset-0" style={px ? { display: 'none' } : undefined}>
          <span
            aria-hidden
            className="absolute"
            style={{
              right: 0,
              width: 4,
              top: pill.flareTop ? -FILLET : 0,
              bottom: pill.flareBottom ? -FILLET : 0,
              backgroundColor: sidebarBg,
              backgroundImage: px ? 'var(--px-dither)' : undefined,
              backgroundSize: px ? '4px 4px' : undefined,
            }}
          />
          <span data-nav-pill-outline className="absolute inset-0">
            {blockOutline(borderColor, pill.flareTop, pill.flareBottom)}
            {flareOutline(pill.flareTop, pill.flareBottom, borderColor)}
          </span>
        </span>
      </div>

      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        data-tip={t(lang, collapsed ? 'sidebar.expand' : 'sidebar.collapse')}
        className={`absolute top-[14px] left-[calc(100%-12px)] z-50 w-6 h-6 rounded-md flex items-center justify-center cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[${accent}]`}
        style={{ background: handleBg, border: `1px solid ${borderColor}`, color: labelColor }}
      >
        <SidebarSimple
          size={14}
          weight="duotone"
          className={`transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`}
        />
      </button>

      <div data-nav-group className="relative shrink-0 flex flex-col gap-1 pb-2">
        <span
          aria-hidden
          data-nav-ornament
          className="absolute right-0 w-px pointer-events-none"
          style={{ top: LINE_TOP, bottom: HOOK, background: borderColor }}
        />
        <span
          aria-hidden
          data-nav-ornament
          className="absolute left-0 right-0 bottom-0 h-3.5 border-b border-r rounded-br-[14px] pointer-events-none"
          style={{ borderColor }}
        />

        {!isInInstance && MAIN_PAGES.filter((p) => p.key !== 'versions').map((p) => {
          const Icon = p.icon
          const text = lang === 'vi' ? p.labelVi : p.label
          const isActive = activeKey === p.key
          return (
            <button
              type="button"
              key={p.key}
              onClick={() => onNavigate(p.key)}
              {...navKeyProps(p.key, text)}
              data-nav-row
              className={rowClass(true)}
              style={{ ...rowPad(ICON), color: isActive ? accent : labelColor }}
            >
              {!isActive && hoverBar()}
              <Icon size={ICON} weight="duotone" className="relative z-20 shrink-0" />
              {label(text, isActive)}
            </button>
          )
        })}

        {isInInstance && (
          <button
            type="button"
            onClick={onBack}
            data-tip={collapsed ? t(lang, 'sidebar.home') : undefined}
            data-nav-row
            className={rowClass(true)}
            style={{ ...rowPad(ICON), color: labelColor }}
          >
            {hoverBar()}
            <ArrowLeft size={ICON} weight="duotone" className="relative z-20 shrink-0" />
            {label(t(lang, 'sidebar.home'), false)}
          </button>
        )}
      </div>

      <div data-nav-group className="relative flex-1 min-h-0 flex flex-col py-3.5">
        <span
          aria-hidden
          data-nav-ornament
          className="absolute left-0 right-0 top-0 h-3.5 border-t border-r rounded-tr-[14px] pointer-events-none"
          style={{ borderColor }}
        />
        <span
          aria-hidden
          data-nav-ornament
          className="absolute right-0 w-px pointer-events-none"
          style={{ top: HOOK, bottom: HOOK, background: borderColor }}
        />
        <span
          aria-hidden
          data-nav-ornament
          className="absolute left-0 right-0 bottom-0 h-3.5 border-b border-r rounded-br-[14px] pointer-events-none"
          style={{ borderColor }}
        />
        {isInInstance ? list : (
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => onNavigate('versions')}
              data-tip={collapsed ? t(lang, 'sidebar.newInstance') : undefined}
              data-nav-row
              className={rowClass(false)}
              style={{ ...rowPad(ICON), color: labelColor }}
            >
              {hoverBar()}
              <Plus size={ICON} weight="duotone" className="relative z-20 shrink-0" />
              {label(t(lang, 'sidebar.newInstance'), false)}
            </button>
            {instances.length === 0 ? (
              <p className="px-3 py-3 text-[11px] leading-relaxed" style={{ color: labelColor }}>
                {t(lang, 'sidebar.noInstances')}
              </p>
            ) : (
              instances.map((inst) => {
                const isSelected = selectedInstance?.id === inst.id
                return (
                  <button
                    type="button"
                    key={inst.id}
                    onClick={() => onSelectInstance(inst)}
                    data-tip={collapsed ? inst.name : undefined}
                    data-nav-row
                    className={rowClass(false)}
                    style={{ ...rowPad(ICON), color: isSelected ? accent : labelColor, background: isSelected ? pillBg : undefined, borderRadius: RADIUS }}
                  >
                    {!isSelected && hoverBar()}
                    <img
                      src={slotIcon(inst)}
                      alt=""
                      className="relative z-20 w-7 h-7 rounded-md object-cover shrink-0"
                      onError={(event) => {
                        const el = event.currentTarget
                        if (el.dataset.fallback) return
                        el.dataset.fallback = '1'
                        el.src = loaderSlot(inst)
                      }}
                    />
                    {label(inst.name, isSelected)}
                    <span className="relative z-20 ml-auto w-2 h-2 rounded-full shrink-0" style={{ background: statusColor(inst.status) }} />
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>

      <div data-nav-group className="relative shrink-0 flex flex-col gap-1 pt-2">
        <span
          aria-hidden
          data-nav-ornament
          className="absolute left-0 right-0 top-0 h-3.5 border-t border-r rounded-tr-[14px] pointer-events-none"
          style={{ borderColor }}
        />
        <span
          aria-hidden
          data-nav-ornament
          className="absolute right-0 w-px pointer-events-none"
          style={{ top: HOOK, bottom: 0, background: borderColor }}
        />

        <button
          type="button"
          onClick={() => onNavigate('accounts')}
          {...navKeyProps('accounts', account ? account.name : t(lang, 'accounts.title'))}
          data-nav-row
          className={rowClass(true)}
          style={{ ...rowPad(HEAD), color: activeKey === 'accounts' ? accent : labelColor }}
        >
          {activeKey !== 'accounts' && hoverBar()}
          {account ? (
            <HeadSkin
              name={account.name}
              uuid={account.uuid}
              type={account.type}
              size={HEAD}
              radius={8}
              theme={theme}
              style={{ position: 'relative', zIndex: 20 }}
            />
          ) : (
            <User size={ICON} weight="duotone" className="relative z-20 shrink-0" />
          )}
          {label(account ? account.name : t(lang, 'sidebar.noAccount'), activeKey === 'accounts')}
        </button>

        <button
          type="button"
          onClick={() => onNavigate('settings')}
          {...navKeyProps('settings', t(lang, 'sidebar.settings'))}
          data-nav-row
          className={rowClass(true)}
          style={{ ...rowPad(ICON), color: activeKey === 'settings' ? accent : labelColor }}
        >
          {activeKey !== 'settings' && hoverBar()}
          <Gear size={ICON} weight="duotone" className="relative z-20 shrink-0" />
          {label(t(lang, 'sidebar.settings'), activeKey === 'settings')}
        </button>

        <span
          className="text-[9px] font-mono leading-none whitespace-nowrap select-none overflow-hidden self-center"
          style={{ color: labelColor, maxWidth: collapsed ? 0 : 60, transition: `max-width ${SWEEP}` }}
        >
          {version ? `v${version}` : 'v1.0.0'}
        </span>
      </div>
    </nav>
  )
}
