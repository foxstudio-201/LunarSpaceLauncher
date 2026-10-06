import { Image } from '@phosphor-icons/react'
import { t } from '../../i18n/translations'
import ContentFolderPage from './ContentFolderPage'

const vn = (lang, vi, en) => (lang === 'vi' ? vi : en)

export default function ResourcepacksPage({ instance, theme, lang, progress }) {
  return (
    <ContentFolderPage
      instance={instance}
      theme={theme}
      lang={lang}
      progress={progress}
      downloadLabel={vn(lang, 'Tải gói tài nguyên', 'Download packs')}
      folder="resourcepacks"
      icon={Image}
      match={(e) => e.dir || /\.zip(\.disabled|\.txt)?$/i.test(e.name)}
      suffix=".disabled"
      emptyHint={vn(lang, 'Chưa có gói tài nguyên nào — kéo tệp .zip hoặc thư mục pack vào đây', 'No resource packs yet — drop .zip files or pack folders here')}
      dropHint={t(lang, 'files.dropCopy')}
      openLabel={vn(lang, 'Mở thư mục resourcepacks', 'Open resourcepacks folder')}
    />
  )
}
