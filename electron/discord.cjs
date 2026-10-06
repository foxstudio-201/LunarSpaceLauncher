const net = require('net')
const path = require('path')

const RECONNECT_MS = 15000
const RATE_MAX = 5
const RATE_WINDOW_MS = 20000
const PIPE_RANGE = 10

function socketCandidates() {
  if (process.platform === 'win32') {
    const out = []
    for (let i = 0; i < PIPE_RANGE; i += 1) out.push(`\\\\?\\pipe\\discord-ipc-${i}`)
    return out
  }
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp'
  const dirs = [
    base,
    '/tmp',
    path.join(base, 'snap.discord'),
    path.join(base, 'app/com.discordapp.Discord'),
    path.join(base, 'app/com.discordapp.DiscordCanary'),
  ]
  const out = []
  for (const dir of dirs) {
    for (let i = 0; i < PIPE_RANGE; i += 1) out.push(path.join(dir, `discord-ipc-${i}`))
  }
  return out
}

function frame(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const head = Buffer.alloc(8)
  head.writeUInt32LE(op, 0)
  head.writeUInt32LE(body.length, 4)
  return Buffer.concat([head, body])
}

function createClient({ clientId, onState, onMessage }) {
  let socket = null
  let started = false
  let connected = false
  let user = null
  let buffer = Buffer.alloc(0)
  let desired = null
  let sentAt = []
  let sendTimer = null
  let reconnectTimer = null
  let nonce = 0
  let connecting = false

  const status = () => ({ enabled: started, connected, user })

  const notify = () => {
    if (typeof onState === 'function') onState(status())
  }

  function windowLeft(now) {
    sentAt = sentAt.filter((at) => now - at < RATE_WINDOW_MS)
    return RATE_MAX - sentAt.length
  }

  function flush(force) {
    if (!connected || !socket) return
    const now = Date.now()
    if (!force && windowLeft(now) <= 0) {
      const wait = Math.max(200, RATE_WINDOW_MS - (now - sentAt[0]) + 60)
      if (!sendTimer) {
        sendTimer = setTimeout(() => {
          sendTimer = null
          flush(false)
        }, wait)
      }
      return
    }
    if (sendTimer) {
      clearTimeout(sendTimer)
      sendTimer = null
    }
    sentAt.push(now)
    nonce += 1
    try {
      socket.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: desired }, nonce: String(nonce) }))
    } catch {}
  }

  function scheduleReconnect() {
    if (!started || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, RECONNECT_MS)
  }

  function teardown() {
    if (socket) {
      try {
        socket.removeAllListeners()
        socket.destroy()
      } catch {}
    }
    socket = null
    buffer = Buffer.alloc(0)
    if (connected) {
      connected = false
      notify()
    }
  }

  function handleMessage(op, payload) {
    if (op === 2) {
      teardown()
      scheduleReconnect()
      return
    }
    if (op === 3) {
      try {
        socket?.write(frame(4, payload))
      } catch {}
      return
    }
    if (typeof onMessage === 'function') onMessage(payload)
    if (payload?.evt === 'READY') {
      connected = true
      user = payload?.data?.user?.username || null
      sentAt = []
      notify()
      flush(true)
    }
  }

  function connect() {
    if (!started || connecting) return
    connecting = true
    const paths = socketCandidates()
    let index = 0
    const tryNext = () => {
      if (!started || index >= paths.length) {
        connecting = false
        scheduleReconnect()
        return
      }
      const target = paths[index]
      index += 1
      const probe = net.createConnection(target)
      let settled = false
      probe.once('connect', () => {
        settled = true
        socket = probe
        connecting = false
        buffer = Buffer.alloc(0)
        socket.on('data', onData)
        socket.on('error', onError)
        socket.on('close', onClose)
        try {
          socket.write(frame(0, { v: 1, client_id: clientId }))
        } catch {}
      })
      probe.once('error', () => {
        if (settled) return
        try {
          probe.destroy()
        } catch {}
        tryNext()
      })
    }
    tryNext()
  }

  function onData(chunk) {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      if (buffer.length < 8) return
      const op = buffer.readUInt32LE(0)
      const size = buffer.readUInt32LE(4)
      if (buffer.length < 8 + size) return
      const body = buffer.subarray(8, 8 + size).toString('utf8')
      buffer = buffer.subarray(8 + size)
      let payload = null
      try {
        payload = JSON.parse(body)
      } catch {}
      handleMessage(op, payload)
    }
  }

  function onError() {
    teardown()
    scheduleReconnect()
  }

  function onClose() {
    teardown()
    scheduleReconnect()
  }

  return {
    status,
    start() {
      if (started) return
      started = true
      notify()
      connect()
    },
    stop() {
      started = false
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (sendTimer) {
        clearTimeout(sendTimer)
        sendTimer = null
      }
      desired = null
      teardown()
      notify()
    },
    setActivity(activity) {
      desired = activity || null
      if (!started) return
      flush(false)
    },
    clear() {
      desired = null
      if (!connected || !socket) return
      nonce += 1
      try {
        socket.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: String(nonce) }))
      } catch {}
    },
    shutdown() {
      this.clear()
      this.stop()
    },
  }
}

module.exports = { createClient }
