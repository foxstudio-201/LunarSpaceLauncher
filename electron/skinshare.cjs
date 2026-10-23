const API_BASE = String(process.env.LUNAR_SKIN_API || 'https://lunarspace.site').replace(/\/+$/, '')
const SKIN_KEY = String(process.env.LUNAR_SKIN_KEY || 'c2eca935db7123fde240472662d8b0b76654d8267850a87e')
const TIMEOUT_MS = 4000

async function share({ uuid, name, model, skin, cape } = {}) {
  const player = String(name || '').trim()
  if (!player) return { ok: false, error: 'Thiếu tên tài khoản' }
  try {
    const res = await fetch(API_BASE + '/api-skin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: SKIN_KEY,
        name: player,
        uuid: String(uuid || ''),
        model: model === 'slim' ? 'slim' : 'classic',
        skin: skin || null,
        cape: cape || null,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok) {
      return { ok: false, error: String(data?.error || `HTTP ${res.status}`).slice(0, 200) }
    }
    return { ok: true, name: data.name || player, skin: data.skin || null, cape: data.cape || null }
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 200) }
  }
}

module.exports = { share, API_BASE }
