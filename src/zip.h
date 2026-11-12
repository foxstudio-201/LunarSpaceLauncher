#pragma once
#include <windows.h>
#include <cstdint>
#include <functional>
#include <string>
#include <utility>
#include <vector>

struct ZipEntry {
    std::string name;
    uint64_t size = 0;
    uint64_t packed = 0;
    bool dir = false;
};

bool zip_list(const std::wstring& zip_path, std::vector<ZipEntry>& out);
bool zip_extract_all(const std::wstring& zip_path, const std::wstring& dest_dir,
                     std::wstring* err = nullptr);
bool zip_extract_filtered(const std::wstring& zip_path, const std::wstring& dest_dir,
                          const std::function<bool(const std::string&)>& keep,
                          std::wstring* err = nullptr);
bool zip_read_entry(const std::wstring& zip_path, const std::string& entry,
                    std::vector<unsigned char>& out);
bool zip_has_entry(const std::wstring& zip_path, const std::string& entry);
bool zip_write_files(const std::wstring& zip_path,
                     const std::vector<std::pair<std::string, std::wstring>>& entries,
                     std::wstring* err = nullptr);
bool zip_write_buffers(const std::wstring& zip_path,
                       const std::vector<std::pair<std::string, std::vector<unsigned char>>>& entries,
                       std::wstring* err = nullptr);
