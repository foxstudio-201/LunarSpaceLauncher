import { useEffect, useMemo, useState } from 'react'
import {
  Cube, Users, Backpack, Sparkle, Sliders, FileCode, Info, Plus, X, Copy, ArrowsDownUp,
  ArrowLineUp, ArrowLineDown, ArrowSquareOut, ArrowsClockwise, Clock, CloudRain, Sun, Lightning,
  Crosshair, BoundingBox, ListBullets, Heart, ForkKnife, Star, NavigationArrow, Speedometer,
  ShieldCheck, IdentificationCard, MagicWand, PencilSimple, ClipboardText, Clipboard,
  WarningCircle, Trash, CheckCircle, Lock, LockOpen, MapPin, Sword, PaintBrush, MapTrifold, Eye,
} from '@phosphor-icons/react'
import { formatBytes, formatDate } from '../../../lib/status'
import {
  walk, stepPath, parentOf, childIndexOf, newTag, cloneNode, coerceScalar, convertNode,
  countOf, summaryOf, snbtValue, snbtDocument, snbtParse, snbtParseValue, statsOf, prettyId,
  uuidFromIntArray, uuidToIntArray, isContainer, isArrayType, ARRAY_ELEMENT, CONTAINERS,
  PRIMITIVES, ALL_TYPES, INTEGERS, typeLabel, TYPE_TONE, EFFECT_NAMES, ATTR_NAMES,
  ITEM_IDS, GAMERULES, num,
} from '../../../lib/nbt'
import { Section, Field, NumField, TextField, Drop, Toggle, Btn, Note, Grid, TypeChip, Empty } from './kit'

export const TABS = [
  { key: 'quick', label: 'Nhanh', icon: MagicWand },
  { key: 'world', label: 'Thế giới', icon: Cube },
  { key: 'player', label: 'Người chơi', icon: Users },
  { key: 'items', label: 'Vật phẩm', icon: Backpack },
  { key: 'effects', label: 'Hiệu ứng', icon: Sparkle },
  { key: 'attributes', label: 'Thuộc tính', icon: Sliders },
  { key: 'snbt', label: 'SNBT', icon: FileCode },
  { key: 'overview', label: 'Tổng quan', icon: Info },
]

const join = (base, key) => (base ? stepPath(base, key) : key)
const hexByte = (value) => `0x${(Number(value) & 0xff).toString(16).toUpperCase().padStart(2, '0')}`
const secs = (ticks) => Math.round((Number(ticks) || 0) / 20)

const withList = (tree, base, key, create) => {
  let target = walk(tree, join(base, key))
  if (target) return target
  const parent = walk(tree, base)
  if (!parent || !Array.isArray(parent.value)) return null
  target = newTag('list', key, [])
  parent.value.push(target)
  if (create !== undefined) target.value.push(create)
  return target
}

function Head({ c, icon: Icon, title, right }) {
  return (
    <div className="flex items-center gap-1.5 px-1">
      <Icon size={14} weight="duotone" style={{ color: c.accent }} />
      <span className="text-[11.5px] font-bold uppercase tracking-wider" style={{ color: c.text }}>{title}</span>
      <span className="flex-1" />
      {right}
    </div>
  )
}

function IconBtn({ c, icon: Icon, onClick, title, tone }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-6 h-6 rounded flex items-center justify-center shrink-0 hover:opacity-80"
      style={{ background: tone ? `${tone}22` : c.surface, border: `1px solid ${tone ? `${tone}44` : c.border}`, color: tone || c.label }}
    >
      <Icon size={12} weight="duotone" />
    </button>
  )
}

function RowCard({ c, children, tone }) {
  return (
    <div className="rounded-md px-2 py-1.5 flex flex-col gap-1.5 min-w-0" style={{ background: c.surface, border: `1px solid ${tone || c.border}` }}>
      {children}
    </div>
  )
}

export function PanelQuick({ ctx }) {
  const { c, lang, vn, ops, tree, selection, file } = ctx
  const node = selection.node
  const [snbtOpen, setSnbtOpen] = useState(false)
  const [snbtText, setSnbtText] = useState('')
  const [snbtError, setSnbtError] = useState('')
  const [bulk, setBulk] = useState('')
  const [hexOn, setHexOn] = useState(false)
  const [renameTo, setRenameTo] = useState('')
  const [addType, setAddType] = useState('string')
  const [addName, setAddName] = useState('newTag')
  const [keepValue, setKeepValue] = useState(true)

  useEffect(() => {
    setRenameTo(node ? node.name : '')
    setSnbtOpen(false)
    setSnbtError('')
    setBulk(node && isArrayType(node.type) ? (node.value || []).join(' ') : '')
  }, [selection.path, node])

  if (!node) {
    const roots = (tree?.value || [])
    return (
      <div className="flex flex-col gap-2.5">
        <Head c={c} icon={MagicWand} title={vn(lang, 'Chọn một tag trong cây', 'Pick a tag in the tree')} />
        <Empty c={c}>
          {vn(lang, 'Bấm vào tên khoá ở cây bên trái để mở toàn bộ công cụ sửa: đổi giá trị, đổi kiểu, đổi tên, nhân bản, di chuyển, SNBT.', 'Click a key in the tree to open the full toolbox: value, type, rename, duplicate, move, SNBT.')}
        </Empty>
        <Section c={c} title={vn(lang, 'Khoá gốc', 'Top-level keys')} icon={ListBullets}>
          <div className="flex flex-wrap gap-1">
            {roots.slice(0, 40).map((item) => (
              <button
                key={item.name}
                onClick={() => ops.jump(item.name)}
                className="h-7 px-2.5 rounded text-[11.5px] font-mono inline-flex items-center gap-1"
                style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
              >
                {item.name}
                <span style={{ color: TYPE_TONE[item.type] }}>{summaryOf(item) || ''}</span>
              </button>
            ))}
          </div>
        </Section>
      </div>
    )
  }

  const parentPath = parentOf(selection.path)
  const parent = walk(tree, parentPath)
  const index = childIndexOf(selection.path, parent)
  const isRootChild = parentPath === ''
  const keyEditable = !!parent && parent.type === 'compound'
  const tone = TYPE_TONE[node.type] || c.label
  const applyBulk = () => {
    const parts = String(bulk).split(/[\s,;]+/).filter(Boolean)
    const element = ARRAY_ELEMENT[node.type]
    const values = parts.map((part) => coerceScalar(element, part.replace(/[bBsSlL]$/, '')))
    ops.mutate(() => { node.value = values }, `bulk:${selection.path}`)
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Head c={c} icon={MagicWand} title={vn(lang, 'Tag đang chọn', 'Selected tag')} right={<TypeChip type={node.type} />} />
      <p className="text-[11.5px] font-mono break-all px-1" style={{ color: c.label }}>
        {file} › {String(selection.path).replace(/\|/g, ' › ')}
      </p>

      <div className="flex flex-wrap gap-1">
        <Btn c={c} size="sm" icon={Copy} onClick={() => ops.copy(selection.path)}>
          {vn(lang, 'Sao chép SNBT', 'Copy SNBT')}
        </Btn>
        <Btn
          c={c}
          size="sm"
          icon={Clipboard}
          disabled={!ctx.clip}
          title={ctx.clip ? '' : vn(lang, 'Clipboard trống — sao chép một tag trước.', 'Clipboard is empty — copy a tag first.')}
          onClick={() => (isContainer(node.type) ? ops.pasteInto(selection.path) : ops.pasteOver(selection.path))}
        >
          {isContainer(node.type) ? vn(lang, 'Dán vào trong', 'Paste inside') : vn(lang, 'Thay bằng clipboard', 'Replace from clipboard')}
        </Btn>
        <Btn c={c} size="sm" icon={ArrowLineUp} disabled={index <= 0} onClick={() => ops.move(selection.path, -1)}>
          {vn(lang, 'Lên', 'Up')}
        </Btn>
        <Btn c={c} size="sm" icon={ArrowLineDown} disabled={!parent || index < 0 || index >= countOf(parent) - 1} onClick={() => ops.move(selection.path, 1)}>
          {vn(lang, 'Xuống', 'Down')}
        </Btn>
        <Btn c={c} size="sm" icon={ArrowsDownUp} onClick={() => ops.duplicate(selection.path)}>
          {vn(lang, 'Nhân bản', 'Duplicate')}
        </Btn>
        <Btn c={c} size="sm" tone="danger" icon={Trash} onClick={() => ops.remove(selection.path)}>
          {vn(lang, 'Xoá', 'Delete')}
        </Btn>
      </div>

      {isContainer(node.type) ? (
        <Section c={c} title={vn(lang, node.type === 'list' ? 'Thêm phần tử' : 'Thêm tag con', node.type === 'list' ? 'Add element' : 'Add child tag')} icon={Plus}>
          <Grid cols={node.type === 'list' ? 1 : 2}>
            <Drop
              c={c}
              theme={ctx.theme}
              value={addType}
              onChange={setAddType}
              options={ALL_TYPES.map((type) => ({ value: type, label: typeLabel(type), tone: TYPE_TONE[type] }))}
            />
            {node.type === 'compound' ? (
              <TextField c={c} value={addName} onChange={setAddName} placeholder={vn(lang, 'Tên khoá', 'Key')} />
            ) : null}
          </Grid>
          <Btn
            c={c}
            wide
            tone="accent"
            icon={Plus}
            onClick={() => {
              const name = node.type === 'list' ? '' : addName
              const child = newTag(addType, name, undefined)
              ops.mutate(() => { node.value.push(child) })
              setAddName('newTag')
            }}
          >
            {vn(lang, 'Thêm vào ngay', 'Add now')}
          </Btn>
        </Section>
      ) : null}

      {isArrayType(node.type) ? (
        <Section
          c={c}
          title={vn(lang, `Mảng ${node.value.length} phần tử`, `Array · ${node.value.length} entries`)}
          icon={ListBullets}
          right={node.type === 'byteArray' ? (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); setHexOn((prev) => !prev) }}
              className="text-[10.5px] font-mono px-1 rounded"
              style={{ background: hexOn ? `${c.accent}22` : c.surface, border: `1px solid ${c.border}`, color: hexOn ? c.accent : c.faint }}
            >
              HEX
            </span>
          ) : null}
        >
          <div className="grid grid-cols-3 gap-1 max-h-[200px] overflow-y-auto pr-0.5">
            {(node.value || []).slice(0, 200).map((item, i) => (
              <div key={i} className="flex items-center gap-0.5">
                <span className="text-[10px] font-mono w-5 text-right shrink-0" style={{ color: c.faint }}>{i}</span>
                <input
                  value={hexOn ? hexByte(item) : String(item)}
                  onChange={(e) => {
                    const raw = hexOn ? e.target.value.replace(/^0x/i, '') : e.target.value
                    ops.mutate(() => { node.value[i] = coerceScalar(ARRAY_ELEMENT[node.type], raw) }, `arr:${selection.path}:${i}`)
                  }}
                  className="h-7 px-2 rounded text-[10.5px] font-mono outline-none w-full min-w-0"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: tone }}
                />
                <IconBtn c={c} icon={X} tone="#f87171" title={vn(lang, 'Bỏ phần tử', 'Remove')} onClick={() => ops.mutate(() => { node.value.splice(i, 1) })} />
              </div>
            ))}
          </div>
          <Field c={c} label={vn(lang, 'Dán danh sách (cách nhau bằng dấu cách, phẩy hoặc xuống dòng)', 'Paste list (space, comma or newline separated)')}>
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              spellCheck={false}
              className="min-h-[64px] px-2 py-1 rounded-md text-[11.5px] font-mono outline-none resize-y"
              style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.text }}
            />
          </Field>
          <Grid cols={3}>
            <Btn c={c} size="sm" icon={CheckCircle} tone="accent" onClick={applyBulk}>{vn(lang, 'Áp dụng', 'Apply')}</Btn>
            <Btn c={c} size="sm" icon={Plus} onClick={() => ops.mutate(() => { node.value.push(0) })}>{vn(lang, 'Thêm ô', 'Append')}</Btn>
            <Btn c={c} size="sm" icon={Trash} tone="danger" onClick={() => ops.mutate(() => { node.value = [] })}>{vn(lang, 'Xoá hết', 'Clear')}</Btn>
          </Grid>
        </Section>
      ) : null}

      {PRIMITIVES.includes(node.type) ? (
        <Section c={c} title={vn(lang, 'Giá trị', 'Value')} icon={PencilSimple}>
          {node.type === 'string' ? (
            <textarea
              value={String(node.value ?? '')}
              onChange={(e) => ops.mutate(() => { node.value = e.target.value }, `val:${selection.path}`)}
              spellCheck={false}
              className="min-h-[60px] px-2 py-1 rounded-md text-[11px] font-mono outline-none resize-y"
              style={{ background: c.surface, border: `1px solid ${c.border}`, color: TYPE_TONE.string }}
            />
          ) : (
            <NumField
              c={c}
              value={node.type === 'long' ? Number(node.value) : node.value}
              step={node.type === 'float' || node.type === 'double' ? 0.1 : 1}
              onChange={(value) => ops.mutate(() => { node.value = coerceScalar(node.type, value) }, `val:${selection.path}`)}
            />
          )}
          {node.type === 'long' ? (
            <TextField c={c} value={String(node.value)} onChange={(value) => ops.mutate(() => { node.value = coerceScalar('long', value) }, `val:${selection.path}`)} />
          ) : null}
          {INTEGERS.includes(node.type) ? (
            <div className="flex flex-wrap items-center gap-1 text-[10.5px] font-mono" style={{ color: c.faint }}>
              <span>dec {Math.trunc(num(node.value))}</span>
              <span>hex {`0x${(Math.trunc(num(node.value)) >>> 0).toString(16).toUpperCase()}`}</span>
              {node.type === 'byte' ? <span>byte {hexByte(node.value)}</span> : null}
              {node.type === 'int' ? <span>unsigned {(Math.trunc(num(node.value)) >>> 0)}</span> : null}
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section c={c} title={vn(lang, 'Thuộc tính tag', 'Tag properties')} icon={Sliders}>
        <Grid cols={2}>
          <Field c={c} label={vn(lang, 'Kiểu', 'Type')}>
            <Drop
              c={c}
              theme={ctx.theme}
              value={node.type}
              onChange={(value) => ops.mutate(() => {
                const next = keepValue ? convertNode(node, value) : { type: value, name: node.name, value: undefined }
                node.type = next.type
                node.value = next.value === undefined ? newTag(value).value : next.value
              })}
              options={ALL_TYPES.map((type) => ({ value: type, label: typeLabel(type), tone: TYPE_TONE[type] }))}
            />
          </Field>
          <Field c={c} label={vn(lang, 'Tên khoá', 'Key name')}>
            <TextField
              c={c}
              value={renameTo}
              disabled={!keyEditable}
              title={keyEditable ? '' : vn(lang, 'Phần tử list không có tên khoá.', 'List entries have no key name.')}
              onChange={setRenameTo}
              onBlur={() => { if (renameTo && renameTo !== node.name && keyEditable) ops.rename(selection.path, renameTo) }}
            />
          </Field>
        </Grid>
        <Toggle
          c={c}
          on={keepValue}
          icon={keepValue ? Lock : LockOpen}
          label={vn(lang, 'Giữ giá trị khi đổi kiểu', 'Keep value on type change')}
          onClick={() => setKeepValue((prev) => !prev)}
        />
        {isRootChild ? null : <Empty c={c}>{vn(lang, 'Tag con của compound có thể đổi tên; phần tử list thì không.', 'Compound children can be renamed; list entries cannot.')}</Empty>}
      </Section>

      <Section
        c={c}
        title={vn(lang, 'SNBT của tag này', 'SNBT of this tag')}
        icon={FileCode}
        defaultOpen={false}
      >
        <Btn
          c={c}
          size="sm"
          wide
          icon={ArrowSquareOut}
          onClick={() => {
            setSnbtText(snbtValue(node))
            setSnbtOpen(true)
            setSnbtError('')
          }}
        >
          {vn(lang, 'Mở nội dung SNBT', 'Open SNBT body')}
        </Btn>
        {snbtOpen ? (
          <>
            <textarea
              value={snbtText}
              onChange={(e) => setSnbtText(e.target.value)}
              spellCheck={false}
              className="min-h-[130px] px-2 py-1 rounded-md text-[11.5px] font-mono outline-none resize-y"
              style={{ background: c.surface, border: `1px solid ${snbtError ? 'rgba(239,68,68,0.5)' : c.border}`, color: c.text }}
            />
            {snbtError ? <Note c={c} tone="bad" icon={WarningCircle}>{snbtError}</Note> : null}
            <Grid cols={2}>
              <Btn
                c={c}
                size="sm"
                tone="accent"
                icon={CheckCircle}
                onClick={() => {
                  try {
                    const parsed = snbtParseValue(snbtText)
                    ops.mutate(() => {
                      node.type = parsed.type
                      node.value = parsed.value
                    })
                    setSnbtError('')
                    setSnbtOpen(false)
                  } catch (err) {
                    setSnbtError(err.message)
                  }
                }}
              >
                {vn(lang, 'Áp dụng', 'Apply')}
              </Btn>
              <Btn c={c} size="sm" onClick={() => { setSnbtText(snbtValue(node)); setSnbtError('') }}>{vn(lang, 'Hoàn tác ô', 'Reset box')}</Btn>
            </Grid>
          </>
        ) : null}
      </Section>
    </div>
  )
}

function GamerulesPanel({ ctx, base }) {
  const { c, lang, vn, ops, tree } = ctx
  const [query, setQuery] = useState('')
  const [newRule, setNewRule] = useState('')
  const node = walk(tree, join(base, 'GameRules'))
  const rules = useMemo(() => (node?.value || []).slice().sort((a, b) => a.name.localeCompare(b.name)), [node, node?.value.length])
  const shown = rules.filter((rule) => !query || rule.name.toLowerCase().includes(query.toLowerCase()))
  const setRule = (key, raw) => ops.mutate(() => {
    const target = (node.value || []).find((item) => item.name === key)
    if (target) target.value = String(raw)
  }, `rule:${key}`)

  return (
    <Section c={c} title="GameRules" icon={ShieldCheck} defaultOpen>
      {!node ? (
        <Empty c={c}>{vn(lang, 'Thế giới này chưa có GameRules.', 'This world has no GameRules yet.')}</Empty>
      ) : (
        <>
          <TextField c={c} value={query} onChange={setQuery} placeholder={vn(lang, 'Lọc luật…', 'Filter rules…')} />
          <div className="flex flex-col gap-1 max-h-[260px] overflow-y-auto pr-0.5">
            {shown.map((rule) => {
              const isBool = /^(true|false)$/.test(String(rule.value))
              return (
                <div key={rule.name} className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[11.5px] font-mono truncate flex-1" style={{ color: c.label }} title={rule.name}>{rule.name}</span>
                  {isBool ? (
                    <Toggle
                      c={c}
                      on={String(rule.value) === 'true'}
                      label={String(rule.value)}
                      onClick={() => setRule(rule.name, String(rule.value) === 'true' ? 'false' : 'true')}
                    />
                  ) : (
                    <div className="w-[86px] shrink-0">
                      <TextField c={c} value={String(rule.value)} onChange={(value) => setRule(rule.name, value)} />
                    </div>
                  )}
                  <IconBtn c={c} icon={X} tone="#f87171" title={vn(lang, 'Xoá luật', 'Remove rule')} onClick={() => ops.mutate(() => { node.value = node.value.filter((item) => item.name !== rule.name) })} />
                </div>
              )
            })}
          </div>
        </>
      )}
      <div className="flex items-center gap-1.5">
        <input
          value={newRule}
          onChange={(e) => setNewRule(e.target.value)}
          list="nbt-gamerules"
          placeholder={vn(lang, 'Thêm luật', 'Add rule')}
          className="h-7 px-2 rounded-md text-[11.5px] font-mono outline-none flex-1 min-w-0"
          style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.text }}
        />
        <datalist id="nbt-gamerules">
          {GAMERULES.filter(([name]) => !(node?.value || []).some((item) => item.name === name)).map(([name]) => <option key={name} value={name} />)}
        </datalist>
        <IconBtn
          c={c}
          icon={Plus}
          title={vn(lang, 'Thêm', 'Add')}
          onClick={() => {
            const name = newRule.trim()
            if (!name) return
            ops.mutate(() => {
              const rulesNode = walk(tree, join(base, 'GameRules'))
              const entry = newTag('string', name, 'false')
              if (rulesNode) rulesNode.value.push(entry)
              else {
                const parent = walk(tree, base)
                if (parent) parent.value.push(newTag('compound', 'GameRules', [entry]))
              }
            })
            setNewRule('')
          }}
        />
      </div>
    </Section>
  )
}

export function PanelWorld({ ctx }) {
  const { c, lang, vn, ops, tree, dataPath, info } = ctx
  const [genEdit, setGenEdit] = useState(false)
  const [genText, setGenText] = useState('')
  if (!dataPath) {
    return (
      <div className="flex flex-col gap-2.5">
        <Head c={c} icon={Cube} title={vn(lang, 'Không có dữ liệu cấp thế giới', 'No level data in this file')} />
        <Empty c={c}>{vn(lang, 'Bảng này dùng cho tệp level.dat. Hãy chọn level.dat ở cột trái.', 'This panel is for level.dat. Pick level.dat in the left rail.')}</Empty>
      </div>
    )
  }
  const val = (key) => {
    const node = walk(tree, join(dataPath, key))
    return node ? node.value : undefined
  }
  const setNum = (key, type, value) => ops.ensure(dataPath, key, type, coerceScalar(type, value))
  const setStr = (key, value) => ops.ensure(dataPath, key, 'string', value)
  const toggle = (key) => ops.toggle(dataPath, key)
  const has = (key) => !!walk(tree, join(dataPath, key))
  const playerPos = (() => {
    const pos = walk(tree, join(dataPath, 'Player'))?.value?.find((item) => item.name === 'Pos')
    if (!pos || !Array.isArray(pos.value)) return null
    return pos.value.map((item) => (item && typeof item === 'object' ? num(item.value) : num(item)))
  })()
  const setTime = (value) => {
    ops.ensure(dataPath, 'DayTime', 'long', String(value))
    if (has('Time')) ops.ensure(dataPath, 'Time', 'long', String(value))
  }
  const weather = (mode) => ops.mutate(() => {
    const data = walk(tree, dataPath)
    const put = (key, type, value) => {
      const found = data.value.find((item) => item.name === key)
      if (found) { found.type = type; found.value = coerceScalar(type, value) }
      else data.value.push(newTag(type, key, coerceScalar(type, value)))
    }
    if (mode === 'clear') {
      put('Raining', 'byte', 0)
      put('Thundering', 'byte', 0)
      put('rainTime', 'int', 0)
      put('thunderTime', 'int', 0)
      put('clearWeatherTime', 'int', 100000)
    } else if (mode === 'rain') {
      put('Raining', 'byte', 1)
      put('Thundering', 'byte', 0)
      put('rainTime', 'int', 12000)
      put('thunderTime', 'int', 0)
      put('clearWeatherTime', 'int', 0)
    } else {
      put('Raining', 'byte', 1)
      put('Thundering', 'byte', 1)
      put('rainTime', 'int', 12000)
      put('thunderTime', 'int', 12000)
      put('clearWeatherTime', 'int', 0)
    }
  })

  return (
    <div className="flex flex-col gap-2.5">
      <Head c={c} icon={Cube} title={vn(lang, 'Cấp thế giới', 'Level data')} right={<span className="text-[10.5px] font-mono" style={{ color: c.faint }}>{vn(lang, `${(walk(tree, dataPath).value || []).length} khoá`, `${(walk(tree, dataPath).value || []).length} keys`)}</span>} />

      <Section c={c} title={vn(lang, 'Định danh', 'Identity')} icon={IdentificationCard}>
        <Field c={c} label="LevelName">
          <TextField c={c} value={String(val('LevelName') ?? '')} onChange={(value) => setStr('LevelName', value)} />
        </Field>
        <Grid cols={2}>
          <Field c={c} label="DataVersion">
            <NumField c={c} value={num(val('DataVersion'))} onChange={(value) => setNum('DataVersion', 'int', value)} />
          </Field>
          <Field c={c} label="version">
            <NumField c={c} value={num(val('version'))} onChange={(value) => setNum('version', 'int', value)} />
          </Field>
        </Grid>
        <Field c={c} label="LastPlayed" hint={formatDate(num(val('LastPlayed')), lang) || '—'}>
          <TextField c={c} value={String(val('LastPlayed') ?? '')} onChange={(value) => ops.ensure(dataPath, 'LastPlayed', 'long', coerceScalar('long', value))} />
        </Field>
        <Grid cols={2}>
          <Btn c={c} size="sm" icon={ArrowsClockwise} onClick={() => setNum('LastPlayed', 'long', Date.now())}>{vn(lang, 'Đặt = bây giờ', 'Set to now')}</Btn>
          <Btn c={c} size="sm" icon={PencilSimple} onClick={() => { setGenText(String(val('RandomSeed') ?? '')); setGenEdit(true) }}>{vn(lang, 'Đổi seed', 'Edit seed')}</Btn>
        </Grid>
        {genEdit ? (
          <div className="flex items-center gap-1.5">
            <input
              value={genText}
              onChange={(e) => setGenText(e.target.value)}
              className="h-7 px-2 rounded-md text-[11.5px] font-mono outline-none flex-1 min-w-0"
              style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.text }}
            />
            <IconBtn
              c={c}
              icon={CheckCircle}
              title={vn(lang, 'Ghi seed', 'Set seed')}
              onClick={() => {
                ops.ensure(dataPath, 'RandomSeed', 'long', coerceScalar('long', genText))
                if (has('WorldGenSettings')) ops.ensure(join(dataPath, 'WorldGenSettings'), 'seed', 'long', coerceScalar('long', genText))
                setGenEdit(false)
              }}
            />
          </div>
        ) : null}
      </Section>

      <Section c={c} title={vn(lang, 'Chế độ & độ khó', 'Mode & difficulty')} icon={Crosshair}>
        <Grid cols={2}>
          <Field c={c} label="GameType">
            <Drop
              c={c}
              theme={ctx.theme}
              value={String(num(val('GameType')))}
              onChange={(value) => setNum('GameType', 'int', value)}
              options={[
                { value: '0', label: vn(lang, 'Sinh tồn', 'Survival'), node: <Sword size={15} weight="duotone" />, tone: '#4ade80' },
                { value: '1', label: vn(lang, 'Sáng tạo', 'Creative'), node: <PaintBrush size={15} weight="duotone" />, tone: '#a78bfa' },
                { value: '2', label: vn(lang, 'Phiêu lưu', 'Adventure'), node: <MapTrifold size={15} weight="duotone" />, tone: '#fb923c' },
                { value: '3', label: vn(lang, 'Khán giả', 'Spectator'), node: <Eye size={15} weight="duotone" />, tone: '#94a3b8' },
              ]}
            />
          </Field>
          <Field c={c} label="Difficulty">
            <Drop
              c={c}
              theme={ctx.theme}
              value={String(num(val('Difficulty')))}
              onChange={(value) => setNum('Difficulty', 'byte', value)}
              options={[
                { value: '0', label: vn(lang, 'Bình yên', 'Peaceful'), tone: '#4ade80' },
                { value: '1', label: vn(lang, 'Dễ', 'Easy'), tone: '#a3e635' },
                { value: '2', label: vn(lang, 'Thường', 'Normal'), tone: '#fbbf24' },
                { value: '3', label: vn(lang, 'Khó', 'Hard'), tone: '#ef4444' },
              ]}
            />
          </Field>
        </Grid>
        <Grid cols={2}>
          <Toggle c={c} on={!!num(val('hardcore'))} label="Hardcore" onClick={() => toggle('hardcore')} />
          <Toggle c={c} on={!!num(val('allowCommands'))} label={vn(lang, 'Cho lệnh', 'Allow commands')} onClick={() => toggle('allowCommands')} />
          <Toggle c={c} on={!!num(val('DifficultyLocked'))} label={vn(lang, 'Khoá độ khó', 'Difficulty locked')} onClick={() => ops.ensure(dataPath, 'DifficultyLocked', 'byte', num(val('DifficultyLocked')) ? 0 : 1)} />
          <Toggle c={c} on={!!num(val('initialized'))} label={vn(lang, 'Đã khởi tạo', 'Initialized')} onClick={() => ops.ensure(dataPath, 'initialized', 'byte', num(val('initialized')) ? 0 : 1)} />
        </Grid>
      </Section>

      <Section c={c} title={vn(lang, 'Thời gian', 'Time')} icon={Clock}>
        <Grid cols={2}>
          <Field c={c} label="DayTime">
            <NumField c={c} value={num(val('DayTime'))} step={100} onChange={(value) => ops.ensure(dataPath, 'DayTime', 'long', String(Math.trunc(value)))} />
          </Field>
          <Field c={c} label="Time">
            <NumField c={c} value={num(val('Time'))} step={100} onChange={(value) => ops.ensure(dataPath, 'Time', 'long', String(Math.trunc(value)))} />
          </Field>
        </Grid>
        <Grid cols={4}>
          <Btn c={c} size="sm" title={vn(lang, 'Đặt 1000 tick (ban ngày)', 'Set 1000 ticks (day)')} onClick={() => setTime(1000)}>{vn(lang, 'Ngày', 'Day')}</Btn>
          <Btn c={c} size="sm" title={vn(lang, 'Đặt 6000 tick (giữa trưa)', 'Set 6000 ticks (noon)')} onClick={() => setTime(6000)}>{vn(lang, 'Trưa', 'Noon')}</Btn>
          <Btn c={c} size="sm" title={vn(lang, 'Đặt 13000 tick (ban đêm)', 'Set 13000 ticks (night)')} onClick={() => setTime(13000)}>{vn(lang, 'Đêm', 'Night')}</Btn>
          <Btn c={c} size="sm" title={vn(lang, 'Đặt 23000 tick (bình minh)', 'Set 23000 ticks (dawn)')} onClick={() => setTime(23000)}>{vn(lang, 'Sáng', 'Dawn')}</Btn>
        </Grid>
      </Section>

      <Section c={c} title={vn(lang, 'Thời tiết', 'Weather')} icon={CloudRain}>
        <Grid cols={3}>
          <Btn c={c} size="sm" icon={Sun} title={vn(lang, 'Trời quang', 'Clear')} onClick={() => weather('clear')}>{vn(lang, 'Quang', 'Clear')}</Btn>
          <Btn c={c} size="sm" icon={CloudRain} title={vn(lang, 'Mưa', 'Rain')} onClick={() => weather('rain')}>{vn(lang, 'Mưa', 'Rain')}</Btn>
          <Btn c={c} size="sm" icon={Lightning} title={vn(lang, 'Sấm sét', 'Thunder')} onClick={() => weather('thunder')}>{vn(lang, 'Sấm', 'Thunder')}</Btn>
        </Grid>
        <Grid cols={3}>
          {['rainTime', 'thunderTime', 'clearWeatherTime'].map((key) => (
            <Field key={key} c={c} label={key.replace('Time', '').replace('clearWeather', 'clear')}>
              <NumField c={c} value={num(val(key))} step={100} onChange={(value) => setNum(key, 'int', value)} />
            </Field>
          ))}
        </Grid>
      </Section>

      <Section c={c} title={vn(lang, 'Điểm xuất phát', 'Spawn')} icon={MapPin}>
        <Grid cols={3}>
          {['SpawnX', 'SpawnY', 'SpawnZ'].map((key) => (
            <Field key={key} c={c} label={key}>
              <NumField c={c} value={num(val(key))} onChange={(value) => setNum(key, 'int', value)} />
            </Field>
          ))}
        </Grid>
        <Grid cols={2}>
          <Field c={c} label="SpawnAngle">
            <NumField c={c} value={num(val('SpawnAngle'))} step={15} onChange={(value) => setNum('SpawnAngle', 'float', value)} />
          </Field>
          <Btn
            c={c}
            size="sm"
            icon={Crosshair}
            disabled={!playerPos}
            title={playerPos ? '' : vn(lang, 'Không có dữ liệu người chơi.', 'No player data.')}
            onClick={() => ops.mutate(() => {
              const data = walk(tree, dataPath)
              const put = (key, value) => {
                const found = data.value.find((item) => item.name === key)
                if (found) found.value = Math.round(value)
                else data.value.push(newTag('int', key, Math.round(value)))
              }
              put('SpawnX', playerPos[0])
              put('SpawnY', playerPos[1])
              put('SpawnZ', playerPos[2])
            })}
          >
            {vn(lang, 'Lấy từ người chơi', 'From player')}
          </Btn>
        </Grid>
      </Section>

      <Section c={c} title={vn(lang, 'Biên giới thế giới', 'World border')} icon={BoundingBox} defaultOpen={false}>
        <Grid cols={2}>
          {[
            ['CenterX', 'double'], ['CenterZ', 'double'], ['Size', 'double'], ['DamagePerBlock', 'double'],
            ['WarningBlocks', 'int'], ['WarningTime', 'int'], ['SafeZone', 'double'],
          ].map(([key, type]) => (
            <Field key={key} c={c} label={key}>
              <NumField c={c} value={num(walk(tree, join(dataPath, 'WorldBorder', key))?.value)} step={type === 'int' ? 1 : 100} onChange={(value) => ops.ensure(join(dataPath, 'WorldBorder'), key, type, coerceScalar(type, value))} />
            </Field>
          ))}
        </Grid>
        <Grid cols={3}>
          {[100, 1000, 59999968].map((size) => (
            <Btn key={size} c={c} size="sm" onClick={() => ops.ensure(join(dataPath, 'WorldBorder'), 'Size', 'double', size)}>{vn(lang, `Cỡ ${size}`, `Size ${size}`)}</Btn>
          ))}
        </Grid>
      </Section>

      <Section c={c} title={vn(lang, 'Thương nhân lang thang', 'Wandering trader')} icon={Clock} defaultOpen={false}>
        <Grid cols={2}>
          <Field c={c} label="SpawnDelay">
            <NumField c={c} value={num(val('WanderingTraderSpawnDelay'))} step={1200} onChange={(value) => setNum('WanderingTraderSpawnDelay', 'int', value)} />
          </Field>
          <Field c={c} label="SpawnChance">
            <NumField c={c} value={num(val('WanderingTraderSpawnChance'))} min={0} max={100} onChange={(value) => setNum('WanderingTraderSpawnChance', 'int', value)} />
          </Field>
        </Grid>
      </Section>

      <GamerulesPanel ctx={ctx} base={dataPath} />

      {info?.running ? <Note c={c} tone="warn" icon={WarningCircle}>{vn(lang, 'Instance đang chạy — thoát game trước khi ghi.', 'Instance is running — quit the game before writing.')}</Note> : null}
    </div>
  )
}

function PlayerSource({ ctx }) {
  const { c, lang, vn, ops, playerBase, file } = ctx
  return (
    <Head
      c={c}
      icon={Users}
      title={vn(lang, 'Người chơi', 'Player')}
      right={<span className="text-[10.5px] font-mono" style={{ color: c.faint }}>{playerBase === '' ? file : 'level.dat › Data › Player'}</span>}
    />
  )
}

export function PanelPlayer({ ctx }) {
  const { c, lang, vn, ops, tree, playerBase } = ctx
  const [uuidText, setUuidText] = useState('')
  const uuidNode = playerBase === null ? null : walk(tree, join(playerBase, 'UUID'))
  useEffect(() => { setUuidText(uuidNode ? uuidFromIntArray(uuidNode.value) : '') }, [uuidNode, ctx.selection.path])

  if (playerBase === null) {
    return (
      <div className="flex flex-col gap-2.5">
        <Head c={c} icon={Users} title={vn(lang, 'Không có dữ liệu người chơi', 'No player data')} />
        <Empty c={c}>{vn(lang, 'Tệp này không chứa dữ liệu người chơi. Mở playerdata/*.dat hoặc level.dat của thế giới chơi đơn.', 'This file has no player data. Open playerdata/*.dat or a single-player level.dat.')}</Empty>
      </div>
    )
  }

  const val = (key) => {
    const node = walk(tree, join(playerBase, key))
    return node ? node.value : undefined
  }
  const has = (key) => !!walk(tree, join(playerBase, key))
  const setNum = (key, type, value) => ops.ensure(playerBase, key, type, coerceScalar(type, value))
  const toggle = (key) => ops.ensure(playerBase, key, 'byte', num(val(key)) ? 0 : 1)
  const group = (name) => join(playerBase, name)
  const abilities = (key) => walk(tree, join(playerBase, 'abilities', key))
  const setAbility = (key, value) => ops.ensure(group('abilities'), key, typeof value === 'number' && !Number.isInteger(value) ? 'float' : 'byte', value)
  const listOf = (key) => walk(tree, join(playerBase, key))
  const vector = (key) => {
    const node = walk(tree, join(playerBase, key))
    if (!node || !Array.isArray(node.value)) return null
    return node.value.map((item) => (item && typeof item === 'object' ? item.value : item))
  }
  const setVector = (key, index, value) => ops.mutate(() => {
    const node = walk(tree, join(playerBase, key))
    if (!node || !Array.isArray(node.value)) return
    const element = node.value[index]
    if (element && typeof element === 'object') element.value = coerceScalar(element.type, value)
    else node.value[index] = coerceScalar('double', value)
  }, `vec:${key}:${index}`)
  const fillVector = (key, values) => ops.mutate(() => {
    const node = walk(tree, join(playerBase, key))
    if (!node || !Array.isArray(node.value)) return
    node.value = values.map((value, i) => {
      const element = node.value[i]
      if (element && typeof element === 'object') return { ...element, value: coerceScalar(element.type, value) }
      return newTag('double', '', value)
    })
  })
  const invCount = countOf(listOf('Inventory') || { value: [] })
  const effects = countOf(listOf('ActiveEffects') || { value: [] })
  const attrs = countOf(listOf('Attributes') || { value: [] })
  const pos = vector('Pos')

  return (
    <div className="flex flex-col gap-2.5">
      <PlayerSource ctx={ctx} />

      <Section c={c} title={vn(lang, 'Thao tác nhanh', 'Quick actions')} icon={MagicWand}>
        <Grid cols={2}>
          <Btn
            c={c}
            size="sm"
            icon={Heart}
            tone="ok"
            onClick={() => ops.mutate(() => {
              const put = (key, type, value) => {
                const base = walk(tree, playerBase)
                const found = base.value.find((item) => item.name === key)
                if (found) { found.type = type; found.value = coerceScalar(type, value) }
                else base.value.push(newTag(type, key, coerceScalar(type, value)))
              }
              put('Health', 'float', 20)
              put('foodLevel', 'int', 20)
              put('foodSaturationLevel', 'float', 5)
              put('foodExhaustionLevel', 'float', 0)
              put('Air', 'short', 300)
              put('Fire', 'short', -1)
              put('DeathTime', 'short', 0)
              put('HurtTime', 'short', 0)
            })}
          >
            {vn(lang, 'Hồi máu & thức ăn', 'Heal & feed')}
          </Btn>
          <Btn
            c={c}
            size="sm"
            icon={Star}
            onClick={() => ops.mutate(() => {
              const base = walk(tree, playerBase)
              const put = (key, type, value) => {
                const found = base.value.find((item) => item.name === key)
                if (found) { found.type = type; found.value = value }
                else base.value.push(newTag(type, key, value))
              }
              put('XpLevel', 'int', 100)
              put('XpP', 'float', 0)
              put('XpTotal', 'int', 0)
            })}
          >
            {vn(lang, 'Cho 100 cấp', 'Give 100 levels')}
          </Btn>
          <Btn
            c={c}
            size="sm"
            tone="danger"
            icon={Trash}
            onClick={() => ops.mutate(() => {
              const node = listOf('ActiveEffects')
              if (node) node.value = []
            })}
          >
            {vn(lang, 'Xoá mọi hiệu ứng', 'Clear effects')}
          </Btn>
          <Btn
            c={c}
            size="sm"
            icon={ShieldCheck}
            onClick={() => ops.mutate(() => {
              const target = walk(tree, group('abilities')) || (() => {
                const base = walk(tree, playerBase)
                const created = newTag('compound', 'abilities', [])
                base.value.push(created)
                return created
              })()
              const put = (key, type, value) => {
                const found = target.value.find((item) => item.name === key)
                if (found) { found.type = type; found.value = value }
                else target.value.push(newTag(type, key, value))
              }
              put('mayfly', 'byte', 1)
              put('flying', 'byte', 1)
              put('mayBuild', 'byte', 1)
              put('instabuild', 'byte', 1)
              put('invulnerable', 'byte', 1)
            })}
          >
            {vn(lang, 'Bật chế độ bay', 'Enable flight')}
          </Btn>
        </Grid>
      </Section>

      <Section c={c} title={vn(lang, 'Sinh mệnh', 'Vitals')} icon={Heart}>
        <Grid cols={2}>
          <Field c={c} label="Health">
            <NumField c={c} value={num(val('Health'))} step={1} onChange={(value) => setNum('Health', 'float', value)} />
          </Field>
          <Field c={c} label="AbsorptionAmount">
            <NumField c={c} value={num(val('AbsorptionAmount'))} step={1} onChange={(value) => setNum('AbsorptionAmount', 'float', value)} />
          </Field>
          <Field c={c} label="Air">
            <NumField c={c} value={num(val('Air'))} step={20} onChange={(value) => setNum('Air', 'short', value)} />
          </Field>
          <Field c={c} label="Fire">
            <NumField c={c} value={num(val('Fire'))} step={20} onChange={(value) => setNum('Fire', 'short', value)} />
          </Field>
          <Field c={c} label="DeathTime">
            <NumField c={c} value={num(val('DeathTime'))} onChange={(value) => setNum('DeathTime', 'short', value)} />
          </Field>
          <Field c={c} label="HurtTime">
            <NumField c={c} value={num(val('HurtTime'))} onChange={(value) => setNum('HurtTime', 'short', value)} />
          </Field>
        </Grid>
      </Section>

      <Section c={c} title={vn(lang, 'Đói & kinh nghiệm', 'Food & experience')} icon={ForkKnife}>
        <Grid cols={2}>
          <Field c={c} label="foodLevel">
            <NumField c={c} value={num(val('foodLevel'))} min={0} max={20} onChange={(value) => setNum('foodLevel', 'int', value)} />
          </Field>
          <Field c={c} label="foodSaturationLevel">
            <NumField c={c} value={num(val('foodSaturationLevel'))} step={0.5} onChange={(value) => setNum('foodSaturationLevel', 'float', value)} />
          </Field>
          <Field c={c} label="foodExhaustionLevel">
            <NumField c={c} value={num(val('foodExhaustionLevel'))} step={0.5} onChange={(value) => setNum('foodExhaustionLevel', 'float', value)} />
          </Field>
          <Field c={c} label="foodTickTimer">
            <NumField c={c} value={num(val('foodTickTimer'))} onChange={(value) => setNum('foodTickTimer', 'int', value)} />
          </Field>
          <Field c={c} label="XpLevel">
            <NumField c={c} value={num(val('XpLevel'))} step={5} onChange={(value) => setNum('XpLevel', 'int', value)} />
          </Field>
          <Field c={c} label="XpP" hint={vn(lang, '0…1 trong cấp hiện tại', '0…1 inside level')}>
            <NumField c={c} value={num(val('XpP'))} step={0.1} min={0} max={1} onChange={(value) => setNum('XpP', 'float', value)} />
          </Field>
          <Field c={c} label="XpTotal">
            <NumField c={c} value={num(val('XpTotal'))} step={50} onChange={(value) => setNum('XpTotal', 'int', value)} />
          </Field>
          <Field c={c} label="Score">
            <NumField c={c} value={num(val('Score'))} step={10} onChange={(value) => setNum('Score', 'int', value)} />
          </Field>
        </Grid>
      </Section>

      <Section c={c} title={vn(lang, 'Vị trí & hướng', 'Position & rotation')} icon={NavigationArrow}>
        {[
          ['Pos', ['X', 'Y', 'Z'], 'double'],
          ['Rotation', ['Yaw', 'Pitch'], 'float'],
          ['Motion', ['dX', 'dY', 'dZ'], 'double'],
        ].map(([key, labels, type]) => {
          const vectorValue = vector(key)
          if (!vectorValue) return null
          return (
            <div key={key} className="flex flex-col gap-1">
              <span className="text-[10.5px] font-mono" style={{ color: c.faint }}>{key}</span>
              <Grid cols={key === 'Rotation' ? 2 : 3}>
                {labels.map((label, i) => (
                  <Field key={label} c={c} label={label}>
                    <NumField
                      c={c}
                      value={num(vectorValue[i])}
                      step={type === 'float' ? 0.5 : 0.1}
                      onChange={(value) => setVector(key, i, value)}
                    />
                  </Field>
                ))}
              </Grid>
            </div>
          )
        })}
        <Grid cols={2}>
          <Btn
            c={c}
            size="sm"
            icon={Speedometer}
            disabled={!vector('Motion')}
            onClick={() => fillVector('Motion', [0, 0, 0])}
          >
            {vn(lang, 'Đứng yên', 'Stop motion')}
          </Btn>
          <Btn
            c={c}
            size="sm"
            icon={Crosshair}
            onClick={() => fillVector('Pos', [0, 100, 0])}
          >
            {vn(lang, 'Về 0 100 0', 'To 0 100 0')}
          </Btn>
        </Grid>
        <Field c={c} label="Dimension" hint={vn(lang, 'Ghi vào đây chỉ đổi nhãn; dịch chuyển thật do game quyết định.', 'Editing this only changes the label; the game decides the real teleport.')}>
          <TextField c={c} value={String(val('Dimension') ?? '')} onChange={(value) => ops.ensure(playerBase, 'Dimension', 'string', value)} />
        </Field>
        <Grid cols={3}>
          {['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end'].map((dimension) => (
            <Btn key={dimension} c={c} size="sm" onClick={() => ops.ensure(playerBase, 'Dimension', 'string', dimension)}>
              {dimension.replace('minecraft:', '')}
            </Btn>
          ))}
        </Grid>
      </Section>

      <Section c={c} title={vn(lang, 'Trạng thái', 'State')} icon={ShieldCheck}>
        <Grid cols={2}>
          {[
            ['OnGround', vn(lang, 'Trên mặt đất', 'On ground')],
            ['Invulnerable', vn(lang, 'Bất tử', 'Invulnerable')],
            ['FallFlying', vn(lang, 'Đang lượn', 'Fall flying')],
            ['Glowing', vn(lang, 'Phát sáng', 'Glowing')],
            ['Invisible', vn(lang, 'Tàng hình', 'Invisible')],
            ['NoGravity', vn(lang, 'Không trọng lực', 'No gravity')],
          ].map(([key, label]) => (
            <Toggle key={key} c={c} on={!!num(val(key))} label={label} onClick={() => toggle(key)} />
          ))}
        </Grid>
        <Grid cols={2}>
          <Field c={c} label="PortalCooldown">
            <NumField c={c} value={num(val('PortalCooldown'))} step={10} onChange={(value) => setNum('PortalCooldown', 'int', value)} />
          </Field>
          <Field c={c} label="SelectedItemSlot">
            <NumField c={c} value={num(val('SelectedItemSlot'))} min={0} onChange={(value) => setNum('SelectedItemSlot', 'int', value)} />
          </Field>
        </Grid>
      </Section>

      <Section c={c} title={vn(lang, 'Khả năng', 'Abilities')} icon={Speedometer}>
        <Grid cols={2}>
          {[
            ['mayfly', vn(lang, 'Được bay', 'Can fly')],
            ['flying', vn(lang, 'Đang bay', 'Flying')],
            ['instabuild', vn(lang, 'Phá tức thì', 'Instabuild')],
            ['invulnerable', vn(lang, 'Bất tử', 'Invulnerable')],
            ['mayBuild', vn(lang, 'Được xây', 'May build')],
          ].map(([key, label]) => (
            <Toggle key={key} c={c} on={!!num(abilities(key)?.value)} label={label} onClick={() => ops.ensure(group('abilities'), key, 'byte', num(abilities(key)?.value) ? 0 : 1)} />
          ))}
        </Grid>
        <Grid cols={2}>
          <Field c={c} label="walkSpeed">
            <NumField c={c} value={num(abilities('walkSpeed')?.value)} step={0.01} onChange={(value) => setAbility('walkSpeed', value)} />
          </Field>
          <Field c={c} label="flySpeed">
            <NumField c={c} value={num(abilities('flySpeed')?.value)} step={0.01} onChange={(value) => setAbility('flySpeed', value)} />
          </Field>
        </Grid>
      </Section>

      <Section c={c} title="UUID" icon={IdentificationCard} defaultOpen={false}>
        {uuidNode ? (
          <>
            <TextField c={c} value={uuidText} onChange={setUuidText} />
            <Grid cols={2}>
              <Btn
                c={c}
                size="sm"
                tone="accent"
                icon={CheckCircle}
                onClick={() => {
                  const ints = uuidToIntArray(uuidText)
                  if (ints) ops.mutate(() => { uuidNode.value = ints })
                }}
              >
                {vn(lang, 'Ghi UUID', 'Set UUID')}
              </Btn>
              <Btn c={c} size="sm" icon={Copy} onClick={() => navigator.clipboard?.writeText(uuidText).catch(() => {})}>
                {vn(lang, 'Sao chép', 'Copy')}
              </Btn>
            </Grid>
            <Empty c={c}>{vn(lang, 'Ghi dạng 8-4-4-4-12; launcher đổi thành intArray 4 phần tử.', 'Use the 8-4-4-4-12 form; it is stored as a 4-int array.')}</Empty>
          </>
        ) : (
          <Empty c={c}>{vn(lang, 'Tag này không có UUID.', 'This tag has no UUID.')}</Empty>
        )}
      </Section>

      <Section c={c} title={vn(lang, 'Nhảy tới dữ liệu con', 'Jump to child data')} icon={ArrowSquareOut}>
        <Grid cols={2}>
          <Btn c={c} size="sm" icon={Backpack} disabled={!has('Inventory')} onClick={() => ops.jump(group('Inventory'))}>
            {vn(lang, `Inventory (${invCount})`, `Inventory (${invCount})`)}
          </Btn>
          <Btn c={c} size="sm" icon={Backpack} disabled={!has('EnderItems')} onClick={() => ops.jump(group('EnderItems'))}>
            {vn(lang, `EnderItems (${countOf(listOf('EnderItems') || { value: [] })})`, `EnderItems (${countOf(listOf('EnderItems') || { value: [] })})`)}
          </Btn>
          <Btn c={c} size="sm" icon={Sparkle} disabled={!has('ActiveEffects')} onClick={() => ops.jump(group('ActiveEffects'))}>
            {vn(lang, `Hiệu ứng (${effects})`, `Effects (${effects})`)}
          </Btn>
          <Btn c={c} size="sm" icon={Sliders} disabled={!has('Attributes')} onClick={() => ops.jump(group('Attributes'))}>
            {vn(lang, `Thuộc tính (${attrs})`, `Attributes (${attrs})`)}
          </Btn>
        </Grid>
        {pos ? <Empty c={c}>{vn(lang, `Toạ độ hiện tại: ${pos.map((item) => Number(item).toFixed(1)).join(', ')}`, `Current position: ${pos.map((item) => Number(item).toFixed(1)).join(', ')}`)}</Empty> : null}
      </Section>
    </div>
  )
}

export function PanelItems({ ctx }) {
  const { c, lang, vn, ops, tree, playerBase } = ctx
  const [sourceKey, setSourceKey] = useState('Inventory')
  const [newId, setNewId] = useState('minecraft:diamond')
  const [newCount, setNewCount] = useState(1)
  const [newSlot, setNewSlot] = useState(0)
  const [perPage, setPerPage] = useState(60)

  const listPath = playerBase === null ? '' : join(playerBase, sourceKey)
  const list = playerBase === null ? null : walk(tree, listPath)
  const items = list && Array.isArray(list.value) ? list.value : []
  const itemsHas = playerBase !== null && !!walk(tree, join(playerBase, sourceKey === 'Inventory' ? 'EnderItems' : 'Inventory'))

  const itemField = (index, key, type, raw) => ops.mutate(() => {
    const target = items[index]
    if (!target || target.type !== 'compound') return
    const element = type === 'byte' ? 'byte' : type
    const found = target.value.find((item) => item.name === key)
    if (found) { found.type = element; found.value = coerceScalar(element, raw) }
    else target.value.push(newTag(element, key, coerceScalar(element, raw)))
  }, `item:${sourceKey}:${index}:${key}`)
  const itemGet = (index, key) => {
    const target = items[index]
    if (!target || target.type !== 'compound') return undefined
    return target.value.find((item) => item.name === key)?.value
  }

  if (playerBase === null) {
    return (
      <div className="flex flex-col gap-2.5">
        <Head c={c} icon={Backpack} title={vn(lang, 'Không có dữ liệu người chơi', 'No player data')} />
        <Empty c={c}>{vn(lang, 'Bảng vật phẩm cần tệp có Inventory (playerdata/*.dat hoặc level.dat).', 'The items panel needs a file with Inventory (playerdata/*.dat or level.dat).')}</Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Head c={c} icon={Backpack} title={vn(lang, 'Vật phẩm', 'Items')} right={<span className="text-[10.5px] font-mono" style={{ color: c.faint }}>{items.length} {vn(lang, 'ô', 'slots')}</span>} />

      <Grid cols={2}>
        <Toggle c={c} on={sourceKey === 'Inventory'} label={vn(lang, 'Túi đồ', 'Inventory')} onClick={() => setSourceKey('Inventory')} />
        <Toggle c={c} on={sourceKey === 'EnderItems'} label={vn(lang, 'Rương Ender', 'Ender chest')} onClick={() => setSourceKey('EnderItems')} disabled={!itemsHas} />
      </Grid>

      <Section c={c} title={vn(lang, 'Thêm vật phẩm', 'Add item')} icon={Plus}>
        <Field c={c} label="id">
          <TextField c={c} value={newId} onChange={setNewId} />
        </Field>
        <Grid cols={2}>
          <Field c={c} label="Count">
            <NumField c={c} value={newCount} min={1} max={127} onChange={setNewCount} />
          </Field>
          <Field c={c} label="Slot">
            <NumField c={c} value={newSlot} min={0} onChange={setNewSlot} />
          </Field>
        </Grid>
        <Btn
          c={c}
          wide
          tone="accent"
          icon={Plus}
          onClick={() => ops.mutate(() => {
            const target = withList(tree, playerBase, sourceKey)
            if (!target) return
            target.value.push(newTag('compound', '', [
              newTag('byte', 'Slot', coerceScalar('byte', newSlot)),
              newTag('string', 'id', newId.trim()),
              newTag('byte', 'Count', coerceScalar('byte', newCount)),
            ]))
          })}
        >
          {vn(lang, 'Thêm vào túi', 'Add to inventory')}
        </Btn>
        <datalist id="nbt-item-ids">
          {ITEM_IDS.map((id) => <option key={id} value={id} />)}
        </datalist>
        <Empty c={c}>{vn(lang, 'Tên vật phẩm theo chuẩn minecraft:<id>.', 'Item ids use the minecraft:<id> form.')}</Empty>
      </Section>

      <div className="flex flex-wrap gap-1">
        <Btn c={c} size="sm" icon={ArrowsDownUp} disabled={!items.length} onClick={() => ops.mutate(() => { items.sort((a, b) => num(a.value.find((item) => item.name === 'Slot')?.value) - num(b.value.find((item) => item.name === 'Slot')?.value)) })}>
          {vn(lang, 'Xếp theo ô', 'Sort by slot')}
        </Btn>
        <Btn c={c} size="sm" tone="danger" icon={Trash} disabled={!items.length} onClick={() => ops.mutate(() => { walk(tree, listPath).value = [] })}>
          {vn(lang, 'Xoá toàn bộ', 'Clear all')}
        </Btn>
      </div>

      <div className="flex flex-col gap-1.5">
        {items.slice(0, perPage).map((item, index) => {
          const id = String(itemGet(index, 'id') ?? '')
          const count = num(itemGet(index, 'Count')) || 1
          const slot = num(itemGet(index, 'Slot'))
          const extra = item.value.find((child) => child.name === 'components' || child.name === 'tag')
          const damage = num(itemGet(index, 'Damage'))
          return (
            <RowCard key={index} c={c}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="h-7 px-2 rounded text-[10.5px] font-mono shrink-0 inline-flex items-center" style={{ background: `${c.accent}18`, color: c.accent }}>
                  #{slot}
                </span>
                <input
                  value={id}
                  list="nbt-item-ids"
                  onChange={(e) => itemField(index, 'id', 'string', e.target.value)}
                  spellCheck={false}
                  className="h-7 px-2 rounded text-[11.5px] font-mono outline-none flex-1 min-w-0"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
                />
                <input
                  value={String(count)}
                  onChange={(e) => itemField(index, 'Count', 'byte', e.target.value)}
                  className="h-7 w-12 px-1.5 rounded text-[11.5px] font-mono outline-none shrink-0"
                  style={{ background: c.input, border: `1px solid ${c.border}`, color: c.text }}
                />
                <IconBtn c={c} icon={ArrowsDownUp} title={vn(lang, 'Nhân bản', 'Duplicate')} onClick={() => ops.mutate(() => {
                  const copy = cloneNode(items[index])
                  const slotField = copy.value.find((child) => child.name === 'Slot')
                  if (slotField) slotField.value = coerceScalar('byte', num(slotField.value) + 1)
                  items.push(copy)
                })} />
                <IconBtn c={c} icon={ArrowSquareOut} title={vn(lang, 'Sửa NBT của vật phẩm', 'Edit item NBT')} onClick={() => ops.jump(stepPath(listPath, `#${index}`))} />
                <IconBtn c={c} icon={X} tone="#f87171" title={vn(lang, 'Xoá', 'Remove')} onClick={() => ops.mutate(() => { items.splice(index, 1) })} />
              </div>
              <div className="flex items-center gap-2 text-[10.5px] font-mono" style={{ color: c.faint }}>
                <span>{prettyId(id)}</span>
                {damage ? <span>damage {damage}</span> : null}
                {extra ? <span style={{ color: c.accent }}>{extra.name} · {countOf(extra)}</span> : null}
              </div>
            </RowCard>
          )
        })}
        {items.length > perPage ? (
          <Btn c={c} size="sm" wide onClick={() => setPerPage((prev) => prev + 60)}>
            {vn(lang, `Hiện thêm 60 (còn ${items.length - perPage})`, `Show 60 more (${items.length - perPage} left)`)}
          </Btn>
        ) : null}
        {!items.length ? <Empty c={c}>{vn(lang, 'Danh sách trống.', 'List is empty.')}</Empty> : null}
      </div>
    </div>
  )
}

export function PanelEffects({ ctx }) {
  const { c, lang, vn, ops, tree, playerBase } = ctx
  const [newId, setNewId] = useState('1')
  const [newLevel, setNewLevel] = useState(1)
  const [newSeconds, setNewSeconds] = useState(60)
  const listPath = playerBase === null ? '' : join(playerBase, 'ActiveEffects')
  const list = playerBase === null ? null : walk(tree, listPath)
  const items = list && Array.isArray(list.value) ? list.value : []

  const nameOf = (id) => {
    const found = EFFECT_NAMES.find(([value]) => value === num(id))
    return found ? found[1] : `#${num(id)}`
  }
  const field = (index, key, type, raw) => ops.mutate(() => {
    const target = items[index]
    if (!target) return
    const found = target.value.find((item) => item.name === key)
    if (found) { found.type = type; found.value = coerceScalar(type, raw) }
    else target.value.push(newTag(type, key, coerceScalar(type, raw)))
  }, `fx:${index}:${key}`)
  const get = (index, key) => {
    const target = items[index]
    if (!target || target.type !== 'compound') return undefined
    return target.value.find((item) => item.name === key)?.value
  }

  if (playerBase === null) {
    return (
      <div className="flex flex-col gap-2.5">
        <Head c={c} icon={Sparkle} title={vn(lang, 'Không có dữ liệu người chơi', 'No player data')} />
        <Empty c={c}>{vn(lang, 'Bảng hiệu ứng cần tệp có ActiveEffects.', 'The effects panel needs a file with ActiveEffects.')}</Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Head c={c} icon={Sparkle} title={vn(lang, 'Hiệu ứng trạng thái', 'Status effects')} right={<span className="text-[10.5px] font-mono" style={{ color: c.faint }}>{items.length}</span>} />

      <Section c={c} title={vn(lang, 'Thêm hiệu ứng', 'Add effect')} icon={Plus}>
        <Field c={c} label={vn(lang, 'Hiệu ứng', 'Effect')}>
          <Drop
            c={c}
            theme={ctx.theme}
            value={newId}
            onChange={setNewId}
            options={EFFECT_NAMES.map(([value, label]) => ({ value: String(value), label: `${value} · ${label}` }))}
          />
        </Field>
        <Grid cols={2}>
          <Field c={c} label={vn(lang, 'Cấp', 'Level')}>
            <NumField c={c} value={newLevel} min={1} max={256} onChange={setNewLevel} />
          </Field>
          <Field c={c} label={vn(lang, 'Giây', 'Seconds')}>
            <NumField c={c} value={newSeconds} step={10} onChange={setNewSeconds} />
          </Field>
        </Grid>
        <Btn
          c={c}
          wide
          tone="accent"
          icon={Plus}
          onClick={() => ops.mutate(() => {
            const target = withList(tree, playerBase, 'ActiveEffects')
            if (!target) return
            target.value.push(newTag('compound', '', [
              newTag('byte', 'Id', coerceScalar('byte', newId)),
              newTag('byte', 'Amplifier', coerceScalar('byte', newLevel - 1)),
              newTag('int', 'Duration', Math.round(newSeconds * 20)),
              newTag('byte', 'Ambient', 0),
              newTag('byte', 'ShowParticles', 1),
              newTag('byte', 'ShowIcon', 1),
            ]))
            ops.jump(listPath)
          })}
        >
          {vn(lang, 'Thêm hiệu ứng', 'Add effect')}
        </Btn>
      </Section>

      <div className="flex flex-col gap-1.5">
        {items.map((item, index) => {
          const duration = num(get(index, 'Duration'))
          return (
            <RowCard key={index} c={c}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11.5px] font-mono truncate flex-1" style={{ color: c.text }}>{nameOf(get(index, 'Id'))}</span>
                <IconBtn c={c} icon={ArrowsDownUp} title={vn(lang, 'Nhân bản', 'Duplicate')} onClick={() => ops.mutate(() => { items.push(cloneNode(items[index])) })} />
                <IconBtn c={c} icon={X} tone="#f87171" title={vn(lang, 'Xoá', 'Remove')} onClick={() => ops.mutate(() => { items.splice(index, 1) })} />
              </div>
              <Grid cols={3}>
                <Field c={c} label={vn(lang, 'Id', 'Id')}>
                  <NumField c={c} value={num(get(index, 'Id'))} min={1} onChange={(value) => field(index, 'Id', 'byte', value)} />
                </Field>
                <Field c={c} label={vn(lang, 'Cấp', 'Level')}>
                  <NumField c={c} value={num(get(index, 'Amplifier')) + 1} min={1} onChange={(value) => field(index, 'Amplifier', 'byte', value - 1)} />
                </Field>
                <Field c={c} label={duration < 0 ? '∞' : vn(lang, 'Giây', 'Seconds')}>
                  <NumField c={c} value={secs(duration)} step={10} onChange={(value) => field(index, 'Duration', 'int', value * 20)} />
                </Field>
              </Grid>
              <div className="flex flex-wrap gap-1">
                <Btn c={c} size="sm" icon={duration < 0 ? ArrowsClockwise : Clock} onClick={() => field(index, 'Duration', 'int', duration < 0 ? 1200 : -1)}>
                  {duration < 0 ? vn(lang, 'Có hạn', 'Timed') : vn(lang, 'Vô hạn', 'Infinite')}
                </Btn>
                <Toggle c={c} on={!!num(get(index, 'ShowParticles'))} label={vn(lang, 'Hạt', 'Particles')} onClick={() => field(index, 'ShowParticles', 'byte', num(get(index, 'ShowParticles')) ? 0 : 1)} />
                <Toggle c={c} on={!!num(get(index, 'Ambient'))} label={vn(lang, 'Nền', 'Ambient')} onClick={() => field(index, 'Ambient', 'byte', num(get(index, 'Ambient')) ? 0 : 1)} />
                <Toggle c={c} on={!!num(get(index, 'ShowIcon'))} label={vn(lang, 'Biểu tượng', 'Icon')} onClick={() => field(index, 'ShowIcon', 'byte', num(get(index, 'ShowIcon')) ? 0 : 1)} />
              </div>
            </RowCard>
          )
        })}
        {!items.length ? <Empty c={c}>{vn(lang, 'Người chơi không có hiệu ứng nào.', 'No active effects.')}</Empty> : null}
      </div>
    </div>
  )
}

export function PanelAttributes({ ctx }) {
  const { c, lang, vn, ops, tree, playerBase } = ctx
  const listPath = playerBase === null ? '' : join(playerBase, 'Attributes')
  const list = playerBase === null ? null : walk(tree, listPath)
  const items = list && Array.isArray(list.value) ? list.value : []
  const [preset, setPreset] = useState('minecraft:generic.max_health')
  const [presetValue, setPresetValue] = useState(20)

  const nameOf = (index) => {
    const target = items[index]
    if (!target) return ''
    const found = target.value.find((item) => item.name === 'Name' || item.name === 'id')
    return String(found?.value ?? '')
  }
  const valueOf = (index, key) => {
    const target = items[index]
    if (!target || target.type !== 'compound') return undefined
    return target.value.find((item) => item.name === key)?.value
  }
  const setBase = (index, value) => ops.mutate(() => {
    const target = items[index]
    const found = target.value.find((item) => item.name === 'Base')
    if (found) found.value = coerceScalar('double', value)
    else target.value.push(newTag('double', 'Base', coerceScalar('double', value)))
  }, `attr:${index}`)
  const modifiersOf = (index) => {
    const target = items[index]
    const mods = target?.value?.find((item) => item.name === 'Modifiers')
    return mods && Array.isArray(mods.value) ? mods : null
  }
  const addModifier = (index) => ops.mutate(() => {
    const target = items[index]
    let mods = target.value.find((item) => item.name === 'Modifiers')
    if (!mods) {
      mods = newTag('list', 'Modifiers', [])
      target.value.push(mods)
    }
    mods.value.push(newTag('compound', '', [
      newTag('string', 'Name', `${nameOf(index)}-mod`),
      newTag('double', 'Amount', 1),
      newTag('int', 'Operation', 0),
      newTag('intArray', 'UUID', [Math.trunc(Math.random() * 4294967296) - 2147483648, Math.trunc(Math.random() * 4294967296) - 2147483648, Math.trunc(Math.random() * 4294967296) - 2147483648, Math.trunc(Math.random() * 4294967296) - 2147483648]),
    ]))
  })
  const modifierField = (index, modIndex, key, type, raw) => ops.mutate(() => {
    const entry = modifiersOf(index)?.value?.[modIndex]
    if (!entry) return
    const found = entry.value.find((item) => item.name === key)
    if (found) { found.type = type; found.value = coerceScalar(type, raw) }
    else entry.value.push(newTag(type, key, coerceScalar(type, raw)))
  }, `mod:${index}:${modIndex}:${key}`)

  if (playerBase === null) {
    return (
      <div className="flex flex-col gap-2.5">
        <Head c={c} icon={Sliders} title={vn(lang, 'Không có dữ liệu người chơi', 'No player data')} />
        <Empty c={c}>{vn(lang, 'Bảng thuộc tính cần tệp có Attributes.', 'The attributes panel needs a file with Attributes.')}</Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Head c={c} icon={Sliders} title={vn(lang, 'Thuộc tính', 'Attributes')} right={<span className="text-[10.5px] font-mono" style={{ color: c.faint }}>{items.length}</span>} />

      <Section c={c} title={vn(lang, 'Đặt nhanh', 'Quick preset')} icon={MagicWand}>
        <Field c={c} label={vn(lang, 'Thuộc tính', 'Attribute')}>
          <Drop c={c} theme={ctx.theme} value={preset} onChange={setPreset} options={ATTR_NAMES.map((name) => ({ value: name, label: name.replace('minecraft:', '') }))} />
        </Field>
        <Field c={c} label={vn(lang, 'Giá trị nền', 'Base value')}>
          <NumField c={c} value={presetValue} step={1} onChange={setPresetValue} />
        </Field>
        <Btn
          c={c}
          wide
          tone="accent"
          icon={Plus}
          onClick={() => ops.mutate(() => {
            const target = withList(tree, playerBase, 'Attributes')
            if (!target) return
            const found = target.value.find((item) => {
              const field = item.value.find((child) => child.name === 'Name' || child.name === 'id')
              return String(field?.value) === preset
            })
            if (found) {
              const base = found.value.find((child) => child.name === 'Base')
              if (base) base.value = coerceScalar('double', presetValue)
              return
            }
            target.value.push(newTag('compound', '', [
              newTag('string', 'Name', preset),
              newTag('double', 'Base', coerceScalar('double', presetValue)),
              newTag('list', 'Modifiers', []),
            ]))
          })}
        >
          {vn(lang, 'Ghi thuộc tính', 'Apply attribute')}
        </Btn>
        <datalist id="nbt-attrs">
          {ATTR_NAMES.map((name) => <option key={name} value={name} />)}
        </datalist>
      </Section>

      <div className="flex flex-col gap-1.5">
        {items.map((item, index) => {
          const mods = modifiersOf(index)
          return (
            <RowCard key={index} c={c}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11.5px] font-mono truncate flex-1" style={{ color: c.text }} title={nameOf(index)}>{nameOf(index).replace('minecraft:', '')}</span>
                <IconBtn c={c} icon={ArrowsDownUp} title={vn(lang, 'Nhân bản', 'Duplicate')} onClick={() => ops.mutate(() => { items.push(cloneNode(items[index])) })} />
                <IconBtn c={c} icon={X} tone="#f87171" title={vn(lang, 'Xoá', 'Remove')} onClick={() => ops.mutate(() => { items.splice(index, 1) })} />
              </div>
              <Grid cols={2}>
                <Field c={c} label={vn(lang, 'Tên', 'Name')}>
                  <TextField c={c} value={nameOf(index)} onChange={(value) => ops.mutate(() => {
                    const target = items[index]
                    const found = target.value.find((child) => child.name === 'Name' || child.name === 'id')
                    if (found) found.value = value
                    else target.value.push(newTag('string', 'Name', value))
                  }, `attrname:${index}`)} />
                </Field>
                <Field c={c} label="Base">
                  <NumField c={c} value={num(valueOf(index, 'Base'))} step={1} onChange={(value) => setBase(index, value)} />
                </Field>
              </Grid>
              <div className="flex items-center gap-1.5">
                <span className="text-[10.5px] font-mono flex-1" style={{ color: c.faint }}>
                  {vn(lang, `${countOf(mods || { value: [] })} modifier`, `${countOf(mods || { value: [] })} modifier(s)`)}
                </span>
                <Btn c={c} size="sm" icon={Plus} onClick={() => addModifier(index)}>{vn(lang, 'Thêm modifier', 'Add modifier')}</Btn>
              </div>
              {(mods?.value || []).map((mod, modIndex) => {
                const read = (key) => mod.value.find((child) => child.name === key)?.value
                return (
                  <div key={modIndex} className="rounded px-1.5 py-1 flex flex-col gap-1" style={{ background: c.input, border: `1px solid ${c.border}` }}>
                    <div className="flex items-center gap-1.5">
                      <input
                        value={String(read('Name') ?? '')}
                        onChange={(e) => modifierField(index, modIndex, 'Name', 'string', e.target.value)}
                        className="h-7 px-2 rounded text-[11.5px] font-mono outline-none flex-1 min-w-0"
                        style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.text }}
                      />
                      <IconBtn c={c} icon={X} tone="#f87171" title={vn(lang, 'Xoá modifier', 'Remove modifier')} onClick={() => ops.mutate(() => { mods.value.splice(modIndex, 1) })} />
                    </div>
                    <Grid cols={2}>
                      <Field c={c} label="Amount">
                        <NumField c={c} value={num(read('Amount'))} step={0.1} onChange={(value) => modifierField(index, modIndex, 'Amount', 'double', value)} />
                      </Field>
                      <Field c={c} label="Operation">
                        <Drop
                          c={c}
                          theme={ctx.theme}
                          value={String(num(read('Operation')))}
                          onChange={(value) => modifierField(index, modIndex, 'Operation', 'int', value)}
                          options={[
                            { value: '0', label: vn(lang, 'Cộng thẳng', 'Add'), tone: '#4ade80' },
                            { value: '1', label: vn(lang, 'Nhân nền', 'Multiply base'), tone: '#fbbf24' },
                            { value: '2', label: vn(lang, 'Nhân tổng', 'Multiply total'), tone: '#fb923c' },
                          ]}
                        />
                      </Field>
                    </Grid>
                  </div>
                )
              })}
            </RowCard>
          )
        })}
        {!items.length ? <Empty c={c}>{vn(lang, 'Người chơi không có thuộc tính nào.', 'No attributes.')}</Empty> : null}
      </div>
    </div>
  )
}

export function PanelSnbt({ ctx }) {
  const { c, lang, vn, ops, tree, file, selection } = ctx
  const [scope, setScope] = useState('file')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  const node = scope === 'node' ? selection.node : tree
  useEffect(() => {
    setDraft(node ? (scope === 'file' ? snbtDocument(tree) : snbtValue(node)) : '')
    setError('')
    setStatus('')
  }, [scope, selection.path, tree])

  const apply = () => {
    try {
      if (scope === 'file') {
        const parsed = snbtParse(draft)
        ops.mutate(() => {
          tree.name = parsed.name
          tree.value = parsed.value
        })
      } else {
        const parsed = snbtParseValue(draft)
        ops.mutate(() => {
          selection.node.type = parsed.type
          selection.node.value = parsed.value
        })
      }
      setError('')
      setStatus(vn(lang, 'Đã áp dụng vào cây.', 'Applied to the tree.'))
    } catch (err) {
      setError(err.message)
      setStatus('')
    }
  }

  const bytes = useMemo(() => new Blob([draft]).size, [draft])

  return (
    <div className="flex flex-col gap-2.5">
      <Head c={c} icon={FileCode} title="SNBT" right={<span className="text-[10.5px] font-mono" style={{ color: c.faint }}>{formatBytes(bytes)}</span>} />
      <Grid cols={2}>
        <Toggle c={c} on={scope === 'file'} label={vn(lang, 'Cả tệp', 'Whole file')} onClick={() => setScope('file')} />
        <Toggle c={c} on={scope === 'node'} label={vn(lang, 'Tag đang chọn', 'Selected tag')} disabled={!selection.node} onClick={() => setScope('node')} />
      </Grid>
      <p className="text-[10.5px] font-mono px-1 truncate" style={{ color: c.faint }}>
        {scope === 'file' ? file : selection.path ? String(selection.path).replace(/\|/g, ' › ') : '—'}
      </p>
      <textarea
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setStatus('') }}
        spellCheck={false}
        className="min-h-[360px] px-2 py-1.5 rounded-md text-[11.5px] font-mono outline-none resize-y leading-relaxed"
        style={{ background: c.surface, border: `1px solid ${error ? 'rgba(239,68,68,0.5)' : c.border}`, color: c.text }}
      />
      {error ? <Note c={c} tone="bad" icon={WarningCircle}>{error}</Note> : null}
      {status ? <Note c={c} tone="ok" icon={CheckCircle}>{status}</Note> : null}
      <Grid cols={2}>
        <Btn c={c} size="sm" tone="accent" icon={CheckCircle} onClick={apply}>{vn(lang, 'Áp dụng', 'Apply')}</Btn>
        <Btn c={c} size="sm" icon={ArrowsClockwise} onClick={() => setDraft(scope === 'file' ? snbtDocument(tree) : snbtValue(node))}>
          {vn(lang, 'Định dạng lại', 'Reformat')}
        </Btn>
        <Btn c={c} size="sm" icon={ClipboardText} onClick={() => { navigator.clipboard?.writeText(draft).catch(() => {}) }}>
          {vn(lang, 'Sao chép', 'Copy')}
        </Btn>
        <Btn
          c={c}
          size="sm"
          icon={Clipboard}
          onClick={async () => {
            try {
              const text = await navigator.clipboard.readText()
              setDraft(text)
              setStatus(vn(lang, 'Đã dán từ clipboard.', 'Pasted from clipboard.'))
              setError('')
            } catch (err) {
              setError(vn(lang, 'Không đọc được clipboard.', 'Could not read the clipboard.'))
            }
          }}
        >
          {vn(lang, 'Dán', 'Paste')}
        </Btn>
      </Grid>
      <Note c={c} tone="info" icon={Info}>
        {vn(lang, 'Cú pháp: 1b byte, 1s short, 1L long, 1.5f float, 1.5d double, [B;1b,2b], [I;1,2], [L;1L], {K:1}, ["a","b"].', 'Syntax: 1b byte, 1s short, 1L long, 1.5f float, 1.5d double, [B;1b,2b], [I;1,2], [L;1L], {K:1}, ["a","b"].')}
      </Note>
    </div>
  )
}

export function PanelOverview({ ctx }) {
  const { c, lang, vn, ops, tree, info, file, world, onRestore, dirty } = ctx
  const stats = useMemo(() => (tree ? statsOf(tree) : null), [tree, ctx.version])
  const files = info?.files || []
  const summary = info?.summary || {}
  const max = stats ? Math.max(...Object.values(stats.counts), 1) : 1
  const backupSize = files.find((item) => item.rel === file)?.bak || 0

  return (
    <div className="flex flex-col gap-2.5">
      <Head c={c} icon={Info} title={vn(lang, 'Tổng quan', 'Overview')} />

      <Section c={c} title={vn(lang, 'Thế giới', 'World')} icon={Cube}>
        <div className="flex flex-col gap-1 text-[11.5px] font-mono" style={{ color: c.label }}>
          <span>{vn(lang, 'Tên', 'Name')}: <span style={{ color: c.text }}>{summary.name || world}</span></span>
          <span>{vn(lang, 'Phiên bản', 'Version')}: <span style={{ color: c.text }}>{summary.version || '—'}</span></span>
          <span>{vn(lang, 'Chơi lần cuối', 'Last played')}: <span style={{ color: c.text }}>{formatDate(num(summary.lastPlayed), lang) || '—'}</span></span>
          <span>{vn(lang, 'Dung lượng', 'Size')}: <span style={{ color: c.text }}>{formatBytes(info?.bytes || 0)}{info?.partial ? '+' : ''}</span></span>
          <span>{vn(lang, 'Người chơi', 'Players')}: <span style={{ color: c.text }}>{info?.players ?? 0}</span></span>
          <span className="break-all">{summary.spawn ? `${vn(lang, 'Spawn', 'Spawn')}: ${summary.spawn.join(', ')}` : ''}</span>
        </div>
      </Section>

      <Section c={c} title={vn(lang, 'Tệp NBT', 'NBT files')} icon={ListBullets}>
        <div className="flex flex-col gap-0.5 max-h-[180px] overflow-y-auto">
          {files.map((item) => (
            <div key={item.rel} className="flex items-center gap-1.5">
              <span className="text-[11.5px] font-mono truncate flex-1" style={{ color: file === item.rel ? c.accent : c.label }}>{item.rel}</span>
              <span className="text-[10.5px] font-mono" style={{ color: c.faint }}>{formatBytes(item.size)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section c={c} title={vn(lang, 'Bản sao an toàn', 'Backup')} icon={ShieldCheck}>
        {backupSize ? (
          <>
            <Empty c={c}>{vn(lang, `${file}.bak · ${formatBytes(backupSize)}`, `${file}.bak · ${formatBytes(backupSize)}`)}</Empty>
            <Btn c={c} size="sm" wide tone="warn" icon={ArrowsClockwise} disabled={!!dirty} onClick={onRestore} title={dirty ? vn(lang, 'Ghi hoặc bỏ thay đổi trước.', 'Write or discard changes first.') : ''}>
              {vn(lang, 'Khôi phục từ bản sao', 'Restore from backup')}
            </Btn>
          </>
        ) : (
          <Empty c={c}>{vn(lang, 'Chưa có .bak cho tệp này. Bản sao được tạo ở lần ghi đầu tiên.', 'No .bak for this file yet. A backup is created on the first write.')}</Empty>
        )}
      </Section>

      {stats ? (
        <Section c={c} title={vn(lang, 'Thành phần tag', 'Tag composition')} icon={Sliders}>
          <div className="flex flex-col gap-1">
            {Object.entries(stats.counts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <div key={type} className="flex items-center gap-1.5">
                <span className="w-14 shrink-0"><TypeChip type={type} /></span>
                <span className="h-1.5 rounded-full flex-1" style={{ background: c.surface }}>
                  <span className="block h-1.5 rounded-full" style={{ width: `${Math.max(4, (count / max) * 100)}%`, background: TYPE_TONE[type] || c.accent }} />
                </span>
                <span className="text-[10.5px] font-mono w-8 text-right" style={{ color: c.label }}>{count}</span>
              </div>
            ))}
          </div>
          <Empty c={c}>
            {vn(lang, `${stats.nodes} tag · sâu ${stats.depth} cấp · ${(tree.value || []).length} khoá gốc`, `${stats.nodes} tags · depth ${stats.depth} · ${(tree.value || []).length} root keys`)}
          </Empty>
        </Section>
      ) : null}

      <Section c={c} title={vn(lang, 'Khoá gốc', 'Root keys')} icon={ArrowSquareOut} defaultOpen={false}>
        <div className="flex flex-wrap gap-1">
          {(tree?.value || []).map((item) => (
            <button
              key={item.name}
              onClick={() => ops.jump(item.name)}
              className="h-7 px-2.5 rounded text-[11.5px] font-mono inline-flex items-center gap-1 min-w-0"
              style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.label }}
            >
              <span className="truncate max-w-[110px]">{item.name}</span>
              <span style={{ color: TYPE_TONE[item.type] }}>{summaryOf(item)}</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  )
}

export function PanelFor({ tab, ctx }) {
  if (tab === 'world') return <PanelWorld ctx={ctx} />
  if (tab === 'player') return <PanelPlayer ctx={ctx} />
  if (tab === 'items') return <PanelItems ctx={ctx} />
  if (tab === 'effects') return <PanelEffects ctx={ctx} />
  if (tab === 'attributes') return <PanelAttributes ctx={ctx} />
  if (tab === 'snbt') return <PanelSnbt ctx={ctx} />
  if (tab === 'overview') return <PanelOverview ctx={ctx} />
  return <PanelQuick ctx={ctx} />
}
