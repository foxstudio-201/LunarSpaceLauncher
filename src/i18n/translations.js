import vi from './vi'
import en from './en'

export const translations = { vi, en }

export function t(lang, key) {
  const dict = translations[lang] || translations.vi
  return dict[key] || key
}
