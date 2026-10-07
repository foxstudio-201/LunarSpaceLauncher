import { useState } from 'react'
import { Plus, Trash, Shield } from '@phosphor-icons/react'

export default function UserPage({ server, theme, lang }) {
  const textColor = theme === 'light' ? '#111' : '#fff'
  const labelColor = theme === 'light' ? '#555' : 'rgba(255,255,255,0.6)'
  const borderColor = theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'

  const [users] = useState([])

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-sm font-bold" style={{ color: textColor }}>{lang === 'vi' ? 'Người dùng' : 'Subusers'}</h2>
        <div className="flex-1" />
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: '#8b5cf6', color: '#fff' }}>
          <Plus size={13} weight="duotone" /> {lang === 'vi' ? 'Thêm' : 'Add'}
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Shield size={40} weight="duotone" style={{ color: labelColor, opacity: 0.3 }} />
          <p className="text-[11px] mt-2" style={{ color: labelColor }}>{lang === 'vi' ? 'Quản lý quyền truy cập subuser' : 'Manage subuser access permissions'}</p>
          <p className="text-[10px] mt-1.5 max-w-sm" style={{ color: labelColor, opacity: 0.75 }}>
            {lang === 'vi'
              ? 'Subuser là tính năng của panel hosting (phân quyền cho người khác vào panel). Server chạy local không có subuser — cấp quyền trong game bằng ops.json / whitelist.json ở trang Tệp tin.'
              : 'Subusers are a hosting-panel feature (granting others panel access). A local server has none — grant in-game access via ops.json / whitelist.json on the Files page.'}
          </p>
        </div>
      </div>
    </div>
  )
}
