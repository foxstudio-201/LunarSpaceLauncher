import { PaintBrush } from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import ContentFolderPage from './ContentFolderPage'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

export default function ShaderpacksPage({ instance, theme, lang, progress }) {
  return (
    <ContentFolderPage
      instance={instance}
      theme={theme}
      lang={lang}
      progress={progress}
      downloadLabel={vn(lang, 'Tải shader', 'Download shaders')}
      folder="shaderpacks"
      icon={PaintBrush}
      match={(e) => /\.zip(\.disabled|\.txt)?$/i.test(e.name)}
      suffix=".txt"
      emptyHint={vn(lang, 'Chưa có shader nào — kéo tệp .zip của shader vào đây', 'No shaders yet — drop shader .zip files here')}
      dropHint={t(lang, 'files.dropCopy')}
      openLabel={vn(lang, 'Mở thư mục shaderpacks', 'Open shaderpacks folder')}
    />
  )
}
