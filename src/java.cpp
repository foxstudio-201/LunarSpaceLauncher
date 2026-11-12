#include "java.h"
#include "common.h"
#include "fs.h"
#include "net.h"
#include "proc.h"
#include <algorithm>
#include <atomic>
#include <mutex>
#include <thread>

namespace {

const char* kJavaIndexUrl =
    "https://launchermeta.mojang.com/v1/products/java-runtime/"
    "2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
const char* kMarker = "lunaspace-runtime.json";

std::wstring platform_key() { return L"windows-x64"; }

int major_of(const std::string& name) {
    int value = 0;
    size_t i = 0;
    while (i < name.size() && name[i] >= '0' && name[i] <= '9') {
        value = value * 10 + (name[i] - '0');
        ++i;
    }
    return value;
}

std::wstring runtime_dir(const McPaths& paths, const std::wstring& component) {
    return path_join(paths.runtime, component + L"-" + platform_key());
}

std::wstring java_exe_in(const std::wstring& dir) {
    return path_join(dir, L"bin\\java.exe");
}

std::mutex g_scan_mutex;
std::vector<JavaInfo> g_scan_cache;
ULONGLONG g_scan_time = 0;

void scan_registry_roots(std::vector<std::wstring>& roots) {
    const wchar_t* keys[] = {
        L"SOFTWARE\\JavaSoft\\JDK", L"SOFTWARE\\JavaSoft\\Java Development Kit",
        L"SOFTWARE\\JavaSoft\\Java Runtime Environment",
        L"SOFTWARE\\WOW6432Node\\JavaSoft\\JDK",
        L"SOFTWARE\\WOW6432Node\\JavaSoft\\Java Development Kit",
        L"SOFTWARE\\WOW6432Node\\JavaSoft\\Java Runtime Environment"};
    for (const wchar_t* key : keys) {
        HKEY handle = nullptr;
        if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, key, 0, KEY_READ, &handle) != ERROR_SUCCESS)
            continue;
        wchar_t name[256]{};
        DWORD index = 0;
        while (RegEnumKeyW(handle, index++, name, 256) == ERROR_SUCCESS) {
            HKEY sub = nullptr;
            if (RegOpenKeyExW(handle, name, 0, KEY_READ, &sub) == ERROR_SUCCESS) {
                wchar_t home[MAX_PATH]{};
                DWORD size = sizeof(home);
                DWORD type = 0;
                if (RegQueryValueExW(sub, L"JavaHome", nullptr, &type, (LPBYTE)home, &size) ==
                        ERROR_SUCCESS &&
                    type == REG_SZ)
                    roots.push_back(home);
                RegCloseKey(sub);
            }
        }
        RegCloseKey(handle);
    }
}

}  // namespace

bool java_probe(const std::wstring& exe, JavaInfo& out) {
    ProcessCapture capture;
    if (!run_process_capture(exe, L"-version", L"", capture, 8000)) return false;
    std::string text = capture.out + "\n" + capture.err;
    size_t pos = text.find("version \"");
    if (pos == std::string::npos) return false;
    pos += 9;
    size_t end = text.find('"', pos);
    if (end == std::string::npos) return false;
    std::string raw = text.substr(pos, end - pos);
    int major = 0;
    int first = 0;
    size_t i = 0;
    while (i < raw.size() && raw[i] >= '0' && raw[i] <= '9') first = first * 10 + (raw[i++] - '0');
    if (i < raw.size() && raw[i] == '.') {
        int second = 0;
        ++i;
        while (i < raw.size() && raw[i] >= '0' && raw[i] <= '9') second = second * 10 + (raw[i++] - '0');
        major = first >= 9 ? first : (second ? second : 8);
    } else {
        major = first;
    }
    if (major <= 0) return false;
    out.path = exe;
    out.major = major;
    out.raw = utf8_to_wide(raw);
    out.source = L"system";
    return true;
}

std::vector<JavaInfo> java_scan_system() {
    std::lock_guard<std::mutex> lock(g_scan_mutex);
    ULONGLONG now = GetTickCount64();
    if (!g_scan_cache.empty() && now - g_scan_time < 10000) return g_scan_cache;

    std::vector<JavaInfo> result;
    std::vector<std::wstring> seen;

    auto try_exe = [&](const std::wstring& exe) {
        if (exe.empty() || !path_exists(exe)) return;
        for (const auto& item : seen)
            if (_wcsicmp(item.c_str(), exe.c_str()) == 0) return;
        seen.push_back(exe);
        JavaInfo probe;
        if (java_probe(exe, probe)) {
            probe.source = L"system";
            result.push_back(probe);
        }
    };

    wchar_t java_home[MAX_PATH]{};
    DWORD len = GetEnvironmentVariableW(L"JAVA_HOME", java_home, MAX_PATH);
    if (len > 0 && len < MAX_PATH) try_exe(java_exe_in(std::wstring(java_home, len)));

    try_exe(L"C:\\Program Files\\Common Files\\Oracle\\Java\\javapath\\java.exe");
    try_exe(L"C:\\ProgramData\\Oracle\\Java\\javapath\\java.exe");

    std::vector<std::wstring> roots;
    scan_registry_roots(roots);
    const wchar_t* hint_roots[] = {
        L"C:\\Program Files\\Java",          L"C:\\Program Files (x86)\\Java",
        L"C:\\Program Files\\Eclipse Adoptium", L"C:\\Program Files\\Microsoft",
        L"C:\\Program Files\\Zulu",          L"C:\\Program Files\\BellSoft",
        L"C:\\Program Files\\Amazon Corretto", L"C:\\Program Files\\Temurin",
        L"C:\\Program Files (x86)\\Eclipse Adoptium"};
    for (const wchar_t* root : hint_roots) roots.push_back(root);
    for (const auto& root : roots) {
        try_exe(java_exe_in(root));
        std::vector<std::wstring> level1 = dir_list(root);
        for (const auto& dir : level1) {
            std::wstring base = path_join(root, dir);
            if (!path_is_dir(base)) continue;
            try_exe(java_exe_in(base));
            std::vector<std::wstring> level2 = dir_list(base);
            for (const auto& sub : level2) try_exe(java_exe_in(path_join(base, sub)));
        }
    }

    wchar_t found[MAX_PATH]{};
    if (SearchPathW(nullptr, L"java.exe", nullptr, MAX_PATH, found, nullptr) > 0) try_exe(found);

    g_scan_cache = result;
    g_scan_time = now;
    return result;
}

static bool read_marker_ready(const std::wstring& dir, const std::string& manifest_sha1) {
    std::string body = read_file_utf8(path_join(dir, utf8_to_wide(kMarker)));
    if (body.empty()) return false;
    Json marker;
    if (!marker.parse(body)) return false;
    if (marker.text("manifestSha1") != manifest_sha1) return false;
    return path_exists(java_exe_in(dir));
}

static Json java_index(const McPaths& paths, bool force, std::wstring* error) {
    std::wstring cache = path_join(paths.meta, L"java-runtimes.json");
    if (!force) {
        std::string body = read_file_utf8(cache);
        Json parsed;
        if (!body.empty() && parsed.parse(body) && parsed.find("platforms")) return parsed;
    }
    HttpResult res = http_request(widen(kJavaIndexUrl), L"GET");
    if (res.ok() && res.status == 200) {
        Json parsed;
        if (parsed.parse(res.body) && parsed.find("platforms")) {
            write_file_utf8(cache, res.body);
            return parsed;
        }
    }
    std::string body = read_file_utf8(cache);
    Json parsed;
    if (!body.empty() && parsed.parse(body) && parsed.find("platforms")) return parsed;
    if (error) *error = L"Không tải được danh sách Java runtime";
    return Json{};
}

static const Json* platform_entry(const Json& index, const std::wstring& component) {
    const Json* platforms = index.find(wide_to_utf8(platform_key()).c_str());
    if (!platforms) return nullptr;
    const Json* list = platforms->find(wide_to_utf8(component).c_str());
    if (!list || list->type != Json::Type::Array || list->arr.empty()) return nullptr;
    return list->at(0);
}

bool java_component_for_major(const McPaths& paths, int major, std::wstring& component) {
    std::wstring error;
    Json index = java_index(paths, false, &error);
    const Json* platforms = index.find(wide_to_utf8(platform_key()).c_str());
    if (!platforms) return false;
    int best_lower = 0;
    std::wstring best_component;
    for (const auto& kv : platforms->obj) {
        const std::string& name = kv.first;
        if (name == "minecraft-java-exe") continue;
        if (name.rfind("java-runtime", 0) != 0 && name != "jre-legacy") continue;
        if (name.find("snapshot") != std::string::npos) continue;
        if (kv.second.type != Json::Type::Array || kv.second.arr.empty()) continue;
        const Json* version = kv.second.arr[0].find("version");
        int value = version ? major_of(version->text("name")) : 0;
        if (value <= 0) continue;
        if (value == major) {
            component = utf8_to_wide(name);
            return true;
        }
        if (value < major && value > best_lower) {
            best_lower = value;
            best_component = utf8_to_wide(name);
        }
    }
    if (!best_component.empty()) {
        component = best_component;
        return true;
    }
    return false;
}

static void report(ProgressFn progress, const wchar_t* phase, const std::wstring& label,
                   uint64_t done, uint64_t total, bool final_report) {
    ProgressReport report_data;
    report_data.phase = phase;
    report_data.label = label;
    report_data.done = done;
    report_data.total = total;
    report_data.final_report = final_report;
    if (progress) progress(report_data);
}

bool java_install_component(const std::wstring& component, const McPaths& paths,
                            ProgressFn progress, std::wstring* error, JavaInfo* out) {
    std::wstring index_error;
    Json index = java_index(paths, false, &index_error);
    const Json* entry = platform_entry(index, component);
    if (!entry) {
        if (error)
            *error = L"Không có Java runtime \"" + component + L"\" cho nền tảng windows-x64";
        return false;
    }
    const Json* manifest = entry->find("manifest");
    if (!manifest) {
        if (error) *error = L"Runtime không có manifest";
        return false;
    }
    std::string manifest_sha1 = manifest->text("sha1");
    std::wstring dir = runtime_dir(paths, component);
    if (read_marker_ready(dir, manifest_sha1)) {
        if (out) {
            out->path = java_exe_in(dir);
            out->major = major_of(entry->find("version") ? entry->find("version")->text("name") : "");
            out->raw = utf8_to_wide(entry->find("version") ? entry->find("version")->text("name") : "");
            out->source = L"managed";
        }
        return true;
    }
    report(progress, L"start", L"java", 0, 1, false);
    HttpResult res = http_request(utf8_to_wide(manifest->text("url")), L"GET");
    Json files;
    if (!res.ok() || res.status != 200 || !files.parse(res.body) || !files.find("files")) {
        if (error) *error = L"Không tải được manifest Java";
        report(progress, L"error", L"java", 0, 1, true);
        return false;
    }
    const Json* file_map = files.find("files");
    struct Task {
        std::wstring url, dest, sha1;
        uint64_t size = 0;
    };
    std::vector<Task> tasks;
    uint64_t expected_bytes = 0;
    for (const auto& kv : file_map->obj) {
        const Json& info = kv.second;
        std::wstring dest = path_join(dir, utf8_to_wide(kv.first));
        std::string type = info.text("type");
        if (type == "directory") {
            dir_create_all(dest);
            continue;
        }
        if (type == "link") continue;
        const Json* downloads = info.find("downloads");
        const Json* raw = downloads ? downloads->find("raw") : nullptr;
        if (!raw || raw->text("url").empty()) continue;
        Task task;
        task.url = utf8_to_wide(raw->text("url"));
        task.dest = dest;
        task.sha1 = utf8_to_wide(raw->text("sha1"));
        task.size = (uint64_t)raw->number("size");
        expected_bytes += task.size;
        tasks.push_back(task);
    }
    std::atomic<size_t> next{0};
    std::atomic<uint64_t> done{0};
    std::atomic<uint64_t> bytes{0};
    std::vector<std::pair<std::wstring, std::wstring>> failures;
    std::mutex failure_mutex;
    ULONGLONG last = 0;
    int workers = (int)std::min<size_t>(16, tasks.size());
    std::vector<std::thread> threads;
    for (int i = 0; i < workers; ++i) {
        threads.emplace_back([&] {
            for (;;) {
                size_t index_value = next.fetch_add(1);
                if (index_value >= tasks.size()) break;
                Task& task = tasks[index_value];
                bool fresh = path_exists(task.dest) &&
                             (task.size == 0 || file_size(task.dest) == task.size);
                if (!fresh) {
                    DownloadResult result = http_download_file(task.url, task.dest, nullptr, 3);
                    if (!result.ok) {
                        std::lock_guard<std::mutex> lock(failure_mutex);
                        failures.push_back({task.dest, utf8_to_wide(result.error)});
                    }
                }
                done.fetch_add(1);
                bytes.fetch_add(file_size(task.dest));
                ULONGLONG now = GetTickCount64();
                if (now - last > 150) {
                    last = now;
                    ProgressReport report_data;
                    report_data.phase = L"download";
                    report_data.label = L"java";
                    report_data.done = done.load();
                    report_data.total = tasks.size();
                    report_data.bytes = bytes.load();
                    report_data.bytes_total = expected_bytes;
                    if (progress) progress(report_data);
                }
            }
        });
    }
    for (auto& thread : threads) thread.join();
    if (!failures.empty()) {
        if (error) *error = L"Tải Java lỗi: " + failures.front().second;
        report(progress, L"error", L"java", tasks.size(), tasks.size(), true);
        return false;
    }
    Json marker;
    marker.type = Json::Type::Object;
    auto set_str = [&](const char* key, const std::string& value) {
        Json item;
        item.type = Json::Type::String;
        item.str = value;
        marker.obj.push_back({key, item});
    };
    set_str("component", wide_to_utf8(component));
    set_str("platform", wide_to_utf8(platform_key()));
    set_str("manifestSha1", manifest_sha1);
    set_str("installedAt", now_iso_utc());
    write_file_utf8(path_join(dir, utf8_to_wide(kMarker)), marker.dump(2));
    if (out) {
        out->path = java_exe_in(dir);
        out->raw = utf8_to_wide(entry->find("version") ? entry->find("version")->text("name") : "");
        out->major = major_of(entry->find("version") ? entry->find("version")->text("name") : "");
        out->source = L"managed";
    }
    report(progress, L"done", L"java", tasks.size(), tasks.size(), true);
    return true;
}

std::vector<JavaInfo> java_list_managed(const McPaths& paths) {
    std::vector<JavaInfo> result;
    if (!path_is_dir(paths.runtime)) return result;
    for (const auto& name : dir_list(paths.runtime)) {
        std::wstring dir = path_join(paths.runtime, name);
        if (!path_is_dir(dir)) continue;
        std::wstring exe = java_exe_in(dir);
        if (!path_exists(exe)) continue;
        JavaInfo probe;
        if (!java_probe(exe, probe)) continue;
        probe.source = L"managed";
        result.push_back(probe);
    }
    return result;
}

JavaInfo java_resolve(const std::wstring& instance_java, const std::wstring& settings_java,
                      int major, const std::wstring& component, const McPaths& paths,
                      ProgressFn progress, std::wstring* error) {
    auto probe_if = [](const std::wstring& path, const wchar_t* source, JavaInfo& out) {
        if (path.empty() || !path_exists(path)) return false;
        if (!java_probe(path, out)) return false;
        if (out.major < 8) return false;
        out.source = source;
        return true;
    };
    JavaInfo info;
    if (probe_if(instance_java, L"instance", info)) return info;
    if (probe_if(settings_java, L"manual", info)) return info;

    std::wstring managed_component = component;
    if (managed_component.empty()) java_component_for_major(paths, major, managed_component);
    if (!managed_component.empty()) {
        std::wstring dir = runtime_dir(paths, managed_component);
        std::wstring exe = java_exe_in(dir);
        if (path_exists(exe)) {
            JavaInfo probe;
            if (java_probe(exe, probe)) {
                probe.source = L"managed";
                return probe;
            }
        }
        if (java_install_component(managed_component, paths, progress, error, &info)) return info;
    }
    for (const auto& candidate : java_scan_system()) {
        if (candidate.major >= major || major <= 0) {
            JavaInfo found = candidate;
            found.source = L"system";
            return found;
        }
    }
    if (error) *error = L"Không tìm thấy Java " + std::to_wstring(major) + L" trên máy";
    return JavaInfo{};
}
