const { app } = require('electron')
const https = require('https')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const AUTH_SERVER = 'https://authserver.ely.by'
const AUTHLIB_API = 'https://authserver.ely.by/api/authlib-injector'
const INJECTOR_META = 'https://authlib-injector.yushi.moe/artifact/latest.json'
const UA = 'LunarSpaceLauncher/1.0'

function request(url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body)
    const target = new URL(url)
    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname + target.search,
        method,
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          if (!data) return resolve({ status: res.statusCode, body: null })
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) })
          } catch {
            resolve({ status: res.statusCode, body: data })
          }
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function download(url, target) {
  return new Promise((resolve, reject) => {
    const source = new URL(url)
    https
      .get({ hostname: source.hostname, path: source.pathname + source.search, headers: { 'User-Agent': UA } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          download(new URL(res.headers.location, source).toString(), target).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`Tải authlib-injector thất bại (${res.statusCode}).`))
          return
        }
        fs.mkdirSync(path.dirname(target), { recursive: true })
        const file = fs.createWriteStream(target)
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve(target)))
        file.on('error', reject)
      })
      .on('error', reject)
  })
}

function errorMessage(status, body, fallback) {
  const code = body?.error
  if (code === 'ForbiddenOperationException' || status === 403) return 'Sai tên đăng nhập hoặc mật khẩu ely.by.'
  if (code === 'IllegalArgumentException' || status === 400) return body?.errorMessage || 'Thông tin đăng nhập ely.by không hợp lệ.'
  return body?.errorMessage || fallback
}

function profileOf(body) {
  const profile = body?.selectedProfile
  if (!profile?.id || !profile?.name) return null
  const raw = String(profile.id).replace(/-/g, '')
  return {
    uuid: `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`,
    name: profile.name,
  }
}

async function login({ username, password } = {}) {
  const user = String(username || '').trim()
  if (!user || !password) return { ok: false, error: 'Nhập tên đăng nhập và mật khẩu ely.by.' }
  const clientToken = crypto.randomUUID()
  try {
    const res = await request(`${AUTH_SERVER}/auth/authenticate`, {
      method: 'POST',
      body: { username: user, password, clientToken, requestUser: true },
    })
    const profile = profileOf(res.body)
    if (res.status !== 200 || !res.body?.accessToken || !profile) {
      return { ok: false, error: errorMessage(res.status, res.body, 'Đăng nhập ely.by thất bại.') }
    }
    return {
      ok: true,
      session: { ...profile, accessToken: res.body.accessToken, clientToken: res.body.clientToken || clientToken, expiresAt: Date.now() + 12 * 24 * 3600 * 1000 },
    }
  } catch (err) {
    return { ok: false, error: err?.message || 'Không kết nối được tới ely.by.' }
  }
}

async function refresh({ accessToken, clientToken } = {}) {
  if (!accessToken) return { ok: false, error: 'Phiên ely.by đã hết hạn, hãy đăng nhập lại.' }
  try {
    const res = await request(`${AUTH_SERVER}/auth/refresh`, {
      method: 'POST',
      body: { accessToken, clientToken, requestUser: true },
    })
    const profile = profileOf(res.body)
    if (res.status !== 200 || !res.body?.accessToken || !profile) {
      return { ok: false, error: errorMessage(res.status, res.body, 'Phiên ely.by đã hết hạn, hãy đăng nhập lại.') }
    }
    return {
      ok: true,
      session: { ...profile, accessToken: res.body.accessToken, clientToken: res.body.clientToken || clientToken, expiresAt: Date.now() + 12 * 24 * 3600 * 1000 },
    }
  } catch (err) {
    return { ok: false, error: err?.message || 'Không kết nối được tới ely.by.' }
  }
}

async function validate({ accessToken, clientToken } = {}) {
  if (!accessToken) return false
  try {
    const res = await request(`${AUTH_SERVER}/auth/validate`, { method: 'POST', body: { accessToken, clientToken } })
    return res.status === 204
  } catch {
    return false
  }
}

async function ensureInjector() {
  const dir = path.join(app.getPath('userData'), 'authlib-injector')
  try {
    const meta = await request(INJECTOR_META)
    const version = meta.body?.version
    const url = meta.body?.download_url
    if (!version || !url) throw new Error('Không đọc được thông tin authlib-injector.')
    const target = path.join(dir, `authlib-injector-${version}.jar`)
    if (fs.existsSync(target) && fs.statSync(target).size > 1024) return { ok: true, jar: target }
    await download(url, target)
    return { ok: true, jar: target }
  } catch (err) {
    return { ok: false, error: err?.message || 'Không tải được authlib-injector.' }
  }
}

module.exports = { login, refresh, validate, ensureInjector, AUTHLIB_API }
