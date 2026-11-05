use anyhow::{anyhow, Result};
use serde_json::{Value, json};

pub const DEFAULT_API_URL: &str = "http://a29sv1.bumboohost.vn:25691";
pub const DEFAULT_API_KEY: &str = "80e48059386dd0f5b0831af9a6990d7b4e5482657d626853";

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(crate::net::USER_AGENT)
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

async fn call(route: &str, method: &str, body: Option<Value>) -> Result<Value> {
    let url = format!("{}{}", DEFAULT_API_URL.trim_end_matches('/'), route);
    let mut request = client()
        .request(
            reqwest::Method::from_bytes(method.as_bytes()).unwrap_or(reqwest::Method::GET),
            &url,
        )
        .header("x-api-key", DEFAULT_API_KEY);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|err| anyhow!("Không gọi được bot Discord: {err}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let value: Value = serde_json::from_str(&text).unwrap_or(json!({"error": text.trim()}));
    if !status.is_success() {
        let message = value
            .get("error")
            .and_then(Value::as_str)
            .filter(|message| !message.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("Bot Discord trả về mã {}", status.as_u16()));
        return Ok(json!({
            "ok": false,
            "status": status.as_u16(),
            "error": message,
            "conflict": value.get("conflict").cloned().unwrap_or(Value::Null),
            "holder": value.get("holder").cloned().unwrap_or(Value::Null),
        }));
    }
    if value.is_object() {
        Ok(value)
    } else {
        Ok(json!({"ok": true}))
    }
}

pub async fn config() -> Result<Value> {
    let value = call("/api/config", "GET", None).await?;
    if value.get("ok").and_then(Value::as_bool) == Some(false) {
        return Err(anyhow!(
            "{}",
            value.get("error").and_then(Value::as_str).unwrap_or("Bot Discord không phản hồi.")
        ));
    }
    Ok(value)
}

pub async fn links() -> Result<Value> {
    call("/api/links", "GET", None).await
}

pub async fn unlink(id: &str) -> Result<Value> {
    call(&format!("/api/link/{}", urlencode(id)), "DELETE", None).await
}

pub async fn verify(token: &str) -> Result<Value> {
    call("/api/verify", "POST", Some(json!({"token": token}))).await
}

pub async fn link_account(token: &str, link_id: &str, force: bool, account: Value) -> Result<Value> {
    let mut body = json!({
        "token": token,
        "force": force,
        "name": "",
        "account": account,
    });
    if !link_id.is_empty() {
        body["linkId"] = Value::String(link_id.to_string());
    }
    call("/api/link", "POST", Some(body)).await
}

pub fn account_name(raw: &str, fallback_id: &str) -> String {
    let clean: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();
    if clean.len() >= 3 {
        return clean.chars().take(16).collect();
    }
    let tail: String = fallback_id.chars().filter(|c| c.is_ascii_digit()).collect();
    if tail.len() >= 4 {
        format!("User{}", &tail[tail.len() - 4..])
    } else {
        String::new()
    }
}

pub fn new_state() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

pub fn authorize_url(template: &str, state: &str) -> String {
    template
        .replace("{state}", state)
        .replace("%7Bstate%7D", state)
        .replace("%7bstate%7d", state)
}

pub fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

pub fn html_page() -> String {
    r#"<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Xác thực Discord — XyoLauncher</title>
<style>
:root{--bg:#0c0e12;--surface:#15181e;--elevated:#1b1f26;--border:#2a303a;--text:#eceff3;--muted:#9aa4b2;--faint:#6b7583;--accent:#e9b872;--ok:#22c55e;--bad:#ef4444}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px 18px;background:radial-gradient(70% 60% at 20% 0%,rgba(233,184,114,.10),transparent 60%),var(--bg);color:var(--text);font:14px/1.55 'Segoe UI',system-ui,sans-serif}
.card{width:100%;max-width:480px;background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.45)}
.head{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--border);background:var(--elevated)}
.dot{width:10px;height:10px;border-radius:3px;background:#5865f2}
h1{font-size:14px;margin:0;font-weight:700;letter-spacing:.02em}
.body{padding:20px 18px}
p{margin:0 0 12px;color:var(--muted);font-size:12px}
.who{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--elevated);margin-bottom:14px}
.who img{width:44px;height:44px;border-radius:10px;border:1px solid var(--border);background:var(--surface)}
.who b{display:block;font-size:13px;color:var(--text)}
.who span{font-size:11px;color:var(--faint)}
.status{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--elevated)}
.spin{width:12px;height:12px;margin-top:3px;border:2px solid rgba(233,184,114,.25);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
.status.ok{border-color:rgba(34,197,94,.5)}.status.bad{border-color:rgba(239,68,68,.5)}
.status.ok .spin,.status.bad .spin{display:none}
.title{font-weight:700;font-size:12px;margin-bottom:3px}
.status.ok .title{color:var(--ok)}.status.bad .title{color:var(--bad)}
.msg{color:var(--muted);font-size:11.5px}
.note{margin-top:14px;color:var(--faint);font-size:11px;text-align:center}
</style></head>
<body><main class="card">
<div class="head"><span class="dot"></span><h1>Xác thực Discord</h1></div>
<div class="body">
<p>Launcher đang chờ Discord trả quyền truy cập về máy này để hoàn tất liên kết.</p>
<div class="who" id="who" style="display:none"><img id="avatar" alt=""><div><b id="whoName"></b><span id="whoSub"></span></div></div>
<div class="status" id="box"><span class="spin"></span><div><div class="title" id="title">Đang xác thực</div><div class="msg" id="msg">Đang gửi thông tin uỷ quyền về launcher…</div></div></div>
<p class="note" id="note">Có thể đóng cửa sổ này sau khi xác thực xong.</p>
</div></main>
<script>
var params=new URLSearchParams(location.hash.slice(1));
var payload={access_token:params.get('access_token')||'',state:params.get('state')||'',error:params.get('error')||''};
fetch('/discord/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
.then(function(r){return r.json()})
.then(function(res){
  var box=document.getElementById('box');
  if(res.discord){
    document.getElementById('who').style.display='flex';
    var img=document.getElementById('avatar');
    if(res.discord.avatar){img.src=res.discord.avatar}else{img.style.display='none'}
    document.getElementById('whoName').textContent=res.discord.name||res.discord.tag||'Discord';
    document.getElementById('whoSub').textContent=res.account?('Tài khoản launcher: '+res.account):(res.discord.tag||'');
  }
  box.className='status '+(res.ok?'ok':'bad');
  document.getElementById('title').textContent=res.ok?'Xác thực thành công':'Không hoàn tất được';
  document.getElementById('msg').textContent=res.ok?('Đã liên kết'+(res.discord&&res.discord.tag?(' với '+res.discord.tag):'')+'.'):(res.error||'Discord không trả về quyền truy cập.');
  document.getElementById('note').textContent=res.ok?'Launcher đã nhận thông tin — bạn có thể đóng tab này.':'Hãy thử lại trong launcher.';
})
.catch(function(err){
  var box=document.getElementById('box');
  box.className='status bad';
  document.getElementById('title').textContent='Lỗi kết nối';
  document.getElementById('msg').textContent='Không gửi được thông tin về launcher: '+err.message;
});
</script></body></html>"#.to_string()
}
