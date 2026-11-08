use crate::platform::HideConsole;
use std::io::Write;
use std::process::{Command, Stdio};

#[derive(Clone, Debug)]
enum UserEvent {
    Code(String),
    Failed(String),
}

const CLIENT_ID: &str = "00000000402b5328";
const REDIRECT: &str = "https://login.live.com/oauth20_desktop.srf";
const SCOPE: &str = "XboxLive.signin offline_access";
const AUTH_URL: &str = "https://login.live.com/oauth20_authorize.srf";

fn auth_url(state: &str) -> String {
    format!(
        "{AUTH_URL}?client_id={CLIENT_ID}&response_type=code&redirect_uri={}&scope={}&state={}&prompt=select_account",
        percent_encode(REDIRECT),
        percent_encode(SCOPE),
        state
    )
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

/// Runs the embedded Microsoft sign-in window on the current (main) thread.
/// The launcher starts this in a child process so GTK/WebKit and the GPUI
/// event loop never compete for the same main loop.
pub fn run_login_window() -> Result<String, String> {
    use tao::dpi::LogicalSize;
    use tao::event::{Event, WindowEvent};
    use tao::event_loop::{ControlFlow, EventLoopBuilder};
    use tao::platform::run_return::EventLoopExtRunReturn;
    use tao::window::WindowBuilder;
    use wry::WebViewBuilder;

    #[cfg(target_os = "linux")]
    if gtk::init().is_err() {
        return Err("Không khởi tạo được GTK cho cửa sổ đăng nhập.".into());
    }
    let state = uuid::Uuid::new_v4().simple().to_string();
    let initial_state = state.clone();
    let mut event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title("Đăng nhập Microsoft")
        .with_inner_size(LogicalSize::new(520.0, 680.0))
        .with_resizable(false)
        .build(&event_loop)
        .map_err(|err| format!("Không mở được cửa sổ đăng nhập: {err}"))?;
    let proxy_nav = proxy.clone();
    let redirect_state = initial_state.clone();
    let builder = WebViewBuilder::new()
        .with_url(auth_url(&state))
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
        });
    #[cfg(target_os = "linux")]
    let webview = {
        use gtk::prelude::*;
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        let vbox = window
            .default_vbox()
            .ok_or_else(|| "Không tạo được khung cửa sổ đăng nhập.".to_string())?;
        let fixed = gtk::Fixed::new();
        vbox.pack_start(&fixed, true, true, 0);
        let size = window.inner_size().to_logical::<f64>(window.scale_factor());
        let webview = builder
            .with_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0.0, 0.0).into(),
                size: wry::dpi::LogicalSize::new(size.width, size.height).into(),
            })
            .build_gtk(&fixed)
            .map_err(|err| format!("Không mở được cửa sổ web đăng nhập: {err}"))?;
        fixed.show_all();
        let _ = webview.set_visible(true);
        webview
    };
    #[cfg(not(target_os = "linux"))]
    let webview = builder
        .build(&window)
        .map_err(|err| format!("Không mở được cửa sổ web đăng nhập: {err}"))?;

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
    result
}

pub fn login_code() -> Result<String, String> {
    let exe = std::env::current_exe()
        .map_err(|err| format!("Không xác định được tệp launcher: {err}"))?;
    let output = Command::new(exe)
        .arg("--ms-login")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .hide_console()
        .output()
        .map_err(|err| format!("Không mở được cửa sổ đăng nhập Microsoft: {err}"))?;
    let mut stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if !stderr.trim().is_empty() {
        if !stdout.ends_with('\n') {
            stdout.push('\n');
        }
        stdout.push_str(&stderr);
    }
    for line in stdout.lines() {
        if let Some(code) = line.strip_prefix("OK:") {
            return Ok(code.trim().to_string());
        }
        if let Some(error) = line.strip_prefix("ERR:") {
            let error = error.trim();
            if !error.is_empty() {
                return Err(error.to_string());
            }
        }
    }
    let detail = stderr
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();
    if detail.is_empty() {
        Err("Không nhận được mã đăng nhập Microsoft.".into())
    } else {
        Err(format!("Đăng nhập Microsoft thất bại: {detail}"))
    }
}

pub fn print_result(result: Result<String, String>) {
    let text = match result {
        Ok(code) => format!("OK:{code}"),
        Err(error) => format!("ERR:{}", error.replace(['\n', '\r'], " ")),
    };
    let mut stdout = std::io::stdout();
    let _ = writeln!(stdout, "{text}");
    let _ = stdout.flush();
}
