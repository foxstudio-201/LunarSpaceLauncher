const fs = require('fs')
const path = require('path')

const FONT_FILES = ['vt323-vietnamese.woff2', 'vt323-latin-ext.woff2', 'vt323-latin.woff2']

function fontPath(name) {
  if (!FONT_FILES.includes(name)) return ''
  const dirs = [path.join(__dirname, '..', 'src', 'assets', 'fonts'), path.join(__dirname, '..', 'dist', 'assets')]
  const stem = name.replace(/\.woff2$/, '')
  const pattern = new RegExp(`^${stem}(-[A-Za-z0-9_-]+)?\\.woff2$`)
  for (const dir of dirs) {
    try {
      const hit = fs.readdirSync(dir).find((file) => pattern.test(file))
      if (hit) return path.join(dir, hit)
    } catch {}
  }
  return ''
}

function loopbackHtml() {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Xác thực Discord</title>
<style>
@font-face{font-family:'VT323';src:url('/font/vt323-vietnamese.woff2') format('woff2');unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB;font-display:swap}
@font-face{font-family:'VT323';src:url('/font/vt323-latin-ext.woff2') format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF;font-display:swap}
@font-face{font-family:'VT323';src:url('/font/vt323-latin.woff2') format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;font-display:swap}
:root{--ink:#04060a;--bg:#0a0d12;--bar:#0f131a;--surface:#171c24;--text:#e6ebf2;--label:#9fabb8;--faint:#7b8794;--border:#39434f;--input:#1f252e;--accent:#7ba3cc;--accent2:#8f7bd6;--ok:#7ad18a;--bad:#e5777a}
*{box-sizing:border-box}
html{height:100%}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:36px 20px;overflow-x:hidden;
background-color:var(--bg);color:var(--text);font:20px/1.45 'VT323','Segoe UI',monospace;-webkit-font-smoothing:none;position:relative}
body::before{content:'';position:fixed;inset:-4px;pointer-events:none;z-index:0;opacity:.85;
background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Cg fill='%239fb4cc' fill-opacity='0.05'%3E%3Crect width='2' height='2'/%3E%3Crect x='2' y='2' width='2' height='2'/%3E%3C/g%3E%3C/svg%3E")}
body::after{content:'';position:fixed;inset:-10%;pointer-events:none;z-index:0;
background:radial-gradient(46% 38% at 24% 8%,rgba(123,163,204,.22),transparent 68%),radial-gradient(44% 36% at 82% 96%,rgba(143,123,214,.2),transparent 68%);
animation:drift 14s ease-in-out infinite alternate}
@keyframes drift{from{transform:translate3d(-1.6%,-1%,0) scale(1.03)}to{transform:translate3d(1.6%,1.4%,0) scale(1.07)}}
.grid{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.5;
background-image:linear-gradient(rgba(123,163,204,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(123,163,204,.07) 1px,transparent 1px);
background-size:26px 26px;animation:pan 26s linear infinite}
@keyframes pan{to{background-position:26px 26px}}
.spark{position:fixed;bottom:-8px;width:3px;height:3px;background:var(--accent);z-index:0;pointer-events:none;opacity:.55;animation:rise 11s linear infinite}
.spark.b{background:var(--accent2);animation-duration:15s}
@keyframes rise{0%{transform:translateY(0);opacity:0}12%{opacity:.6}88%{opacity:.6}100%{transform:translateY(-92vh);opacity:0}}
.wrap{position:relative;z-index:1;width:100%;max-width:540px;margin:0 auto}
.card{position:relative;border:2px solid var(--ink);box-shadow:6px 6px 0 0 var(--ink);background-color:var(--surface);
background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Cg fill='%239fb4cc' fill-opacity='0.05'%3E%3Crect width='2' height='2'/%3E%3Crect x='2' y='2' width='2' height='2'/%3E%3C/g%3E%3C/svg%3E")}
.card::after{content:'';position:absolute;inset:5px;border:1px solid var(--border);pointer-events:none}
header{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:2px solid var(--ink);background:var(--bar)}
.mark{width:14px;height:14px;flex:0 0 auto;background:var(--accent);border:2px solid var(--ink);box-shadow:2px 2px 0 0 var(--ink);animation:pulse 1.8s steps(2,end) infinite}
@keyframes pulse{50%{background:var(--accent2)}}
h1{margin:0;font:700 15px/1.5 'VT323','Segoe UI',monospace;letter-spacing:.22em;text-transform:uppercase}
section{padding:20px 16px 22px}
.lead{margin:0 0 16px;color:var(--label);text-align:center}
.who{display:flex;align-items:center;gap:14px;padding:12px;border:2px solid var(--ink);background:var(--input);box-shadow:3px 3px 0 0 var(--ink);margin-bottom:16px}
.who img{width:56px;height:56px;flex:0 0 auto;border:2px solid var(--ink);background:var(--bar);image-rendering:pixelated}
.who-name{margin:0;font:700 18px/1.3 'VT323',monospace;letter-spacing:.06em;color:var(--text)}
.who-sub{margin:2px 0 0;color:var(--label)}
.tag{margin-left:auto;font:700 12px/1.4 'VT323',monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--ok);border:2px solid var(--ok);padding:2px 6px;background:rgba(122,209,138,.1)}
.box{display:flex;gap:12px;align-items:flex-start;padding:12px;border:2px solid var(--ink);background:var(--input);box-shadow:3px 3px 0 0 var(--ink)}
.dot{width:12px;height:12px;flex:0 0 auto;margin-top:4px;background:var(--accent);border:2px solid var(--ink);animation:blink 900ms steps(1,end) infinite}
@keyframes blink{50%{opacity:.2}}
.title{margin:0 0 5px;font:700 16px/1.4 'VT323',monospace;letter-spacing:.16em;text-transform:uppercase}
.msg{margin:0;color:var(--label)}
.box.ok .dot{background:var(--ok);animation:none}
.box.bad .dot{background:var(--bad);animation:none}
.box.bad .title{color:var(--bad)}
.bar{margin-top:16px;height:12px;border:2px solid var(--ink);background:var(--input);overflow:hidden}
.bar i{display:block;height:100%;width:34%;background:var(--accent);animation:slide 1.1s steps(10,end) infinite}
@keyframes slide{0%{transform:translateX(-34%)}100%{transform:translateX(300%)}}
.actions{margin-top:16px;display:none}
.actions.on{display:block}
a.btn{display:flex;align-items:center;justify-content:center;width:100%;padding:12px 14px;text-decoration:none;cursor:pointer;
font:700 17px/1.2 'VT323','Segoe UI',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--ink);background:var(--accent);border:2px solid var(--ink);box-shadow:3px 3px 0 0 var(--ink)}
a.btn:hover{background:#8fb5da}
a.btn:active{transform:translate(2px,2px);box-shadow:1px 1px 0 0 var(--ink)}
.note{margin:14px 0 0;color:var(--faint);text-align:center}
.who[hidden],.tag[hidden],img[hidden]{display:none}
@media (prefers-reduced-motion: reduce){body::after,.grid,.spark,.mark,.dot,.bar i{animation:none}}
</style>
</head>
<body>
<div class="grid" aria-hidden="true"></div>
<span class="spark" style="left:12%;animation-delay:0s" aria-hidden="true"></span>
<span class="spark b" style="left:29%;animation-delay:2.6s" aria-hidden="true"></span>
<span class="spark" style="left:63%;animation-delay:5.2s" aria-hidden="true"></span>
<span class="spark b" style="left:84%;animation-delay:7.8s" aria-hidden="true"></span>
<div class="wrap">
  <main class="card">
    <header>
      <span class="mark"></span>
      <h1>Xác thực Discord</h1>
    </header>
    <section>
      <p class="lead">Launcher đang chờ Discord trả quyền truy cập về máy này để hoàn tất liên kết.</p>

      <div class="who" id="who" hidden>
        <img id="avatar" alt="">
        <div>
          <p class="who-name" id="whoName"></p>
          <p class="who-sub" id="whoSub"></p>
        </div>
        <span class="tag" id="tag" hidden>Đã liên kết</span>
      </div>

      <div class="box" id="box">
        <span class="dot"></span>
        <div>
          <p class="title" id="title">Đang xác thực</p>
          <p class="msg" id="msg">Đang gửi thông tin uỷ quyền về launcher…</p>
        </div>
      </div>

      <div class="bar" id="bar"><i></i></div>
      <div class="actions" id="actions">
        <a class="btn" id="open" href="lunarspace://reopen">Mở lại LunarSpace Launcher</a>
      </div>
      <p class="note" id="note">Có thể đóng cửa sổ này sau khi xác thực xong.</p>
    </section>
  </main>
</div>
<script>
var box = document.getElementById('box')
var title = document.getElementById('title')
var msg = document.getElementById('msg')
var bar = document.getElementById('bar')
var actions = document.getElementById('actions')
var note = document.getElementById('note')
var who = document.getElementById('who')
var avatar = document.getElementById('avatar')
var whoName = document.getElementById('whoName')
var whoSub = document.getElementById('whoSub')
var tag = document.getElementById('tag')

function showWho(discord, account) {
  if (!discord) return
  if (discord.avatar) {
    avatar.src = discord.avatar
    avatar.onerror = function () { avatar.hidden = true }
  } else {
    avatar.hidden = true
  }
  whoName.textContent = discord.name || discord.tag || 'Discord'
  whoSub.textContent = account ? ('Tài khoản launcher: ' + account) : (discord.tag || '')
  tag.hidden = false
  who.hidden = false
}

function finish(ok, text) {
  box.className = 'box ' + (ok ? 'ok' : 'bad')
  bar.style.display = 'none'
  title.textContent = ok ? 'Xác thực thành công' : 'Không hoàn tất được'
  msg.textContent = text
  if (ok) {
    note.textContent = 'Launcher đã mở lại và hoàn tất liên kết — bạn có thể đóng tab này.'
  } else {
    note.textContent = 'Hãy thử lại trong launcher.'
    actions.className = 'actions on'
  }
}

var params = new URLSearchParams(location.hash.slice(1))
var payload = {
  access_token: params.get('access_token') || '',
  state: params.get('state') || '',
  error: params.get('error') || ''
}

fetch('/discord/token', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload)
})
  .then(function (res) { return res.json() })
  .then(function (res) {
    showWho(res.discord, res.account)
    if (res.ok) {
      finish(true, res.discord && res.discord.tag ? ('Đã liên kết với ' + res.discord.tag + '.') : 'Discord đã cấp quyền và launcher đã nhận được.')
    } else {
      finish(false, res.error || 'Discord không trả về quyền truy cập.')
    }
  })
  .catch(function (err) {
    finish(false, 'Không gửi được thông tin về launcher: ' + err.message)
  })
</script>
</body>
</html>`
}

module.exports = { loopbackHtml, fontPath }
