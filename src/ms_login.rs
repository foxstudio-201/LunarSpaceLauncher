#[derive(Clone, Debug)]
enum UserEvent {
    Code(String),
    Failed(String),
}

fn percent_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    index += 3;
                    continue;
                }
                out.push(b'%');
                index += 1;
            }
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query_value(url: &str, key: &str) -> Option<String> {
    let query = url.split_once('?')?.1.split('#').next().unwrap_or("");
    for pair in query.split('&') {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        if name == key {
            return Some(percent_decode(value));
        }
    }
    None
}

fn parse_redirect(target: &str, expected_state: &str) -> Result<String, String> {
    if let Some(error) = query_value(target, "error") {
        let description = query_value(target, "error_description").unwrap_or(error);
        return Err(format!("Microsoft báo lỗi: {description}"));
    }
    let state = query_value(target, "state").unwrap_or_default();
    if state != expected_state {
        return Err("Phiên đăng nhập không khớp. Hãy thử lại.".into());
    }
    query_value(target, "code")
        .filter(|code| !code.is_empty())
        .ok_or_else(|| "Microsoft không trả về mã đăng nhập.".into())
}

pub fn login_code() -> Result<String, String> {
    #[cfg(not(windows))]
    {
        return Err("Đăng nhập Microsoft bằng cửa sổ nhúng chỉ hỗ trợ Windows.".into());
    }
    #[cfg(windows)]
    {
        use tao::dpi::LogicalSize;
        use tao::event::{Event, WindowEvent};
        use tao::event_loop::{ControlFlow, EventLoopBuilder};
        use tao::platform::run_return::EventLoopExtRunReturn;
        use tao::platform::windows::WindowBuilderExtWindows;
        use tao::window::WindowBuilder;
        use windows::Win32::UI::Input::KeyboardAndMouse::EnableWindow;
        use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, SetForegroundWindow};
        use wry::WebViewBuilder;

        const CLIENT_ID: &str = "00000000402b5328";
        const REDIRECT: &str = "https://login.live.com/oauth20_desktop.srf";
        const SCOPE: &str = "XboxLive.signin offline_access";

        let state = uuid::Uuid::new_v4().simple().to_string();
        let initial_state = state.clone();
        let url = format!(
            "https://login.live.com/oauth20_authorize.srf?client_id={CLIENT_ID}&response_type=code&redirect_uri={}&scope={}&state={}&prompt=select_account",
            percent_encode(REDIRECT),
            percent_encode(SCOPE),
            state
        );

        #[allow(unused_imports)]
        use tao::platform::windows::EventLoopBuilderExtWindows;
        let mut builder = EventLoopBuilder::<UserEvent>::with_user_event();
        builder.with_any_thread(true);
        let mut event_loop = builder.build();
        let proxy = event_loop.create_proxy();
        let parent = unsafe { FindWindowW(windows::core::PCWSTR::null(), windows::core::w!("XyoLauncher")).ok() };
        let mut window_builder = WindowBuilder::new()
            .with_title("Đăng nhập Microsoft")
            .with_inner_size(LogicalSize::new(520.0, 680.0))
            .with_resizable(false)
            .with_skip_taskbar(true);
        if let Some(parent) = parent {
            window_builder = window_builder.with_owner_window(parent.0 as isize);
        }
        let window = window_builder
            .build(&event_loop)
            .map_err(|err| format!("Không mở được cửa sổ đăng nhập: {err}"))?;
        if let Some(parent) = parent {
            unsafe {
                let _ = EnableWindow(parent, false);
            }
        }

        let proxy_nav = proxy.clone();
        let redirect_state = initial_state.clone();
        let webview = WebViewBuilder::new()
            .with_url(url)
            .with_navigation_handler(move |target| {
                if target.starts_with(REDIRECT) {
                    let event = match parse_redirect(&target, &redirect_state) {
                        Ok(code) => UserEvent::Code(code),
                        Err(err) => UserEvent::Failed(err),
                    };
                    let _ = proxy_nav.send_event(event);
                    return false;
                }
                true
            })
            .build(&window)
            .map_err(|err| format!("Không mở được WebView2: {err}"))?;

        let mut result: Result<String, String> =
            Err("Bạn đã đóng cửa sổ đăng nhập Microsoft.".into());
        event_loop.run_return(|event, _, control_flow| {
            *control_flow = ControlFlow::Wait;
            match event {
                Event::UserEvent(UserEvent::Code(code)) => {
                    result = Ok(code);
                    *control_flow = ControlFlow::Exit;
                }
                Event::UserEvent(UserEvent::Failed(error)) => {
                    result = Err(error);
                    *control_flow = ControlFlow::Exit;
                }
                Event::WindowEvent {
                    event: WindowEvent::CloseRequested,
                    ..
                } => {
                    *control_flow = ControlFlow::Exit;
                }
                _ => {}
            }
        });
        drop(webview);
        drop(window);
        if let Some(parent) = parent {
            unsafe {
                let _ = EnableWindow(parent, true);
                let _ = SetForegroundWindow(parent);
            }
        }
        result
    }
}
