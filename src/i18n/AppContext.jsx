import { createContext, useContext, useState, useEffect } from 'react'
import { themeWipe } from '../lib/themeWipe.js'
import { surfaceColor } from '../lib/palette.js'

const AppContext = createContext()

const isElectron = typeof window !== 'undefined' && window.electronAPI

export function AppProvider({ children }) {
  const [lang, setLang] = useState(() => (window.__boot?.lang === 'en' ? 'en' : 'vi'))
  const [theme, setTheme] = useState(() => (window.__boot?.theme === 'light' ? 'light' : 'dark'))
  useEffect(() => {
    const load = async () => {
      if (!isElectron) return
      const s = await window.electronAPI.getSettings()
      if (!s) return
      if (s.language) setLang(s.language)
      if (s.theme) setTheme(s.theme)
    }
    load()
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.body.style.background = surfaceColor(theme)
    if (theme === 'light') {
      document.body.style.color = '#111'
    } else {
      document.body.style.color = '#fff'
    }
  }, [theme])

  const saveLang = async (next) => {
    setLang(next)
    if (!isElectron) return
    const s = await window.electronAPI.getSettings()
    await window.electronAPI.saveSettings({ ...s, language: next })
  }

  const saveTheme = (next) => {
    if (next === theme) return
    themeWipe(surfaceColor(next), () => {
      setTheme(next)
      if (!isElectron) return
      window.electronAPI
        .getSettings()
        .then((s) => window.electronAPI.saveSettings({ ...s, theme: next }))
        .catch(() => {})
    })
  }

  return (
    <AppContext.Provider value={{ lang, theme, setLang: saveLang, setTheme: saveTheme }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  return useContext(AppContext)
}
