const https = require('https')
const crypto = require('crypto')
const { BrowserWindow } = require('electron')

const CLIENT_ID = '00000000402b5328'
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf'
const SCOPE = 'XboxLive.signin offline_access'
const AUTH_URL = 'https://login.live.com/oauth20_authorize.srf'
const TOKEN_URL = 'https://login.live.com/oauth20_token.srf'
const UA = 'LunarSpaceLauncher/1.0'

function httpsRequest(url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body)
    const target = new URL(url)
    const req = https.request(
      {
        hostname: target.hostname,
        path: target.pathname + target.search,
        method,
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          ...(payload
            ? {
                'Content-Type': typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
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

function encodeForm(obj) {
  return Object.entries(obj)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

function openAuthWindow(parent) {
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString('hex')
    const url =
      `${AUTH_URL}?client_id=${CLIENT_ID}` +
      '&response_type=code' +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent(SCOPE)}` +
      `&state=${state}` +
      '&prompt=select_account'

    const win = new BrowserWindow({
      width: 520,
      height: 680,
      parent: parent ?? undefined,
      modal: true,
      title: 'Đăng nhập Microsoft',
      resizable: false,
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, partition: 'lunaspace-auth' },
    })

    let settled = false

    const handleRedirect = (target) => {
      if (!String(target).startsWith(REDIRECT_URI)) return false
      try {
        const parsed = new URL(target)
        const error = parsed.searchParams.get('error')
        const description = parsed.searchParams.get('error_description')
        const code = parsed.searchParams.get('code')
        const returned = parsed.searchParams.get('state')
        if (error) {
          settled = true
          win.destroy()
          reject(new Error(description || error))
          return true
        }
        if (code && returned === state) {
          settled = true
          win.destroy()
          resolve(code)
          return true
        }
      } catch {}
      return false
    }

    win.webContents.on('will-redirect', (_event, target) => { handleRedirect(target) })
    win.webContents.on('will-navigate', (_event, target) => { handleRedirect(target) })
    win.webContents.on('did-navigate', (_event, target) => { handleRedirect(target) })

    win.on('closed', () => {
      if (!settled) reject(new Error('Bạn đã đóng cửa sổ đăng nhập Microsoft.'))
    })

    win.loadURL(url)
  })
}

async function exchangeCode(code) {
  const res = await httpsRequest(TOKEN_URL, {
    method: 'POST',
    body: encodeForm({
      client_id: CLIENT_ID,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
    }),
  })
  if (!res.body?.access_token) {
    throw new Error(res.body?.error_description || res.body?.error || `Đổi mã đăng nhập thất bại (${res.status}).`)
  }
  return res.body
}

async function refreshMsToken(refreshToken) {
  const res = await httpsRequest(TOKEN_URL, {
    method: 'POST',
    body: encodeForm({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPE,
    }),
  })
  if (!res.body?.access_token) {
    throw new Error(res.body?.error_description || res.body?.error || 'Làm mới token Microsoft thất bại.')
  }
  return res.body
}

async function authXboxLive(msAccessToken) {
  const res = await httpsRequest('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    body: {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    },
  })
  const token = res.body?.Token
  const claim = res.body?.DisplayClaims?.xui?.[0]
  if (res.status !== 200 || !token || !claim?.uhs) throw new Error(`Xác thực Xbox Live thất bại (${res.status}).`)
  return { token, userHash: claim.uhs }
}

async function authXsts(xblToken) {
  const res = await httpsRequest('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    body: {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    },
  })
  if (res.status === 401) {
    const code = res.body?.XErr
    if (code === 2148916233) throw new Error('Tài khoản Microsoft này chưa có Xbox Live. Hãy tạo tại xbox.com rồi thử lại.')
    if (code === 2148916235) throw new Error('Xbox Live không khả dụng ở quốc gia của tài khoản này.')
    if (code === 2148916238) throw new Error('Tài khoản trẻ em cần phụ huynh xác nhận trong gia đình Microsoft.')
    throw new Error(`Xác thực XSTS thất bại (XErr ${code}).`)
  }
  const token = res.body?.Token
  const claim = res.body?.DisplayClaims?.xui?.[0]
  if (res.status !== 200 || !token || !claim?.uhs) throw new Error(`Xác thực XSTS thất bại (${res.status}).`)
  return { token, userHash: claim.uhs, xuid: claim.xid || '' }
}

async function authMinecraft(xstsToken, userHash) {
  const res = await httpsRequest('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    body: { identityToken: `XBL3.0 x=${userHash};${xstsToken}` },
  })
  if (res.status !== 200 || !res.body?.access_token) throw new Error(`Đăng nhập Minecraft thất bại (${res.status}).`)
  return { accessToken: res.body.access_token, expiresIn: res.body.expires_in || 86400 }
}

async function fetchProfile(mcToken) {
  const res = await httpsRequest('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mcToken}`, 'User-Agent': UA },
  })
  if (res.status === 404 || res.body?.error === 'NOT_FOUND') throw new Error('Tài khoản này chưa sở hữu Minecraft Java Edition.')
  if (res.status !== 200 || !res.body?.id || !res.body?.name) throw new Error(`Không đọc được hồ sơ Minecraft (${res.status}).`)
  const raw = String(res.body.id)
  return { uuid: `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`, name: res.body.name }
}

async function buildSession(msAccessToken, msRefreshToken) {
  const { token: xblToken } = await authXboxLive(msAccessToken)
  const { token: xstsToken, userHash, xuid } = await authXsts(xblToken)
  const { accessToken, expiresIn } = await authMinecraft(xstsToken, userHash)
  const profile = await fetchProfile(accessToken)
  return {
    name: profile.name,
    uuid: profile.uuid,
    xuid,
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
    refreshToken: msRefreshToken,
  }
}

async function login(parent) {
  try {
    const code = await openAuthWindow(parent)
    const ms = await exchangeCode(code)
    const session = await buildSession(ms.access_token, ms.refresh_token)
    return { ok: true, session }
  } catch (err) {
    return { ok: false, error: err?.message || 'Đăng nhập Microsoft thất bại.' }
  }
}

async function refresh(refreshToken) {
  try {
    const ms = await refreshMsToken(refreshToken)
    const session = await buildSession(ms.access_token, ms.refresh_token || refreshToken)
    return { ok: true, session }
  } catch (err) {
    return { ok: false, error: err?.message || 'Làm mới phiên Microsoft thất bại.' }
  }
}

module.exports = { login, refresh }
