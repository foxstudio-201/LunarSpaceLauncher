import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import * as api from '../../api/client.js'

marked.setOptions({ gfm: true, breaks: false })

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup', 'font',
  'ul', 'ol', 'li', 'a', 'img', 'code', 'pre', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'center', 'details', 'summary',
  'figure', 'figcaption',
]

const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'width', 'height', 'align', 'colspan', 'rowspan',
  'target', 'rel', 'loading', 'id', 'start',
]

let hooked = false
function ensureHooks() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!node.tagName) return
    if (node.tagName === 'IMG') {
      node.setAttribute('loading', 'lazy')
      node.setAttribute('referrerpolicy', 'no-referrer')
    }
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noreferrer noopener')
    }
  })
}

export function richHtml(raw, format) {
  if (!raw) return ''
  ensureHooks()
  let html = ''
  try {
    html = format === 'html' ? String(raw) : marked.parse(String(raw))
  } catch {
    html = `<p>${String(raw).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}</p>`
  }
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'button', 'video', 'audio', 'object', 'embed', 'link', 'meta', 'base'],
  })
}

export default function RichText({ raw, format = 'markdown', c, className = '', style }) {
  const html = useMemo(() => richHtml(raw, format), [raw, format])
  const vars = c
    ? {
        '--md-text': c.text,
        '--md-label': c.label,
        '--md-faint': c.faint,
        '--md-border': c.border,
        '--md-input': c.input,
        '--md-accent': c.accent,
      }
    : undefined
  const onClick = (e) => {
    const link = e.target?.closest?.('a[href]')
    if (!link) return
    const href = link.getAttribute('href') || ''
    if (!/^https?:\/\//i.test(href)) return
    e.preventDefault()
    e.stopPropagation()
    api.openExternal(href).catch(() => {})
  }
  return (
    <div
      className={`md-body ${className}`}
      style={{ ...vars, ...style }}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
