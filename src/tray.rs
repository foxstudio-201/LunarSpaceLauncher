#[cfg(windows)]
mod imp {
    use parking_lot::Mutex;
    use std::path::PathBuf;
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Shell::{
        NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NOTIFYICONDATAW, Shell_NotifyIconW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DispatchMessageW,
        FindWindowW, GetCursorPos, GetMessageW, GetSystemMetrics, IsWindowVisible, LoadImageW,
        MF_GRAYED, MF_SEPARATOR, MF_STRING, MSG, PostMessageW, PostQuitMessage, RegisterClassW,
        SM_CXSMICON, SM_CYSMICON, SW_HIDE, SW_RESTORE, SW_SHOW, SetForegroundWindow, ShowWindow,
        TPM_RETURNCMD, TPM_RIGHTBUTTON, TrackPopupMenu, TranslateMessage, IMAGE_ICON, LR_LOADFROMFILE,
        WM_APP, WM_CLOSE,
        WM_DESTROY, WM_LBUTTONDBLCLK, WM_LBUTTONUP, WM_RBUTTONUP, WNDCLASSW, WS_EX_TOOLWINDOW,
    };

    const WM_TRAY: u32 = WM_APP + 17;
    static RUNNING: Mutex<Vec<String>> = Mutex::new(Vec::new());
    static ICON: Mutex<Option<PathBuf>> = Mutex::new(None);

    pub fn start(icon: PathBuf) {
        *ICON.lock() = Some(icon);
        std::thread::spawn(|| unsafe { run() });
    }

    pub fn set_running(names: Vec<String>) {
        *RUNNING.lock() = names;
    }

    unsafe fn run() {
        let Ok(instance) = GetModuleHandleW(None) else { return };
        let class = HSTRING::from("XyoTrayWindow");
        let wc = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            hInstance: HINSTANCE(instance.0),
            lpszClassName: PCWSTR(class.as_ptr()),
            ..Default::default()
        };
        if RegisterClassW(&wc) == 0 {
            return;
        }
        let Ok(hwnd) = CreateWindowExW(
            WS_EX_TOOLWINDOW,
            PCWSTR(class.as_ptr()),
            PCWSTR::null(),
            Default::default(),
            0,
            0,
            0,
            0,
            None,
            None,
            HINSTANCE(instance.0),
            None,
        ) else {
            return;
        };
        let icon = ICON.lock().clone();
        let hicon = icon
            .as_ref()
            .map(|path| {
                let wide = HSTRING::from(path.to_string_lossy().as_ref());
                LoadImageW(
                    None,
                    PCWSTR(wide.as_ptr()),
                    IMAGE_ICON,
                    GetSystemMetrics(SM_CXSMICON),
                    GetSystemMetrics(SM_CYSMICON),
                    LR_LOADFROMFILE,
                )
                .unwrap_or_default()
            })
            .unwrap_or_default();
        let mut data = NOTIFYICONDATAW::default();
        data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
        data.hWnd = hwnd;
        data.uID = 1;
        data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
        data.uCallbackMessage = WM_TRAY;
        data.hIcon = windows::Win32::UI::WindowsAndMessaging::HICON(hicon.0);
        let tip: Vec<u16> = "XyoLauncher".encode_utf16().collect();
        let size = tip.len().min(data.szTip.len() - 1);
        data.szTip[..size].copy_from_slice(&tip[..size]);
        let _ = Shell_NotifyIconW(NIM_ADD, &data);
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).into() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        let _ = Shell_NotifyIconW(NIM_DELETE, &data);
    }

    unsafe fn main_window() -> Option<HWND> {
        FindWindowW(PCWSTR::null(), windows::core::w!("XyoLauncher")).ok()
    }

    unsafe fn toggle() {
        let Some(hwnd) = main_window() else { return };
        if IsWindowVisible(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_HIDE);
        } else {
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        }
    }

    unsafe fn menu(hwnd: HWND) {
        let Ok(popup) = CreatePopupMenu() else { return };
        let visible = main_window().map(|main| IsWindowVisible(main).as_bool()).unwrap_or(false);
        let open = HSTRING::from(if visible { "Ẩn launcher" } else { "Mở XyoLauncher" });
        let _ = AppendMenuW(popup, MF_STRING, 1, PCWSTR(open.as_ptr()));
        let running = RUNNING.lock().clone();
        if !running.is_empty() {
            let text = HSTRING::from(format!("Đang chơi: {}", running.join(", ")));
            let _ = AppendMenuW(popup, MF_STRING | MF_GRAYED, 2, PCWSTR(text.as_ptr()));
        }
        let _ = AppendMenuW(popup, MF_SEPARATOR, 0, PCWSTR::null());
        let quit = HSTRING::from("Thoát XyoLauncher");
        let _ = AppendMenuW(popup, MF_STRING, 3, PCWSTR(quit.as_ptr()));
        let mut point = POINT::default();
        let _ = GetCursorPos(&mut point);
        let _ = SetForegroundWindow(hwnd);
        let choice = TrackPopupMenu(
            popup,
            TPM_RETURNCMD | TPM_RIGHTBUTTON,
            point.x,
            point.y,
            0,
            hwnd,
            None,
        )
        .0;
        let _ = DestroyMenu(popup);
        match choice {
            1 => toggle(),
            3 => {
                if let Some(main) = main_window() {
                    let _ = PostMessageW(main, WM_CLOSE, WPARAM(0), LPARAM(0));
                }
            }
            _ => {}
        }
    }

    unsafe extern "system" fn wndproc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match message {
            WM_TRAY => {
                let event = lparam.0 as u32;
                if event == WM_LBUTTONUP || event == WM_LBUTTONDBLCLK {
                    toggle();
                } else if event == WM_RBUTTONUP {
                    menu(hwnd);
                }
                LRESULT(0)
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }
}

#[cfg(windows)]
pub use imp::{set_running, start};

#[cfg(not(windows))]
pub fn start(_icon: std::path::PathBuf) {}

#[cfg(not(windows))]
pub fn set_running(_names: Vec<String>) {}
