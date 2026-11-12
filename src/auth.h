#pragma once
#include <windows.h>
#include <string>
#include "json.h"

struct AuthSession {
    bool ok = false;
    std::wstring error;
    std::wstring name;
    std::wstring uuid;
    std::wstring xuid;
    std::wstring access_token;
    std::wstring refresh_token;
    std::wstring client_token;
    long long expires_at = 0;
    std::string token_json;
};

AuthSession microsoft_login();
AuthSession microsoft_refresh(const std::wstring& refresh_token);
AuthSession ely_login(const std::wstring& username, const std::wstring& password);
AuthSession ely_refresh(const std::wstring& access_token, const std::wstring& client_token);
bool ely_validate(const std::wstring& access_token, const std::wstring& client_token);
std::wstring ensure_ely_injector(std::wstring* error);
