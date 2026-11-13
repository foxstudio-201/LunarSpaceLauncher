// Màn hình đăng nhập lần đầu: nền cảnh đêm thuật toán + thẻ đăng nhập 4 nền tảng.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  User, Globe, DiscordLogo, Eye, EyeSlash,
  CircleNotch, CheckCircle, Warning, ArrowRight, ShieldCheck,
} from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import { palette } from '../../lib/palette'
import HeadSkin from '../ui/HeadSkin'
import SceneBackground from './SceneBackground'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)
const MC_NAME = /^[A-Za-z0-9_]{3,16}$/

const KINDS = [
  { id: 'offline', img: './onboarding/offline.png', pixel: true, tone: '#e9b872', label: 'accounts.kind.offline', desc: 'accounts.offline.desc' },
  { id: 'microsoft', img: './onboarding/microsoft.svg', tone: '#00a4ef', label: 'accounts.kind.microsoft', desc: 'accounts.ms.desc' },
  { id: 'ely', img: './onboarding/elyby.svg', tone: '#00a66c', label: 'accounts.kind.ely', desc: 'accounts.ely.desc' },
  { id: 'discord', img: './onboarding/discord.svg', tone: '#5865f2', label: 'accounts.kind.discord', desc: 'accounts.discord.desc' },
]

const STYLE = `
.onb{position:fixed;inset:0;z-index:250;display:flex;align-items:center;justify-content:center;overflow:hidden;color:var(--onb-ink);font-family:"Be Vietnam Pro",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;letter-spacing:-.01em;background:#04070c}
.onb *,.onb *::before,.onb *::after{box-sizing:border-box}
.onb button{font:inherit;color:inherit;cursor:pointer}
.onb :focus-visible{outline:2px solid rgba(255,255,255,.32);outline-offset:3px}
.onb-field input:focus-visible{outline:none}
.onb-scene{position:absolute;inset:0;width:100%;height:100%;display:block}
.onb-veil{position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(3,6,11,.32),rgba(3,6,11,0) 34%,rgba(3,6,11,0) 66%,rgba(3,6,11,.5))}
.onb-exit{position:absolute;inset:0;z-index:9;background:#04070c;opacity:0;pointer-events:none;transition:opacity .55s ease}
.onb.is-leaving .onb-exit{opacity:1;pointer-events:auto}
.onb-body{position:relative;z-index:1;width:100%;max-width:1120px;height:100%;display:flex;align-items:center;justify-content:space-between;gap:48px;padding:56px 64px}
.onb-hero{max-width:520px;display:flex;flex-direction:column;gap:18px;text-shadow:0 2px 24px rgba(0,0,0,.55)}
.onb-hero>*{animation:onb-up .8s var(--onb-ease) both}
.onb-hero>*:nth-child(1){animation-delay:.12s}
.onb-hero>*:nth-child(2){animation-delay:.2s}
.onb-hero>*:nth-child(3){animation-delay:.28s}
.onb-hero>*:nth-child(4){animation-delay:.36s}
.onb-hero>*:nth-child(5){animation-delay:.44s}
.onb-brand{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:rgba(238,241,246,.8)}
.onb-mark{width:34px;height:34px;border-radius:11px;overflow:hidden;flex:none;display:block;object-fit:cover;box-shadow:0 12px 30px -14px rgba(0,0,0,.9),0 0 0 1px rgba(255,255,255,.14)}
.onb h1{margin:0;font-size:44px;line-height:1.06;font-weight:850;letter-spacing:-.045em;color:#f4f1ea}
.onb h1 em{font-style:normal;background:linear-gradient(100deg,#f7dfae,var(--onb-accent) 55%,#d99a4a);-webkit-background-clip:text;background-clip:text;color:transparent}
.onb-lead{margin:0;max-width:390px;font-size:14px;line-height:1.65;font-weight:550;color:rgba(232,236,244,.7)}
.onb-chips{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 0;padding:0;list-style:none}
.onb-chips li{display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);font-size:11px;font-weight:650;color:rgba(238,241,246,.78);backdrop-filter:blur(8px)}
.onb-chips svg{width:12px;height:12px;color:var(--onb-accent)}
.onb-ver{margin-top:8px;font-size:10.5px;font-weight:600;letter-spacing:.08em;color:rgba(232,236,244,.36)}
.onb-card{width:452px;flex:none;border-radius:26px;padding:24px;background:linear-gradient(180deg,rgba(20,24,32,.9),rgba(10,13,19,.94));border:1px solid rgba(255,255,255,.1);box-shadow:0 40px 90px -40px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(22px);animation:onb-rise .75s var(--onb-ease) .12s both}
.onb-card-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px}
.onb-spark{width:38px;height:38px;flex:none;border-radius:12px;overflow:hidden;background:#0b0e13;border:1px solid rgba(255,255,255,.12);box-shadow:0 8px 20px -12px rgba(0,0,0,.85)}
.onb-spark img{width:100%;height:100%;display:block;object-fit:cover}
.onb-card-head h2{margin:2px 0 3px;font-size:17px;font-weight:820;letter-spacing:-.03em;color:var(--onb-ink)}
.onb-card-head p{margin:0;font-size:11.5px;font-weight:550;color:var(--onb-faint)}
.onb-kinds{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.onb-kind{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:7px;padding:10px 10px 9px;border-radius:14px;border:1px solid var(--onb-line);background:rgba(255,255,255,.035);transition:transform .25s var(--onb-spring),border-color .2s,background .2s,box-shadow .25s;overflow:hidden}
.onb-kind:hover:not(:disabled){transform:translateY(-2px);background:rgba(255,255,255,.06)}
.onb-kind.on{border-color:color-mix(in srgb,var(--onb-kind-tint) 62%,transparent);background:color-mix(in srgb,var(--onb-kind-tint) 12%,transparent);box-shadow:0 10px 26px -16px var(--onb-kind-tint)}
.onb-kind.on::after{content:"";position:absolute;left:50%;bottom:0;width:26px;height:2px;border-radius:2px;background:var(--onb-kind-tint);transform:translateX(-50%);animation:onb-underline .3s var(--onb-ease)}
.onb-kind img{width:22px;height:22px;object-fit:contain;display:block;transition:transform .25s var(--onb-spring);filter:drop-shadow(0 3px 8px rgba(0,0,0,.35))}
.onb-kind img.pixel{image-rendering:pixelated;border-radius:5px}
.onb-kind.on img{transform:scale(1.14)}
.onb-kind span{font-size:11px;font-weight:750;color:var(--onb-faint);transition:color .2s}
.onb-kind.on span{color:var(--onb-ink)}
.onb-kind:disabled{opacity:.55;cursor:default}
.onb-form{margin-top:14px;min-height:150px;display:flex;flex-direction:column;gap:9px;animation:onb-form .34s var(--onb-ease) both}
.onb-desc{margin:0;font-size:10.5px;line-height:1.55;font-weight:550;color:var(--onb-faint)}
.onb-field{display:flex;align-items:center;gap:9px;height:44px;padding:0 12px;border-radius:12px;border:1px solid var(--onb-line);background:rgba(8,11,16,.55);transition:border-color .2s,box-shadow .25s,background .2s}
.onb-field:focus-within{border-color:rgba(255,255,255,.3);box-shadow:0 0 0 3px rgba(255,255,255,.07);background:rgba(10,14,20,.72)}
.onb-field input{flex:1;min-width:0;background:none;border:0;outline:none;color:var(--onb-ink);font-size:12.5px;font-weight:600}
.onb-field input::placeholder{color:var(--onb-faint);font-weight:500}
.onb-field .onb-eye{width:28px;height:28px;flex:none;border:0;border-radius:8px;background:none;display:grid;place-items:center;color:var(--onb-faint);transition:background .2s,color .2s}
.onb-field .onb-eye:hover{background:rgba(255,255,255,.07);color:var(--onb-ink)}
.onb-note{display:flex;gap:8px;padding:9px 11px;border-radius:11px;background:rgba(255,255,255,.035);border:1px solid var(--onb-line);font-size:10.5px;line-height:1.5;font-weight:550;color:var(--onb-faint)}
.onb-note svg{width:13px;height:13px;flex:none;margin-top:1px;color:var(--onb-accent)}
.onb-wait{display:flex;align-items:center;gap:8px;padding:11px 12px;border-radius:11px;background:var(--onb-accent-soft);border:1px solid rgba(233,184,114,.24);font-size:11px;font-weight:650;color:var(--onb-accent)}
.onb-wait svg{width:14px;height:14px;animation:onb-spin .8s linear infinite}
.onb-err{display:flex;align-items:center;gap:7px;padding:9px 11px;border-radius:10px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.28);color:#f87171;font-size:11px;font-weight:600;animation:onb-err .35s var(--onb-ease) both}
.onb-err svg{width:13px;height:13px;flex:none}
.onb-actions{margin-top:auto;display:flex;flex-direction:column;gap:8px;padding-top:4px}
.onb-submit{height:45px;border:0;border-radius:13px;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--onb-accent);color:var(--onb-on-accent);font-size:13px;font-weight:800;letter-spacing:-.01em;transition:transform .25s var(--onb-spring),filter .2s,background .2s;box-shadow:0 16px 34px -18px rgba(233,184,114,.75)}
.onb-submit:hover:not(:disabled){filter:brightness(1.06)}
.onb-submit:active:not(:disabled){transform:scale(.985)}
.onb-submit:disabled{opacity:.5;pointer-events:none}
.onb-submit svg{width:15px;height:15px}
.onb-submit.discord{background:#5865f2;color:#fff;box-shadow:0 16px 34px -18px rgba(88,101,242,.85)}
.onb-submit svg.spin{animation:onb-spin .8s linear infinite}
.onb-skip{align-self:center;border:0;background:none;padding:5px 10px;border-radius:8px;font-size:11px;font-weight:600;color:var(--onb-faint);transition:color .2s,background .2s}
.onb-skip:hover{color:var(--onb-ink);background:rgba(255,255,255,.06)}
.onb-success{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:26px 4px 8px;animation:onb-pop .5s var(--onb-spring) both}
.onb-avatar{position:relative;display:grid;place-items:center;margin-bottom:6px}
.onb-avatar::before{content:"";position:absolute;width:132px;height:132px;border-radius:50%;background:radial-gradient(circle,var(--onb-accent-soft),transparent 70%);animation:onb-halo 2.2s ease-in-out infinite}
.onb-avatar>span{position:relative;box-shadow:0 24px 50px -22px rgba(0,0,0,.9)}
.onb-avatar .onb-check{position:absolute;right:-6px;bottom:-6px;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--onb-ok);color:#06130c;border:3px solid #0c1016;animation:onb-pop .5s var(--onb-spring) .25s both}
.onb-avatar .onb-check svg{width:16px;height:16px}
.onb-success h2{margin:4px 0 0;font-size:21px;font-weight:850;letter-spacing:-.03em}
.onb-success p{margin:0;font-size:12px;font-weight:550;color:var(--onb-faint)}
.onb-success .onb-dots{display:flex;gap:5px;margin-top:6px}
.onb-success .onb-dots i{width:5px;height:5px;border-radius:50%;background:var(--onb-accent);animation:onb-dot 1s ease-in-out infinite}
.onb-success .onb-dots i:nth-child(2){animation-delay:.15s}
.onb-success .onb-dots i:nth-child(3){animation-delay:.3s}
@keyframes onb-up{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
@keyframes onb-rise{from{opacity:0;transform:translateY(34px) scale(.965)}to{opacity:1;transform:none}}
@keyframes onb-form{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}
@keyframes onb-underline{from{width:0;opacity:0}to{width:26px;opacity:1}}
@keyframes onb-spin{to{transform:rotate(360deg)}}
@keyframes onb-err{0%{opacity:0;transform:translateX(-6px)}35%{opacity:1;transform:translateX(4px)}65%{transform:translateX(-2px)}100%{transform:none}}
@keyframes onb-pop{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}
@keyframes onb-halo{0%,100%{transform:scale(.92);opacity:.55}50%{transform:scale(1.08);opacity:.9}}
@keyframes onb-dot{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}
@media (max-width:980px){.onb-body{justify-content:center;padding:24px}.onb-hero{display:none}}
@media (prefers-reduced-motion:reduce){
  .onb,.onb *,.onb *::before,.onb *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}
}
`

export default function OnboardingScreen({ theme, lang, version, onDone, onSkip }) {
  const c = palette(theme)
  const tr = (key) => t(lang, key)
  const [kind, setKind] = useState('offline')
  const [name, setName] = useState('')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('form')
  const [error, setError] = useState('')
  const [errKey, setErrKey] = useState(0)
  const [welcome, setWelcome] = useState(null)
  const [leaving, setLeaving] = useState(false)
  const alive = useRef(true)
  const doneTimer = useRef(0)

  const skip = useCallback(() => {
    if (busy) return
    // Bỏ qua cũng tối dần rồi mới bàn giao cho hiệu ứng tách màn.
    setLeaving(true)
    clearTimeout(doneTimer.current)
    doneTimer.current = setTimeout(() => {
      if (alive.current) onSkip?.()
    }, 580)
  }, [busy, onSkip])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(doneTimer.current)
    }
  }, [])

  const fail = useCallback((message) => {
    setError(message || 'error')
    setErrKey((n) => n + 1)
  }, [])

  const commit = useCallback((res, fallback = null) => {
    const list = res?.accounts || []
    const activeId = res?.activeAccountId || list[list.length - 1]?.id || ''
    const account = list.find((item) => item.id === activeId) || list[list.length - 1] || fallback
    if (!account) {
      setBusy(false)
      setPhase('form')
      fail('error')
      return
    }
    setBusy(false)
    setWelcome(account)
    setPhase('success')
    clearTimeout(doneTimer.current)
    doneTimer.current = setTimeout(() => {
      if (!alive.current) return
      // Tối dần ngay trên màn đăng nhập rồi mới bàn giao cho hiệu ứng tách màn.
      setLeaving(true)
      doneTimer.current = setTimeout(() => {
        if (alive.current) onDone?.({ account, accounts: list, activeAccountId: activeId || account.id || '' })
      }, 580)
    }, 1750)
  }, [fail, onDone])

  useEffect(() => {
    const off = api.onDiscordEvent(async (ev) => {
      if (!ev) return
      if (ev.type === 'linked') {
        setPhase('form')
        const res = await api.listAccounts().catch(() => null)
        commit(res, { name: ev.link?.accountName || name.trim(), type: 'offline' })
        return
      }
      if (ev.type === 'failed') {
        setPhase('form')
        setBusy(false)
        fail(ev.error || 'error')
      }
    })
    return off
  }, [commit, fail, name])

  const pick = (id) => {
    if (busy || phase !== 'form') return
    setKind(id)
    setError('')
  }

  const submitOffline = async () => {
    const clean = name.trim()
    if (!MC_NAME.test(clean)) {
      fail(tr('accounts.nameRule'))
      return
    }
    setBusy(true)
    setError('')
    const res = await api.addAccount({ name: clean }).catch((err) => ({ ok: false, error: err?.message }))
    if (!alive.current) return
    if (!res?.ok) {
      setBusy(false)
      fail(res?.error || 'error')
      return
    }
    commit(res, { id: '', name: clean, type: 'offline' })
  }

  const submitMicrosoft = async () => {
    setBusy(true)
    setError('')
    const res = await api.signInAccount({ type: 'microsoft' }).catch((err) => ({ ok: false, error: err?.message }))
    if (!alive.current) return
    if (!res?.ok) {
      setBusy(false)
      fail(res?.error || 'error')
      return
    }
    commit(res)
  }

  const submitEly = async () => {
    if (!user.trim() || !pass) {
      fail(tr('accounts.ely.needBoth'))
      return
    }
    setBusy(true)
    setError('')
    const res = await api.signInAccount({ type: 'ely', username: user.trim(), password: pass }).catch((err) => ({ ok: false, error: err?.message }))
    if (!alive.current) return
    setPass('')
    if (!res?.ok) {
      setBusy(false)
      fail(res?.error || 'error')
      return
    }
    commit(res)
  }

  const submitDiscord = async () => {
    setBusy(true)
    setError('')
    const res = await api.discordLinkStart({ accountId: '', name: name.trim(), force: false }).catch((err) => ({ ok: false, error: err?.message }))
    if (!alive.current) return
    if (!res?.ok) {
      setBusy(false)
      fail(res?.error || 'error')
      return
    }
    setPhase('discord')
    api.openExternal(res.authorizeUrl).catch(() => {})
    api.appFocus?.()
  }

  const cancelDiscord = async () => {
    await api.discordLinkCancel().catch(() => {})
    setPhase('form')
    setError('')
  }

  const submit = () => {
    if (busy) return
    if (kind === 'offline') submitOffline()
    else if (kind === 'microsoft') submitMicrosoft()
    else if (kind === 'ely') submitEly()
    else submitDiscord()
  }

  const canSubmit =
    kind === 'offline' ? MC_NAME.test(name.trim())
      : kind === 'ely' ? Boolean(user.trim() && pass)
        : true
  const discordWaiting = phase === 'discord'
  const active = KINDS.find((item) => item.id === kind)

  const vars = {
    '--onb-accent': c.accent,
    '--onb-on-accent': c.onAccent,
    '--onb-ink': '#eef1f6',
    '--onb-faint': 'rgba(238,241,246,.46)',
    '--onb-line': 'rgba(255,255,255,.13)',
    '--onb-accent-soft': 'rgba(233,184,114,.14)',
    '--onb-ok': c.ok,
    '--onb-kind-tint': active?.tone || c.accent,
    '--onb-ease': 'cubic-bezier(.2,.8,.2,1)',
    '--onb-spring': 'cubic-bezier(.34,1.45,.64,1)',
  }

  return (
    <div className={`onb${leaving ? ' is-leaving' : ''}`} style={vars}>
      <style>{STYLE}</style>
      <SceneBackground />
      <div className="onb-veil" />

      <div className="onb-body">
        <div className="onb-hero">
          <div className="onb-brand">
            <img className="onb-mark" src="./favicon.png" alt="XyoLauncher" draggable={false} />
            XyoLauncher
          </div>
          <h1>
            {vn(lang, 'Bắt đầu cuộc phiêu lưu', 'Your adventure starts')}<br />
            <em>{vn(lang, 'của bạn', 'right here')}</em>
          </h1>
          <p className="onb-lead">
            {vn(
              lang,
              'Đăng nhập để đồng bộ skin, tiến trình và kết nối với bạn bè — tất cả trong một launcher gọn nhẹ.',
              'Sign in to sync your skin, progress and friends — all inside one lightweight launcher.',
            )}
          </p>
          <ul className="onb-chips">
            <li><CheckCircle weight="fill" />{vn(lang, '4 cách đăng nhập', '4 sign-in methods')}</li>
            <li><CheckCircle weight="fill" />{vn(lang, 'Đồng bộ skin', 'Skin sync')}</li>
            <li><CheckCircle weight="fill" />{vn(lang, 'Không cần cài Java', 'Java not required')}</li>
          </ul>
          <div className="onb-ver">XYOLAUNCHER{version ? ` · v${version}` : ''}</div>
        </div>

        <div className="onb-card">
          {phase === 'success' && welcome ? (
            <div className="onb-success">
              <div className="onb-avatar">
                <HeadSkin
                  name={welcome.name}
                  uuid={welcome.uuid}
                  type={welcome.type}
                  size={96}
                  radius={26}
                  theme="dark"
                />
                <span className="onb-check"><CheckCircle weight="fill" /></span>
              </div>
              <h2>{vn(lang, `Chào mừng, ${welcome.name}!`, `Welcome, ${welcome.name}!`)}</h2>
              <p>{vn(lang, 'Tài khoản đã sẵn sàng. Đang mở launcher…', 'Account ready. Opening the launcher…')}</p>
              <div className="onb-dots"><i /><i /><i /></div>
            </div>
          ) : (
            <>
              <div className="onb-card-head">
                <span className="onb-spark"><img src="./favicon.png" alt="" draggable={false} /></span>
                <div>
                  <h2>{vn(lang, 'Chào mừng đến XyoLauncher', 'Welcome to XyoLauncher')}</h2>
                  <p>{vn(lang, 'Chọn cách đăng nhập để tiếp tục', 'Choose how you want to sign in')}</p>
                </div>
              </div>

              <div className="onb-kinds">
                {KINDS.map((item) => {
                  const on = kind === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`onb-kind${on ? ' on' : ''}`}
                      style={{ '--onb-kind-tint': item.tone || c.accent }}
                      onClick={() => pick(item.id)}
                      disabled={busy || discordWaiting}
                    >
                      <img
                        src={item.img}
                        alt=""
                        draggable={false}
                        className={item.pixel ? 'pixel' : ''}
                      />
                      <span>{tr(item.label)}</span>
                    </button>
                  )
                })}
              </div>

              {discordWaiting ? (
                <div className="onb-form" key="discord-wait">
                  <p className="onb-desc">{tr('discord.accountWillCreate')}</p>
                  <div className="onb-wait"><CircleNotch weight="bold" />{vn(lang, 'Đang chờ xác minh trên Discord…', 'Waiting for Discord verification…')}</div>
                  <div className="onb-actions">
                    <button type="button" className="onb-skip" onClick={cancelDiscord}>{tr('files.cancel')}</button>
                  </div>
                </div>
              ) : (
                <div className="onb-form" key={kind}>
                  <p className="onb-desc">{tr(active.desc)}</p>

                  {kind === 'offline' && (
                    <>
                      <div className="onb-field">
                        <HeadSkin name={name.trim()} size={28} radius={8} theme="dark" />
                        <input
                          autoFocus
                          value={name}
                          maxLength={16}
                          onChange={(event) => { setName(event.target.value); setError('') }}
                          onKeyDown={(event) => { if (event.key === 'Enter' && canSubmit && !busy) submit() }}
                          placeholder={tr('accounts.namePlaceholder')}
                          aria-label={tr('accounts.namePlaceholder')}
                        />
                      </div>
                      <div className="onb-note"><ShieldCheck weight="duotone" />{tr('accounts.nameRule')}</div>
                    </>
                  )}

                  {kind === 'microsoft' && (
                    <>
                      <div className="onb-note"><ShieldCheck weight="duotone" />{tr('accounts.ms.note')}</div>
                      {busy && <div className="onb-wait"><CircleNotch weight="bold" />{tr('accounts.ms.waiting')}</div>}
                    </>
                  )}

                  {kind === 'ely' && (
                    <>
                      <div className="onb-field">
                        <Globe weight="duotone" style={{ width: 15, height: 15, color: c.label }} />
                        <input
                          autoFocus
                          value={user}
                          onChange={(event) => { setUser(event.target.value); setError('') }}
                          placeholder={tr('accounts.ely.user')}
                          aria-label={tr('accounts.ely.user')}
                        />
                      </div>
                      <div className="onb-field">
                        <ShieldCheck weight="duotone" style={{ width: 15, height: 15, color: c.label }} />
                        <input
                          value={pass}
                          type={showPass ? 'text' : 'password'}
                          onChange={(event) => { setPass(event.target.value); setError('') }}
                          onKeyDown={(event) => { if (event.key === 'Enter' && canSubmit && !busy) submit() }}
                          placeholder={tr('accounts.ely.pass')}
                          aria-label={tr('accounts.ely.pass')}
                        />
                        <button type="button" className="onb-eye" onClick={() => setShowPass((v) => !v)} aria-label={tr('accounts.ely.togglePass')}>
                          {showPass ? <EyeSlash size={13} /> : <Eye size={13} />}
                        </button>
                      </div>
                      <div className="onb-note"><ShieldCheck weight="duotone" />{tr('accounts.ely.hint')}</div>
                    </>
                  )}

                  {kind === 'discord' && (
                    <>
                      <div className="onb-field">
                        <HeadSkin name={name.trim()} size={28} radius={8} theme="dark" />
                        <input
                          autoFocus
                          value={name}
                          maxLength={16}
                          onChange={(event) => { setName(event.target.value); setError('') }}
                          onKeyDown={(event) => { if (event.key === 'Enter' && !busy) submit() }}
                          placeholder={tr('discord.accountNamePlaceholder')}
                          aria-label={tr('discord.accountName')}
                        />
                      </div>
                      <div className="onb-note"><DiscordLogo weight="duotone" style={{ color: '#5865f2' }} />{tr('discord.accountWillCreate')}</div>
                    </>
                  )}

                  {error && (
                    <div className="onb-err" key={errKey} role="alert"><Warning weight="fill" /><span>{error}</span></div>
                  )}

                  <div className="onb-actions">
                    <button
                      type="button"
                      className={`onb-submit${kind === 'discord' ? ' discord' : ''}`}
                      onClick={submit}
                      disabled={busy || !canSubmit}
                    >
                      {busy ? <CircleNotch weight="bold" className="spin" /> : kind === 'discord' ? <DiscordLogo weight="bold" /> : kind === 'offline' ? <User weight="bold" /> : <ArrowRight weight="bold" />}
                      {busy && kind === 'microsoft'
                        ? vn(lang, 'Đang chờ đăng nhập…', 'Waiting for sign-in…')
                        : kind === 'discord'
                          ? tr('discord.webVerify')
                          : kind === 'offline'
                            ? vn(lang, 'Tạo tài khoản', 'Create account')
                            : tr('accounts.login')}
                    </button>
                    <button type="button" className="onb-skip" onClick={skip} disabled={busy || leaving}>
                      {vn(lang, 'Bỏ qua, để sau', 'Skip for now')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <div className="onb-exit" />
    </div>
  )
}
