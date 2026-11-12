#include "zip.h"
#include "fs.h"
#include "json.h"
#include "third_party/miniz.h"
#include <algorithm>

namespace {

std::string normalize_entry(std::string name) {
    std::replace(name.begin(), name.end(), '\\', '/');
    while (!name.empty() && name.front() == '/') name.erase(name.begin());
    return name;
}

bool entry_safe(const std::string& name) {
    if (name.empty()) return false;
    if (name.size() > 1 && name[1] == ':') return false;
    size_t start = 0;
    while (start <= name.size()) {
        size_t slash = name.find('/', start);
        std::string part = name.substr(start, slash == std::string::npos ? std::string::npos
                                                                        : slash - start);
        if (part == "..") return false;
        if (slash == std::string::npos) break;
        start = slash + 1;
    }
    return true;
}

struct Reader {
    mz_zip_archive zip{};
    bool ok = false;
    explicit Reader(const std::wstring& path) {
        ok = mz_zip_reader_init_file(&zip, wide_to_utf8(path).c_str(), 0) != 0;
    }
    ~Reader() {
        if (ok) mz_zip_reader_end(&zip);
    }
};

}  // namespace

bool zip_list(const std::wstring& zip_path, std::vector<ZipEntry>& out) {
    out.clear();
    Reader reader(zip_path);
    if (!reader.ok) return false;
    mz_uint count = mz_zip_reader_get_num_files(&reader.zip);
    for (mz_uint i = 0; i < count; ++i) {
        mz_zip_archive_file_stat st{};
        if (!mz_zip_reader_file_stat(&reader.zip, i, &st)) continue;
        ZipEntry entry;
        entry.name = normalize_entry(st.m_filename);
        entry.size = st.m_uncomp_size;
        entry.packed = st.m_comp_size;
        entry.dir = mz_zip_reader_is_file_a_directory(&reader.zip, i) != 0 ||
                    (!entry.name.empty() && entry.name.back() == '/');
        out.push_back(std::move(entry));
    }
    return true;
}

static bool extract_impl(const std::wstring& zip_path, const std::wstring& dest_dir,
                         const std::function<bool(const std::string&)>& keep,
                         std::wstring* err) {
    Reader reader(zip_path);
    if (!reader.ok) {
        if (err) *err = L"Không mở được tệp zip";
        return false;
    }
    mz_uint count = mz_zip_reader_get_num_files(&reader.zip);
    for (mz_uint i = 0; i < count; ++i) {
        mz_zip_archive_file_stat st{};
        if (!mz_zip_reader_file_stat(&reader.zip, i, &st)) continue;
        std::string name = normalize_entry(st.m_filename);
        bool is_dir = mz_zip_reader_is_file_a_directory(&reader.zip, i) != 0 ||
                      (!name.empty() && name.back() == '/');
        if (!entry_safe(is_dir ? name : name)) {
            if (err) *err = L"Tệp zip chứa đường dẫn không an toàn: " + utf8_to_wide(name);
            return false;
        }
        std::wstring full = path_join(dest_dir, utf8_to_wide(name));
        if (is_dir) {
            dir_create_all(full);
            continue;
        }
        if (keep && !keep(name)) continue;
        if (st.m_uncomp_size > (256ull << 20)) {
            if (err) *err = L"Tệp trong zip quá lớn";
            return false;
        }
        std::vector<unsigned char> data((size_t)st.m_uncomp_size);
        if (!mz_zip_reader_extract_to_mem(&reader.zip, i, data.data(), data.size(), 0)) {
            if (err) *err = L"Giải nén thất bại: " + utf8_to_wide(name);
            return false;
        }
        if (!write_file_bytes_direct(full, data.data(), data.size())) {
            if (err) *err = L"Không ghi được tệp: " + full;
            return false;
        }
    }
    return true;
}

bool zip_extract_all(const std::wstring& zip_path, const std::wstring& dest_dir,
                     std::wstring* err) {
    return extract_impl(zip_path, dest_dir, nullptr, err);
}

bool zip_extract_filtered(const std::wstring& zip_path, const std::wstring& dest_dir,
                          const std::function<bool(const std::string&)>& keep,
                          std::wstring* err) {
    return extract_impl(zip_path, dest_dir, keep, err);
}

bool zip_read_entry(const std::wstring& zip_path, const std::string& entry,
                    std::vector<unsigned char>& out) {
    out.clear();
    Reader reader(zip_path);
    if (!reader.ok) return false;
    int index = mz_zip_reader_locate_file(&reader.zip, entry.c_str(), nullptr, 0);
    if (index < 0) return false;
    mz_zip_archive_file_stat st{};
    if (!mz_zip_reader_file_stat(&reader.zip, (mz_uint)index, &st)) return false;
    if (st.m_uncomp_size > (256ull << 20)) return false;
    out.resize((size_t)st.m_uncomp_size);
    return mz_zip_reader_extract_to_mem(&reader.zip, (mz_uint)index, out.data(), out.size(), 0) != 0;
}

bool zip_has_entry(const std::wstring& zip_path, const std::string& entry) {
    Reader reader(zip_path);
    if (!reader.ok) return false;
    return mz_zip_reader_locate_file(&reader.zip, entry.c_str(), nullptr, 0) >= 0;
}

bool zip_write_files(const std::wstring& zip_path,
                     const std::vector<std::pair<std::string, std::wstring>>& entries,
                     std::wstring* err) {
    dir_create_all(path_dirname(zip_path));
    mz_zip_archive writer{};
    if (!mz_zip_writer_init_file(&writer, wide_to_utf8(zip_path).c_str(), 0)) {
        if (err) *err = L"Không tạo được tệp zip";
        return false;
    }
    bool ok = true;
    for (const auto& item : entries) {
        if (!mz_zip_writer_add_file(&writer, item.first.c_str(),
                                    wide_to_utf8(item.second).c_str(), nullptr, 0,
                                    MZ_DEFAULT_COMPRESSION)) {
            ok = false;
            if (err) *err = L"Không thêm được tệp: " + item.second;
            break;
        }
    }
    if (ok && !mz_zip_writer_finalize_archive(&writer)) ok = false;
    mz_zip_writer_end(&writer);
    if (!ok) file_delete(zip_path);
    return ok;
}

bool zip_write_buffers(const std::wstring& zip_path,
                       const std::vector<std::pair<std::string, std::vector<unsigned char>>>& entries,
                       std::wstring* err) {
    dir_create_all(path_dirname(zip_path));
    mz_zip_archive writer{};
    if (!mz_zip_writer_init_file(&writer, wide_to_utf8(zip_path).c_str(), 0)) {
        if (err) *err = L"Không tạo được tệp zip";
        return false;
    }
    bool ok = true;
    for (const auto& item : entries) {
        if (!mz_zip_writer_add_mem(&writer, item.first.c_str(), item.second.data(),
                                   item.second.size(), MZ_DEFAULT_COMPRESSION)) {
            ok = false;
            if (err) *err = L"Không thêm được tệp: " + utf8_to_wide(item.first);
            break;
        }
    }
    if (ok && !mz_zip_writer_finalize_archive(&writer)) ok = false;
    mz_zip_writer_end(&writer);
    if (!ok) file_delete(zip_path);
    return ok;
}
