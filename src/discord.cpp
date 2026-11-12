#include "discord.h"
#include "json.h"
#include "net.h"
#include <winsock2.h>
#include <ws2tcpip.h>
#include <shellapi.h>
#include <bcrypt.h>
#include <vector>
#include <cstdio>
#include <cstring>
#include <cctype>
#include <cstdlib>

#pragma comment(lib, "bcrypt")
#pragma comment(lib, "ws2_32")

static HttpResult api_request(const std::wstring& base, const std::wstring& key,
                              const wchar_t* method, const wchar_t* path,
                              const std::string& body = "") {
    std::vector<std::pair<std::wstring, std::wstring>> headers{ { L"x-api-key", key } };
    return http_request(base + path, method, body,
                        body.empty() ? nullptr : L"application/json", headers);
}

static std::wstring random_state() {
    unsigned char data[16]{};
    BCryptGenRandom(nullptr, data, 16, BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    static const wchar_t* hex = L"0123456789abcdef";
    std::wstring out;
    for (unsigned char c : data) {
        out.push_back(hex[c >> 4]);
        out.push_back(hex[c & 15]);
    }
    return out;
}

static std::wstring sanitize_name(const std::wstring& raw) {
    std::wstring out;
    for (wchar_t c : raw) {
        if ((c >= L'a' && c <= L'z') || (c >= L'A' && c <= L'Z') ||
            (c >= L'0' && c <= L'9') || c == L'_')
            out.push_back(c);
        if (out.size() >= 16) break;
    }
    return out;
}

static const char* kPageHtml = R"HTML(<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Xác thực Discord</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0d12;color:#e6ebf2;font:16px/1.5 "Segoe UI",sans-serif}
.card{width:min(520px,calc(100vw - 40px));background:#171c24;border:1px solid #39434f;border-radius:16px;padding:24px;box-shadow:0 20px 50px -30px #000}
h1{font-size:15px;letter-spacing:.16em;text-transform:uppercase;margin:0 0 14px;color:#7ba3cc}
#s{color:#9fabb8;white-space:pre-wrap}
.ok{color:#7ad18a}.bad{color:#e5777a}
.muted{margin-top:14px;font-size:12px;color:#7b8794}
</style></head><body><main class="card"><h1>Xác thực Discord</h1><div id="s">Đang gửi thông tin uỷ quyền về launcher…</div><p class="muted">Có thể đóng tab này sau khi xác thực xong.</p></main>
<script>
const out=document.getElementById('s');
const hash=new URLSearchParams(location.hash.slice(1));
const query=new URLSearchParams(location.search);
const get=k=>hash.get(k)||query.get(k)||'';
const payload={access_token:get('access_token'),state:get('state'),error:get('error'),error_description:get('error_description')};
fetch('/discord/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
 .then(r=>r.json()).then(j=>{
   out.className=j.ok?'ok':'bad';
   out.textContent=j.ok?('Đã liên kết Discord'+(j.discord?(' · '+j.discord):'')+(j.account?('\nTài khoản: '+j.account):'')):('Không hoàn tất được: '+(j.error||'lỗi không xác định'));
 }).catch(e=>{out.className='bad';out.textContent='Không gửi được thông tin về launcher: '+e});
</script></body></html>)HTML";

static std::string read_request(SOCKET client, std::string& method, std::string& path,
                                std::string& body) {
    std::string data;
    char buffer[4096];
    size_t header_end = std::string::npos;
    while (data.size() < 65536) {
        int got = recv(client, buffer, sizeof(buffer), 0);
        if (got <= 0) return "";
        data.append(buffer, size_t(got));
        header_end = data.find("\r\n\r\n");
        if (header_end != std::string::npos) break;
    }
    if (header_end == std::string::npos) return "";
    std::string head = data.substr(0, header_end);
    size_t line_end = head.find("\r\n");
    std::string request_line = head.substr(0, line_end);
    size_t sp1 = request_line.find(' ');
    size_t sp2 = request_line.find(' ', sp1 + 1);
    method = request_line.substr(0, sp1);
    path = sp1 != std::string::npos
               ? request_line.substr(sp1 + 1, sp2 == std::string::npos ? std::string::npos
                                                                       : sp2 - sp1 - 1)
               : "";
    size_t length = 0;
    size_t pos = 0;
    while ((pos = head.find("\r\n", pos)) != std::string::npos) {
        size_t start = pos + 2;
        size_t end = head.find("\r\n", start);
        std::string line = head.substr(start, end == std::string::npos ? std::string::npos
                                                                      : end - start);
        size_t colon = line.find(':');
        if (colon != std::string::npos) {
            std::string name = line.substr(0, colon);
            for (char& c : name) c = char(tolower((unsigned char)c));
            if (name == "content-length") length = size_t(atoi(line.c_str() + colon + 1));
        }
        if (end == std::string::npos) break;
        pos = end;
    }
    body = data.substr(header_end + 4);
    while (body.size() < length) {
        int got = recv(client, buffer, sizeof(buffer), 0);
        if (got <= 0) break;
        body.append(buffer, size_t(got));
    }
    return data;
}

static void send_all(SOCKET client, const std::string& response) {
    size_t sent = 0;
    while (sent < response.size()) {
        int n = send(client, response.data() + sent, int(response.size() - sent), 0);
        if (n <= 0) break;
        sent += size_t(n);
    }
}

static void send_json(SOCKET client, const Json& value) {
    std::string body = value.dump(0);
    std::string head = "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n"
                       "Content-Length: " + std::to_string(body.size()) +
                       "\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n";
    send_all(client, head + body);
}

DiscordResult discord_link_flow(const std::wstring& api_url, const std::wstring& api_key,
                                const std::wstring& name, const std::wstring& account_id,
                                const std::wstring& account_uuid) {
    DiscordResult result;
    HttpResult config = api_request(api_url, api_key, L"GET", L"/api/config");
    Json cfg;
    cfg.parse(config.body);
    std::string authorize = cfg.text("authorizeUrl");
    std::string mode = cfg.text("mode", "hosted");
    int port = int(cfg.number("loopbackPort", 53682));
    if (authorize.empty()) {
        result.error = L"Bot Discord chưa cấu hình liên kết uỷ quyền.";
        return result;
    }
    if (mode != "loopback") {
        result.error = L"Bot Discord đang ở chế độ chưa hỗ trợ.";
        return result;
    }
    std::wstring state = random_state();
    std::string state_utf8 = wide_to_utf8(state);
    size_t placeholder = authorize.find("{state}");
    if (placeholder != std::string::npos) authorize.replace(placeholder, 7, state_utf8);

    WSADATA wsa{};
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        result.error = L"Không khởi tạo được kết nối mạng.";
        return result;
    }
    SOCKET server = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons((unsigned short)port);
    if (server == INVALID_SOCKET || bind(server, (sockaddr*)&addr, sizeof(addr)) != 0 ||
        listen(server, 4) != 0) {
        if (server != INVALID_SOCKET) closesocket(server);
        WSACleanup();
        result.error = L"Không mở được cổng nhận uỷ quyền Discord (cổng " +
                       std::to_wstring(port) + L" đang bị chiếm).";
        return result;
    }
    ShellExecuteW(nullptr, L"open", utf8_to_wide(authorize).c_str(), nullptr, nullptr,
                  SW_SHOWNORMAL);

    std::wstring account_name = sanitize_name(name);
    std::wstring uuid = account_uuid.empty()
                            ? utf8_to_wide(offline_uuid(account_name.empty() ? L"Player" : account_name))
                            : account_uuid;
    std::wstring acc_id = account_id.empty() ? L"off-" + uuid.substr(0, 8) : account_id;
    bool created = account_id.empty();

    ULONGLONG deadline = GetTickCount64() + 300000;
    bool finished = false;
    while (!finished && GetTickCount64() < deadline) {
        fd_set set;
        FD_ZERO(&set);
        FD_SET(server, &set);
        timeval timeout{ 1, 0 };
        int ready = select(0, &set, nullptr, nullptr, &timeout);
        if (ready <= 0) continue;
        SOCKET client = accept(server, nullptr, nullptr);
        if (client == INVALID_SOCKET) continue;
        std::string method, path, body;
        read_request(client, method, path, body);
        if (method == "GET") {
            std::string response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n"
                                   "Content-Length: " + std::to_string(strlen(kPageHtml)) +
                                   "\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n" +
                                   std::string(kPageHtml);
            send_all(client, response);
            closesocket(client);
            continue;
        }
        Json payload;
        payload.parse(body);
        std::string token = payload.text("access_token");
        std::string returned_state = payload.text("state");
        std::string oauth_error = payload.text("error");
        Json reply = Json::object();
        if (!oauth_error.empty()) {
            result.error = oauth_error == "access_denied" ? L"Đã huỷ uỷ quyền Discord."
                                                          : L"Discord báo lỗi: " + utf8_to_wide(oauth_error);
            reply.set("ok", Json::boolean(false));
            reply.set("error", Json::string(wide_to_utf8(result.error)));
            send_json(client, reply);
            closesocket(client);
            finished = true;
            break;
        }
        if (token.empty() || (!returned_state.empty() && returned_state != state_utf8)) {
            result.error = L"Phiên liên kết Discord không khớp. Hãy bắt đầu lại.";
            reply.set("ok", Json::boolean(false));
            reply.set("error", Json::string(wide_to_utf8(result.error)));
            send_json(client, reply);
            closesocket(client);
            finished = true;
            break;
        }
        Json account = Json::object();
        account.set("id", Json::string(wide_to_utf8(acc_id)));
        account.set("name", Json::string(wide_to_utf8(account_name)));
        account.set("uuid", Json::string(wide_to_utf8(uuid)));
        account.set("type", Json::string("offline"));
        Json link_body = Json::object();
        link_body.set("token", Json::string(token));
        link_body.set("name", Json::string(""));
        link_body.set("force", Json::boolean(false));
        link_body.set("account", std::move(account));
        HttpResult link_res = api_request(api_url, api_key, L"POST", L"/api/link",
                                          link_body.dump(0));
        Json link_json;
        link_json.parse(link_res.body);
        if (link_json.boolean("ok", false)) {
            const Json* link = link_json.find("link");
            result.ok = true;
            result.name = account_name;
            result.uuid = uuid;
            result.account_id = acc_id;
            result.created = created;
            if (link) {
                result.discord_name = utf8_to_wide(link->text("discordName"));
                result.discord_tag = utf8_to_wide(link->text("discordTag"));
                result.discord_avatar = utf8_to_wide(link->text("discordAvatar"));
                result.link_id = utf8_to_wide(link->text("id"));
                if (!link->text("accountName").empty())
                    result.name = utf8_to_wide(link->text("accountName"));
            }
            reply.set("ok", Json::boolean(true));
            reply.set("discord", Json::string(
                                     wide_to_utf8(result.discord_tag.empty() ? result.discord_name
                                                                            : result.discord_tag)));
            reply.set("account", Json::string(wide_to_utf8(result.name)));
        } else {
            result.error = utf8_to_wide(link_json.text("error", "Không liên kết được Discord."));
            reply.set("ok", Json::boolean(false));
            reply.set("error", Json::string(wide_to_utf8(result.error)));
        }
        send_json(client, reply);
        closesocket(client);
        finished = true;
    }
    closesocket(server);
    WSACleanup();
    if (!finished) result.error = L"Hết thời gian chờ xác thực Discord.";
    return result;
}

std::string discord_links_body(const std::wstring& api_url, const std::wstring& api_key) {
    HttpResult res = api_request(api_url, api_key, L"GET", L"/api/links");
    return res.body;
}

bool discord_unlink(const std::wstring& api_url, const std::wstring& api_key,
                    const std::wstring& link_id, std::wstring* error) {
    HttpResult res = api_request(api_url, api_key, L"DELETE",
                                 utf8_to_wide("/api/link/" + wide_to_utf8(link_id)).c_str());
    Json body;
    body.parse(res.body);
    if (!res.ok() || !body.boolean("ok", res.status == 200)) {
        if (error) *error = utf8_to_wide(body.text("error", "Không bỏ liên kết được Discord."));
        return false;
    }
    return true;
}
