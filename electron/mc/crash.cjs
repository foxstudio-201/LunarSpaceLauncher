const MCLOGS_API = 'https://api.mclo.gs/1/log'

const CRASH_MARKERS = [
  /Minecraft has crashed!/i,
  /A fatal error has been detected by the Java Runtime Environment/i,
  /Exception in thread "(?:main|Render thread|Client thread|Worker[^"]*)"/i,
  /net\.fabricmc\.loader\.impl\.FormattedException/i,
  /---- Minecraft Crash Report ----/i,
  /java\.lang\.(?:NoClassDefFoundError|ExceptionInInitializerError|UnsatisfiedLinkError|UnsupportedClassVersionError|OutOfMemoryError)/,
  /^Caused by: /i,
]

const BENIGN = [
  /InvalidCredentialsException/i,
  /Failed to verify authentication/i,
  /Status: 401/i,
  /Could not authenticate/i,
]

const RULES = [
  {
    kind: 'java',
    title: 'Java không tương thích',
    titleEn: 'Incompatible Java',
    test: /UnsupportedClassVersionError|class file version|requires Java/i,
    hint: 'Phiên bản này cần Java mới hơn. Vào Hệ thống → Java tải kèm và tải đúng bản Java cho phiên bản game, hoặc xoá "Ghi đè Java" nếu đang trỏ sai.',
    hintEn: 'This version needs a newer Java. Open System → Bundled Java runtimes and install the right one for this game version, or clear the Java override if it points to the wrong build.',
  },
  {
    kind: 'forge-legacy',
    title: 'Forge bản cũ thiếu tệp deobfuscation',
    titleEn: 'Legacy Forge is missing deobfuscation data',
    test: /deobfuscation_data[^\s]* has an invalid checksum|deobfuscation_data_\d+\.\d+/i,
    hint: 'Forge cho Minecraft 1.5.2 cần tệp deobfuscation_data_1.5.2.zip mà máy chủ Forge đã ngừng phát hành từ 2013, nên bản này không chạy được nữa. Hãy chọn Minecraft 1.6.1 trở lên cho Forge.',
    hintEn: 'Forge for Minecraft 1.5.2 needs deobfuscation_data_1.5.2.zip, which Forge stopped serving in 2013, so this build can no longer run. Pick Minecraft 1.6.1 or newer for Forge.',
  },
  {
    kind: 'natives',
    title: 'Thiếu thư viện native của game',
    titleEn: 'Missing native libraries',
    test: /Failed to load a library|UnsatisfiedLinkError|Could not initialize class org\.lwjgl|java\.library\.path|GLFW error/i,
    hint: 'Thư mục natives của phiên bản này chưa đủ tệp. Bấm Chơi lại — launcher sẽ tự kiểm tra và tải bù, sau đó giải nén lại natives.',
    hintEn: 'The natives folder for this version is incomplete. Press Play again — the launcher verifies, re-downloads and re-extracts the natives automatically.',
  },
  {
    kind: 'library',
    title: 'Thiếu tệp thư viện của game',
    titleEn: 'Missing game libraries',
    test: /NoClassDefFoundError|ClassNotFoundException|Class path entries reference missing files|ZipException|invalid LOC header/i,
    hint: 'Classpath đang thiếu hoặc hỏng một jar. Bấm Chơi lại để launcher tải bù tệp còn thiếu; nếu vẫn lỗi, vào Cài đặt phiên bản → xoá instance rồi tạo lại.',
    hintEn: 'A jar is missing or corrupt on the classpath. Press Play again so the launcher re-fetches what is missing; if it persists, delete the instance in its Settings and recreate it.',
  },
  {
    kind: 'module-conflict',
    title: 'Mod xung đột module với game',
    titleEn: 'Mod conflicts with the game modules',
    test: /Relate modules path|export package [\w.$]+ to module|contains package [\w.$]+, module/i,
    hint: 'Một mod đóng gói lại lớp của Minecraft (ví dụ CustomSkinLoader) nên Java từ chối nạp module. Tắt mod đó trong tab Mods rồi chạy lại — mod vẫn nằm trong thư mục, chỉ đổi đuôi .disabled.',
    hintEn: 'A mod repackages Minecraft classes (for example CustomSkinLoader), so the JVM refuses the module. Disable that mod in the Mods tab and retry — the file stays in the folder, only renamed to .disabled.',
  },
  {
    kind: 'mod',
    title: 'Mod không tương thích',
    titleEn: 'Incompatible mods',
    test: /Mod resolution failed|Incompatible mod|Duplicate mod|MixinApplyError|mixin apply failed|Mod file .* is not a valid|requires (?:any version of|version)/i,
    hint: 'Loader báo lỗi mod/mixin. Mở tab Mods, tắt bớt mod vừa thêm (đổi đuôi .disabled) rồi chạy lại để tìm mod gây lỗi.',
    hintEn: 'The loader reported a mod/mixin problem. Open the Mods tab, disable the newest mod (renamed to .disabled) and retry to isolate it.',
  },
  {
    kind: 'memory',
    title: 'Hết bộ nhớ (RAM)',
    titleEn: 'Out of memory',
    test: /OutOfMemoryError|Java heap space|Could not reserve enough space/i,
    hint: 'Tăng RAM trong Cài đặt phiên bản, hoặc giảm mod/tài nguyên. Đừng đặt RAM cao hơn RAM thực của máy.',
    hintEn: 'Raise the memory in the instance Settings, or reduce mods/resource packs. Never set more than the machine actually has.',
  },
  {
    kind: 'graphics',
    title: 'Lỗi đồ hoạ / driver',
    titleEn: 'Graphics / driver error',
    test: /Pixel format not accelerated|WGL|OpenGL|GLFW/i,
    hint: 'Cập nhật driver card đồ hoạ, hoặc chạy bằng GPU rời (Windows: Settings → Display → Graphics). Máy ảo/Remote Desktop thường không có OpenGL đủ.',
    hintEn: 'Update the GPU driver, or force the dedicated GPU (Windows: Settings → Display → Graphics). VMs and Remote Desktop often lack enough OpenGL.',
  },
  {
    kind: 'jvm',
    title: 'JVM bị crash',
    titleEn: 'JVM crash',
    test: /A fatal error has been detected by the Java Runtime Environment|SIGSEGV|hs_err_pid/i,
    hint: 'JVM tự crash (thường do driver hoặc native). Xem tệp hs_err_pid*.log trong thư mục instance để biết chi tiết.',
    hintEn: 'The JVM itself crashed (usually a driver or native issue). Check hs_err_pid*.log in the instance folder for details.',
  },
]

function stripAnsi(text) {
  return String(text ?? '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
}

function exceptionLine(text) {
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('at ') || line.startsWith('...')) continue
    const match = line.match(/^(?:Caused by: )?([\w.$]+(?:Exception|Error|Throwable))(?::\s*(.*))?$/)
    if (match) return { type: match[1], message: (match[2] || '').trim() }
  }
  return null
}

function rootCauses(lines) {
  const causes = []
  for (const line of lines) {
    const match = line.match(/^\s*Caused by: ([\w.$]+(?:Exception|Error|Throwable))(?:: (.*))?$/)
    if (match) causes.push({ type: match[1], message: (match[2] || '').trim() })
  }
  return causes
}

function analyze(rawLines) {
  const lines = rawLines.map((line) => stripAnsi(line))
  const text = lines.join('\n')
  const hasMarker = CRASH_MARKERS.some((re) => re.test(text))
  const onlyBenign = BENIGN.some((re) => re.test(text)) && !/Minecraft has crashed!|A fatal error has been detected|---- Minecraft Crash Report ----/i.test(text)
  const crashed = hasMarker && !onlyBenign

  if (!crashed) return { crashed: false }

  let markerIndex = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (CRASH_MARKERS.some((re) => re.test(lines[i]))) {
      markerIndex = i
      break
    }
  }
  const from = markerIndex === -1 ? Math.max(0, lines.length - 60) : markerIndex
  const excerpt = lines.slice(from, from + 60)

  const rule = RULES.find((item) => item.test.test(text))
  const causes = rootCauses(lines)
  const deepest = causes.length ? causes[causes.length - 1] : exceptionLine(text)
  const primary = exceptionLine(lines.slice(from).join('\n')) || deepest

  const summary = deepest?.type
    ? `${deepest.type}${deepest.message ? `: ${deepest.message}` : ''}`
    : (primary?.type || 'Không xác định được exception cụ thể')

  return {
    crashed: true,
    kind: rule?.kind || 'unknown',
    title: rule?.title || 'Game dừng bất thường',
    titleEn: rule?.titleEn || 'Game stopped unexpectedly',
    hint: rule?.hint || 'Xem phần log bên dưới để biết chi tiết, hoặc gửi log lên mclo.gs để được hỗ trợ.',
    hintEn: rule?.hintEn || 'Read the log below, or upload it to mclo.gs for help.',
    exception: deepest ? deepest.type : primary?.type || null,
    exceptionMessage: deepest?.message || primary?.message || '',
    summary,
    chain: [primary, ...causes].filter(Boolean).map((item) => `${item.type}${item.message ? `: ${item.message}` : ''}`),
    excerpt,
  }
}

function analyzeExit(lines, code) {
  const result = analyze(lines)
  if (result.crashed) return result
  return {
    crashed: true,
    kind: 'unknown',
    title: 'Game dừng bất thường',
    titleEn: 'Game exited unexpectedly',
    hint: 'Tiến trình thoát với mã lỗi nhưng không in dấu vết crash rõ ràng. Xem log bên dưới, hoặc gửi log lên mclo.gs để được hỗ trợ.',
    hintEn: 'The process exited with an error code without a clear crash trace. Read the log below, or upload it to mclo.gs for help.',
    exception: null,
    exceptionMessage: '',
    summary: `Tiến trình thoát với mã ${code}`,
    chain: [],
    excerpt: lines.slice(-40).map(stripAnsi),
  }
}

async function uploadToMclogs(text, label) {
  const content = stripAnsi(text)
  if (!content.trim()) return { ok: false, error: 'Log trống.' }
  try {
    const body = new URLSearchParams({ content, source: label || 'LunarSpace Launcher' })
    const res = await fetch(MCLOGS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(30000),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) return { ok: false, error: json?.error || `mclo.gs trả về HTTP ${res.status}` }
    return { ok: true, url: json.url, raw: json.raw }
  } catch (err) {
    return { ok: false, error: `Không gửi được log lên mclo.gs: ${err.message}` }
  }
}

module.exports = { analyze, analyzeExit, uploadToMclogs, stripAnsi, MCLOGS_API }
