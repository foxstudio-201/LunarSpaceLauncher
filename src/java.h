#pragma once
#include "mc.h"
#include <string>
#include <vector>

struct JavaInfo {
    std::wstring path;
    int major = 0;
    std::wstring raw;
    std::wstring source;
};

bool java_probe(const std::wstring& exe, JavaInfo& out);
std::vector<JavaInfo> java_scan_system();
bool java_install_component(const std::wstring& component, const McPaths& paths, ProgressFn progress,
                            std::wstring* error, JavaInfo* out);
std::vector<JavaInfo> java_list_managed(const McPaths& paths);
bool java_component_for_major(const McPaths& paths, int major, std::wstring& component);
JavaInfo java_resolve(const std::wstring& instance_java, const std::wstring& settings_java,
                      int major, const std::wstring& component, const McPaths& paths,
                      ProgressFn progress, std::wstring* error);
