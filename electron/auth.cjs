const { app, safeStorage } = require('electron')
const fs = require('fs')
const path = require('path')

const storeFile = () => path.join(app.getPath('userData'), 'auth.json')

function readStore() {
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function writeStore(data) {
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
    fs.writeFileSync(storeFile(), JSON.stringify(data), 'utf8')
  } catch (err) {
    console.error('[lunaspace] failed to persist auth store', err)
  }
}

function seal(value) {
  const text = JSON.stringify(value)
  try {
    if (safeStorage.isEncryptionAvailable()) return { v: 1, enc: true, data: safeStorage.encryptString(text).toString('base64') }
  } catch {}
  return { v: 1, enc: false, data: Buffer.from(text, 'utf8').toString('base64') }
}

function unseal(stored) {
  if (!stored || typeof stored !== 'object' || typeof stored.data !== 'string') return null
  try {
    const text = stored.enc
      ? safeStorage.decryptString(Buffer.from(stored.data, 'base64'))
      : Buffer.from(stored.data, 'base64').toString('utf8')
    return JSON.parse(text)
  } catch {
    return null
  }
}

function setToken(id, value) {
  if (!id) return
  const store = readStore()
  if (!value) delete store[id]
  else store[id] = seal(value)
  writeStore(store)
}

function getToken(id) {
  if (!id) return null
  return unseal(readStore()[id])
}

module.exports = { setToken, getToken }
