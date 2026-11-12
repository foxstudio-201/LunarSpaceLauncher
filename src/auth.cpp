#include "auth.h"
#include "net.h"
#include <winsock2.h>
#include <ws2tcpip.h>
#include <bcrypt.h>
#include <chrono>
#include <vector>
#include <cstdio>

#pragma comment(lib, "bcrypt")

static const wchar_t* kMsClientId = L"00000000402b5328";
static const wchar_t* kMsRedirect = L"https://login.live.com/oauth20_desktop.srf";
static const char* kMsScope = "XboxLive.signin offline_access";
static const wchar_t* kMsAuthUrl = L"https://login.live.com/oauth20_authorize.srf";
static const wchar_t* kMsTokenUrl = L"https://login.live.com/oauth20_token.srf";
static const char* kElyServer = "https://authserver.ely.by";

static long long now_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

static std::wstring random_hex(size_t bytes) {
    std::vector<unsigned char> data(bytes);
    BCryptGenRandom(nullptr, data.data(), (ULONG)data.size(), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    static const wchar_t* hex = L"0123456789abcdef";
    std::wstring out;
    for (unsigned char c : data) {
        out.push_back(hex[c >> 4]);
        out.push_back(hex[c & 15]);
    }
    return out;
}

static std::wstring random_uuid() {
    std::vector<unsigned char> data(16);
    BCryptGenRandom(nullptr, data.data(), 16, BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    data[6] = (unsigned char)((data[6] & 0x0F) | 0x40);
    data[8] = (unsigned char)((data[8] & 0x3F) | 0x80);
    wchar_t out[40];
    swprintf(out, 40,
             L"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
             data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7], data[8],
             data[9], data[10], data[11], data[12], data[13], data[14], data[15]);
    return out;
}

static std::string form_body(const std::vector<std::pair<std::string, std::string>>& fields) {
    std::string out;
    for (size_t i = 0; i < fields.size(); ++i) {
        if (i) out += '&';
        out += url_encode(fields[i].first);
        out += '=';
        out += url_encode(fields[i].second);
    }
    return out;
}

static std::string get_query_value(const std::wstring& url, const wchar_t* key) {
    size_t start = url.find(L'?');
    if (start == std::wstring::npos) return "";
    size_t end = url.find(L'#', start);
    std::wstring query = url.substr(start + 1, end == std::wstring::npos ? std::wstring::npos
                                                                       : end - start - 1);
    std::wstring needle = std::wstring(key) + L"=";
    size_t pos = query.find(needle);
    if (pos == std::wstring::npos) return "";
    pos += needle.size();
    size_t amp = query.find(L'&', pos);
    std::wstring value = query.substr(pos, amp == std::wstring::npos ? std::wstring::npos
                                                                     : amp - pos);
    return wide_to_utf8(url_decode_w(value));
}

static unsigned short free_port() {
    WSADATA wsa{};
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return 0;
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    unsigned short port = 0;
    if (s != INVALID_SOCKET) {
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        addr.sin_port = 0;
        if (bind(s, (sockaddr*)&addr, sizeof(addr)) == 0) {
            int len = sizeof(addr);
            if (getsockname(s, (sockaddr*)&addr, &len) == 0) port = ntohs(addr.sin_port);
        }
        closesocket(s);
    }
    WSACleanup();
    return port;
}

static bool process_alive(HANDLE process) {
    DWORD code = 0;
    return GetExitCodeProcess(process, &code) && code == STILL_ACTIVE;
}

static AuthSession microsoft_oauth_code() {
    AuthSession result;
    std::wstring edge = find_edge_exe();
    if (edge.empty()) {
        result.error = L"Không tìm thấy Microsoft Edge để đăng nhập.";
        return result;
    }
    unsigned short port = free_port();
    if (!port) {
        result.error = L"Không mở được cổng đăng nhập cục bộ.";
        return result;
    }
    std::wstring state = random_hex(16);
    std::wstring url = std::wstring(kMsAuthUrl) + L"?client_id=" + kMsClientId +
                       L"&response_type=code&redirect_uri=" + std::wstring(kMsRedirect) +
                       L"&scope=" + utf8_to_wide(kMsScope) + L"&state=" + state +
                       L"&prompt=select_account";
    std::wstring profile = engine_data_dir() + L"\\ms-login";
    CreateDirectoryW(profile.c_str(), nullptr);
    std::wstring cmd = L"\"" + edge + L"\" --app=\"" + url + L"\" --user-data-dir=\"" + profile +
                       L"\" --remote-debugging-port=" + std::to_wstring(port) +
                       L" --no-first-run --no-default-browser-check --disable-extensions"
                       L" --disable-sync";
    STARTUPINFOW si{};
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi{};
    std::vector<wchar_t> mutable_cmd(cmd.begin(), cmd.end());
    mutable_cmd.push_back(0);
    if (!CreateProcessW(nullptr, mutable_cmd.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr,
                        &si, &pi)) {
        result.error = L"Không mở được cửa sổ đăng nhập Microsoft.";
        return result;
    }
    std::wstring cdp = L"http://127.0.0.1:" + std::to_wstring(port) + L"/json/list";
    ULONGLONG deadline = GetTickCount64() + 180000;
    std::string code;
    std::string error;
    while (GetTickCount64() < deadline) {
        Sleep(300);
        HttpResult list = http_request(cdp, L"GET");
        if (!list.ok() || list.status != 200) {
            if (!process_alive(pi.hProcess)) break;
            continue;
        }
        Json targets;
        if (!targets.parse(list.body)) continue;
        for (const auto& target : targets.arr) {
            if (target.type != Json::Type::Object) continue;
            std::wstring target_url = utf8_to_wide(target.text("url"));
            if (target_url.rfind(kMsRedirect, 0) != 0) continue;
            code = get_query_value(target_url, L"code");
            error = get_query_value(target_url, L"error_description");
            if (error.empty()) error = get_query_value(target_url, L"error");
            std::string returned = get_query_value(target_url, L"state");
            if (!code.empty() && returned == wide_to_utf8(state)) {
                result.ok = true;
                result.access_token = utf8_to_wide(code);
            } else if (!error.empty()) {
                result.ok = false;
                result.error = utf8_to_wide(error);
            }
            break;
        }
        if (!code.empty() || !error.empty()) break;
    }
    if (!result.ok) {
        if (!process_alive(pi.hProcess) && code.empty() && error.empty())
            result.error = L"Bạn đã đóng cửa sổ đăng nhập Microsoft.";
        else if (result.error.empty())
            result.error = L"Hết thời gian chờ đăng nhập Microsoft.";
    }
    TerminateProcess(pi.hProcess, 0);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return result;
}

static bool ms_post_json(const std::wstring& url, const std::string& body, Json& out) {
    HttpResult res = http_request(url, L"POST", body, L"application/json");
    if (!res.ok()) return false;
    out.parse(res.body);
    return true;
}

static AuthSession microsoft_build_session(const std::string& ms_access,
                                           const std::string& refresh_token) {
    AuthSession session;
    Json xbl_body = Json::object();
    Json props = Json::object();
    props.set("AuthMethod", Json::string("RPS"));
    props.set("SiteName", Json::string("user.auth.xboxlive.com"));
    props.set("RpsTicket", Json::string("d=" + ms_access));
    xbl_body.set("Properties", std::move(props));
    xbl_body.set("RelyingParty", Json::string("http://auth.xboxlive.com"));
    xbl_body.set("TokenType", Json::string("JWT"));
    Json xbl;
    if (!ms_post_json(L"https://user.auth.xboxlive.com/user/authenticate", xbl_body.dump(0), xbl) ||
        xbl.text("Token").empty()) {
        session.error = L"Xác thực Xbox Live thất bại.";
        return session;
    }
    const Json* xui = nullptr;
    if (const Json* claims = xbl.find("DisplayClaims")) xui = claims->find("xui");
    std::string uhs;
    if (xui && !xui->arr.empty()) uhs = xui->arr[0].text("uhs");

    Json xsts_body = Json::object();
    Json xsts_props = Json::object();
    xsts_props.set("SandboxId", Json::string("RETAIL"));
    Json tokens = Json::array();
    tokens.arr.push_back(Json::string(xbl.text("Token")));
    xsts_props.set("UserTokens", std::move(tokens));
    xsts_body.set("Properties", std::move(xsts_props));
    xsts_body.set("RelyingParty", Json::string("rp://api.minecraftservices.com/"));
    xsts_body.set("TokenType", Json::string("JWT"));
    Json xsts;
    HttpResult xsts_res = http_request(L"https://xsts.auth.xboxlive.com/xsts/authorize", L"POST",
                                       xsts_body.dump(0), L"application/json");
    xsts.parse(xsts_res.body);
    if (xsts_res.status == 401) {
        long long code = (long long)xsts.number("XErr");
        if (code == 2148916233) session.error = L"Tài khoản Microsoft này chưa có Xbox Live. Hãy tạo tại xbox.com rồi thử lại.";
        else if (code == 2148916235) session.error = L"Xbox Live không khả dụng ở quốc gia của tài khoản này.";
        else if (code == 2148916238) session.error = L"Tài khoản trẻ em cần phụ huynh xác nhận trong gia đình Microsoft.";
        else session.error = L"Xác thực XSTS thất bại.";
        return session;
    }
    const Json* xsts_claims = xsts.find("DisplayClaims");
    const Json* xsts_xui = xsts_claims ? xsts_claims->find("xui") : nullptr;
    std::string xuid;
    if (xsts_xui && !xsts_xui->arr.empty()) xuid = xsts_xui->arr[0].text("xid");
    if (xsts.text("Token").empty() || uhs.empty()) {
        session.error = L"Xác thực XSTS thất bại.";
        return session;
    }
    Json mc_body = Json::object();
    mc_body.set("identityToken", Json::string("XBL3.0 x=" + uhs + ";" + xsts.text("Token")));
    Json mc;
    if (!ms_post_json(L"https://api.minecraftservices.com/authentication/login_with_xbox",
                      mc_body.dump(0), mc)) {
        session.error = L"Đăng nhập Minecraft thất bại.";
        return session;
    }
    std::string mc_token = mc.text("access_token");
    if (mc_token.empty()) {
        session.error = L"Đăng nhập Minecraft thất bại.";
        return session;
    }
    HttpResult profile_res = http_request(
        L"https://api.minecraftservices.com/minecraft/profile", L"GET", "", nullptr,
        { { L"Authorization", L"Bearer " + utf8_to_wide(mc_token) } });
    Json profile;
    profile.parse(profile_res.body);
    std::string id = profile.text("id");
    std::string name = profile.text("name");
    if (id.empty() || name.empty()) {
        session.error = profile_res.status == 404
                            ? L"Tài khoản này chưa sở hữu Minecraft Java Edition."
                            : L"Không đọc được hồ sơ Minecraft.";
        return session;
    }
    std::string uuid = id.substr(0, 8) + "-" + id.substr(8, 4) + "-" + id.substr(12, 4) + "-" +
                       id.substr(16, 4) + "-" + id.substr(20);
    long long expires = now_ms() + (long long)(mc.number("expires_in", 86400) * 1000.0);
    session.ok = true;
    session.name = utf8_to_wide(name);
    session.uuid = utf8_to_wide(uuid);
    session.xuid = utf8_to_wide(xuid);
    session.access_token = utf8_to_wide(mc_token);
    session.refresh_token = utf8_to_wide(refresh_token);
    session.expires_at = expires;
    Json token = Json::object();
    token.set("name", Json::string(name));
    token.set("uuid", Json::string(uuid));
    token.set("xuid", Json::string(xuid));
    token.set("accessToken", Json::string(mc_token));
    token.set("expiresAt", Json::number(double(expires)));
    token.set("refreshToken", Json::string(refresh_token));
    session.token_json = token.dump(0);
    return session;
}

AuthSession microsoft_login() {
    AuthSession code = microsoft_oauth_code();
    if (!code.ok) return code;
    if (!code.error.empty()) { AuthSession fail; fail.error = code.error; return fail; }
    std::string body = form_body({ { "client_id", wide_to_utf8(kMsClientId) },
                                   { "code", wide_to_utf8(code.access_token) },
                                   { "grant_type", "authorization_code" },
                                   { "redirect_uri", wide_to_utf8(kMsRedirect) },
                                   { "scope", kMsScope } });
    HttpResult res = http_request(kMsTokenUrl, L"POST", body,
                                  L"application/x-www-form-urlencoded");
    Json token;
    token.parse(res.body);
    std::string access = token.text("access_token");
    std::string refresh = token.text("refresh_token");
    if (access.empty()) {
        AuthSession fail;
        fail.error = utf8_to_wide(token.text("error_description", token.text("error", "Đổi mã đăng nhập thất bại.")));
        return fail;
    }
    return microsoft_build_session(access, refresh);
}

AuthSession microsoft_refresh(const std::wstring& refresh_token) {
    AuthSession fail;
    if (refresh_token.empty()) {
        fail.error = L"Phiên Microsoft đã hết hạn. Hãy đăng nhập lại.";
        return fail;
    }
    std::string body = form_body({ { "client_id", wide_to_utf8(kMsClientId) },
                                   { "grant_type", "refresh_token" },
                                   { "refresh_token", wide_to_utf8(refresh_token) },
                                   { "scope", kMsScope } });
    HttpResult res = http_request(kMsTokenUrl, L"POST", body,
                                  L"application/x-www-form-urlencoded");
    Json token;
    token.parse(res.body);
    std::string access = token.text("access_token");
    if (access.empty()) {
        fail.error = utf8_to_wide(token.text("error_description", token.text("error", "Làm mới token Microsoft thất bại.")));
        return fail;
    }
    std::string next = token.text("refresh_token", wide_to_utf8(refresh_token));
    return microsoft_build_session(access, next);
}

static std::string ely_profile_uuid(const std::string& id) {
    std::string raw;
    for (char c : id)
        if (c != '-') raw.push_back(c);
    if (raw.size() != 32) return id;
    return raw.substr(0, 8) + "-" + raw.substr(8, 4) + "-" + raw.substr(12, 4) + "-" +
           raw.substr(16, 4) + "-" + raw.substr(20);
}

static std::wstring ely_error(int status, const Json& body, const wchar_t* fallback) {
    std::string code = body.text("error");
    if (code == "ForbiddenOperationException" || status == 403)
        return L"Sai tên đăng nhập hoặc mật khẩu ely.by.";
    if (code == "IllegalArgumentException" || status == 400)
        return utf8_to_wide(body.text("errorMessage", "Thông tin đăng nhập ely.by không hợp lệ."));
    std::string message = body.text("errorMessage");
    return message.empty() ? fallback : utf8_to_wide(message);
}

static AuthSession ely_session_from(const Json& body, const std::string& access,
                                    const std::string& client, long long expires) {
    AuthSession session;
    const Json* profile = body.find("selectedProfile");
    if (!profile) {
        session.error = L"Đăng nhập ely.by thất bại.";
        return session;
    }
    std::string id = profile->text("id");
    std::string name = profile->text("name");
    if (id.empty() || name.empty()) {
        session.error = L"Đăng nhập ely.by thất bại.";
        return session;
    }
    std::string uuid = ely_profile_uuid(id);
    session.ok = true;
    session.name = utf8_to_wide(name);
    session.uuid = utf8_to_wide(uuid);
    session.access_token = utf8_to_wide(access);
    session.client_token = utf8_to_wide(client);
    session.expires_at = expires;
    Json token = Json::object();
    token.set("name", Json::string(name));
    token.set("uuid", Json::string(uuid));
    token.set("accessToken", Json::string(access));
    token.set("clientToken", Json::string(client));
    token.set("expiresAt", Json::number(double(expires)));
    session.token_json = token.dump(0);
    return session;
}

AuthSession ely_login(const std::wstring& username, const std::wstring& password) {
    AuthSession fail;
    std::wstring user = username;
    while (!user.empty() && iswspace(user.front())) user.erase(user.begin());
    while (!user.empty() && iswspace(user.back())) user.pop_back();
    if (user.empty() || password.empty()) {
        fail.error = L"Nhập tên đăng nhập và mật khẩu ely.by.";
        return fail;
    }
    std::string client = wide_to_utf8(random_uuid());
    Json body = Json::object();
    body.set("username", Json::string(wide_to_utf8(user)));
    body.set("password", Json::string(wide_to_utf8(password)));
    body.set("clientToken", Json::string(client));
    body.set("requestUser", Json::boolean(true));
    HttpResult res = http_request(utf8_to_wide(std::string(kElyServer) + "/auth/authenticate"),
                                  L"POST", body.dump(0), L"application/json");
    Json parsed;
    parsed.parse(res.body);
    std::string access = parsed.text("accessToken");
    if (!res.ok() || res.status != 200 || access.empty()) {
        fail.error = ely_error(res.status, parsed, L"Không kết nối được tới ely.by.");
        return fail;
    }
    std::string token_client = parsed.text("clientToken", client);
    return ely_session_from(parsed, access, token_client, now_ms() + 12LL * 24 * 3600 * 1000);
}

AuthSession ely_refresh(const std::wstring& access_token, const std::wstring& client_token) {
    AuthSession fail;
    if (access_token.empty()) {
        fail.error = L"Phiên ely.by đã hết hạn, hãy đăng nhập lại.";
        return fail;
    }
    Json body = Json::object();
    body.set("accessToken", Json::string(wide_to_utf8(access_token)));
    body.set("clientToken", Json::string(wide_to_utf8(client_token)));
    body.set("requestUser", Json::boolean(true));
    HttpResult res = http_request(utf8_to_wide(std::string(kElyServer) + "/auth/refresh"), L"POST",
                                  body.dump(0), L"application/json");
    Json parsed;
    parsed.parse(res.body);
    std::string access = parsed.text("accessToken");
    if (!res.ok() || res.status != 200 || access.empty()) {
        fail.error = ely_error(res.status, parsed, L"Phiên ely.by đã hết hạn, hãy đăng nhập lại.");
        return fail;
    }
    std::string client = parsed.text("clientToken", wide_to_utf8(client_token));
    return ely_session_from(parsed, access, client, now_ms() + 12LL * 24 * 3600 * 1000);
}

bool ely_validate(const std::wstring& access_token, const std::wstring& client_token) {
    if (access_token.empty()) return false;
    Json body = Json::object();
    body.set("accessToken", Json::string(wide_to_utf8(access_token)));
    body.set("clientToken", Json::string(wide_to_utf8(client_token)));
    HttpResult res = http_request(utf8_to_wide(std::string(kElyServer) + "/auth/validate"),
                                  L"POST", body.dump(0), L"application/json");
    return res.ok() && res.status == 204;
}

std::wstring ensure_ely_injector(std::wstring* error) {
    HttpResult meta_res = http_request(L"https://authlib-injector.yushi.moe/artifact/latest.json",
                                       L"GET");
    Json meta;
    meta.parse(meta_res.body);
    std::string version = meta.text("version");
    std::string url = meta.text("download_url");
    if (version.empty() || url.empty()) {
        if (error) *error = L"Không đọc được thông tin authlib-injector.";
        return L"";
    }
    std::wstring dir = user_data_dir() + L"\\authlib-injector";
    CreateDirectoryW(dir.c_str(), nullptr);
    std::wstring target = dir + L"\\authlib-injector-" + utf8_to_wide(version) + L".jar";
    WIN32_FILE_ATTRIBUTE_DATA info{};
    if (GetFileAttributesExW(target.c_str(), GetFileExInfoStandard, &info) &&
        info.nFileSizeLow > 1024)
        return target;
    HttpResult download = http_request(utf8_to_wide(url), L"GET");
    if (!download.ok() || download.status != 200 || download.body.size() <= 1024) {
        if (error) *error = L"Không tải được authlib-injector.";
        return L"";
    }
    std::vector<unsigned char> bytes(download.body.begin(), download.body.end());
    if (!write_file_bytes(target, bytes)) {
        if (error) *error = L"Không lưu được authlib-injector.";
        return L"";
    }
    return target;
}
