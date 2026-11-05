use crate::models::{Account, AuthSession};
use crate::store::Store;
use anyhow::{anyhow, Result};
use serde_json::{Value, json};
use std::time::Duration;

pub const MS_CLIENT_ID: &str = "00000000402b5328";
pub const MS_SCOPE: &str = "XboxLive.signin offline_access";
pub const ELY_AUTH_SERVER: &str = "https://authserver.ely.by";
pub const ELY_AUTHLIB_API: &str = "https://authserver.ely.by/api/authlib-injector";
const INJECTOR_META: &str = "https://authlib-injector.yushi.moe/artifact/latest.json";

pub async fn exchange_oauth_code(code: &str) -> Result<Value> {
    let res = crate::net::client()
        .post("https://login.live.com/oauth20_token.srf")
        .form(&[
            ("client_id", MS_CLIENT_ID),
            ("code", code),
            ("grant_type", "authorization_code"),
            ("redirect_uri", "https://login.live.com/oauth20_desktop.srf"),
            ("scope", MS_SCOPE),
        ])
        .send()
        .await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() || body.get("access_token").and_then(Value::as_str).is_none() {
        let message = body
            .get("error_description")
            .and_then(Value::as_str)
            .unwrap_or("Đổi mã đăng nhập Microsoft thất bại.");
        return Err(anyhow!("{message}"));
    }
    Ok(body)
}

async fn refresh_ms_token(refresh_token: &str) -> Result<Value> {
    let res = crate::net::client()
        .post("https://login.live.com/oauth20_token.srf")
        .form(&[
            ("client_id", MS_CLIENT_ID),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("scope", MS_SCOPE),
        ])
        .send()
        .await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() || body.get("access_token").and_then(Value::as_str).is_none() {
        let message = body
            .get("error_description")
            .and_then(Value::as_str)
            .unwrap_or("Làm mới token Microsoft thất bại.");
        return Err(anyhow!("{message}"));
    }
    Ok(body)
}

async fn auth_xbox(ms_access_token: &str) -> Result<(String, String)> {
    let res = crate::net::client()
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={ms_access_token}")
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }))
        .send()
        .await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    let token = body.get("Token").and_then(Value::as_str).unwrap_or("");
    let uhs = body
        .pointer("/DisplayClaims/xui/0/uhs")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !status.is_success() || token.is_empty() || uhs.is_empty() {
        return Err(anyhow!("Xác thực Xbox Live thất bại (HTTP {status})."));
    }
    Ok((token.to_string(), uhs.to_string()))
}

async fn auth_xsts(xbl_token: &str) -> Result<(String, String, String)> {
    let res = crate::net::client()
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbl_token]
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }))
        .send()
        .await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if status.as_u16() == 401 {
        let code = body.get("XErr").and_then(Value::as_u64).unwrap_or(0);
        let message = match code {
            2148916233 => "Tài khoản Microsoft này chưa có Xbox Live. Hãy tạo tại xbox.com rồi thử lại.",
            2148916235 => "Xbox Live không khả dụng ở quốc gia của tài khoản này.",
            2148916238 => "Tài khoản trẻ em cần phụ huynh xác nhận trong gia đình Microsoft.",
            _ => "Xác thực XSTS thất bại.",
        };
        return Err(anyhow!("{message}"));
    }
    let token = body.get("Token").and_then(Value::as_str).unwrap_or("");
    let uhs = body
        .pointer("/DisplayClaims/xui/0/uhs")
        .and_then(Value::as_str)
        .unwrap_or("");
    let xuid = body
        .pointer("/DisplayClaims/xui/0/xid")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if !status.is_success() || token.is_empty() || uhs.is_empty() {
        return Err(anyhow!("Xác thực XSTS thất bại (HTTP {status})."));
    }
    Ok((token.to_string(), uhs.to_string(), xuid))
}

async fn auth_minecraft(xsts: &str, uhs: &str) -> Result<(String, u64)> {
    let res = crate::net::client()
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&json!({ "identityToken": format!("XBL3.0 x={uhs};{xsts}") }))
        .send()
        .await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    let token = body.get("access_token").and_then(Value::as_str).unwrap_or("");
    if !status.is_success() || token.is_empty() {
        return Err(anyhow!("Đăng nhập Minecraft thất bại (HTTP {status})."));
    }
    Ok((
        token.to_string(),
        body.get("expires_in").and_then(Value::as_u64).unwrap_or(86400),
    ))
}

async fn fetch_profile(token: &str) -> Result<(String, String)> {
    let res = crate::net::client()
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(token)
        .send()
        .await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if status.as_u16() == 404 || body.get("error").and_then(Value::as_str) == Some("NOT_FOUND") {
        return Err(anyhow!("Tài khoản này chưa sở hữu Minecraft Java Edition."));
    }
    let id = body.get("id").and_then(Value::as_str).unwrap_or("");
    let name = body.get("name").and_then(Value::as_str).unwrap_or("");
    if !status.is_success() || id.is_empty() || name.is_empty() {
        return Err(anyhow!("Không đọc được hồ sơ Minecraft (HTTP {status})."));
    }
    Ok((crate::store::uuid_dashed(id), name.to_string()))
}

pub async fn build_ms_session(ms: &Value) -> Result<AuthSession> {
    let ms_access = ms.get("access_token").and_then(Value::as_str).unwrap_or("");
    let refresh = ms
        .get("refresh_token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let (xbl, _) = auth_xbox(ms_access).await?;
    let (xsts, uhs, xuid) = auth_xsts(&xbl).await?;
    let (token, expires) = auth_minecraft(&xsts, &uhs).await?;
    let (uuid, name) = fetch_profile(&token).await?;
    Ok(AuthSession {
        name,
        uuid,
        access_token: token,
        user_type: "msa".into(),
        xuid: Some(xuid),
        expires_at: chrono::Utc::now().timestamp_millis() + (expires as i64) * 1000,
        refresh_token: Some(refresh),
        client_token: None,
        java_agent: None,
    })
}

pub async fn ms_refresh(refresh_token: &str) -> Result<AuthSession> {
    let ms = refresh_ms_token(refresh_token).await?;
    let mut session = build_ms_session(&ms).await?;
    if session.refresh_token.as_deref().unwrap_or("").is_empty() {
        session.refresh_token = Some(refresh_token.to_string());
    }
    Ok(session)
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ElyLogin {
    pub name: String,
    pub uuid: String,
    pub access_token: String,
    pub client_token: String,
    pub expires_at: i64,
}

fn ely_profile(body: &Value) -> Option<(String, String)> {
    let profile = body.get("selectedProfile")?;
    let id = profile.get("id")?.as_str()?.replace('-', "");
    let name = profile.get("name")?.as_str()?.to_string();
    let uuid = crate::store::uuid_dashed(&id);
    Some((uuid, name))
}

pub async fn ely_login(username: &str, password: &str) -> Result<ElyLogin> {
    let user = username.trim();
    if user.is_empty() || password.is_empty() {
        return Err(anyhow!("Nhập tên đăng nhập và mật khẩu ely.by."));
    }
    let client_token = uuid::Uuid::new_v4().to_string();
    let res = crate::net::client()
        .post(format!("{ELY_AUTH_SERVER}/auth/authenticate"))
        .json(&json!({
            "username": user,
            "password": password,
            "clientToken": client_token,
            "requestUser": true
        }))
        .send()
        .await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    let Some((uuid, name)) = ely_profile(&body) else {
        let message = match status.as_u16() {
            403 => "Sai tên đăng nhập hoặc mật khẩu ely.by.",
            400 => body
                .get("errorMessage")
                .and_then(Value::as_str)
                .unwrap_or("Thông tin đăng nhập ely.by không hợp lệ."),
            _ => "Đăng nhập ely.by thất bại.",
        };
        return Err(anyhow!("{message}"));
    };
    let access_token = body
        .get("accessToken")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("ely.by không trả về access token."))?
        .to_string();
    Ok(ElyLogin {
        name,
        uuid,
        access_token,
        client_token,
        expires_at: chrono::Utc::now().timestamp_millis() + 12 * 24 * 3600 * 1000,
    })
}

pub async fn ely_refresh(access_token: &str, client_token: &str) -> Result<ElyLogin> {
    let res = crate::net::client()
        .post(format!("{ELY_AUTH_SERVER}/auth/refresh"))
        .json(&json!({
            "accessToken": access_token,
            "clientToken": client_token,
            "requestUser": true
        }))
        .send()
        .await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    let Some((uuid, name)) = ely_profile(&body) else {
        return Err(anyhow!("Phiên ely.by đã hết hạn, hãy đăng nhập lại."));
    };
    let token = body
        .get("accessToken")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Phiên ely.by đã hết hạn, hãy đăng nhập lại."))?;
    if !status.is_success() {
        return Err(anyhow!("Phiên ely.by đã hết hạn, hãy đăng nhập lại."));
    }
    Ok(ElyLogin {
        name,
        uuid,
        access_token: token.to_string(),
        client_token: body
            .get("clientToken")
            .and_then(Value::as_str)
            .unwrap_or(client_token)
            .to_string(),
        expires_at: chrono::Utc::now().timestamp_millis() + 12 * 24 * 3600 * 1000,
    })
}

pub async fn ely_validate(access_token: &str, client_token: &str) -> bool {
    if access_token.is_empty() {
        return false;
    }
    let Ok(res) = crate::net::client()
        .post(format!("{ELY_AUTH_SERVER}/auth/validate"))
        .json(&json!({"accessToken": access_token, "clientToken": client_token}))
        .send()
        .await
    else {
        return false;
    };
    res.status().as_u16() == 204
}

pub async fn ensure_injector(store: &Store) -> Result<std::path::PathBuf> {
    let dir = store.data_dir.join("authlib-injector");
    let meta = crate::net::fetch_json(INJECTOR_META).await?;
    let version = meta
        .get("version")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Không đọc được thông tin authlib-injector."))?;
    let url = meta
        .get("download_url")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Không đọc được thông tin authlib-injector."))?;
    let _ = std::fs::create_dir_all(&dir);
    let target = dir.join(format!("authlib-injector-{version}.jar"));
    if target.metadata().map(|m| m.len() > 1024).unwrap_or(false) {
        return Ok(target);
    }
    crate::net::download_one(url, &target, None, std::sync::Arc::new(|_| {})).await?;
    Ok(target)
}

pub struct LaunchAuth {
    pub name: String,
    pub uuid: String,
    pub access_token: String,
    pub user_type: String,
    pub xuid: String,
    pub java_agent: Option<String>,
}

pub async fn auth_for(store: &Store, account: Option<&Account>) -> Result<LaunchAuth> {
    let Some(account) = account else {
        return Ok(LaunchAuth {
            name: "Player".into(),
            uuid: crate::store::offline_uuid("Player"),
            access_token: "0".into(),
            user_type: "legacy".into(),
            xuid: "0".into(),
            java_agent: None,
        });
    };
    if account.kind != "microsoft" && account.kind != "ely" {
        return Ok(LaunchAuth {
            name: account.name.clone(),
            uuid: account.uuid.clone(),
            access_token: "0".into(),
            user_type: "legacy".into(),
            xuid: "0".into(),
            java_agent: None,
        });
    }
    let stored = store.token(&account.id).unwrap_or(Value::Null);
    if account.kind == "microsoft" {
        let expires = stored.get("expiresAt").and_then(Value::as_i64).unwrap_or(0);
        let left = expires - chrono::Utc::now().timestamp_millis();
        if left > 5 * 60 * 1000 {
            if let Some(token) = stored.get("accessToken").and_then(Value::as_str) {
                return Ok(LaunchAuth {
                    name: stored
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or(&account.name)
                        .to_string(),
                    uuid: stored
                        .get("uuid")
                        .and_then(Value::as_str)
                        .unwrap_or(&account.uuid)
                        .to_string(),
                    access_token: token.to_string(),
                    user_type: "msa".into(),
                    xuid: stored
                        .get("xuid")
                        .and_then(Value::as_str)
                        .unwrap_or("0")
                        .to_string(),
                    java_agent: None,
                });
            }
        }
        let refresh = stored
            .get("refreshToken")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("Phiên Microsoft đã hết hạn. Hãy đăng nhập lại tài khoản này."))?;
        let session = ms_refresh(refresh).await?;
        store.set_token(&account.id, Some(serde_json::to_value(&session)?));
        return Ok(LaunchAuth {
            name: session.name,
            uuid: session.uuid,
            access_token: session.access_token,
            user_type: "msa".into(),
            xuid: session.xuid.unwrap_or_else(|| "0".into()),
            java_agent: None,
        });
    }

    let mut access = stored
        .get("accessToken")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut client_token = stored
        .get("clientToken")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut name = stored
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(&account.name)
        .to_string();
    let mut uuid = stored
        .get("uuid")
        .and_then(Value::as_str)
        .unwrap_or(&account.uuid)
        .to_string();
    if !ely_validate(&access, &client_token).await {
        if access.is_empty() {
            return Err(anyhow!("Phiên ely.by đã hết hạn, hãy đăng nhập lại."));
        }
        let session = ely_refresh(&access, &client_token).await?;
        store.set_token(&account.id, Some(serde_json::to_value(&session)?));
        access = session.access_token;
        client_token = session.client_token;
        name = session.name;
        uuid = session.uuid;
    }
    let injector = ensure_injector(store).await?;
    Ok(LaunchAuth {
        name,
        uuid,
        access_token: access,
        user_type: "mojang".into(),
        xuid: "0".into(),
        java_agent: Some(format!(
            "-javaagent:{}=https://authserver.ely.by/api/authlib-injector",
            injector.display()
        )),
    })
}
