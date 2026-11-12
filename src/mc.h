#pragma once
#include "json.h"
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

struct McPaths {
    std::wstring shared;
    std::wstring meta;
    std::wstring versions;
    std::wstring libraries;
    std::wstring assets;
    std::wstring assets_indexes;
    std::wstring assets_objects;
    std::wstring natives;
    std::wstring runtime;
};

McPaths mc_paths(const std::wstring& shared_dir);

struct ProgressReport {
    std::wstring phase;
    std::wstring label;
    std::wstring file;
    uint64_t done = 0;
    uint64_t total = 0;
    uint64_t bytes = 0;
    uint64_t bytes_total = 0;
    bool final_report = false;
};
using ProgressFn = std::function<void(const ProgressReport&)>;
using CancelFn = std::function<bool()>;

struct McInstall {
    bool ok = false;
    std::wstring error;
    Json chain;
    std::wstring version_id;
    std::wstring jar_id;
    std::wstring natives_dir;
    int java_major = 8;
    std::wstring java_component;
    bool has_client = false;
    std::vector<std::pair<std::wstring, std::wstring>> errors;
};

Json mc_manifest(const McPaths& paths, bool force, std::wstring* err);
bool mc_fetch_version(const std::wstring& id, const McPaths& paths, Json& out, std::wstring* err);
Json mc_chain(const std::wstring& id, const McPaths& paths, std::wstring* err);
bool mc_install_version(const std::wstring& version_id, const McPaths& paths, ProgressFn progress,
                        bool force, McInstall& out, CancelFn cancel = {});
bool mc_ensure_launch_files(const std::wstring& version_id, const McPaths& paths,
                            ProgressFn progress, McInstall& out, CancelFn cancel = {});

struct McLaunchOptions {
    std::wstring instance_dir;
    std::wstring username;
    std::wstring uuid;
    std::wstring access_token;
    std::wstring user_type = L"legacy";
    std::wstring xuid;
    int memory_mb = 4096;
    std::wstring extra_jvm;
    bool demo = false;
    std::wstring quick_play_type;
    std::wstring quick_play_value;
};

struct McLaunchPlan {
    bool ok = false;
    std::wstring error;
    std::vector<std::wstring> args;
    std::wstring classpath;
};

McLaunchPlan mc_build_launch(const Json& chain, const McInstall& install, const McPaths& paths,
                             const McLaunchOptions& options);

bool mc_rule_allows(const Json* rules);
