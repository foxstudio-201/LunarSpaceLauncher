const crypto = require('crypto')

const TIMEOUT_MS = 15000
const SCHEME = 'lunarspace'
const DEFAULT_API_URL = 'http://a29sv1.bumboohost.vn:25691'
const DEFAULT_API_KEY = '80e48059386dd0f5b0831af9a6990d7b4e5482657d626853'

function cleanBase(apiUrl) {
  const base = String(apiUrl || '').trim().replace(/\/+$/, '')
  if (!base) return { ok: false, error: 'Chưa nhập địa chỉ API bot Discord.' }
  if (!/^https?:\/\//i.test(base)) return { ok: false, error: 'Địa chỉ API bot phải bắt đầu bằng http:// hoặc https://.' }
  return { ok: true, base }
}

async function request(config, route, { method = 'GET', body, timeout = TIMEOUT_MS } = {}) {
  const checked = cleanBase(config?.apiUrl)
  if (!checked.ok) return checked
  if (!config?.apiKey) return { ok: false, error: 'Chưa nhập API key của bot Discord.' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(`${checked.base}${route}`, {
      method,
      headers: { 'x-api-key': config.apiKey, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {}
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.error || `Bot trả về mã ${res.status}.`,
        conflict: json?.conflict,
        holder: json?.holder,
      }
    }
    return json && typeof json === 'object' ? json : { ok: true }
  } catch (err) {
    const target = `${checked.base}${route}`
    const cause = err?.cause?.code || ''
    let reason
    if (err?.name === 'AbortError') reason = `Bot không phản hồi kịp (hết thời gian chờ) — ${target}`
    else if (cause === 'ECONNREFUSED') reason = `Không kết nối được ${target} — bot chưa chạy hoặc sai cổng (ECONNREFUSED)`
    else if (cause === 'ENOTFOUND') reason = `Sai địa chỉ bot: ${target} (ENOTFOUND)`
    else if (cause === 'ETIMEDOUT') reason = `Không tới được ${target} (hết thời gian chờ mạng)`
    else reason = `Không gọi được bot: ${cause || err.message} — ${target}`
    return { ok: false, error: reason }
  } finally {
    clearTimeout(timer)
  }
}

const botInfo = (config) => request(config, '/api/config')
const health = (config) => request(config, '/health')
const links = (config) => request(config, '/api/links')
const getLink = (config, id) => request(config, `/api/link/${encodeURIComponent(id)}`)
const unlink = (config, id) => request(config, `/api/link/${encodeURIComponent(id)}`, { method: 'DELETE' })
const linkAccount = (config, payload) => request(config, '/api/link', { method: 'POST', body: payload })
const verify = (config, token) => request(config, '/api/verify', { method: 'POST', body: { token } })

function accountName(raw, fallbackId = '') {
  const clean = String(raw || '').replace(/[^A-Za-z0-9_]/g, '')
  if (clean.length >= 3) return clean.slice(0, 16)
  const tail = String(fallbackId || '').replace(/\D/g, '').slice(-4)
  return tail ? `User${tail}` : ''
}

function newState() {
  return crypto.randomBytes(16).toString('hex')
}

function authorizeUrl({ clientId, redirectUri, state }) {
  if (!clientId || !redirectUri) return ''
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: 'identify',
    state,
    prompt: 'consent',
  })
  return `https://discord.com/oauth2/authorize?${params.toString()}`
}

function parseDeepLink(raw) {
  const url = String(raw || '').trim()
  if (!url.toLowerCase().startsWith(`${SCHEME}://`)) return null
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const hash = new URLSearchParams((parsed.hash || '').replace(/^#/, ''))
  const query = parsed.searchParams
  const pick = (key) => hash.get(key) || query.get(key) || ''
  return {
    kind: parsed.hostname.toLowerCase(),
    raw: url,
    state: pick('state'),
    token: pick('access_token'),
    error: pick('error'),
    expiresIn: Number(pick('expires_in') || 0) || 0,
  }
}

function extractDeepLink(argv) {
  const list = Array.isArray(argv) ? argv : []
  return list.find((item) => typeof item === 'string' && item.toLowerCase().startsWith(`${SCHEME}://`)) || null
}

module.exports = {
  DEFAULT_API_KEY,
  DEFAULT_API_URL,
  SCHEME,
  accountName,
  authorizeUrl,
  botInfo,
  extractDeepLink,
  getLink,
  health,
  linkAccount,
  links,
  newState,
  parseDeepLink,
  unlink,
  verify,
}
