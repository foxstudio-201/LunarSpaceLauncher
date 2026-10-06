const { createClient } = require('./discord.cjs')

const CLIENT_ID = '1556839052102209596'
const LARGE_IMAGE = 'lunarspace'
const LARGE_TEXT = 'LunarSpace Launcher'
const DEFAULT_INVITE = 'https://discord.gg/8UQZTkRSGp'

const LOADERS = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
}

let lang = 'vi'
let enabled = false
let mode = { kind: 'idle' }
let selected = null
let playingSince = 0
let invite = DEFAULT_INVITE
let lastKey = ''
let lastActivity = null

const client = createClient({ clientId: CLIENT_ID })
const t = (vi, en) => (lang === 'en' ? en : vi)
const loaderName = (id) => LOADERS[id] || id || 'Vanilla'

function instanceLine(instance) {
  const loader = loaderName(instance.loader)
  return instance.loaderVersion ? `${loader} ${instance.loaderVersion}` : loader
}

function buttons() {
  if (!/^https?:\/\//i.test(invite)) return null
  return [{ label: t('Tham gia Discord', 'Join Discord'), url: invite }]
}

function build() {
  const base = {
    largeImageKey: LARGE_IMAGE,
    largeImageText: LARGE_TEXT,
    instance: false,
  }
  const btns = buttons()
  if (btns) base.buttons = btns

  if (mode.kind === 'playing' && mode.instance) {
    const inst = mode.instance
    return {
      ...base,
      details: inst.name,
      state: t(`Đang chơi Minecraft ${inst.version} · ${instanceLine(inst)}`, `Playing Minecraft ${inst.version} · ${instanceLine(inst)}`),
      startTimestamp: playingSince,
      smallImageKey: inst.loader,
      smallImageText: instanceLine(inst),
    }
  }
  if (mode.kind === 'starting' && mode.instance) {
    const inst = mode.instance
    return {
      ...base,
      details: inst.name,
      state: t(`Đang khởi động Minecraft ${inst.version}…`, `Launching Minecraft ${inst.version}…`),
      smallImageKey: inst.loader,
      smallImageText: instanceLine(inst),
    }
  }
  if (mode.kind === 'ready' && mode.instance) {
    const inst = mode.instance
    return {
      ...base,
      details: inst.name,
      state: t(`Sẵn sàng chơi · ${inst.version}`, `Ready to play · ${inst.version}`),
      smallImageKey: inst.loader,
      smallImageText: instanceLine(inst),
    }
  }
  return {
    ...base,
    details: LARGE_TEXT,
    state: t('Đang ở màn hình chính', 'In the launcher'),
  }
}

function apply() {
  if (!enabled) return
  const activity = build()
  const key = JSON.stringify(activity)
  if (key === lastKey) return
  lastKey = key
  lastActivity = activity
  client.setActivity(activity)
}

function configure(settings = {}) {
  const nextEnabled = settings.discordRpc !== false
  lang = settings.language === 'en' ? 'en' : 'vi'
  invite = typeof settings.discordInvite === 'string' ? settings.discordInvite.trim() : DEFAULT_INVITE
  if (nextEnabled === enabled) {
    if (enabled) apply()
    return
  }
  enabled = nextEnabled
  if (enabled) {
    client.start()
    apply()
  } else {
    lastKey = ''
    lastActivity = null
    client.shutdown()
  }
}

module.exports = {
  configure,
  status: () => ({ ...client.status(), activity: enabled ? lastActivity : null, invite }),
  idle() {
    mode = { kind: 'idle' }
    apply()
  },
  selecting(instance) {
    selected = instance || null
    if (mode.kind === 'playing' || mode.kind === 'starting') return
    mode = selected ? { kind: 'ready', instance: selected } : { kind: 'idle' }
    apply()
  },
  starting(instance) {
    mode = { kind: 'starting', instance }
    playingSince = 0
    apply()
  },
  playing(instance) {
    mode = { kind: 'playing', instance }
    playingSince = Date.now()
    apply()
  },
  stopped() {
    mode = selected ? { kind: 'ready', instance: selected } : { kind: 'idle' }
    playingSince = 0
    apply()
  },
  shutdown() {
    client.shutdown()
  },
}
