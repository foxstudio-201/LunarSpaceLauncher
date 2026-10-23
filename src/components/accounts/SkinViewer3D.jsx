import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { ArrowCounterClockwise, Warning } from '@phosphor-icons/react'
import { palette } from '../../lib/palette'
import { t } from '../../i18n/translations'
import { rgbaCss, rgbToHex } from './skinColor'

const CAMERA_FOV = 35
const CAMERA_DISTANCE = 82
const MIN_ZOOM = 0.65
const MAX_ZOOM = 2.6
const HALF_PI = Math.PI / 2
const LOUPE_SIZE = 164
const LOUPE_SPAN = 16
const GIZMO_SIZE = 132
const GIZMO_CENTER = GIZMO_SIZE / 2
const GIZMO_RADIUS = 42
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const AXIS_DOTS = [
  { key: '+X', label: 'X', color: '#ef5350', vector: [1, 0, 0], hint: 'accounts.skin.view.dir.right' },
  { key: '-X', label: '−X', color: '#ef5350', vector: [-1, 0, 0], hint: 'accounts.skin.view.dir.left' },
  { key: '+Y', label: 'Y', color: '#4ade80', vector: [0, 1, 0], hint: 'accounts.skin.view.dir.top' },
  { key: '-Y', label: '−Y', color: '#4ade80', vector: [0, -1, 0], hint: 'accounts.skin.view.dir.bottom' },
  { key: '+Z', label: 'Z', color: '#60a5fa', vector: [0, 0, 1], hint: 'accounts.skin.view.dir.front' },
  { key: '-Z', label: '−Z', color: '#60a5fa', vector: [0, 0, -1], hint: 'accounts.skin.view.dir.back' },
]

const AXIS_VIEWS = {
  '+X': { yaw: -HALF_PI, pitch: 0 },
  '-X': { yaw: HALF_PI, pitch: 0 },
  '+Y': { yaw: 0, pitch: HALF_PI },
  '-Y': { yaw: 0, pitch: -HALF_PI },
  '+Z': { yaw: 0, pitch: 0 },
  '-Z': { yaw: Math.PI, pitch: 0 },
}

function faceRects(u, v, width, height, depth) {
  return [
    [u + width + depth, v + depth, u + width + depth * 2, v + depth + height],
    [u, v + depth, u + depth, v + depth + height],
    [u + depth, v, u + width + depth, v + depth],
    [u + width + depth, v, u + width * 2 + depth, v + depth],
    [u + depth, v + depth, u + width + depth, v + depth + height],
    [u + width + depth * 2, v + depth, u + width * 2 + depth * 2, v + depth + height],
  ]
}

function applyUVs(geometry, u, v, width, height, depth, textureWidth, textureHeight) {
  const toFace = (x1, y1, x2, y2) => [
    new THREE.Vector2(x1 / textureWidth, 1 - y2 / textureHeight),
    new THREE.Vector2(x2 / textureWidth, 1 - y2 / textureHeight),
    new THREE.Vector2(x2 / textureWidth, 1 - y1 / textureHeight),
    new THREE.Vector2(x1 / textureWidth, 1 - y1 / textureHeight),
  ]
  const top = toFace(u + depth, v, u + width + depth, v + depth)
  const bottom = toFace(u + width + depth, v, u + width * 2 + depth, v + depth)
  const left = toFace(u, v + depth, u + depth, v + depth + height)
  const front = toFace(u + depth, v + depth, u + width + depth, v + depth + height)
  const right = toFace(u + width + depth, v + depth, u + width + depth * 2, v + height + depth)
  const back = toFace(u + width + depth * 2, v + depth, u + width * 2 + depth * 2, v + height + depth)
  const attribute = geometry.attributes.uv
  const data = []
  for (const face of [right, left, top, bottom, front, back]) {
    for (const uv of [face[3], face[2], face[0], face[1]]) data.push(uv.x, uv.y)
  }
  attribute.set(new Float32Array(data))
  attribute.needsUpdate = true
}

function faceBases(geometry) {
  const position = geometry.attributes.position
  const uv = geometry.attributes.uv
  const bases = []
  for (let group = 0; group < 6; group += 1) {
    const vertices = []
    for (let i = 0; i < 4; i += 1) {
      vertices.push({
        p: new THREE.Vector3().fromBufferAttribute(position, group * 4 + i),
        uv: new THREE.Vector2().fromBufferAttribute(uv, group * 4 + i),
      })
    }
    const uMin = Math.min(...vertices.map((item) => item.uv.x))
    const uMax = Math.max(...vertices.map((item) => item.uv.x))
    const vMin = Math.min(...vertices.map((item) => item.uv.y))
    const vMax = Math.max(...vertices.map((item) => item.uv.y))
    const at = (x, y) => vertices.find((item) => Math.abs(item.uv.x - x) < 1e-6 && Math.abs(item.uv.y - y) < 1e-6)?.p || vertices[0].p
    const origin = at(uMin, vMin).clone()
    const uEdge = at(uMax, vMin).clone().sub(origin)
    const vEdge = at(uMin, vMax).clone().sub(origin)
    bases.push({
      uMin,
      uMax,
      vMin,
      vMax,
      origin,
      uEdge: uEdge.divideScalar(Math.max(1e-6, uMax - uMin)),
      vEdge: vEdge.divideScalar(Math.max(1e-6, vMax - vMin)),
    })
  }
  return bases
}

function groupOfNormal(normal) {
  if (normal.x > 0.5) return 0
  if (normal.x < -0.5) return 1
  if (normal.y > 0.5) return 2
  if (normal.y < -0.5) return 3
  if (normal.z > 0.5) return 4
  return 5
}

function buildGridGeometry(rects, bases, textureWidth, textureHeight) {
  const points = []
  for (let group = 0; group < 6; group += 1) {
    const rect = rects[group]
    const basis = bases[group]
    const width = rect[2] - rect[0]
    const height = rect[3] - rect[1]
    if (width <= 0 || height <= 0) continue
    const u0 = rect[0] / textureWidth
    const u1 = rect[2] / textureWidth
    const v0 = 1 - rect[3] / textureHeight
    const v1 = 1 - rect[1] / textureHeight
    const point = (u, v) => basis.origin.clone()
      .addScaledVector(basis.uEdge, u - basis.uMin)
      .addScaledVector(basis.vEdge, v - basis.vMin)
    const center = point((u0 + u1) / 2, (v0 + v1) / 2)
    const offset = center.clone().normalize().multiplyScalar(0.07)
    const push = (from, to) => {
      points.push(from.x + offset.x, from.y + offset.y, from.z + offset.z)
      points.push(to.x + offset.x, to.y + offset.y, to.z + offset.z)
    }
    for (let i = 0; i <= width; i += 1) {
      const u = u0 + ((u1 - u0) * i) / width
      push(point(u, v0), point(u, v1))
    }
    for (let j = 0; j <= height; j += 1) {
      const v = v0 + ((v1 - v0) * j) / height
      push(point(u0, v), point(u1, v))
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  return geometry
}

export default function SkinViewer3D({
  theme,
  lang,
  skinCanvasRef,
  capeCanvasRef,
  model,
  asset,
  paintLayer,
  outerVisible,
  hiddenParts = [],
  showGrid = false,
  brushSize = 1,
  brushSoft = false,
  tool,
  color,
  alpha,
  mirrorMode = 'off',
  version,
  onStrokeStart,
  onStrokeEnd,
  onPick,
  fill = false,
  wide = false,
  loupeRight = 12,
  gizmoLeft = 12,
}) {
  const c = palette(theme)
  const hostRef = useRef(null)
  const overlayRef = useRef(null)
  const stateRef = useRef(null)
  const gizmoBallsRef = useRef({})
  const gizmoLinesRef = useRef({})
  const propsRef = useRef({})
  propsRef.current = { theme, lang, model, asset, paintLayer, outerVisible, hiddenParts, showGrid, brushSize, brushSoft, tool, color, alpha, mirrorMode, onStrokeStart, onStrokeEnd, onPick, wide, loupeRight }
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    const overlay = overlayRef.current
    const skinCanvas = skinCanvasRef?.current
    const capeCanvas = capeCanvasRef?.current
    if (!host || !overlay || !skinCanvas || !capeCanvas) return undefined

    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setFailed(true)
      return undefined
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.inset = '0'
    renderer.domElement.style.zIndex = '0'
    renderer.domElement.style.touchAction = 'none'
    renderer.domElement.style.cursor = 'crosshair'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 300)
    camera.position.set(0, 0, CAMERA_DISTANCE / 1.05)
    camera.lookAt(0, 0, 0)

    const skinTexture = new THREE.CanvasTexture(skinCanvas)
    skinTexture.magFilter = THREE.NearestFilter
    skinTexture.minFilter = THREE.NearestFilter
    skinTexture.generateMipmaps = false
    skinTexture.colorSpace = THREE.SRGBColorSpace
    const capeTexture = new THREE.CanvasTexture(capeCanvas)
    capeTexture.magFilter = THREE.NearestFilter
    capeTexture.minFilter = THREE.NearestFilter
    capeTexture.generateMipmaps = false
    capeTexture.colorSpace = THREE.SRGBColorSpace

    const innerMaterial = new THREE.MeshBasicMaterial({ map: skinTexture, transparent: true, alphaTest: 0.01, side: THREE.FrontSide })
    const outerMaterial = new THREE.MeshBasicMaterial({ map: skinTexture, transparent: true, alphaTest: 0.01, side: THREE.FrontSide })
    const capeMaterial = new THREE.MeshBasicMaterial({ map: capeTexture, transparent: true, alphaTest: 0.01, side: THREE.FrontSide })
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.75 })
    const baseMaterial = new THREE.MeshBasicMaterial({ color: 0x3b414b, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.FrontSide })

    const state = {
      renderer,
      scene,
      camera,
      skinTexture,
      capeTexture,
      skinCanvas,
      capeCanvas,
      innerMaterial,
      outerMaterial,
      capeMaterial,
      gridMaterial,
      baseMaterial,
      grids: [],
      player: null,
      tilt: null,
      inner: [],
      outer: [],
      capeMesh: null,
      capeSolo: null,
      yaw: 0.34,
      pitch: -0.06,
      zoom: 1.05,
      panX: 0,
      panY: 0,
      panning: null,
      frame: 0,
      hover: null,
      pointer: null,
      hoverEnabled: false,
      rotating: null,
      stroke: null,
      dirtyTextures: true,
      raycaster: new THREE.Raycaster(),
      pointerNdc: new THREE.Vector2(),
      lastPointer: { x: 0, y: 0 },
      disposed: false,
    }
    stateRef.current = state

    const faceIndex = (value) => {
      const uv = value.uv
      const data = value.object.userData
      const group = groupOfNormal(value.face.normal)
      const rect = data.rects[group]
      const x = clamp(Math.floor(uv.x * data.textureWidth), rect[0], rect[2] - 1)
      const y = clamp(Math.floor((1 - uv.y) * data.textureHeight), rect[1], rect[3] - 1)
      return { group, rect, x, y, data }
    }

    const mirrorAxis = { x: 0, y: 1, z: 2 }
    const mirrorGroups = {
      x: [1, 0, 2, 3, 4, 5],
      y: [0, 1, 3, 2, 4, 5],
      z: [0, 1, 2, 3, 5, 4],
    }
    const mirrorPart = { rightArm: 'leftArm', leftArm: 'rightArm', rightLeg: 'leftLeg', leftLeg: 'rightLeg' }

    const mirrorTarget = (hit, mode) => {
      const axis = mirrorAxis[mode]
      if (axis === undefined) return null
      const source = hit.object
      const sourceData = source.userData
      if (!sourceData?.bases) return null
      const local = source.worldToLocal(hit.point.clone())
      local.setComponent(axis, -local.getComponent(axis))
      let mesh = source
      let data = sourceData
      if (mode === 'x' && mirrorPart[sourceData.part]) {
        const pool = sourceData.layer === 'outer' ? state.outer : state.inner
        const sibling = pool.find((item) => item.userData.part === mirrorPart[sourceData.part])
        if (sibling) {
          mesh = sibling
          data = sibling.userData
        }
      }
      const group = mirrorGroups[mode][groupOfNormal(hit.face.normal)]
      const basis = data.bases[group]
      const relative = local.sub(basis.origin)
      const u = basis.uMin + relative.dot(basis.uEdge) / Math.max(1e-6, basis.uEdge.lengthSq())
      const v = basis.vMin + relative.dot(basis.vEdge) / Math.max(1e-6, basis.vEdge.lengthSq())
      const rect = data.rects[group]
      return {
        mesh,
        data,
        group,
        rect,
        x: clamp(Math.floor(u * data.textureWidth), rect[0], rect[2] - 1),
        y: clamp(Math.floor((1 - v) * data.textureHeight), rect[1], rect[3] - 1),
      }
    }

    const paintPoint = (hit, mode) => {
      const { rect, x, y, data } = faceIndex(hit)
      const canvas = data.asset === 'cape' ? state.capeCanvas : state.skinCanvas
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const current = propsRef.current
      const clear = mode === 'eraser' || current.alpha === 0
      const size = clamp(Number(current.brushSize) || 1, 1, 8)
      const half = Math.floor(size / 2)
      const paint = (bounds, px, py, factor = 1) => {
        if (px < bounds[0] || py < bounds[1] || px >= bounds[2] || py >= bounds[3]) return
        if (factor >= 1) {
          if (clear) ctx.clearRect(px, py, 1, 1)
          else {
            ctx.fillStyle = rgbaCss(current.color, current.alpha)
            ctx.fillRect(px, py, 1, 1)
          }
          return
        }
        if (clear) {
          ctx.save()
          ctx.globalCompositeOperation = 'destination-out'
          ctx.globalAlpha = factor
          ctx.fillStyle = '#000'
          ctx.fillRect(px, py, 1, 1)
          ctx.restore()
          return
        }
        ctx.fillStyle = rgbaCss(current.color, Math.round(current.alpha * factor))
        ctx.fillRect(px, py, 1, 1)
      }
      const stamp = (bounds, cx, cy) => {
        const x0 = cx - half
        const y0 = cy - half
        for (let dx = 0; dx < size; dx += 1) {
          for (let dy = 0; dy < size; dy += 1) paint(bounds, x0 + dx, y0 + dy, 1)
        }
        if (current.brushSoft) {
          for (let dx = -1; dx <= size; dx += 1) {
            for (let dy = -1; dy <= size; dy += 1) {
              if (dx === -1 || dx === size || dy === -1 || dy === size) paint(bounds, x0 + dx, y0 + dy, 0.35)
            }
          }
        }
      }
      stamp(rect, x, y)
      const mirrored = mirrorTarget(hit, current.mirrorMode)
      if (mirrored && mirrored.data.asset === data.asset && !(mirrored.rect === rect && mirrored.x === x && mirrored.y === y)) {
        stamp(mirrored.rect, mirrored.x, mirrored.y)
      }
      state.dirtyTextures = true
      requestRender()
    }

    const floodPaint = (face) => {
      const { rect, x, y, data } = face
      const canvas = data.asset === 'cape' ? state.capeCanvas : state.skinCanvas
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const width = canvas.width
      const height = canvas.height
      const image = ctx.getImageData(0, 0, width, height)
      const pixels = image.data
      const start = (y * width + x) * 4
      const target = [pixels[start], pixels[start + 1], pixels[start + 2], pixels[start + 3]]
      const current = propsRef.current
      const clear = current.alpha === 0
      const fillRgba = rgbaCss(current.color, current.alpha)
      const parse = (() => {
        const match = fillRgba.match(/rgba?\(([^)]+)\)/)
        if (!match) return [255, 255, 255, 255]
        const parts = match[1].split(',').map((part) => Number(part.trim()))
        return [parts[0], parts[1], parts[2], Math.round((parts[3] ?? 1) * 255)]
      })()
      if (!clear && target.every((value, index) => value === parse[index])) return
      const queue = [[x, y]]
      const seen = new Uint8Array(width * height)
      while (queue.length) {
        const [cx, cy] = queue.pop()
        if (cx < rect[0] || cy < rect[1] || cx >= rect[2] || cy >= rect[3]) continue
        const pos = cy * width + cx
        if (seen[pos]) continue
        seen[pos] = 1
        const offset = pos * 4
        if (pixels[offset] !== target[0] || pixels[offset + 1] !== target[1] || pixels[offset + 2] !== target[2] || pixels[offset + 3] !== target[3]) continue
        if (clear) {
          pixels[offset] = 0
          pixels[offset + 1] = 0
          pixels[offset + 2] = 0
          pixels[offset + 3] = 0
        } else {
          pixels[offset] = parse[0]
          pixels[offset + 1] = parse[1]
          pixels[offset + 2] = parse[2]
          pixels[offset + 3] = parse[3]
        }
        queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
      }
      ctx.putImageData(image, 0, 0)
      state.dirtyTextures = true
      requestRender()
    }

    const resolveHit = (clientX, clientY) => {
      const rect = renderer.domElement.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      state.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1
      state.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1
      state.raycaster.setFromCamera(state.pointerNdc, camera)
      const targets = [...state.inner, ...state.outer, state.capeMesh, state.capeSolo].filter(Boolean)
      const hits = state.raycaster.intersectObjects(targets, false)
      const current = propsRef.current
      for (const hit of hits) {
        if (!hit.object.visible) continue
        if ((current.hiddenParts || []).includes(hit.object.userData.part)) continue
        const hitAsset = hit.object.userData.asset
        if (current.asset === 'cape') {
          if (hitAsset === 'cape') return hit
          return null
        }
        if (hitAsset === 'cape') {
          const { x, y } = faceIndex(hit)
          const pixel = state.capeCanvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data
          if (pixel[3] === 0) continue
          return null
        }
        if (hit.object.userData.layer !== current.paintLayer) continue
        return hit
      }
      return null
    }

    const drawLoupe = (ctx, hit) => {
      const current = propsRef.current
      if (!current.wide) return
      if (!['pencil', 'eraser', 'fill'].includes(current.tool)) return
      const { rect, x, y, data } = faceIndex(hit)
      const canvas = data.asset === 'cape' ? state.capeCanvas : state.skinCanvas
      const width = overlay.width / (overlay.__dpr || 1)
      const height = overlay.height / (overlay.__dpr || 1)
      if (width < LOUPE_SIZE + 20 || height < LOUPE_SIZE + 20) return
      const pad = 9
      const footer = 18
      const inner = LOUPE_SIZE - pad * 2 - footer
      const cell = inner / LOUPE_SPAN
      const left = clamp(width - (current.loupeRight || 12) - LOUPE_SIZE, 8, width - LOUPE_SIZE - 8)
      const top = height - 12 - LOUPE_SIZE
      const ox = left + pad
      const oy = top + pad
      const sx = x - LOUPE_SPAN / 2
      const sy = y - LOUPE_SPAN / 2
      const size = clamp(Number(current.brushSize) || 1, 1, 8)
      const half = Math.floor(size / 2)
      const clear = current.tool === 'eraser' || current.alpha === 0

      ctx.save()
      ctx.beginPath()
      ctx.roundRect(left, top, LOUPE_SIZE, LOUPE_SIZE, 11)
      ctx.clip()
      ctx.fillStyle = 'rgba(12,16,22,0.94)'
      ctx.fillRect(left, top, LOUPE_SIZE, LOUPE_SIZE)
      ctx.save()
      ctx.beginPath()
      ctx.rect(ox, oy, inner, inner)
      ctx.clip()
      ctx.fillStyle = 'rgba(255,255,255,0.055)'
      for (let gy = 0; gy < LOUPE_SPAN; gy += 1) {
        for (let gx = 0; gx < LOUPE_SPAN; gx += 1) {
          if ((gx + gy) % 2) continue
          ctx.fillRect(ox + gx * cell, oy + gy * cell, cell, cell)
        }
      }
      const cx0 = Math.max(0, sx)
      const cy0 = Math.max(0, sy)
      const cx1 = Math.min(canvas.width, sx + LOUPE_SPAN)
      const cy1 = Math.min(canvas.height, sy + LOUPE_SPAN)
      if (cx1 > cx0 && cy1 > cy0) {
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(canvas, cx0, cy0, cx1 - cx0, cy1 - cy0, ox + (cx0 - sx) * cell, oy + (cy0 - sy) * cell, (cx1 - cx0) * cell, (cy1 - cy0) * cell)
        ctx.imageSmoothingEnabled = true
      }
      ctx.beginPath()
      ctx.rect(ox, oy, inner, inner)
      ctx.rect(ox + (rect[0] - sx) * cell, oy + (rect[1] - sy) * cell, (rect[2] - rect[0]) * cell, (rect[3] - rect[1]) * cell)
      ctx.fillStyle = 'rgba(6,9,13,0.48)'
      ctx.fill('evenodd')
      ctx.strokeStyle = 'rgba(255,255,255,0.09)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i <= LOUPE_SPAN; i += 1) {
        const gx = Math.round(ox + i * cell) + 0.5
        const gy = Math.round(oy + i * cell) + 0.5
        ctx.moveTo(gx, oy)
        ctx.lineTo(gx, oy + inner)
        ctx.moveTo(ox, gy)
        ctx.lineTo(ox + inner, gy)
      }
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,0.32)'
      ctx.strokeRect(ox + (rect[0] - sx) * cell, oy + (rect[1] - sy) * cell, (rect[2] - rect[0]) * cell, (rect[3] - rect[1]) * cell)
      const brush = (bx, by, ghost) => {
        const boxX = ox + (bx - half - sx) * cell
        const boxY = oy + (by - half - sy) * cell
        const box = size * cell
        if (!ghost) {
          ctx.fillStyle = clear ? 'rgba(248,113,113,0.26)' : rgbaCss(current.color, 88)
          ctx.fillRect(boxX, boxY, box, box)
        }
        if (current.brushSoft) {
          ctx.setLineDash([3, 2])
          ctx.strokeStyle = ghost ? 'rgba(167,139,250,0.8)' : 'rgba(255,255,255,0.55)'
          ctx.lineWidth = 1
          ctx.strokeRect(boxX - cell, boxY - cell, box + cell * 2, box + cell * 2)
          ctx.setLineDash([])
        }
        ctx.strokeStyle = ghost ? 'rgba(167,139,250,0.95)' : 'rgba(255,255,255,0.95)'
        ctx.lineWidth = 1.4
        ctx.strokeRect(boxX, boxY, box, box)
      }
      brush(x, y, false)
      const mirrored = mirrorTarget(hit, current.mirrorMode)
      if (mirrored && mirrored.data.asset === data.asset && !(mirrored.rect === rect && mirrored.x === x && mirrored.y === y)) {
        brush(mirrored.x, mirrored.y, true)
      }
      ctx.restore()
      ctx.fillStyle = 'rgba(9,12,17,0.86)'
      ctx.fillRect(left, top + pad + inner, LOUPE_SIZE, footer + pad)
      ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillStyle = 'rgba(255,255,255,0.62)'
      ctx.fillText(`${size} px`, left + pad, top + pad + inner + footer / 2)
      ctx.textAlign = 'right'
      ctx.fillStyle = 'rgba(226,232,240,0.86)'
      ctx.fillText(`×${Math.round(cell)}`, left + LOUPE_SIZE - pad, top + pad + inner + footer / 2)
      ctx.restore()
      ctx.beginPath()
      ctx.roundRect(left + 0.5, top + 0.5, LOUPE_SIZE - 1, LOUPE_SIZE - 1, 11)
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(255,255,255,0.16)'
      ctx.stroke()
    }

    const drawHover = () => {
      const ctx = overlay.getContext('2d', { willReadFrequently: true })
      const width = overlay.width / (overlay.__dpr || 1)
      const height = overlay.height / (overlay.__dpr || 1)
      const dpr = overlay.__dpr || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      const current = propsRef.current
      if (!state.hoverEnabled || state.rotating || current.tool === 'rotate') return
      const hit = resolveHit(state.lastPointer.x, state.lastPointer.y)
      if (!hit) return
      const size = clamp(Number(current.brushSize) || 1, 1, 8)
      const half = Math.floor(size / 2)
      const rendererRect = renderer.domElement.getBoundingClientRect()
      const draw = (mesh, data, group, rect, cx, cy, ghost) => {
        const px0 = Math.max(rect[0], cx - half)
        const px1 = Math.min(rect[2], cx - half + size)
        const py0 = Math.max(rect[1], cy - half)
        const py1 = Math.min(rect[3], cy - half + size)
        if (px1 <= px0 || py1 <= py0) return
        const basis = data.bases[group]
        const u0 = px0 / data.textureWidth
        const u1 = px1 / data.textureWidth
        const v0 = 1 - py1 / data.textureHeight
        const v1 = 1 - py0 / data.textureHeight
        const point = (u, v) => basis.origin.clone()
          .addScaledVector(basis.uEdge, u - basis.uMin)
          .addScaledVector(basis.vEdge, v - basis.vMin)
          .applyMatrix4(mesh.matrixWorld)
          .project(camera)
        const corners = [point(u0, v0), point(u1, v0), point(u1, v1), point(u0, v1)]
        const screen = corners.map((corner) => ({
          x: (corner.x * 0.5 + 0.5) * rendererRect.width,
          y: (-corner.y * 0.5 + 0.5) * rendererRect.height,
        }))
        ctx.beginPath()
        screen.forEach((corner, index) => {
          if (index === 0) ctx.moveTo(corner.x, corner.y)
          else ctx.lineTo(corner.x, corner.y)
        })
        ctx.closePath()
        if (!ghost && current.alpha > 0) {
          ctx.fillStyle = rgbaCss(current.color, Math.min(120, current.alpha * 0.5))
          ctx.fill()
        }
        if (ghost) ctx.setLineDash([4, 3])
        ctx.lineWidth = 2
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'
        ctx.stroke()
        ctx.lineWidth = 1
        ctx.strokeStyle = ghost ? 'rgba(167,139,250,0.95)' : 'rgba(255,255,255,0.95)'
        ctx.stroke()
        if (ghost) ctx.setLineDash([])
      }
      const { group, rect, x, y, data } = faceIndex(hit)
      draw(hit.object, data, group, rect, x, y, false)
      const mirrored = mirrorTarget(hit, current.mirrorMode)
      if (mirrored && mirrored.data.asset === data.asset && !(mirrored.rect === rect && mirrored.x === x && mirrored.y === y)) {
        draw(mirrored.mesh, mirrored.data, mirrored.group, mirrored.rect, mirrored.x, mirrored.y, true)
      }
      if (current.wide) drawLoupe(ctx, hit)
    }

    const updateGizmo = () => {
      const balls = gizmoBallsRef.current
      const lines = gizmoLinesRef.current
      const center = GIZMO_CENTER
      const radius = GIZMO_RADIUS
      const cp = Math.cos(state.pitch)
      const sp = Math.sin(state.pitch)
      const cy = Math.cos(state.yaw)
      const sy = Math.sin(state.yaw)
      const positions = {}
      for (const dot of AXIS_DOTS) {
        const [x, y, z] = dot.vector
        const y1 = y * cp - z * sp
        const z1 = y * sp + z * cp
        const x2 = x * cy + z1 * sy
        const z2 = -x * sy + z1 * cy
        positions[dot.key] = { x: center + x2 * radius, y: center - y1 * radius, z: z2 }
      }
      const wrapped = new Set()
      const squeezed = new Set()
      for (const [posKey, negKey] of [['+X', '-X'], ['+Y', '-Y'], ['+Z', '-Z']]) {
        const a = positions[posKey]
        const b = positions[negKey]
        if (Math.hypot(a.x - b.x, a.y - b.y) >= 22) continue
        const nearKey = a.z >= b.z ? posKey : negKey
        wrapped.add(nearKey === posKey ? negKey : posKey)
        squeezed.add(nearKey)
      }
      for (const dot of AXIS_DOTS) {
        const pos = positions[dot.key]
        const node = balls[dot.key]
        if (!node) continue
        node.style.opacity = String(0.6 + ((pos.z + 1) / 2) * 0.4)
        const ball = node.querySelector('.gizmo-ball')
        const hit = node.querySelector('.gizmo-hit')
        const ring = node.querySelector('.gizmo-ring')
        const label = node.querySelector('.gizmo-label')
        const isWrapped = wrapped.has(dot.key)
        const isSqueezed = squeezed.has(dot.key)
        if (ball) {
          ball.setAttribute('r', isWrapped ? '13.5' : dot.label.length > 1 ? '9.5' : '10.5')
          ball.setAttribute('fill', isWrapped ? 'none' : dot.color)
          ball.setAttribute('stroke', isWrapped ? dot.color : 'rgba(4,8,12,0.35)')
          ball.setAttribute('stroke-width', isWrapped ? '2.2' : '1')
        }
        if (hit) {
          hit.setAttribute('r', isWrapped ? '0' : isSqueezed ? '11' : '16')
          hit.setAttribute('fill', isWrapped ? 'none' : 'transparent')
        }
        if (ring) ring.setAttribute('pointer-events', isWrapped ? 'stroke' : 'none')
        if (label) label.setAttribute('opacity', isWrapped ? '0' : '1')
        node.setAttribute('transform', `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`)
      }
      for (const axis of ['X', 'Y', 'Z']) {
        const line = lines[axis]
        const end = positions[`+${axis}`]
        if (!line || !end) continue
        line.setAttribute('x2', end.x.toFixed(1))
        line.setAttribute('y2', end.y.toFixed(1))
      }
    }

    const renderFrame = () => {
      state.frame = 0
      if (state.disposed) return
      if (state.dirtyTextures) {
        state.skinTexture.needsUpdate = true
        state.capeTexture.needsUpdate = true
        state.dirtyTextures = false
      }
      const current = propsRef.current
      const hidden = current.hiddenParts || []
      const capeMode = current.asset === 'cape'
      state.inner.forEach((mesh) => { mesh.visible = !capeMode && !hidden.includes(mesh.userData.part) })
      state.outer.forEach((mesh) => { mesh.visible = !capeMode && !!current.outerVisible && !hidden.includes(mesh.userData.part) })
      if (state.capeMesh) state.capeMesh.visible = !capeMode && !hidden.includes('cape')
      if (state.capeSolo) state.capeSolo.visible = capeMode && !hidden.includes('cape')
      if (state.player) state.player.position.set(state.panX, state.panY, 0)
      state.grids.forEach((grid) => { grid.visible = !!current.showGrid })
      state.scene.updateMatrixWorld(true)
      renderer.render(scene, camera)
      updateGizmo()
      drawHover()
    }

    function requestRender() {
      if (!state.frame && !state.disposed) state.frame = requestAnimationFrame(renderFrame)
    }
    state.requestRender = requestRender

    const makeBox = ({ width, height, depth, u, v, x, y, z, material, layer, assetKey, part, withBase = false }) => {
      const geometry = new THREE.BoxGeometry(width, height, depth)
      const textureWidth = 64
      const textureHeight = assetKey === 'cape' ? 32 : 64
      applyUVs(geometry, u, v, width, height, depth, textureWidth, textureHeight)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(x, y, z)
      mesh.userData = {
        textureWidth,
        textureHeight,
        rects: faceRects(u, v, width, height, depth),
        bases: faceBases(geometry),
        layer,
        asset: assetKey,
        part,
      }
      mesh.frustumCulled = false
      if (withBase || (layer === 'inner' && assetKey === 'skin')) {
        const back = new THREE.Mesh(geometry, baseMaterial)
        back.scale.setScalar(0.995)
        back.renderOrder = -1
        back.userData.base = true
        mesh.add(back)
      }
      const grid = new THREE.LineSegments(buildGridGeometry(mesh.userData.rects, mesh.userData.bases, textureWidth, textureHeight), gridMaterial)
      grid.renderOrder = 2
      grid.visible = false
      mesh.add(grid)
      state.grids.push(grid)
      return mesh
    }

    const buildPlayer = (slim) => {
      const group = new THREE.Group()
      const tilt = new THREE.Group()
      group.add(tilt)
      const inner = []
      const outer = []
      const armWidth = slim ? 3 : 4
      const armX = slim ? 5.65 : 6.15
      const innerParts = [
        { part: 'head', width: 8, height: 8, depth: 8, u: 0, v: 0, x: 0, y: 12, z: 0 },
        { part: 'body', width: 8, height: 12, depth: 4, u: 16, v: 16, x: 0, y: 2, z: 0 },
        { part: 'rightArm', width: armWidth, height: 12, depth: 4, u: 40, v: 16, x: -armX, y: 2, z: 0 },
        { part: 'leftArm', width: armWidth, height: 12, depth: 4, u: 32, v: 48, x: armX, y: 2, z: 0 },
        { part: 'rightLeg', width: 4, height: 12, depth: 4, u: 0, v: 16, x: -2.075, y: -10, z: -0.1 },
        { part: 'leftLeg', width: 4, height: 12, depth: 4, u: 16, v: 48, x: 2.075, y: -10, z: -0.1 },
      ]
      for (const part of innerParts) {
        const mesh = makeBox({ ...part, material: innerMaterial, layer: 'inner', assetKey: 'skin' })
        tilt.add(mesh)
        inner.push(mesh)
      }
      const outerParts = [
        { part: 'head', width: 9, height: 9, depth: 9, u: 32, v: 0, x: 0, y: 12, z: 0 },
        { part: 'body', width: 8.5, height: 12.5, depth: 4.5, u: 16, v: 32, x: 0, y: 2, z: 0 },
        { part: 'rightArm', width: armWidth + 0.5, height: 12.5, depth: 4.5, u: 40, v: 32, x: -armX, y: 2, z: 0 },
        { part: 'leftArm', width: armWidth + 0.5, height: 12.5, depth: 4.5, u: 48, v: 48, x: armX, y: 2, z: 0 },
        { part: 'rightLeg', width: 4.5, height: 12.5, depth: 4.5, u: 0, v: 32, x: -2.075, y: -10, z: -0.1 },
        { part: 'leftLeg', width: 4.5, height: 12.5, depth: 4.5, u: 0, v: 48, x: 2.075, y: -10, z: -0.1 },
      ]
      for (const part of outerParts) {
        const mesh = makeBox({ ...part, material: outerMaterial, layer: 'outer', assetKey: 'skin' })
        mesh.renderOrder = 1
        tilt.add(mesh)
        outer.push(mesh)
      }
      const capeGroup = new THREE.Group()
      capeGroup.position.set(0, 8, -2)
      capeGroup.rotation.x = (10.8 * Math.PI) / 180
      capeGroup.rotation.y = Math.PI
      const capeMesh = makeBox({
        part: 'cape',
        width: 10,
        height: 16,
        depth: 1,
        u: 0,
        v: 0,
        x: 0,
        y: -8,
        z: 0.5,
        material: capeMaterial,
        layer: 'cape',
        assetKey: 'cape',
      })
      capeGroup.add(capeMesh)
      tilt.add(capeGroup)
      const capeSoloGroup = new THREE.Group()
      const capeSolo = makeBox({
        part: 'cape',
        withBase: true,
        width: 10,
        height: 16,
        depth: 1,
        u: 0,
        v: 0,
        x: 0,
        y: 0,
        z: 0,
        material: capeMaterial,
        layer: 'cape',
        assetKey: 'cape',
      })
      capeSolo.scale.setScalar(2.1)
      capeSoloGroup.add(capeSolo)
      tilt.add(capeSoloGroup)
      group.rotation.y = state.yaw
      tilt.rotation.x = state.pitch
      return { group, tilt, inner, outer, capeMesh, capeSolo }
    }

    const rebuild = (slim) => {
      if (state.player) {
        state.scene.remove(state.player)
        state.player.traverse((item) => {
          if (item.geometry && !item.userData.outline && !item.userData.base) item.geometry.dispose()
        })
      }
      const built = buildPlayer(slim)
      state.player = built.group
      state.tilt = built.tilt
      state.inner = built.inner
      state.outer = built.outer
      state.capeMesh = built.capeMesh
      state.capeSolo = built.capeSolo
      state.scene.add(built.group)
      requestRender()
    }
    state.rebuild = rebuild
    rebuild(propsRef.current.model === 'slim')

    const resize = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      if (!width || !height) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      overlay.width = Math.round(width * dpr)
      overlay.height = Math.round(height * dpr)
      overlay.__dpr = dpr
      overlay.style.width = `${width}px`
      overlay.style.height = `${height}px`
      requestRender()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const setPointer = (event) => {
      state.lastPointer.x = event.clientX
      state.lastPointer.y = event.clientY
    }

    const beginPan = (event) => {
      state.panning = { x: event.clientX, y: event.clientY }
      state.hoverEnabled = false
      renderer.domElement.style.cursor = 'move'
      renderer.domElement.setPointerCapture?.(event.pointerId)
    }

    const beginRotate = (event) => {
      state.rotating = { x: event.clientX, y: event.clientY }
      state.hoverEnabled = false
      renderer.domElement.style.cursor = 'grabbing'
      renderer.domElement.setPointerCapture?.(event.pointerId)
    }

    const onPointerDown = (event) => {
      if (event.button === 1 || propsRef.current.tool === 'pan') {
        event.preventDefault()
        beginPan(event)
        return
      }
      if (event.button === 2 || propsRef.current.tool === 'rotate') {
        event.preventDefault()
        beginRotate(event)
        return
      }
      if (event.button !== 0) return
      event.preventDefault()
      const current = propsRef.current
      const hit = resolveHit(event.clientX, event.clientY)
      if (!hit) return
      const hitAsset = hit.object.userData.asset
      if (current.tool === 'picker') {
        const { x, y, data } = faceIndex(hit)
        const canvas = hitAsset === 'cape' ? state.capeCanvas : state.skinCanvas
        const pixel = canvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data
        if (pixel[3] > 0) current.onPick?.(rgbToHex(pixel[0], pixel[1], pixel[2]), pixel[3])
        return
      }
      current.onStrokeStart?.(hitAsset)
      if (current.tool === 'fill') {
        floodPaint(faceIndex(hit))
        const mirrored = mirrorTarget(hit, current.mirrorMode)
        if (mirrored && mirrored.data.asset === hitAsset) floodPaint(mirrored)
        current.onStrokeEnd?.(hitAsset)
        return
      }
      state.stroke = {
        asset: hitAsset,
        mode: current.tool,
        last: { x: event.clientX, y: event.clientY },
      }
      state.hoverEnabled = true
      setPointer(event)
      paintPoint(hit, current.tool)
      renderer.domElement.setPointerCapture?.(event.pointerId)
    }

    const onPointerMove = (event) => {
      setPointer(event)
      if (state.panning) {
        const dx = event.clientX - state.panning.x
        const dy = event.clientY - state.panning.y
        state.panning.x = event.clientX
        state.panning.y = event.clientY
        const rect = renderer.domElement.getBoundingClientRect()
        const visible = 2 * camera.position.z * Math.tan((CAMERA_FOV * Math.PI) / 360)
        const scale = visible / Math.max(1, rect.height)
        state.panX += dx * scale
        state.panY -= dy * scale
        if (state.player) state.player.position.set(state.panX, state.panY, 0)
        requestRender()
        return
      }
      if (state.rotating) {
        const dx = event.clientX - state.rotating.x
        const dy = event.clientY - state.rotating.y
        state.rotating.x = event.clientX
        state.rotating.y = event.clientY
        state.yaw += dx * 0.009
        state.pitch = clamp(state.pitch + dy * 0.009, -HALF_PI, HALF_PI)
        if (state.player) state.player.rotation.y = state.yaw
        if (state.tilt) state.tilt.rotation.x = state.pitch
        requestRender()
        return
      }
      if (state.stroke) {
        const last = state.stroke.last
        const dx = event.clientX - last.x
        const dy = event.clientY - last.y
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 3))
        for (let i = 1; i <= steps; i += 1) {
          const x = last.x + (dx * i) / steps
          const y = last.y + (dy * i) / steps
          const hit = resolveHit(x, y)
          if (!hit) continue
          if (hit.object.userData.asset !== state.stroke.asset) continue
          paintPoint(hit, state.stroke.mode)
        }
        state.stroke.last = { x: event.clientX, y: event.clientY }
        state.hoverEnabled = true
        requestRender()
        return
      }
      state.hoverEnabled = true
      requestRender()
    }

    const onPointerUp = (event) => {
      if (event?.pointerId !== undefined) renderer.domElement.releasePointerCapture?.(event.pointerId)
      const tool = propsRef.current.tool
      renderer.domElement.style.cursor = tool === 'rotate' ? 'grab' : tool === 'pan' ? 'move' : 'crosshair'
      if (state.panning) {
        state.panning = null
        state.hoverEnabled = true
        requestRender()
        return
      }
      if (state.rotating) {
        state.rotating = null
        state.hoverEnabled = true
        requestRender()
        return
      }
      if (state.stroke) {
        const assetKey = state.stroke.asset
        state.stroke = null
        propsRef.current.onStrokeEnd?.(assetKey)
        requestRender()
      }
    }

    const onPointerLeave = () => {
      if (state.rotating || state.stroke) return
      state.hoverEnabled = false
      requestRender()
    }

    const onWheel = (event) => {
      event.preventDefault()
      state.zoom = clamp(state.zoom * Math.exp(-event.deltaY * 0.0012), MIN_ZOOM, MAX_ZOOM)
      camera.position.z = CAMERA_DISTANCE / state.zoom
      requestRender()
    }

    const onContextMenu = (event) => event.preventDefault()

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onPointerUp)
    renderer.domElement.addEventListener('pointerleave', onPointerLeave)
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })
    renderer.domElement.addEventListener('contextmenu', onContextMenu)

    state.resetView = () => {
      state.yaw = 0.34
      state.pitch = -0.06
      state.zoom = 1.05
      state.panX = 0
      state.panY = 0
      camera.position.z = CAMERA_DISTANCE / state.zoom
      if (state.player) state.player.position.set(0, 0, 0)
      if (state.player) state.player.rotation.y = state.yaw
      if (state.tilt) state.tilt.rotation.x = state.pitch
      requestRender()
    }
    state.applyView = (yaw, pitch) => {
      state.yaw = yaw
      state.pitch = clamp(pitch, -HALF_PI, HALF_PI)
      if (state.player) state.player.rotation.y = state.yaw
      if (state.tilt) state.tilt.rotation.x = state.pitch
      requestRender()
    }
    state.available = true
    setFailed(false)

    return () => {
      state.disposed = true
      if (state.frame) cancelAnimationFrame(state.frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerUp)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.domElement.removeEventListener('contextmenu', onContextMenu)
      if (state.player) {
        state.scene.remove(state.player)
        state.player.traverse((item) => {
          if (item.geometry && !item.userData.outline && !item.userData.base) item.geometry.dispose()
        })
      }
      innerMaterial.dispose()
      outerMaterial.dispose()
      capeMaterial.dispose()
      gridMaterial.dispose()
      baseMaterial.dispose()
      skinTexture.dispose()
      capeTexture.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [skinCanvasRef, capeCanvasRef])

  useEffect(() => {
    const state = stateRef.current
    if (!state?.available) return
    state.dirtyTextures = true
    state.requestRender?.()
  }, [version])

  useEffect(() => {
    const state = stateRef.current
    if (!state?.available) return
    state.rebuild?.(model === 'slim')
  }, [model])

  useEffect(() => {
    stateRef.current?.requestRender?.()
  }, [outerVisible, paintLayer, hiddenParts, showGrid])

  useEffect(() => {
    const state = stateRef.current
    if (state?.renderer) state.renderer.domElement.style.cursor = tool === 'rotate' ? 'grab' : tool === 'pan' ? 'move' : 'crosshair'
  }, [tool])

  const resetView = () => {
    stateRef.current?.resetView?.()
  }

  const snapView = (key) => {
    const view = AXIS_VIEWS[key]
    if (view) stateRef.current?.applyView?.(view.yaw, view.pitch)
  }

  const axisTitle = (dot) => `${dot.label} · ${t(lang, dot.hint)}`

  return (
    <div
      ref={hostRef}
      className="relative w-full overflow-hidden rounded-xl"
      style={{
        height: fill ? '100%' : 'clamp(360px, 54vh, 620px)',
        border: `1px solid ${c.border}`,
        background: 'radial-gradient(circle at 50% 34%, #f8f9fb 0%, #d5dae1 64%, #b6bdc7 100%)',
      }}
    >
      <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }} />
      <div className="absolute" style={{ ...(wide ? { left: gizmoLeft, bottom: 10 } : {}), zIndex: 3, display: wide ? 'block' : 'none' }}>
        <svg className="skin-gizmo" width={GIZMO_SIZE} height={GIZMO_SIZE} viewBox={`0 0 ${GIZMO_SIZE} ${GIZMO_SIZE}`} role="group" aria-label={t(lang, 'accounts.skin.view.angle')} style={{ display: 'block' }}>
          <g strokeWidth="2.4" strokeLinecap="round" opacity="0.62">
            <line ref={(el) => { gizmoLinesRef.current.X = el }} x1={GIZMO_CENTER} y1={GIZMO_CENTER} x2={GIZMO_CENTER} y2={GIZMO_CENTER} stroke="#ef5350" />
            <line ref={(el) => { gizmoLinesRef.current.Y = el }} x1={GIZMO_CENTER} y1={GIZMO_CENTER} x2={GIZMO_CENTER} y2={GIZMO_CENTER} stroke="#4ade80" />
            <line ref={(el) => { gizmoLinesRef.current.Z = el }} x1={GIZMO_CENTER} y1={GIZMO_CENTER} x2={GIZMO_CENTER} y2={GIZMO_CENTER} stroke="#60a5fa" />
          </g>
          {AXIS_DOTS.map((dot) => (
            <g
              key={dot.key}
              ref={(el) => { gizmoBallsRef.current[dot.key] = el }}
              role="button"
              tabIndex={0}
              aria-label={axisTitle(dot)}
              onClick={() => snapView(dot.key)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  snapView(dot.key)
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              <circle className="gizmo-hit" r="16" fill="transparent" />
              <circle className="gizmo-ring" r="14.5" fill="none" stroke="transparent" strokeWidth="10" />
              <circle className="gizmo-ball" r={dot.label.length > 1 ? 9.5 : 10.5} fill={dot.color} stroke="rgba(4,8,12,0.35)" strokeWidth="1" />
              <text className="gizmo-label" y="0.5" textAnchor="middle" dominantBaseline="middle" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize={dot.label.length > 1 ? 7.5 : 9} fontWeight="700" fill="#0a1016">{dot.label}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className={`absolute top-2.5 flex items-center gap-1.5 ${wide ? 'left-1/2 -translate-x-1/2' : 'right-2.5'}`} style={{ zIndex: 3 }}>
        <button
          type="button"
          onClick={resetView}
          data-tip={t(lang, 'accounts.skin.view.reset')}
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.88)', border: `1px solid ${c.border}`, color: '#1f2937', backdropFilter: 'blur(6px)' }}
        >
          <ArrowCounterClockwise size={15} weight="bold" />
        </button>
      </div>
      {!wide && (
      <div
        className="absolute bottom-2.5 left-2.5 text-[9px] font-mono px-2 py-1 rounded-md pointer-events-none"
        style={{ background: 'rgba(255,255,255,0.88)', color: '#475569', border: `1px solid ${c.border}`, backdropFilter: 'blur(6px)', zIndex: 3 }}
      >
        {t(lang, 'accounts.skin.view.hint')}
      </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <Warning size={22} weight="duotone" style={{ color: '#f87171' }} />
          <p className="text-[11px]" style={{ color: '#475569' }}>{t(lang, 'accounts.skin.view.failed')}</p>
        </div>
      )}
    </div>
  )
}
