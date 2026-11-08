#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;
mod discord;
mod discord_link;
mod mc;
mod ms_login;
mod models;
mod server;
mod net;
mod platform;
mod store;
mod tray;
mod ui;
mod util;

use crate::backend::Backend;
use crate::store::Store;
use crate::ui::assets::FileAssets;
use crate::ui::widgets;
use gpui::{
    App, AppContext, Application, Bounds, KeyBinding, TitlebarOptions, WindowBounds, WindowOptions,
    actions, px, size,
};

actions!(
    lunarspace,
    [
        CloseModal,
        GoHome,
        GoVersions,
        GoModpacks,
        GoAccounts,
        GoSettings,
        GoHost,
        GoServers
    ]
);
use std::sync::Arc;

#[cfg(windows)]
fn single_instance() -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{ERROR_ALREADY_EXISTS, GetLastError};
    use windows::Win32::System::Threading::CreateMutexW;
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SW_RESTORE, SW_SHOW, SetForegroundWindow, ShowWindow,
    };
    unsafe {
        let name = windows::core::w!("XyoLauncher_SingleInstance");
        let Ok(_guard) = CreateMutexW(None, true, PCWSTR(name.as_ptr())) else {
            return true;
        };
        if GetLastError() == ERROR_ALREADY_EXISTS {
            if let Ok(hwnd) = FindWindowW(PCWSTR::null(), windows::core::w!("XyoLauncher")) {
                let _ = ShowWindow(hwnd, SW_SHOW);
                let _ = ShowWindow(hwnd, SW_RESTORE);
                let _ = SetForegroundWindow(hwnd);
            }
            return false;
        }
        true
    }
}

#[cfg(not(windows))]
fn single_instance() -> bool {
    true
}

fn main() {
    if std::env::args().any(|arg| arg == "--ms-login") {
        ms_login::print_result(ms_login::run_login_window());
        return;
    }
    if !single_instance() {
        return;
    }
    let (events_tx, events_rx) = async_channel::unbounded();
    let store = Arc::new(Store::load());
    let saved = store.settings();
    let saved_width = saved
        .extra
        .get("windowWidth")
        .and_then(serde_json::Value::as_f64)
        .map(|value| value as f32)
        .filter(|value| *value >= 980.0 && *value <= 3200.0)
        .unwrap_or(1180.0);
    let saved_height = saved
        .extra
        .get("windowHeight")
        .and_then(serde_json::Value::as_f64)
        .map(|value| value as f32)
        .filter(|value| *value >= 640.0 && *value <= 2000.0)
        .unwrap_or(760.0);
    let backend = Backend::new(store, events_tx);
    Application::new()
        .with_assets(FileAssets::new())
        .run(move |cx: &mut App| {
            ui::assets::load_fonts(cx);
            widgets::bind_text_keys(cx);
            cx.bind_keys([
                KeyBinding::new("escape", CloseModal, None),
                KeyBinding::new("ctrl-1", GoHome, None),
                KeyBinding::new("ctrl-2", GoVersions, None),
                KeyBinding::new("ctrl-3", GoModpacks, None),
                KeyBinding::new("ctrl-4", GoAccounts, None),
                KeyBinding::new("ctrl-5", GoSettings, None),
                KeyBinding::new("ctrl-6", GoHost, None),
                KeyBinding::new("ctrl-7", GoServers, None),
            ]);
            let exit_backend = backend.clone();
            cx.on_window_closed(move |cx| {
                if cx.windows().is_empty() {
                    exit_backend.shutdown();
                    cx.quit();
                }
            })
            .detach();
            let bounds = Bounds::centered(None, size(px(saved_width), px(saved_height)), cx);
            cx.open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    window_min_size: Some(size(px(980.0), px(640.0))),
                    titlebar: Some(TitlebarOptions {
                        title: Some("XyoLauncher".into()),
                        appears_transparent: true,
                        traffic_light_position: None,
                    }),
                    ..Default::default()
                },
                |window, cx| {
                    let view = cx.new(|cx| {
                        ui::LauncherApp::new(backend.clone(), events_rx.clone(), cx)
                    });
                    let handle = view.read(cx).focus_handle();
                    window.focus(&handle);
                    view
                },
            )
            .unwrap();
            cx.activate(true);
            let icon = ui::assets::assets_root().join("img").join("icon.ico");
            tray::start(icon.clone());
            cx.spawn(async move |cx| {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(350))
                    .await;
                set_window_icon(&icon);
            })
            .detach();
        });
}


#[cfg(windows)]
fn set_window_icon(path: &std::path::Path) {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, ICON_BIG, ICON_SMALL, IMAGE_ICON, LR_DEFAULTSIZE, LR_LOADFROMFILE,
        LoadImageW, SendMessageW, WM_SETICON,
    };
    unsafe {
        use windows::Win32::Graphics::Dwm::{
            DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE, DwmSetWindowAttribute,
        };
        let title = HSTRING::from("XyoLauncher");
        let Ok(hwnd) = FindWindowW(PCWSTR::null(), &title) else {
            return;
        };
        let dark = windows::Win32::Foundation::BOOL(1);
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dark as *const _ as *const _,
            std::mem::size_of::<windows::Win32::Foundation::BOOL>() as u32,
        );
        // COLORREF is 0x00BBGGRR: matches the launcher's graphite background.
        let caption: u32 = 0x0010_0e0d;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            &caption as *const _ as *const _,
            std::mem::size_of::<u32>() as u32,
        );
        let text: u32 = 0x00f1_ebe8;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_TEXT_COLOR,
            &text as *const _ as *const _,
            std::mem::size_of::<u32>() as u32,
        );
        let file = HSTRING::from(path.to_string_lossy().as_ref());
        let Ok(icon) = LoadImageW(
            None,
            &file,
            IMAGE_ICON,
            0,
            0,
            LR_LOADFROMFILE | LR_DEFAULTSIZE,
        ) else {
            return;
        };
        SendMessageW(
            hwnd,
            WM_SETICON,
            windows::Win32::Foundation::WPARAM(ICON_BIG as usize),
            windows::Win32::Foundation::LPARAM(icon.0 as isize),
        );
        SendMessageW(
            hwnd,
            WM_SETICON,
            windows::Win32::Foundation::WPARAM(ICON_SMALL as usize),
            windows::Win32::Foundation::LPARAM(icon.0 as isize),
        );
    }
}

#[cfg(not(windows))]
fn set_window_icon(_path: &std::path::Path) {}
