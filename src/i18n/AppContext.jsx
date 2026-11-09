import { createContext, useContext, useState, useEffect } from 'react'
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
    document.body.style.color = theme === 'light' ? '#171a20' : '#e8ebf1'
  }, [theme])

  const saveLang = async (next) => {
    setLang(next)
    if (!isElectron) return
    const s = await window.electronAPI.getSettings()
    await window.electronAPI.saveSettings({ ...s, language: next })
  }

  // Rust đổi theme ngay lập tức; hiệu ứng nằm ở công tắc ngày/đêm.
  const saveTheme = (next) => {
    if (next === theme) return
    setTheme(next)
    if (!isElectron) return
    window.electronAPI
      .getSettings()
      .then((s) => window.electronAPI.saveSettings({ ...s, theme: next }))
      .catch(() => {})
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
