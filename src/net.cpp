#include "net.h"
#include "fs.h"
#include "json.h"
#include <winhttp.h>
#include <bcrypt.h>
#include <wincrypt.h>
#include <vector>
#include <cstdio>
#include <cmath>

#pragma comment(lib, "winhttp")
#pragma comment(lib, "bcrypt")
#pragma comment(lib, "crypt32")

std::string url_encode(const std::string& value) {
    static const char* hex = "0123456789ABCDEF";
    std::string out;
    for (unsigned char c : value) {
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
            c == '-' || c == '_' || c == '.' || c == '~') {
            out.push_back(char(c));
        } else {
            out.push_back('%');
            out.push_back(hex[c >> 4]);
            out.push_back(hex[c & 0x0F]);
        }
    }
    return out;
}

static const char kB64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string base64_encode(const std::vector<unsigned char>& data) {
    std::string out;
    size_t i = 0;
    while (i + 2 < data.size()) {
        unsigned v = (unsigned(data[i]) << 16) | (unsigned(data[i + 1]) << 8) | data[i + 2];
        out.push_back(kB64[(v >> 18) & 63]);
        out.push_back(kB64[(v >> 12) & 63]);
        out.push_back(kB64[(v >> 6) & 63]);
        out.push_back(kB64[v & 63]);
        i += 3;
    }
    size_t left = data.size() - i;
    if (left == 1) {
        unsigned v = unsigned(data[i]) << 16;
        out.push_back(kB64[(v >> 18) & 63]);
        out.push_back(kB64[(v >> 12) & 63]);
        out += "==";
    } else if (left == 2) {
        unsigned v = (unsigned(data[i]) << 16) | (unsigned(data[i + 1]) << 8);
        out.push_back(kB64[(v >> 18) & 63]);
        out.push_back(kB64[(v >> 12) & 63]);
        out.push_back(kB64[(v >> 6) & 63]);
        out.push_back('=');
    }
    return out;
}

std::vector<unsigned char> base64_decode(const std::string& text) {
    std::vector<unsigned char> out;
    int val = 0, bits = 0;
    for (char c : text) {
        int d = -1;
        if (c >= 'A' && c <= 'Z') d = c - 'A';
        else if (c >= 'a' && c <= 'z') d = c - 'a' + 26;
        else if (c >= '0' && c <= '9') d = c - '0' + 52;
        else if (c == '+') d = 62;
        else if (c == '/') d = 63;
        else continue;
        val = (val << 6) | d;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back((unsigned char)((val >> bits) & 0xFF));
        }
    }
    return out;
}

HttpResult http_request(const std::wstring& url, const wchar_t* method,
                        const std::string& body, const wchar_t* content_type,
                        const std::vector<std::pair<std::wstring, std::wstring>>& headers) {
    HttpResult result;
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof(parts);
    wchar_t host[256]{};
    wchar_t path[4096]{};
    wchar_t extra[2048]{};
    parts.lpszHostName = host;
    parts.dwHostNameLength = 255;
    parts.lpszUrlPath = path;
    parts.dwUrlPathLength = 4095;
    parts.lpszExtraInfo = extra;
    parts.dwExtraInfoLength = 2047;
    if (!WinHttpCrackUrl(url.c_str(), (DWORD)url.size(), 0, &parts)) {
        result.error = "URL không hợp lệ";
        return result;
    }
    std::wstring target = path;
    target += extra;
    HINTERNET session = WinHttpOpen(L"XyoLauncher/2.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                    WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) {
        result.error = "Không tạo được WinHTTP";
        return result;
    }
    DWORD timeout = 20000;
    WinHttpSetTimeouts(session, timeout, timeout, timeout, timeout);
    DWORD redirect = WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS;
    WinHttpSetOption(session, WINHTTP_OPTION_REDIRECT_POLICY, &redirect, sizeof(redirect));
    HINTERNET connect = WinHttpConnect(session, host, parts.nPort, 0);
    HINTERNET request = connect ? WinHttpOpenRequest(connect, method, target.c_str(), nullptr,
                                                     WINHTTP_NO_REFERER,
                                                     WINHTTP_DEFAULT_ACCEPT_TYPES,
                                                     parts.nScheme == INTERNET_SCHEME_HTTPS
                                                         ? WINHTTP_FLAG_SECURE
                                                         : 0)
                                : nullptr;
    if (!request) {
        if (connect) WinHttpCloseHandle(connect);
        WinHttpCloseHandle(session);
        result.error = "Không kết nối được máy chủ";
        return result;
    }
    std::wstring all_headers = L"User-Agent: LunarSpaceLauncher/1.0\r\nAccept: application/json\r\n";
    if (content_type) all_headers += std::wstring(L"Content-Type: ") + content_type + L"\r\n";
    for (const auto& header : headers)
        all_headers += header.first + L": " + header.second + L"\r\n";
    BOOL sent = WinHttpSendRequest(
        request, all_headers.c_str(), (DWORD)all_headers.size(),
        body.empty() ? WINHTTP_NO_REQUEST_DATA : (LPVOID)body.data(), (DWORD)body.size(),
        (DWORD)body.size(), 0);
    if (sent) sent = WinHttpReceiveResponse(request, nullptr);
    if (!sent) {
        result.error = "Không gửi được yêu cầu mạng";
    } else {
        DWORD status = 0, size = sizeof(status);
        WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                            WINHTTP_HEADER_NAME_BY_INDEX, &status, &size,
                            WINHTTP_NO_HEADER_INDEX);
        result.status = int(status);
        DWORD available = 0;
        do {
            available = 0;
            if (!WinHttpQueryDataAvailable(request, &available)) break;
            if (available == 0) break;
            std::string chunk(available, '\0');
            DWORD read = 0;
            if (!WinHttpReadData(request, chunk.data(), available, &read)) break;
            chunk.resize(read);
            result.body += chunk;
        } while (available > 0);
    }
    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connect);
    WinHttpCloseHandle(session);
    return result;
}

DownloadResult http_download_file(const std::wstring& url, const std::wstring& dest_path,
                                  const std::function<bool(uint64_t, uint64_t)>& on_progress,
                                  int attempts) {
    DownloadResult result;
    std::wstring part = dest_path + L".part";
    dir_create_all(path_dirname(dest_path));
    int tries = attempts < 1 ? 1 : attempts;
    for (int attempt = 0; attempt < tries; ++attempt) {
        if (attempt > 0) Sleep(250 << attempt);
        result = {};
        URL_COMPONENTS parts{};
        parts.dwStructSize = sizeof(parts);
        wchar_t host[256]{};
        wchar_t path[4096]{};
        wchar_t extra[2048]{};
        parts.lpszHostName = host;
        parts.dwHostNameLength = 255;
        parts.lpszUrlPath = path;
        parts.dwUrlPathLength = 4095;
        parts.lpszExtraInfo = extra;
        parts.dwExtraInfoLength = 2047;
        if (!WinHttpCrackUrl(url.c_str(), (DWORD)url.size(), 0, &parts)) {
            result.error = "URL không hợp lệ";
            continue;
        }
        std::wstring target = path;
        target += extra;
        HINTERNET session = WinHttpOpen(L"LunarSpaceLauncher/1.0.0",
                                        WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
        if (!session) {
            result.error = "Không tạo được WinHTTP";
            continue;
        }
        WinHttpSetTimeouts(session, 15000, 20000, 60000, 60000);
        DWORD redirect = WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS;
        WinHttpSetOption(session, WINHTTP_OPTION_REDIRECT_POLICY, &redirect, sizeof(redirect));
        HINTERNET connect = WinHttpConnect(session, host, parts.nPort, 0);
        HINTERNET request =
            connect ? WinHttpOpenRequest(connect, L"GET", target.c_str(), nullptr,
                                         WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                         parts.nScheme == INTERNET_SCHEME_HTTPS
                                             ? WINHTTP_FLAG_SECURE
                                             : 0)
                    : nullptr;
        if (!request) {
            result.error = "Không kết nối được máy chủ";
            if (connect) WinHttpCloseHandle(connect);
            WinHttpCloseHandle(session);
            continue;
        }
        std::wstring headers = L"User-Agent: LunarSpaceLauncher/1.0.0\r\nAccept: */*\r\n";
        BOOL sent = WinHttpSendRequest(request, headers.c_str(), (DWORD)headers.size(),
                                       WINHTTP_NO_REQUEST_DATA, 0, 0, 0);
        if (sent) sent = WinHttpReceiveResponse(request, nullptr);
        if (!sent) {
            result.error = "Không tải được tệp";
        } else {
            DWORD status = 0, size = sizeof(status);
            WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                                WINHTTP_HEADER_NAME_BY_INDEX, &status, &size,
                                WINHTTP_NO_HEADER_INDEX);
            result.status = int(status);
            if (status < 200 || status >= 300) {
                result.error = "HTTP " + std::to_string(status);
            } else {
                uint64_t total = 0;
                DWORD total_len = sizeof(total);
                WinHttpQueryHeaders(request,
                                    WINHTTP_QUERY_CONTENT_LENGTH | WINHTTP_QUERY_FLAG_NUMBER,
                                    WINHTTP_HEADER_NAME_BY_INDEX, &total, &total_len,
                                    WINHTTP_NO_HEADER_INDEX);
                file_delete(part);
                HANDLE file = CreateFileW(part.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                                          FILE_ATTRIBUTE_NORMAL, nullptr);
                if (file == INVALID_HANDLE_VALUE) {
                    result.error = "Không ghi được tệp đích";
                } else {
                    bool aborted = false;
                    uint64_t done = 0;
                    for (;;) {
                        DWORD available = 0;
                        if (!WinHttpQueryDataAvailable(request, &available)) break;
                        if (available == 0) break;
                        std::vector<char> chunk(available);
                        DWORD read = 0;
                        if (!WinHttpReadData(request, chunk.data(), available, &read)) break;
                        if (read == 0) break;
                        DWORD written = 0;
                        if (!WriteFile(file, chunk.data(), read, &written, nullptr) ||
                            written != read)
                            break;
                        done += read;
                        if (on_progress && !on_progress(done, total)) {
                            aborted = true;
                            break;
                        }
                    }
                    CloseHandle(file);
                    if (aborted) {
                        result.error = "Đã hủy tải";
                    } else if (done == 0 && total > 0) {
                        result.error = "Tệp rỗng";
                    } else {
                        if (MoveFileExW(part.c_str(), dest_path.c_str(),
                                        MOVEFILE_REPLACE_EXISTING)) {
                            result.ok = true;
                            result.bytes = done;
                        } else {
                            result.error = "Không đổi tên được tệp";
                        }
                    }
                }
            }
        }
        WinHttpCloseHandle(request);
        WinHttpCloseHandle(connect);
        WinHttpCloseHandle(session);
        if (result.ok) break;
        file_delete(part);
    }
    return result;
}

std::wstring appdata_dir() {
    wchar_t dir[MAX_PATH]{};
    DWORD len = GetEnvironmentVariableW(L"APPDATA", dir, MAX_PATH);
    if (len > 0 && len < MAX_PATH) return std::wstring(dir, len);
    return L".";
}std::wstring user_data_dir() {
    std::wstring dir = appdata_dir() + L"\\xyolauncher";
    CreateDirectoryW(dir.c_str(), nullptr);
    return dir;
}

std::wstring engine_data_dir() {
    std::wstring dir = appdata_dir() + L"\\XyoLauncher+";
    CreateDirectoryW(dir.c_str(), nullptr);
    return dir;
}

std::string read_file_utf8(const std::wstring& path) {
    FILE* file = _wfopen(path.c_str(), L"rb");
    if (!file) return "";
    fseek(file, 0, SEEK_END);
    long size = ftell(file);
    fseek(file, 0, SEEK_SET);
    std::string out;
    if (size > 0) {
        out.resize(size_t(size));
        fread(out.data(), 1, out.size(), file);
    }
    fclose(file);
    return out;
}

bool write_file_utf8(const std::wstring& path, const std::string& text) {
    FILE* file = _wfopen(path.c_str(), L"wb");
    if (!file) return false;
    fwrite(text.data(), 1, text.size(), file);
    fclose(file);
    return true;
}

bool write_file_bytes(const std::wstring& path, const std::vector<unsigned char>& data) {
    FILE* file = _wfopen(path.c_str(), L"wb");
    if (!file) return false;
    if (!data.empty()) fwrite(data.data(), 1, data.size(), file);
    fclose(file);
    return true;
}

static std::vector<unsigned char> dpapi_unprotect(const std::vector<unsigned char>& data) {
    DATA_BLOB in{ (DWORD)data.size(), (BYTE*)data.data() };
    DATA_BLOB out{};
    if (!CryptUnprotectData(&in, nullptr, nullptr, nullptr, nullptr, 0, &out)) return {};
    std::vector<unsigned char> result(out.pbData, out.pbData + out.cbData);
    LocalFree(out.pbData);
    return result;
}

static std::vector<unsigned char> oscrypt_key() {
    static std::vector<unsigned char> key;
    static bool loaded = false;
    if (loaded) return key;
    loaded = true;
    std::string local = read_file_utf8(user_data_dir() + L"\\Local State");
    Json root;
    if (!root.parse(local)) return key;
    const Json* crypt = root.find("os_crypt");
    if (!crypt) return key;
    std::string encoded = crypt->text("encrypted_key");
    if (encoded.empty()) return key;
    std::vector<unsigned char> sealed = base64_decode(encoded);
    if (sealed.size() <= 5) return key;
    std::vector<unsigned char> blob(sealed.begin() + 5, sealed.end());
    key = dpapi_unprotect(blob);
    return key;
}

std::string oscrypt_decrypt(const std::string& sealed_base64) {
    std::vector<unsigned char> data = base64_decode(sealed_base64);
    if (data.size() < 3 || data[0] != 'v' || data[1] != '1' || data[2] != '0') {
        return std::string(data.begin(), data.end());
    }
    std::vector<unsigned char> key = oscrypt_key();
    if (key.size() != 32 || data.size() < 3 + 12 + 16) return "";
    const unsigned char* nonce = data.data() + 3;
    size_t ct_len = data.size() - 3 - 12 - 16;
    const unsigned char* cipher = nonce + 12;
    const unsigned char* tag = cipher + ct_len;
    BCRYPT_ALG_HANDLE alg = nullptr;
    if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_AES_ALGORITHM, nullptr, 0) != 0) return "";
    BCryptSetProperty(alg, BCRYPT_CHAINING_MODE, (PUCHAR)BCRYPT_CHAIN_MODE_GCM,
                      sizeof(BCRYPT_CHAIN_MODE_GCM), 0);
    BCRYPT_KEY_HANDLE handle = nullptr;
    if (BCryptGenerateSymmetricKey(alg, &handle, nullptr, 0, key.data(), (ULONG)key.size(), 0) != 0) {
        BCryptCloseAlgorithmProvider(alg, 0);
        return "";
    }
    BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info;
    BCRYPT_INIT_AUTH_MODE_INFO(info);
    info.pbNonce = (PUCHAR)nonce;
    info.cbNonce = 12;
    info.pbTag = (PUCHAR)tag;
    info.cbTag = 16;
    std::vector<unsigned char> plain(ct_len);
    ULONG done = 0;
    NTSTATUS status = BCryptDecrypt(handle, (PUCHAR)cipher, (ULONG)ct_len, &info, nullptr, 0,
                                    plain.data(), (ULONG)plain.size(), &done, 0);
    BCryptDestroyKey(handle);
    BCryptCloseAlgorithmProvider(alg, 0);
    if (status != 0) return "";
    return std::string(plain.begin(), plain.begin() + done);
}

std::string oscrypt_encrypt(const std::string& plain) {
    std::vector<unsigned char> key = oscrypt_key();
    std::vector<unsigned char> data;
    if (key.size() == 32) {
        unsigned char nonce[12]{};
        BCryptGenRandom(nullptr, nonce, 12, BCRYPT_USE_SYSTEM_PREFERRED_RNG);
        BCRYPT_ALG_HANDLE alg = nullptr;
        if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_AES_ALGORITHM, nullptr, 0) == 0) {
            BCryptSetProperty(alg, BCRYPT_CHAINING_MODE, (PUCHAR)BCRYPT_CHAIN_MODE_GCM,
                              sizeof(BCRYPT_CHAIN_MODE_GCM), 0);
            BCRYPT_KEY_HANDLE handle = nullptr;
            if (BCryptGenerateSymmetricKey(alg, &handle, nullptr, 0, key.data(), (ULONG)key.size(),
                                           0) == 0) {
                unsigned char tag[16]{};
                BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info;
                BCRYPT_INIT_AUTH_MODE_INFO(info);
                info.pbNonce = nonce;
                info.cbNonce = 12;
                info.pbTag = tag;
                info.cbTag = 16;
                std::vector<unsigned char> cipher(plain.size());
                ULONG done = 0;
                if (BCryptEncrypt(handle, (PUCHAR)plain.data(), (ULONG)plain.size(), &info,
                                  nullptr, 0, cipher.data(), (ULONG)cipher.size(), &done, 0) == 0) {
                    data.insert(data.end(), { 'v', '1', '0' });
                    data.insert(data.end(), nonce, nonce + 12);
                    data.insert(data.end(), cipher.begin(), cipher.begin() + done);
                    data.insert(data.end(), tag, tag + 16);
                }
                BCryptDestroyKey(handle);
            }
            BCryptCloseAlgorithmProvider(alg, 0);
        }
    }
    if (data.empty()) data.assign(plain.begin(), plain.end());
    return base64_encode(data);
}

std::string offline_uuid(const std::wstring& name) {
    std::string input = "OfflinePlayer:" + wide_to_utf8(name);
    BCRYPT_ALG_HANDLE alg = nullptr;
    unsigned char digest[16]{};
    if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_MD5_ALGORITHM, nullptr, 0) == 0) {
        BCRYPT_HASH_HANDLE hash = nullptr;
        if (BCryptCreateHash(alg, &hash, nullptr, 0, nullptr, 0, 0) == 0) {
            BCryptHashData(hash, (PUCHAR)input.data(), (ULONG)input.size(), 0);
            BCryptFinishHash(hash, digest, 16, 0);
            BCryptDestroyHash(hash);
        }
        BCryptCloseAlgorithmProvider(alg, 0);
    }
    digest[6] = (unsigned char)((digest[6] & 0x0F) | 0x30);
    digest[8] = (unsigned char)((digest[8] & 0x3F) | 0x80);
    char out[40];
    snprintf(out, sizeof(out),
             "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x", digest[0],
             digest[1], digest[2], digest[3], digest[4], digest[5], digest[6], digest[7],
             digest[8], digest[9], digest[10], digest[11], digest[12], digest[13], digest[14],
             digest[15]);
    return out;
}

std::wstring find_edge_exe() {
    const wchar_t* candidates[] = {
        L"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        L"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    };
    for (const wchar_t* path : candidates)
        if (GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES) return path;
    return L"";
}

std::wstring url_decode_w(const std::wstring& value) {
    std::string utf8 = wide_to_utf8(value);
    std::string out;
    for (size_t i = 0; i < utf8.size(); ++i) {
        if (utf8[i] == '%' && i + 2 < utf8.size()) {
            auto hex = [](char c) -> int {
                if (c >= '0' && c <= '9') return c - '0';
                if (c >= 'a' && c <= 'f') return c - 'a' + 10;
                if (c >= 'A' && c <= 'F') return c - 'A' + 10;
                return -1;
            };
            int hi = hex(utf8[i + 1]), lo = hex(utf8[i + 2]);
            if (hi >= 0 && lo >= 0) {
                out.push_back(char((hi << 4) | lo));
                i += 2;
                continue;
            }
        }
        out.push_back(utf8[i] == '+' ? ' ' : utf8[i]);
    }
    return utf8_to_wide(out);
}
