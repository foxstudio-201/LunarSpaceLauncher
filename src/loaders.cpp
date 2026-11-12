#include "loaders.h"
#include "fs.h"
#include "net.h"

bool loader_prepare_profile(const std::wstring& kind, const std::wstring& game,
                            const std::wstring& loader_version, const McPaths& paths,
                            std::wstring& out_version_id, std::wstring* err) {
    std::wstring url;
    if (kind == L"fabric") {
        url = L"https://meta.fabricmc.net/v2/versions/loader/" + game + L"/" + loader_version +
              L"/profile/json";
    } else if (kind == L"quilt") {
        url = L"https://meta.quiltmc.org/v3/versions/loader/" + game + L"/" + loader_version +
              L"/profile/json";
    } else {
        if (err) *err = L"Loader \"" + kind + L"\" chưa được engine hỗ trợ.";
        return false;
    }

    std::wstring fallback_id = kind + L"-" + loader_version + L"-" + game;
    std::wstring fallback_file =
        path_join(paths.meta, path_join(L"versions", fallback_id + L".json"));
    std::string body = read_file_utf8(fallback_file);
    Json cached;
    if (!body.empty() && cached.parse(body) && cached.find("libraries")) {
        out_version_id = fallback_id;
        return true;
    }

    HttpResult res = http_request(url, L"GET");
    Json profile;
    if (!res.ok() || res.status != 200 || !profile.parse(res.body) ||
        !profile.find("libraries")) {
        if (err)
            *err = L"Không tải được profile " + kind + L" " + loader_version + L" cho " + game;
        return false;
    }
    std::wstring id = utf8_to_wide(profile.text("id"));
    if (id.empty()) id = fallback_id;
    std::wstring file = path_join(paths.meta, path_join(L"versions", id + L".json"));
    if (!write_file_utf8(file, res.body)) {
        if (err) *err = L"Không ghi được profile loader vào " + file;
        return false;
    }
    out_version_id = id;
    return true;
}
