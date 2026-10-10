const fsp = require('fs').promises
const path = require('path')
const { Worker } = require('worker_threads')

const WORKER = path.join(__dirname, 'hashworker.cjs')
const WORKERS = 3
const CHUNK = 6
const MAX = 4000

let store = { hashes: {}, projects: {} }
let storeDir = ''
let saveTimer = 0

const storePath = (cacheDir) => path.join(cacheDir, 'file-index.json')
const keyOf = (file, stat) => `${path.basename(file)}|${stat.size}|${Math.round(stat.mtimeMs)}`

async function open(cacheDir) {
  if (!cacheDir) return
  if (storeDir === cacheDir) return
  storeDir = cacheDir
  const raw = await fsp.readFile(storePath(cacheDir), 'utf8').catch(() => '')
  if (!raw) return
  try {
    const data = JSON.parse(raw)
    store = {
      hashes: data?.hashes && typeof data.hashes === 'object' ? data.hashes : {},
      projects: data?.projects && typeof data.projects === 'object' ? data.projects : {},
    }
  } catch {
    store = { hashes: {}, projects: {} }
  }
}

function flush() {
  if (!storeDir) return
  cancelSave()
  saveTimer = setTimeout(async () => {
    const hashes = Object.entries(store.hashes).slice(-MAX)
    const projects = Object.entries(store.projects).slice(-MAX)
    await fsp.mkdir(storeDir, { recursive: true }).catch(() => {})
    await fsp.writeFile(storePath(storeDir), JSON.stringify({ hashes: Object.fromEntries(hashes), projects: Object.fromEntries(projects) }), 'utf8').catch(() => {})
  }, 400)
}

function cancelSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = 0
  }
}

function hashChunk(files) {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER, { workerData: { files } })
    const done = (out) => {
      worker.terminate().catch(() => {})
      resolve(out)
    }
    worker.once('message', done)
    worker.once('error', () => done([]))
    worker.once('exit', (code) => { if (code !== 0) done([]) })
  })
}

async function hashes({ dir, names = [], cacheDir }) {
  await open(cacheDir)
  const out = new Map()
  if (!dir || !names.length) return out
  const todo = []
  for (const name of names) {
    const file = path.join(dir, name)
    const stat = await fsp.stat(file).catch(() => null)
    if (!stat?.isFile()) continue
    const key = keyOf(file, stat)
    const known = store.hashes[key]
    if (known) out.set(name, known)
    else todo.push({ name, file, key })
  }
  if (!todo.length) return out
  const chunks = []
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK))
  let cursor = 0
  const worker = async () => {
    while (cursor < chunks.length) {
      const chunk = chunks[cursor]
      cursor += 1
      const pairs = await hashChunk(chunk.map((item) => item.file))
      const map = new Map(pairs)
      for (const item of chunk) {
        const value = map.get(item.file)
        if (!value) continue
        store.hashes[item.key] = value
        out.set(item.name, value)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(WORKERS, chunks.length) }, worker))
  flush()
  return out
}

async function projects({ sha1List = [], cacheDir, fetcher }) {
  await open(cacheDir)
  const out = new Map()
  if (!sha1List.length) return out
  const missing = []
  for (const hash of new Set(sha1List)) {
    if (!hash) continue
    const known = store.projects[hash]
    if (known) out.set(hash, known)
    else missing.push(hash)
  }
  if (!missing.length || !fetcher) return out
  const found = await fetcher(missing).catch(() => new Map())
  for (const [hash, row] of found || []) {
    store.projects[hash] = row
    out.set(hash, row)
  }
  flush()
  return out
}

const nameKeyOf = (file, stat) => keyOf(file, stat)

module.exports = { hashes, projects, nameKeyOf, open }
