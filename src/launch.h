#pragma once
#include "mc.h"
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

struct CrashInfo {
    bool crashed = false;
    std::wstring kind;
    std::wstring title;
    std::wstring hint;
    std::wstring excerpt;
};

struct InstanceLaunchSpec {
    std::wstring instance_id;
    std::wstring instance_dir;
    std::wstring version_id;
    std::wstring username;
    std::wstring uuid;
    std::wstring access_token;
    std::wstring user_type;
    std::wstring xuid;
    std::wstring java_path;
    std::wstring settings_java;
    std::wstring extra_jvm;
    std::wstring quick_play_type;
    std::wstring quick_play_value;
    std::wstring shared_dir;
    int memory_mb = 4096;
    bool demo = false;
};

struct LaunchCallbacks {
    std::function<void(const std::wstring& instance_id, const ProgressReport&)> progress;
    std::function<void(const std::wstring& instance_id, const std::wstring& line)> log;
    std::function<void(const std::wstring& instance_id, const std::wstring& state)> state;
    std::function<void(const std::wstring& instance_id, int exit_code, bool crashed,
                       const CrashInfo& crash, const std::wstring& error)>
        exit;
};

class LaunchManager {
public:
    LaunchManager();
    ~LaunchManager();
    LaunchManager(const LaunchManager&) = delete;
    LaunchManager& operator=(const LaunchManager&) = delete;
    bool start(const InstanceLaunchSpec& spec, LaunchCallbacks callbacks, std::wstring* error);
    void stop(const std::wstring& instance_id);
    bool running(const std::wstring& instance_id) const;

private:
    struct Job;
    struct Impl;
    std::unique_ptr<Impl> impl_;
};
