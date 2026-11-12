#include "common.h"
#include "render.h"
#include "ui.h"
#include "json.h"
#include "net.h"
#include "auth.h"
#include "discord.h"
#include <d2d1helper.h>
#include <windowsx.h>
#include <shellapi.h>
#include <string>
#include <vector>
#include <cmath>
#include <cstdio>
#include <ctime>

#pragma comment(lib, "d2d1")

namespace {

constexpr UINT kSplashTimer = 1;

ULONGLONG now_ms() { return GetTickCount64(); }
static std::wstring head_cache_dir();

void hsl_to_rgb(float h, float s, float l, float& r, float& g, float& b) {
    float c = (1.0f - std::fabs(2.0f * l - 1.0f)) * s;
    float hp = std::fmod(std::fmod(h, 360.0f) + 360.0f, 360.0f) / 60.0f;
    float x = c * (1.0f - std::fabs(std::fmod(hp, 2.0f) - 1.0f));
    float r1 = 0, g1 = 0, b1 = 0;
    if (hp < 1.0f) { r1 = c; g1 = x; }
    else if (hp < 2.0f) { r1 = x; g1 = c; }
    else if (hp < 3.0f) { g1 = c; b1 = x; }
    else if (hp < 4.0f) { g1 = x; b1 = c; }
    else if (hp < 5.0f) { r1 = x; b1 = c; }
    else { r1 = c; b1 = x; }
    float m = l - c * 0.5f;
    r = (r1 + m) * 255.0f;
    g = (g1 + m) * 255.0f;
    b = (b1 + m) * 255.0f;
}

float bezier_y(float x, float x1, float y1, float x2, float y2) {
    x = std::clamp(x, 0.0f, 1.0f);
    auto axis = [](float t, float p1, float p2) {
        float mt = 1.0f - t;
        return 3.0f * mt * mt * t * p1 + 3.0f * mt * t * t * p2 + t * t * t;
    };
    float lo = 0.0f, hi = 1.0f, t = x;
    for (int i = 0; i < 24; ++i) {
        float cx = axis(t, x1, x2);
        if (std::fabs(cx - x) < 1e-4f) break;
        if (cx < x) lo = t; else hi = t;
        t = (lo + hi) * 0.5f;
    }
    return axis(t, y1, y2);
}

float spring_ease(float x) { return bezier_y(x, 0.34f, 1.45f, 0.64f, 1.0f); }

float menu_ease(float x) { return bezier_y(x, 0.16f, 1.0f, 0.3f, 1.0f); }

float ease_split(float x) {    x = std::clamp(x, 0.0f, 1.0f);
    auto axis = [](float t, float p1, float p2) {
        float mt = 1.0f - t;
        return 3.0f * mt * mt * t * p1 + 3.0f * mt * t * t * p2 + t * t * t;
    };
    float lo = 0.0f, hi = 1.0f, t = x;
    for (int i = 0; i < 24; ++i) {
        float cx = axis(t, 0.76f, 0.24f);
        if (std::fabs(cx - x) < 1e-4f) break;
        if (cx < x) lo = t; else hi = t;
        t = (lo + hi) * 0.5f;
    }
    return axis(t, 0.0f, 1.0f);
}

struct Rng {
    unsigned long long state;
    explicit Rng(unsigned long long seed) : state(seed ? seed : 1) {}
    float next() {
        state = state * 6364136223846793005ull + 1442695040888963407ull;
        return float((state >> 33) & 0xFFFFFFFFull) / 4294967295.0f;
    }
};

struct Particle {
    float x = 0, y = 0, vx = 0, vy = 0, tx = 0, ty = 0, hue = 270.0f;
};

struct Splash {
    enum class Phase { None, Video, Loading, Open };
    Phase phase = Phase::None;
    std::vector<std::wstring> frames;
    size_t index = 0;
    ULONGLONG started = 0;
    ULONGLONG phase_start = 0;
    ULONGLONG open_start = 0;
    std::vector<std::pair<float, float>> schedule;
    float total_ms = 0.0f;
    std::vector<Particle> particles;
    std::vector<unsigned char> pixel_buffer;
    int particle_w = 1120;
    int particle_h = 300;
    ULONGLONG particle_last = 0;
    bool particles_ready = false;
};

struct Toast {
    int id = 0;
    std::wstring title;
    std::wstring message;
    std::wstring tone = L"info";
    float total = 4200.0f;
    float left = 4200.0f;
    ULONGLONG start = 0;
    ULONGLONG exit_start = 0;
    bool exiting = false;
    D2D1_RECT_F rect = D2D1::RectF();
    D2D1_RECT_F close_rect = D2D1::RectF();
    float draw_scale = 1.0f;
    float draw_alpha = 1.0f;
};

struct Account {
    std::wstring id;
    std::wstring name;
    std::wstring type;
    std::wstring uuid;
    std::wstring xuid;
    std::wstring head;
    Json raw;
};

struct InstanceInfo {
    std::wstring id;
    std::wstring name;
    std::wstring version;
    std::wstring loader;
    std::wstring status;
    std::wstring icon;
};

struct AuthResult {
    int kind = 0;
    bool ok = false;
    std::wstring error;
    std::wstring name;
    std::wstring uuid;
    std::wstring xuid;
    std::string token_json;
};

struct ModalLayout {
    D2D1_RECT_F card = D2D1::RectF();
    D2D1_RECT_F close = D2D1::RectF();
    D2D1_RECT_F kinds[4]{};
    D2D1_RECT_F name_input = D2D1::RectF();
    D2D1_RECT_F user_input = D2D1::RectF();
    D2D1_RECT_F pass_input = D2D1::RectF();
    D2D1_RECT_F eye = D2D1::RectF();
    D2D1_RECT_F cancel = D2D1::RectF();
    D2D1_RECT_F submit = D2D1::RectF();
};

struct DiscordLink {
    std::wstring id;
    std::wstring account_id;
    std::wstring account_uuid;
    std::wstring account_name;
    std::wstring discord_name;
    std::wstring discord_tag;
    std::wstring discord_avatar;
};

struct DiscordAuthResult {
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
};

struct DiscordJob {
    HWND hwnd = nullptr;
    std::wstring api_url;
    std::wstring api_key;
    std::wstring name;
    std::wstring account_id;
    std::wstring account_uuid;
};

struct AuthJob {
    HWND hwnd = nullptr;
    int kind = 0;
    std::wstring user;
    std::wstring pass;
};

class App {
public:
    explicit App(HWND hwnd) : hwnd_(hwnd) {}
    ~App() { remove_tray(); }

    bool init();
    void tick();
    void paint();
    void on_resize();
    void on_mouse_move(int px, int py);
    void on_mouse_down(int px, int py);
    void on_mouse_up(int px, int py);
    void on_double_click(int px, int py);
    void add_tray();
    void remove_tray();
    void on_tray(UINT event);
    void toggle_window();
    void toggle_theme();
    std::wstring active_nav_id() const;
    void on_key_down(WPARAM key);
    void on_char(wchar_t ch);
    void handle_auth_result(LPARAM lp) { apply_auth_result(reinterpret_cast<AuthResult*>(lp)); }
    void handle_discord_links_msg(LPARAM lp) { auto* body = reinterpret_cast<std::string*>(lp); if (body) { apply_discord_links_body(*body); delete body; } }
    void handle_discord_result_msg(LPARAM lp) { auto* result = reinterpret_cast<DiscordAuthResult*>(lp); if (result) { apply_discord_result(result); delete result; } }
    void handle_unlink_msg(LPARAM lp) { auto* payload = reinterpret_cast<std::pair<bool, std::wstring>*>(lp); if (payload) { handle_unlink_result(payload->first, payload->second); delete payload; } }
    void on_dpi_changed();
    bool splash_active() const { return splash_.phase != Splash::Phase::None; }

private:
    void ui_apply_page();
    void do_action(const std::wstring& action);
    void start_pill_slide();
    void toggle_account_menu();
    void draw_account_menu();
    void select_account(const std::wstring& id);
    void close_account_menu();
    void save_settings();
    void save_token(const std::wstring& id, const std::string& json);
    std::wstring settings_path() const;
    void load_data();
    void save_accounts();
    void rebuild_account_rows();
    void rebuild_instance_rows();
    const Account* find_account(const std::wstring& id) const;
    const Account* active_account() const;
    std::wstring account_head(const std::wstring& name) const;
    void refresh_discord_links();
    void apply_discord_links_body(const std::string& body);
    const DiscordLink* discord_link_for(const Account& account) const;
    void open_discord_link_modal(const std::wstring& account_id);
    void start_discord_job();
    void apply_discord_result(DiscordAuthResult* result);
    void unlink_discord(const std::wstring& account_id);
    void handle_unlink_result(bool ok, const std::wstring& error);
    std::wstring resolve_head(const Account& account, bool network);
    std::wstring account_kind_label(const std::wstring& type) const;
    void open_account_modal();
    void close_account_modal();
    ModalLayout modal_layout() const;
    bool modal_valid() const;
    void draw_account_modal();
    bool account_modal_mouse_down(int px, int py);
    bool account_modal_key(WPARAM key);
    bool account_modal_char(wchar_t ch);
    void submit_account_modal();
    void start_auth_job(int kind);
    void apply_auth_result(AuthResult* result);
    void notify(const std::wstring& title, const std::wstring& message,
                const std::wstring& tone = L"info", float duration = 4200.0f);
    void update_toasts(ULONGLONG now);
    void draw_toasts();
    void layout_toasts();
    bool toast_mouse_down(int px, int py);
    bool toast_mouse_move(int px, int py);
    void update_splash(ULONGLONG now);
    void draw_splash(ULONGLONG now);
    void build_particles();
    void step_particles(ULONGLONG now);
    float splash_progress(ULONGLONG now) const;
    std::wstring asset(const std::wstring& rel) const { return base_ + L"\\" + rel; }

    HWND hwnd_ = nullptr;
    Renderer renderer_;
    std::unique_ptr<Node> ui_;
    Node* hovered_ = nullptr;
    std::wstring pressed_;
    std::wstring page_ = L"home";
    bool dirty_ = true;
    std::wstring base_;
    Splash splash_;
    Rng rng_{ 0xC0FFEE12345678ull };
    HICON tray_icon_ = nullptr;
    NOTIFYICONDATAW tray_{};
    bool tray_added_ = false;
    bool dark_ = true;
    bool theme_animating_ = false;
    bool pill_animating_ = false;
    bool pill_pending_ = true;
    bool pill_show_ = false;
    bool laid_out_ = false;
    float pill_cur_ = 0.0f, pill_from_ = 0.0f, pill_to_ = 0.0f;
    ULONGLONG pill_start_ = 0;
    std::unique_ptr<Node> menu_;
    bool menu_open_ = false;
    bool menu_animating_ = false;
    float menu_t_ = 0.0f;
    ULONGLONG menu_start_ = 0;
    bool caret_animating_ = false;
    float caret_cur_ = 0.0f, caret_from_ = 0.0f, caret_to_ = 0.0f;
    ULONGLONG caret_start_ = 0;
    std::vector<Account> accounts_;
    std::wstring active_id_;
    std::vector<InstanceInfo> instances_;
    std::vector<DiscordLink> discord_links_;
    std::wstring discord_api_url_;
    std::wstring discord_api_key_;
    std::wstring modal_discord_account_;
    Json skin_index_;
    bool accounts_skin_ = false;
    bool skin_upload_ = true;
    bool modal_open_ = false;
    int modal_kind_ = 0;
    int modal_focus_ = 0;
    bool modal_show_pass_ = false;
    bool modal_busy_ = false;
    std::wstring modal_name_;
    std::wstring modal_user_;
    std::wstring modal_pass_;
    std::wstring modal_error_;
    std::vector<Toast> toasts_;
    int toast_seq_ = 0;
    float mouse_x_ = 0.0f;
    float mouse_y_ = 0.0f;
    bool toast_open_ = false;
    bool toast_close_hover_ = false;
    ULONGLONG toast_last_ = 0;
};

bool App::init() {
    wchar_t exe[MAX_PATH]{};
    GetModuleFileNameW(nullptr, exe, MAX_PATH);
    base_ = exe;
    size_t slash = base_.find_last_of(L"\\/");
    if (slash != std::wstring::npos) base_.resize(slash);

    if (!renderer_.init(hwnd_)) {
        MessageBoxW(hwnd_, L"Không khởi tạo được Direct3D/Direct2D.", L"XyoEngine", MB_ICONERROR);
        return false;
    }
    ui_ = ui_parse(base_ + L"\\ui\\shell.xui");
    if (!ui_) {
        MessageBoxW(hwnd_, L"Không đọc được ui/shell.xui.", L"XyoEngine", MB_ICONERROR);
        return false;
    }
    menu_ = ui_parse(base_ + L"\\ui\\account-menu.xui");
    wchar_t value[32]{};
    GetPrivateProfileStringW(L"engine", L"theme", L"dark", value, 32, settings_path().c_str());
    dark_ = wcscmp(value, L"light") != 0;
    ui_set_dark(dark_);
    ui_set_theme_anim(dark_ ? 1.0f : 0.0f);
    load_data();
    ui_apply_page();

    for (int i = 1; i <= 156; ++i) {
        wchar_t name[64];
        swprintf(name, 64, L"assets\\splash\\frame_%03d.jpg", i);
        std::wstring path = asset(name);
        if (GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES)
            splash_.frames.push_back(path);
    }
    if (!splash_.frames.empty()) {
        splash_.phase = Splash::Phase::Video;
        splash_.started = splash_.phase_start = now_ms();
        renderer_.image(splash_.frames[0]);
        SetTimer(hwnd_, kSplashTimer, 16, nullptr);
    }
    add_tray();
    dirty_ = true;
    return true;
}

void App::ui_apply_page() {
    if (!ui_) return;
    struct PageLabel { const wchar_t* key; const wchar_t* title; const wchar_t* nav; };
    static const PageLabel pages[] = {
        { L"home", L"Trang chủ", L"nav-home" },
        { L"versions", L"Phiên bản", L"nav-versions" },
        { L"modpacks", L"Modpack", L"nav-modpacks" },
        { L"accounts", L"Tài khoản", L"nav-accounts" },
        { L"settings", L"Cài đặt", nullptr },
    };
    const PageLabel* current = &pages[0];
    for (const auto& page : pages)
        if (page_ == page.key) current = &page;

    if (Node* title = ui_find(ui_.get(), L"page-title")) title->text = current->title;
    if (Node* ph = ui_find(ui_.get(), L"placeholder-title")) ph->text = current->title;
    if (Node* sub = ui_find(ui_.get(), L"page-subtitle")) {
        if (page_ == L"accounts")
            sub->text = L"Tài khoản dùng khi khởi chạy game";
        else if (page_ == L"home") {
            wchar_t sub_text[128];
            swprintf(sub_text, 128, L"103 bản phát hành · %d phiên bản đã tạo · mới nhất 26.3",
                     int(instances_.size()));
            sub->text = sub_text;
        }
        else if (page_ == L"modpacks")
            sub->text = L"Quản lý modpack và nội dung tải về";
        else if (page_ == L"versions")
            sub->text = L"Tạo và quản lý phiên bản";
        else
            sub->text = L"Cấu hình launcher và trò chơi";
    }
    bool skin_wide = page_ == L"accounts" && accounts_skin_;
    ui_set_visible(ui_find(ui_.get(), L"content-header"), !skin_wide);
    ui_set_visible(ui_find(ui_.get(), L"home-view"), page_ == L"home");
    ui_set_visible(ui_find(ui_.get(), L"accounts-view"), page_ == L"accounts");
    ui_set_visible(ui_find(ui_.get(), L"placeholder"),
                   page_ != L"home" && page_ != L"accounts");
    ui_set_visible(ui_find(ui_.get(), L"home-tabs"), page_ == L"home");
    ui_set_visible(ui_find(ui_.get(), L"accounts-tabs"), page_ == L"accounts" && !skin_wide);
    ui_set_visible(ui_find(ui_.get(), L"header-tools-home"), page_ == L"home");
    ui_set_visible(ui_find(ui_.get(), L"header-tools-accounts"), page_ == L"accounts");
    ui_set_visible(ui_find(ui_.get(), L"accounts-list-view"),
                   page_ == L"accounts" && !accounts_skin_);
    ui_set_visible(ui_find(ui_.get(), L"skin-view"), skin_wide);
    ui_set_visible(ui_find(ui_.get(), L"skin-upload"),
                   page_ == L"accounts" && accounts_skin_ && skin_upload_);
    ui_set_visible(ui_find(ui_.get(), L"skin-draw"),
                   page_ == L"accounts" && accounts_skin_ && !skin_upload_);

    auto tab_style = [&](const wchar_t* id, const wchar_t* label, bool active) {
        if (Node* tab = ui_find(ui_.get(), id)) {
            tab->style.bg = active ? ui_token(L"input") : Color{};
            tab->style.border = active;
            if (active) tab->style.border_color = ui_token(L"border");
        }
        if (Node* text = ui_find(ui_.get(), label))
            text->style.color = ui_token(active ? L"text" : L"faint");
    };
    tab_style(L"tab-list", L"label-tab-list", !accounts_skin_);
    tab_style(L"tab-skin", L"label-tab-skin", accounts_skin_);

    auto mode_style = [&](const wchar_t* id, const wchar_t* label, bool active) {
        if (Node* tab = ui_find(ui_.get(), id))
            tab->style.bg = active ? ui_token(L"accent") : Color{};
        if (Node* text = ui_find(ui_.get(), label))
            text->style.color = ui_token(active ? L"ink" : L"label");
    };
    mode_style(L"skin-mode-draw", L"label-mode-draw", !skin_upload_);
    mode_style(L"skin-mode-upload", L"label-mode-upload", skin_upload_);

    const Account* active = active_account();
    std::wstring active_name = active ? active->name : L"Chưa có tài khoản";
    const Account* skin_account = nullptr;
    if (active && active->type == L"offline") skin_account = active;
    if (!skin_account)
        for (const auto& candidate : accounts_)
            if (candidate.type == L"offline") { skin_account = &candidate; break; }
    if (!skin_account) skin_account = active;
    if (Node* skin_name = ui_find(ui_.get(), L"skin-account-name"))
        skin_name->text = skin_account ? skin_account->name : L"Chưa có tài khoản ngoại tuyến";
    if (Node* name = ui_find(ui_.get(), L"label-account"))
        name->text = active_name;
    if (Node* head = ui_find(ui_.get(), L"acct-head")) {
        head->src = active ? account_head(active->name) : L"";
        head->style.visible = active && !head->src.empty();
    }

    for (const auto& page : pages) {
        if (!page.nav) continue;
        if (Node* nav = ui_find(ui_.get(), page.nav)) {
            nav->style.accent = false;
            nav->style.bg = Color{};
            bool active = page_ == page.key;
            std::wstring suffix = std::wstring(page.nav).substr(4);
            if (Node* label = ui_find(ui_.get(), L"label-" + suffix)) {
                label->style.color = ui_token(active ? L"text" : L"label");
                label->style.hover_color = ui_token(L"text");
            }
            if (Node* icon = ui_find(ui_.get(), L"icon-" + suffix)) {
                icon->style.color = ui_token(active ? L"accent" : L"label");
                icon->style.hover_color = ui_token(active ? L"accent" : L"text");
            }
        }
    }
    if (Node* acct = ui_find(ui_.get(), L"acct-btn")) {
        acct->style.bg = ui_token(page_ == L"accounts" ? L"surfaceActive" : L"hover");
        acct->style.accent = false;
    }
    rebuild_account_rows();
    start_pill_slide();
    dirty_ = true;
}

void App::load_data() {
    accounts_.clear();
    instances_.clear();
    Json root;
    root.parse(read_file_utf8(user_data_dir() + L"\\settings.json"));
    discord_api_url_ = L"http://a29sv1.bumboohost.vn:25691";
    discord_api_key_ = L"80e48059386dd0f5b0831af9a6990d7b4e5482657d626853";
    if (const Json* discord = root.find("discord")) {
        std::string url = discord->text("apiUrl");
        std::string key = discord->text("apiKey");
        if (!url.empty()) discord_api_url_ = utf8_to_wide(url);
        if (!key.empty()) discord_api_key_ = utf8_to_wide(key);
    }
    if (const Json* list = root.find("accounts")) {
        for (const auto& item : list->arr) {
            if (item.type != Json::Type::Object) continue;
            Account account;
            account.id = utf8_to_wide(item.text("id"));
            account.name = utf8_to_wide(item.text("name"));
            account.type = utf8_to_wide(item.text("type", "offline"));
            account.uuid = utf8_to_wide(item.text("uuid"));
            account.xuid = utf8_to_wide(item.text("xuid"));
            account.raw = item;
            if (!account.id.empty()) accounts_.push_back(std::move(account));
        }
    }
    active_id_ = utf8_to_wide(root.text("activeAccountId"));
    if (!find_account(active_id_) && !accounts_.empty()) active_id_ = accounts_.front().id;

    Json skin_cache;
    skin_cache.parse(read_file_utf8(head_cache_dir() + L"\\index.json"));
    skin_index_ = skin_cache.type == Json::Type::Object ? skin_cache : Json::object();
    for (auto& account : accounts_) account.head = resolve_head(account, false);

    Json index;
    index.parse(read_file_utf8(user_data_dir() + L"\\instances.json"));
    for (const auto& item : index.arr) {
        if (item.type != Json::Type::Object) continue;
        InstanceInfo info;
        info.id = utf8_to_wide(item.text("id"));
        info.name = utf8_to_wide(item.text("name", item.text("version")));
        info.version = utf8_to_wide(item.text("version"));
        info.loader = utf8_to_wide(item.text("loader", "vanilla"));
        info.status = utf8_to_wide(item.text("status", "ready"));
        std::wstring dir = utf8_to_wide(item.text("dir"));
        std::wstring local_icon = dir + L"\\icon.png";
        if (!dir.empty() && GetFileAttributesW(local_icon.c_str()) != INVALID_FILE_ATTRIBUTES)
            info.icon = local_icon;
        instances_.push_back(std::move(info));
    }
    rebuild_instance_rows();
    rebuild_account_rows();
    refresh_discord_links();
}

const Account* App::find_account(const std::wstring& id) const {
    for (const auto& account : accounts_)
        if (account.id == id) return &account;
    return nullptr;
}

const Account* App::active_account() const { return find_account(active_id_); }

static std::wstring head_cache_dir() {
    std::wstring dir = user_data_dir() + L"\\skin-cache";
    CreateDirectoryW(dir.c_str(), nullptr);
    return dir;
}

static std::wstring safe_id(const std::wstring& value) {
    std::wstring out;
    for (wchar_t c : value)
        if ((c >= L'a' && c <= L'z') || (c >= L'A' && c <= L'Z') ||
            (c >= L'0' && c <= L'9') || c == L'-' || c == L'_')
            out.push_back(c);
    return out;
}

static std::string dashless_lower(const std::wstring& uuid) {
    std::string out;
    for (char c : wide_to_utf8(uuid))
        if (c != '-') out.push_back(char(tolower((unsigned char)c)));
    return out;
}

static std::string texture_url_of_profile(const std::string& body) {
    Json profile;
    if (!profile.parse(body)) return "";
    const Json* props = profile.find("properties");
    if (!props) return "";
    for (const auto& prop : props->arr) {
        if (prop.text("name") != "textures") continue;
        std::vector<unsigned char> decoded = base64_decode(prop.text("value"));
        Json textures;
        if (!textures.parse(std::string(decoded.begin(), decoded.end()))) continue;
        const Json* tex = textures.find("textures");
        if (!tex) continue;
        const Json* skin = tex->find("SKIN");
        if (skin) return skin->text("url");
    }
    return "";
}

static std::wstring skin_texture_url(const Account& account) {
    std::string hex = dashless_lower(account.uuid);
    if (account.type == L"microsoft" && hex.size() == 32) {
        HttpResult res = http_request(utf8_to_wide("https://sessionserver.mojang.com/session/minecraft/profile/" + hex), L"GET");
        return utf8_to_wide(texture_url_of_profile(res.body));
    }
    if (account.type == L"ely" && hex.size() == 32) {
        HttpResult res = http_request(utf8_to_wide("https://authserver.ely.by/sessionserver/session/minecraft/profile/" + hex), L"GET");
        return utf8_to_wide(texture_url_of_profile(res.body));
    }
    std::string name = wide_to_utf8(account.name);
    if (name.empty()) return L"";
    HttpResult res = http_request(utf8_to_wide("https://api.mojang.com/users/profiles/minecraft/" + url_encode(name)), L"GET");
    Json user;
    user.parse(res.body);
    std::string id = user.text("id");
    if (id.empty()) return L"";
    HttpResult profile = http_request(utf8_to_wide("https://sessionserver.mojang.com/session/minecraft/profile/" + id), L"GET");
    return utf8_to_wide(texture_url_of_profile(profile.body));
}

std::wstring App::resolve_head(const Account& account, bool network) {
    std::wstring cache = head_cache_dir();
    std::wstring head = cache + L"\\head-" + safe_id(account.uuid) + L".png";
    std::wstring shared = user_data_dir() + L"\\shared";
    Json settings;
    settings.parse(read_file_utf8(user_data_dir() + L"\\settings.json"));
    std::string shared_dir = settings.text("sharedDir");
    if (!shared_dir.empty()) shared = utf8_to_wide(shared_dir);
    std::wstring custom = shared + L"\\skins\\" + safe_id(account.uuid) + L".png";

    std::string key = account.type == L"microsoft" ? "m-" + dashless_lower(account.uuid)
                      : account.type == L"ely"       ? "e-" + dashless_lower(account.uuid)
                                                     : "n-" + wide_to_utf8(account.name);
    std::string lower_key = key;
    for (char& c : lower_key) c = char(tolower((unsigned char)c));

    std::wstring source;
    if (GetFileAttributesW(custom.c_str()) != INVALID_FILE_ATTRIBUTES) source = custom;
    if (source.empty()) {
        for (const auto& kv : skin_index_.obj) {
            std::string index_key = kv.first;
            for (char& c : index_key) c = char(tolower((unsigned char)c));
            if (index_key != lower_key) continue;
            std::wstring file = utf8_to_wide(kv.second.text("file"));
            if (!file.empty() && GetFileAttributesW(file.c_str()) != INVALID_FILE_ATTRIBUTES)
                source = file;
            break;
        }
    }
    bool made = !source.empty() && make_head_png(source, head);
    if (made) return head;
    if (GetFileAttributesW(head.c_str()) != INVALID_FILE_ATTRIBUTES) return head;
    if (!network) return L"";

    std::wstring texture = skin_texture_url(account);
    if (!texture.empty()) {
        HttpResult image = http_request(texture, L"GET");
        if (image.ok() && image.status == 200 && image.body.size() > 100 &&
            (unsigned char)image.body[0] == 0x89 && (unsigned char)image.body[1] == 'P') {
            std::wstring skin_file = cache + L"\\" + utf8_to_wide(key) + L".png";
            write_file_bytes(skin_file, std::vector<unsigned char>(image.body.begin(), image.body.end()));
            if (make_head_png(skin_file, head)) return head;
        }
    }
    std::wstring id = !account.uuid.empty() ? account.uuid : account.name;
    HttpResult avatar = http_request(L"https://crafthead.net/avatar/" + id, L"GET");
    if (avatar.ok() && avatar.status == 200 && avatar.body.size() > 100 &&
        (unsigned char)avatar.body[0] == 0x89 && (unsigned char)avatar.body[1] == 'P') {
        write_file_bytes(head, std::vector<unsigned char>(avatar.body.begin(), avatar.body.end()));
        return head;
    }
    return L"";
}

std::wstring App::account_head(const std::wstring& name) const {
    for (const auto& account : accounts_)
        if (account.name == name && !account.head.empty()) return account.head;
    return asset(L"assets\\icons\\user-circle.svg");
}

std::wstring App::account_kind_label(const std::wstring& type) const {
    if (type == L"microsoft") return L"Microsoft";
    if (type == L"ely") return L"Ely.by";
    return L"Offline";
}

void App::save_accounts() {
    Json root;
    root.parse(read_file_utf8(user_data_dir() + L"\\settings.json"));
    if (root.type != Json::Type::Object) root = Json::object();
    Json list = Json::array();
    for (const auto& account : accounts_) {
        Json item = account.raw.type == Json::Type::Object ? account.raw : Json::object();
        item.set("id", Json::string(wide_to_utf8(account.id)));
        item.set("name", Json::string(wide_to_utf8(account.name)));
        item.set("type", Json::string(wide_to_utf8(account.type)));
        item.set("uuid", Json::string(wide_to_utf8(account.uuid)));
        if (!account.xuid.empty())
            item.set("xuid", Json::string(wide_to_utf8(account.xuid)));
        list.arr.push_back(std::move(item));
    }
    root.set("accounts", std::move(list));
    if (active_id_.empty())
        root.set("activeAccountId", Json());
    else
        root.set("activeAccountId", Json::string(wide_to_utf8(active_id_)));
    write_file_utf8(user_data_dir() + L"\\settings.json", root.dump(2));
}

void App::rebuild_account_rows() {
    hovered_ = nullptr;
    auto make_head = [&](const Account& account, float size, float radius) {
        auto image = std::make_unique<Node>();
        image->kind = Kind::Image;
        image->src = account.head.empty() ? asset(L"assets/icons/user-circle.svg") : account.head;
        image->style.width = size;
        image->style.height = size;
        image->style.radius = radius;
        if (image->src.size() > 4 &&
            image->src.substr(image->src.size() - 4) == L".svg")
            image->style.color = ui_token(L"accent");
        return image;
    };
    auto make_text = [](const std::wstring& value, float size, int weight, Color color,
                        bool mono = false) {
        auto text = std::make_unique<Node>();
        text->kind = Kind::Text;
        text->text = value;
        text->style.font_size = size;
        text->style.weight = weight;
        text->style.color = color;
        text->style.mono = mono;
        return text;
    };

    if (Node* list = ui_find(menu_.get(), L"menu-accounts")) {
        list->kids.clear();
        for (const auto& account : accounts_) {
            auto row = std::make_unique<Node>();
            row->kind = Kind::Row;
            row->action = L"account:" + account.id;
            row->style.height = 46.0f;
            row->style.pad_l = row->style.pad_r = 6.0f;
            row->style.gap = 8.0f;
            row->style.radius = 12.0f;
            row->style.hover_bg = ui_token(L"hover");
            row->kids.push_back(make_head(account, 30.0f, 15.0f));
            auto column = std::make_unique<Node>();
            column->kind = Kind::Column;
            column->style.grow_x = true;
            column->style.center_main = true;
            column->kids.push_back(make_text(account.name, 13.0f, 600, ui_token(L"text")));
            column->kids.push_back(
                make_text(account_kind_label(account.type), 10.5f, 400, ui_token(L"label")));
            row->kids.push_back(std::move(column));
            if (account.id == active_id_) {
                auto check = std::make_unique<Node>();
                check->kind = Kind::Image;
                check->src = asset(L"assets\\icons\\check.svg");
                check->style.width = check->style.height = 16.0f;
                check->style.color = ui_token(L"accent");
                row->kids.push_back(std::move(check));
            }
            list->kids.push_back(std::move(row));
        }
        if (accounts_.empty()) {
            auto empty = std::make_unique<Node>();
            empty->kind = Kind::Text;
            empty->text = L"Chưa có tài khoản";
            empty->style.font_size = 12.0f;
            empty->style.color = ui_token(L"label");
            empty->style.height = 38.0f;
            empty->style.pad_l = 10.0f;
            list->kids.push_back(std::move(empty));
        }
    }

    if (Node* list = ui_find(ui_.get(), L"accounts-list-rows")) {
        list->kids.clear();
        for (size_t i = 0; i < accounts_.size(); ++i) {
            const Account& account = accounts_[i];
            auto row = std::make_unique<Node>();
            row->kind = Kind::Row;
            row->action = L"account:" + account.id;
            row->style.height = 60.0f;
            row->style.pad_l = row->style.pad_r = 12.0f;
            row->style.gap = 10.0f;
            row->style.radius = 12.0f;
            row->style.hover_bg = ui_token(L"hover");
            row->kids.push_back(make_head(account, 30.0f, 15.0f));
            auto column = std::make_unique<Node>();
            column->kind = Kind::Column;
            column->style.grow_x = true;
            column->style.center_main = true;
            column->style.gap = 2.0f;
            column->kids.push_back(make_text(account.name, 12.5f, 600, ui_token(L"text")));
            std::wstring provider = account.type == L"offline" ? L"Ngoại tuyến"
                                     : account.type == L"microsoft" ? L"Microsoft"
                                                                   : L"ely.by";
            column->kids.push_back(make_text(provider + L" · " + account.uuid, 9.0f, 400,
                                             ui_token(L"faint"), true));
            row->kids.push_back(std::move(column));
            const DiscordLink* dlink = discord_link_for(account);
            auto link_btn = std::make_unique<Node>();
            link_btn->kind = Kind::Row;
            link_btn->action = L"discord:link:" + account.id;
            link_btn->style.height = 24.0f;
            link_btn->style.pad_l = link_btn->style.pad_r = 8.0f;
            link_btn->style.gap = 4.0f;
            link_btn->style.radius = 6.0f;
            link_btn->style.border = true;
            link_btn->style.border_color = Color::rgb(0x5865F2);
            auto link_icon = std::make_unique<Node>();
            link_icon->kind = Kind::Image;
            link_icon->src = asset(L"assets/icons/discord.svg");
            link_icon->style.width = link_icon->style.height = 12.0f;
            link_icon->style.color = Color::rgb(0x5865F2);
            link_btn->kids.push_back(std::move(link_icon));
            link_btn->kids.push_back(make_text(dlink ? L"Đã liên kết" : L"Liên kết Discord", 9.5f, 600,
                                               Color::rgb(0x5865F2)));
            row->kids.push_back(std::move(link_btn));
            if (dlink) {
                auto unlink_btn = std::make_unique<Node>();
                unlink_btn->kind = Kind::Row;
                unlink_btn->action = L"discord:unlink:" + account.id;
                unlink_btn->style.width = unlink_btn->style.height = 24.0f;
                unlink_btn->style.radius = 6.0f;
                unlink_btn->style.border = true;
                unlink_btn->style.border_color = ui_token(L"border");
                auto trash = std::make_unique<Node>();
                trash->kind = Kind::Image;
                trash->src = asset(L"assets/icons/trash.svg");
                trash->style.width = trash->style.height = 12.0f;
                trash->style.color = ui_token(L"bad");
                unlink_btn->kids.push_back(std::move(trash));
                row->kids.push_back(std::move(unlink_btn));
            }
            if (account.id == active_id_) {
                auto badge = std::make_unique<Node>();
                badge->kind = Kind::Row;
                badge->style.height = 22.0f;
                badge->style.pad_l = badge->style.pad_r = 8.0f;
                badge->style.radius = 6.0f;
                badge->style.bg = ui_token(L"input");
                badge->style.border = true;
                badge->style.border_color = ui_token(L"border");
                badge->kids.push_back(make_text(L"Đang dùng", 9.0f, 700, ui_token(L"accent")));
                row->kids.push_back(std::move(badge));
            }
            auto caret = std::make_unique<Node>();
            caret->kind = Kind::Image;
            caret->src = asset(L"assets\\icons\\caret-right.svg");
            caret->style.width = caret->style.height = 14.0f;
            caret->style.color = ui_token(L"faint");
            row->kids.push_back(std::move(caret));
            list->kids.push_back(std::move(row));
            if (i + 1 < accounts_.size()) {
                auto divider = std::make_unique<Node>();
                divider->kind = Kind::Spacer;
                divider->style.height = 1.0f;
                divider->style.bg = ui_token(L"border");
                list->kids.push_back(std::move(divider));
            }
        }
        if (accounts_.empty()) {
            auto empty = std::make_unique<Node>();
            empty->kind = Kind::Text;
            empty->text = L"Chưa có tài khoản nào";
            empty->style.font_size = 12.0f;
            empty->style.color = ui_token(L"label");
            empty->style.height = 48.0f;
            list->kids.push_back(std::move(empty));
        }
    }
}

void App::rebuild_instance_rows() {
    hovered_ = nullptr;
    Node* list = ui_find(ui_.get(), L"instance-list");
    if (!list) return;
    list->kids.clear();
    list->style.visible = !instances_.empty();
    for (const auto& inst : instances_) {
        auto row = std::make_unique<Node>();
        row->kind = Kind::Row;
        row->action = L"nav:versions";
        row->style.height = 48.0f;
        row->style.pad_l = 14.0f;
        row->style.pad_r = 10.0f;
        row->style.gap = 10.0f;
        row->style.radius = 15.0f;
        row->style.no_hover_bg = true;
        auto icon = std::make_unique<Node>();
        icon->kind = Kind::Image;
        icon->src = inst.icon;
        if (icon->src.empty()) {
            std::wstring loader = inst.loader;
            if (loader != L"vanilla" && loader != L"fabric" && loader != L"forge" &&
                loader != L"lunar")
                loader = L"vanilla";
            icon->src = asset(L"assets\\img\\loader-icon\\" + loader + L".png");
        }
        icon->style.width = icon->style.height = 26.0f;
        icon->style.radius = 6.0f;
        icon->style.opacity = 0.62f;
        icon->style.hover_opacity = 1.0f;
        row->kids.push_back(std::move(icon));
        auto name = std::make_unique<Node>();
        name->kind = Kind::Text;
        name->text = inst.name;
        name->style.font_size = 13.5f;
        name->style.weight = 600;
        name->style.color = ui_token(L"label");
        name->style.hover_color = ui_token(L"text");
        row->kids.push_back(std::move(name));
        auto spacer = std::make_unique<Node>();
        spacer->kind = Kind::Spacer;
        spacer->style.grow_x = true;
        row->kids.push_back(std::move(spacer));
        auto dot = std::make_unique<Node>();
        dot->kind = Kind::Row;
        dot->style.width = dot->style.height = 6.0f;
        dot->style.radius = 3.0f;
        dot->style.bg = inst.status == L"running"      ? Color::rgb(0x22C55E)
                        : inst.status == L"installing" || inst.status == L"stopping" ||
                                  inst.status == L"starting"
                            ? Color::rgb(0xEAB308)
                        : inst.status == L"error" ? Color::rgb(0xEF4444)
                                                  : Color::rgb(0x6B7280);
        row->kids.push_back(std::move(dot));
        list->kids.push_back(std::move(row));
    }
}

void App::select_account(const std::wstring& id) {
    const Account* account = find_account(id);
    if (!account) return;
    active_id_ = id;
    save_accounts();
    rebuild_account_rows();
    ui_apply_page();
    notify(L"Tài khoản", L"Đang dùng " + account->name, L"ok");
    close_account_menu();
    dirty_ = true;
    InvalidateRect(hwnd_, nullptr, FALSE);
}


static std::wstring trim_text(const std::wstring& value) {
    size_t start = 0, end = value.size();
    while (start < end && iswspace(value[start])) ++start;
    while (end > start && iswspace(value[end - 1])) --end;
    return value.substr(start, end - start);
}

static bool valid_mc_name(const std::wstring& name) {
    if (name.size() < 3 || name.size() > 16) return false;
    for (wchar_t c : name) {
        if (!((c >= L'a' && c <= L'z') || (c >= L'A' && c <= L'Z') ||
              (c >= L'0' && c <= L'9') || c == L'_'))
            return false;
    }
    return true;
}

static std::string iso_now() {
    std::time_t raw = std::time(nullptr);
    std::tm tm{};
    gmtime_s(&tm, &raw);
    char out[32];
    std::strftime(out, sizeof(out), "%Y-%m-%dT%H:%M:%S.000Z", &tm);
    return out;
}

ModalLayout App::modal_layout() const {
    RECT rc{};
    GetClientRect(hwnd_, &rc);
    float w = float(rc.right - rc.left) / renderer_.scale();
    float h = float(rc.bottom - rc.top) / renderer_.scale();
    ModalLayout L;
    float cw = 560.0f;
    float ch = modal_kind_ == 0 ? 268.0f : modal_kind_ == 1 ? 330.0f : modal_kind_ == 2 ? 384.0f : 380.0f;
    if (!modal_error_.empty()) ch += 44.0f;
    float x = (w - cw) * 0.5f;
    float y = (h - ch) * 0.5f;
    if (y < 16.0f) y = 16.0f;
    L.card = D2D1::RectF(x, y, x + cw, y + ch);
    L.close = D2D1::RectF(x + cw - 40.0f, y + 10.0f, x + cw - 16.0f, y + 34.0f);
    float kx = x + 16.0f;
    float ky = y + 56.0f;
    float kw = (cw - 32.0f - 24.0f) / 4.0f;
    for (int i = 0; i < 4; ++i)
        L.kinds[i] = D2D1::RectF(kx + i * (kw + 8.0f), ky, kx + i * (kw + 8.0f) + kw, ky + 64.0f);
    float desc_y = ky + 64.0f + 10.0f;
    float body_y = desc_y + 36.0f + 10.0f;
    if (modal_kind_ == 0 || modal_kind_ == 3) {
        L.name_input = D2D1::RectF(x + 62.0f, body_y, x + cw - 16.0f, body_y + 38.0f);
    } else if (modal_kind_ == 2) {
        L.user_input = D2D1::RectF(x + 16.0f, body_y, x + cw - 16.0f, body_y + 38.0f);
        L.pass_input = D2D1::RectF(x + 16.0f, body_y + 46.0f, x + cw - 16.0f, body_y + 84.0f);
        L.eye = D2D1::RectF(L.pass_input.right - 30.0f, L.pass_input.top + 6.0f,
                            L.pass_input.right - 4.0f, L.pass_input.bottom - 6.0f);
    }
    float footer = L.card.bottom - 52.0f;
    L.submit = D2D1::RectF(x + cw - 16.0f - 96.0f, footer + 10.0f, x + cw - 16.0f,
                           footer + 42.0f);
    L.cancel = D2D1::RectF(L.submit.left - 8.0f - 72.0f, footer + 10.0f,
                           L.submit.left - 8.0f, footer + 42.0f);
    return L;
}

bool App::modal_valid() const {
    if (modal_kind_ == 0) return valid_mc_name(trim_text(modal_name_));
    if (modal_kind_ == 1) return true;
    if (modal_kind_ == 3) return !modal_discord_account_.empty() || valid_mc_name(trim_text(modal_name_));
    return !trim_text(modal_user_).empty() && !modal_pass_.empty();
}

void App::open_account_modal() {
    close_account_menu();
    modal_open_ = true;
    modal_kind_ = 0;
    modal_focus_ = 0;
    modal_show_pass_ = false;
    modal_busy_ = false;
    modal_name_.clear();
    modal_user_.clear();
    modal_pass_.clear();
    modal_error_.clear();
    modal_discord_account_.clear();
    SetTimer(hwnd_, 4, 500, nullptr);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::close_account_modal() {
    if (!modal_open_) return;
    if (modal_busy_) return;
    modal_open_ = false;
    modal_busy_ = false;
    modal_error_.clear();
    KillTimer(hwnd_, 4);
    hovered_ = nullptr;
    pressed_.clear();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::save_token(const std::wstring& id, const std::string& json) {
    if (id.empty() || json.empty()) return;
    Json store;
    store.parse(read_file_utf8(user_data_dir() + L"\\auth.json"));
    if (store.type != Json::Type::Object) store = Json::object();
    Json entry = Json::object();
    entry.set("v", Json::number(1));
    entry.set("enc", Json::boolean(true));
    entry.set("data", Json::string(oscrypt_encrypt(json)));
    store.set(wide_to_utf8(id), std::move(entry));
    write_file_utf8(user_data_dir() + L"\\auth.json", store.dump(0));
}


static void draw_spinner(Renderer& renderer, float cx, float cy, float radius, Color color,
                         float opacity) {
    float base = float(GetTickCount64() % 1000) / 1000.0f * 6.28318f;
    for (int i = 0; i < 8; ++i) {
        float angle = base + float(i) * 0.785398f;
        float x = cx + std::cos(angle) * radius;
        float y = cy + std::sin(angle) * radius;
        float a = 0.2f + 0.8f * (float(i) / 7.0f);
        renderer.fill_rect(D2D1::RectF(x - 1.6f, y - 1.6f, x + 1.6f, y + 1.6f), 1.6f,
                           Color{ color.r, color.g, color.b, a * opacity });
    }
}

void App::draw_account_modal() {
    if (!modal_open_) return;
    RECT rc{};
    GetClientRect(hwnd_, &rc);
    float w = float(rc.right - rc.left) / renderer_.scale();
    float h = float(rc.bottom - rc.top) / renderer_.scale();
    ModalLayout L = modal_layout();
    renderer_.fill_rect(D2D1::RectF(0, 0, w, h), 0.0f, Color::rgb(0x000000, 0.55f));
    renderer_.fill_rect(D2D1::RectF(L.card.left + 2, L.card.top + 8, L.card.right + 2,
                                    L.card.bottom + 8),
                        16.0f, Color::rgb(0x000000, 0.35f));
    renderer_.fill_rect(L.card, 16.0f, ui_color(L"surface"));
    renderer_.stroke_rect(L.card, 16.0f, ui_color(L"border"), 1.0f);

    auto icon = [&](const wchar_t* path, D2D1_RECT_F rect, Color color) {
        renderer_.draw_svg(asset(path), rect, color);
    };
    icon(modal_kind_ == 3 ? L"assets\\icons\\discord.svg" : L"assets\\icons\\user.svg",
         D2D1::RectF(L.card.left + 16, L.card.top + 15, L.card.left + 31, L.card.top + 30),
         modal_kind_ == 3 ? Color::rgb(0x5865F2) : ui_color(L"accent"));
    renderer_.draw_text(modal_kind_ == 3 ? L"Liên kết Discord" : L"Thêm tài khoản",
                        D2D1::RectF(L.card.left + 38, L.card.top + 10, L.card.right - 48,
                                    L.card.top + 34),
                        12.0f, 700, false, TextAlign::Left, ui_color(L"text"));
    icon(L"assets\\icons\\x.svg",
         D2D1::RectF(L.close.left + 5, L.close.top + 5, L.close.right - 5, L.close.bottom - 5),
         ui_color(L"label"));

    const wchar_t* kind_labels[4] = { L"Ngoại tuyến", L"Microsoft", L"ely.by", L"Discord" };
    const wchar_t* kind_icons[4] = { L"assets\\icons\\user.svg",
                                     L"assets\\icons\\windows-logo.svg",
                                     L"assets\\icons\\globe.svg",
                                     L"assets\\icons\\discord.svg" };
    for (int i = 0; i < 4; ++i) {
        bool on = modal_kind_ == i;
        D2D1_RECT_F box = L.kinds[i];
        if (on) renderer_.fill_rect(box, 12.0f, ui_color(L"input"));
        Color tint = (i == 3) ? Color::rgb(0x5865F2) : ui_color(L"accent");
        renderer_.stroke_rect(box, 12.0f, on ? tint : ui_color(L"border"), 1.0f, 1.0f);
        icon(kind_icons[i], D2D1::RectF(box.left + 10, box.top + 10, box.left + 25,
                                       box.top + 25),
             on ? ((i == 3) ? Color::rgb(0x5865F2) : ui_color(L"accent")) : ui_color(L"label"));
        renderer_.draw_text(kind_labels[i],
                            D2D1::RectF(box.left + 10, box.top + 32, box.right - 8,
                                        box.bottom - 6),
                            11.0f, 700, false, TextAlign::Left,
                            on ? ui_color(L"text") : ui_color(L"label"));
    }

    D2D1_RECT_F desc = D2D1::RectF(L.card.left + 16, L.kinds[0].bottom + 10, L.card.right - 16,
                                   L.kinds[0].bottom + 42);
    const wchar_t* desc_text = modal_kind_ == 0
        ? L"Chơi không cần tài khoản Mojang. Tên chỉ gồm chữ, số, gạch dưới và dài 3–16 ký tự."
        : modal_kind_ == 1
            ? L"Đăng nhập bằng tài khoản Microsoft đã sở hữu Minecraft Java Edition. Launcher lưu refresh token và tự làm mới phiên mỗi lần khởi chạy."
            : modal_kind_ == 2 ? L"Tài khoản ely.by qua authlib-injector: chơi được trên server có bật ely.by và dùng skin của ely.by."
            : L"Liên kết tài khoản launcher với Discord để nhận vai trò và đồng bộ trên server.";
    renderer_.draw_text(desc_text, desc, 10.5f, 400, false, TextAlign::Left, ui_color(L"faint"),
                        1.0f, true);

    auto input_box = [&](D2D1_RECT_F box, const std::wstring& value,
                         const wchar_t* placeholder, bool password, bool focused) {
        renderer_.fill_rect(box, 8.0f, ui_color(L"input"));
        renderer_.stroke_rect(box, 8.0f, focused ? ui_color(L"accent") : ui_color(L"border"),
                              1.0f);
        std::wstring shown = password ? std::wstring(value.size(), wchar_t(0x2022)) : value;
        if (!shown.empty()) {
            renderer_.draw_text(shown, D2D1::RectF(box.left + 10, box.top, box.right - 10,
                                                   box.bottom),
                                12.0f, 400, false, TextAlign::Left, ui_color(L"text"));
        } else {
            renderer_.draw_text(placeholder, D2D1::RectF(box.left + 10, box.top, box.right - 10,
                                                          box.bottom),
                                12.0f, 400, false, TextAlign::Left, ui_color(L"faint"));
        }
        if (focused && (GetTickCount64() / 500) % 2 == 0) {
            float tw = 0.0f;
            if (!value.empty())
                tw = renderer_.measure_text(password ? std::wstring(value.size(), wchar_t(0x2022))
                                                     : value,
                                            12.0f, 400, false, 1e6f, 1e6f, false)
                         .w;
            float caret = std::min(box.left + 10 + tw + 1.0f, box.right - 8.0f);
            renderer_.fill_rect(D2D1::RectF(caret, box.top + 10, caret + 1.0f, box.bottom - 10),
                                0.5f, ui_color(L"text"));
        }
    };

    if (modal_kind_ == 0) {
        D2D1_RECT_F avatar = D2D1::RectF(L.card.left + 16, L.name_input.top,
                                         L.card.left + 54, L.name_input.bottom);
        std::wstring head = account_head(trim_text(modal_name_));
        if (head.size() > 4 && head.substr(head.size() - 4) == L".png") {
            renderer_.draw_image_path(head, avatar, 9.0f);
        } else {
            renderer_.fill_rect(avatar, 9.0f, ui_color(L"input"));
            renderer_.stroke_rect(avatar, 9.0f, ui_color(L"border"), 1.0f);
            icon(L"assets\\icons\\user-circle.svg",
                 D2D1::RectF(avatar.left + 9, avatar.top + 9, avatar.right - 9, avatar.bottom - 9),
                 ui_color(L"accent"));
        }
        input_box(L.name_input, modal_name_, L"Tên người chơi…", false, modal_focus_ == 0);
    } else if (modal_kind_ == 1) {
        D2D1_RECT_F note = D2D1::RectF(L.card.left + 16, L.kinds[0].bottom + 56,
                                       L.card.right - 16, L.kinds[0].bottom + 112);
        renderer_.fill_rect(note, 8.0f, ui_color(L"input"));
        renderer_.stroke_rect(note, 8.0f, ui_color(L"border"), 1.0f);
        icon(L"assets\\icons\\shield-check.svg",
             D2D1::RectF(note.left + 10, note.top + 10, note.left + 25, note.top + 25),
             ui_color(L"accent"));
        renderer_.draw_text(L"Cửa sổ đăng nhập do Microsoft mở ra — launcher không thấy mật khẩu của bạn.",
                            D2D1::RectF(note.left + 32, note.top + 8, note.right - 10,
                                        note.bottom - 8),
                            10.5f, 400, false, TextAlign::Left, ui_color(L"label"), 1.0f, true);
        if (modal_busy_) {
            draw_spinner(renderer_, L.card.left + 24, note.bottom + 24, 6.0f,
                         ui_color(L"accent"), 1.0f);
            renderer_.draw_text(L"Đang chờ bạn đăng nhập trong cửa sổ Microsoft…",
                                D2D1::RectF(L.card.left + 38, note.bottom + 12, L.card.right - 16,
                                            note.bottom + 38),
                                11.0f, 400, false, TextAlign::Left, ui_color(L"label"));
        }
    } else if (modal_kind_ == 2) {
        input_box(L.user_input, modal_user_, L"Tên đăng nhập hoặc email ely.by", false,
                  modal_focus_ == 0);
        input_box(L.pass_input, modal_pass_, L"Mật khẩu ely.by", !modal_show_pass_,
                  modal_focus_ == 1);
        icon(modal_show_pass_ ? L"assets\\icons\\eye-slash.svg" : L"assets\\icons\\eye.svg",
             L.eye, ui_color(L"faint"));
        D2D1_RECT_F note = D2D1::RectF(L.card.left + 16, L.pass_input.bottom + 10,
                                       L.card.right - 16, L.pass_input.bottom + 66);
        renderer_.fill_rect(note, 8.0f, ui_color(L"input"));
        renderer_.stroke_rect(note, 8.0f, ui_color(L"border"), 1.0f);
        icon(L"assets\\icons\\shield-check.svg",
             D2D1::RectF(note.left + 10, note.top + 10, note.left + 25, note.top + 25),
             ui_color(L"accent"));
        renderer_.draw_text(L"Mật khẩu chỉ gửi trực tiếp tới authserver.ely.by. authlib-injector được tải một lần khi khởi chạy game.",
                            D2D1::RectF(note.left + 32, note.top + 8, note.right - 10,
                                        note.bottom - 8),
                            10.5f, 400, false, TextAlign::Left, ui_color(L"label"), 1.0f, true);
    } else {
        if (!modal_discord_account_.empty()) {
            D2D1_RECT_F chip = D2D1::RectF(L.card.left + 16, L.name_input.top,
                                           L.card.right - 16, L.name_input.top + 44.0f);
            renderer_.fill_rect(chip, 8.0f, ui_color(L"input"));
            renderer_.stroke_rect(chip, 8.0f, ui_color(L"border"), 1.0f);
            const Account* account = find_account(modal_discord_account_);
            renderer_.draw_text(account ? account->name : L"Tài khoản",
                                D2D1::RectF(chip.left + 12, chip.top, chip.right - 12,
                                            chip.bottom),
                                12.0f, 600, false, TextAlign::Left, ui_color(L"text"));
        } else {
            input_box(L.name_input, modal_name_, L"Tên tài khoản…", false, modal_focus_ == 0);
        }
        D2D1_RECT_F note = D2D1::RectF(L.card.left + 16, L.name_input.top + 54.0f,
                                       L.card.right - 16, L.name_input.top + 110.0f);
        renderer_.fill_rect(note, 8.0f, ui_color(L"input"));
        renderer_.stroke_rect(note, 8.0f, ui_color(L"border"), 1.0f);
        icon(L"assets\\icons\\discord.svg",
             D2D1::RectF(note.left + 10, note.top + 10, note.left + 25, note.top + 25),
             Color::rgb(0x5865F2));
        renderer_.draw_text(L"Trình duyệt sẽ mở trang xác thực Discord. Launcher tự nhận kết quả và tạo tài khoản nếu chưa có.",
                            D2D1::RectF(note.left + 32, note.top + 8, note.right - 10,
                                        note.bottom - 8),
                            10.5f, 400, false, TextAlign::Left, ui_color(L"label"), 1.0f, true);
        if (modal_busy_) {
            draw_spinner(renderer_, L.card.left + 24, note.bottom + 24, 6.0f,
                         Color::rgb(0x5865F2), 1.0f);
            renderer_.draw_text(L"Đang chờ bạn xác thực trong Discord…",
                                D2D1::RectF(L.card.left + 38, note.bottom + 12, L.card.right - 16,
                                            note.bottom + 38),
                                11.0f, 400, false, TextAlign::Left, ui_color(L"label"));
        }
    }

    float footer_top = L.card.bottom - 52.0f;
    if (!modal_error_.empty()) {
        D2D1_RECT_F error = D2D1::RectF(L.card.left + 16, footer_top - 40, L.card.right - 16,
                                        footer_top - 8);
        renderer_.fill_rect(error, 8.0f, Color::rgb(0xEF4444, 0.10f));
        renderer_.stroke_rect(error, 8.0f, Color::rgb(0xEF4444, 0.30f), 1.0f);
        icon(L"assets\\icons\\warning-circle.svg",
             D2D1::RectF(error.left + 10, error.top + 8, error.left + 23, error.bottom - 8),
             ui_color(L"bad"));
        renderer_.draw_text(modal_error_,
                            D2D1::RectF(error.left + 30, error.top, error.right - 8, error.bottom),
                            11.0f, 400, false, TextAlign::Left, ui_color(L"bad"));
    }
    renderer_.fill_rect(D2D1::RectF(L.card.left, footer_top, L.card.right, footer_top + 1),
                        0.0f, ui_color(L"border"));
    const wchar_t* hint = modal_kind_ == 0 ? L"Tên chỉ gồm chữ, số, gạch dưới và dài 3–16 ký tự."
                         : modal_kind_ == 1 ? L"Cần tài khoản đã mua Minecraft Java Edition."
                         : modal_kind_ == 2 ? L"Thông tin đăng nhập chỉ dùng để lấy token từ ely.by."
                                            : L"Tài khoản sẽ được tạo nếu chưa tồn tại.";
    renderer_.draw_text(hint,
                        D2D1::RectF(L.card.left + 16, footer_top + 10, L.submit.left - 8,
                                    footer_top + 42),
                        10.0f, 400, false, TextAlign::Left, ui_color(L"faint"));
    renderer_.draw_text(L"Hủy",
                        D2D1::RectF(L.cancel.left, L.cancel.top, L.cancel.right, L.cancel.bottom),
                        11.0f, 600, false, TextAlign::Center, ui_color(L"label"));
    bool enabled = !modal_busy_ && modal_valid();
    Color submit_bg = modal_kind_ == 3 ? Color::rgb(0x5865F2) : ui_color(L"accent");
    Color submit_ink = modal_kind_ == 3 ? Color::rgb(0xFFFFFF) : ui_color(L"ink");
    renderer_.fill_rect(L.submit, 8.0f, submit_bg, enabled ? 1.0f : 0.4f);
    if (modal_busy_) {
        draw_spinner(renderer_, L.submit.left + 22, (L.submit.top + L.submit.bottom) * 0.5f, 5.0f,
                     submit_ink, 1.0f);
    } else {
        icon(modal_kind_ == 3 ? L"assets\\icons\\discord.svg" : L"assets\\icons\\check-circle.svg",
             D2D1::RectF(L.submit.left + 12, L.submit.top + 10, L.submit.left + 24,
                         L.submit.bottom - 10),
             submit_ink);
    }
    const wchar_t* submit_text = modal_kind_ == 0 ? L"Tạo" : L"Đăng nhập";
    renderer_.draw_text(submit_text,
                        D2D1::RectF(L.submit.left + 30, L.submit.top, L.submit.right - 8,
                                    L.submit.bottom),
                        11.0f, 700, false, TextAlign::Left, submit_ink,
                        enabled ? 1.0f : 0.5f);
}

bool App::account_modal_mouse_down(int px, int py) {
    if (!modal_open_) return false;
    float x = float(px) / renderer_.scale();
    float y = float(py) / renderer_.scale();
    ModalLayout L = modal_layout();
    auto inside = [&](D2D1_RECT_F r) {
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    if (!inside(L.card)) {
        close_account_modal();
        return true;
    }
    if (inside(L.close)) {
        close_account_modal();
        return true;
    }
    if (modal_busy_) return true;
    for (int i = 0; i < 4; ++i) {
        if (inside(L.kinds[i])) {
            modal_kind_ = i;
            modal_focus_ = (i == 2 || i == 0 || (i == 3 && modal_discord_account_.empty())) ? 0 : -1;
            modal_error_.clear();
            InvalidateRect(hwnd_, nullptr, FALSE);
            return true;
        }
    }
    if ((modal_kind_ == 0 || modal_kind_ == 3) && inside(L.name_input)) {
        modal_focus_ = 0;
        InvalidateRect(hwnd_, nullptr, FALSE);
        return true;
    }
    if (modal_kind_ == 2) {
        if (inside(L.user_input)) {
            modal_focus_ = 0;
            InvalidateRect(hwnd_, nullptr, FALSE);
            return true;
        }
        if (inside(L.pass_input)) {
            modal_focus_ = 1;
            InvalidateRect(hwnd_, nullptr, FALSE);
            return true;
        }
        if (inside(L.eye)) {
            modal_show_pass_ = !modal_show_pass_;
            InvalidateRect(hwnd_, nullptr, FALSE);
            return true;
        }
    }
    if (inside(L.cancel)) {
        close_account_modal();
        return true;
    }
    if (inside(L.submit)) {
        if (modal_valid()) submit_account_modal();
        return true;
    }
    return true;
}

bool App::account_modal_key(WPARAM key) {
    if (!modal_open_) return false;
    if (key == VK_ESCAPE) {
        if (!modal_busy_) close_account_modal();
        return true;
    }
    if (modal_busy_) return true;
    if (key == VK_RETURN) {
        if (modal_valid()) submit_account_modal();
        return true;
    }
    if (key == VK_TAB) {
        if (modal_kind_ == 2) modal_focus_ = modal_focus_ == 0 ? 1 : 0;
        else if (modal_kind_ == 0) modal_focus_ = 0;
        InvalidateRect(hwnd_, nullptr, FALSE);
        return true;
    }
    if (key == VK_BACK) {
        std::wstring* target = nullptr;
        if ((modal_kind_ == 0 || modal_kind_ == 3) && modal_focus_ == 0) target = &modal_name_;
        else if (modal_kind_ == 2 && modal_focus_ == 0) target = &modal_user_;
        else if (modal_kind_ == 2 && modal_focus_ == 1) target = &modal_pass_;
        if (target && !target->empty()) target->pop_back();
        modal_error_.clear();
        InvalidateRect(hwnd_, nullptr, FALSE);
        return true;
    }
    return true;
}

bool App::account_modal_char(wchar_t ch) {
    if (!modal_open_ || modal_busy_ || ch < 32 || ch == 127) return false;
    std::wstring* target = nullptr;
    size_t limit = 64;
    if ((modal_kind_ == 0 || modal_kind_ == 3) && modal_focus_ == 0) {
        target = &modal_name_;
        limit = 16;
    } else if (modal_kind_ == 2 && modal_focus_ == 0) {
        target = &modal_user_;
    } else if (modal_kind_ == 2 && modal_focus_ == 1) {
        target = &modal_pass_;
    }
    if (!target) return false;
    if (target->size() >= limit) return true;
    target->push_back(ch);
    modal_error_.clear();
    InvalidateRect(hwnd_, nullptr, FALSE);
    return true;
}

void App::submit_account_modal() {
    if (modal_busy_ || !modal_valid()) return;
    if (modal_kind_ == 0) {
        std::wstring name = trim_text(modal_name_);
        std::string uuid = offline_uuid(name);
        std::wstring wide_uuid = utf8_to_wide(uuid);
        for (const auto& account : accounts_) {
            if (account.uuid == wide_uuid) {
                active_id_ = account.id;
                save_accounts();
                rebuild_account_rows();
                ui_apply_page();
                close_account_modal();
                notify(L"Tài khoản", L"Tài khoản này đã có trong danh sách", L"info");
                return;
            }
        }
        Account account;
        account.id = L"off-" + wide_uuid.substr(0, 8);
        account.name = name;
        account.type = L"offline";
        account.uuid = wide_uuid;
        account.raw = Json::object();
        account.raw.set("created", Json::string(iso_now()));
        account.head = resolve_head(account, true);
        accounts_.push_back(account);
        active_id_ = account.id;
        save_accounts();
        rebuild_account_rows();
        ui_apply_page();
        close_account_modal();
        notify(L"Đã thêm tài khoản", name, L"ok");
        return;
    }
    if (modal_kind_ == 3) {
        start_discord_job();
        return;
    }
    start_auth_job(modal_kind_);
}

void App::start_auth_job(int kind) {
    if (modal_busy_) return;
    modal_busy_ = true;
    modal_error_.clear();
    AuthJob* job = new AuthJob{};
    job->hwnd = hwnd_;
    job->kind = kind;
    job->user = modal_user_;
    job->pass = modal_pass_;
    SetTimer(hwnd_, 2, 16, nullptr);
    InvalidateRect(hwnd_, nullptr, FALSE);
    HANDLE thread = CreateThread(nullptr, 0, +[](LPVOID param) -> DWORD {
        AuthJob* job = reinterpret_cast<AuthJob*>(param);
        AuthResult* result = new AuthResult();
        result->kind = job->kind;
        AuthSession session = job->kind == 1 ? microsoft_login()
                                             : ely_login(job->user, job->pass);
        if (session.ok && job->kind == 2) {
            std::wstring error;
            std::wstring jar = ensure_ely_injector(&error);
            if (jar.empty()) {
                session.ok = false;
                session.error = error.empty() ? L"Không tải được authlib-injector." : error;
            }
        }
        result->ok = session.ok;
        result->error = session.error;
        result->name = session.name;
        result->uuid = session.uuid;
        result->xuid = session.xuid;
        result->token_json = session.token_json;
        if (!result->ok && result->error.empty())
            result->error = job->kind == 1 ? L"Đăng nhập Microsoft thất bại."
                                           : L"Đăng nhập ely.by thất bại.";
        PostMessage(job->hwnd, WM_APP + 3, 0, reinterpret_cast<LPARAM>(result));
        delete job;
        return 0;
    }, job, 0, nullptr);
    if (thread) CloseHandle(thread);
}

void App::apply_auth_result(AuthResult* result) {
    modal_busy_ = false;
    if (!result) return;
    if (!result->ok) {
        modal_error_ = result->error.empty() ? L"Đăng nhập thất bại." : result->error;
        delete result;
        InvalidateRect(hwnd_, nullptr, FALSE);
        return;
    }
    std::wstring type = result->kind == 1 ? L"microsoft" : L"ely";
    std::wstring id = type + L"-" + result->uuid.substr(0, 8);
    Account* existing = nullptr;
    for (auto& account : accounts_) {
        if (account.type == type && account.uuid == result->uuid) {
            existing = &account;
            break;
        }
    }
    if (existing) {
        existing->name = result->name;
        existing->xuid = result->xuid;
        id = existing->id;
    } else {
        Account account;
        account.id = id;
        account.name = result->name;
        account.type = type;
        account.uuid = result->uuid;
        account.xuid = result->xuid;
        account.raw = Json::object();
        account.raw.set("created", Json::string(iso_now()));
        account.head = resolve_head(account, true);
        accounts_.push_back(account);
    }
    active_id_ = id;
    save_token(id, result->token_json);
    save_accounts();
    rebuild_account_rows();
    ui_apply_page();
    close_account_modal();
    notify(L"Đã thêm tài khoản",
           result->name + (result->kind == 1 ? L" · Microsoft" : L" · ely.by"), L"ok");
    delete result;
    InvalidateRect(hwnd_, nullptr, FALSE);
}
const DiscordLink* App::discord_link_for(const Account& account) const {
    for (const auto& link : discord_links_)
        if ((!link.account_uuid.empty() && link.account_uuid == account.uuid) ||
            (!link.account_id.empty() && link.account_id == account.id))
            return &link;
    return nullptr;
}

void App::refresh_discord_links() {
    std::wstring api_url = discord_api_url_;
    std::wstring api_key = discord_api_key_;
    HWND target = hwnd_;
    HANDLE thread = CreateThread(nullptr, 0, +[](LPVOID param) -> DWORD {
        auto* job = reinterpret_cast<std::pair<HWND, std::pair<std::wstring, std::wstring>>*>(param);
        std::string* body = new std::string(
            discord_links_body(job->second.first, job->second.second));
        PostMessage(job->first, WM_APP + 6, 0, reinterpret_cast<LPARAM>(body));
        delete job;
        return 0;
    }, new std::pair<HWND, std::pair<std::wstring, std::wstring>>(target, { api_url, api_key }), 0, nullptr);
    if (thread) CloseHandle(thread);
}

void App::apply_discord_links_body(const std::string& body) {
    Json root;
    root.parse(body);
    discord_links_.clear();
    const Json* items = root.find("items");
    if (items && items->type == Json::Type::Array) {
        for (const auto& item : items->arr) {
            DiscordLink link;
            link.id = utf8_to_wide(item.text("id"));
            link.account_id = utf8_to_wide(item.text("accountId"));
            link.account_uuid = utf8_to_wide(item.text("accountUuid"));
            link.account_name = utf8_to_wide(item.text("accountName"));
            link.discord_name = utf8_to_wide(item.text("discordName"));
            link.discord_tag = utf8_to_wide(item.text("discordTag"));
            link.discord_avatar = utf8_to_wide(item.text("discordAvatar"));
            if (!link.id.empty()) discord_links_.push_back(std::move(link));
        }
    }
    rebuild_account_rows();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::open_discord_link_modal(const std::wstring& account_id) {
    close_account_menu();
    modal_open_ = true;
    modal_kind_ = 3;
    modal_busy_ = false;
    modal_error_.clear();
    modal_show_pass_ = false;
    modal_user_.clear();
    modal_pass_.clear();
    modal_discord_account_ = account_id;
    const Account* account = find_account(account_id);
    modal_name_ = account ? account->name : L"";
    modal_focus_ = account ? -1 : 0;
    SetTimer(hwnd_, 4, 500, nullptr);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::start_discord_job() {
    if (modal_busy_) return;
    modal_busy_ = true;
    modal_error_.clear();
    DiscordJob* job = new DiscordJob{};
    job->hwnd = hwnd_;
    job->api_url = discord_api_url_;
    job->api_key = discord_api_key_;
    job->name = trim_text(modal_name_);
    job->account_id = modal_discord_account_;
    const Account* account = find_account(modal_discord_account_);
    if (account) {
        job->name = account->name;
        job->account_uuid = account->uuid;
    }
    SetTimer(hwnd_, 2, 16, nullptr);
    InvalidateRect(hwnd_, nullptr, FALSE);
    HANDLE thread = CreateThread(nullptr, 0, +[](LPVOID param) -> DWORD {
        DiscordJob* job = reinterpret_cast<DiscordJob*>(param);
        DiscordResult flow = discord_link_flow(job->api_url, job->api_key, job->name,
                                               job->account_id, job->account_uuid);
        DiscordAuthResult* result = new DiscordAuthResult();
        result->ok = flow.ok;
        result->error = flow.error;
        result->name = flow.name;
        result->uuid = flow.uuid;
        result->account_id = flow.account_id;
        result->discord_name = flow.discord_name;
        result->discord_tag = flow.discord_tag;
        result->discord_avatar = flow.discord_avatar;
        result->link_id = flow.link_id;
        result->created = flow.created;
        PostMessage(job->hwnd, WM_APP + 8, 0, reinterpret_cast<LPARAM>(result));
        delete job;
        return 0;
    }, job, 0, nullptr);
    if (thread) CloseHandle(thread);
}

void App::apply_discord_result(DiscordAuthResult* result) {
    modal_busy_ = false;
    if (!result) return;
    if (!result->ok) {
        modal_error_ = result->error.empty() ? L"Không liên kết được Discord." : result->error;
        InvalidateRect(hwnd_, nullptr, FALSE);
        return;
    }
    Account* account = nullptr;
    for (auto& item : accounts_) {
        if (item.uuid == result->uuid || item.id == result->account_id) {
            account = &item;
            break;
        }
    }
    if (!account) {
        Account created;
        created.id = result->account_id.empty()
                         ? L"off-" + result->uuid.substr(0, 8)
                         : result->account_id;
        created.name = trim_text(result->name);
        if (created.name.empty()) created.name = L"DiscordUser";
        created.type = L"offline";
        created.uuid = result->uuid;
        created.raw = Json::object();
        created.raw.set("created", Json::string(iso_now()));
        created.head = resolve_head(created, true);
        accounts_.push_back(created);
        account = &accounts_.back();
        active_id_ = created.id;
    }
    if (!result->link_id.empty()) {
        bool found = false;
        for (auto& link : discord_links_) {
            if (link.id == result->link_id) {
                link.discord_name = result->discord_name;
                link.discord_tag = result->discord_tag;
                link.discord_avatar = result->discord_avatar;
                link.account_uuid = result->uuid;
                link.account_id = account->id;
                link.account_name = account->name;
                found = true;
                break;
            }
        }
        if (!found) {
            DiscordLink link;
            link.id = result->link_id;
            link.account_id = account->id;
            link.account_uuid = result->uuid;
            link.account_name = account->name;
            link.discord_name = result->discord_name;
            link.discord_tag = result->discord_tag;
            link.discord_avatar = result->discord_avatar;
            discord_links_.push_back(std::move(link));
        }
    }
    save_accounts();
    rebuild_account_rows();
    ui_apply_page();
    close_account_modal();
    std::wstring tag = result->discord_tag.empty() ? result->discord_name : result->discord_tag;
    notify(L"Đã liên kết Discord", account->name + L" · " + tag, L"ok");
    refresh_discord_links();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::unlink_discord(const std::wstring& account_id) {
    const Account* account = find_account(account_id);
    if (!account) return;
    const DiscordLink* link = discord_link_for(*account);
    if (!link) {
        notify(L"Discord", L"Tài khoản này chưa liên kết Discord.", L"info");
        return;
    }
    std::wstring id = link->id;
    std::wstring api_url = discord_api_url_;
    std::wstring api_key = discord_api_key_;
    HWND target = hwnd_;
    struct UnlinkJob {
        HWND hwnd;
        std::wstring id;
        std::wstring url;
        std::wstring key;
    };
    HANDLE thread = CreateThread(nullptr, 0, +[](LPVOID param) -> DWORD {
        UnlinkJob* job = reinterpret_cast<UnlinkJob*>(param);
        std::wstring error;
        bool ok = discord_unlink(job->url, job->key, job->id, &error);
        auto* payload = new std::pair<bool, std::wstring>(ok, error);
        PostMessage(job->hwnd, WM_APP + 7, 0, reinterpret_cast<LPARAM>(payload));
        delete job;
        return 0;
    }, new UnlinkJob{ target, id, api_url, api_key }, 0, nullptr);
    if (thread) CloseHandle(thread);
}

void App::handle_unlink_result(bool ok, const std::wstring& error) {
    if (!ok) {
        notify(L"Discord", error.empty() ? L"Không bỏ liên kết được Discord." : error, L"bad");
        return;
    }
    notify(L"Discord", L"Đã bỏ liên kết Discord.", L"ok");
    refresh_discord_links();
}
void App::do_action(const std::wstring& action) {
    if (action == L"toggle:theme") {
        toggle_theme();
    } else if (action == L"menu:account") {
        toggle_account_menu();
    } else if (action == L"account:add") {
        open_account_modal();
    } else if (action == L"discord:add") {
        open_discord_link_modal(L"");
    } else if (action.rfind(L"discord:link:", 0) == 0) {
        open_discord_link_modal(action.substr(13));
    } else if (action.rfind(L"discord:unlink:", 0) == 0) {
        unlink_discord(action.substr(15));
    } else if (action.rfind(L"account:", 0) == 0) {
        select_account(action.substr(8));
    } else if (action == L"accounts:tab-list") {
        accounts_skin_ = false;
        ui_apply_page();
    } else if (action == L"accounts:tab-skin") {
        accounts_skin_ = true;
        ui_apply_page();
    } else if (action == L"accounts:mode-draw") {
        skin_upload_ = false;
        ui_apply_page();
    } else if (action == L"accounts:mode-upload") {
        skin_upload_ = true;
        ui_apply_page();
    } else if (action == L"skin:pick-skin" || action == L"skin:pick-cape") {
        notify(L"Tải tệp", L"Tính năng chọn tệp PNG đang được hoàn thiện.", L"info");
    } else if (action == L"skin:add-account") {
        notify(L"Tài khoản", L"Chức năng thêm tài khoản đang được hoàn thiện.", L"info");
    } else if (action == L"window:minimize") {
        ShowWindow(hwnd_, SW_MINIMIZE);
    } else if (action == L"window:maximize") {
        ShowWindow(hwnd_, IsZoomed(hwnd_) ? SW_RESTORE : SW_MAXIMIZE);
    } else if (action == L"window:close") {
        PostMessageW(hwnd_, WM_CLOSE, 0, 0);
    } else if (action.rfind(L"nav:", 0) == 0) {
        page_ = action.substr(4);
        close_account_menu();
        ui_apply_page();
    }
    dirty_ = true;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::tick() {
    ULONGLONG now = now_ms();
    if (splash_active()) update_splash(now);
    bool busy = splash_active();
    if (theme_animating_) {
        if (ui_theme_animating()) busy = true;
        else theme_animating_ = false;
    }
    if (pill_animating_) {
        float t = std::min(1.0f, float(now - pill_start_) / 500.0f);
        pill_cur_ = pill_from_ + (pill_to_ - pill_from_) * spring_ease(t);
        ui_set_sidebar_pill(pill_cur_, true);
        if (t >= 1.0f) pill_animating_ = false; else busy = true;
    }
    if (menu_animating_) {
        float t = std::min(1.0f, float(now - menu_start_) / 200.0f);
        menu_t_ = menu_ease(t);
        if (t >= 1.0f) { menu_animating_ = false; menu_t_ = 1.0f; } else busy = true;
    }
    if (caret_animating_) {
        float t = std::min(1.0f, float(now - caret_start_) / 220.0f);
        caret_cur_ = caret_from_ + (caret_to_ - caret_from_) * spring_ease(t);
        ui_set_caret_angle(caret_cur_);
        if (t >= 1.0f) { caret_animating_ = false; caret_cur_ = caret_to_; } else busy = true;
    }
    update_toasts(now);
    if (!toasts_.empty() || (modal_open_ && modal_busy_)) busy = true;
    if (busy) InvalidateRect(hwnd_, nullptr, FALSE);
    else KillTimer(hwnd_, 2);
}

float App::splash_progress(ULONGLONG now) const {
    if (splash_.phase == Splash::Phase::Open) return 100.0f;
    if (splash_.phase != Splash::Phase::Loading) return 0.0f;
    float ms = float(now - splash_.phase_start);
    float value = 0.0f;
    for (const auto& step : splash_.schedule) {
        if (ms >= step.first) value = step.second;
        else break;
    }
    return value;
}

void App::update_splash(ULONGLONG now) {
    if (splash_.phase == Splash::Phase::Loading || splash_.phase == Splash::Phase::Open)
        step_particles(now);
    if (splash_.phase == Splash::Phase::Video) {
        float elapsed = float(now - splash_.started);
        size_t index = std::min<size_t>(splash_.frames.size(),
                                        size_t(elapsed / 33.333f) + 1);
        if (index != splash_.index) splash_.index = index;
        size_t first = splash_.index > 3 ? splash_.index - 3 : 1;
        for (size_t i = first; i < splash_.index; ++i)
            renderer_.unload(splash_.frames[i - 1]);
        size_t last = std::min<size_t>(splash_.frames.size(), splash_.index + 6);
        for (size_t i = splash_.index; i <= last && i > 0; ++i)
            renderer_.image(splash_.frames[i - 1]);
        if (elapsed >= splash_.frames.size() * 33.333f) {
            splash_.phase = Splash::Phase::Loading;
            splash_.phase_start = now;
            splash_.schedule.clear();
            float current = 0.0f, t = 0.0f;
            for (int guard = 0; guard < 200; ++guard) {
                bool pause = rng_.next() < 0.12f;
                float delay = pause ? 260.0f : 45.0f;
                bool skip = rng_.next() < 0.18f;
                float inc = skip ? 0.0f
                                 : std::floor(2.0f + rng_.next() * (current > 80.0f ? 4.0f : 9.0f));
                t += delay;
                current = std::min(100.0f, current + inc);
                splash_.schedule.push_back({ t, current });
                if (current >= 100.0f) break;
            }
            splash_.total_ms = t;
            build_particles();
        }
    } else if (splash_.phase == Splash::Phase::Loading) {
        if (float(now - splash_.phase_start) >= splash_.total_ms + 300.0f) {
            splash_.phase = Splash::Phase::Open;
            splash_.open_start = now;
        }
    } else if (splash_.phase == Splash::Phase::Open) {
        if (now - splash_.open_start >= 950) {
            splash_.phase = Splash::Phase::None;
            for (const auto& frame : splash_.frames) renderer_.unload(frame);
            splash_.frames.clear();
            KillTimer(hwnd_, kSplashTimer);
            dirty_ = true;
        }
    }
}

void App::build_particles() {
    std::vector<unsigned char> pixels;
    unsigned w = 0, h = 0;
    if (!renderer_.load_pixels(asset(L"assets\\img\\splash-word.png"), pixels, w, h) ||
        w == 0 || h == 0)
        return;
    float sx = float(splash_.particle_w) / float(w);
    float sy = float(splash_.particle_h) / float(h);
    std::vector<std::pair<float, float>> points;
    for (unsigned y = 0; y < h; y += 2) {
        for (unsigned x = 0; x < w; x += 2) {
            if (pixels[(size_t(y) * w + x) * 4 + 3] > 128)
                points.emplace_back(x * sx, y * sy);
        }
    }
    for (size_t i = points.size(); i > 1; --i) {
        size_t j = std::min(i - 1, size_t(rng_.next() * float(i)));
        std::swap(points[i - 1], points[j]);
    }
    if (points.size() > 2500) points.resize(2500);
    splash_.particles.clear();
    splash_.particles.reserve(points.size());
    for (const auto& point : points) {
        Particle p;
        p.x = rng_.next() * float(splash_.particle_w);
        p.y = rng_.next() * float(splash_.particle_h);
        p.tx = point.first;
        p.ty = point.second;
        p.hue = 250.0f + rng_.next() * 80.0f;
        splash_.particles.push_back(p);
    }
    splash_.pixel_buffer.assign(size_t(splash_.particle_w) * splash_.particle_h * 4, 0);
    splash_.particles_ready = true;
    splash_.particle_last = now_ms();
}

void App::step_particles(ULONGLONG now) {
    if (!splash_.particles_ready || splash_.particles.empty()) return;
    float dt = std::clamp(float(now - splash_.particle_last) / 1000.0f, 0.0f, 0.033f);
    splash_.particle_last = now;
    if (dt <= 0.0f) return;
    for (auto& p : splash_.particles) {
        float ax = (p.tx - p.x) * 38.0f - p.vx * 7.5f;
        float ay = (p.ty - p.y) * 38.0f - p.vy * 7.5f;
        p.vx += ax * dt;
        p.vy += ay * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }
    auto& buffer = splash_.pixel_buffer;
    std::fill(buffer.begin(), buffer.end(), 0);
    const int W = splash_.particle_w;
    const int H = splash_.particle_h;
    for (const auto& p : splash_.particles) {
        float speed = std::min(std::sqrt(p.vx * p.vx + p.vy * p.vy) / 300.0f, 1.0f);
        float r = 0, g = 0, b = 0;
        hsl_to_rgb(p.hue - speed * 60.0f, 0.92f, 0.74f + speed * 0.18f, r, g, b);
        int px = int(std::floor(p.x));
        int py = int(std::floor(p.y));
        for (int oy = -1; oy <= 1; ++oy) {
            for (int ox = -1; ox <= 1; ++ox) {
                int x = px + ox, y = py + oy;
                if (x < 0 || y < 0 || x >= W || y >= H) continue;
                size_t index = (size_t(y) * W + x) * 4;
                buffer[index + 0] = (unsigned char)std::min(255.0f, buffer[index + 0] + b * 0.95f);
                buffer[index + 1] = (unsigned char)std::min(255.0f, buffer[index + 1] + g * 0.95f);
                buffer[index + 2] = (unsigned char)std::min(255.0f, buffer[index + 2] + r * 0.95f);
                buffer[index + 3] = (unsigned char)std::min(255, int(buffer[index + 3]) + 242);
            }
        }
    }
}

void App::draw_splash(ULONGLONG now) {
    if (splash_.phase == Splash::Phase::None) return;
    RECT rc{};
    GetClientRect(hwnd_, &rc);
    float w = float(rc.right - rc.left) / renderer_.scale();
    float h = float(rc.bottom - rc.top) / renderer_.scale();

    if (splash_.phase == Splash::Phase::Video) {
        ID2D1Bitmap* bmp = splash_.index > 0 && splash_.index <= splash_.frames.size()
                               ? renderer_.image(splash_.frames[splash_.index - 1])
                               : nullptr;
        if (bmp) renderer_.draw_image(bmp, D2D1::RectF(0, 0, w, h), 0.0f, 1.0f);
        else renderer_.fill_rect(D2D1::RectF(0, 0, w, h), 0.0f, Color::rgb(0x0C0E12));
        return;
    }

    float split = 0.0f;
    float content = 1.0f;
    if (splash_.phase == Splash::Phase::Open) {
        float open_ms = float(now - splash_.open_start);
        split = ease_split(open_ms / 900.0f);
        content = std::max(0.0f, 1.0f - open_ms / 300.0f);
    }
    const Color ink = Color::rgb(0x0C0E12);
    const Color fg = Color::rgb(0xE8EBF1);
    const Color muted = Color::rgb(0x99A2B1);
    const Color line = Color::rgb(0x242A33);
    float half = h * 0.505f;
    float top_h = half - half * split;
    float bottom_y = h - half + half * split;
    renderer_.fill_rect(D2D1::RectF(0, 0, w, top_h), 0.0f, ink);
    renderer_.fill_rect(D2D1::RectF(0, bottom_y, w, h), 0.0f, ink);

    if (splash_.particles_ready && !splash_.pixel_buffer.empty()) {
        float pw = std::min(w * 0.94f, 1120.0f);
        float ph = 300.0f;
        float left = (w - pw) * 0.5f;
        float top = (h - ph) * 0.5f;
        renderer_.draw_rgba(splash_.pixel_buffer, splash_.particle_w,
                            splash_.particle_h,
                            D2D1::RectF(left, top, left + pw, top + ph), content);
    }

    float progress = splash_progress(now);
    renderer_.draw_text(L"XyoLauncher+", D2D1::RectF(20, 20, 220, 40), 13, 700, false,
                        TextAlign::Left, fg, content);
    renderer_.draw_text(L"Đang tải launcher", D2D1::RectF(20, h - 120, w - 20, h - 100), 10.5f,
                        700, false, TextAlign::Left, muted, content);
    wchar_t number[16];
    swprintf(number, 16, L"%d", int(progress + 0.5f));
    wchar_t big[24];
    swprintf(big, 24, L"%d%%", int(progress + 0.5f));
    renderer_.draw_text(big, D2D1::RectF(20, h - 112, w - 20, h - 26), 68, 700, false,
                        TextAlign::Left, fg, content);
    renderer_.fill_rect(D2D1::RectF(20, h - 26, w - 20, h - 24), 0.0f,
                        Color{ line.r, line.g, line.b, line.a * content });
    float fill = (w - 40) * std::clamp(progress / 100.0f, 0.0f, 1.0f);
    renderer_.fill_rect(D2D1::RectF(20, h - 26, 20 + fill, h - 24), 0.0f,
                        Color{ fg.r, fg.g, fg.b, fg.a * content });
}

void App::paint() {
    RECT rc{};
    GetClientRect(hwnd_, &rc);
    renderer_.resize(UINT(rc.right - rc.left), UINT(rc.bottom - rc.top));
    if (!renderer_.ready()) return;
    if (dirty_) {
        ui_layout(ui_.get(), float(rc.right - rc.left) / renderer_.scale(),
                  float(rc.bottom - rc.top) / renderer_.scale(), renderer_);
        laid_out_ = true;
        dirty_ = false;
        start_pill_slide();
    }
    renderer_.begin(ui_color(L"bg"));
    ui_draw(ui_.get(), renderer_, hovered_);
    draw_account_menu();
    draw_toasts();
    draw_account_modal();
    draw_splash(now_ms());
    renderer_.end();
}

void App::on_resize() {
    RECT rc{};
    GetClientRect(hwnd_, &rc);
    renderer_.resize(UINT(rc.right - rc.left), UINT(rc.bottom - rc.top));
    dirty_ = true;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::on_dpi_changed() {
    dirty_ = true;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::on_mouse_move(int px, int py) {
    mouse_x_ = float(px) / renderer_.scale();
    mouse_y_ = float(py) / renderer_.scale();
    if (splash_active()) return;
    if (modal_open_) {
        hovered_ = nullptr;
        SetCursor(LoadCursorW(nullptr, IDC_ARROW));
        return;
    }
    if (toast_mouse_move(px, py)) {
        if (hovered_) {
            hovered_ = nullptr;
            InvalidateRect(hwnd_, nullptr, FALSE);
        }
        SetCursor(LoadCursorW(nullptr, toast_close_hover_ ? IDC_HAND : IDC_ARROW));
        return;
    }
    float x = px / renderer_.scale();
    float y = py / renderer_.scale();
    Node* hit = menu_open_ ? ui_hit(menu_.get(), x, y) : nullptr;
    if (!hit) hit = ui_hit(ui_.get(), x, y);
    if (hit != hovered_) {
        hovered_ = hit;
        InvalidateRect(hwnd_, nullptr, FALSE);
    }
    SetCursor(LoadCursorW(nullptr, hit && !hit->action.empty() ? IDC_HAND : IDC_ARROW));
}

std::wstring App::settings_path() const {
    wchar_t dir[MAX_PATH]{};
    DWORD len = GetEnvironmentVariableW(L"APPDATA", dir, MAX_PATH);
    std::wstring folder = len > 0 && len < MAX_PATH ? std::wstring(dir, len) : base_;
    folder += L"\\XyoLauncher+";
    CreateDirectoryW(folder.c_str(), nullptr);
    return folder + L"\\engine.ini";
}

void App::save_settings() {
    std::wstring path = settings_path();
    WritePrivateProfileStringW(L"engine", L"theme", dark_ ? L"dark" : L"light", path.c_str());
}

std::wstring App::active_nav_id() const {
    if (page_ == L"home") return L"nav-home";
    if (page_ == L"modpacks") return L"nav-modpacks";
    if (page_ == L"versions") return L"nav-versions";
    return L"";
}

void App::start_pill_slide() {
    if (!laid_out_ || !ui_) return;
    std::wstring id = active_nav_id();
    Node* nav = id.empty() ? nullptr : ui_find(ui_.get(), id);
    if (!nav) {
        ui_set_sidebar_pill(0.0f, false);
        pill_show_ = false;
        pill_animating_ = false;
        return;
    }
    float target = nav->rect.top;
    pill_show_ = true;
    if (pill_pending_) {
        pill_cur_ = pill_from_ = pill_to_ = target;
        pill_pending_ = false;
        ui_set_sidebar_pill(target, true);
        return;
    }
    if (std::fabs(target - pill_cur_) < 0.5f) {
        ui_set_sidebar_pill(pill_cur_, true);
        return;
    }
    pill_from_ = pill_cur_;
    pill_to_ = target;
    pill_start_ = now_ms();
    pill_animating_ = true;
    SetTimer(hwnd_, 2, 16, nullptr);
}

void App::toggle_account_menu() {
    if (menu_open_) {
        close_account_menu();
        return;
    }
    menu_open_ = true;
    menu_animating_ = true;
    menu_t_ = 0.0f;
    menu_start_ = now_ms();
    caret_from_ = caret_cur_;
    caret_to_ = 180.0f;
    caret_start_ = now_ms();
    caret_animating_ = true;
    if (Node* acct = ui_find(ui_.get(), L"acct-btn"))
        acct->style.bg = ui_token(L"surfaceActive");
    SetTimer(hwnd_, 2, 16, nullptr);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::close_account_menu() {
    if (!menu_open_) return;
    menu_open_ = false;
    menu_animating_ = false;
    menu_t_ = 1.0f;
    hovered_ = nullptr;
    caret_from_ = caret_cur_;
    caret_to_ = 0.0f;
    caret_start_ = now_ms();
    caret_animating_ = true;
    if (Node* acct = ui_find(ui_.get(), L"acct-btn"))
        acct->style.bg = ui_token(page_ == L"accounts" ? L"surfaceActive" : L"hover");
    SetTimer(hwnd_, 2, 16, nullptr);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::on_key_down(WPARAM key) {
    if (account_modal_key(key)) return;
    if (key == VK_ESCAPE) close_account_menu();
}

void App::on_char(wchar_t ch) {
    if (modal_open_) account_modal_char(ch);
}

void App::draw_account_menu() {
    if (!menu_open_ || !menu_) return;
    RECT rc{};
    GetClientRect(hwnd_, &rc);
    float w = float(rc.right - rc.left) / renderer_.scale();
    float h = float(rc.bottom - rc.top) / renderer_.scale();
    Node* acct = ui_find(ui_.get(), L"acct-btn");
    if (!acct) return;
    const float menu_w = 180.0f;
    const float menu_h = 151.0f + 48.0f * float(std::max<size_t>(1, accounts_.size()));
    float x = acct->rect.left;
    float bottom = acct->rect.top - 6.0f;
    float y = bottom - menu_h;
    if (y < 8.0f) y = 8.0f;
    if (x + menu_w > w - 8.0f) x = w - 8.0f - menu_w;
    (void)h;
    ui_layout(menu_.get(), menu_w, menu_h, renderer_);
    ui_move(menu_.get(), x, y + 6.0f * (1.0f - menu_t_));
    renderer_.opacity_push(menu_t_);
    ui_draw(menu_.get(), renderer_, hovered_);
    renderer_.opacity_pop();
}

void App::notify(const std::wstring& title, const std::wstring& message,
                 const std::wstring& tone, float duration) {
    Toast toast;
    toast.id = ++toast_seq_;
    toast.title = title;
    toast.message = message;
    toast.tone = tone;
    toast.total = toast.left = std::max(0.0f, duration);
    toast.start = now_ms();
    toasts_.insert(toasts_.begin(), std::move(toast));
    while (toasts_.size() > 5) toasts_.pop_back();
    toast_last_ = now_ms();
    SetTimer(hwnd_, 2, 16, nullptr);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::layout_toasts() {
    if (toasts_.empty()) return;
    RECT rc{};
    GetClientRect(hwnd_, &rc);
    float w = float(rc.right - rc.left) / renderer_.scale();
    float h = float(rc.bottom - rc.top) / renderer_.scale();
    const float width = 350.0f;
    const float card_h = 68.0f;
    float bottom = h - 16.0f;
    float right = w - 16.0f;
    ULONGLONG now = now_ms();
    int index = 0;
    for (auto& toast : toasts_) {
        float enter = std::clamp(float(now - toast.start) / 500.0f, 0.0f, 1.0f);
        float ep = spring_ease(enter);
        float scale = toast_open_ ? 1.0f : std::max(0.7f, 1.0f - index * 0.06f);
        float alpha = toast_open_ || index <= 2 ? 1.0f : 0.0f;
        scale *= 0.9f + 0.1f * ep;
        alpha *= ep;
        float card_w = width * scale;
        float card_h2 = card_h * scale;
        float ybottom = (toast_open_ ? bottom : bottom - index * 14.0f) + (1.0f - ep) * 90.0f;
        toast.rect = D2D1::RectF(right - card_w, ybottom - card_h2, right, ybottom);
        toast.draw_scale = scale;
        toast.draw_alpha = alpha;
        if (toast_open_) bottom -= card_h + 8.0f;
        ++index;
    }
}

void App::update_toasts(ULONGLONG now) {
    if (toasts_.empty()) {
        toast_open_ = false;
        toast_close_hover_ = false;
        toast_last_ = now;
        return;
    }
    if (toast_last_ == 0) toast_last_ = now;
    float dt = float(now - toast_last_);
    toast_last_ = now;
    bool changed = false;
    for (size_t i = 0; i < toasts_.size();) {
        if (toasts_[i].exiting && now - toasts_[i].exit_start >= 450) {
            toasts_.erase(toasts_.begin() + i);
            changed = true;
        } else {
            ++i;
        }
    }
    if (!toast_open_) {
        for (auto& toast : toasts_) {
            if (toast.exiting) continue;
            if (toast.total > 0.0f) {
                toast.left = std::max(0.0f, toast.left - dt);
                if (toast.left <= 0.0f) {
                    toast.exiting = true;
                    toast.exit_start = now;
                }
            }
            break;
        }
    }
    if (toasts_.empty()) {
        toast_open_ = false;
        toast_close_hover_ = false;
        InvalidateRect(hwnd_, nullptr, FALSE);
    }
    (void)changed;
}

void App::draw_toasts() {
    if (toasts_.empty()) return;
    layout_toasts();
    ULONGLONG now = now_ms();
    for (int i = int(toasts_.size()) - 1; i >= 0; --i) {
        Toast& toast = toasts_[size_t(i)];
        float alpha = toast.draw_alpha;
        if (toast.exiting)
            alpha *= std::clamp(1.0f - float(now - toast.exit_start) / 450.0f, 0.0f, 1.0f);
        if (alpha <= 0.002f) continue;
        D2D1_RECT_F r = toast.rect;
        float f = toast.draw_scale;
        Color tone = ui_color(toast.tone == L"ok" ? L"ok"
                             : toast.tone == L"bad" ? L"bad"
                             : toast.tone == L"warn" ? L"warn"
                             : toast.tone == L"load" ? L"accent"
                                                     : L"accent");
        const wchar_t* icon = toast.tone == L"ok"       ? L"assets\\icons\\sparkle.svg"
                              : toast.tone == L"bad"    ? L"assets\\icons\\warning-circle.svg"
                              : toast.tone == L"warn"   ? L"assets\\icons\\warning-circle.svg"
                              : toast.tone == L"load"   ? L"assets\\icons\\upload.svg"
                                                        : L"assets\\icons\\info.svg";

        renderer_.fill_rect(D2D1::RectF(r.left + 2.0f, r.top + 8.0f, r.right + 2.0f,
                                        r.bottom + 8.0f),
                            20.0f * f, Color::rgb(0x000000, 0.30f * alpha));
        renderer_.fill_rect(r, 20.0f * f, ui_color(L"surface"), alpha);
        renderer_.stroke_rect(r, 20.0f * f, ui_color(L"border"), 1.0f, alpha);

        float pad = 14.0f * f;
        float icon_size = 36.0f * f;
        float center_y = (r.top + r.bottom) * 0.5f;
        D2D1_RECT_F icon_box = D2D1::RectF(r.left + pad, center_y - icon_size * 0.5f,
                                           r.left + pad + icon_size,
                                           center_y + icon_size * 0.5f);
        renderer_.fill_rect(icon_box, 12.0f * f,
                            Color{ tone.r, tone.g, tone.b, 0.15f * alpha });
        D2D1_RECT_F icon_rect = D2D1::RectF(icon_box.left + 9.0f * f, icon_box.top + 9.0f * f,
                                            icon_box.right - 9.0f * f,
                                            icon_box.bottom - 9.0f * f);
        renderer_.draw_svg(asset(icon), icon_rect, Color{ tone.r, tone.g, tone.b, alpha }, 1.0f);

        float close_size = 30.0f * f;
        D2D1_RECT_F close_rect = D2D1::RectF(r.right - 12.0f * f - close_size,
                                             center_y - close_size * 0.5f,
                                             r.right - 12.0f * f,
                                             center_y + close_size * 0.5f);
        if (!toast.exiting) toast.close_rect = close_rect;
        bool close_hover = !toast.exiting && toast_close_hover_ &&
                           mouse_x_ >= close_rect.left && mouse_x_ <= close_rect.right &&
                           mouse_y_ >= close_rect.top && mouse_y_ <= close_rect.bottom;
        if (close_hover)
            renderer_.fill_rect(close_rect, 15.0f * f, ui_color(L"hover"), alpha);
        D2D1_RECT_F close_icon = D2D1::RectF(close_rect.left + 8.0f * f,
                                             close_rect.top + 8.0f * f,
                                             close_rect.right - 8.0f * f,
                                             close_rect.bottom - 8.0f * f);
        renderer_.draw_svg(asset(L"assets\\icons\\x.svg"), close_icon,
                           close_hover ? ui_color(L"text") : ui_color(L"label"), alpha);

        float text_x = r.left + 62.0f * f;
        float text_w = close_rect.left - 8.0f * f - text_x;
        D2D1_RECT_F title_rect = D2D1::RectF(text_x, r.top + 13.0f * f,
                                             text_x + text_w, r.top + 33.0f * f);
        renderer_.draw_text(toast.title, title_rect, 14.0f * f, 700, false,
                            TextAlign::Left, ui_color(L"text"), alpha, false);
        if (!toast.message.empty()) {
            D2D1_RECT_F msg_rect = D2D1::RectF(text_x, r.top + 33.0f * f,
                                               text_x + text_w, r.top + 51.0f * f);
            renderer_.draw_text(toast.message, msg_rect, 12.5f * f, 600, false,
                                TextAlign::Left, ui_color(L"label"), alpha, false);
        }
        if (toast.total > 0.0f) {
            float frac = std::clamp(toast.left / toast.total, 0.0f, 1.0f);
            D2D1_RECT_F bar = D2D1::RectF(r.left + 16.0f * f, r.bottom - 3.0f * f,
                                          r.right - 16.0f * f, r.bottom - 1.0f * f);
            renderer_.fill_rect(bar, 1.0f * f, Color{ tone.r, tone.g, tone.b, 0.18f * alpha });
            renderer_.fill_rect(D2D1::RectF(bar.left, bar.top,
                                            bar.left + (bar.right - bar.left) * frac, bar.bottom),
                                1.0f * f, Color{ tone.r, tone.g, tone.b, 0.5f * alpha });
        }
    }
}

bool App::toast_mouse_move(int px, int py) {
    if (toasts_.empty()) {
        toast_open_ = false;
        toast_close_hover_ = false;
        return false;
    }
    RECT rc{};
    GetClientRect(hwnd_, &rc);
    float w = float(rc.right - rc.left) / renderer_.scale();
    float h = float(rc.bottom - rc.top) / renderer_.scale();
    float x = float(px) / renderer_.scale();
    float y = float(py) / renderer_.scale();
    int count = int(toasts_.size());
    float zone_h = 76.0f + float(std::max(0, count - 1)) * (toast_open_ ? 76.0f : 14.0f);
    bool inside = x >= w - 16.0f - 350.0f && x <= w - 16.0f &&
                  y >= h - 16.0f - zone_h && y <= h - 16.0f;
    bool prev = toast_open_;
    toast_open_ = inside;
    toast_close_hover_ = false;
    bool over_close = false;
    for (const auto& toast : toasts_) {
        if (toast.exiting) continue;
        if (x >= toast.close_rect.left && x <= toast.close_rect.right &&
            y >= toast.close_rect.top && y <= toast.close_rect.bottom) {
            toast_close_hover_ = true;
            over_close = true;
        }
    }
    if (prev != toast_open_) InvalidateRect(hwnd_, nullptr, FALSE);
    return toast_open_ || over_close;
}

bool App::toast_mouse_down(int px, int py) {
    if (toasts_.empty()) return false;
    float x = float(px) / renderer_.scale();
    float y = float(py) / renderer_.scale();
    for (auto& toast : toasts_) {
        if (toast.exiting) continue;
        if (x >= toast.close_rect.left && x <= toast.close_rect.right &&
            y >= toast.close_rect.top && y <= toast.close_rect.bottom) {
            toast.exiting = true;
            toast.exit_start = now_ms();
            toast_open_ = false;
            toast_close_hover_ = false;
            SetTimer(hwnd_, 2, 16, nullptr);
            InvalidateRect(hwnd_, nullptr, FALSE);
            return true;
        }
    }
    for (const auto& toast : toasts_) {
        if (x >= toast.rect.left && x <= toast.rect.right &&
            y >= toast.rect.top && y <= toast.rect.bottom)
            return true;
    }
    return false;
}

void App::toggle_theme() {
    dark_ = !dark_;
    theme_animating_ = true;
    ui_set_dark(dark_);
    ui_start_theme_anim(dark_);
    SetTimer(hwnd_, 2, 16, nullptr);
    save_settings();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::add_tray() {
    HINSTANCE inst = GetModuleHandleW(nullptr);
    tray_icon_ = LoadIconW(inst, MAKEINTRESOURCEW(1));
    if (!tray_icon_) tray_icon_ = LoadIconW(nullptr, IDI_APPLICATION);
    SendMessageW(hwnd_, WM_SETICON, ICON_BIG, LPARAM(tray_icon_));
    SendMessageW(hwnd_, WM_SETICON, ICON_SMALL, LPARAM(tray_icon_));
    tray_.cbSize = sizeof(tray_);
    tray_.hWnd = hwnd_;
    tray_.uID = 1;
    tray_.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    tray_.uCallbackMessage = WM_APP + 1;
    tray_.hIcon = tray_icon_;
    wcscpy_s(tray_.szTip, L"XyoLauncher+");
    tray_added_ = Shell_NotifyIconW(NIM_ADD, &tray_) != FALSE;
}

void App::remove_tray() {
    if (tray_added_) {
        Shell_NotifyIconW(NIM_DELETE, &tray_);
        tray_added_ = false;
    }
}

void App::toggle_window() {
    if (IsWindowVisible(hwnd_)) {
        ShowWindow(hwnd_, SW_HIDE);
    } else {
        ShowWindow(hwnd_, SW_SHOW);
        ShowWindow(hwnd_, SW_RESTORE);
        SetForegroundWindow(hwnd_);
    }
}

void App::on_tray(UINT event) {
    if (event == WM_LBUTTONUP || event == WM_LBUTTONDBLCLK || event == NIN_SELECT) {
        toggle_window();
        return;
    }
    if (event == WM_RBUTTONUP || event == WM_CONTEXTMENU) {
        POINT pt{};
        GetCursorPos(&pt);
        bool visible = IsWindowVisible(hwnd_) != FALSE;
        HMENU menu = CreatePopupMenu();
        AppendMenuW(menu, MF_STRING, 1, visible ? L"Ẩn launcher" : L"Mở XyoLauncher+");
        AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
        AppendMenuW(menu, MF_STRING, 2, L"Thoát XyoLauncher+");
        SetForegroundWindow(hwnd_);
        int cmd = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_NONOTIFY,
                                 pt.x, pt.y, 0, hwnd_, nullptr);
        DestroyMenu(menu);
        PostMessageW(hwnd_, WM_NULL, 0, 0);
        if (cmd == 1) toggle_window();
        else if (cmd == 2) PostMessageW(hwnd_, WM_CLOSE, 0, 0);
    }
}

void App::on_double_click(int px, int py) {
    if (splash_active() || modal_open_) return;
    float x = px / renderer_.scale();
    float y = py / renderer_.scale();
    Node* hit = ui_hit(ui_.get(), x, y);
    if (hit && hit->action == L"window:drag") do_action(L"window:maximize");
}

void App::on_mouse_down(int px, int py) {
    if (splash_active()) return;
    if (account_modal_mouse_down(px, py)) return;
    if (toast_mouse_down(px, py)) return;
    float x = px / renderer_.scale();
    float y = py / renderer_.scale();
    Node* hit = nullptr;
    if (menu_open_) {
        hit = ui_hit(menu_.get(), x, y);
        if (hit) {
            pressed_ = hit->action;
            return;
        }
        Node* normal = ui_hit(ui_.get(), x, y);
        bool account = normal && normal->action == L"menu:account";
        close_account_menu();
        if (account) {
            pressed_.clear();
            return;
        }
    }
    hit = ui_hit(ui_.get(), x, y);
    pressed_ = hit ? hit->action : L"";
    if (pressed_ == L"window:drag") {
        pressed_.clear();
        ReleaseCapture();
        SendMessageW(hwnd_, WM_NCLBUTTONDOWN, HTCAPTION, 0);
    }
}

void App::on_mouse_up(int px, int py) {
    if (splash_active()) { pressed_.clear(); return; }
    if (modal_open_) { pressed_.clear(); return; }
    float x = px / renderer_.scale();
    float y = py / renderer_.scale();
    Node* hit = menu_open_ ? ui_hit(menu_.get(), x, y) : nullptr;
    if (!hit) hit = ui_hit(ui_.get(), x, y);
    std::wstring action = hit ? hit->action : L"";
    if (!pressed_.empty() && action == pressed_) do_action(action);
    pressed_.clear();
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    auto app = reinterpret_cast<App*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    switch (msg) {
        case WM_CREATE: {
            auto instance = new App(hwnd);
            if (!instance->init()) {
                delete instance;
                return -1;
            }
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(instance));
            return 0;
        }
        case WM_NCCALCSIZE:
            if (wp) return 0;
            break;
        case WM_NCHITTEST: {
            POINT pt{ GET_X_LPARAM(lp), GET_Y_LPARAM(lp) };
            ScreenToClient(hwnd, &pt);
            RECT rc{};
            GetClientRect(hwnd, &rc);
            int edge = 7;
            bool left = pt.x < edge, right = pt.x >= rc.right - edge;
            bool top = pt.y < edge, bottom = pt.y >= rc.bottom - edge;
            if (top && left) return HTTOPLEFT;
            if (top && right) return HTTOPRIGHT;
            if (bottom && left) return HTBOTTOMLEFT;
            if (bottom && right) return HTBOTTOMRIGHT;
            if (left) return HTLEFT;
            if (right) return HTRIGHT;
            if (top) return HTTOP;
            if (bottom) return HTBOTTOM;
            return HTCLIENT;
        }
        case WM_SIZE:
            if (app) app->on_resize();
            return 0;
        case WM_GETMINMAXINFO: {
            auto info = reinterpret_cast<MINMAXINFO*>(lp);
            UINT dpi = GetDpiForWindow(hwnd);
            if (dpi == 0) dpi = 96;
            info->ptMinTrackSize.x = int(980.0f * dpi / 96.0f);
            info->ptMinTrackSize.y = int(640.0f * dpi / 96.0f);
            return 0;
        }
        case WM_DPICHANGED:
            if (app) app->on_dpi_changed();
            if (auto suggested = reinterpret_cast<RECT*>(lp)) {
                SetWindowPos(hwnd, nullptr, suggested->left, suggested->top,
                             suggested->right - suggested->left,
                             suggested->bottom - suggested->top,
                             SWP_NOZORDER | SWP_NOACTIVATE);
            }
            return 0;
        case WM_APP + 1:
            if (app) app->on_tray(UINT(lp));
            return 0;
        case WM_KEYDOWN:
            if (app) app->on_key_down(wp);
            return 0;
        case WM_CHAR:
            if (app) app->on_char(wchar_t(wp));
            return 0;
        case WM_APP + 3:
            if (app) app->handle_auth_result(lp);
            return 0;
        case WM_APP + 6:
            if (app) app->handle_discord_links_msg(lp);
            return 0;
        case WM_APP + 7:
            if (app) app->handle_unlink_msg(lp);
            return 0;
        case WM_APP + 8:
            if (app) app->handle_discord_result_msg(lp);
            return 0;
        case WM_TIMER:
            if (wp == 4) { InvalidateRect(hwnd, nullptr, FALSE); return 0; }
            if (app && (wp == kSplashTimer || wp == 2)) app->tick();
            return 0;
        case WM_PAINT: {
            PAINTSTRUCT ps{};
            BeginPaint(hwnd, &ps);
            if (app) app->paint();
            EndPaint(hwnd, &ps);
            return 0;
        }
        case WM_MOUSEMOVE:
            if (app) app->on_mouse_move(GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
            return 0;
        case WM_LBUTTONDOWN:
            if (app) app->on_mouse_down(GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
            return 0;
        case WM_LBUTTONDBLCLK:
            if (app) app->on_double_click(GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
            return 0;
        case WM_LBUTTONUP:
            if (app) app->on_mouse_up(GET_X_LPARAM(lp), GET_Y_LPARAM(lp));
            return 0;
        case WM_CLOSE:
            DestroyWindow(hwnd);
            return 0;
        case WM_DESTROY:
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            delete app;
            PostQuitMessage(0);
            return 0;
        default:
            break;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int show) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    SetCurrentDirectoryW([] {
        static wchar_t dir[MAX_PATH];
        GetModuleFileNameW(nullptr, dir, MAX_PATH);
        for (int i = int(wcslen(dir)) - 1; i >= 0; --i) {
            if (dir[i] == L'\\' || dir[i] == L'/') { dir[i] = L'\0'; break; }
        }
        return dir;
    }());

    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = WndProc;
    wc.hInstance = instance;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(1));
    if (!wc.hIcon) wc.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    wc.lpszClassName = L"XyoLauncherPlusWindow";
    RegisterClassExW(&wc);

    UINT dpi = GetDpiForSystem();
    int width = int(1180 * dpi / 96.0f);
    int height = int(760 * dpi / 96.0f);
    RECT work{};
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
    int pos_x = work.left + ((work.right - work.left) - width) / 2;
    int pos_y = work.top + ((work.bottom - work.top) - height) / 2;
    HWND hwnd = CreateWindowExW(WS_EX_APPWINDOW, wc.lpszClassName, L"XyoLauncher+",
                                WS_POPUP | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX,
                                pos_x, pos_y, width, height,
                                nullptr, nullptr, instance, nullptr);
    if (!hwnd) return 1;
    ShowWindow(hwnd, show == 0 ? SW_SHOWNORMAL : show);
    UpdateWindow(hwnd);
    InvalidateRect(hwnd, nullptr, FALSE);

    MSG msg{};
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    CoUninitialize();
    return int(msg.wParam);
}
