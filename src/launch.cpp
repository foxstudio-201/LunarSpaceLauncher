#include "launch.h"
#include "common.h"
#include "fs.h"
#include "java.h"
#include "loaders.h"
#include "proc.h"
#include <algorithm>
#include <atomic>
#include <thread>

namespace {

std::wstring quote_arg(const std::wstring& value) {
    if (!value.empty() && value.find_first_of(L" \t\"") == std::wstring::npos) return value;
    std::wstring out = L"\"";
    for (wchar_t c : value) {
        if (c == L'"') out += L"\\\"";
        else out.push_back(c);
    }
    out += L"\"";
    return out;
}

std::wstring join_args(const std::vector<std::wstring>& args) {
    std::wstring cmd;
    for (const auto& arg : args) {
        if (!cmd.empty()) cmd += L' ';
        cmd += quote_arg(arg);
    }
    return cmd;
}

bool contains(const std::string& haystack, const char* needle) {
    return haystack.find(needle) != std::string::npos;
}

CrashInfo analyze_crash(const std::vector<std::string>& lines, int code) {
    CrashInfo info;
    std::string all;
    for (const auto& line : lines) {
        all += line;
        all += '\n';
    }
    const char* markers[] = {"Minecraft has crashed!",
                             "---- Minecraft Crash Report ----",
                             "A fatal error has been detected",
                             "Exception in thread",
                             "FormattedException",
                             "NoClassDefFoundError",
                             "ExceptionInInitializerError",
                             "UnsatisfiedLinkError",
                             "UnsupportedClassVersionError",
                             "OutOfMemoryError"};
    const char* matched = nullptr;
    for (const char* marker : markers) {
        if (contains(all, marker)) {
            matched = marker;
            break;
        }
    }
    if (matched) info.crashed = true;
    if (contains(all, "OutOfMemoryError")) {
        info.kind = L"memory";
        info.title = L"Hết bộ nhớ (OutOfMemoryError)";
        info.hint = L"Tăng RAM cho phiên bản hoặc giảm mod/shader.";
    } else if (contains(all, "UnsupportedClassVersionError")) {
        info.kind = L"java";
        info.title = L"Java không đúng phiên bản";
        info.hint = L"Chọn Java mới hơn cho phiên bản này.";
    } else if (contains(all, "UnsatisfiedLinkError") ||
               contains(all, "Failed to load") && contains(all, "natives")) {
        info.kind = L"natives";
        info.title = L"Lỗi thư viện native";
        info.hint = L"Thử tải lại phiên bản (Reinstall) hoặc cập nhật driver.";
    } else if (contains(all, "A fatal error has been detected")) {
        info.kind = L"jvm";
        info.title = L"Java bị lỗi nghiêm trọng";
        info.hint = L"Kiểm tra hs_err_pid trong thư mục phiên bản, thử Java khác.";
    } else if (contains(all, "NoClassDefFoundError") ||
               contains(all, "ExceptionInInitializerError") ||
               contains(all, "FormattedException")) {
        info.kind = L"mod";
        info.title = L"Mod hoặc loader gặp lỗi";
        info.hint = L"Kiểm tra mod không tương thích, xem log chi tiết.";
    } else if (matched) {
        info.kind = L"unknown";
        info.title = L"Game gặp lỗi khi khởi động";
        info.hint = L"Xem log trong Console để biết nguyên nhân.";
    } else if (code != 0) {
        info.title = L"Tiến trình thoát với mã " + std::to_wstring(code);
        info.hint = L"Xem log trong Console để biết nguyên nhân.";
    }
    if (info.crashed || code != 0) {
        size_t take = std::min<size_t>(lines.size(), 60);
        for (size_t i = lines.size() - take; i < lines.size(); ++i) {
            info.excerpt += utf8_to_wide(lines[i]);
            info.excerpt += L"\n";
        }
    }
    return info;
}

}  // namespace

struct LaunchManager::Job {
    InstanceLaunchSpec spec;
    LaunchCallbacks callbacks;
    std::thread thread;
    std::atomic<bool> stop_requested{false};
    std::atomic<bool> running{false};
    std::mutex proc_mutex;
    std::unique_ptr<ChildProcess> proc;

    void emit_state(const wchar_t* state) {
        if (callbacks.state) callbacks.state(spec.instance_id, state);
    }
    void emit_log(const std::wstring& line) {
        if (callbacks.log) callbacks.log(spec.instance_id, line);
    }
    void run();
};

struct LaunchManager::Impl {
    mutable std::mutex mutex;
    std::vector<std::unique_ptr<Job>> jobs;
};

LaunchManager::LaunchManager() : impl_(std::make_unique<Impl>()) {}

LaunchManager::~LaunchManager() {
    std::vector<std::unique_ptr<Job>> jobs;
    {
        std::lock_guard<std::mutex> lock(impl_->mutex);
        jobs.swap(impl_->jobs);
    }
    for (auto& job : jobs) {
        job->stop_requested.store(true);
        {
            std::lock_guard<std::mutex> lock(job->proc_mutex);
            if (job->proc) job->proc->stop();
        }
        if (job->thread.joinable()) job->thread.join();
    }
}

bool LaunchManager::start(const InstanceLaunchSpec& spec, LaunchCallbacks callbacks,
                          std::wstring* error) {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    for (const auto& job : impl_->jobs) {
        if (job->spec.instance_id == spec.instance_id && job->running.load()) {
            if (error) *error = L"Instance đang khởi chạy.";
            return false;
        }
    }
    for (auto it = impl_->jobs.begin(); it != impl_->jobs.end();) {
        if (!(*it)->running.load()) {
            if ((*it)->thread.joinable()) (*it)->thread.join();
            it = impl_->jobs.erase(it);
        } else {
            ++it;
        }
    }
    Job* raw = new Job();
    raw->spec = spec;
    raw->callbacks = std::move(callbacks);
    raw->running.store(true);
    impl_->jobs.emplace_back(std::unique_ptr<Job>(raw));
    raw->thread = std::thread([raw] { raw->run(); });
    return true;
}

void LaunchManager::stop(const std::wstring& instance_id) {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    for (auto& job : impl_->jobs) {
        if (job->spec.instance_id != instance_id) continue;
        job->stop_requested.store(true);
        if (job->callbacks.state) job->callbacks.state(instance_id, L"stopping");
        std::lock_guard<std::mutex> proc_lock(job->proc_mutex);
        if (job->proc) job->proc->stop();
    }
}

bool LaunchManager::running(const std::wstring& instance_id) const {
    std::lock_guard<std::mutex> lock(impl_->mutex);
    for (const auto& job : impl_->jobs)
        if (job->spec.instance_id == instance_id) return job->running.load();
    return false;
}

void LaunchManager::Job::run() {
    McPaths paths = mc_paths(spec.shared_dir);
    std::wstring version_id = spec.version_id;
    if (!spec.loader.empty() && spec.loader != L"vanilla") {
        std::wstring loader_error;
        std::wstring loader_id;
        if (!loader_prepare_profile(spec.loader, spec.version_id, spec.loader_version, paths,
                                    loader_id, &loader_error)) {
            running.store(false);
            if (callbacks.exit)
                callbacks.exit(spec.instance_id, -1, false, CrashInfo{},
                               loader_error.empty() ? L"Không chuẩn bị được loader." : loader_error);
            return;
        }
        emit_log(L"[XyoLauncher] Loader " + spec.loader + L" " + spec.loader_version + L" (" +
                 spec.version_id + L") → " + loader_id);
        version_id = loader_id;
    }
    McInstall install;
    bool ok = mc_install_version(version_id, paths,
                                 [this](const ProgressReport& report) {
                                     if (callbacks.progress) callbacks.progress(spec.instance_id, report);
                                 },
                                 false, install,
                                 [this] { return stop_requested.load(); });
    if (!ok) {
        running.store(false);
        if (stop_requested.load()) {
            if (callbacks.exit) callbacks.exit(spec.instance_id, -1, false, CrashInfo{}, L"");
            return;
        }
        if (callbacks.exit)
            callbacks.exit(spec.instance_id, -1, false, CrashInfo{},
                           install.error.empty() ? L"Không cài được tệp game." : install.error);
        return;
    }
    if (stop_requested.load()) {
        running.store(false);
        if (callbacks.exit) callbacks.exit(spec.instance_id, -1, false, CrashInfo{}, L"");
        return;
    }
    std::wstring java_error;
    JavaInfo java = java_resolve(spec.java_path, spec.settings_java, install.java_major,
                                 install.java_component, paths,
                                 [this](const ProgressReport& report) {
                                     if (callbacks.progress) callbacks.progress(spec.instance_id, report);
                                 },
                                 &java_error);
    if (java.path.empty()) {
        running.store(false);
        if (callbacks.exit)
            callbacks.exit(spec.instance_id, -1, false, CrashInfo{},
                           java_error.empty() ? L"Không tìm thấy Java." : java_error);
        return;
    }
    emit_state(L"starting");

    McLaunchOptions options;
    options.instance_dir = spec.instance_dir;
    options.username = spec.username;
    options.uuid = spec.uuid;
    options.access_token = spec.access_token;
    options.user_type = spec.user_type.empty() ? L"legacy" : spec.user_type;
    options.xuid = spec.xuid;
    options.memory_mb = spec.memory_mb;
    options.extra_jvm = spec.extra_jvm;
    options.demo = spec.demo;
    options.quick_play_type = spec.quick_play_type;
    options.quick_play_value = spec.quick_play_value;
    McLaunchPlan plan = mc_build_launch(install.chain, install, paths, options);
    if (!plan.ok) {
        running.store(false);
        if (callbacks.exit)
            callbacks.exit(spec.instance_id, -1, false, CrashInfo{},
                           plan.error.empty() ? L"Không dựng được lệnh khởi chạy." : plan.error);
        return;
    }

    dir_create_all(spec.instance_dir);

    std::vector<std::string> tail;
    std::mutex tail_mutex;
    ChildProcess* proc_raw = nullptr;
    {
        std::lock_guard<std::mutex> lock(proc_mutex);
        proc = std::make_unique<ChildProcess>();
        proc_raw = proc.get();
        bool started = proc_raw->start(java.path, join_args(plan.args), spec.instance_dir,
                                       [this, &tail, &tail_mutex](const std::string& line) {
                                           {
                                               std::lock_guard<std::mutex> lock(tail_mutex);
                                               tail.push_back(line);
                                               if (tail.size() > 200) tail.erase(tail.begin());
                                           }
                                           emit_log(utf8_to_wide(line));
                                       });
        if (!started) {
            proc.reset();
            running.store(false);
            if (callbacks.exit)
                callbacks.exit(spec.instance_id, -1, false, CrashInfo{},
                               L"Không chạy được Java: " + java.path);
            return;
        }
    }
    emit_state(L"running");
    int code = proc_raw->wait();
    {
        std::lock_guard<std::mutex> lock(proc_mutex);
        proc.reset();
    }
    running.store(false);
    bool user_stopped = stop_requested.load();
    CrashInfo crash;
    if (!user_stopped && code != 0) {
        std::lock_guard<std::mutex> lock(tail_mutex);
        crash = analyze_crash(tail, code);
    }
    if (callbacks.exit) callbacks.exit(spec.instance_id, code, crash.crashed, crash, L"");
}
