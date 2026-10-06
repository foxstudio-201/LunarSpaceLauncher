import { createContext, useContext, useState, useEffect } from 'react'
import { themeWipe } from '../lib/themeWipe.js'
import { setPaletteSkin, surfaceColor } from '../lib/palette.js'

const AppContext = createContext()

const isElectron = typeof window !== 'undefined' && window.electronAPI

const readSkin = (value) => (value === 'pixel' ? 'pixel' : 'default')

export function AppProvider({ children }) {
  const [lang, setLang] = useState(() => (window.__boot?.lang === 'en' ? 'en' : 'vi'))
  const [theme, setTheme] = useState(() => (window.__boot?.theme === 'light' ? 'light' : 'dark'))
  const [skin, setSkinState] = useState(() => {
    const initial = readSkin(window.__boot?.skin)
    setPaletteSkin(initial)
    return initial
  })

  useEffect(() => {
    const load = async () => {
      if (!isElectron) return
      const s = await window.electronAPI.getSettings()
      if (!s) return
      if (s.language) setLang(s.language)
      if (s.theme) setTheme(s.theme)
      if (s.skin) {
        const next = readSkin(s.skin)
        setPaletteSkin(next)
        setSkinState(next)
      }
    }
    load()
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.setAttribute('data-skin', skin)
    document.body.style.background = surfaceColor(theme, skin)
    if (theme === 'light') {
      document.body.style.color = '#111'
    } else {
      document.body.style.color = '#fff'
    }
  }, [theme, skin])

  const saveLang = async (next) => {
    setLang(next)
    if (!isElectron) return
    const s = await window.electronAPI.getSettings()
    await window.electronAPI.saveSettings({ ...s, language: next })
  }

  const saveTheme = (next) => {
    if (next === theme) return
    themeWipe(surfaceColor(next, skin), () => {
      setTheme(next)
      if (!isElectron) return
      window.electronAPI
        .getSettings()
        .then((s) => window.electronAPI.saveSettings({ ...s, theme: next }))
        .catch(() => {})
    })
  }

  const saveSkin = (next) => {
    const value = readSkin(next)
    if (value === skin) return
    themeWipe(surfaceColor(theme, value), () => {
      setPaletteSkin(value)
      setSkinState(value)
      if (!isElectron) return
      window.electronAPI
        .getSettings()
        .then((s) => window.electronAPI.saveSettings({ ...s, skin: value }))
        .catch(() => {})
    })
  }

  return (
    <AppContext.Provider value={{ lang, theme, skin, setLang: saveLang, setTheme: saveTheme, setSkin: saveSkin }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  return useContext(AppContext)
}
