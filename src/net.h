#pragma once
#include <windows.h>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

struct HttpResult {
    int status = 0;
    std::string body;
    std::string error;
    bool ok() const { return error.empty(); }
};

struct DownloadResult {
    bool ok = false;
    int status = 0;
    uint64_t bytes = 0;
    std::string error;
};

HttpResult http_request(const std::wstring& url, const wchar_t* method,
                        const std::string& body = "", const wchar_t* content_type = nullptr,
                        const std::vector<std::pair<std::wstring, std::wstring>>& headers = {});

DownloadResult http_download_file(
    const std::wstring& url, const std::wstring& dest_path,
    const std::function<bool(uint64_t done, uint64_t total)>& on_progress = nullptr,
    int attempts = 3);

std::string url_encode(const std::string& value);
std::string base64_encode(const std::vector<unsigned char>& data);
std::vector<unsigned char> base64_decode(const std::string& text);

std::wstring appdata_dir();
std::wstring user_data_dir();
std::wstring engine_data_dir();
std::string read_file_utf8(const std::wstring& path);
bool write_file_utf8(const std::wstring& path, const std::string& text);
bool write_file_bytes(const std::wstring& path, const std::vector<unsigned char>& data);

std::string oscrypt_decrypt(const std::string& sealed_base64);
std::string oscrypt_encrypt(const std::string& plain);
std::string offline_uuid(const std::wstring& name);
std::wstring find_edge_exe();
std::wstring url_decode_w(const std::wstring& value);
