import { useState } from 'react'
import { PuzzlePiece, ShieldCheck } from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import ContentFolderPage from './ContentFolderPage'
import * as api from '../../api/client.js'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

export default function ModsPanel({ instance, theme, lang, progress }) {
  const [repairing, setRepairing] = useState(false)
  const [note, setNote] = useState('')

  const repair = async () => {
    setRepairing(true)
    setNote('')
    try {
      const res = await api.modpackRepair({ id: instance.id })
      if (!res?.ok) setNote(res?.error || 'error')
      else {
        setNote(
          vn(
            lang,
            `Thiếu ${res.missing} tệp · đã tải bù ${res.repaired}${res.failed?.length ? ` · còn lỗi ${res.failed.length}` : ''}`,
            `Missing ${res.missing} · recovered ${res.repaired}${res.failed?.length ? ` · ${res.failed.length} failed` : ''}`,
          ),
        )
      }
    } catch (err) {
      setNote(err.message)
    } finally {
      setRepairing(false)
    }
  }

  return (
    <ContentFolderPage
      instance={instance}
      theme={theme}
      lang={lang}
      progress={progress}
      downloadLabel={vn(lang, 'Tải mod', 'Download mods')}
      folder="mods"
      icon={PuzzlePiece}
      match={(e) => /\.jar(\.disabled)?$/i.test(e.name)}
      suffix=".disabled"
      emptyHint={vn(lang, 'Chưa có mod nào — kéo tệp .jar vào đây để thêm mod', 'No mods yet — drop .jar files here to add mods')}
      dropHint={t(lang, 'files.dropCopy')}
      openLabel={vn(lang, 'Mở thư mục mods', 'Open mods folder')}
      note={note}
      actions={
        <button
          onClick={repair}
          disabled={repairing}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-opacity hover:opacity-85 disabled:opacity-60"
          style={{ background: '#a78bfa', color: '#12081f' }}
        >
          <ShieldCheck size={13} weight="bold" className={repairing ? 'animate-spin' : ''} />
          {vn(lang, 'Tải bù mod thiếu', 'Repair mods')}
        </button>
      }
    />
  )
}
