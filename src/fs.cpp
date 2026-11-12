#include "fs.h"
#include "net.h"
#include <bcrypt.h>
#include <shlobj.h>
#include <algorithm>
#include <cstdio>
#include <cwctype>

#pragma comment(lib, "bcrypt")
#pragma comment(lib, "shell32")

std::wstring path_join(const std::wstring& a, const std::wstring& b) {
    if (a.empty()) return b;
    if (b.empty()) return a;
    wchar_t last = a.back();
    if (last == L'\\' || last == L'/') return a + b;
    return a + L"\\" + b;
}

std::wstring path_dirname(const std::wstring& p) {
    size_t pos = p.find_last_of(L"\\/");
    if (pos == std::wstring::npos) return L"";
    return p.substr(0, pos);
}

std::wstring path_basename(const std::wstring& p) {
    size_t pos = p.find_last_of(L"\\/");
    if (pos == std::wstring::npos) return p;
    return p.substr(pos + 1);
}

std::wstring path_ext_lower(const std::wstring& p) {
    size_t slash = p.find_last_of(L"\\/");
    size_t dot = p.find_last_of(L'.');
    if (dot == std::wstring::npos || (slash != std::wstring::npos && dot < slash)) return L"";
    std::wstring ext = p.substr(dot);
    for (auto& c : ext) c = (wchar_t)towlower(c);
    return ext;
}

std::wstring path_norm(const std::wstring& p) {
    std::wstring out = p;
    for (auto& c : out)
        if (c == L'/') c = L'\\';
    while (out.size() > 3 && out.back() == L'\\') out.pop_back();
    return out;
}

bool path_exists(const std::wstring& p) {
    return GetFileAttributesW(p.c_str()) != INVALID_FILE_ATTRIBUTES;
}

bool path_is_dir(const std::wstring& p) {
    DWORD attrs = GetFileAttributesW(p.c_str());
    return attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY);
}

bool dir_create_all(const std::wstring& p) {
    if (p.empty()) return false;
    if (path_is_dir(p)) return true;
    std::wstring parent = path_dirname(p);
    if (!parent.empty() && parent != p && !path_is_dir(parent)) dir_create_all(parent);
    if (CreateDirectoryW(p.c_str(), nullptr)) return true;
    return GetLastError() == ERROR_ALREADY_EXISTS;
}

bool file_delete(const std::wstring& p) {
    if (DeleteFileW(p.c_str())) return true;
    SetFileAttributesW(p.c_str(), FILE_ATTRIBUTE_NORMAL);
    return DeleteFileW(p.c_str()) != FALSE;
}

bool dir_delete_recursive(const std::wstring& p) {
    if (!path_is_dir(p)) return true;
    std::wstring pattern = path_join(p, L"*");
    WIN32_FIND_DATAW fd{};
    HANDLE h = FindFirstFileW(pattern.c_str(), &fd);
    if (h != INVALID_HANDLE_VALUE) {
        do {
            std::wstring name = fd.cFileName;
            if (name == L"." || name == L"..") continue;
            std::wstring full = path_join(p, name);
            if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
                dir_delete_recursive(full);
            } else {
                SetFileAttributesW(full.c_str(), FILE_ATTRIBUTE_NORMAL);
                file_delete(full);
            }
        } while (FindNextFileW(h, &fd));
        FindClose(h);
    }
    return RemoveDirectoryW(p.c_str()) != FALSE;
}

bool file_move_replace(const std::wstring& from, const std::wstring& to) {
    dir_create_all(path_dirname(to));
    return MoveFileExW(from.c_str(), to.c_str(), MOVEFILE_REPLACE_EXISTING) != FALSE;
}

bool file_copy(const std::wstring& from, const std::wstring& to) {
    dir_create_all(path_dirname(to));
    return CopyFileW(from.c_str(), to.c_str(), FALSE) != FALSE;
}

uint64_t file_size(const std::wstring& p) {
    WIN32_FILE_ATTRIBUTE_DATA fd{};
    if (!GetFileAttributesExW(p.c_str(), GetFileExInfoStandard, &fd)) return 0;
    return (uint64_t(fd.nFileSizeHigh) << 32) | fd.nFileSizeLow;
}

int64_t file_mtime_ms(const std::wstring& p) {
    WIN32_FILE_ATTRIBUTE_DATA fd{};
    if (!GetFileAttributesExW(p.c_str(), GetFileExInfoStandard, &fd)) return 0;
    ULARGE_INTEGER t{};
    t.LowPart = fd.ftLastWriteTime.dwLowDateTime;
    t.HighPart = fd.ftLastWriteTime.dwHighDateTime;
    return int64_t(t.QuadPart / 10000ULL - 11644473600000ULL);
}

std::vector<std::wstring> dir_list(const std::wstring& p) {
    std::vector<std::wstring> out;
    WIN32_FIND_DATAW fd{};
    HANDLE h = FindFirstFileW(path_join(p, L"*").c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) return out;
    do {
        std::wstring name = fd.cFileName;
        if (name == L"." || name == L"..") continue;
        out.push_back(name);
    } while (FindNextFileW(h, &fd));
    FindClose(h);
    return out;
}

bool read_file_bytes(const std::wstring& p, std::vector<unsigned char>& out) {
    out.clear();
    HANDLE h = CreateFileW(p.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(h, &size)) { CloseHandle(h); return false; }
    out.resize((size_t)size.QuadPart);
    size_t done = 0;
    while (done < out.size()) {
        DWORD read = 0;
        DWORD want = (DWORD)std::min<size_t>(out.size() - done, 1u << 20);
        if (!ReadFile(h, out.data() + done, want, &read, nullptr) || read == 0) break;
        done += read;
    }
    CloseHandle(h);
    out.resize(done);
    return done == (size_t)size.QuadPart;
}

bool write_file_bytes_direct(const std::wstring& p, const void* data, size_t n) {
    dir_create_all(path_dirname(p));
    HANDLE h = CreateFileW(p.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    size_t done = 0;
    const unsigned char* ptr = (const unsigned char*)data;
    while (done < n) {
        DWORD written = 0;
        DWORD want = (DWORD)std::min<size_t>(n - done, 1u << 20);
        if (!WriteFile(h, ptr + done, want, &written, nullptr) || written == 0) break;
        done += written;
    }
    CloseHandle(h);
    return done == n;
}

static bool hash_bytes_with(LPCWSTR alg, const void* data, size_t n, std::string& out) {
    out.clear();
    BCRYPT_ALG_HANDLE provider = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    if (BCryptOpenAlgorithmProvider(&provider, alg, nullptr, 0) < 0) return false;
    DWORD hash_len = 0, got = 0;
    if (BCryptGetProperty(provider, BCRYPT_HASH_LENGTH, (PUCHAR)&hash_len, sizeof(hash_len),
                          &got, 0) < 0) {
        BCryptCloseAlgorithmProvider(provider, 0);
        return false;
    }
    std::vector<unsigned char> digest(hash_len);
    bool ok = BCryptCreateHash(provider, &hash, nullptr, 0, nullptr, 0, 0) >= 0 &&
              BCryptHashData(hash, (PUCHAR)data, (ULONG)n, 0) >= 0 &&
              BCryptFinishHash(hash, digest.data(), hash_len, 0) >= 0;
    if (hash) BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(provider, 0);
    if (!ok) return false;
    static const char* hex = "0123456789abcdef";
    out.reserve(hash_len * 2);
    for (unsigned char c : digest) {
        out.push_back(hex[c >> 4]);
        out.push_back(hex[c & 15]);
    }
    return true;
}

std::string sha1_bytes(const void* data, size_t n) {
    std::string out;
    if (hash_bytes_with(BCRYPT_SHA1_ALGORITHM, n ? data : "", n, out)) return out;
    return "";
}

std::string sha256_bytes(const void* data, size_t n) {
    std::string out;
    if (hash_bytes_with(BCRYPT_SHA256_ALGORITHM, n ? data : "", n, out)) return out;
    return "";
}

std::string sha1_file(const std::wstring& p) {
    HANDLE h = CreateFileW(p.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return "";
    BCRYPT_ALG_HANDLE provider = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    std::string out;
    if (BCryptOpenAlgorithmProvider(&provider, BCRYPT_SHA1_ALGORITHM, nullptr, 0) >= 0) {
        DWORD hash_len = 0, got = 0;
        BCryptGetProperty(provider, BCRYPT_HASH_LENGTH, (PUCHAR)&hash_len, sizeof(hash_len), &got, 0);
        std::vector<unsigned char> digest(hash_len);
        if (BCryptCreateHash(provider, &hash, nullptr, 0, nullptr, 0, 0) >= 0) {
            std::vector<unsigned char> buf(1 << 20);
            DWORD read = 0;
            bool ok = true;
            while (ReadFile(h, buf.data(), (DWORD)buf.size(), &read, nullptr) && read > 0) {
                if (BCryptHashData(hash, buf.data(), read, 0) < 0) { ok = false; break; }
            }
            if (ok && BCryptFinishHash(hash, digest.data(), hash_len, 0) >= 0) {
                static const char* hex = "0123456789abcdef";
                for (unsigned char c : digest) {
                    out.push_back(hex[c >> 4]);
                    out.push_back(hex[c & 15]);
                }
            }
            BCryptDestroyHash(hash);
        }
        BCryptCloseAlgorithmProvider(provider, 0);
    }
    CloseHandle(h);
    return out;
}

std::string to_lower_ascii(std::string s) {
    for (auto& c : s)
        if (c >= 'A' && c <= 'Z') c = char(c - 'A' + 'a');
    return s;
}

std::string now_iso_utc() {
    SYSTEMTIME st{};
    GetSystemTime(&st);
    char buf[40];
    snprintf(buf, sizeof(buf), "%04u-%02u-%02uT%02u:%02u:%02u.%03uZ", st.wYear, st.wMonth,
             st.wDay, st.wHour, st.wMinute, st.wSecond, st.wMilliseconds);
    return buf;
}

std::wstring documents_dir() {
    PWSTR path = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Documents, 0, nullptr, &path)) && path) {
        std::wstring out = path;
        CoTaskMemFree(path);
        return out;
    }
    return appdata_dir();
}

std::wstring temp_dir_path() {
    wchar_t buf[MAX_PATH + 1]{};
    DWORD n = GetTempPathW(MAX_PATH, buf);
    return std::wstring(buf, n);
}

bool path_is_ascii(const std::wstring& p) {
    for (wchar_t c : p)
        if (c >= 128) return false;
    return true;
}

std::wstring sanitize_file_name(const std::wstring& name) {
    std::wstring out;
    for (wchar_t c : name) {
        bool ok = (c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'z') ||
                  (c >= L'A' && c <= L'Z') || c == L'_' || c == L'.' || c == L'-';
        out.push_back(ok ? c : L'-');
    }
    return out;
}

std::wstring format_size(uint64_t bytes) {
    wchar_t buf[64];
    if (bytes >= 1024ull * 1024 * 1024)
        swprintf(buf, 64, L"%.2f GB", double(bytes) / (1024.0 * 1024 * 1024));
    else if (bytes >= 1024ull * 1024)
        swprintf(buf, 64, L"%.1f MB", double(bytes) / (1024.0 * 1024));
    else if (bytes >= 1024)
        swprintf(buf, 64, L"%.0f KB", double(bytes) / 1024.0);
    else
        swprintf(buf, 64, L"%llu B", (unsigned long long)bytes);
    return buf;
}
