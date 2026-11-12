#pragma once
#include <windows.h>
#include <string>
#include <vector>
#include <cstdint>

std::wstring path_join(const std::wstring& a, const std::wstring& b);
std::wstring path_dirname(const std::wstring& p);
std::wstring path_basename(const std::wstring& p);
std::wstring path_ext_lower(const std::wstring& p);
std::wstring path_norm(const std::wstring& p);

bool path_exists(const std::wstring& p);
bool path_is_dir(const std::wstring& p);
bool dir_create_all(const std::wstring& p);
bool file_delete(const std::wstring& p);
bool dir_delete_recursive(const std::wstring& p);
bool file_move_replace(const std::wstring& from, const std::wstring& to);
bool file_copy(const std::wstring& from, const std::wstring& to);
uint64_t file_size(const std::wstring& p);
int64_t file_mtime_ms(const std::wstring& p);
std::vector<std::wstring> dir_list(const std::wstring& p);
bool read_file_bytes(const std::wstring& p, std::vector<unsigned char>& out);
bool write_file_bytes_direct(const std::wstring& p, const void* data, size_t n);

std::string sha1_bytes(const void* data, size_t n);
std::string sha1_file(const std::wstring& p);
std::string sha256_bytes(const void* data, size_t n);
std::string to_lower_ascii(std::string s);
std::string now_iso_utc();
std::wstring documents_dir();
std::wstring temp_dir_path();
bool path_is_ascii(const std::wstring& p);
std::wstring sanitize_file_name(const std::wstring& name);
std::wstring format_size(uint64_t bytes);
