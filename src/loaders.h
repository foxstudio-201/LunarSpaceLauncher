#pragma once
#include "json.h"
#include "mc.h"
#include <string>

// Fetches the loader profile JSON (Fabric/Quilt) into <shared>/meta/versions so
// the normal install pipeline can merge and launch it like any other version.
bool loader_prepare_profile(const std::wstring& kind, const std::wstring& game,
                            const std::wstring& loader_version, const McPaths& paths,
                            std::wstring& out_version_id, std::wstring* err);
