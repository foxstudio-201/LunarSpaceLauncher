#include "mc.h"
#include "common.h"
#include "fs.h"
#include "net.h"
#include "zip.h"
#include <algorithm>
#include <atomic>
#include <mutex>
#include <thread>

namespace {

const char* kManifestUrl = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const char* kResourcesBase = "https://resources.download.minecraft.net/";
const char* kMavenBase = "https://libraries.minecraft.net/";

std::wstring wstr(const Json* value, const char* key = nullptr) {
    if (!value) return L"";
    if (key) {
        const Json* v = value->find(key);
        return v && v->type == Json::Type::String ? utf8_to_wide(v->str) : L"";
    }
    return value->type == Json::Type::String ? utf8_to_wide(value->str) : L"";
}

uint64_t unum(const Json* value, const char* key) {
    if (!value) return 0;
    const Json* v = key ? value->find(key) : value;
    if (!v || v->type != Json::Type::Number) return 0;
    return v->num > 0 ? (uint64_t)v->num : 0;
}

bool jarray(const Json* v) { return v && v->type == Json::Type::Array; }
bool jobject(const Json* v) { return v && v->type == Json::Type::Object; }

std::string json_str(const Json* v, const char* key = nullptr) {
    if (!v) return "";
    if (key) {
        const Json* x = v->find(key);
        return x && x->type == Json::Type::String ? x->str : "";
    }
    return v->type == Json::Type::String ? v->str : "";
}

}  // namespace

McPaths mc_paths(const std::wstring& shared_dir) {
    McPaths p;
    p.shared = shared_dir;
    p.meta = path_join(shared_dir, L"meta");
    p.versions = path_join(shared_dir, L"versions");
    p.libraries = path_join(shared_dir, L"libraries");
    p.assets = path_join(shared_dir, L"assets");
    p.assets_indexes = path_join(p.assets, L"indexes");
    p.assets_objects = path_join(p.assets, L"objects");
    p.natives = path_join(shared_dir, L"natives");
    p.runtime = path_join(shared_dir, L"runtime");
    return p;
}

bool mc_rule_allows(const Json* rules) {
    if (!jarray(rules) || rules->arr.empty()) return true;
    bool allowed = false;
    for (const auto& rule : rules->arr) {
        bool os_ok = true;
        if (const Json* os = rule.find("os")) {
            std::string name = json_str(os, "name");
            std::string arch = json_str(os, "arch");
            std::string version = json_str(os, "version");
            if (!name.empty() && name != "windows") os_ok = false;
            if (!arch.empty() && arch != "x86_64") os_ok = false;
            if (!version.empty() && version.find("^10") == std::string::npos &&
                version.find("10") == std::string::npos)
                os_ok = false;
        }
        bool feat_ok = true;
        if (const Json* features = rule.find("features")) {
            for (const auto& kv : features->obj) {
                if (kv.second.type == Json::Type::Bool && kv.second.b) feat_ok = false;
                else if (kv.second.type == Json::Type::Number && kv.second.num != 0) feat_ok = false;
                else if (kv.second.type == Json::Type::String && !kv.second.str.empty() &&
                         kv.second.str != "false")
                    feat_ok = false;
            }
        }
        if (os_ok && feat_ok) allowed = json_str(&rule, "action") == "allow";
    }
    return allowed;
}

static std::wstring maven_rel(const std::string& group, const std::string& artifact,
                              const std::string& version, const std::string& classifier) {
    std::string path = group;
    std::replace(path.begin(), path.end(), '.', '/');
    path += "/" + artifact + "/" + version + "/" + artifact + "-" + version;
    if (!classifier.empty()) path += "-" + classifier;
    path += ".jar";
    return utf8_to_wide(path);
}

struct LibParts {
    std::string group, artifact, version, classifier;
};

static LibParts split_lib_name(const std::string& name) {
    LibParts parts;
    std::vector<std::string> tokens;
    size_t start = 0;
    while (start <= name.size()) {
        size_t colon = name.find(':', start);
        tokens.push_back(name.substr(start, colon == std::string::npos ? std::string::npos
                                                                      : colon - start));
        if (colon == std::string::npos) break;
        start = colon + 1;
    }
    if (tokens.size() > 0) parts.group = tokens[0];
    if (tokens.size() > 1) parts.artifact = tokens[1];
    if (tokens.size() > 2) parts.version = tokens[2];
    if (tokens.size() > 3) parts.classifier = tokens[3];
    return parts;
}

static std::string lib_key(const Json& lib) {
    LibParts parts = split_lib_name(json_str(&lib, "name"));
    return parts.group + ":" + parts.artifact + ":" + parts.classifier;
}

static bool library_allowed(const Json& lib) {
    return mc_rule_allows(lib.find("rules"));
}

Json mc_manifest(const McPaths& paths, bool force, std::wstring* err) {
    std::wstring cache = path_join(paths.meta, L"version_manifest_v2.json");
    if (!force) {
        std::string body = read_file_utf8(cache);
        Json parsed;
        if (!body.empty() && parsed.parse(body) && parsed.find("versions")) return parsed;
    }
    HttpResult res = http_request(widen(kManifestUrl), L"GET");
    if (res.ok() && res.status == 200) {
        Json parsed;
        if (parsed.parse(res.body) && parsed.find("versions")) {
            write_file_utf8(cache, res.body);
            return parsed;
        }
    }
    std::string body = read_file_utf8(cache);
    Json parsed;
    if (!body.empty() && parsed.parse(body) && parsed.find("versions")) return parsed;
    if (err) *err = L"Không tải được danh sách phiên bản";
    return Json{};
}

// ---------- downloads ----------

struct DlTask {
    std::wstring url;
    std::wstring dest;
    std::string sha1;
    uint64_t size = 0;
    bool skip_hash = false;
    bool force = false;
};

static bool is_fresh(const DlTask& task) {
    if (!path_exists(task.dest)) return false;
    if (task.force) return false;
    if (task.size > 0 && file_size(task.dest) != task.size) return false;
    if (!task.skip_hash && !task.sha1.empty()) return sha1_file(task.dest) != task.sha1;
    return true;
}

static void run_downloads(std::vector<DlTask>& tasks, int workers, const std::wstring& label,
                          ProgressFn progress,
                          std::vector<std::pair<std::wstring, std::wstring>>& errors,
                          const CancelFn& cancel = {}) {
    if (tasks.empty()) return;
    uint64_t bytes_total = 0;
    size_t pending = 0;
    for (const auto& task : tasks) {
        if (is_fresh(task)) continue;
        ++pending;
        bytes_total += task.size;
    }
    if (pending == 0) {
        ProgressReport done;
        done.phase = L"download";
        done.label = label;
        done.done = tasks.size();
        done.total = tasks.size();
        done.bytes = bytes_total;
        done.bytes_total = bytes_total;
        done.final_report = true;
        if (progress) progress(done);
        return;
    }
    std::atomic<size_t> next{0};
    std::atomic<uint64_t> done{tasks.size() - pending};
    std::atomic<uint64_t> bytes{0};
    std::atomic<bool> cancelled{false};
    std::mutex emit_mutex;
    ULONGLONG last_emit = 0;
    auto emit = [&](bool final_report) {
        ProgressReport report;
        report.phase = L"download";
        report.label = label;
        report.done = done.load();
        report.total = tasks.size();
        report.bytes = bytes.load();
        report.bytes_total = bytes_total;
        report.final_report = final_report;
        if (progress) progress(report);
    };
    int thread_count = std::max(1, std::min<int>(workers, (int)pending));
    std::vector<std::thread> threads;
    for (int i = 0; i < thread_count; ++i) {
        threads.emplace_back([&] {
            for (;;) {
                size_t index = next.fetch_add(1);
                if (index >= tasks.size() || cancelled.load()) break;
                if (cancel && cancel()) {
                    cancelled.store(true);
                    break;
                }
                DlTask& task = tasks[index];
                if (is_fresh(task)) continue;
                DownloadResult res = http_download_file(task.url, task.dest, nullptr, 3);
                bool ok = res.ok;
                if (ok && !task.skip_hash && !task.sha1.empty()) {
                    std::string actual = sha1_file(task.dest);
                    if (to_lower_ascii(actual) != to_lower_ascii(task.sha1)) {
                        ok = false;
                        res.error = "Sai checksum";
                        file_delete(task.dest);
                    }
                }
                if (!ok) {
                    std::lock_guard<std::mutex> lock(emit_mutex);
                    errors.push_back({task.dest, utf8_to_wide(res.error)});
                }
                done.fetch_add(1);
                bytes.fetch_add(ok ? file_size(task.dest) : 0);
                std::lock_guard<std::mutex> lock(emit_mutex);
                ULONGLONG now = GetTickCount64();
                if (now - last_emit > 100) {
                    last_emit = now;
                    emit(false);
                }
            }
        });
    }
    for (auto& thread : threads) thread.join();
    emit(true);
}

// ---------- version metadata ----------


bool mc_fetch_version(const std::wstring& id, const McPaths& paths, Json& out,
                               std::wstring* err) {
    std::wstring meta_file = path_join(paths.meta, path_join(L"versions", id + L".json"));
    std::string body = read_file_utf8(meta_file);
    if (!body.empty() && out.parse(body) && out.find("id")) return true;
    std::wstring version_file = path_join(paths.versions, path_join(id, id + L".json"));
    body = read_file_utf8(version_file);
    if (!body.empty() && out.parse(body) && out.find("id")) return true;
    Json manifest = mc_manifest(paths, false, nullptr);
    std::string url;
    const Json* versions = manifest.find("versions");
    if (versions && versions->type == Json::Type::Array) {
        for (const auto& item : versions->arr) {
            if (item.text("id") == wide_to_utf8(id)) {
                url = item.text("url");
                break;
            }
        }
    }
    if (url.empty()) {
        if (err) *err = L"Không tìm thấy phiên bản " + id;
        return false;
    }
    HttpResult res = http_request(utf8_to_wide(url), L"GET");
    if (!res.ok() || res.status != 200 || !out.parse(res.body) || !out.find("id")) {
        if (err) *err = L"Không tải được hồ sơ phiên bản " + id;
        return false;
    }
    write_file_utf8(meta_file, res.body);
    return true;
}

static Json merge_versions(const Json& parent, const Json& child) {
    Json merged = child;
    auto set_if_missing = [&](const char* key) {
        if (!merged.find(key)) {
            if (const Json* v = parent.find(key)) merged.obj.push_back({key, *v});
        }
    };
    set_if_missing("assets");
    set_if_missing("assetIndex");
    set_if_missing("downloads");
    set_if_missing("javaVersion");
    set_if_missing("type");
    set_if_missing("mainClass");
    set_if_missing("minecraftArguments");
    if (!merged.find("arguments")) {
        if (const Json* args = parent.find("arguments"))
            merged.obj.push_back({"arguments", *args});
    }
    std::vector<std::string> child_keys;
    if (const Json* libs = child.find("libraries"))
        for (const auto& lib : libs->arr) child_keys.push_back(lib_key(lib));
    Json libraries;
    libraries.type = Json::Type::Array;
    if (const Json* libs = parent.find("libraries")) {
        for (const auto& lib : libs->arr) {
            std::string key = lib_key(lib);
            if (std::find(child_keys.begin(), child_keys.end(), key) != child_keys.end()) continue;
            libraries.arr.push_back(lib);
        }
    }
    if (const Json* libs = child.find("libraries"))
        for (const auto& lib : libs->arr) libraries.arr.push_back(lib);
    for (auto& kv : merged.obj)
        if (kv.first == "libraries") kv.second = libraries;
    if (!merged.find("libraries")) merged.obj.push_back({"libraries", libraries});
    return merged;
}

static bool load_chain_rec(const std::wstring& id, const McPaths& paths, Json& out, int depth,
                           std::wstring* root_id, std::wstring* err) {
    if (depth > 8) {
        if (err) *err = L"Chuỗi kế thừa quá sâu";
        return false;
    }
    Json version;
    if (!mc_fetch_version(id, paths, version, err)) return false;
    std::string parent_id = version.text("inheritsFrom");
    if (parent_id.empty()) {
        if (root_id) *root_id = id;
        out = version;
        return true;
    }
    Json parent;
    if (!load_chain_rec(utf8_to_wide(parent_id), paths, parent, depth + 1, root_id, err))
        return false;
    out = merge_versions(parent, version);
    return true;
}

Json mc_chain(const std::wstring& id, const McPaths& paths, std::wstring* err) {
    Json chain;
    std::wstring root;
    if (!load_chain_rec(id, paths, chain, 0, &root, err)) return Json{};
    return chain;
}

// ---------- install ----------

static bool add_artifact_task(std::vector<DlTask>& tasks, const Json* artifact,
                              const std::wstring& libraries_dir, const std::string& name,
                              bool allow_maven_fallback, const Json* lib, bool force) {
    if (jobject(artifact)) {
        std::string url = json_str(artifact, "url");
        std::string rel_path = json_str(artifact, "path");
        if (!url.empty()) {
            std::wstring dest = path_join(libraries_dir, utf8_to_wide(rel_path));
            DlTask task;
            task.url = utf8_to_wide(url);
            task.dest = dest;
            task.sha1 = json_str(artifact, "sha1");
            task.size = unum(artifact, "size");
            task.force = force;
            tasks.push_back(task);
            return true;
        }
    }
    if (!allow_maven_fallback) return false;
    LibParts parts = split_lib_name(name);
    if (parts.artifact.empty() || parts.version.empty()) return false;
    std::wstring rel = maven_rel(parts.group, parts.artifact, parts.version, parts.classifier);
    std::string base = lib ? json_str(lib, "url") : "";
    if (base.empty()) base = kMavenBase;
    if (base.back() != '/') base += '/';
    DlTask task;
    task.url = utf8_to_wide(base + wide_to_utf8(rel));
    task.dest = path_join(libraries_dir, rel);
    task.force = force;
    tasks.push_back(task);
    return true;
}

static bool extract_native_jar(const std::wstring& jar, const std::wstring& dest_dir) {
    std::vector<ZipEntry> entries;
    if (!zip_list(jar, entries)) return false;
    for (const auto& entry : entries) {
        if (entry.dir) continue;
        std::string name = entry.name;
        if (name.rfind("META-INF/", 0) == 0) continue;
        if (name.find("..") != std::string::npos) continue;
        if (name.empty() || name.back() == '/') continue;
        std::vector<unsigned char> data;
        if (!zip_read_entry(jar, entry.name, data)) continue;
        write_file_bytes_direct(path_join(dest_dir, utf8_to_wide(name)), data.data(), data.size());
    }
    return true;
}

struct InstallContext {
    McPaths paths;
    ProgressFn progress;
    bool force = false;
    std::vector<std::pair<std::wstring, std::wstring>> errors;
};

static void report_phase(ProgressFn progress, const wchar_t* phase, const std::wstring& label,
                         bool final_report = false) {
    ProgressReport report;
    report.phase = phase;
    report.label = label;
    report.final_report = final_report;
    if (progress) progress(report);
}

static bool install_impl(const std::wstring& version_id, const McPaths& paths,
                         ProgressFn progress, bool force, bool include_assets, McInstall& out,
                         const CancelFn& cancel = {}) {
    static std::mutex install_mutex;
    std::lock_guard<std::mutex> install_lock(install_mutex);
    out = {};
    std::wstring root_id;
    Json chain;
    std::wstring error;
    if (!load_chain_rec(version_id, paths, chain, 0, &root_id, &error)) {
        out.error = error;
        report_phase(progress, L"error", L"error", true);
        return false;
    }
    out.chain = chain;
    out.version_id = version_id;
    out.jar_id = root_id;
    out.natives_dir = path_join(paths.natives, version_id);
    if (const Json* java_version = chain.find("javaVersion")) {
        out.java_major = (int)unum(java_version, "majorVersion");
        out.java_component = wstr(java_version, "component");
        if (out.java_major <= 0) out.java_major = 8;
    }
    report_phase(progress, L"start", L"start");

    std::vector<std::wstring> native_jars;
    std::vector<DlTask> library_tasks;
    if (const Json* libraries = chain.find("libraries")) {
        size_t count = libraries->type == Json::Type::Array ? libraries->arr.size() : 0;
        for (size_t i = 0; i < count; ++i) {
            const Json& lib = libraries->arr[i];
            if (!library_allowed(lib)) continue;
            std::string name = json_str(&lib, "name");
            bool force_lib = force && (name.rfind("vn.lunar:", 0) == 0 ||
                                       name.rfind("net.fabricmc:", 0) == 0 ||
                                       name.rfind("org.quiltmc:", 0) == 0 ||
                                       name.rfind("net.minecraftforge:", 0) == 0 ||
                                       name.rfind("cpw.mods:", 0) == 0);
            size_t before = library_tasks.size();
            const Json* downloads = lib.find("downloads");
            const Json* artifact = downloads ? downloads->find("artifact") : nullptr;
            bool added = add_artifact_task(library_tasks, artifact, paths.libraries, name, false,
                                           &lib, force_lib);
            bool native_artifact = name.find(":natives-") != std::string::npos;
            if (native_artifact && added) native_jars.push_back(library_tasks.back().dest);
            bool has_natives = false;
            if (const Json* natives = lib.find("natives")) {
                std::string classifier = json_str(natives, "windows");
                if (!classifier.empty()) {
                    has_natives = true;
                    size_t pos;
                    while ((pos = classifier.find("${arch}")) != std::string::npos)
                        classifier.replace(pos, 7, "64");
                    const Json* classifiers = downloads ? downloads->find("classifiers") : nullptr;
                    const Json* cls = classifiers ? classifiers->find(classifier.c_str()) : nullptr;
                    if (cls && jobject(cls)) {
                        DlTask task;
                        task.url = utf8_to_wide(json_str(cls, "url"));
                        std::string rel_path = json_str(cls, "path");
                        if (rel_path.empty()) {
                            LibParts parts = split_lib_name(name);
                            rel_path = wide_to_utf8(
                                maven_rel(parts.group, parts.artifact, parts.version, classifier));
                        }
                        task.dest = path_join(paths.libraries, utf8_to_wide(rel_path));
                        task.sha1 = json_str(cls, "sha1");
                        task.size = unum(cls, "size");
                        task.force = force_lib;
                        native_jars.push_back(task.dest);
                        library_tasks.push_back(task);
                        added = true;
                    } else if (!added) {
                        LibParts parts = split_lib_name(name);
                        std::wstring rel =
                            maven_rel(parts.group, parts.artifact, parts.version, classifier);
                        std::string base = json_str(&lib, "url");
                        if (base.empty()) base = kMavenBase;
                        if (base.back() != '/') base += '/';
                        DlTask task;
                        task.url = utf8_to_wide(base + wide_to_utf8(rel));
                        task.dest = path_join(paths.libraries, rel);
                        task.force = force_lib;
                        native_jars.push_back(task.dest);
                        library_tasks.push_back(task);
                        added = true;
                    }
                }
            }
            if (!added && !has_natives && artifact == nullptr) {
                added = add_artifact_task(library_tasks, nullptr, paths.libraries, name, true, &lib,
                                          force_lib);
            }
            (void)before;
        }
    }
    run_downloads(library_tasks, 12, L"libraries", progress, out.errors, cancel);

    if (cancel && cancel()) {
        out.error = L"Đã hủy cài đặt";
        report_phase(progress, L"error", L"error", true);
        return false;
    }

    if (const Json* downloads = chain.find("downloads")) {
        if (const Json* client = downloads->find("client")) {
            std::string url = json_str(client, "url");
            if (!url.empty()) {
                std::vector<DlTask> client_task;
                DlTask task;
                task.url = utf8_to_wide(url);
                task.dest = path_join(paths.versions, path_join(root_id, root_id + L".jar"));
                task.sha1 = json_str(client, "sha1");
                task.size = unum(client, "size");
                task.force = force;
                client_task.push_back(task);
                run_downloads(client_task, 1, L"client", progress, out.errors, cancel);
                out.has_client = is_fresh(client_task[0]);
            }
        }
    }
    if (!path_exists(path_join(paths.versions, path_join(root_id, root_id + L".jar"))))
        out.has_client = false;

    if (include_assets) {
        const Json* asset_index = chain.find("assetIndex");
        std::wstring index_id;
        if (asset_index) {
            index_id = wstr(asset_index, "id");
            std::wstring index_path =
                path_join(paths.assets_indexes, index_id + L".json");
            Json index;
            std::string body = read_file_utf8(index_path);
            bool have_index = !body.empty() && index.parse(body);
            if (!have_index) {
                std::vector<DlTask> index_tasks;
                DlTask task;
                task.url = wstr(asset_index, "url");
                task.dest = index_path;
                task.sha1 = json_str(asset_index, "sha1");
                task.size = unum(asset_index, "size");
                index_tasks.push_back(task);
                run_downloads(index_tasks, 1, L"index", progress, out.errors, cancel);
                body = read_file_utf8(index_path);
                have_index = !body.empty() && index.parse(body);
            }
            if (have_index) {
                std::vector<DlTask> asset_tasks;
                if (const Json* objects = index.find("objects")) {
                    for (const auto& kv : objects->obj) {
                        std::string hash = json_str(&kv.second, "hash");
                        if (hash.size() < 2) continue;
                        DlTask task;
                        task.url = utf8_to_wide(std::string(kResourcesBase) + hash.substr(0, 2) +
                                                "/" + hash);
                        task.dest = path_join(paths.assets_objects,
                                              utf8_to_wide(hash.substr(0, 2) + "/" + hash));
                        task.sha1 = hash;
                        task.size = unum(&kv.second, "size");
                        task.skip_hash = true;
                        asset_tasks.push_back(task);
                    }
                }
                run_downloads(asset_tasks, 20, L"assets", progress, out.errors, cancel);
            }
        }
    }

    if (!native_jars.empty()) {
        dir_create_all(out.natives_dir);
        for (const auto& jar : native_jars)
            if (path_exists(jar)) extract_native_jar(jar, out.natives_dir);
        if (dir_list(out.natives_dir).empty()) {
            for (const auto& jar : native_jars)
                if (path_exists(jar)) extract_native_jar(jar, out.natives_dir);
        }
    }

    // write vanilla profile json next to the jar
    {
        Json root;
        std::wstring root_err;
        if (mc_fetch_version(root_id, paths, root, &root_err))
            write_file_utf8(path_join(paths.versions, path_join(root_id, root_id + L".json")),
                            root.dump());
        write_file_utf8(path_join(paths.versions, path_join(version_id, version_id + L".json")),
                        chain.dump());
    }

    out.ok = true;
    report_phase(progress, L"done", L"done", true);
    return true;
}

bool mc_install_version(const std::wstring& version_id, const McPaths& paths, ProgressFn progress,
                        bool force, McInstall& out, CancelFn cancel) {
    return install_impl(version_id, paths, progress, force, true, out, cancel);
}

bool mc_ensure_launch_files(const std::wstring& version_id, const McPaths& paths,
                            ProgressFn progress, McInstall& out, CancelFn cancel) {
    return install_impl(version_id, paths, progress, false, false, out, cancel);
}

// ---------- launch ----------

static void flatten_args(const Json* list, std::vector<std::string>& out) {
    if (!jarray(list)) return;
    for (const auto& item : list->arr) {
        if (item.type == Json::Type::String) {
            out.push_back(item.str);
        } else if (item.type == Json::Type::Object) {
            if (!mc_rule_allows(item.find("rules"))) continue;
            const Json* value = item.find("value");
            if (!value) continue;
            if (value->type == Json::Type::String) out.push_back(value->str);
            else if (value->type == Json::Type::Array)
                for (const auto& v : value->arr)
                    if (v.type == Json::Type::String) out.push_back(v.str);
        }
    }
}

static std::wstring substitute(std::wstring text,
                               const std::vector<std::pair<std::string, std::wstring>>& vars) {
    for (const auto& kv : vars) {
        std::string token = "${" + kv.first + "}";
        size_t pos;
        while ((pos = text.find(utf8_to_wide(token))) != std::wstring::npos)
            text.replace(pos, token.size(), kv.second);
    }
    size_t start = 0;
    while ((start = text.find(L"${", start)) != std::wstring::npos) {
        size_t end = text.find(L'}', start);
        if (end == std::wstring::npos) break;
        text.erase(start, end - start + 1);
    }
    return text;
}

McLaunchPlan mc_build_launch(const Json& chain, const McInstall& install, const McPaths& paths,
                             const McLaunchOptions& options) {
    McLaunchPlan plan;
    const Json* libraries = chain.find("libraries");
    std::vector<std::wstring> classpath_parts;
    if (libraries && libraries->type == Json::Type::Array) {
        for (const auto& lib : libraries->arr) {
            if (!library_allowed(lib)) continue;
            const Json* downloads = lib.find("downloads");
            const Json* artifact = downloads ? downloads->find("artifact") : nullptr;
            if (!artifact) continue;
            std::string rel = json_str(artifact, "path");
            if (rel.empty()) continue;
            classpath_parts.push_back(path_join(paths.libraries, utf8_to_wide(rel)));
        }
    }
    std::wstring jar_path =
        path_join(paths.versions, path_join(install.jar_id, install.jar_id + L".jar"));
    if (path_exists(jar_path)) classpath_parts.push_back(jar_path);
    classpath_parts.push_back(install.natives_dir);
    std::wstring classpath;
    for (const auto& part : classpath_parts) {
        if (!classpath.empty()) classpath += L";";
        classpath += part;
    }
    plan.classpath = classpath;

    std::vector<std::string> jvm_flat;
    std::vector<std::string> game_flat;
    if (const Json* arguments = chain.find("arguments")) {
        flatten_args(arguments->find("jvm"), jvm_flat);
        flatten_args(arguments->find("game"), game_flat);
    }
    if (game_flat.empty()) {
        std::string legacy = chain.text("minecraftArguments");
        size_t start = 0;
        while (start < legacy.size()) {
            size_t space = legacy.find(' ', start);
            std::string token = legacy.substr(start, space == std::string::npos
                                                         ? std::string::npos
                                                         : space - start);
            if (!token.empty()) game_flat.push_back(token);
            if (space == std::string::npos) break;
            start = space + 1;
        }
    }

    std::string asset_index = "legacy";
    if (const Json* index = chain.find("assetIndex")) asset_index = json_str(index, "id");
    else if (!chain.text("assets").empty()) asset_index = chain.text("assets");

    std::vector<std::pair<std::string, std::wstring>> vars;
    vars.push_back({"auth_player_name", options.username});
    vars.push_back({"version_name", install.version_id});
    vars.push_back({"game_directory", options.instance_dir});
    vars.push_back({"assets_root", paths.assets});
    vars.push_back({"game_assets", paths.assets});
    vars.push_back({"assets_index_name", utf8_to_wide(asset_index)});
    vars.push_back({"auth_uuid", options.uuid});
    vars.push_back({"auth_access_token",
                    options.access_token.empty() ? L"0" : options.access_token});
    vars.push_back({"auth_session", options.access_token.empty()
                                        ? L"0"
                                        : L"token:" + options.access_token});
    vars.push_back({"clientid", L"0"});
    vars.push_back({"auth_xuid", options.xuid.empty() ? L"0" : options.xuid});
    vars.push_back({"user_type", options.user_type});
    vars.push_back({"version_type", utf8_to_wide(chain.text("type", "release"))});
    vars.push_back({"user_properties", L"{}"});
    vars.push_back({"natives_directory", install.natives_dir});
    vars.push_back({"launcher_name", L"XyoLauncher"});
    vars.push_back({"launcher_version", L"1.0.0"});
    vars.push_back({"classpath", classpath});
    vars.push_back({"classpath_separator", L";"});
    vars.push_back({"library_directory", paths.libraries});
    vars.push_back({"resolution_width", L"1280"});
    vars.push_back({"resolution_height", L"720"});
    vars.push_back({"quickPlayPath", L""});

    wchar_t mem[32];
    swprintf(mem, 32, L"-Xmx%dM", options.memory_mb > 0 ? options.memory_mb : 2048);
    plan.args.push_back(mem);
    if (!options.extra_jvm.empty()) {
        size_t start = 0;
        while (start < options.extra_jvm.size()) {
            while (start < options.extra_jvm.size() && options.extra_jvm[start] == L' ') ++start;
            size_t space = options.extra_jvm.find(L' ', start);
            std::wstring token = options.extra_jvm.substr(
                start, space == std::wstring::npos ? std::wstring::npos : space - start);
            if (!token.empty()) plan.args.push_back(token);
            if (space == std::wstring::npos) break;
            start = space + 1;
        }
    }
    plan.args.push_back(L"-Dfile.encoding=UTF-8");
    plan.args.push_back(L"-Dsun.stdout.encoding=UTF-8");
    plan.args.push_back(L"-Dsun.stderr.encoding=UTF-8");

    if (!jvm_flat.empty()) {
        for (const auto& arg : jvm_flat) plan.args.push_back(substitute(utf8_to_wide(arg), vars));
    } else {
        plan.args.push_back(L"-Djava.library.path=" + install.natives_dir);
        plan.args.push_back(L"-Dminecraft.launcher.brand=XyoLauncher");
        plan.args.push_back(L"-Dminecraft.launcher.version=1.0.0");
        plan.args.push_back(L"-cp");
        plan.args.push_back(classpath);
    }

    plan.args.push_back(utf8_to_wide(chain.text("mainClass")));
    for (const auto& arg : game_flat) plan.args.push_back(substitute(utf8_to_wide(arg), vars));
    if (options.demo) {
        bool has = false;
        for (const auto& arg : plan.args)
            if (arg == L"--demo") has = true;
        if (!has) plan.args.push_back(L"--demo");
    }
    if (options.quick_play_type == L"world" && !options.quick_play_value.empty()) {
        plan.args.push_back(L"--quickPlaySingleplayer");
        plan.args.push_back(options.quick_play_value);
    } else if (options.quick_play_type == L"server" && !options.quick_play_value.empty()) {
        plan.args.push_back(L"--quickPlayMultiplayer");
        plan.args.push_back(options.quick_play_value);
    }
    plan.ok = true;
    return plan;
}
