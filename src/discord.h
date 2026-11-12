#pragma once
#include <windows.h>
#include <string>

struct DiscordResult {
    bool ok = false;
    std::wstring error;
    std::wstring name;
    std::wstring uuid;
    std::wstring account_id;
    std::wstring discord_name;
    std::wstring discord_tag;
    std::wstring discord_avatar;
    std::wstring link_id;
    bool created = false;
    bool conflict = false;
    std::wstring holder;
    std::wstring moved_from;
    bool replaced = false;
};

using DiscordNotify = void (*)(void* ctx, const std::wstring& url);
DiscordResult discord_link_flow(const std::wstring& api_url, const std::wstring& api_key,
                                const std::wstring& name, const std::wstring& account_id,
                                const std::wstring& account_uuid, bool force,
                                DiscordNotify notify = nullptr, void* ctx = nullptr);
void discord_cancel_link();
std::string discord_links_body(const std::wstring& api_url, const std::wstring& api_key);
bool discord_unlink(const std::wstring& api_url, const std::wstring& api_key,
                    const std::wstring& link_id, std::wstring* error);
