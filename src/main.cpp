#include "common.h"
#include "render.h"
#include "ui.h"
#include "json.h"
#include "net.h"
#include "auth.h"
#include "discord.h"
#include "anim.h"
#include "fs.h"
#include "mc.h"
#include "java.h"
#include "launch.h"
#include <d2d1helper.h>
#include <windowsx.h>
#include <commdlg.h>
#include <shellapi.h>
#include <shlobj.h>
#include <string>
#include <vector>
#include <set>
#include <cmath>
#include <functional>
#include <memory>
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

struct RecentWorldInfo {
    std::wstring folder;
    std::wstring name;
    std::wstring played_at;
};

struct RecentServerInfo {
    std::wstring host;
    int port = 25565;
    std::wstring played_at;
};

struct InstanceInfo {
    std::wstring id;
    std::wstring name;
    std::wstring version;
    std::wstring loader;
    std::wstring loader_version;
    std::wstring version_id;
    std::wstring forge_version;
    std::wstring dir;
    std::wstring status;
    std::wstring icon;
    std::wstring last_played;
    std::wstring created;
    std::wstring username;
    std::wstring java_path;
    std::wstring jvm_args;
    bool demo = false;
    int memory_mb = 4096;
    double playtime_ms = 0;
    std::vector<RecentWorldInfo> worlds;
    std::vector<RecentServerInfo> servers;
};

struct LaunchProgressMsg {
    std::wstring id;
    std::wstring phase;
    std::wstring label;
    uint64_t done = 0;
    uint64_t total = 0;
    uint64_t bytes = 0;
    uint64_t bytes_total = 0;
};

struct LaunchLogMsg {
    std::wstring id;
    std::wstring line;
};

struct LaunchStateMsg {
    std::wstring id;
    std::wstring state;
};

struct LaunchExitMsg {
    std::wstring id;
    std::wstring error;
    std::wstring title;
    std::wstring hint;
    int code = 0;
    bool crashed = false;
};

struct LaunchUiState {
    std::wstring id;
    std::wstring phase;
    std::wstring label;
    uint64_t done = 0;
    uint64_t total = 0;
    uint64_t bytes = 0;
    uint64_t bytes_total = 0;
    std::vector<std::wstring> lines;
    bool crashed = false;
    std::wstring crash_title;
    std::wstring crash_hint;
    std::wstring error;
    std::wstring java_path;
    int exit_code = 0;
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

struct VersionInfo {
    std::wstring id;
    std::wstring release_time;
    std::wstring type;
};

struct LoaderInfo {
    std::wstring id;
    std::wstring name;
    std::wstring desc;
    std::wstring build;
    bool supported = false;
    bool stable = false;
    bool vanilla = false;
    bool loaded = false;
    int games = 0;
};

struct LoaderBuild {
    std::wstring version;
    std::wstring build;
    bool stable = true;
    bool latest = false;
    bool beta = false;
};

struct LoaderGamesResult {
    std::wstring kind;
    bool ok = false;
    bool all = false;
    std::set<std::wstring> games;
};

struct LoaderBuildsResult {
    std::wstring kind;
    std::wstring game;
    bool ok = false;
    std::vector<LoaderBuild> rows;
};

struct CreatedInstance {
    bool ok = false;
    std::wstring error;
    std::wstring id;
    std::wstring name;
};

struct HomeData {
    bool ok = false;
    std::wstring latest;
    std::wstring latest_snapshot;
    std::vector<VersionInfo> releases;
    std::vector<VersionInfo> all;
    int total = 0;
    std::vector<LoaderInfo> loaders;
};

struct HomeSystem {
    bool ok = false;
    unsigned long long total_mem = 0;
    unsigned long long free_mem = 0;
    unsigned long long disk_total = 0;
    unsigned long long disk_free = 0;
    unsigned long long assets_bytes = 0;
    unsigned long long java_bytes = 0;
    int cpu_threads = 0;
    int java_count = 0;
    std::wstring cpu_model;
    std::wstring shared_dir;
};

struct BgItem {
    std::wstring id;
    std::wstring name;
    std::wstring ext;
    bool local = false;
    bool ready = false;
    std::wstring file;
};

struct ManagedJava {
    std::wstring component;
    std::wstring name;
    std::wstring released;
    std::wstring java_path;
    std::wstring dir;
    int major = 0;
    bool installed = false;
    unsigned long long bytes = 0;
};

struct ZuluJava {
    std::wstring name;
    std::wstring java_path;
    std::wstring dir;
    int major = 0;
    unsigned long long bytes = 0;
};

struct ExternalJava {
    std::wstring name;
    std::wstring java_path;
    int major = 0;
};

struct JavaState {
    std::vector<ManagedJava> managed;
    std::vector<ZuluJava> zulu;
    std::vector<ExternalJava> external;
};

struct BgResult {
    std::wstring id;
    bool ok = false;
    std::wstring error;
};

static std::vector<LoaderInfo> default_loaders();

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
    bool conflict = false;
    std::wstring holder;
    std::wstring moved_from;
    bool replaced = false;
    int seq = 0;
};

struct DiscordJob {
    HWND hwnd = nullptr;
    std::wstring api_url;
    std::wstring api_key;
    std::wstring name;
    std::wstring account_id;
    std::wstring account_uuid;
    bool force = false;
    int seq = 0;
};

struct AuthJob {
    HWND hwnd = nullptr;
    int kind = 0;
    std::wstring user;
    std::wstring pass;
};

struct QuadMap {
    float h[9]{};
    bool valid = false;
};

static QuadMap quad_map(float x0, float y0, float x1, float y1, float x2, float y2,
                        float x3, float y3) {
    QuadMap map;
    float dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    float dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    float den = dx1 * dy2 - dx2 * dy1;
    if (std::fabs(den) < 1e-6f) {
        map.h[0] = x1 - x0;
        map.h[1] = x2 - x1;
        map.h[2] = x0;
        map.h[3] = y1 - y0;
        map.h[4] = y2 - y1;
        map.h[5] = y0;
        map.h[6] = 0.0f;
        map.h[7] = 0.0f;
        map.h[8] = 1.0f;
    } else {
        float g = (dx3 * dy2 - dx2 * dy3) / den;
        float h = (dx1 * dy3 - dx3 * dy1) / den;
        map.h[0] = x1 - x0 + g * x1;
        map.h[1] = x3 - x0 + h * x3;
        map.h[2] = x0;
        map.h[3] = y1 - y0 + g * y1;
        map.h[4] = y3 - y0 + h * y3;
        map.h[5] = y0;
        map.h[6] = g;
        map.h[7] = h;
        map.h[8] = 1.0f;
    }
    map.valid = true;
    return map;
}

static void quad_project(const QuadMap& map, float u, float v, float& x, float& y) {
    float den = map.h[6] * u + map.h[7] * v + map.h[8];
    if (std::fabs(den) < 1e-6f) den = 1e-6f;
    x = (map.h[0] * u + map.h[1] * v + map.h[2]) / den;
    y = (map.h[3] * u + map.h[4] * v + map.h[5]) / den;
}

static bool quad_unproject(const QuadMap& map, float x, float y, float& u, float& v) {
    const float* m = map.h;
    float det = m[0] * (m[4] * m[8] - m[5] * m[7]) -
                m[1] * (m[3] * m[8] - m[5] * m[6]) +
                m[2] * (m[3] * m[7] - m[4] * m[6]);
    if (std::fabs(det) < 1e-8f) return false;
    float inv[9];
    inv[0] = (m[4] * m[8] - m[5] * m[7]) / det;
    inv[1] = (m[2] * m[7] - m[1] * m[8]) / det;
    inv[2] = (m[1] * m[5] - m[2] * m[4]) / det;
    inv[3] = (m[5] * m[6] - m[3] * m[8]) / det;
    inv[4] = (m[0] * m[8] - m[2] * m[6]) / det;
    inv[5] = (m[2] * m[3] - m[0] * m[5]) / det;
    inv[6] = (m[3] * m[7] - m[4] * m[6]) / det;
    inv[7] = (m[1] * m[6] - m[0] * m[7]) / det;
    inv[8] = (m[0] * m[4] - m[1] * m[3]) / det;
    float w = inv[6] * x + inv[7] * y + inv[8];
    if (std::fabs(w) < 1e-6f) return false;
    u = (inv[0] * x + inv[1] * y + inv[2]) / w;
    v = (inv[3] * x + inv[4] * y + inv[5]) / w;
    return u >= -0.02f && u <= 1.02f && v >= -0.02f && v <= 1.02f;
}

class App {
public:
    explicit App(HWND hwnd) : hwnd_(hwnd) {}
    ~App() { remove_tray(); }

    bool init();
    void tick();
    void paint();
    void on_resize();
    void on_mouse_move(int px, int py);
    void on_mouse_leave();
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
    void on_wheel(int delta, int px, int py);
    void update_sidebar_lift(Node* hit);
    void clear_sidebar_lift();
    void sidebar_project(float u, float v, float& x, float& y) const;
    bool sidebar_unproject(float x, float y, float& u, float& v) const;
    Node* hit_test(float x, float y);
    void handle_auth_result(LPARAM lp) { apply_auth_result(reinterpret_cast<AuthResult*>(lp)); }
    void handle_discord_links_msg(LPARAM lp) { auto* body = reinterpret_cast<std::string*>(lp); if (body) { apply_discord_links_body(*body); delete body; } }    void handle_java_removed() {
        java_state_ = JavaState{};
        if (page_ == L"settings") load_java_state_async(true);
    }
    void handle_java_state(LPARAM lp) { apply_java_state(reinterpret_cast<JavaState*>(lp)); }
    void handle_background_result(LPARAM lp) {
        apply_background_result(reinterpret_cast<BgResult*>(lp));
    }
    void handle_discord_result_msg(LPARAM lp) { auto* result = reinterpret_cast<DiscordAuthResult*>(lp); if (result) { apply_discord_result(result); delete result; } }
    void handle_unlink_msg(LPARAM lp) { auto* payload = reinterpret_cast<std::pair<bool, std::wstring>*>(lp); if (payload) { handle_unlink_result(payload->first, payload->second); delete payload; } }
    void handle_home_data_msg(LPARAM lp) { auto* data = reinterpret_cast<HomeData*>(lp); if (data) { apply_home_data(data); delete data; } }
    void handle_system_msg(LPARAM lp) { auto* info = reinterpret_cast<HomeSystem*>(lp); if (info) { apply_system_info(info); delete info; } }
    void handle_loader_games_msg(LPARAM lp) { auto* res = reinterpret_cast<LoaderGamesResult*>(lp); if (res) { apply_loader_games(res); delete res; } }
    void handle_loader_builds_msg(LPARAM lp) { auto* res = reinterpret_cast<LoaderBuildsResult*>(lp); if (res) { apply_loader_builds(res); delete res; } }
    void handle_launch_progress_msg(LPARAM lp) {
        auto* msg = reinterpret_cast<LaunchProgressMsg*>(lp);
        if (msg) { apply_launch_progress(msg); delete msg; }
    }
    void handle_launch_log_msg(LPARAM lp) {
        auto* msg = reinterpret_cast<LaunchLogMsg*>(lp);
        if (msg) { apply_launch_log(msg); delete msg; }
    }
    void handle_launch_state_msg(LPARAM lp) {
        auto* msg = reinterpret_cast<LaunchStateMsg*>(lp);
        if (msg) { apply_launch_state(msg); delete msg; }
    }
    void handle_launch_exit_msg(LPARAM lp) {
        auto* msg = reinterpret_cast<LaunchExitMsg*>(lp);
        if (msg) { apply_launch_exit(msg); delete msg; }
    }
    void handle_discord_waiting_msg(LPARAM lp) { auto* payload = reinterpret_cast<std::pair<std::wstring, int>*>(lp); if (payload) { if (payload->second == discord_seq_ && modal_open_ && modal_kind_ == 3 && (discord_phase_ == 1 || discord_phase_ == 2)) { discord_authorize_url_ = payload->first; discord_phase_ = 2; modal_busy_ = true; InvalidateRect(hwnd_, nullptr, FALSE); } delete payload; } }
    void on_dpi_changed();
    bool splash_active() const { return splash_.phase != Splash::Phase::None; }

private:
    void ui_apply_page();
    void do_action(const std::wstring& action);
    InstanceInfo* find_instance(const std::wstring& id);
    void launch_instance(const std::wstring& id, const std::wstring& quick_type = L"",
                         const std::wstring& quick_value = L"");
    void stop_instance(const std::wstring& id);
    void open_console(const std::wstring& id);
    void rebuild_console();
    void apply_launch_progress(LaunchProgressMsg* msg);
    void apply_launch_log(LaunchLogMsg* msg);
    void apply_launch_state(LaunchStateMsg* msg);
    void apply_launch_exit(LaunchExitMsg* msg);
    void persist_instance_fields(const std::wstring& id,
                                 const std::function<void(Json&)>& mutate);
    std::string load_account_token(const std::wstring& account_id) const;
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
    void load_home_async();
    void apply_home_data(HomeData* data);
    void load_system_async();
    void apply_system_info(HomeSystem* info);
    void rebuild_home();
    void layout_home();
    void load_settings_page_state();
    void rebuild_settings();
    void layout_settings();
    void rebuild_versions();
    void layout_versions();
    void draw_versions_popup();
    void load_loader_games_async(const std::wstring& kind);
    void load_loader_builds_async(const std::wstring& kind, const std::wstring& game);
    void apply_loader_games(LoaderGamesResult* result);
    void apply_loader_builds(LoaderBuildsResult* result);
    void versions_pick_loader(const std::wstring& id);
    void versions_pick_game(const std::wstring& id);
    void versions_open_build_menu();
    void versions_close_build_menu();
    void versions_create_instance();
    void versions_memory_from_x(float x);
    void versions_browse_dir();
    std::vector<VersionInfo> versions_filtered() const;
    std::wstring instance_base_dir() const;
    void load_java_state_async(bool refresh);
    void apply_java_state(JavaState* state);
    void apply_background_result(BgResult* result);
    void start_background_download(const std::wstring& id);
    void apply_background(const std::wstring& id);
    std::wstring background_file(const std::wstring& id) const;
    void save_user_setting(const std::string& key, Json value);
    void browse_java_exe();
    void remove_java_dir(const std::wstring& dir);
    void sync_shell_palette(bool animate);
    void settings_toggle_bool(bool& value, const char* key);
    void refresh_discord_links();
    void apply_discord_links_body(const std::string& body);
    const DiscordLink* discord_link_for(const Account& account) const;
    void open_discord_link_modal(const std::wstring& account_id, const std::wstring& name = L"");
    void start_discord_job(bool force);
    void cancel_discord_wait();
    void update_discord_rects(const ModalLayout& layout);
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
    std::wstring last_page_ = L"home";
    bool dirty_ = true;
    std::wstring base_;
    Splash splash_;
    Rng rng_{ 0xC0FFEE12345678ull };
    HICON tray_icon_ = nullptr;
    NOTIFYICONDATAW tray_{};
    bool tray_added_ = false;
    bool dark_ = true;
    bool theme_animating_ = false;
    bool theme_locked_ = false;
    AnimEngine anims_;
    bool pill_pending_ = true;
    bool laid_out_ = false;
    float pill_cur_ = 0.0f;
    std::unique_ptr<Node> menu_;
    bool menu_open_ = false;
    float menu_t_ = 0.0f;
    float caret_cur_ = 0.0f, caret_from_ = 0.0f, caret_to_ = 0.0f;
    std::vector<Account> accounts_;
    std::wstring active_id_;
    std::vector<InstanceInfo> instances_;
    std::unique_ptr<LaunchManager> launcher_;
    LaunchUiState launch_ui_;
    ULONGLONG launch_started_ = 0;
    bool console_dirty_ = false;
    std::vector<DiscordLink> discord_links_;
    std::wstring discord_api_url_;
    std::wstring discord_api_key_;
    std::wstring modal_discord_account_;
    std::unique_ptr<Node> home_;
    int home_tab_ = 0;
    float home_scroll_ = 0.0f;
    float home_content_h_ = 0.0f;
    D2D1_RECT_F home_slot_rect_ = D2D1::RectF();
    std::vector<VersionInfo> versions_;
    std::vector<LoaderInfo> loaders_;
    std::wstring latest_release_;
    std::wstring latest_snapshot_;
    int version_total_ = 0;
    bool home_data_loading_ = true;
    HomeSystem system_info_;
    bool system_loading_ = true;
    std::wstring shared_dir_;
    D2D1_RECT_F sidebar_rect_ = D2D1::RectF();
    bool sidebar3d_active_ = false;
    Node* sidebar_item_ = nullptr;
    D2D1_RECT_F sidebar_item_rect_ = D2D1::RectF();
    float sidebar_rise_ = 0.0f;
    bool sidebar_item_valid_ = false;
    std::unique_ptr<Node> settings_;
    D2D1_RECT_F settings_slot_rect_ = D2D1::RectF();
    float settings_scroll_ = 0.0f;
    float settings_content_h_ = 0.0f;
    std::unique_ptr<Node> versions_ui_;
    std::unique_ptr<Node> versions_aside_;
    std::unique_ptr<Node> versions_footer_;
    std::unique_ptr<Node> versions_menu_;
    D2D1_RECT_F versions_slot_rect_ = D2D1::RectF();
    D2D1_RECT_F versions_list_rect_ = D2D1::RectF();
    D2D1_RECT_F versions_aside_rect_ = D2D1::RectF();
    D2D1_RECT_F versions_footer_rect_ = D2D1::RectF();
    D2D1_RECT_F versions_menu_rect_ = D2D1::RectF();
    D2D1_RECT_F versions_mem_track_ = D2D1::RectF();
    D2D1_RECT_F versions_build_rect_ = D2D1::RectF();
    float versions_scroll_ = 0.0f;
    float versions_content_h_ = 0.0f;
    float versions_aside_scroll_ = 0.0f;
    float versions_aside_content_h_ = 0.0f;
    float versions_list_width_ = 0.0f;
    float versions_menu_scroll_ = 0.0f;
    std::vector<VersionInfo> versions_all_;
    bool versions_manifest_ready_ = false;
    bool versions_picker_ = true;
    std::wstring versions_loader_ = L"vanilla";
    std::wstring versions_build_;
    std::wstring versions_picked_;
    std::wstring versions_query_;
    std::wstring versions_name_;
    std::wstring versions_dir_;
    std::wstring versions_error_;
    int versions_memory_ = 4096;
    bool versions_demo_ = false;
    bool versions_snapshots_ = false;
    int versions_visible_ = 50;
    int versions_focus_ = 0;
    bool versions_mem_drag_ = false;
    bool versions_menu_open_ = false;
    std::wstring loader_games_kind_;
    bool loader_games_loading_ = false;
    bool loader_games_ready_ = false;
    bool loader_games_all_ = false;
    std::set<std::wstring> loader_games_;
    std::wstring builds_key_;
    bool builds_loading_ = false;
    bool builds_ready_ = false;
    bool builds_failed_ = false;
    std::vector<LoaderBuild> builds_;
    bool effects_enabled_ = true;
    bool hide_on_launch_ = true;
    bool rich_presence_ = true;
    bool auto_update_ = true;
    bool settings_lang_en_ = false;
    std::wstring java_path_;
    std::wstring background_id_;
    std::vector<BgItem> bg_items_;
    std::wstring bg_busy_;
    std::wstring settings_error_;
    bool bg_flipping_ = false;
    float bg_flip_t_ = 0.0f;
    std::wstring bg_flip_from_;
    std::wstring bg_flip_to_;
    JavaState java_state_;
    bool java_loading_ = false;
    std::wstring zulu_major_ = L"21";
    std::wstring zulu_kind_ = L"jre";
    std::wstring java_confirm_;
    std::wstring zulu_confirm_;
    ZuluJava java_override_zulu_;
    std::wstring discord_invite_ = L"https://discord.gg/8UQZTkRSGp";
    int discord_phase_ = 0;
    int discord_seq_ = 0;
    bool discord_force_ = false;
    bool discord_conflict_ = false;
    std::wstring discord_holder_;
    std::wstring discord_authorize_url_;
    std::wstring discord_result_tag_;
    std::wstring discord_result_name_;
    std::wstring discord_result_avatar_;
    std::wstring discord_result_moved_;
    std::wstring discord_avatar_file_;
    bool discord_result_created_ = false;
    bool discord_result_replaced_ = false;
    D2D1_RECT_F discord_reopen_ = D2D1::RectF();
    D2D1_RECT_F discord_cancel_wait_ = D2D1::RectF();
    D2D1_RECT_F discord_reopen_app_ = D2D1::RectF();
    D2D1_RECT_F discord_override_ = D2D1::RectF();
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
    bool mouse_tracking_ = false;
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
        { L"console", L"Console", nullptr },
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
            wchar_t sub_text[160];
            swprintf(sub_text, 160, L"%d bản phát hành · %d phiên bản đã tạo · mới nhất %ls",
                     version_total_, int(instances_.size()),
                     latest_release_.empty() ? L"—" : latest_release_.c_str());
            sub->text = sub_text;
        }
        else if (page_ == L"modpacks")
            sub->text = L"Quản lý modpack và nội dung tải về";
        else if (page_ == L"versions")
            sub->text = L"Chọn loader trước, sau đó chọn phiên bản Minecraft";
        else if (page_ == L"settings")
            sub->text = L"Cấu hình launcher và thông tin máy";
        else if (page_ == L"console") {
            InstanceInfo* inst = find_instance(launch_ui_.id);
            sub->text = inst ? inst->dir : L"Console phiên bản";
        }
        else
            sub->text = L"Cấu hình launcher và trò chơi";
    }
    if (page_ == L"versions" && !versions_ui_) rebuild_versions();
    if (page_ == L"console" && console_dirty_) rebuild_console();
    bool skin_wide = page_ == L"accounts" && accounts_skin_;
    ui_set_visible(ui_find(ui_.get(), L"content-header"), !skin_wide);
    ui_set_visible(ui_find(ui_.get(), L"home-view"), page_ == L"home");
    ui_set_visible(ui_find(ui_.get(), L"accounts-view"), page_ == L"accounts");
    ui_set_visible(ui_find(ui_.get(), L"settings-view"), page_ == L"settings");
    ui_set_visible(ui_find(ui_.get(), L"versions-view"), page_ == L"versions");
    ui_set_visible(ui_find(ui_.get(), L"console-view"), page_ == L"console");
    ui_set_visible(ui_find(ui_.get(), L"placeholder"),
                   page_ != L"home" && page_ != L"accounts" && page_ != L"settings" &&
                       page_ != L"versions" && page_ != L"console");
    ui_set_visible(ui_find(ui_.get(), L"home-tabs"), page_ == L"home");
    ui_set_visible(ui_find(ui_.get(), L"accounts-tabs"), page_ == L"accounts" && !skin_wide);
    ui_set_visible(ui_find(ui_.get(), L"header-tools-home"), page_ == L"home");
    ui_set_visible(ui_find(ui_.get(), L"header-tools-accounts"), page_ == L"accounts");
    ui_set_visible(ui_find(ui_.get(), L"header-tools-settings"), page_ == L"settings");
    ui_set_visible(ui_find(ui_.get(), L"header-tools-versions"), page_ == L"versions");
    if (Node* snap = ui_find(ui_.get(), L"btn-versions-snapshots")) {
        snap->style.bg = versions_snapshots_ ? Color::rgb(0xE9B872, 0.14f)
                                             : ui_token(L"input");
        snap->style.border_color = versions_snapshots_ ? Color::rgb(0xE9B872, 0.42f)
                                                       : ui_token(L"border");
    }
    if (Node* label = ui_find(ui_.get(), L"label-versions-snapshots"))
        label->style.color = versions_snapshots_ ? ui_token(L"accent") : ui_token(L"label");
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
    const wchar_t* home_tabs[4] = { L"tab-overview", L"tab-recent", L"tab-instances", L"tab-system" };
    for (int i = 0; i < 4; ++i) {
        if (Node* tab = ui_find(ui_.get(), home_tabs[i])) {
            bool on = home_tab_ == i;
            tab->style.bg = on ? ui_token(L"input") : Color{};
            tab->style.border = on;
            if (on) tab->style.border_color = ui_token(L"border");
            if (!tab->kids.empty() && tab->kids[0]->kind == Kind::Text)
                tab->kids[0]->style.color = ui_token(on ? L"text" : L"faint");
        }
    }
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
    if (Node* acct_card = ui_find(ui_.get(), L"accounts-card"))
        acct_card->style.glass = true;
    if (Node* titlebar = ui_find(ui_.get(), L"titlebar"))
        titlebar->style.glass = true;
    if (Node* sidebar = ui_find(ui_.get(), L"sidebar"))
        sidebar->style.glass = true;
    if (Node* header = ui_find(ui_.get(), L"content-header"))
        header->style.glass = true;
    if (page_ == L"settings" && last_page_ != L"settings") settings_scroll_ = 0.0f;
    last_page_ = page_;
    if (page_ == L"settings") {
        rebuild_settings();
        if (java_state_.managed.empty() && !java_loading_) load_java_state_async(false);
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

    effects_enabled_ = root.boolean("effects", true);
    hide_on_launch_ = root.boolean("hideOnLaunch", true);
    rich_presence_ = root.boolean("discordRpc", true);
    auto_update_ = root.boolean("autoUpdate", true);
    settings_lang_en_ = root.text("language", "vi") == "en";
    java_path_ = utf8_to_wide(root.text("javaPath"));
    background_id_ = utf8_to_wide(root.text("background"));
    discord_invite_ = utf8_to_wide(root.text("discordInvite", "https://discord.gg/8UQZTkRSGp"));
    load_settings_page_state();
    if (!background_id_.empty() && background_id_ != L"theme") {
        std::wstring file = background_file(background_id_);
        if (Node* root_node = ui_find(ui_.get(), L"root"))
            root_node->style.bg_image = file;
        theme_locked_ = !file.empty();
        if (theme_locked_) sync_shell_palette(false);
    }

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
        info.loader_version = utf8_to_wide(item.text("loaderVersion"));
        info.version_id = utf8_to_wide(item.text("versionId"));
        info.forge_version = utf8_to_wide(item.text("forgeVersion"));
        info.status = utf8_to_wide(item.text("status", "ready"));
        if (info.status == L"running" || info.status == L"starting" || info.status == L"stopping")
            info.status = L"ready";
        info.last_played = utf8_to_wide(item.text("lastPlayed"));
        info.created = utf8_to_wide(item.text("created"));
        info.username = utf8_to_wide(item.text("username"));
        info.java_path = utf8_to_wide(item.text("javaPath"));
        info.jvm_args = utf8_to_wide(item.text("jvmArgs"));
        info.demo = item.boolean("demo", false);
        info.memory_mb = int(item.number("memoryMb", 4096));
        info.playtime_ms = item.number("playtimeMs", 0);
        std::wstring dir = utf8_to_wide(item.text("dir"));
        info.dir = dir;
        std::wstring local_icon = dir + L"\\icon.png";
        if (!dir.empty() && GetFileAttributesW(local_icon.c_str()) != INVALID_FILE_ATTRIBUTES)
            info.icon = local_icon;
        if (const Json* worlds = item.find("recentWorlds")) {
            for (const auto& w : worlds->arr) {
                RecentWorldInfo world;
                world.folder = utf8_to_wide(w.text("folder"));
                world.name = utf8_to_wide(w.text("name"));
                world.played_at = utf8_to_wide(w.text("playedAt"));
                if (!world.folder.empty()) info.worlds.push_back(std::move(world));
            }
        }
        if (const Json* servers = item.find("recentServers")) {
            for (const auto& srv : servers->arr) {
                RecentServerInfo server;
                server.host = utf8_to_wide(srv.text("host"));
                server.port = int(srv.number("port", 25565));
                server.played_at = utf8_to_wide(srv.text("playedAt"));
                if (!server.host.empty()) info.servers.push_back(std::move(server));
            }
        }
        instances_.push_back(std::move(info));
    }
    rebuild_instance_rows();
    rebuild_account_rows();
    refresh_discord_links();

    std::string shared_setting = root.text("sharedDir");
    shared_dir_ = shared_setting.empty() ? user_data_dir() + L"\\shared"
                                        : utf8_to_wide(shared_setting);
    loaders_ = default_loaders();
    load_home_async();
    load_system_async();
    rebuild_home();
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
            link_icon->src = asset(L"assets/img/discord-logo.png");
            link_icon->style.width = link_icon->style.height = 12.0f;
            link_icon->style.radius = 3.0f;
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
    clear_sidebar_lift();
    Node* list = ui_find(ui_.get(), L"instance-list");
    if (!list) return;
    list->kids.clear();
    list->style.visible = !instances_.empty();
    for (const auto& inst : instances_) {
        auto row = std::make_unique<Node>();
        row->kind = Kind::Row;
        row->action = L"instance:open:" + inst.id;
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
    if (modal_kind_ == 3) {
        if (discord_phase_ == 2) ch = 300.0f;
        else if (discord_phase_ == 3) ch = 290.0f;
        else if (discord_phase_ == 4) ch = 286.0f;
        else ch = 286.0f;
    }
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
    float body_y = modal_kind_ == 3 ? y + 56.0f + 16.0f : desc_y + 36.0f + 10.0f;
    if (modal_kind_ == 0 || modal_kind_ == 3) {
        L.name_input = D2D1::RectF(x + 62.0f, body_y, x + cw - 16.0f, body_y + 38.0f);
    } else if (modal_kind_ == 2) {
        L.user_input = D2D1::RectF(x + 16.0f, body_y, x + cw - 16.0f, body_y + 38.0f);
        L.pass_input = D2D1::RectF(x + 16.0f, body_y + 46.0f, x + cw - 16.0f, body_y + 84.0f);
        L.eye = D2D1::RectF(L.pass_input.right - 30.0f, L.pass_input.top + 6.0f,
                            L.pass_input.right - 4.0f, L.pass_input.bottom - 6.0f);
    }
    float footer = L.card.bottom - 52.0f;
    float submit_w = modal_kind_ == 3 ? 140.0f : 96.0f;
    L.submit = D2D1::RectF(x + cw - 16.0f - submit_w, footer + 10.0f, x + cw - 16.0f,
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
    if (modal_busy_) {
        if (modal_kind_ == 3 && (discord_phase_ == 1 || discord_phase_ == 2)) {
            discord_cancel_link();
            ++discord_seq_;
            modal_busy_ = false;
        } else {
            return;
        }
    }
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
    renderer_.fill_rect(L.card, 16.0f, ui_color(L"surface"));
    renderer_.stroke_rect(L.card, 16.0f, ui_color(L"border"), 1.0f);

    auto icon = [&](const wchar_t* path, D2D1_RECT_F rect, Color color) {
        renderer_.draw_svg(asset(path), rect, color);
    };
    if (modal_kind_ == 3)
        renderer_.draw_image_path(asset(L"assets/img/discord-logo.png"),
                                  D2D1::RectF(L.card.left + 16, L.card.top + 14,
                                              L.card.left + 32, L.card.top + 30),
                                  4.0f);
    else
        icon(L"assets\\icons\\user.svg",
             D2D1::RectF(L.card.left + 16, L.card.top + 15, L.card.left + 31,
                         L.card.top + 30),
             ui_color(L"accent"));
    renderer_.draw_text(modal_kind_ == 3 ? L"Liên kết Discord" : L"Thêm tài khoản",
                        D2D1::RectF(L.card.left + 38, L.card.top + 10, L.card.right - 48,
                                    L.card.top + 34),
                        12.0f, 700, false, TextAlign::Left, ui_color(L"text"));
    icon(L"assets\\icons\\x.svg",
         D2D1::RectF(L.close.left + 5, L.close.top + 5, L.close.right - 5, L.close.bottom - 5),
         ui_color(L"label"));

    if (modal_kind_ != 3) {
    const wchar_t* kind_labels[4] = { L"Ngoại tuyến", L"Microsoft", L"ely.by", L"Discord" };
    const wchar_t* kind_icons[4] = { L"assets/img/offline-head.png",
                                     L"assets/img/ms-logo.png",
                                     L"assets/img/ely-logo.png",
                                     L"assets/img/discord-logo.png" };
    for (int i = 0; i < 4; ++i) {
        bool on = modal_kind_ == i;
        D2D1_RECT_F box = L.kinds[i];
        if (on) renderer_.fill_rect(box, 12.0f, ui_color(L"input"));
        Color tint = (i == 3) ? Color::rgb(0x5865F2) : ui_color(L"accent");
        renderer_.stroke_rect(box, 12.0f, on ? tint : ui_color(L"border"), 1.0f, 1.0f);
        renderer_.draw_image_path(asset(kind_icons[i]),
                                  D2D1::RectF(box.left + 10, box.top + 8, box.left + 30,
                                              box.top + 28),
                                  4.0f, on ? 1.0f : 0.55f);
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

    }

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
        update_discord_rects(L);
        if (discord_phase_ == 3) {
            D2D1_RECT_F box = D2D1::RectF(L.card.left + 16, L.name_input.top,
                                          L.card.right - 16, L.name_input.top + 146.0f);
            renderer_.fill_rect(box, 12.0f, ui_color(L"input"));
            renderer_.stroke_rect(box, 12.0f, ui_color(L"accent"), 1.0f);
            D2D1_RECT_F avatar = D2D1::RectF(box.left + 16, box.top + 16, box.left + 52,
                                             box.top + 52);
            if (!discord_avatar_file_.empty())
                renderer_.draw_image_path(discord_avatar_file_, avatar, 18.0f);
            else
                renderer_.draw_image_path(asset(L"assets/img/discord-logo.png"), avatar, 4.0f);
            renderer_.draw_text(discord_result_tag_.empty() ? L"Discord" : discord_result_tag_,
                                D2D1::RectF(box.left + 62, box.top + 12, box.right - 12,
                                            box.top + 36),
                                12.5f, 700, false, TextAlign::Left, ui_color(L"text"));
            renderer_.draw_text(L"→ " + discord_result_name_,
                                D2D1::RectF(box.left + 62, box.top + 36, box.right - 12,
                                            box.top + 56),
                                10.5f, 400, false, TextAlign::Left, ui_color(L"label"));
            float text_y = box.top + 66;
            if (discord_result_created_) {
                renderer_.draw_text(L"Đã tạo tài khoản " + discord_result_name_ +
                                        L" và liên kết Discord.",
                                    D2D1::RectF(box.left + 16, text_y, box.right - 16,
                                                text_y + 24),
                                    10.0f, 400, false, TextAlign::Left, ui_color(L"accent"),
                                    1.0f, true);
                text_y += 24;
            }
            if (!discord_result_moved_.empty()) {
                renderer_.draw_text(L"Discord này trước đó liên kết với tài khoản " +
                                        discord_result_moved_ + L" — liên kết đó đã bị bỏ.",
                                    D2D1::RectF(box.left + 16, text_y, box.right - 16,
                                                text_y + 34),
                                    10.0f, 400, false, TextAlign::Left, ui_color(L"faint"),
                                    1.0f, true);
                text_y += 34;
            }
            if (discord_result_replaced_ && discord_result_moved_.empty()) {
                renderer_.draw_text(L"Liên kết cũ của tài khoản này đã được thay bằng liên kết mới.",
                                    D2D1::RectF(box.left + 16, text_y, box.right - 16,
                                                text_y + 24),
                                    10.0f, 400, false, TextAlign::Left, ui_color(L"faint"),
                                    1.0f, true);
            }
            renderer_.draw_text(L"Uỷ quyền xong, bạn có thể đóng cửa sổ trình duyệt.",
                                D2D1::RectF(box.left + 16, box.bottom - 26, box.right - 16,
                                            box.bottom - 6),
                                10.0f, 400, false, TextAlign::Left, ui_color(L"faint"));
        } else if (discord_phase_ == 2) {
            D2D1_RECT_F box = D2D1::RectF(L.card.left + 16, L.name_input.top,
                                          L.card.right - 16, L.name_input.top + 190.0f);
            renderer_.fill_rect(box, 12.0f, ui_color(L"input"));
            renderer_.stroke_rect(box, 12.0f, ui_color(L"border"), 1.0f);
            draw_spinner(renderer_, box.left + 26, box.top + 24, 7.0f,
                         Color::rgb(0x5865F2), 1.0f);
            renderer_.draw_text(L"Đang chờ uỷ quyền trong trình duyệt…",
                                D2D1::RectF(box.left + 44, box.top + 12, box.right - 16,
                                            box.top + 38),
                                11.0f, 600, false, TextAlign::Left, ui_color(L"text"));
            renderer_.draw_text(L"Uỷ quyền xong, launcher tự nhận kết quả và hoàn tất liên kết. Có thể đóng cửa sổ trình duyệt sau đó.",
                                D2D1::RectF(box.left + 16, box.top + 48, box.right - 16,
                                            box.top + 96),
                                10.0f, 400, false, TextAlign::Left, ui_color(L"faint"), 1.0f,
                                true);
            renderer_.fill_rect(discord_reopen_, 8.0f, Color::rgb(0x5865F2));
            renderer_.draw_text(L"Mở lại trang uỷ quyền",
                                D2D1::RectF(discord_reopen_.left, discord_reopen_.top,
                                            discord_reopen_.right, discord_reopen_.bottom),
                                10.5f, 600, false, TextAlign::Center, Color::rgb(0xFFFFFF));
            renderer_.fill_rect(discord_cancel_wait_, 8.0f, ui_color(L"input"));
            renderer_.stroke_rect(discord_cancel_wait_, 8.0f, ui_color(L"border"), 1.0f);
            renderer_.draw_text(L"Huỷ chờ",
                                D2D1::RectF(discord_cancel_wait_.left,
                                            discord_cancel_wait_.top,
                                            discord_cancel_wait_.right,
                                            discord_cancel_wait_.bottom),
                                10.5f, 600, false, TextAlign::Center, ui_color(L"label"));
            renderer_.fill_rect(discord_reopen_app_, 8.0f, ui_color(L"input"));
            renderer_.stroke_rect(discord_reopen_app_, 8.0f, ui_color(L"border"), 1.0f);
            renderer_.draw_text(L"Mở lại launcher",
                                D2D1::RectF(discord_reopen_app_.left,
                                            discord_reopen_app_.top,
                                            discord_reopen_app_.right,
                                            discord_reopen_app_.bottom),
                                10.5f, 600, false, TextAlign::Center, ui_color(L"label"));
        } else {
            if (!modal_discord_account_.empty()) {
                D2D1_RECT_F chip = D2D1::RectF(L.card.left + 16, L.name_input.top,
                                               L.card.right - 16, L.name_input.top + 44.0f);
                renderer_.fill_rect(chip, 8.0f, ui_color(L"input"));
                renderer_.stroke_rect(chip, 8.0f, ui_color(L"border"), 1.0f);
                const Account* account = find_account(modal_discord_account_);
                std::wstring head = account ? account_head(account->name) : L"";
                if (head.size() <= 4 || head.substr(head.size() - 4) != L".png")
                    head = asset(L"assets/img/offline-head.png");
                renderer_.draw_image_path(head,
                                          D2D1::RectF(chip.left + 8, chip.top + 7,
                                                      chip.left + 38, chip.bottom - 7),
                                          7.0f);
                renderer_.draw_text(account ? account->name : L"Tài khoản",
                                    D2D1::RectF(chip.left + 46, chip.top, chip.right - 12,
                                                chip.bottom),
                                    12.0f, 600, false, TextAlign::Left, ui_color(L"text"));
            } else {
                std::wstring head = account_head(trim_text(modal_name_));
                if (head.size() <= 4 || head.substr(head.size() - 4) != L".png")
                    head = asset(L"assets/img/offline-head.png");
                renderer_.draw_image_path(head,
                                          D2D1::RectF(L.card.left + 16, L.name_input.top,
                                                      L.card.left + 54, L.name_input.bottom),
                                          9.0f);
                input_box(L.name_input, modal_name_, L"Tên người chơi, ví dụ: Steve…", false,
                          modal_focus_ == 0 && !modal_busy_);
            }
            D2D1_RECT_F note = D2D1::RectF(L.card.left + 16, L.name_input.top + 54.0f,
                                           L.card.right - 16, L.name_input.top + 110.0f);
            renderer_.fill_rect(note, 8.0f, ui_color(L"input"));
            renderer_.stroke_rect(note, 8.0f, ui_color(L"border"), 1.0f);
            renderer_.draw_image_path(asset(L"assets/img/discord-logo.png"),
                                      D2D1::RectF(note.left + 10, note.top + 9, note.left + 26,
                                                  note.top + 25),
                                      4.0f);
            renderer_.draw_text(L"Launcher mở trình duyệt để uỷ quyền Discord, sau đó tự nhận kết quả và hoàn tất liên kết.",
                                D2D1::RectF(note.left + 32, note.top + 8, note.right - 10,
                                            note.bottom - 8),
                                10.5f, 400, false, TextAlign::Left, ui_color(L"label"), 1.0f,
                                true);
            if (discord_phase_ == 1) {
                draw_spinner(renderer_, L.card.left + 24, note.bottom + 24, 6.0f,
                             Color::rgb(0x5865F2), 1.0f);
                renderer_.draw_text(L"Đang mở trang xác thực Discord…",
                                    D2D1::RectF(L.card.left + 38, note.bottom + 12,
                                                L.card.right - 16, note.bottom + 38),
                                    11.0f, 400, false, TextAlign::Left, ui_color(L"label"));
            }
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
        if (modal_kind_ == 3 && discord_phase_ == 4 && discord_conflict_) {
            renderer_.fill_rect(discord_override_, 8.0f, Color::rgb(0x5865F2));
            renderer_.draw_text(L"Ghi đè liên kết",
                                D2D1::RectF(discord_override_.left, discord_override_.top,
                                            discord_override_.right, discord_override_.bottom),
                                10.5f, 600, false, TextAlign::Center, Color::rgb(0xFFFFFF));
        }
    }
    if (modal_kind_ == 3 && discord_phase_ == 2) {
        return;
    }
    renderer_.fill_rect(D2D1::RectF(L.card.left, footer_top, L.card.right, footer_top + 1),
                        0.0f, ui_color(L"border"));
    bool discord_done = modal_kind_ == 3 && discord_phase_ == 3;
    const wchar_t* hint = modal_kind_ == 0 ? L"Tên chỉ gồm chữ, số, gạch dưới và dài 3–16 ký tự."
                         : modal_kind_ == 1 ? L"Cần tài khoản đã mua Minecraft Java Edition."
                         : modal_kind_ == 2 ? L"Thông tin đăng nhập chỉ dùng để lấy token từ ely.by."
                                            : L"Gắn tài khoản launcher với Discord để nhận thông báo";
    if (!discord_done)
        renderer_.draw_text(hint,
                            D2D1::RectF(L.card.left + 16, footer_top + 10, L.submit.left - 8,
                                        footer_top + 42),
                            10.0f, 400, false, TextAlign::Left, ui_color(L"faint"));
    if (!discord_done)
        renderer_.draw_text(L"Hủy",
                            D2D1::RectF(L.cancel.left, L.cancel.top, L.cancel.right,
                                        L.cancel.bottom),
                            11.0f, 600, false, TextAlign::Center, ui_color(L"label"));
    bool enabled = modal_valid();
    const wchar_t* submit_text = modal_kind_ == 0 ? L"Tạo" : L"Đăng nhập";
    if (modal_kind_ == 3) {
        if (discord_phase_ == 3) { submit_text = L"Xong"; enabled = true; }
        else if (discord_phase_ == 4) { submit_text = L"Thử lại"; enabled = modal_valid(); }
        else if (discord_phase_ == 1) { submit_text = L"Đang mở…"; enabled = false; }
        else { submit_text = L"Mở web xác thực"; enabled = modal_valid(); }
    } else {
        enabled = enabled && !modal_busy_;
    }
    Color submit_bg = modal_kind_ == 3 ? Color::rgb(0x5865F2) : ui_color(L"accent");
    Color submit_ink = modal_kind_ == 3 ? Color::rgb(0xFFFFFF) : ui_color(L"ink");
    renderer_.fill_rect(L.submit, 8.0f, submit_bg, enabled ? 1.0f : 0.4f);
    if (modal_busy_ || (modal_kind_ == 3 && discord_phase_ == 1)) {
        draw_spinner(renderer_, L.submit.left + 22, (L.submit.top + L.submit.bottom) * 0.5f, 5.0f,
                     submit_ink, 1.0f);
    } else {
        icon(modal_kind_ == 3 ? L"assets\\icons\\discord.svg" : L"assets\\icons\\check-circle.svg",
             D2D1::RectF(L.submit.left + 12, L.submit.top + 10, L.submit.left + 24,
                         L.submit.bottom - 10),
             submit_ink);
    }
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
    if (modal_kind_ == 3) {
        update_discord_rects(L);
        if (discord_phase_ == 2) {
            if (inside(discord_reopen_)) {
                if (!discord_authorize_url_.empty())
                    ShellExecuteW(nullptr, L"open", discord_authorize_url_.c_str(), nullptr,
                                  nullptr, SW_SHOWNORMAL);
                return true;
            }
            if (inside(discord_cancel_wait_)) {
                cancel_discord_wait();
                return true;
            }
            if (inside(discord_reopen_app_)) {
                ShowWindow(hwnd_, SW_RESTORE);
                SetForegroundWindow(hwnd_);
                return true;
            }
            return true;
        }
        if (discord_phase_ == 4 && discord_conflict_ && inside(discord_override_)) {
            start_discord_job(true);
            return true;
        }
        if (discord_phase_ == 3) {
            if (inside(L.submit)) close_account_modal();
            return true;
        }
    }
    if (modal_busy_) return true;
    if (modal_kind_ != 3) {
    for (int i = 0; i < 4; ++i) {
        if (inside(L.kinds[i])) {
            modal_kind_ = i;
            modal_focus_ = (i == 2 || i == 0 || (i == 3 && modal_discord_account_.empty())) ? 0 : -1;
            modal_error_.clear();
            InvalidateRect(hwnd_, nullptr, FALSE);
            return true;
        }
    }
    }
    if ((modal_kind_ == 0 || (modal_kind_ == 3 && (discord_phase_ == 0 || discord_phase_ == 4))) &&
        inside(L.name_input)) {
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
    if (modal_kind_ == 3) {
        if (discord_phase_ == 1 || discord_phase_ == 2) {
            if (key == VK_ESCAPE) cancel_discord_wait();
            return true;
        }
        if (discord_phase_ == 3) {
            if (key == VK_ESCAPE || key == VK_RETURN) close_account_modal();
            return true;
        }
        if (discord_phase_ == 4) {
            if (key == VK_ESCAPE) close_account_modal();
            if (key == VK_RETURN && modal_valid()) start_discord_job(false);
            return true;
        }
    }
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
    if (modal_kind_ == 3 && discord_phase_ != 0 && discord_phase_ != 4) return true;
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
        if (discord_phase_ == 3) {
            close_account_modal();
            return;
        }
        if (discord_phase_ == 1 || discord_phase_ == 2) return;
        start_discord_job(false);
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

void App::open_discord_link_modal(const std::wstring& account_id, const std::wstring& name) {
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
    modal_name_ = account ? account->name : name;
    modal_focus_ = (account || !name.empty()) ? -1 : 0;
    discord_phase_ = 0;
    discord_force_ = false;
    discord_conflict_ = false;
    discord_holder_.clear();
    discord_authorize_url_.clear();
    discord_result_tag_.clear();
    discord_result_name_.clear();
    discord_result_avatar_.clear();
    discord_result_moved_.clear();
    discord_avatar_file_.clear();
    discord_result_created_ = false;
    discord_result_replaced_ = false;
    SetTimer(hwnd_, 4, 500, nullptr);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

static void notify_discord_waiting(void* ctx, const std::wstring& url) {
    auto* info = reinterpret_cast<std::pair<HWND, int>*>(ctx);
    auto* payload = new std::pair<std::wstring, int>(url, info->second);
    PostMessage(info->first, WM_APP + 9, 0, reinterpret_cast<LPARAM>(payload));
}

void App::start_discord_job(bool force) {
    if (modal_busy_) return;
    modal_busy_ = true;
    discord_phase_ = 1;
    discord_force_ = force;
    modal_error_.clear();
    int seq = ++discord_seq_;
    DiscordJob* job = new DiscordJob{};
    job->hwnd = hwnd_;
    job->api_url = discord_api_url_;
    job->api_key = discord_api_key_;
    job->name = trim_text(modal_name_);
    job->account_id = modal_discord_account_;
    job->force = force;
    job->seq = seq;
    const Account* account = find_account(modal_discord_account_);
    if (account) {
        job->name = account->name;
        job->account_uuid = account->uuid;
    }
    SetTimer(hwnd_, 2, 16, nullptr);
    InvalidateRect(hwnd_, nullptr, FALSE);
    HANDLE thread = CreateThread(nullptr, 0, +[](LPVOID param) -> DWORD {
        DiscordJob* job = reinterpret_cast<DiscordJob*>(param);
        auto* wait_ctx = new std::pair<HWND, int>(job->hwnd, job->seq);
        DiscordResult flow = discord_link_flow(job->api_url, job->api_key, job->name,
                                               job->account_id, job->account_uuid, job->force,
                                               notify_discord_waiting, wait_ctx);
        delete wait_ctx;
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
        result->conflict = flow.conflict;
        result->holder = flow.holder;
        result->moved_from = flow.moved_from;
        result->replaced = flow.replaced;
        result->seq = job->seq;
        PostMessage(job->hwnd, WM_APP + 8, 0, reinterpret_cast<LPARAM>(result));
        delete job;
        return 0;
    }, job, 0, nullptr);
    if (thread) CloseHandle(thread);
}

void App::cancel_discord_wait() {
    if (discord_phase_ != 1 && discord_phase_ != 2) return;
    discord_cancel_link();
    ++discord_seq_;
    modal_busy_ = false;
    discord_phase_ = 0;
    modal_error_.clear();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::update_discord_rects(const ModalLayout& layout) {
    float footer = layout.card.bottom - 52.0f;
    float top = layout.name_input.top;
    discord_reopen_ = D2D1::RectF(layout.card.left + 16.0f, top + 150.0f,
                                  layout.card.left + 16.0f + 170.0f, top + 182.0f);
    discord_cancel_wait_ = D2D1::RectF(layout.card.right - 16.0f - 92.0f, top + 150.0f,
                                       layout.card.right - 16.0f, top + 182.0f);
    discord_reopen_app_ = D2D1::RectF(discord_reopen_.right + 8.0f, top + 150.0f,
                                      discord_reopen_.right + 8.0f + 140.0f, top + 182.0f);
    discord_override_ = D2D1::RectF(layout.card.left + 16.0f, footer - 86.0f,
                                    layout.card.left + 16.0f + 160.0f, footer - 54.0f);
}

void App::apply_discord_result(DiscordAuthResult* result) {
    if (!result) return;
    if (result->seq != discord_seq_) return;
    modal_busy_ = false;
    if (!result->ok) {
        discord_phase_ = 4;
        discord_conflict_ = result->conflict;
        discord_holder_ = result->holder;
        if (result->conflict && !result->holder.empty())
            modal_error_ = L"Tài khoản này đang liên kết với Discord " + result->holder +
                           L". Ghi đè bằng liên kết mới?";
        else
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
    bool created_now = false;
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
        created_now = true;
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
    discord_phase_ = 3;
    discord_result_tag_ = result->discord_tag.empty() ? result->discord_name : result->discord_tag;
    discord_result_name_ = account->name;
    discord_result_avatar_ = result->discord_avatar;
    discord_result_moved_ = result->moved_from;
    discord_result_created_ = created_now;
    discord_result_replaced_ = result->replaced;
    discord_avatar_file_.clear();
    if (!result->discord_avatar.empty()) {
        HttpResult avatar = http_request(result->discord_avatar, L"GET");
        if (avatar.ok() && avatar.status == 200 && avatar.body.size() > 64 &&
            (unsigned char)avatar.body[0] == 0x89) {
            std::wstring path = engine_data_dir() + L"\\discord-avatar.png";
            write_file_bytes(path, std::vector<unsigned char>(avatar.body.begin(), avatar.body.end()));
            discord_avatar_file_ = path;
        }
    }
    std::wstring tag = discord_result_tag_.empty() ? result->discord_name : discord_result_tag_;
    notify(L"Liên kết Discord", account->name + L" · " + tag, L"ok");
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
static unsigned long long directory_size(const std::wstring& dir) {
    unsigned long long total = 0;
    WIN32_FIND_DATAW data{};
    HANDLE find = FindFirstFileW((dir + L"\\*").c_str(), &data);
    if (find == INVALID_HANDLE_VALUE) return 0;
    do {
        if (wcscmp(data.cFileName, L".") == 0 || wcscmp(data.cFileName, L"..") == 0) continue;
        std::wstring path = dir + L"\\" + data.cFileName;
        if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            if (!(data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT))
                total += directory_size(path);
        } else {
            unsigned long long size = (static_cast<unsigned long long>(data.nFileSizeHigh) << 32) | data.nFileSizeLow;
            total += size;
        }
    } while (FindNextFileW(find, &data));
    FindClose(find);
    return total;
}

static std::wstring format_bytes(unsigned long long bytes) {
    if (bytes >= 1073741824ULL) {
        wchar_t out[32];
        swprintf(out, 32, L"%.1f GB", double(bytes) / 1073741824.0);
        return out;
    }
    if (bytes >= 1048576ULL) {
        wchar_t out[32];
        swprintf(out, 32, L"%llu MB", bytes / 1048576ULL);
        return out;
    }
    if (bytes >= 1024ULL) return std::to_wstring(bytes / 1024ULL) + L" KB";
    return std::to_wstring(bytes) + L" B";
}

static std::wstring format_playtime(double ms) {
    long long total = (long long)(ms / 60000.0);
    if (total < 60) return std::to_wstring(total) + L"m";
    wchar_t out[32];
    swprintf(out, 32, L"%lldh %lldm", total / 60, total % 60);
    return out;
}

static bool parse_iso(const std::wstring& value, SYSTEMTIME& out) {
    int year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0;
    if (swscanf(value.c_str(), L"%d-%d-%dT%d:%d:%d", &year, &month, &day, &hour, &minute,
                &second) != 6)
        return false;
    out = SYSTEMTIME{};
    out.wYear = WORD(year);
    out.wMonth = WORD(month);
    out.wDay = WORD(day);
    out.wHour = WORD(hour);
    out.wMinute = WORD(minute);
    out.wSecond = WORD(second);
    return true;
}

static std::wstring iso_date(const std::wstring& value) {
    SYSTEMTIME st{};
    if (!parse_iso(value, st)) return L"—";
    wchar_t out[32];
    swprintf(out, 32, L"%02d/%02d/%04d", st.wDay, st.wMonth, st.wYear);
    return out;
}

static std::wstring iso_ago(const std::wstring& value) {
    SYSTEMTIME st{};
    if (!parse_iso(value, st)) return L"—";
    FILETIME then{}, now{};
    SystemTimeToFileTime(&st, &then);
    GetSystemTimeAsFileTime(&now);
    ULARGE_INTEGER a{}, b{};
    a.LowPart = then.dwLowDateTime; a.HighPart = then.dwHighDateTime;
    b.LowPart = now.dwLowDateTime; b.HighPart = now.dwHighDateTime;
    if (b.QuadPart <= a.QuadPart) return L"hôm nay";
    unsigned long long days = (b.QuadPart - a.QuadPart) / (10000000ULL * 86400ULL);
    if (days == 0) return L"hôm nay";
    if (days == 1) return L"hôm qua";
    if (days < 30) return std::to_wstring(days) + L" ngày trước";
    unsigned long long months = days / 30;
    if (months < 12) return std::to_wstring(months) + L" tháng trước";
    return std::to_wstring(months / 12) + L" năm trước";
}

static Color status_color(const std::wstring& status) {
    if (status == L"running") return Color::rgb(0x22C55E);
    if (status == L"installing" || status == L"stopping" || status == L"starting")
        return Color::rgb(0xEAB308);
    if (status == L"error") return Color::rgb(0xEF4444);
    return Color::rgb(0x6B7280);
}

static std::wstring upper_text(std::wstring value) {
    for (auto& ch : value) ch = wchar_t(towupper(ch));
    return value;
}

static std::wstring status_label(const std::wstring& status) {
    if (status == L"running") return L"Đang chạy";
    if (status == L"starting") return L"Đang khởi động";
    if (status == L"stopping") return L"Đang dừng";
    if (status == L"installing") return L"Đang cài đặt";
    if (status == L"error") return L"Lỗi";
    return L"Sẵn sàng";
}

static std::wstring loader_icon_path(const std::wstring& id) {
    return L"assets/img/loader-icon/" + id + L".png";
}

static std::wstring documents_dir() {
    wchar_t path[MAX_PATH]{};
    if (SHGetFolderPathW(nullptr, CSIDL_PERSONAL | CSIDL_FLAG_CREATE, nullptr, 0, path) == S_OK)
        return path;
    return user_data_dir();
}

static bool ensure_dir_tree(const std::wstring& path) {
    if (path.empty()) return false;
    std::wstring current;
    size_t start = 0;
    if (path.size() > 2 && path[1] == L':') {
        current = path.substr(0, 2);
        start = 2;
    }
    while (start <= path.size()) {
        size_t next = path.find(L'\\', start);
        if (next == std::wstring::npos) next = path.size();
        std::wstring part = path.substr(start, next - start);
        if (!part.empty()) {
            if (!current.empty() && current.back() != L'\\') current += L'\\';
            current += part;
            CreateDirectoryW(current.c_str(), nullptr);
        }
        if (next == path.size()) break;
        start = next + 1;
    }
    return GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES;
}

static std::wstring instance_slug(const std::wstring& value) {
    std::wstring out;
    for (wchar_t ch : value) {
        if ((ch >= L'a' && ch <= L'z') || (ch >= L'A' && ch <= L'Z') ||
            (ch >= L'0' && ch <= L'9') || ch == L'.' || ch == L'-' || ch == L'_')
            out.push_back(ch);
        else if (!out.empty() && out.back() != L'-')
            out.push_back(L'-');
    }
    while (!out.empty() && out.back() == L'-') out.pop_back();
    return out.empty() ? L"instance" : out;
}

static int compare_version_text(const std::wstring& a, const std::wstring& b) {
    size_t i = 0, j = 0;
    while (i < a.size() || j < b.size()) {
        if (i < a.size() && j < b.size() && iswdigit(a[i]) && iswdigit(b[j])) {
            size_t ie = i, je = j;
            while (ie < a.size() && iswdigit(a[ie])) ++ie;
            while (je < b.size() && iswdigit(b[je])) ++je;
            std::wstring na = a.substr(i, ie - i), nb = b.substr(j, je - j);
            while (na.size() > 1 && na[0] == L'0') na.erase(0, 1);
            while (nb.size() > 1 && nb[0] == L'0') nb.erase(0, 1);
            if (na.size() != nb.size()) return na.size() < nb.size() ? -1 : 1;
            if (na != nb) return na < nb ? -1 : 1;
            i = ie;
            j = je;
        } else {
            wchar_t ca = i < a.size() ? a[i] : 0;
            wchar_t cb = j < b.size() ? b[j] : 0;
            if (ca != cb) return ca < cb ? -1 : 1;
            ++i;
            ++j;
        }
    }
    return 0;
}

static std::vector<std::wstring> xml_version_list(const std::string& text) {
    std::vector<std::wstring> out;
    size_t pos = 0;
    const std::string open = "<version>", close = "</version>";
    while (true) {
        size_t begin = text.find(open, pos);
        if (begin == std::string::npos) break;
        begin += open.size();
        size_t end = text.find(close, begin);
        if (end == std::string::npos) break;
        out.push_back(utf8_to_wide(text.substr(begin, end - begin)));
        pos = end + close.size();
    }
    return out;
}

static bool forge_at_least(const std::wstring& version, const std::wstring& min) {
    int a[4]{}, b[4]{};
    swscanf(version.c_str(), L"%d.%d.%d", &a[0], &a[1], &a[2]);
    swscanf(min.c_str(), L"%d.%d.%d", &b[0], &b[1], &b[2]);
    for (int i = 0; i < 3; ++i) {
        if (a[i] != b[i]) return a[i] > b[i];
    }
    return true;
}

static std::wstring forge_display(const std::wstring& game, const std::wstring& id) {
    std::wstring value = id;
    std::wstring prefix = game + L"-";
    std::wstring suffix = L"-" + game;
    if (value.rfind(prefix, 0) == 0) value = value.substr(prefix.size());
    if (value.size() > suffix.size() &&
        value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0)
        value = value.substr(0, value.size() - suffix.size());
    return value;
}

static std::wstring neo_game_of(const std::wstring& version) {
    std::wstring head = version.substr(0, version.find_first_of(L"-+"));
    std::vector<int> parts;
    size_t start = 0;
    while (start <= head.size()) {
        size_t dot = head.find(L'.', start);
        if (dot == std::wstring::npos) dot = head.size();
        std::wstring piece = head.substr(start, dot - start);
        if (piece.empty()) return L"";
        for (wchar_t ch : piece)
            if (!iswdigit(ch)) return L"";
        parts.push_back(_wtoi(piece.c_str()));
        if (dot == head.size()) break;
        start = dot + 1;
    }
    if (parts.size() < 3) return L"";
    wchar_t out[32];
    if (parts[0] >= 26) {
        if (parts[2] == 0) swprintf(out, 32, L"%d.%d", parts[0], parts[1]);
        else swprintf(out, 32, L"%d.%d.%d", parts[0], parts[1], parts[2]);
    } else {
        if (parts[1] == 0) swprintf(out, 32, L"1.%d", parts[0]);
        else swprintf(out, 32, L"1.%d.%d", parts[0], parts[1]);
    }
    return out;
}

static std::wstring neo_build_of(const std::wstring& version) {
    std::wstring head = version.substr(0, version.find_first_of(L"-+"));
    size_t dot = head.find_last_of(L'.');
    return dot == std::wstring::npos ? head : head.substr(dot + 1);
}

static std::vector<LoaderInfo> default_loaders() {
    return {
        { L"vanilla", L"Vanilla", L"Bản gốc Mojang, không mod", L"", false, false, true, false, 0 },
        { L"fabric", L"Fabric", L"Loader nhẹ, cập nhật nhanh", L"", false, false, false, false, 0 },
        { L"quilt", L"Quilt", L"Kế thừa Fabric, hiện đại hơn", L"", false, false, false, false, 0 },
        { L"forge", L"Forge", L"Loader lâu đời, nhiều mod nhất", L"", false, false, false, false, 0 },
        { L"neoforge", L"NeoForge", L"Bản tách từ Forge, hiện đại hơn", L"", false, false, false, false, 0 },
        { L"lunar", L"LunarLoader", L"Loader riêng của XyoLauncher, tối ưu cho mod hiện đại", L"", false, false, false, false, 0 },
    };
}

static std::wstring loader_name(const std::wstring& id) {
    for (const auto& loader : default_loaders())
        if (loader.id == id) return loader.name;
    return id;
}

void App::load_home_async() {
    HWND target = hwnd_;
    HANDLE thread = CreateThread(nullptr, 0, +[](LPVOID param) -> DWORD {
        HWND hwnd = reinterpret_cast<HWND>(param);
        HomeData* data = new HomeData();
        data->loaders = default_loaders();
        HttpResult manifest = http_request(
            L"https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", L"GET");
        Json root;
        if (root.parse(manifest.body)) {
            const Json* latest = root.find("latest");
            if (latest) {
                data->latest = utf8_to_wide(latest->text("release"));
                data->latest_snapshot = utf8_to_wide(latest->text("snapshot"));
            }
            const Json* list = root.find("versions");
            if (list) {
                for (const auto& item : list->arr) {
                    VersionInfo version;
                    version.id = utf8_to_wide(item.text("id"));
                    version.release_time = utf8_to_wide(item.text("releaseTime"));
                    version.type = utf8_to_wide(item.text("type"));
                    if (version.type.empty()) version.type = L"release";
                    bool release = version.type == L"release";
                    if (release) {
                        ++data->total;
                        if (data->releases.size() < 9) data->releases.push_back(version);
                    }
                    if (!version.id.empty()) data->all.push_back(std::move(version));
                }
                data->ok = true;
            }
        }
        if (!data->latest.empty()) {
            HttpResult fabric = http_request(
                L"https://meta.fabricmc.net/v2/versions/loader/" + data->latest, L"GET");
            Json fabric_json;
            if (fabric_json.parse(fabric.body) && !fabric_json.arr.empty()) {
                const Json* loader = fabric_json.arr[0].find("loader");
                if (loader) {
                    data->loaders[1].loaded = true;
                    data->loaders[1].build = utf8_to_wide(loader->text("version"));
                    data->loaders[1].supported = !data->loaders[1].build.empty();
                    data->loaders[1].stable = true;
                }
            }
            HttpResult quilt = http_request(
                L"https://meta.quiltmc.org/v3/versions/loader/" + data->latest, L"GET");
            Json quilt_json;
            if (quilt_json.parse(quilt.body) && !quilt_json.arr.empty()) {
                const Json* loader = quilt_json.arr[0].find("loader");
                if (loader) {
                    data->loaders[2].loaded = true;
                    data->loaders[2].build = utf8_to_wide(loader->text("version"));
                    data->loaders[2].supported = !data->loaders[2].build.empty();
                    data->loaders[2].stable = true;
                }
            }
            HttpResult promos = http_request(
                L"https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
                L"GET");
            Json promos_json;
            if (promos_json.parse(promos.body)) {
                const Json* map = promos_json.find("promos");
                if (map) {
                    std::string key = wide_to_utf8(data->latest);
                    std::string build = map->text((key + "-recommended").c_str());
                    bool stable = !build.empty();
                    if (build.empty()) build = map->text((key + "-latest").c_str());
                    int game_count = 0;
                    for (const auto& entry : map->obj)
                        if (entry.first.size() > 7 && entry.first.substr(entry.first.size() - 7) == "-latest")
                            ++game_count;
                    data->loaders[3].games = game_count;
                    if (!build.empty()) {
                        data->loaders[3].loaded = true;
                        data->loaders[3].build = utf8_to_wide(build);
                        data->loaders[3].supported = true;
                        data->loaders[3].stable = stable;
                    }
                }
            }
            HttpResult neo = http_request(
                L"https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
                L"GET");
            Json neo_json;
            if (neo_json.parse(neo.body)) {
                const Json* versions = neo_json.find("versions");
                if (versions && !versions->arr.empty()) {
                    data->loaders[4].loaded = true;
                    data->loaders[4].build = utf8_to_wide(versions->arr.back().str);
                    data->loaders[4].supported = true;
                    data->loaders[4].stable = true;
                }
            }
            HttpResult lunar = http_request(
                L"https://lunarspace.site/api-v2/versions?mc=" + data->latest, L"GET");
            Json lunar_json;
            if (lunar_json.parse(lunar.body)) {
                const Json* versions = lunar_json.find("versions");
                if (versions && !versions->arr.empty()) {
                    data->loaders[5].loaded = true;
                    data->loaders[5].build = utf8_to_wide(versions->arr[0].text("version"));
                    data->loaders[5].supported = !data->loaders[5].build.empty();
                    data->loaders[5].stable = versions->arr[0].text("channel", "stable") == "stable";
                }
            }
            HttpResult fabric_games = http_request(
                L"https://meta.fabricmc.net/v2/versions/game", L"GET");
            Json fabric_games_json;
            if (fabric_games_json.parse(fabric_games.body)) {
                data->loaders[1].games = int(fabric_games_json.arr.size());
            }
            HttpResult quilt_games = http_request(
                L"https://meta.quiltmc.org/v3/versions/game", L"GET");
            Json quilt_games_json;
            if (quilt_games_json.parse(quilt_games.body)) {
                data->loaders[2].games = int(quilt_games_json.arr.size());
            }
            data->loaders[0].loaded = true;
            data->loaders[0].build = data->latest;
            data->loaders[0].supported = true;
            data->loaders[0].stable = true;
            data->loaders[5].loaded = true;
        }
        PostMessage(hwnd, WM_APP + 10, 0, reinterpret_cast<LPARAM>(data));
        return 0;
    }, hwnd_, 0, nullptr);
    if (thread) CloseHandle(thread);
}

void App::apply_home_data(HomeData* data) {
    if (!data) return;
    if (data->ok) {
        versions_ = data->releases;
        versions_all_ = data->all;
        versions_manifest_ready_ = true;
        latest_release_ = data->latest;
        latest_snapshot_ = data->latest_snapshot;
        version_total_ = data->total;
    }
    if (!data->loaders.empty()) loaders_ = data->loaders;
    home_data_loading_ = false;
    rebuild_home();
    if (page_ == L"versions") rebuild_versions();
    ui_apply_page();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

static bool contains_ci(const std::wstring& value, const wchar_t* needle) {
    std::wstring lowered = value;
    for (auto& ch : lowered) ch = wchar_t(towlower(ch));
    return lowered.find(needle) != std::wstring::npos;
}

void App::load_loader_games_async(const std::wstring& kind) {
    HWND target = hwnd_;
    HANDLE thread = CreateThread(nullptr, 0, +[](LPVOID param) -> DWORD {
        auto* job = reinterpret_cast<std::pair<HWND, std::wstring>*>(param);
        auto* result = new LoaderGamesResult();
        result->kind = job->second;
        const std::wstring& kind2 = result->kind;
        if (kind2 == L"vanilla") {
            result->ok = true;
            result->all = true;
        } else if (kind2 == L"fabric" || kind2 == L"quilt") {
            HttpResult res = http_request(
                kind2 == L"fabric" ? L"https://meta.fabricmc.net/v2/versions/game"
                                   : L"https://meta.quiltmc.org/v3/versions/game",
                L"GET");
            Json root;
            if (root.parse(res.body) && root.type == Json::Type::Array) {
                for (const auto& row : root.arr) {
                    std::wstring game = utf8_to_wide(row.text("version"));
                    if (!game.empty()) result->games.insert(game);
                }
                result->ok = true;
                result->all = result->games.empty();
            }
        } else if (kind2 == L"forge") {
            HttpResult res = http_request(
                L"https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json",
                L"GET");
            Json root;
            if (root.parse(res.body) && root.type == Json::Type::Object) {
                for (const auto& entry : root.obj) {
                    std::wstring game = utf8_to_wide(entry.first);
                    if (!game.empty() && forge_at_least(game, L"1.5.2"))
                        result->games.insert(game);
                }
                result->ok = true;
                result->all = result->games.empty();
            }
        } else if (kind2 == L"neoforge") {
            HttpResult modern = http_request(
                L"https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
                L"GET");
            HttpResult legacy = http_request(
                L"https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml",
                L"GET");
            bool any = false;
            for (const auto& version : xml_version_list(modern.body)) {
                if (contains_ci(version, L"-alpha") || contains_ci(version, L"-snapshot") ||
                    contains_ci(version, L"+snapshot"))
                    continue;
                std::wstring game = neo_game_of(version);
                if (!game.empty()) result->games.insert(game);
                any = true;
            }
            for (const auto& version : xml_version_list(legacy.body)) {
                if (version.rfind(L"1.20.1-", 0) == 0) {
                    result->games.insert(L"1.20.1");
                    any = true;
                }
            }
            result->ok = any;
        } else if (kind2 == L"lunar") {
            HttpResult res = http_request(L"https://lunarspace.site/api-v2/versions", L"GET");
            Json root;
            if (root.parse(res.body)) {
                const Json* versions = root.find("versions");
                if (versions) {
                    for (const auto& row : versions->arr) {
                        std::wstring game = utf8_to_wide(row.text("minecraft"));
                        if (!game.empty()) result->games.insert(game);
                    }
                    result->ok = true;
                }
            }
        }
        PostMessage(job->first, WM_APP + 16, 0, reinterpret_cast<LPARAM>(result));
        delete job;
        return 0;
    }, new std::pair<HWND, std::wstring>(target, kind), 0, nullptr);
    if (thread) CloseHandle(thread);
    loader_games_kind_ = kind;
    loader_games_loading_ = true;
    loader_games_ready_ = false;
    loader_games_all_ = false;
    loader_games_.clear();
}

void App::load_loader_builds_async(const std::wstring& kind, const std::wstring& game) {
    HWND target = hwnd_;
    auto* job = new std::pair<HWND, std::wstring>(target, kind + L":" + game);
    HANDLE thread = CreateThread(nullptr, 0, +[](LPVOID param) -> DWORD {
        auto* job2 = reinterpret_cast<std::pair<HWND, std::wstring>*>(param);
        auto* result = new LoaderBuildsResult();
        std::wstring key = job2->second;
        size_t split = key.find(L':');
        result->kind = key.substr(0, split);
        result->game = split == std::wstring::npos ? L"" : key.substr(split + 1);
        const std::wstring& kind2 = result->kind;
        const std::wstring& game2 = result->game;
        if (kind2 == L"fabric" || kind2 == L"quilt") {
            HttpResult res = http_request(
                kind2 == L"fabric"
                    ? L"https://meta.fabricmc.net/v2/versions/loader/" + game2
                    : L"https://meta.quiltmc.org/v3/versions/loader/" + game2,
                L"GET");
            Json root;
            if (root.parse(res.body) && root.type == Json::Type::Array) {
                for (const auto& row : root.arr) {
                    const Json* loader = row.find("loader");
                    if (!loader) continue;
                    LoaderBuild build;
                    build.version = utf8_to_wide(loader->text("version"));
                    build.build = utf8_to_wide(loader->text("build"));
                    build.stable = kind2 == L"fabric"
                                       ? loader->boolean("stable", true)
                                       : loader->text("version").find('-') == std::string::npos;
                    if (!build.version.empty()) result->rows.push_back(std::move(build));
                }
                std::stable_sort(result->rows.begin(), result->rows.end(),
                                 [](const LoaderBuild& a, const LoaderBuild& b) {
                                     if (a.stable != b.stable) return a.stable;
                                     return compare_version_text(a.version, b.version) > 0;
                                 });
                if (result->rows.size() > 60) result->rows.resize(60);
                if (!result->rows.empty()) result->rows[0].latest = true;
                result->ok = true;
            }
        } else if (kind2 == L"forge") {
            if (!forge_at_least(game2, L"1.5.2")) {
                result->ok = true;
            } else {
                HttpResult meta_res = http_request(
                    L"https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json",
                    L"GET");
                HttpResult promo_res = http_request(
                    L"https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
                    L"GET");
                Json meta;
                if (meta.parse(meta_res.body)) {
                    const Json* ids = meta.find(wide_to_utf8(game2).c_str());
                    std::wstring latest_promo, recommended;
                    Json promos;
                    if (promos.parse(promo_res.body)) {
                        const Json* map = promos.find("promos");
                        if (map) {
                            latest_promo = utf8_to_wide(map->text(
                                (wide_to_utf8(game2) + "-latest").c_str()));
                            recommended = utf8_to_wide(map->text(
                                (wide_to_utf8(game2) + "-recommended").c_str()));
                        }
                    }
                    if (ids && ids->type == Json::Type::Array) {
                        for (auto it = ids->arr.rbegin(); it != ids->arr.rend(); ++it) {
                            std::wstring id = utf8_to_wide(it->str);
                            if (id.empty()) continue;
                            LoaderBuild build;
                            build.version = forge_display(game2, id);
                            build.stable = !recommended.empty() &&
                                           id.size() > recommended.size() &&
                                           id.compare(id.size() - recommended.size(),
                                                      recommended.size(), recommended) == 0;
                            build.latest = !latest_promo.empty() &&
                                           id.size() > latest_promo.size() &&
                                           id.compare(id.size() - latest_promo.size(),
                                                      latest_promo.size(), latest_promo) == 0;
                            result->rows.push_back(std::move(build));
                        }
                        if (result->rows.size() > 60) result->rows.resize(60);
                        if (!result->rows.empty() &&
                            !std::any_of(result->rows.begin(), result->rows.end(),
                                         [](const LoaderBuild& b) { return b.latest; }))
                            result->rows[0].latest = true;
                    }
                    result->ok = true;
                }
            }
        } else if (kind2 == L"neoforge") {
            HttpResult modern = http_request(
                L"https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
                L"GET");
            HttpResult legacy = http_request(
                L"https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml",
                L"GET");
            std::vector<LoaderBuild> candidates;
            for (const auto& version : xml_version_list(modern.body)) {
                if (contains_ci(version, L"-alpha") || contains_ci(version, L"-snapshot") ||
                    contains_ci(version, L"+snapshot"))
                    continue;
                if (neo_game_of(version) != game2) continue;
                LoaderBuild build;
                build.version = neo_build_of(version);
                build.beta = contains_ci(version, L"-beta");
                if (!build.version.empty()) candidates.push_back(std::move(build));
            }
            if (game2 == L"1.20.1") {
                for (const auto& version : xml_version_list(legacy.body)) {
                    if (version.rfind(L"1.20.1-", 0) != 0) continue;
                    LoaderBuild build;
                    build.version = version.substr(7);
                    if (!build.version.empty()) candidates.push_back(std::move(build));
                }
            }
            std::stable_sort(candidates.begin(), candidates.end(),
                             [](const LoaderBuild& a, const LoaderBuild& b) {
                                 return compare_version_text(a.version, b.version) > 0;
                             });
            bool stable_set = false;
            for (auto& build : candidates) {
                if (!stable_set && !build.beta) {
                    build.stable = true;
                    stable_set = true;
                }
                result->rows.push_back(std::move(build));
                if (result->rows.size() >= 80) break;
            }
            if (!result->rows.empty()) result->rows[0].latest = true;
            result->ok = !result->rows.empty();
        } else if (kind2 == L"lunar") {
            HttpResult res = http_request(
                L"https://lunarspace.site/api-v2/versions?mc=" + game2, L"GET");
            Json root;
            if (root.parse(res.body)) {
                const Json* versions = root.find("versions");
                if (versions) {
                    int index = 0;
                    for (const auto& row : versions->arr) {
                        LoaderBuild build;
                        build.version = utf8_to_wide(row.text("version"));
                        build.stable = row.text("channel", "stable") == "stable";
                        build.latest = index == 0;
                        ++index;
                        if (!build.version.empty()) result->rows.push_back(std::move(build));
                    }
                    result->ok = true;
                }
            }
        }
        PostMessage(job2->first, WM_APP + 17, 0, reinterpret_cast<LPARAM>(result));
        delete job2;
        return 0;
    }, job, 0, nullptr);
    if (thread) CloseHandle(thread);
    builds_key_ = kind + L":" + game;
    builds_loading_ = true;
    builds_ready_ = false;
    builds_failed_ = false;
    builds_.clear();
}

void App::apply_loader_games(LoaderGamesResult* result) {
    if (!result) return;
    if (result->kind != loader_games_kind_) return;
    loader_games_loading_ = false;
    loader_games_ready_ = true;
    loader_games_all_ = result->all;
    loader_games_ = std::move(result->games);
    if (!result->ok) {
        loader_games_ready_ = false;
        loader_games_.clear();
    }
    if (loader_games_ready_ && !loader_games_all_ && !versions_picked_.empty() &&
        !loader_games_.count(versions_picked_)) {
        std::wstring missing = versions_picked_;
        versions_picked_.clear();
        versions_error_ = loader_name(versions_loader_) + L" không hỗ trợ Minecraft " + missing;
    }
    if (page_ == L"versions") rebuild_versions();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::apply_loader_builds(LoaderBuildsResult* result) {
    if (!result) return;
    if (result->kind + L":" + result->game != builds_key_) return;
    builds_loading_ = false;
    builds_ready_ = true;
    builds_failed_ = !result->ok;
    builds_ = std::move(result->rows);
    bool found = false;
    for (const auto& build : builds_)
        if (build.version == versions_build_) { found = true; break; }
    if (!found) versions_build_ = builds_.empty() ? L"" : builds_.front().version;
    if (page_ == L"versions") rebuild_versions();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::load_system_async() {
    HWND target = hwnd_;
    std::wstring shared = shared_dir_;
    HANDLE thread = CreateThread(nullptr, 0, +[](LPVOID param) -> DWORD {
        auto* job = reinterpret_cast<std::pair<HWND, std::wstring>*>(param);
        HomeSystem* info = new HomeSystem();
        info->shared_dir = job->second;
        MEMORYSTATUSEX mem{};
        mem.dwLength = sizeof(mem);
        if (GlobalMemoryStatusEx(&mem)) {
            info->total_mem = mem.ullTotalPhys;
            info->free_mem = mem.ullAvailPhys;
        }
        SYSTEM_INFO sys{};
        GetSystemInfo(&sys);
        info->cpu_threads = int(sys.dwNumberOfProcessors);
        wchar_t model[256]{};
        DWORD size = sizeof(model);
        if (RegGetValueW(HKEY_LOCAL_MACHINE,
                         L"HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0",
                         L"ProcessorNameString", RRF_RT_REG_SZ, nullptr, model, &size) == 0)
            info->cpu_model = model;
        info->ok = true;
        ULARGE_INTEGER free_bytes{}, total_bytes{};
        if (GetDiskFreeSpaceExW(info->shared_dir.c_str(), &free_bytes, &total_bytes, nullptr)) {
            info->disk_total = total_bytes.QuadPart;
            info->disk_free = free_bytes.QuadPart;
        }
        info->assets_bytes = directory_size(info->shared_dir);
        std::wstring runtime = info->shared_dir + L"\\runtime";
        WIN32_FIND_DATAW data{};
        HANDLE find = FindFirstFileW((runtime + L"\\*").c_str(), &data);
        if (find != INVALID_HANDLE_VALUE) {
            do {
                if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY &&
                    wcscmp(data.cFileName, L".") != 0 && wcscmp(data.cFileName, L"..") != 0) {
                    std::wstring dir = runtime + L"\\" + data.cFileName;
                    if (GetFileAttributesW((dir + L"\\bin\\java.exe").c_str()) !=
                        INVALID_FILE_ATTRIBUTES) {
                        ++info->java_count;
                        info->java_bytes += directory_size(dir);
                    }
                }
            } while (FindNextFileW(find, &data));
            FindClose(find);
        }
        PostMessage(job->first, WM_APP + 11, 0, reinterpret_cast<LPARAM>(info));
        delete job;
        return 0;
    }, new std::pair<HWND, std::wstring>(target, shared), 0, nullptr);
    if (thread) CloseHandle(thread);
}

void App::apply_system_info(HomeSystem* info) {
    if (!info) return;
    system_info_ = *info;
    system_loading_ = false;
    if (!system_info_.shared_dir.empty()) shared_dir_ = system_info_.shared_dir;
    rebuild_home();
    if (page_ == L"settings") rebuild_settings();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

static float node_max_bottom(Node* node) {
    if (!node) return 0.0f;
    float bottom = node->rect.bottom;
    for (auto& kid : node->kids) bottom = std::max(bottom, node_max_bottom(kid.get()));
    return bottom;
}

void App::layout_home() {
    if (!home_) return;
    RECT rc{};
    GetClientRect(hwnd_, &rc);
    Node* slot = ui_find(ui_.get(), L"home-slot");
    if (!slot) return;
    home_slot_rect_ = slot->rect;
    float width = slot->rect.right - slot->rect.left;
    if (width < 10.0f) return;
    ui_layout(home_.get(), width, 100000.0f, renderer_);
    home_content_h_ = 0.0f;
    for (auto& kid : home_->kids) home_content_h_ = std::max(home_content_h_, node_max_bottom(kid.get()));
    float view_h = slot->rect.bottom - slot->rect.top;
    float max_scroll = std::max(0.0f, home_content_h_ - view_h);
    home_scroll_ = std::clamp(home_scroll_, 0.0f, max_scroll);
    ui_move(home_.get(), slot->rect.left, slot->rect.top - home_scroll_);
}

void App::on_wheel(int delta, int px, int py) {
    RECT rc{};
    GetClientRect(hwnd_, &rc);
    float x = float(px) / renderer_.scale();
    float y = float(py) / renderer_.scale();
    if (page_ == L"versions" && versions_ui_) {
        if (versions_menu_open_) {
            float total = float(builds_.size()) * 32.0f + 8.0f;
            float view = versions_menu_rect_.bottom - versions_menu_rect_.top;
            float max_scroll = std::max(0.0f, total - view);
            versions_menu_scroll_ =
                std::clamp(versions_menu_scroll_ + (delta > 0 ? -48.0f : 48.0f), 0.0f, max_scroll);
            InvalidateRect(hwnd_, nullptr, FALSE);
            return;
        }
        layout_versions();
        if (!versions_picker_) {
            float aside_view = versions_aside_rect_.bottom - versions_aside_rect_.top;
            float aside_max = std::max(0.0f, versions_aside_content_h_ - aside_view + 32.0f);
            float list_view = versions_list_rect_.bottom - versions_list_rect_.top;
            float list_max = std::max(0.0f, versions_content_h_ - list_view + 40.0f);
            if (x >= versions_aside_rect_.left && x <= versions_aside_rect_.right) {
                versions_aside_scroll_ =
                    std::clamp(versions_aside_scroll_ + (delta > 0 ? -72.0f : 72.0f), 0.0f,
                               aside_max);
            } else {
                versions_scroll_ = std::clamp(versions_scroll_ + (delta > 0 ? -72.0f : 72.0f),
                                              0.0f, list_max);
            }
        } else {
            float view = versions_list_rect_.bottom - versions_list_rect_.top;
            float max_scroll = std::max(0.0f, versions_content_h_ - view + 40.0f);
            versions_scroll_ = std::clamp(versions_scroll_ + (delta > 0 ? -72.0f : 72.0f), 0.0f,
                                          max_scroll);
        }
        InvalidateRect(hwnd_, nullptr, FALSE);
        return;
    }
    if (page_ == L"settings" && settings_) {
        if (x < settings_slot_rect_.left || x > settings_slot_rect_.right ||
            y < settings_slot_rect_.top || y > settings_slot_rect_.bottom)
            return;
        layout_settings();
        float view_h = settings_slot_rect_.bottom - settings_slot_rect_.top;
        float max_scroll = std::max(0.0f, settings_content_h_ - view_h);
        settings_scroll_ =
            std::clamp(settings_scroll_ + (delta > 0 ? -72.0f : 72.0f), 0.0f, max_scroll);
        InvalidateRect(hwnd_, nullptr, FALSE);
        return;
    }
    if (page_ != L"home" || !home_) return;
    if (x < home_slot_rect_.left || x > home_slot_rect_.right || y < home_slot_rect_.top ||
        y > home_slot_rect_.bottom)
        return;
    layout_home();
    float view_h = home_slot_rect_.bottom - home_slot_rect_.top;
    float max_scroll = std::max(0.0f, home_content_h_ - view_h);
    home_scroll_ = std::clamp(home_scroll_ + (delta > 0 ? -72.0f : 72.0f), 0.0f, max_scroll);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::rebuild_home() {
    if (loaders_.empty()) loaders_ = default_loaders();
    auto root = std::make_unique<Node>();
    root->kind = Kind::Column;
    root->style.gap = 18.0f;

    auto text = [&](const std::wstring& value, float size, int weight, Color color,
                    float width = -1.0f, bool mono = false, bool wrap = false) {
        auto node = std::make_unique<Node>();
        node->kind = Kind::Text;
        node->text = value;
        node->style.font_size = size;
        node->style.weight = weight;
        node->style.color = color;
        node->style.mono = mono;
        node->style.wrap = wrap;
        if (width > 0.0f) node->style.width = width;
        return node;
    };
    auto image = [&](const std::wstring& src, float width, float height, float radius = 0.0f,
                     Color color = Color{}) {
        auto node = std::make_unique<Node>();
        node->kind = Kind::Image;
        node->src = src;
        node->style.width = width;
        node->style.height = height;
        node->style.radius = radius;
        if (color.visible()) node->style.color = color;
        return node;
    };
    auto spacer = [&](float width, float height, bool grow_x = false, bool grow_y = false) {
        auto node = std::make_unique<Node>();
        node->kind = Kind::Spacer;
        node->style.width = width;
        node->style.height = height;
        node->style.grow_x = grow_x;
        node->style.grow_y = grow_y;
        return node;
    };
    auto box = [&](Kind kind, float height = -1.0f, float gap = 0.0f) {
        auto node = std::make_unique<Node>();
        node->kind = kind;
        node->style.height = height;
        node->style.gap = gap;
        return node;
    };
    auto card = [&](Kind kind, float height = -1.0f, float gap = 0.0f) {
        auto node = box(kind, height, gap);
        node->style.bg = ui_token(L"surface");
        node->style.border = true;
        node->style.border_color = ui_token(L"border");
        node->style.radius = 14.0f;
        node->style.glass = true;
        return node;
    };
    auto chip = [&](const std::wstring& value, bool dim = false) {
        auto row = box(Kind::Row, 20.0f);
        row->style.pad_l = row->style.pad_r = 6.0f;
        row->style.radius = 5.0f;
        row->style.bg = Color::rgb(0xFFFFFF, dim ? 0.08f : 0.12f);
        row->style.border = true;
        row->style.border_color = Color::rgb(0xFFFFFF, 0.16f);
        row->kids.push_back(text(value, 9.0f, 400,
                                 Color::rgb(0xFFFFFF, dim ? 0.6f : 0.82f), -1.0f, true));
        return row;
    };
    auto status_dot = [&](const std::wstring& status) {
        auto dot = spacer(6.0f, 6.0f);
        dot->style.radius = 3.0f;
        dot->style.bg = status_color(status);
        return dot;
    };
    auto time_row = [&](const std::wstring& ago) {
        auto row = box(Kind::Row, -1.0f, 4.0f);
        row->kids.push_back(image(asset(L"assets/icons/clock.svg"), 11.0f, 11.0f, 0.0f,
                                  ui_token(L"faint")));
        row->kids.push_back(text(ago, 9.0f, 400, ui_token(L"faint"), -1.0f, true));
        return row;
    };
    auto section = [&](const std::wstring& title, const std::wstring& hint,
                       const std::wstring& action_text = L"", const std::wstring& action = L"") {
        auto row = box(Kind::Row, 22.0f, 8.0f);
        row->kids.push_back(text(title, 13.0f, 700, ui_token(L"text")));
        if (!hint.empty()) row->kids.push_back(text(hint, 10.0f, 400, ui_token(L"label")));
        row->kids.push_back(spacer(0, 0, true, false));
        if (!action_text.empty()) {
            auto link = text(action_text, 10.0f, 600, ui_token(L"accent"));
            link->action = action;
            row->kids.push_back(std::move(link));
        }
        root->kids.push_back(std::move(row));
    };
    auto loader_of = [&](const std::wstring& id) -> const LoaderInfo* {
        for (const auto& loader : loaders_)
            if (loader.id == id) return &loader;
        return nullptr;
    };
    auto loader_by_index = [&](size_t index) -> const LoaderInfo* {
        return index < loaders_.size() ? &loaders_[index] : nullptr;
    };

    std::wstring latest = latest_release_.empty() ? L"—" : latest_release_;
    int running = 0;
    for (const auto& inst : instances_)
        if (inst.status == L"running") ++running;

    if (home_tab_ == 0) {
        section(L"Sẵn sàng chơi",
                running ? (std::to_wstring(running) + L" đang chạy") : L"không có tiến trình");
        const InstanceInfo* active = nullptr;
        for (const auto& inst : instances_)
            if (inst.status == L"running" || inst.status == L"starting") { active = &inst; break; }
        if (!active && !instances_.empty()) active = &instances_.front();

        auto hero = box(Kind::Row, 214.0f, 18.0f);
        hero->style.pad_l = hero->style.pad_r = hero->style.pad_t = hero->style.pad_b = 20.0f;
        hero->style.radius = 16.0f;
        hero->style.bg_image = asset(L"assets/img/minecraft-background.png");
        hero->style.overlay = Color::rgb(0x000000, 0.62f);
        hero->style.border = true;
        hero->style.border_color = ui_token(L"border");
        if (active) {
            Color sc = status_color(active->status);
            bool busy = active->status == L"running" || active->status == L"starting" ||
                        active->status == L"stopping";
            bool spinning = active->status == L"starting" || active->status == L"installing";
            Color play_bg = spinning ? Color::rgb(0xEAB308)
                            : active->status == L"running" || active->status == L"stopping"
                                ? Color::rgb(0xEF4444)
                                : Color::rgb(0x22C55E);
            Color play_ink = spinning ? Color::rgb(0x1A1405)
                            : active->status == L"running" || active->status == L"stopping"
                                ? Color::rgb(0xFFFFFF)
                                : Color::rgb(0x04140A);
            auto play = box(Kind::Row, 84.0f);
            play->style.width = 84.0f;
            play->style.radius = 16.0f;
            play->style.bg = play_bg;
            play->action = L"home:launch";
            play->kids.push_back(spacer(0, 0, true, false));
            play->kids.push_back(text(spinning ? L"⟳" : busy ? L"■" : L"▶", 30.0f, 700,
                                      play_ink));
            play->kids.push_back(spacer(0, 0, true, false));
            hero->kids.push_back(std::move(play));

            auto info = box(Kind::Column, -1.0f, 6.0f);
            info->style.grow_x = true;
            auto state_row = box(Kind::Row, 16.0f, 6.0f);
            state_row->kids.push_back(status_dot(active->status));
            state_row->kids.push_back(text(upper_text(status_label(active->status)), 9.0f, 700,
                                           Color::rgb(0xFFFFFF, 0.6f)));
            info->kids.push_back(std::move(state_row));
            info->kids.push_back(text(active->name, 26.0f, 700, Color::rgb(0xFFFFFF)));
            auto chips = box(Kind::Row, 20.0f, 6.0f);
            std::wstring loader_chip = active->loader;
            if (!active->loader_version.empty()) loader_chip += L" " + active->loader_version;
            chips->kids.push_back(chip(loader_chip));
            chips->kids.push_back(chip(active->version));
            chips->kids.push_back(chip(std::to_wstring(active->memory_mb) + L" MB"));
            info->kids.push_back(std::move(chips));
            info->kids.push_back(spacer(0, 0, false, true));
            auto facts = box(Kind::Row, -1.0f, 24.0f);
            auto fact = [&](const wchar_t* icon_path, const std::wstring& label,
                            const std::wstring& value) {
                auto row = box(Kind::Row, -1.0f, 8.0f);
                row->kids.push_back(image(asset(icon_path), 15.0f, 15.0f, 0.0f,
                                          Color::rgb(0xFFFFFF, 0.6f)));
                auto col = box(Kind::Column, -1.0f, 2.0f);
                col->kids.push_back(
                    text(label, 8.0f, 700, Color::rgb(0xFFFFFF, 0.55f)));
                col->kids.push_back(text(value, 11.0f, 600, Color::rgb(0xFFFFFF)));
                row->kids.push_back(std::move(col));
                return row;
            };
            std::wstring loader_value = active->loader;
            if (!active->loader_version.empty()) loader_value += L" " + active->loader_version;
            facts->kids.push_back(fact(L"assets/icons/memory.svg", L"RAM",
                                       std::to_wstring(active->memory_mb) + L" MB"));
            facts->kids.push_back(fact(L"assets/icons/cube.svg", L"TRÌNH TẢI", loader_value));
            facts->kids.push_back(fact(L"assets/icons/clock.svg", L"THỜI GIAN CHƠI",
                                       format_playtime(active->playtime_ms)));
            facts->kids.push_back(fact(L"assets/icons/calendar.svg", L"LẦN CHƠI CUỐI",
                                       active->last_played.empty()
                                           ? L"chưa chơi"
                                           : iso_ago(active->last_played)));
            info->kids.push_back(std::move(facts));
            hero->kids.push_back(std::move(info));

            auto open = box(Kind::Row, 36.0f);
            open->style.width = 64.0f;
            open->style.radius = 8.0f;
            open->style.bg = Color::rgb(0xFFFFFF, 0.16f);
            open->style.border = true;
            open->style.border_color = Color::rgb(0xFFFFFF, 0.2f);
            open->action = L"home:open";
            open->kids.push_back(spacer(0, 0, true, false));
            open->kids.push_back(text(L"Mở", 11.0f, 600, Color::rgb(0xFFFFFF)));
            open->kids.push_back(spacer(0, 0, true, false));
            hero->kids.push_back(std::move(open));
        } else {
            auto icon_box = box(Kind::Column, 80.0f);
            icon_box->style.width = 80.0f;
            icon_box->style.radius = 16.0f;
            icon_box->style.bg = Color::rgb(0xFFFFFF, 0.1f);
            icon_box->style.border = true;
            icon_box->style.border_color = Color::rgb(0xFFFFFF, 0.16f);
            icon_box->kids.push_back(spacer(0, 0, false, true));
            auto cube = image(asset(L"assets/icons/cube.svg"), 30.0f, 30.0f, 0.0f,
                              Color::rgb(0xFFFFFF));
            cube->style.grow_x = true;
            icon_box->kids.push_back(std::move(cube));
            icon_box->kids.push_back(spacer(0, 0, false, true));
            hero->kids.push_back(std::move(icon_box));
            auto info = box(Kind::Column, -1.0f, 4.0f);
            info->style.grow_x = true;
            info->kids.push_back(text(L"Chưa có phiên bản nào", 20.0f, 700,
                                      Color::rgb(0xFFFFFF)));
            info->kids.push_back(text(L"Tạo phiên bản từ Minecraft " + latest +
                                          L" để bắt đầu chơi.",
                                      12.0f, 400, Color::rgb(0xFFFFFF, 0.66f)));
            info->kids.push_back(text(std::to_wstring(version_total_) + L" bản phát hành · " +
                                          std::to_wstring(loaders_.size()) + L" trình tải sẵn sàng",
                                      10.0f, 400, Color::rgb(0xFFFFFF, 0.5f), -1.0f, true));
            hero->kids.push_back(std::move(info));
            auto create = box(Kind::Row, 40.0f);
            create->style.pad_l = create->style.pad_r = 16.0f;
            create->style.radius = 8.0f;
            create->style.bg = ui_token(L"accent");
            create->action = L"nav:versions";
            create->kids.push_back(text(L"Tạo phiên bản", 12.0f, 700, ui_token(L"ink")));
            hero->kids.push_back(std::move(create));
        }
        root->kids.push_back(std::move(hero));

        section(L"Bản phát hành", std::to_wstring(version_total_) + L" bản", L"Xem tất cả →",
                L"nav:versions");
        auto release_row = box(Kind::Row, 360.0f, 12.0f);
        auto latest_card = card(Kind::Column, 360.0f, 8.0f);
        latest_card->style.grow = 1.15f;
        latest_card->style.pad_l = latest_card->style.pad_r = 16.0f;
        latest_card->style.pad_t = latest_card->style.pad_b = 16.0f;
        auto latest_head = box(Kind::Row, 48.0f, 12.0f);
        auto latest_icon = box(Kind::Column, 48.0f);
        latest_icon->style.width = 48.0f;
        latest_icon->style.radius = 10.0f;
        latest_icon->style.bg = ui_token(L"input");
        latest_icon->style.border = true;
        latest_icon->style.border_color = ui_token(L"border");
        latest_icon->kids.push_back(spacer(0, 0, true, false));
        latest_icon->kids.push_back(
            image(asset(L"assets/img/loader-icon/vanilla.png"), 32.0f, 32.0f));
        latest_icon->kids.push_back(spacer(0, 0, true, false));
        latest_head->kids.push_back(std::move(latest_icon));
        auto latest_info = box(Kind::Column, -1.0f, 1.0f);
        latest_info->style.grow_x = true;
        auto version_line = box(Kind::Row, 24.0f, 6.0f);
        version_line->kids.push_back(text(latest, 20.0f, 700, ui_token(L"text"), -1.0f, true));
        version_line->kids.push_back(text(L"MỚI NHẤT", 8.0f, 700, ui_token(L"accent")));
        latest_info->kids.push_back(std::move(version_line));
        latest_info->kids.push_back(
            text(L"Phát hành " + (versions_.empty() ? L"—" : iso_date(versions_[0].release_time)) +
                     (versions_.empty() ? L"" : L" · " + iso_ago(versions_[0].release_time)),
                 10.0f, 400, ui_token(L"label")));
        if (!latest_snapshot_.empty())
            latest_info->kids.push_back(text(L"Bản thử nghiệm: " + latest_snapshot_, 10.0f, 400,
                                             ui_token(L"faint"), -1.0f, true));
        latest_head->kids.push_back(std::move(latest_info));
        latest_card->kids.push_back(std::move(latest_head));
        auto line1 = spacer(0, 1);
        line1->style.bg = ui_token(L"border");
        latest_card->kids.push_back(std::move(line1));
        latest_card->kids.push_back(
            text(L"TRÌNH TẢI HỖ TRỢ BẢN NÀY", 9.0f, 700, ui_token(L"faint")));
        for (size_t i = 0; i < loaders_.size(); ++i) {
            const LoaderInfo& loader = loaders_[i];
            auto row = box(Kind::Row, 25.0f, 8.0f);
            row->kids.push_back(
                image(asset(loader_icon_path(loader.id)), 16.0f, 16.0f));
            row->kids.push_back(text(loader.name, 10.5f, 600, ui_token(L"text"), 64.0f));
            if (!loader.loaded) {
                row->kids.push_back(text(L"Đang tải…", 9.0f, 400, ui_token(L"faint")));
            } else if (loader.supported) {
                row->kids.push_back(image(asset(L"assets/icons/check.svg"), 10.0f, 10.0f, 0.0f,
                                          Color::rgb(0x22C55E)));
                row->kids.push_back(text(loader.build, 10.0f, 400, ui_token(L"label"), -1.0f,
                                         true));
                row->kids.push_back(spacer(0, 0, true, false));
                if (loader.games > 0)
                    row->kids.push_back(text(std::to_wstring(loader.games) + L" phiên bản", 9.0f,
                                             400, ui_token(L"faint"), -1.0f, true));
            } else {
                row->kids.push_back(image(asset(L"assets/icons/minus.svg"), 10.0f, 10.0f, 0.0f,
                                          ui_token(L"faint")));
                row->kids.push_back(text(L"chưa phát hành cho bản này", 9.0f, 400,
                                         ui_token(L"faint")));
            }
            latest_card->kids.push_back(std::move(row));
        }
        auto create_button = box(Kind::Row, 34.0f);
        create_button->style.radius = 8.0f;
        create_button->style.bg = ui_token(L"accent");
        create_button->action = L"nav:versions";
        create_button->kids.push_back(spacer(0, 0, true, false));
        create_button->kids.push_back(text(L"Tạo phiên bản với " + latest, 11.0f, 700,
                                           ui_token(L"ink")));
        create_button->kids.push_back(spacer(0, 0, true, false));
        latest_card->kids.push_back(std::move(create_button));
        release_row->kids.push_back(std::move(latest_card));

        auto list_card = card(Kind::Column, 360.0f, 0.0f);
        list_card->style.grow = 1.0f;
        list_card->style.pad_l = list_card->style.pad_r = 8.0f;
        list_card->style.pad_t = list_card->style.pad_b = 8.0f;
        if (versions_.empty()) {
            list_card->kids.push_back(text(L"Không tải được danh sách phiên bản.", 10.0f, 400,
                                           ui_token(L"label")));
        } else {
            for (size_t i = 0; i < versions_.size(); ++i) {
                const VersionInfo& version = versions_[i];
                bool first = i == 0;
                auto row = box(Kind::Row, 32.0f, 8.0f);
                if (first) { row->style.bg = ui_token(L"input"); row->style.radius = 8.0f; }
                auto dot = spacer(6.0f, 6.0f);
                dot->style.radius = 3.0f;
                dot->style.bg = first ? ui_token(L"accent") : ui_token(L"faint");
                row->kids.push_back(std::move(dot));
                row->kids.push_back(text(version.id, 10.5f, 700,
                                         first ? ui_token(L"accent") : ui_token(L"text"), 74.0f,
                                         true));
                row->kids.push_back(text(iso_date(version.release_time), 9.5f, 400,
                                         ui_token(L"faint"), -1.0f, true));
                row->kids.push_back(spacer(0, 0, true, false));
                row->kids.push_back(text(iso_ago(version.release_time), 9.5f, 400,
                                         ui_token(L"faint"), -1.0f, true));
                list_card->kids.push_back(std::move(row));
            }
        }
        release_row->kids.push_back(std::move(list_card));
        root->kids.push_back(std::move(release_row));

        section(L"Trình tải mod", L"bản mới nhất cho " + latest);
        for (int start = 0; start < int(loaders_.size()); start += 3) {
            auto row = box(Kind::Row, 76.0f, 10.0f);
            for (int i = start; i < start + 3 && i < int(loaders_.size()); ++i) {
                const LoaderInfo& loader = loaders_[size_t(i)];
                auto tile = card(Kind::Row, 76.0f, 10.0f);
                tile->style.grow = 1.0f;
                tile->style.pad_l = tile->style.pad_r = tile->style.pad_t =
                    tile->style.pad_b = 12.0f;
                tile->style.radius = 12.0f;
                auto icon_box = box(Kind::Column, 36.0f);
                icon_box->style.width = 36.0f;
                icon_box->style.radius = 8.0f;
                icon_box->style.bg = ui_token(L"input");
                icon_box->style.border = true;
                icon_box->style.border_color = ui_token(L"border");
                icon_box->kids.push_back(spacer(0, 0, true, false));
                icon_box->kids.push_back(
                    image(asset(loader_icon_path(loader.id)), 24.0f, 24.0f));
                icon_box->kids.push_back(spacer(0, 0, true, false));
                tile->kids.push_back(std::move(icon_box));
                auto info = box(Kind::Column, -1.0f, 1.0f);
                info->style.grow_x = true;
                info->kids.push_back(text(loader.name, 11.5f, 700, ui_token(L"text")));
                info->kids.push_back(text(loader.desc, 9.5f, 400, ui_token(L"faint")));
                if (!loader.loaded)
                    info->kids.push_back(text(L"Đang tải…", 9.5f, 400, ui_token(L"faint")));
                else if (loader.supported) {
                    std::wstring suffix = loader.vanilla ? L" · bản gốc"
                                          : loader.stable ? L" · ổn định"
                                                          : L" · thử nghiệm";
                    info->kids.push_back(text(loader.build + suffix, 9.5f, 400,
                                             loader.stable || loader.vanilla ? Color::rgb(0x22C55E)
                                                                             : Color::rgb(0xEAB308),
                                             -1.0f, true));
                } else {
                    info->kids.push_back(text(L"không có build", 9.5f, 400, ui_token(L"faint")));
                }
                tile->kids.push_back(std::move(info));
                row->kids.push_back(std::move(tile));
            }
            root->kids.push_back(std::move(row));
        }
    } else if (home_tab_ == 1) {
        struct RecentRow { const InstanceInfo* inst; std::wstring title; std::wstring sub; std::wstring played; };
        std::vector<RecentRow> worlds;
        std::vector<RecentRow> servers;
        for (const auto& inst : instances_) {
            for (const auto& world : inst.worlds) {
                worlds.push_back({ &inst, world.name.empty() ? world.folder : world.name,
                                   inst.name + L" · " + world.folder, world.played_at });
            }
            for (const auto& server : inst.servers) {
                std::wstring host = server.host;
                if (server.port != 25565) host += L":" + std::to_wstring(server.port);
                servers.push_back({ &inst, host,
                                    inst.name + L" · " + inst.loader + L" " + inst.version,
                                    server.played_at });
            }
        }
        auto by_time = [](const RecentRow& a, const RecentRow& b) { return a.played > b.played; };
        std::sort(worlds.begin(), worlds.end(), by_time);
        std::sort(servers.begin(), servers.end(), by_time);
        if (worlds.size() > 8) worlds.resize(8);
        if (servers.size() > 8) servers.resize(8);

        auto recent_section = [&](const std::wstring& title, const std::wstring& hint,
                                  const std::wstring& action, const std::vector<RecentRow>& rows,
                                  const std::wstring& button_text, const std::wstring& empty) {
            section(title, hint);
            auto list = card(Kind::Column, -1.0f, 0.0f);
            if (rows.empty()) {
                list->kids.push_back(text(empty, 11.0f, 400, ui_token(L"faint"), -1.0f, false,
                                          true));
            } else {
                for (size_t i = 0; i < rows.size(); ++i) {
                    const RecentRow& row = rows[i];
                    auto item = box(Kind::Row, 54.0f, 10.0f);
                    item->style.pad_l = item->style.pad_r = 14.0f;
                    item->kids.push_back(
                        image(asset(loader_icon_path(row.inst->loader)), 26.0f, 26.0f, 6.0f));
                    auto info = box(Kind::Column, -1.0f, 1.0f);
                    info->style.grow_x = true;
                    info->kids.push_back(text(row.title, 11.0f, 700, ui_token(L"text")));
                    info->kids.push_back(text(row.sub, 9.0f, 400, ui_token(L"faint"), -1.0f, true));
                    item->kids.push_back(std::move(info));
                    item->kids.push_back(time_row(iso_ago(row.played)));
                    auto play = box(Kind::Row, 28.0f);
                    play->style.pad_l = play->style.pad_r = 10.0f;
                    play->style.radius = 6.0f;
                    play->style.bg = Color::rgb(0x22C55E, 0.14f);
                    play->action = action;
                    play->kids.push_back(text(button_text, 9.5f, 700, Color::rgb(0x22C55E)));
                    item->kids.push_back(std::move(play));
                    list->kids.push_back(std::move(item));
                    if (i + 1 < rows.size()) {
                        auto line = spacer(0, 1);
                        line->style.bg = ui_token(L"border");
                        list->kids.push_back(std::move(line));
                    }
                }
            }
            root->kids.push_back(std::move(list));
        };
        recent_section(L"Thế giới gần đây", L"bấm để vào nhanh", L"home:play-world", worlds,
                       L"Vào world",
                       L"Chưa có world nào được ghi lại. Vào Singleplayer một lần để lịch sử xuất hiện ở đây.");
        recent_section(L"Server gần đây", L"tham gia lại nhanh", L"home:play-server", servers,
                       L"Tham gia",
                       L"Chưa có server nào được ghi lại. Tham gia Multiplayer một lần để lịch sử xuất hiện ở đây.");
    } else if (home_tab_ == 2) {
        std::vector<const InstanceInfo*> ordered;
        for (const auto& inst : instances_) ordered.push_back(&inst);
        std::sort(ordered.begin(), ordered.end(), [](const InstanceInfo* a, const InstanceInfo* b) {
            std::wstring ak = !a->last_played.empty() ? a->last_played : a->created;
            std::wstring bk = !b->last_played.empty() ? b->last_played : b->created;
            return ak > bk;
        });
        if (!ordered.empty()) {
            section(L"Phiên bản của bạn", std::to_wstring(ordered.size()) + L" phiên bản");
            auto list = card(Kind::Column, -1.0f, 0.0f);
            for (size_t i = 0; i < ordered.size(); ++i) {
                const InstanceInfo& inst = *ordered[i];
                auto item = box(Kind::Row, 48.0f, 10.0f);
                item->style.pad_l = item->style.pad_r = 14.0f;
                item->kids.push_back(image(inst.icon.empty()
                                               ? asset(loader_icon_path(inst.loader))
                                               : inst.icon,
                                           26.0f, 26.0f, 6.0f));
                auto info = box(Kind::Column, -1.0f, 1.0f);
                info->style.grow_x = true;
                info->kids.push_back(text(inst.name, 11.0f, 700, ui_token(L"text")));
                std::wstring sub = inst.loader;
                if (!inst.loader_version.empty()) sub += L" " + inst.loader_version;
                sub += L" · " + inst.version + L" · " + std::to_wstring(inst.memory_mb) + L" MB";
                info->kids.push_back(text(sub, 9.0f, 400, ui_token(L"faint"), -1.0f, true));
                item->kids.push_back(std::move(info));
                item->kids.push_back(time_row(inst.last_played.empty()
                                                  ? L"chưa chơi"
                                                  : iso_ago(inst.last_played)));
                Color sc = status_color(inst.status);
                auto badge = box(Kind::Row, 18.0f, 4.0f);
                badge->style.pad_l = badge->style.pad_r = 6.0f;
                badge->style.radius = 4.0f;
                badge->style.bg = Color{ sc.r, sc.g, sc.b, 0.14f };
                badge->kids.push_back(status_dot(inst.status));
                badge->kids.push_back(text(status_label(inst.status), 9.0f, 700, sc));
                item->kids.push_back(std::move(badge));
                bool busy = inst.status == L"running" || inst.status == L"stopping";
                auto launch = box(Kind::Row, 28.0f);
                launch->style.width = 28.0f;
                launch->style.radius = 6.0f;
                launch->style.bg = busy ? Color::rgb(0xEF4444, 0.14f) : Color::rgb(0x22C55E, 0.14f);
                launch->action = L"home:launch";
                launch->kids.push_back(spacer(0, 0, true, false));
                launch->kids.push_back(text(busy ? L"■" : L"▶", 11.0f, 700,
                                            busy ? Color::rgb(0xEF4444)
                                                 : Color::rgb(0x22C55E)));
                launch->kids.push_back(spacer(0, 0, true, false));
                item->kids.push_back(std::move(launch));
                list->kids.push_back(std::move(item));
                if (i + 1 < ordered.size()) {
                    auto line = spacer(0, 1);
                    line->style.bg = ui_token(L"border");
                    list->kids.push_back(std::move(line));
                }
            }
            root->kids.push_back(std::move(list));
        } else {
            auto empty = card(Kind::Row, 72.0f, 14.0f);
            empty->style.pad_l = empty->style.pad_r = 18.0f;
            empty->kids.push_back(image(asset(L"assets/icons/cube.svg"), 22.0f, 22.0f, 0.0f,
                                        ui_token(L"accent")));
            auto info = box(Kind::Column, -1.0f, 2.0f);
            info->style.grow_x = true;
            info->kids.push_back(text(L"Chưa có phiên bản nào", 12.0f, 700, ui_token(L"text")));
            info->kids.push_back(text(L"Tạo phiên bản để bắt đầu chơi.", 10.0f, 400,
                                      ui_token(L"faint")));
            empty->kids.push_back(std::move(info));
            auto create = box(Kind::Row, 32.0f);
            create->style.pad_l = create->style.pad_r = 12.0f;
            create->style.radius = 8.0f;
            create->style.bg = ui_token(L"accent");
            create->action = L"nav:versions";
            create->kids.push_back(text(L"Tạo phiên bản", 10.0f, 700, ui_token(L"ink")));
            empty->kids.push_back(std::move(create));
            root->kids.push_back(std::move(empty));
        }
    } else {
        section(L"Hệ thống & lưu trữ", L"");
        auto row = box(Kind::Row, 320.0f, 12.0f);
        auto left = card(Kind::Column, 320.0f, 10.0f);
        left->style.grow = 1.0f;
        left->style.pad_l = left->style.pad_r = left->style.pad_t = left->style.pad_b = 16.0f;
        auto meter = [&](const std::wstring& label, unsigned long long used,
                         unsigned long long total, Color color) {
            auto col = box(Kind::Column, -1.0f, 4.0f);
            auto line = box(Kind::Row, 16.0f, 6.0f);
            line->kids.push_back(text(label, 10.0f, 700, ui_token(L"text")));
            line->kids.push_back(spacer(0, 0, true, false));
            std::wstring value = format_bytes(used) + L" / " + format_bytes(total);
            line->kids.push_back(text(value, 9.0f, 400, ui_token(L"label"), -1.0f, true));
            col->kids.push_back(std::move(line));
            auto bar = box(Kind::Row, 6.0f, 0.0f);
            bar->style.radius = 3.0f;
            bar->style.bg = ui_token(L"borderSoft");
            float fraction = total > 0 ? float(double(used) / double(total)) : 0.0f;
            fraction = std::clamp(fraction, 0.0f, 1.0f);
            if (fraction > 0.0f) {
                auto fill = spacer(0, 6);
                fill->style.grow = fraction;
                fill->style.bg = color;
                bar->kids.push_back(std::move(fill));
            }
            if (fraction < 1.0f) {
                auto rest = spacer(0, 6);
                rest->style.grow = 1.0f - fraction;
                bar->kids.push_back(std::move(rest));
            }
            col->kids.push_back(std::move(bar));
            return col;
        };
        if (system_info_.ok) {
            unsigned long long used_mem =
                system_info_.total_mem > system_info_.free_mem
                    ? system_info_.total_mem - system_info_.free_mem
                    : 0;
            unsigned long long used_disk =
                system_info_.disk_total > system_info_.disk_free
                    ? system_info_.disk_total - system_info_.disk_free
                    : 0;
            left->kids.push_back(meter(L"RAM", used_mem, system_info_.total_mem,
                                       ui_token(L"accent")));
            left->kids.push_back(meter(L"Ổ ĐĨA", used_disk, system_info_.disk_total,
                                       Color::rgb(0x22C55E)));
            auto line = spacer(0, 1);
            line->style.bg = ui_token(L"border");
            left->kids.push_back(std::move(line));
            auto fact = [&](const std::wstring& label, const std::wstring& value) {
                auto r = box(Kind::Row, 18.0f, 8.0f);
                r->kids.push_back(text(label, 10.0f, 400, ui_token(L"faint")));
                r->kids.push_back(spacer(0, 0, true, false));
                r->kids.push_back(text(value, 10.0f, 600, ui_token(L"text")));
                return r;
            };
            left->kids.push_back(fact(L"CPU", std::to_wstring(system_info_.cpu_threads) +
                                                   L" luồng"));
            left->kids.push_back(fact(L"Kiến trúc", L"win32 x64"));
            left->kids.push_back(text(system_info_.cpu_model, 9.0f, 400, ui_token(L"faint"),
                                      -1.0f, true));
        } else {
            left->kids.push_back(text(L"Đang đọc thông tin hệ thống…", 10.0f, 400,
                                      ui_token(L"label")));
        }
        row->kids.push_back(std::move(left));

        auto right = card(Kind::Column, 320.0f, 8.0f);
        right->style.grow = 1.0f;
        right->style.pad_l = right->style.pad_r = right->style.pad_t = right->style.pad_b = 16.0f;
        auto fact_row = [&](const std::wstring& label, const std::wstring& value) {
            auto r = box(Kind::Column, -1.0f, 2.0f);
            r->kids.push_back(text(label, 9.0f, 700, ui_token(L"faint")));
            r->kids.push_back(text(value, 10.0f, 500, ui_token(L"text"), -1.0f, true));
            return r;
        };
        right->kids.push_back(fact_row(L"THƯ MỤC CHUNG", shared_dir_));
        right->kids.push_back(fact_row(L"DUNG LƯỢNG TÀI NGUYÊN",
                                       format_bytes(system_info_.assets_bytes)));
        right->kids.push_back(fact_row(
            L"JAVA",
            std::to_wstring(system_info_.java_count) + L" bản · " +
                format_bytes(system_info_.java_bytes)));
        right->kids.push_back(fact_row(L"JAVA MẶC ĐỊNH", L"Java tải kèm"));
        right->kids.push_back(spacer(0, 0, false, true));
        auto open = box(Kind::Row, 32.0f);
        open->style.radius = 8.0f;
        open->style.bg = ui_token(L"input");
        open->style.border = true;
        open->style.border_color = ui_token(L"border");
        open->action = L"home:open-shared";
        open->kids.push_back(spacer(0, 0, true, false));
        open->kids.push_back(image(asset(L"assets/icons/folder-open.svg"), 12.0f, 12.0f, 0.0f,
                                   ui_token(L"label")));
        open->kids.push_back(text(L"  Mở thư mục", 10.0f, 600, ui_token(L"label")));
        open->kids.push_back(spacer(0, 0, true, false));
        right->kids.push_back(std::move(open));
        row->kids.push_back(std::move(right));
        root->kids.push_back(std::move(row));
        if (!system_info_.ok)
            root->kids.push_back(text(L"Đang đọc thông tin hệ thống…", 10.0f, 400,
                                      ui_token(L"faint")));
    }

    root->kids.push_back(spacer(0, 12));
    home_ = std::move(root);
    hovered_ = nullptr;
}

// ---------------------------------------------------------------- settings --

struct BgJob {
    HWND hwnd = nullptr;
    std::wstring dir;
    std::wstring file;
    std::wstring id;
};

static bool file_exists_w(const std::wstring& path) {
    return GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES;
}

static int leading_int(const std::wstring& value) {
    int number = 0;
    for (wchar_t ch : value) {
        if (ch < L'0' || ch > L'9') break;
        number = number * 10 + int(ch - L'0');
    }
    return number;
}

static std::wstring runtime_platform() {
#if defined(__aarch64__) || defined(_M_ARM64)
    return L"windows-arm64";
#elif defined(_WIN64)
    return L"windows-x64";
#else
    return L"windows-x86";
#endif
}

static std::wstring find_java_in_tree(const std::wstring& root, int depth) {
    std::wstring direct = root + L"\\bin\\java.exe";
    if (file_exists_w(direct)) return direct;
    if (depth <= 0) return L"";
    WIN32_FIND_DATAW data{};
    HANDLE find = FindFirstFileW((root + L"\\*").c_str(), &data);
    if (find == INVALID_HANDLE_VALUE) return L"";
    do {
        if (!(data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
        if (wcscmp(data.cFileName, L".") == 0 || wcscmp(data.cFileName, L"..") == 0) continue;
        std::wstring hit = find_java_in_tree(root + L"\\" + data.cFileName, depth - 1);
        if (!hit.empty()) { FindClose(find); return hit; }
    } while (FindNextFileW(find, &data));
    FindClose(find);
    return L"";
}

static std::wstring java_release_version(const std::wstring& exe, int* major) {
    std::wstring root = exe;
    for (int i = 0; i < 2 && !root.empty(); ++i) {
        size_t pos = root.find_last_of(L"\\/");
        root = pos == std::wstring::npos ? L"" : root.substr(0, pos);
    }
    std::string release = read_file_utf8(root + L"\\release");
    std::wstring version;
    size_t key = release.find("JAVA_VERSION=\"");
    if (key != std::string::npos) {
        size_t start = key + 14;
        size_t end = release.find('"', start);
        if (end != std::string::npos) version = utf8_to_wide(release.substr(start, end - start));
    }
    if (major) {
        int value = 0;
        if (version.size() > 2 && version[0] == L'1' && version[1] == L'.')
            value = leading_int(version.substr(2));
        else
            value = leading_int(version);
        *major = value;
    }
    return version;
}

static bool remove_tree(const std::wstring& dir) {
    WIN32_FIND_DATAW data{};
    HANDLE find = FindFirstFileW((dir + L"\\*").c_str(), &data);
    if (find != INVALID_HANDLE_VALUE) {
        do {
            if (wcscmp(data.cFileName, L".") == 0 || wcscmp(data.cFileName, L"..") == 0) continue;
            std::wstring path = dir + L"\\" + data.cFileName;
            if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)
                remove_tree(path);
            else {
                SetFileAttributesW(path.c_str(), FILE_ATTRIBUTE_NORMAL);
                DeleteFileW(path.c_str());
            }
        } while (FindNextFileW(find, &data));
        FindClose(find);
    }
    return RemoveDirectoryW(dir.c_str()) != FALSE;
}

void App::sync_shell_palette(bool animate) {
    // Wallpaper mode has its own fixed glass palette (dark) so toggling the
    // light/dark switch cannot repaint the cards.
    bool target_dark = theme_locked_ ? true : dark_;
    if (animate && ui_is_dark() != target_dark) {
        ui_set_dark(target_dark);
        ui_start_theme_anim(target_dark);
        theme_animating_ = true;
        SetTimer(hwnd_, 2, 16, nullptr);
    } else {
        ui_set_dark(target_dark);
        ui_set_theme_anim(target_dark ? 1.0f : 0.0f);
        theme_animating_ = false;
    }
}

void App::save_user_setting(const std::string& key, Json value) {
    std::wstring path = user_data_dir() + L"\\settings.json";
    Json root;
    root.parse(read_file_utf8(path));
    if (root.type != Json::Type::Object) root = Json::object();
    root.set(key, std::move(value));
    write_file_utf8(path, root.dump(2));
}

void App::load_settings_page_state() {
    bg_items_.clear();
    std::wstring dir = user_data_dir() + L"\\backgrounds";
    CreateDirectoryW(dir.c_str(), nullptr);
    struct Def { const wchar_t* id; const wchar_t* name; const wchar_t* ext; };
    static const Def defs[] = {
        { L"984658", L"984658", L"jpg" },
        { L"1224149", L"1224149", L"png" },
        { L"1265740", L"1265740", L"png" },
        { L"1373816", L"1373816", L"png" },
        { L"1402908", L"1402908", L"png" },
    };
    for (const auto& def : defs) {
        BgItem item;
        item.id = def.id;
        item.name = def.name;
        item.ext = def.ext;
        std::wstring downloaded = dir + L"\\" + item.id + L"." + item.ext;
        if (file_exists_w(downloaded)) item.file = downloaded;
        item.ready = !item.file.empty() && file_exists_w(item.file);
        bg_items_.push_back(std::move(item));
    }
}

std::wstring App::background_file(const std::wstring& id) const {
    if (id.empty() || id == L"theme") return L"";
    for (const auto& item : bg_items_)
        if (item.id == id && item.ready) return item.file;
    return L"";
}

void App::apply_background(const std::wstring& id) {
    std::wstring file = background_file(id);
    if (id != L"theme" && file.empty()) {
        notify(L"Ảnh nền", L"Ảnh chưa được tải về.", L"error");
        return;
    }
    std::wstring old_file = background_file(background_id_);
    bool changed = id != background_id_;
    background_id_ = id;
    save_user_setting("background", Json::string(wide_to_utf8(id)));
    Node* root = ui_find(ui_.get(), L"root");
    if (root) {
        root->style.bg_image = L"";
        root->style.overlay = Color{};
    }
    anims_.cancel(L"background.flip");
    bg_flipping_ = false;
    if (changed && effects_enabled_ && (old_file != file) && !splash_active()) {
        bg_flipping_ = true;
        bg_flip_t_ = 0.0f;
        bg_flip_from_ = old_file;
        bg_flip_to_ = file;
        anims_.run(L"background.flip", 0.0f, 1.0f, 650, anim_ease::OutCubic,
                   [this](float v) { bg_flip_t_ = v; });
        SetTimer(hwnd_, 2, 16, nullptr);
    } else if (root) {
        root->style.bg_image = file;
    }
    theme_locked_ = id != L"theme";
    sync_shell_palette(true);
    rebuild_settings();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::start_background_download(const std::wstring& id) {
    if (!bg_busy_.empty()) return;
    const BgItem* target = nullptr;
    for (const auto& item : bg_items_)
        if (item.id == id) target = &item;
    if (!target || target->ready) return;
    bg_busy_ = id;
    settings_error_.clear();
    rebuild_settings();
    InvalidateRect(hwnd_, nullptr, FALSE);
    auto* job = new BgJob{ hwnd_, user_data_dir() + L"\\backgrounds", id + L"." + target->ext, id };
    HANDLE thread = CreateThread(nullptr, 0, +[](LPVOID param) -> DWORD {
        BgJob* j = reinterpret_cast<BgJob*>(param);
        HttpResult res = http_request(
            L"https://raw.githubusercontent.com/foxstudio-201/LunarSpaceLauncher/main/"
            L"backgrounds/" + j->file,
            L"GET");
        auto* result = new BgResult();
        result->id = j->id;
        if (!res.ok() || res.body.empty()) {
            result->ok = false;
            result->error = res.error.empty() ? L"Tải ảnh nền thất bại."
                                              : utf8_to_wide(res.error);
        } else {
            std::vector<unsigned char> bytes(res.body.begin(), res.body.end());
            result->ok = write_file_bytes(j->dir + L"\\" + j->file, bytes);
            if (!result->ok) result->error = L"Không ghi được tệp ảnh nền.";
        }
        HWND hwnd = j->hwnd;
        delete j;
        PostMessage(hwnd, WM_APP + 14, 0, reinterpret_cast<LPARAM>(result));
        return 0;
    }, job, 0, nullptr);
    if (thread) CloseHandle(thread);
}

void App::browse_java_exe() {
    OPENFILENAMEW ofn{};
    wchar_t file[MAX_PATH] = L"";
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = hwnd_;
    ofn.lpstrFilter = L"Java (java.exe)\0java.exe\0Tất cả tệp (*.*)\0*.*\0";
    ofn.lpstrFile = file;
    ofn.nMaxFile = MAX_PATH;
    ofn.lpstrTitle = L"Chọn java.exe";
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
    if (!GetOpenFileNameW(&ofn)) return;
    java_path_ = file;
    save_user_setting("javaPath", Json::string(wide_to_utf8(java_path_)));
    rebuild_settings();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::remove_java_dir(const std::wstring& dir) {
    std::wstring runtime = shared_dir_ + L"\\runtime\\";
    if (dir.rfind(runtime, 0) != 0) return;
    std::wstring copy = dir;
    HWND hwnd = hwnd_;
    HANDLE thread = CreateThread(nullptr, 0, +[](LPVOID param) -> DWORD {
        auto* job = reinterpret_cast<std::pair<HWND, std::wstring>*>(param);
        bool ok = remove_tree(job->second);
        HWND target = job->first;
        delete job;
        PostMessage(target, WM_APP + 15, ok ? 1 : 0, 0);
        return 0;
    }, new std::pair<HWND, std::wstring>(hwnd, copy), 0, nullptr);
    if (thread) CloseHandle(thread);
}

void App::load_java_state_async(bool refresh) {
    (void)refresh;
    if (java_loading_) return;
    java_loading_ = true;
    if (page_ == L"settings") rebuild_settings();
    HWND target = hwnd_;
    std::wstring shared = shared_dir_;
    HANDLE thread = CreateThread(nullptr, 0, +[](LPVOID param) -> DWORD {
        auto* job = reinterpret_cast<std::pair<HWND, std::wstring>*>(param);
        HWND hwnd = job->first;
        std::wstring shared = job->second;
        delete job;
        auto* state = new JavaState();
        std::wstring runtime = shared + L"\\runtime";
        std::wstring platform = runtime_platform();

        HttpResult res = http_request(
            L"https://launchermeta.mojang.com/v1/products/java-runtime/"
            L"2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json",
            L"GET");
        Json index;
        bool parsed = res.ok() && index.parse(res.body);
        const Json* platform_index = parsed ? index.find(wide_to_utf8(platform).c_str()) : nullptr;
        if (platform_index && platform_index->type == Json::Type::Object) {
            for (const auto& kv : platform_index->obj) {
                std::wstring component = utf8_to_wide(kv.first);
                if (component.find(L"minecraft-java-exe") != std::wstring::npos) continue;
                if (component.rfind(L"java-runtime", 0) != 0 && component != L"jre-legacy")
                    continue;
                if (kv.second.type != Json::Type::Array || kv.second.arr.empty()) continue;
                const Json& entry = kv.second.arr[0];
                ManagedJava row;
                row.component = component;
                if (const Json* version = entry.find("version")) {
                    row.name = utf8_to_wide(version->text("name"));
                    row.released = utf8_to_wide(version->text("released"));
                }
                row.major = leading_int(row.name);
                row.dir = runtime + L"\\" + component + L"-" + platform;
                row.java_path = row.dir + L"\\bin\\java.exe";
                row.installed = file_exists_w(row.java_path);
                if (row.installed) row.bytes = directory_size(row.dir);
                state->managed.push_back(std::move(row));
            }
        }
        if (state->managed.empty()) {
            struct Fallback { const wchar_t* component; const wchar_t* label; int major; };
            static const Fallback fallbacks[] = {
                { L"java-runtime-epsilon", L"26.x", 26 },
                { L"java-runtime-delta", L"21.x", 21 },
                { L"java-runtime-beta", L"17.x", 17 },
                { L"java-runtime-gamma", L"17.x", 17 },
                { L"jre-legacy", L"1.8", 8 },
            };
            for (const auto& fb : fallbacks) {
                ManagedJava row;
                row.component = fb.component;
                row.name = fb.label;
                row.major = fb.major;
                row.dir = runtime + L"\\" + row.component + L"-" + platform;
                row.java_path = row.dir + L"\\bin\\java.exe";
                row.installed = file_exists_w(row.java_path);
                if (row.installed) row.bytes = directory_size(row.dir);
                state->managed.push_back(std::move(row));
            }
        }
        std::sort(state->managed.begin(), state->managed.end(),
                  [](const ManagedJava& a, const ManagedJava& b) {
                      return a.major != b.major ? a.major > b.major : a.component < b.component;
                  });

        WIN32_FIND_DATAW data{};
        HANDLE find = FindFirstFileW((runtime + L"\\*").c_str(), &data);
        if (find != INVALID_HANDLE_VALUE) {
            do {
                if (!(data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
                std::wstring name = data.cFileName;
                if (name.rfind(L"zulu-", 0) != 0) continue;
                std::wstring dir = runtime + L"\\" + name;
                Json marker;
                marker.parse(read_file_utf8(dir + L"\\lunaspace-runtime.json"));
                if (marker.text("kind") != "zulu") continue;
                std::wstring java_path = find_java_in_tree(dir, 2);
                if (java_path.empty()) continue;
                ZuluJava row;
                row.dir = dir;
                row.java_path = java_path;
                row.major = int(marker.number("major", 0.0));
                int release_major = 0;
                std::wstring version = java_release_version(java_path, &release_major);
                std::string type = marker.text("packageType", "jre");
                std::string label = type == "jdk" ? "JDK" : "JRE";
                if (version.empty()) version = utf8_to_wide(marker.text("version"));
                row.name = L"Zulu " + widen(label) + L" " + (version.empty() ? name : version);
                row.bytes = directory_size(dir);
                state->zulu.push_back(std::move(row));
            } while (FindNextFileW(find, &data));
            FindClose(find);
        }
        std::sort(state->zulu.begin(), state->zulu.end(),
                  [](const ZuluJava& a, const ZuluJava& b) {
                      return a.major != b.major ? a.major > b.major : a.name < b.name;
                  });

        std::vector<std::wstring> seen;
        for (const auto& row : state->managed) seen.push_back(row.java_path);
        for (const auto& row : state->zulu) seen.push_back(row.java_path);
        std::vector<std::wstring> candidates;
        wchar_t env[MAX_PATH]{};
        if (GetEnvironmentVariableW(L"JAVA_HOME", env, MAX_PATH) > 0)
            candidates.push_back(std::wstring(env) + L"\\bin\\java.exe");
        candidates.push_back(L"C:\\Program Files\\Common Files\\Oracle\\Java\\javapath\\java.exe");
        candidates.push_back(L"C:\\ProgramData\\Oracle\\Java\\javapath\\java.exe");
        const wchar_t* hints[] = {
            L"C:\\Program Files\\Java",
            L"C:\\Program Files\\Eclipse Adoptium",
            L"C:\\Program Files\\Microsoft",
            L"C:\\Program Files\\Zulu",
            L"C:\\Program Files\\BellSoft",
            L"C:\\Program Files\\Amazon Corretto",
            L"C:\\Program Files\\Temurin",
            L"C:\\Program Files\\Common Files\\Oracle\\Java",
            L"C:\\Program Files (x86)\\Java",
            L"C:\\Program Files (x86)\\Eclipse Adoptium",
        };
        for (const wchar_t* hint : hints) {
            WIN32_FIND_DATAW entry{};
            HANDLE dir_find = FindFirstFileW((std::wstring(hint) + L"\\*").c_str(), &entry);
            if (dir_find == INVALID_HANDLE_VALUE) continue;
            do {
                if (!(entry.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
                if (wcscmp(entry.cFileName, L".") == 0 || wcscmp(entry.cFileName, L"..") == 0)
                    continue;
                std::wstring base = std::wstring(hint) + L"\\" + entry.cFileName;
                candidates.push_back(base + L"\\bin\\java.exe");
                WIN32_FIND_DATAW inner{};
                HANDLE inner_find = FindFirstFileW((base + L"\\*").c_str(), &inner);
                if (inner_find == INVALID_HANDLE_VALUE) continue;
                do {
                    if (!(inner.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
                    if (wcscmp(inner.cFileName, L".") == 0 ||
                        wcscmp(inner.cFileName, L"..") == 0)
                        continue;
                    candidates.push_back(base + L"\\" + inner.cFileName + L"\\bin\\java.exe");
                } while (FindNextFileW(inner_find, &inner));
                FindClose(inner_find);
            } while (FindNextFileW(dir_find, &entry));
            FindClose(dir_find);
        }
        wchar_t path_java[MAX_PATH]{};
        if (SearchPathW(nullptr, L"java.exe", nullptr, MAX_PATH, path_java, nullptr) > 0)
            candidates.push_back(path_java);

        for (const auto& candidate : candidates) {
            if (!file_exists_w(candidate)) continue;
            bool duplicate = false;
            for (const auto& used : seen)
                if (_wcsicmp(used.c_str(), candidate.c_str()) == 0) { duplicate = true; break; }
            if (duplicate) continue;
            seen.push_back(candidate);
            int major = 0;
            std::wstring version = java_release_version(candidate, &major);
            ExternalJava row;
            row.java_path = candidate;
            row.major = major;
            row.name = version.empty() ? candidate : L"Java " + version;
            state->external.push_back(std::move(row));
        }
        std::sort(state->external.begin(), state->external.end(),
                  [](const ExternalJava& a, const ExternalJava& b) { return a.major > b.major; });

        PostMessage(hwnd, WM_APP + 13, 0, reinterpret_cast<LPARAM>(state));
        return 0;
    }, new std::pair<HWND, std::wstring>(target, shared), 0, nullptr);
    if (thread) CloseHandle(thread);
}

void App::apply_java_state(JavaState* state) {
    if (!state) return;
    java_state_ = std::move(*state);
    delete state;
    java_loading_ = false;
    if (page_ == L"settings") {
        rebuild_settings();
        InvalidateRect(hwnd_, nullptr, FALSE);
    }
}

void App::apply_background_result(BgResult* result) {
    if (!result) return;
    bg_busy_.clear();
    settings_error_ = result->ok ? L"" : result->error;
    delete result;
    if (page_ == L"settings") {
        rebuild_settings();
        InvalidateRect(hwnd_, nullptr, FALSE);
    }
}

void App::layout_settings() {
    if (!settings_) return;
    Node* slot = ui_find(ui_.get(), L"settings-slot");
    if (!slot) return;
    settings_slot_rect_ = slot->rect;
    float view_w = slot->rect.right - slot->rect.left;
    if (view_w < 10.0f) return;
    float width = std::min(768.0f, view_w - 8.0f);
    ui_layout(settings_.get(), width, 100000.0f, renderer_);
    settings_content_h_ = 0.0f;
    for (auto& kid : settings_->kids)
        settings_content_h_ = std::max(settings_content_h_, node_max_bottom(kid.get()));
    float view_h = slot->rect.bottom - slot->rect.top;
    float max_scroll = std::max(0.0f, settings_content_h_ - view_h);
    settings_scroll_ = std::clamp(settings_scroll_, 0.0f, max_scroll);
    ui_move(settings_.get(), slot->rect.left + (view_w - width) * 0.5f,
            slot->rect.top - settings_scroll_ + 4.0f);
}

std::wstring App::instance_base_dir() const {
    return documents_dir() + L"\\LunarSpace\\instances";
}

std::vector<VersionInfo> App::versions_filtered() const {
    std::vector<VersionInfo> rows;
    std::wstring query = versions_query_;
    for (auto& ch : query) ch = wchar_t(towlower(ch));
    for (const auto& version : versions_all_) {
        if (!versions_snapshots_ && version.type != L"release") continue;
        if (!query.empty()) {
            std::wstring id = version.id;
            for (auto& ch : id) ch = wchar_t(towlower(ch));
            if (id.find(query) == std::wstring::npos) continue;
        }
        if (versions_loader_ != L"vanilla") {
            if (!loader_games_ready_ || loader_games_all_) continue;
            if (!loader_games_.count(version.id)) continue;
        }
        rows.push_back(version);
    }
    return rows;
}

void App::versions_pick_loader(const std::wstring& id) {
    versions_loader_ = id;
    versions_picker_ = false;
    versions_picked_.clear();
    versions_build_.clear();
    versions_error_.clear();
    versions_scroll_ = 0.0f;
    versions_aside_scroll_ = 0.0f;
    versions_visible_ = 50;
    versions_focus_ = 0;
    versions_menu_open_ = false;
    if (id != L"vanilla") {
        load_loader_games_async(id);
    } else {
        loader_games_loading_ = false;
        loader_games_ready_ = true;
        loader_games_all_ = true;
        loader_games_.clear();
    }
    rebuild_versions();
}

void App::versions_pick_game(const std::wstring& id) {
    versions_picked_ = id;
    versions_error_.clear();
    versions_build_.clear();
    versions_focus_ = 0;
    if (versions_loader_ != L"vanilla") {
        builds_.clear();
        builds_ready_ = false;
        builds_loading_ = true;
        builds_failed_ = false;
        load_loader_builds_async(versions_loader_, id);
    }
    rebuild_versions();
}

void App::layout_versions() {
    Node* slot = ui_find(ui_.get(), L"versions-slot");
    if (!slot) return;
    versions_slot_rect_ = slot->rect;
    float view_w = slot->rect.right - slot->rect.left;
    float view_h = slot->rect.bottom - slot->rect.top;
    if (view_w < 10.0f || view_h < 10.0f) return;

    if (versions_picker_) {
        float width = std::min(1024.0f, std::max(320.0f, view_w - 64.0f));
        if (std::fabs(width - versions_list_width_) > 1.0f) {
            versions_list_width_ = width;
            rebuild_versions();
        }
        versions_list_rect_ = versions_slot_rect_;
        versions_aside_rect_ = D2D1::RectF();
        if (!versions_ui_) return;
        ui_layout(versions_ui_.get(), width, 100000.0f, renderer_);
        versions_content_h_ = 0.0f;
        for (auto& kid : versions_ui_->kids)
            versions_content_h_ = std::max(versions_content_h_, node_max_bottom(kid.get()));
        float max_scroll = std::max(0.0f, versions_content_h_ - view_h + 40.0f);
        versions_scroll_ = std::clamp(versions_scroll_, 0.0f, max_scroll);
        ui_move(versions_ui_.get(), slot->rect.left + (view_w - width) * 0.5f,
                slot->rect.top + 20.0f - versions_scroll_);
        versions_mem_track_ = D2D1::RectF();
        versions_build_rect_ = D2D1::RectF();
        return;
    }

    float left_w = std::max(340.0f, view_w - 320.0f);
    float content_w = std::max(240.0f, left_w - 48.0f);
    if (std::fabs(content_w - versions_list_width_) > 1.0f) {
        versions_list_width_ = content_w;
        rebuild_versions();
    }
    versions_list_rect_ = D2D1::RectF(slot->rect.left, slot->rect.top,
                                      slot->rect.left + left_w, slot->rect.bottom);
    float aside_x = versions_list_rect_.right;
    if (versions_ui_) {
        ui_layout(versions_ui_.get(), content_w, 100000.0f, renderer_);
        versions_content_h_ = 0.0f;
        for (auto& kid : versions_ui_->kids)
            versions_content_h_ = std::max(versions_content_h_, node_max_bottom(kid.get()));
        float max_scroll = std::max(0.0f, versions_content_h_ - view_h + 40.0f);
        versions_scroll_ = std::clamp(versions_scroll_, 0.0f, max_scroll);
        ui_move(versions_ui_.get(), slot->rect.left + 24.0f, slot->rect.top + 16.0f - versions_scroll_);
    }
    float footer_h = 74.0f;
    versions_footer_rect_ = D2D1::RectF(aside_x, slot->rect.bottom - footer_h, slot->rect.right,
                                        slot->rect.bottom);
    if (versions_footer_) {
        float w = 320.0f - 40.0f;
        ui_layout(versions_footer_.get(), w, 100000.0f, renderer_);
        float h = 0.0f;
        for (auto& kid : versions_footer_->kids) h = std::max(h, node_max_bottom(kid.get()));
        footer_h = std::min(140.0f, std::max(74.0f, h + 24.0f));
        versions_footer_rect_ = D2D1::RectF(aside_x, slot->rect.bottom - footer_h,
                                            slot->rect.right, slot->rect.bottom);
        ui_move(versions_footer_.get(), aside_x + 20.0f,
                versions_footer_rect_.top + 14.0f);
    }
    versions_aside_rect_ = D2D1::RectF(aside_x, slot->rect.top, slot->rect.right,
                                       versions_footer_rect_.top);
    if (versions_aside_) {
        float w = 320.0f - 40.0f;
        ui_layout(versions_aside_.get(), w, 100000.0f, renderer_);
        versions_aside_content_h_ = 0.0f;
        for (auto& kid : versions_aside_->kids)
            versions_aside_content_h_ =
                std::max(versions_aside_content_h_, node_max_bottom(kid.get()));
        float aside_view = versions_aside_rect_.bottom - versions_aside_rect_.top;
        float max_scroll = std::max(0.0f, versions_aside_content_h_ - aside_view + 32.0f);
        versions_aside_scroll_ = std::clamp(versions_aside_scroll_, 0.0f, max_scroll);
        ui_move(versions_aside_.get(), aside_x + 20.0f,
                versions_aside_rect_.top + 16.0f - versions_aside_scroll_);
        if (Node* track = ui_find(versions_aside_.get(), L"versions-mem-track"))
            versions_mem_track_ = track->rect;
        if (Node* select = ui_find(versions_aside_.get(), L"versions-build-select"))
            versions_build_rect_ = select->rect;
    }
}

void App::rebuild_versions() {
    versions_menu_open_ = false;
    auto root = std::make_unique<Node>();
    root->kind = Kind::Column;
    root->style.gap = 12.0f;

    auto text = [&](const std::wstring& value, float size, int weight, Color color,
                    float width = -1.0f, bool mono = false, bool wrap = false) {
        auto node = std::make_unique<Node>();
        node->kind = Kind::Text;
        node->text = value;
        node->style.font_size = size;
        node->style.weight = weight;
        node->style.color = color;
        node->style.mono = mono;
        node->style.wrap = wrap;
        if (width > 0.0f) node->style.width = width;
        return node;
    };
    auto image = [&](const std::wstring& src, float width, float height, float radius = 0.0f,
                     Color color = Color{}) {
        auto node = std::make_unique<Node>();
        node->kind = Kind::Image;
        node->src = src;
        node->style.width = width;
        node->style.height = height;
        node->style.radius = radius;
        if (color.visible()) node->style.color = color;
        return node;
    };
    auto spacer = [&](float width, float height, bool grow_x = false) {
        auto node = std::make_unique<Node>();
        node->kind = Kind::Spacer;
        node->style.width = width;
        node->style.height = height;
        node->style.grow_x = grow_x;
        return node;
    };
    auto box = [&](Kind kind, float height = -1.0f, float gap = 0.0f) {
        auto node = std::make_unique<Node>();
        node->kind = kind;
        node->style.height = height;
        node->style.gap = gap;
        return node;
    };
    auto card = [&](float height) {
        auto node = box(Kind::Column, height, 8.0f);
        node->style.bg = ui_token(L"surface");
        node->style.border = true;
        node->style.border_color = ui_token(L"border");
        node->style.radius = 12.0f;
        node->style.glass = true;
        return node;
    };
    auto tag = [&](const std::wstring& label, Color bg, Color fg) {
        auto node = box(Kind::Row, 16.0f);
        node->style.pad_l = node->style.pad_r = 5.0f;
        node->style.radius = 4.0f;
        node->style.bg = bg;
        node->kids.push_back(text(label, 8.5f, 700, fg, -1.0f, true));
        return node;
    };
    auto toggle = [&](bool on, const std::wstring& action) {
        auto node = box(Kind::Row, 20.0f);
        node->style.width = 36.0f;
        node->style.radius = 10.0f;
        node->style.bg = on ? ui_token(L"accent") : ui_token(L"input");
        if (!on) {
            node->style.border = true;
            node->style.border_color = ui_token(L"border");
        }
        node->style.pad_l = node->style.pad_r = 2.0f;
        node->action = action;
        auto knob = spacer(16.0f, 16.0f);
        knob->style.radius = 8.0f;
        knob->style.bg = on ? Color::rgb(0xFFFFFF) : ui_token(L"label");
        if (on) {
            node->kids.push_back(spacer(0, 0, true));
            node->kids.push_back(std::move(knob));
        } else {
            node->kids.push_back(std::move(knob));
            node->kids.push_back(spacer(0, 0, true));
        }
        return node;
    };
    auto button = [&](const std::wstring& label, const std::wstring& action, bool primary,
                      float height = 28.0f) {
        auto node = box(Kind::Row, height);
        node->style.pad_l = node->style.pad_r = 10.0f;
        node->style.radius = 8.0f;
        node->style.bg = primary ? ui_token(L"accent") : ui_token(L"input");
        if (!primary) {
            node->style.border = true;
            node->style.border_color = ui_token(L"border");
        }
        node->action = action;
        node->kids.push_back(spacer(0, 0, true));
        node->kids.push_back(text(label, 10.0f, 600,
                                  primary ? ui_token(L"ink") : ui_token(L"label")));
        node->kids.push_back(spacer(0, 0, true));
        return node;
    };
    auto field_label = [&](const std::wstring& label) {
        return text(upper_text(label), 9.5f, 600, ui_token(L"faint"));
    };

    float content_w = versions_list_width_ > 40.0f ? versions_list_width_ : 880.0f;

    if (versions_picker_) {
        auto head = box(Kind::Row, 46.0f);
        auto head_info = box(Kind::Column, -1.0f, 3.0f);
        head_info->style.grow_x = true;
        head_info->kids.push_back(text(L"Chọn loader", 18.0f, 700, ui_token(L"text")));
        head_info->kids.push_back(text(
            L"Chọn loại loader trước, sau đó chọn phiên bản Minecraft và cấu hình instance.",
            11.0f, 400, ui_token(L"faint"), content_w - 160.0f, false, true));
        head->kids.push_back(std::move(head_info));
        head->kids.push_back(spacer(0, 0, true));
        head->kids.push_back(text(L"Bước 1 / 2", 10.0f, 400, ui_token(L"faint"), -1.0f, true));
        root->kids.push_back(std::move(head));

        float gap = 12.0f;
        int cols = std::max(1, int((content_w + gap) / (250.0f + gap)));
        int total = int(loaders_.size());
        if (cols > total) cols = std::max(1, total);
        float card_w = (content_w - gap * float(cols - 1)) / float(cols);
        size_t index = 0;
        while (index < loaders_.size()) {
            auto row = box(Kind::Row, 136.0f, gap);
            for (int c = 0; c < cols && index < loaders_.size(); ++c, ++index) {
                const LoaderInfo& loader = loaders_[index];
                auto node = card(136.0f);
                node->style.width = card_w;
                node->style.pad_l = node->style.pad_r = 16.0f;
                node->style.pad_t = node->style.pad_b = 16.0f;
                node->style.gap = 14.0f;
                node->style.radius = 16.0f;
                node->action = L"versions:loader:" + loader.id;
                auto top = box(Kind::Row, 56.0f, 12.0f);
                auto icon = box(Kind::Row, 56.0f);
                icon->style.width = 56.0f;
                icon->style.radius = 16.0f;
                icon->style.bg = ui_token(L"input");
                icon->style.border = true;
                icon->style.border_color = ui_token(L"border");
                icon->kids.push_back(spacer(0, 0, true));
                icon->kids.push_back(image(asset(loader_icon_path(loader.id)), 36.0f, 36.0f));
                icon->kids.push_back(spacer(0, 0, true));
                top->kids.push_back(std::move(icon));
                auto info = box(Kind::Column, -1.0f, 3.0f);
                info->style.grow_x = true;
                auto name_row = box(Kind::Row, -1.0f, 6.0f);
                name_row->kids.push_back(text(loader.name, 14.0f, 700, ui_token(L"text")));
                if (loader.id == L"lunar") {
                    auto chip = box(Kind::Row, 16.0f);
                    chip->style.pad_l = chip->style.pad_r = 5.0f;
                    chip->style.radius = 4.0f;
                    chip->style.bg = ui_token(L"input");
                    chip->style.border = true;
                    chip->style.border_color = ui_token(L"border");
                    chip->kids.push_back(text(L"KHUYẾN NGHỊ", 8.0f, 700, ui_token(L"label"),
                                              -1.0f, true));
                    name_row->kids.push_back(std::move(chip));
                }
                info->kids.push_back(std::move(name_row));
                info->kids.push_back(text(loader.desc, 10.0f, 400, ui_token(L"faint"),
                                          card_w - 110.0f));
                top->kids.push_back(std::move(info));
                node->kids.push_back(std::move(top));
                auto footer = box(Kind::Row, 16.0f, 6.0f);
                footer->kids.push_back(text(
                    loader.vanilla ? L"KHÔNG MOD" : L"HỖ TRỢ MOD", 9.0f, 400,
                    ui_token(L"label"), -1.0f, true));
                footer->kids.push_back(spacer(0, 0, true));
                footer->kids.push_back(text(L"Chọn →", 10.0f, 700, ui_token(L"accent")));
                node->kids.push_back(std::move(footer));
                row->kids.push_back(std::move(node));
            }
            root->kids.push_back(std::move(row));
        }
        root->kids.push_back(text(
            L"Có thể đổi loader sau ở cột bên phải. LunarLoader đi kèm shaderpack, HUD client và "
            L"renderer tối ưu.",
            10.0f, 400, ui_token(L"faint"), content_w, false, true));
        versions_ui_ = std::move(root);
        versions_aside_.reset();
        versions_footer_.reset();
        return;
    }

    // ── Step 2: version list (left) ────────────────────────────────────────
    auto search = box(Kind::Row, 36.0f, 8.0f);
    search->style.width = std::min(384.0f, content_w * 0.62f);
    search->style.radius = 8.0f;
    search->style.bg = ui_token(L"input");
    search->style.border = true;
    search->style.border_color = ui_token(L"border");
    search->style.pad_l = search->style.pad_r = 10.0f;
    search->action = L"versions:focus-query";
    search->kids.push_back(image(asset(L"assets/icons/magnifying-glass.svg"), 14.0f, 14.0f, 0.0f,
                                 ui_token(L"label")));
    auto query_text = text(versions_query_.empty() ? L"Tìm phiên bản…" : versions_query_, 12.0f,
                           500, versions_query_.empty() ? ui_token(L"faint") : ui_token(L"text"));
    query_text->id = L"versions-query-text";
    query_text->style.mono = false;
    search->kids.push_back(std::move(query_text));
    root->kids.push_back(std::move(search));

    std::vector<VersionInfo> filtered = versions_filtered();
    auto meta_row = box(Kind::Row, 16.0f, 8.0f);
    meta_row->kids.push_back(text(std::to_wstring(filtered.size()) + L" kết quả", 10.0f, 400,
                                  ui_token(L"faint"), -1.0f, true));
    if (versions_loader_ != L"vanilla") {
        std::wstring hint;
        Color hint_color = ui_token(L"faint");
        if (loader_games_loading_) {
            hint = L"đang kiểm tra hỗ trợ…";
        } else if (!loader_games_ready_) {
            hint = L"không đọc được danh sách hỗ trợ";
            hint_color = Color::rgb(0xF87171);
        } else {
            hint = loader_name(versions_loader_) + L" hỗ trợ " +
                   std::to_wstring(loader_games_.size()) + L" phiên bản";
            hint_color = ui_token(L"accent");
        }
        meta_row->kids.push_back(text(hint, 10.0f, 400, hint_color, -1.0f, true));
    }
    root->kids.push_back(std::move(meta_row));

    if (versions_all_.empty() && !versions_manifest_ready_) {
        root->kids.push_back(text(L"Đang tải danh sách phiên bản…", 12.0f, 500,
                                  ui_token(L"label"), content_w, false, true));
    } else if (versions_loader_ != L"vanilla" && loader_games_loading_) {
        root->kids.push_back(text(L"Đang kiểm tra phiên bản được hỗ trợ…", 12.0f, 500,
                                  ui_token(L"label"), content_w, false, true));
    } else {
        int show = std::min(int(filtered.size()), versions_visible_);
        float gap = 12.0f;
        int cols = std::max(1, int((content_w + gap) / (190.0f + gap)));
        if (cols > show) cols = std::max(1, show);
        float card_w = (content_w - gap * float(cols - 1)) / float(cols);
        size_t index = 0;
        while (index < size_t(show)) {
            auto row = box(Kind::Row, 106.0f, gap);
            for (int c = 0; c < cols && index < size_t(show); ++c, ++index) {
                const VersionInfo& version = filtered[index];
                bool active = version.id == versions_picked_;
                auto node = card(106.0f);
                node->style.width = card_w;
                node->style.pad_l = node->style.pad_r = 12.0f;
                node->style.pad_t = node->style.pad_b = 12.0f;
                node->style.gap = 8.0f;
                node->style.bg = active ? Color::rgb(0xE9B872, 0.12f) : ui_token(L"surface");
                node->style.border_color = active ? Color::rgb(0xE9B872, 0.5f)
                                                  : ui_token(L"border");
                node->style.glass = !active;
                node->action = L"versions:pick:" + version.id;
                auto top = box(Kind::Row, 36.0f, 10.0f);
                auto icon = box(Kind::Row, 36.0f);
                icon->style.width = 36.0f;
                icon->style.radius = 8.0f;
                icon->style.bg = ui_token(L"input");
                icon->style.border = true;
                icon->style.border_color = ui_token(L"border");
                icon->kids.push_back(spacer(0, 0, true));
                icon->kids.push_back(image(asset(loader_icon_path(versions_loader_)), 24.0f,
                                           24.0f));
                icon->kids.push_back(spacer(0, 0, true));
                top->kids.push_back(std::move(icon));
                top->kids.push_back(text(version.id, 12.5f, 700,
                                         active ? ui_token(L"accent") : ui_token(L"text"), -1.0f,
                                         true));
                top->kids.push_back(spacer(0, 0, true));
                if (active)
                    top->kids.push_back(image(asset(L"assets/icons/check.svg"), 14.0f, 14.0f,
                                              0.0f, ui_token(L"accent")));
                node->kids.push_back(std::move(top));
                auto tags = box(Kind::Row, 16.0f, 6.0f);
                bool release = version.type == L"release";
                tags->kids.push_back(tag(release ? L"BẢN PHÁT HÀNH" : L"BẢN THỬ NGHIỆM",
                                         release ? Color::rgb(0x22C55E, 0.14f)
                                                 : Color::rgb(0xEAB308, 0.14f),
                                         release ? Color::rgb(0x22C55E)
                                                 : Color::rgb(0xEAB308)));
                if (version.id == latest_release_)
                    tags->kids.push_back(tag(L"LATEST", Color::rgb(0xE9B872, 0.16f),
                                             ui_token(L"accent")));
                node->kids.push_back(std::move(tags));
                node->kids.push_back(text(iso_date(version.release_time), 10.0f, 400,
                                          ui_token(L"faint"), -1.0f, true));
                row->kids.push_back(std::move(node));
            }
            root->kids.push_back(std::move(row));
        }
        if (filtered.empty() && !versions_query_.empty()) {
            root->kids.push_back(text(L"Không có phiên bản nào khớp.", 11.0f, 400,
                                      ui_token(L"faint"), content_w));
        }
        if (int(filtered.size()) > versions_visible_) {
            auto more = button(L"Hiện thêm (" +
                                   std::to_wstring(int(filtered.size()) - versions_visible_) +
                                   L")",
                               L"versions:more", false, 36.0f);
            more->style.width = content_w;
            root->kids.push_back(std::move(more));
        }
    }
    versions_ui_ = std::move(root);

    // ── Aside: create form ────────────────────────────────────────────────
    const float aside_w = 280.0f;
    auto aside = std::make_unique<Node>();
    aside->kind = Kind::Column;
    aside->style.gap = 12.0f;

    auto heading = box(Kind::Row, 34.0f, 8.0f);
    heading->kids.push_back(image(asset(loader_icon_path(versions_loader_)), 28.0f, 28.0f, 7.0f));
    auto heading_text = box(Kind::Column, -1.0f, 1.0f);
    heading_text->style.grow_x = true;
    heading_text->kids.push_back(text(L"Tạo phiên bản", 12.0f, 700, ui_token(L"text")));
    heading_text->kids.push_back(text(L"Chọn loader và phiên bản", 10.0f, 400,
                                      ui_token(L"faint"), 150.0f, false, true));
    heading->kids.push_back(std::move(heading_text));
    auto change = box(Kind::Row, 26.0f);
    change->style.pad_l = change->style.pad_r = 8.0f;
    change->style.radius = 8.0f;
    change->style.bg = ui_token(L"input");
    change->style.border = true;
    change->style.border_color = ui_token(L"border");
    change->action = L"versions:change-loader";
    change->kids.push_back(text(L"Đổi loader", 10.0f, 600, ui_token(L"label")));
    heading->kids.push_back(std::move(change));
    aside->kids.push_back(std::move(heading));

    auto loader_row = box(Kind::Row, 32.0f, 8.0f);
    loader_row->style.pad_l = loader_row->style.pad_r = 10.0f;
    loader_row->style.radius = 8.0f;
    loader_row->style.bg = ui_token(L"input");
    loader_row->style.border = true;
    loader_row->style.border_color = ui_token(L"border");
    loader_row->kids.push_back(image(asset(loader_icon_path(versions_loader_)), 20.0f, 20.0f,
                                     5.0f));
    loader_row->kids.push_back(text(loader_name(versions_loader_), 11.0f, 700,
                                    ui_token(L"accent")));
    std::wstring loader_desc;
    for (const auto& loader : loaders_)
        if (loader.id == versions_loader_) loader_desc = loader.desc;
    loader_row->kids.push_back(text(loader_desc, 9.0f, 400, ui_token(L"faint"), 150.0f));
    aside->kids.push_back(std::move(loader_row));

    if (versions_loader_ != L"vanilla") {
        auto block = box(Kind::Column, -1.0f, 6.0f);
        block->kids.push_back(field_label(L"Bản build loader"));
        if (versions_picked_.empty()) {
            block->kids.push_back(text(L"Chọn phiên bản game trước.", 10.0f, 400,
                                       ui_token(L"faint")));
        } else if (builds_loading_) {
            auto loading = box(Kind::Row, 30.0f, 6.0f);
            loading->kids.push_back(image(asset(L"assets/icons/arrows-clockwise.svg"), 12.0f,
                                          12.0f, 0.0f, ui_token(L"label")));
            loading->kids.push_back(text(L"Đang tải build…", 10.0f, 400, ui_token(L"label")));
            block->kids.push_back(std::move(loading));
        } else if (!builds_.empty()) {
            auto select = box(Kind::Row, 34.0f, 6.0f);
            select->id = L"versions-build-select";
            select->style.pad_l = select->style.pad_r = 10.0f;
            select->style.radius = 8.0f;
            select->style.bg = ui_token(L"input");
            select->style.border = true;
            select->style.border_color = ui_token(L"border");
            select->action = L"versions:build-menu";
            select->kids.push_back(text(versions_build_, 11.0f, 700, ui_token(L"text"),
                                        -1.0f, true));
            select->kids.push_back(spacer(0, 0, true));
            for (const auto& build : builds_) {
                if (build.version != versions_build_) continue;
                if (build.latest) select->kids.push_back(tag(L"LATEST", Color::rgb(0xE9B872, 0.16f), ui_token(L"accent")));
                select->kids.push_back(tag(build.beta ? L"THỬ NGHIỆM" : L"ỔN ĐỊNH",
                                           build.beta ? Color::rgb(0xEAB308, 0.16f)
                                                      : Color::rgb(0x22C55E, 0.14f),
                                           build.beta ? Color::rgb(0xEAB308)
                                                      : Color::rgb(0x22C55E)));
                break;
            }
            block->kids.push_back(std::move(select));
        } else if (builds_failed_) {
            block->kids.push_back(text(L"Không tải được danh sách build.", 10.0f, 500,
                                       Color::rgb(0xF87171)));
        } else if (builds_ready_) {
            block->kids.push_back(text(loader_name(versions_loader_) +
                                           L" không có bản build cho Minecraft " +
                                           versions_picked_ + L".",
                                       10.0f, 600, Color::rgb(0xF87171), aside_w, false, true));
            block->kids.push_back(text(
                L"Loader này không phát hành cho phiên bản game đó. Chọn phiên bản khác.",
                10.0f, 400, ui_token(L"faint"), aside_w, false, true));
        }
        aside->kids.push_back(std::move(block));
    }

    auto picked_block = box(Kind::Column, -1.0f, 6.0f);
    picked_block->kids.push_back(field_label(L"Chọn phiên bản"));
    auto picked_box = box(Kind::Row, 34.0f);
    picked_box->style.pad_l = picked_box->style.pad_r = 10.0f;
    picked_box->style.radius = 8.0f;
    picked_box->style.bg = ui_token(L"input");
    picked_box->style.border = true;
    picked_box->style.border_color = ui_token(L"border");
    picked_box->kids.push_back(text(versions_picked_.empty() ? L"chưa chọn" : versions_picked_,
                                    11.0f, 700,
                                    versions_picked_.empty() ? ui_token(L"faint")
                                                             : ui_token(L"accent"),
                                    -1.0f, true));
    picked_block->kids.push_back(std::move(picked_box));
    aside->kids.push_back(std::move(picked_block));

    auto name_block = box(Kind::Column, -1.0f, 6.0f);
    name_block->kids.push_back(field_label(L"Tên phiên bản"));
    auto name_box = box(Kind::Row, 36.0f);
    name_box->style.pad_l = name_box->style.pad_r = 10.0f;
    name_box->style.radius = 8.0f;
    name_box->style.bg = ui_token(L"input");
    name_box->style.border = true;
    name_box->style.border_color = ui_token(L"border");
    name_box->action = L"versions:focus-name";
    std::wstring name_shown = versions_name_;
    if (name_shown.empty()) {
        name_shown = versions_picked_.empty()
                         ? L"my-instance"
                         : loader_name(versions_loader_) + L" " + versions_picked_;
    }
    auto name_text = text(name_shown, 11.0f, 500,
                          versions_name_.empty() ? ui_token(L"faint") : ui_token(L"text"),
                          aside_w - 20.0f, false, true);
    name_text->id = L"versions-name-text";
    name_box->kids.push_back(std::move(name_text));
    name_block->kids.push_back(std::move(name_box));
    aside->kids.push_back(std::move(name_block));

    std::wstring label_name = versions_name_;
    if (label_name.empty())
        label_name = versions_picked_.empty() ? L"instance"
                                              : loader_name(versions_loader_) + L" " + versions_picked_;
    std::wstring target_dir = versions_dir_.empty()
                                  ? instance_base_dir() + L"\\" + instance_slug(label_name)
                                  : versions_dir_;
    auto dir_block = box(Kind::Column, -1.0f, 6.0f);
    dir_block->kids.push_back(field_label(L"Thư mục lưu instance"));
    auto dir_row = box(Kind::Row, 36.0f, 6.0f);
    auto dir_box = box(Kind::Row, 36.0f);
    dir_box->style.grow_x = true;
    dir_box->style.pad_l = dir_box->style.pad_r = 10.0f;
    dir_box->style.radius = 8.0f;
    dir_box->style.bg = ui_token(L"input");
    dir_box->style.border = true;
    dir_box->style.border_color = ui_token(L"border");
    dir_box->kids.push_back(text(target_dir, 9.5f, 400, ui_token(L"label"), aside_w - 70.0f,
                                 true));
    dir_row->kids.push_back(std::move(dir_box));
    auto browse = box(Kind::Row, 36.0f);
    browse->style.width = 36.0f;
    browse->style.radius = 8.0f;
    browse->style.bg = ui_token(L"input");
    browse->style.border = true;
    browse->style.border_color = ui_token(L"border");
    browse->action = L"versions:dir";
    browse->kids.push_back(spacer(0, 0, true));
    browse->kids.push_back(image(asset(L"assets/icons/folder-open.svg"), 14.0f, 14.0f, 0.0f,
                                 ui_token(L"label")));
    browse->kids.push_back(spacer(0, 0, true));
    dir_row->kids.push_back(std::move(browse));
    dir_block->kids.push_back(std::move(dir_row));
    aside->kids.push_back(std::move(dir_block));

    auto mem_block = box(Kind::Column, -1.0f, 6.0f);
    mem_block->kids.push_back(
        field_label(L"Bộ nhớ cấp cho game · " + std::to_wstring(versions_memory_) + L" MB"));
    auto track = spacer(0.0f, 18.0f, true);
    track->id = L"versions-mem-track";
    mem_block->kids.push_back(std::move(track));
    auto mem_steps = box(Kind::Row, 24.0f, 4.0f);
    const int steps[5] = { 1024, 2048, 3072, 4096, 6144 };
    for (int step : steps) {
        auto chip = box(Kind::Row, 24.0f);
        chip->style.grow = 1.0f;
        chip->style.grow_x = true;
        chip->style.radius = 6.0f;
        chip->style.bg = versions_memory_ == step ? Color::rgb(0xE9B872, 0.16f)
                                                  : ui_token(L"input");
        chip->action = L"versions:mem:" + std::to_wstring(step);
        chip->kids.push_back(spacer(0, 0, true));
        chip->kids.push_back(text(std::to_wstring(step / 1024) + L"G", 9.0f, 500,
                                  versions_memory_ == step ? ui_token(L"accent")
                                                           : ui_token(L"faint"),
                                  -1.0f, true));
        chip->kids.push_back(spacer(0, 0, true));
        mem_steps->kids.push_back(std::move(chip));
    }
    mem_block->kids.push_back(std::move(mem_steps));
    aside->kids.push_back(std::move(mem_block));

    auto player_block = box(Kind::Column, -1.0f, 6.0f);
    player_block->kids.push_back(field_label(L"Người chơi"));
    auto player_row = box(Kind::Row, 36.0f, 8.0f);
    player_row->style.pad_l = player_row->style.pad_r = 10.0f;
    player_row->style.radius = 8.0f;
    player_row->style.bg = ui_token(L"input");
    player_row->style.border = true;
    player_row->style.border_color = ui_token(L"border");
    const Account* account = active_account();
    if (account) {
        std::wstring head = account_head(account->name);
        if (!head.empty())
            player_row->kids.push_back(image(head, 20.0f, 20.0f, 5.0f));
        player_row->kids.push_back(text(account->name, 11.0f, 500, ui_token(L"text"),
                                        aside_w - 110.0f));
        player_row->kids.push_back(spacer(0, 0, true));
        auto change_account = box(Kind::Row, 20.0f);
        change_account->action = L"nav:accounts";
        change_account->kids.push_back(text(L"Đổi", 10.0f, 600, ui_token(L"accent")));
        player_row->kids.push_back(std::move(change_account));
    } else {
        player_row->kids.push_back(text(L"Chưa có tài khoản — game sẽ dùng tên “Player”.",
                                        9.5f, 400, Color::rgb(0xF5B84B), aside_w - 110.0f,
                                        false, true));
        player_row->kids.push_back(spacer(0, 0, true));
        auto add = box(Kind::Row, 20.0f);
        add->action = L"nav:accounts";
        add->kids.push_back(text(L"Thêm tài khoản", 10.0f, 600, ui_token(L"accent")));
        player_row->kids.push_back(std::move(add));
    }
    player_block->kids.push_back(std::move(player_row));
    aside->kids.push_back(std::move(player_block));

    auto demo_row = box(Kind::Row, 46.0f, 10.0f);
    demo_row->style.pad_l = demo_row->style.pad_r = 10.0f;
    demo_row->style.pad_t = demo_row->style.pad_b = 8.0f;
    demo_row->style.radius = 8.0f;
    demo_row->style.bg = versions_demo_ ? Color::rgb(0xE9B872, 0.10f) : ui_token(L"input");
    demo_row->style.border = true;
    demo_row->style.border_color =
        versions_demo_ ? Color::rgb(0xE9B872, 0.42f) : ui_token(L"border");
    demo_row->kids.push_back(image(asset(L"assets/icons/play-circle.svg"), 14.0f, 14.0f, 0.0f,
                                   versions_demo_ ? ui_token(L"accent") : ui_token(L"faint")));
    auto demo_text = box(Kind::Column, -1.0f, 1.0f);
    demo_text->style.grow_x = true;
    demo_text->kids.push_back(text(L"Chơi thử (Demo)", 11.0f, 600,
                                   versions_demo_ ? ui_token(L"accent") : ui_token(L"text")));
    demo_text->kids.push_back(text(
        L"Tạo phiên bản ở chế độ chơi thử: kèm cờ --demo, thế giới giới hạn 5 ngày trong game "
        L"và không vào được máy chủ.",
        9.0f, 400, ui_token(L"faint"), aside_w - 120.0f, false, true));
    demo_row->kids.push_back(std::move(demo_text));
    demo_row->kids.push_back(toggle(versions_demo_, L"versions:demo"));
    aside->kids.push_back(std::move(demo_row));

    aside->kids.push_back(text(
        L"Tài nguyên gốc (client jar, thư viện, assets) tải vào thư mục dùng chung và tái sử dụng "
        L"cho mọi phiên bản.",
        9.0f, 400, ui_token(L"faint"), aside_w, false, true));
    versions_aside_ = std::move(aside);

    auto footer = std::make_unique<Node>();
    footer->kind = Kind::Column;
    footer->style.gap = 8.0f;
    if (!versions_error_.empty()) {
        auto error_row = box(Kind::Row, -1.0f, 8.0f);
        error_row->style.pad_l = error_row->style.pad_r = 10.0f;
        error_row->style.pad_t = error_row->style.pad_b = 8.0f;
        error_row->style.radius = 8.0f;
        error_row->style.bg = Color::rgb(0xF87171, 0.10f);
        error_row->style.border = true;
        error_row->style.border_color = Color::rgb(0xF87171, 0.28f);
        error_row->kids.push_back(image(asset(L"assets/icons/warning-circle.svg"), 13.0f, 13.0f,
                                        0.0f, Color::rgb(0xF87171)));
        error_row->kids.push_back(text(versions_error_, 10.0f, 400, Color::rgb(0xF87171),
                                       aside_w - 70.0f, false, true));
        footer->kids.push_back(std::move(error_row));
    }
    auto create = box(Kind::Row, 40.0f);
    create->style.radius = 8.0f;
    create->style.bg = ui_token(L"accent");
    create->action = L"versions:create";
    create->kids.push_back(spacer(0, 0, true));
    create->kids.push_back(text(L"Tạo phiên bản", 12.0f, 700, ui_token(L"ink")));
    create->kids.push_back(spacer(0, 0, true));
    footer->kids.push_back(std::move(create));
    versions_footer_ = std::move(footer);
}

void App::versions_open_build_menu() {
    if (builds_.empty()) return;
    float width = versions_build_rect_.right - versions_build_rect_.left;
    if (width < 120.0f) width = 220.0f;
    int rows = int(builds_.size());
    float row_h = 32.0f;
    float menu_h = std::min(float(rows) * row_h + 8.0f, 10.0f * row_h + 8.0f);
    float top = versions_build_rect_.bottom + 4.0f;
    if (top + menu_h > versions_slot_rect_.bottom - 6.0f)
        top = versions_build_rect_.top - 4.0f - menu_h;
    if (top < versions_slot_rect_.top + 6.0f) top = versions_slot_rect_.top + 6.0f;
    versions_menu_rect_ = D2D1::RectF(versions_build_rect_.left, top,
                                      versions_build_rect_.left + width, top + menu_h);

    auto menu = std::make_unique<Node>();
    menu->kind = Kind::Column;
    menu->style.gap = 2.0f;
    menu->style.pad_l = menu->style.pad_r = 4.0f;
    menu->style.pad_t = menu->style.pad_b = 4.0f;
    menu->style.radius = 10.0f;
    menu->style.bg = theme_locked_ ? Color::rgb(0x13171F) : ui_token(L"surface");
    menu->style.border = true;
    menu->style.border_color = ui_token(L"border");
    for (size_t i = 0; i < builds_.size(); ++i) {
        const LoaderBuild& build = builds_[i];
        auto row = std::make_unique<Node>();
        row->kind = Kind::Row;
        row->style.height = 30.0f;
        row->style.gap = 6.0f;
        row->style.pad_l = row->style.pad_r = 8.0f;
        row->style.radius = 6.0f;
        row->style.hover_bg = ui_token(L"hover");
        row->action = L"versions:build:" + std::to_wstring(i);
        auto label = std::make_unique<Node>();
        label->kind = Kind::Text;
        label->text = build.version;
        label->style.font_size = 11.0f;
        label->style.weight = 700;
        label->style.mono = true;
        label->style.color = build.version == versions_build_ ? ui_token(L"accent")
                                                              : ui_token(L"text");
        row->kids.push_back(std::move(label));
        auto grow = std::make_unique<Node>();
        grow->kind = Kind::Spacer;
        grow->style.grow_x = true;
        grow->style.grow = 1.0f;
        row->kids.push_back(std::move(grow));
        auto add_tag = [&](const std::wstring& label_text, Color bg, Color fg) {
            auto chip = std::make_unique<Node>();
            chip->kind = Kind::Row;
            chip->style.height = 15.0f;
            chip->style.pad_l = chip->style.pad_r = 4.0f;
            chip->style.radius = 3.0f;
            chip->style.bg = bg;
            auto chip_text = std::make_unique<Node>();
            chip_text->kind = Kind::Text;
            chip_text->text = label_text;
            chip_text->style.font_size = 8.0f;
            chip_text->style.weight = 700;
            chip_text->style.mono = true;
            chip_text->style.color = fg;
            chip->kids.push_back(std::move(chip_text));
            row->kids.push_back(std::move(chip));
        };
        if (build.latest && build.stable)
            add_tag(L"LATEST", Color::rgb(0xE9B872, 0.16f), ui_token(L"accent"));
        add_tag(build.beta ? L"THỬ NGHIỆM" : L"ỔN ĐỊNH",
                build.beta ? Color::rgb(0xEAB308, 0.16f) : Color::rgb(0x22C55E, 0.14f),
                build.beta ? Color::rgb(0xEAB308) : Color::rgb(0x22C55E));
        menu->kids.push_back(std::move(row));
    }
    versions_menu_ = std::move(menu);
    versions_menu_open_ = true;
    float total_h = float(builds_.size()) * row_h + 8.0f;
    float max_scroll = std::max(0.0f, total_h - menu_h);
    versions_menu_scroll_ = 0.0f;
    for (size_t i = 0; i < builds_.size(); ++i) {
        if (builds_[i].version == versions_build_) {
            versions_menu_scroll_ =
                std::clamp(float(i) * row_h - 2.0f * row_h, 0.0f, max_scroll);
            break;
        }
    }
    dirty_ = true;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::versions_close_build_menu() {
    if (!versions_menu_open_) return;
    versions_menu_open_ = false;
    versions_menu_.reset();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::draw_versions_popup() {
    if (!versions_menu_open_ || !versions_menu_) return;
    float width = versions_menu_rect_.right - versions_menu_rect_.left;
    ui_layout(versions_menu_.get(), width, 100000.0f, renderer_);
    ui_move(versions_menu_.get(), versions_menu_rect_.left,
            versions_menu_rect_.top - versions_menu_scroll_);
    renderer_.clip_push(versions_menu_rect_);
    ui_draw(versions_menu_.get(), renderer_, hovered_);
    renderer_.clip_pop();
}

void App::versions_memory_from_x(float x) {
    float left = versions_mem_track_.left;
    float right = versions_mem_track_.right;
    if (right - left < 10.0f) return;
    float ratio = std::clamp((x - left) / (right - left), 0.0f, 1.0f);
    int value = int(std::lround((1024.0f + ratio * float(16384 - 1024)) / 512.0f)) * 512;
    value = std::clamp(value, 1024, 16384);
    if (value == versions_memory_) return;
    versions_memory_ = value;
    rebuild_versions();
    dirty_ = true;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::versions_browse_dir() {
    BROWSEINFOW info{};
    info.lpszTitle = L"Chọn thư mục lưu instance";
    info.ulFlags = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE | BIF_USENEWUI;
    PIDLIST_ABSOLUTE pidl = SHBrowseForFolderW(&info);
    if (!pidl) return;
    wchar_t path[MAX_PATH]{};
    if (SHGetPathFromIDListW(pidl, path)) versions_dir_ = path;
    CoTaskMemFree(pidl);
    rebuild_versions();
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::versions_create_instance() {
    versions_error_.clear();
    if (versions_loader_.empty()) {
        versions_error_ = L"Chưa chọn loader.";
    } else if (versions_picked_.empty()) {
        versions_error_ = L"Chưa chọn phiên bản game.";
    } else if (versions_loader_ != L"vanilla" && versions_build_.empty()) {
        versions_error_ = L"Chưa chọn bản build của loader.";
    }
    if (!versions_error_.empty()) {
        rebuild_versions();
        InvalidateRect(hwnd_, nullptr, FALSE);
        return;
    }

    std::wstring label = versions_name_;
    if (label.empty()) label = loader_name(versions_loader_) + L" " + versions_picked_;
    std::wstring dir = versions_dir_.empty()
                           ? instance_base_dir() + L"\\" + instance_slug(label)
                           : versions_dir_;
    for (const auto& inst : instances_) {
        if (!inst.dir.empty() && _wcsicmp(inst.dir.c_str(), dir.c_str()) == 0) {
            versions_error_ = L"Thư mục này đã có một instance của XyoLauncher.";
            rebuild_versions();
            InvalidateRect(hwnd_, nullptr, FALSE);
            return;
        }
    }
    if (!ensure_dir_tree(dir)) {
        versions_error_ = L"Không tạo được thư mục instance: " + dir;
        rebuild_versions();
        InvalidateRect(hwnd_, nullptr, FALSE);
        return;
    }
    const wchar_t* subs[] = { L"mods", L"config", L"saves", L"resourcepacks", L"shaderpacks",
                              L"logs" };
    for (const wchar_t* sub : subs) ensure_dir_tree(dir + L"\\" + sub);

    SYSTEMTIME st{};
    GetSystemTime(&st);
    wchar_t created[40];
    swprintf(created, 40, L"%04d-%02d-%02dT%02d:%02d:%02d.000Z", st.wYear, st.wMonth, st.wDay,
             st.wHour, st.wMinute, st.wSecond);
    wchar_t id_buf[96];
    swprintf(id_buf, 96, L"%ls-%ls-%llx", versions_loader_.c_str(), versions_picked_.c_str(),
             (unsigned long long)GetTickCount64());
    std::wstring id = id_buf;

    const Account* account = active_account();
    std::wstring username = account ? account->name : L"Player";

    Json entry = Json::object();
    entry.set("id", Json::string(wide_to_utf8(id)));
    entry.set("name", Json::string(wide_to_utf8(label)));
    entry.set("version", Json::string(wide_to_utf8(versions_picked_)));
    entry.set("loader", Json::string(wide_to_utf8(versions_loader_)));
    if (versions_loader_ != L"vanilla")
        entry.set("loaderVersion", Json::string(wide_to_utf8(versions_build_)));
    entry.set("memoryMb", Json::number(versions_memory_));
    entry.set("username", Json::string(wide_to_utf8(username)));
    entry.set("demo", Json::boolean(versions_demo_));
    entry.set("dir", Json::string(wide_to_utf8(dir)));
    entry.set("status", Json::string("ready"));
    entry.set("created", Json::string(wide_to_utf8(created)));
    entry.set("playtimeMs", Json::number(0.0));
    Json instance_json = Json::object();
    for (const auto& field : entry.obj) instance_json.set(field.first, field.second);
    instance_json.set("sharedDir", Json::string(wide_to_utf8(shared_dir_)));
    write_file_utf8(dir + L"\\instance.json", instance_json.dump(2));

    Json index;
    index.parse(read_file_utf8(user_data_dir() + L"\\instances.json"));
    Json updated = Json::array();
    updated.arr.push_back(entry);
    if (index.type == Json::Type::Array) {
        for (const auto& item : index.arr) updated.arr.push_back(item);
    }
    write_file_utf8(user_data_dir() + L"\\instances.json", updated.dump(2));

    InstanceInfo info;
    info.id = id;
    info.name = label;
    info.version = versions_picked_;
    info.loader = versions_loader_;
    info.loader_version = versions_build_;
    info.dir = dir;
    info.status = L"ready";
    info.memory_mb = versions_memory_;
    info.created = created;
    instances_.insert(instances_.begin(), std::move(info));
    rebuild_instance_rows();
    rebuild_home();

    versions_error_.clear();
    notify(L"Phiên bản", L"Đã tạo " + label + L".", L"success");
    rebuild_versions();
    dirty_ = true;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

InstanceInfo* App::find_instance(const std::wstring& id) {
    for (auto& inst : instances_)
        if (inst.id == id) return &inst;
    return nullptr;
}

std::string App::load_account_token(const std::wstring& account_id) const {
    Json store;
    if (!store.parse(read_file_utf8(user_data_dir() + L"\\auth.json"))) return "";
    const Json* entry = store.find(wide_to_utf8(account_id).c_str());
    if (!entry) return "";
    std::string data = entry->text("data");
    if (data.empty()) return "";
    if (entry->boolean("enc", false)) data = oscrypt_decrypt(data);
    return data;
}

void App::persist_instance_fields(const std::wstring& id, const std::function<void(Json&)>& mutate) {
    if (id.empty()) return;
    std::string body = read_file_utf8(user_data_dir() + L"\\instances.json");
    Json index;
    if (index.parse(body) && index.type == Json::Type::Array) {
        for (auto& item : index.arr)
            if (item.text("id") == wide_to_utf8(id)) mutate(item);
        write_file_utf8(user_data_dir() + L"\\instances.json", index.dump(2));
    }
    InstanceInfo* inst = find_instance(id);
    if (!inst || inst->dir.empty()) return;
    std::wstring file = inst->dir + L"\\instance.json";
    Json local;
    if (local.parse(read_file_utf8(file)) && local.type == Json::Type::Object) {
        mutate(local);
        write_file_utf8(file, local.dump(2));
    }
}

void App::launch_instance(const std::wstring& id_in, const std::wstring& quick_type,
                          const std::wstring& quick_value) {
    std::wstring id = id_in;
    InstanceInfo* inst = find_instance(id);
    if (!inst) return;
    if (!launcher_) launcher_ = std::make_unique<LaunchManager>();
    if (inst->status == L"running" || inst->status == L"starting" || inst->status == L"stopping") {
        stop_instance(id);
        return;
    }
    InstanceLaunchSpec spec;
    spec.instance_id = id;
    spec.instance_dir = inst->dir;
    spec.version_id = inst->version_id.empty() ? inst->version : inst->version_id;
    const Account* account = active_account();
    spec.username = account ? account->name : (inst->username.empty() ? L"Player" : inst->username);
    spec.uuid = account && !account->uuid.empty() ? account->uuid
                                                  : utf8_to_wide(offline_uuid(spec.username));
    if (account) {
        Json token;
        token.parse(load_account_token(account->id));
        spec.access_token = utf8_to_wide(token.text("accessToken"));
        spec.user_type = account->type == L"microsoft" ? L"msa"
                         : account->type == L"ely"     ? L"mojang"
                                                       : L"legacy";
        spec.xuid = account->xuid;
    } else {
        spec.user_type = L"legacy";
    }
    spec.java_path = inst->java_path;
    spec.settings_java = java_path_;
    spec.extra_jvm = inst->jvm_args;
    spec.memory_mb = inst->memory_mb > 0 ? inst->memory_mb : 4096;
    spec.demo = inst->demo;
    spec.quick_play_type = quick_type;
    spec.quick_play_value = quick_value;
    spec.shared_dir = shared_dir_;

    launch_ui_ = LaunchUiState{};
    launch_ui_.id = id;
    launch_ui_.lines.push_back(L"[XyoLauncher] Chuẩn bị khởi chạy " + inst->name + L" (" +
                               inst->version + L")");
    launch_started_ = now_ms();
    inst->status = L"starting";
    persist_instance_fields(id, [](Json& entry) {
        entry.set("status", Json::string("starting"));
    });
    rebuild_instance_rows();
    rebuild_home();
    if (page_ == L"console") {
        console_dirty_ = true;
        rebuild_console();
    }

    HWND target = hwnd_;
    LaunchCallbacks callbacks;
    callbacks.progress = [target](const std::wstring& instance_id, const ProgressReport& report) {
        auto* msg = new LaunchProgressMsg();
        msg->id = instance_id;
        msg->phase = report.phase;
        msg->label = report.label;
        msg->done = report.done;
        msg->total = report.total;
        msg->bytes = report.bytes;
        msg->bytes_total = report.bytes_total;
        PostMessage(target, WM_APP + 20, 0, reinterpret_cast<LPARAM>(msg));
    };
    callbacks.log = [target](const std::wstring& instance_id, const std::wstring& line) {
        auto* msg = new LaunchLogMsg();
        msg->id = instance_id;
        msg->line = line;
        PostMessage(target, WM_APP + 21, 0, reinterpret_cast<LPARAM>(msg));
    };
    callbacks.state = [target](const std::wstring& instance_id, const std::wstring& state) {
        auto* msg = new LaunchStateMsg();
        msg->id = instance_id;
        msg->state = state;
        PostMessage(target, WM_APP + 22, 0, reinterpret_cast<LPARAM>(msg));
    };
    callbacks.exit = [target](const std::wstring& instance_id, int code, bool crashed,
                              const CrashInfo& crash, const std::wstring& error) {
        auto* msg = new LaunchExitMsg();
        msg->id = instance_id;
        msg->code = code;
        msg->crashed = crashed;
        msg->error = error;
        msg->title = crash.title;
        msg->hint = crash.hint;
        PostMessage(target, WM_APP + 23, 0, reinterpret_cast<LPARAM>(msg));
    };
    std::wstring error;
    if (!launcher_->start(spec, std::move(callbacks), &error)) {
        inst->status = L"ready";
        persist_instance_fields(id, [](Json& entry) {
            entry.set("status", Json::string("ready"));
        });
        rebuild_instance_rows();
        rebuild_home();
        notify(L"Khởi chạy", error.empty() ? L"Không khởi chạy được." : error, L"bad");
    }
    dirty_ = true;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::stop_instance(const std::wstring& id) {
    if (!launcher_) return;
    launcher_->stop(id);
    if (!launcher_->running(id)) {
        if (InstanceInfo* inst = find_instance(id)) {
            inst->status = L"ready";
            persist_instance_fields(id, [](Json& entry) {
                entry.set("status", Json::string("ready"));
            });
        }
    } else if (InstanceInfo* inst = find_instance(id)) {
        inst->status = L"stopping";
    }
    rebuild_instance_rows();
    rebuild_home();
    if (page_ == L"console") {
        console_dirty_ = true;
        SetTimer(hwnd_, 2, 16, nullptr);
    }
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::open_console(const std::wstring& id_in) {
    std::wstring id = id_in;
    if (id.empty()) return;
    InstanceInfo* inst = find_instance(id);
    if (!inst) return;
    if (launch_ui_.id != id) {
        launch_ui_ = LaunchUiState{};
        launch_ui_.id = id;
        launch_ui_.lines.push_back(L"[XyoLauncher] " + inst->name + L" · " + inst->version);
    }
    page_ = L"console";
    rebuild_console();
    ui_apply_page();
    dirty_ = true;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::rebuild_console() {
    if (!ui_) return;
    InstanceInfo* inst = find_instance(launch_ui_.id);
    std::wstring name = inst ? inst->name : L"Console";
    std::wstring status = inst ? inst->status : L"ready";
    if (Node* title = ui_find(ui_.get(), L"console-title")) title->text = name;
    if (Node* sub = ui_find(ui_.get(), L"console-sub")) {
        std::wstring text = status;
        if (inst) {
            text = inst->version;
            if (!inst->loader.empty() && inst->loader != L"vanilla")
                text += L" · " + inst->loader +
                        (inst->loader_version.empty() ? L"" : L" " + inst->loader_version);
            text += L" · " + status_label(status);
        }
        sub->text = text;
    }
    if (Node* progress = ui_find(ui_.get(), L"console-progress")) {
        if (!launch_ui_.phase.empty() && launch_ui_.phase != L"done") {
            std::wstring text = L"Đang cài tệp: " + launch_ui_.label;
            if (launch_ui_.total > 0)
                text += L"  ·  " + std::to_wstring(launch_ui_.done) + L"/" +
                        std::to_wstring(launch_ui_.total);
            if (launch_ui_.bytes_total > 0)
                text += L"  ·  " + format_size(launch_ui_.bytes) + L" / " +
                        format_size(launch_ui_.bytes_total);
            progress->text = text;
        } else if (!launch_ui_.error.empty()) {
            progress->text = launch_ui_.error;
        } else {
            progress->text.clear();
        }
    }
    bool busy = status == L"running" || status == L"starting" || status == L"stopping";
    ui_set_visible(ui_find(ui_.get(), L"btn-console-play"), !busy);
    ui_set_visible(ui_find(ui_.get(), L"btn-console-stop"), busy);
    if (Node* lines = ui_find(ui_.get(), L"console-lines")) {
        lines->kids.clear();
        size_t total = launch_ui_.lines.size();
        size_t take = std::min<size_t>(total, 24);
        for (size_t i = total - take; i < total; ++i) {
            auto line = std::make_unique<Node>();
            line->kind = Kind::Text;
            line->text = launch_ui_.lines[i];
            line->style.font_size = 10.0f;
            line->style.color = launch_ui_.lines[i].rfind(L"[XyoLauncher]", 0) == 0
                                    ? ui_token(L"accent")
                                    : ui_token(L"label");
            line->style.wrap = true;
            lines->kids.push_back(std::move(line));
        }
    }
    console_dirty_ = false;
}

void App::apply_launch_progress(LaunchProgressMsg* msg) {
    if (!msg) return;
    if (msg->id != launch_ui_.id) return;
    launch_ui_.phase = msg->phase;
    launch_ui_.label = msg->label;
    launch_ui_.done = msg->done;
    launch_ui_.total = msg->total;
    launch_ui_.bytes = msg->bytes;
    launch_ui_.bytes_total = msg->bytes_total;
    if (page_ == L"console") console_dirty_ = true;
    SetTimer(hwnd_, 2, 16, nullptr);
}

void App::apply_launch_log(LaunchLogMsg* msg) {
    if (!msg) return;
    if (msg->id != launch_ui_.id) return;
    launch_ui_.lines.push_back(msg->line);
    if (launch_ui_.lines.size() > 600)
        launch_ui_.lines.erase(launch_ui_.lines.begin(),
                               launch_ui_.lines.begin() + (launch_ui_.lines.size() - 600));
    if (page_ == L"console") console_dirty_ = true;
    SetTimer(hwnd_, 2, 16, nullptr);
}

void App::apply_launch_state(LaunchStateMsg* msg) {
    if (!msg) return;
    InstanceInfo* inst = find_instance(msg->id);
    if (inst) {
        inst->status = msg->state;
        persist_instance_fields(msg->id, [&](Json& entry) {
            entry.set("status", Json::string(wide_to_utf8(msg->state)));
        });
        if (inst->status == L"running") launch_ui_.error.clear();
        rebuild_instance_rows();
        rebuild_home();
    }
    if (msg->id == launch_ui_.id && page_ == L"console") {
        console_dirty_ = true;
        SetTimer(hwnd_, 2, 16, nullptr);
    }
    dirty_ = true;
}

void App::apply_launch_exit(LaunchExitMsg* msg) {
    if (!msg) return;
    InstanceInfo* inst = find_instance(msg->id);
    std::wstring name = inst ? inst->name : msg->id;
    bool user_stopped = inst && inst->status == L"stopping";
    if (inst) {
        inst->status = L"ready";
        inst->last_played = utf8_to_wide(iso_now());
        if (launch_started_) {
            ULONGLONG elapsed = now_ms() - launch_started_;
            if (elapsed < 1000ull * 60 * 60 * 24) inst->playtime_ms += double(elapsed);
        }
        launch_started_ = 0;
    }
    std::wstring last_played = inst ? inst->last_played : L"";
    double playtime = inst ? inst->playtime_ms : 0;
    persist_instance_fields(msg->id, [&](Json& entry) {
        entry.set("status", Json::string("ready"));
        entry.set("lastPlayed", Json::string(wide_to_utf8(last_played)));
        entry.set("playtimeMs", Json::number(playtime));
    });
    rebuild_instance_rows();
    rebuild_home();
    if (msg->id == launch_ui_.id) {
        launch_ui_.error = msg->error;
        launch_ui_.crashed = msg->crashed;
        launch_ui_.crash_title = msg->title;
        launch_ui_.crash_hint = msg->hint;
        launch_ui_.exit_code = msg->code;
        launch_ui_.phase.clear();
        launch_ui_.done = launch_ui_.total = 0;
        if (page_ == L"console") console_dirty_ = true;
    }
    if (!msg->error.empty()) {
        notify(L"Khởi chạy thất bại", msg->error, L"bad");
    } else if (msg->crashed) {
        notify(L"Game gặp lỗi",
               msg->title + (msg->hint.empty() ? L"" : L" — " + msg->hint), L"bad");
    } else if (user_stopped || msg->code == 0) {
        notify(L"Phiên bản", L"Đã đóng " + name + L".", L"ok");
    } else {
        notify(L"Phiên bản", L"Tiến trình kết thúc (mã " + std::to_wstring(msg->code) + L").",
               L"info");
    }
    dirty_ = true;
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::rebuild_settings() {
    if (bg_items_.empty()) load_settings_page_state();
    auto root = std::make_unique<Node>();
    root->kind = Kind::Column;
    root->style.gap = 14.0f;

    auto text = [&](const std::wstring& value, float size, int weight, Color color,
                    float width = -1.0f, bool mono = false, bool wrap = false) {
        auto node = std::make_unique<Node>();
        node->kind = Kind::Text;
        node->text = value;
        node->style.font_size = size;
        node->style.weight = weight;
        node->style.color = color;
        node->style.mono = mono;
        node->style.wrap = wrap;
        if (width > 0.0f) node->style.width = width;
        return node;
    };
    auto image = [&](const std::wstring& src, float width, float height, float radius = 0.0f,
                     Color color = Color{}) {
        auto node = std::make_unique<Node>();
        node->kind = Kind::Image;
        node->src = src;
        node->style.width = width;
        node->style.height = height;
        node->style.radius = radius;
        if (color.visible()) node->style.color = color;
        return node;
    };
    auto spacer = [&](float width, float height, bool grow_x = false) {
        auto node = std::make_unique<Node>();
        node->kind = Kind::Spacer;
        node->style.width = width;
        node->style.height = height;
        node->style.grow_x = grow_x;
        return node;
    };
    auto box = [&](Kind kind, float height = -1.0f, float gap = 0.0f) {
        auto node = std::make_unique<Node>();
        node->kind = kind;
        node->style.height = height;
        node->style.gap = gap;
        return node;
    };
    auto card = [&]() {
        auto node = box(Kind::Column, -1.0f, 0.0f);
        node->style.bg = ui_token(L"surface");
        node->style.border = true;
        node->style.border_color = ui_token(L"border");
        node->style.radius = 14.0f;
        node->style.glass = true;
        return node;
    };
    auto sep = [&]() {
        auto node = spacer(0.0f, 1.0f);
        node->style.bg = ui_token(L"borderSoft");
        return node;
    };
    auto icon_tile = [&](const wchar_t* src, Color tint) {
        auto tile = box(Kind::Row, 32.0f);
        tile->style.width = 32.0f;
        tile->style.radius = 8.0f;
        tile->style.bg = ui_token(L"input");
        tile->kids.push_back(spacer(0, 0, true));
        tile->kids.push_back(image(asset(src), 16.0f, 16.0f, 0.0f, tint));
        tile->kids.push_back(spacer(0, 0, true));
        return tile;
    };
    auto row = [&](const wchar_t* icon, const std::wstring& title, const std::wstring& desc,
                   std::unique_ptr<Node> control) {
        auto node = box(Kind::Row, -1.0f, 12.0f);
        node->style.pad_l = node->style.pad_r = 16.0f;
        node->style.pad_t = node->style.pad_b = 12.0f;
        node->kids.push_back(icon_tile(icon, ui_token(L"accent")));
        auto info = box(Kind::Column, -1.0f, 2.0f);
        info->style.grow_x = true;
        info->kids.push_back(text(title, 12.0f, 600, ui_token(L"text")));
        if (!desc.empty())
            info->kids.push_back(text(desc, 10.0f, 400, ui_token(L"faint"), -1.0f, false, true));
        node->kids.push_back(std::move(info));
        if (control) node->kids.push_back(std::move(control));
        return node;
    };
    auto section = [&](const std::wstring& title, const std::wstring& hint,
                       const std::wstring& action_icon = L"", const std::wstring& action = L"") {
        auto node = box(Kind::Row, 24.0f, 8.0f);
        node->style.pad_l = node->style.pad_r = 4.0f;
        node->kids.push_back(text(title, 13.0f, 700, ui_token(L"text")));
        if (!hint.empty()) node->kids.push_back(text(hint, 10.0f, 400, ui_token(L"label")));
        node->kids.push_back(spacer(0, 0, true));
        if (!action_icon.empty()) {
            auto button = box(Kind::Row, 26.0f);
            button->style.width = 26.0f;
            button->style.radius = 7.0f;
            button->style.bg = ui_token(L"input");
            button->style.border = true;
            button->style.border_color = ui_token(L"border");
            button->action = action;
            button->kids.push_back(spacer(0, 0, true));
            button->kids.push_back(image(asset(action_icon), 13.0f, 13.0f, 0.0f,
                                          ui_token(L"label")));
            button->kids.push_back(spacer(0, 0, true));
            node->kids.push_back(std::move(button));
        }
        root->kids.push_back(std::move(node));
    };
    auto toggle = [&](bool on, const std::wstring& action) {
        auto node = box(Kind::Row, 22.0f);
        node->style.width = 40.0f;
        node->style.radius = 11.0f;
        node->style.bg = on ? ui_token(L"accent") : ui_token(L"input");
        if (!on) {
            node->style.border = true;
            node->style.border_color = ui_token(L"border");
        }
        node->style.pad_l = node->style.pad_r = 2.0f;
        node->action = action;
        auto knob = spacer(18.0f, 18.0f);
        knob->style.radius = 9.0f;
        knob->style.bg = on ? Color::rgb(0xFFFFFF) : ui_token(L"label");
        if (on) {
            node->kids.push_back(spacer(0, 0, true));
            node->kids.push_back(std::move(knob));
        } else {
            node->kids.push_back(std::move(knob));
            node->kids.push_back(spacer(0, 0, true));
        }
        return node;
    };
    auto button = [&](const std::wstring& label, const std::wstring& action, bool primary,
                      const wchar_t* icon = L"", float height = 28.0f) {
        auto node = box(Kind::Row, height, 5.0f);
        node->style.pad_l = node->style.pad_r = 10.0f;
        node->style.radius = 8.0f;
        node->style.bg = primary ? ui_token(L"accent") : ui_token(L"input");
        if (!primary) {
            node->style.border = true;
            node->style.border_color = ui_token(L"border");
        }
        node->action = action;
        if (icon[0]) {
            node->kids.push_back(image(asset(icon), 12.0f, 12.0f, 0.0f,
                                       primary ? ui_token(L"ink") : ui_token(L"label")));
        }
        node->kids.push_back(text(label, 10.0f, 700, primary ? ui_token(L"ink")
                                                              : ui_token(L"label")));
        return node;
    };
    auto chip = [&](const std::wstring& label) {
        auto node = box(Kind::Row, 18.0f);
        node->style.pad_l = node->style.pad_r = 6.0f;
        node->style.radius = 5.0f;
        node->style.bg = ui_token(L"input");
        node->kids.push_back(text(label, 9.0f, 700, ui_token(L"label")));
        return node;
    };

    const std::wstring version = L"2.0.0";
    std::wstring platform_key = runtime_platform();
    std::wstring platform_arch = platform_key == L"windows-arm64"
                                     ? L"Windows arm64"
                                     : platform_key == L"windows-x86" ? L"Windows x86"
                                                                      : L"Windows x64";
    int java_installed = 0;
    unsigned long long java_bytes = 0;
    for (const auto& rt : java_state_.managed)
        if (rt.installed) { ++java_installed; java_bytes += rt.bytes; }
    for (const auto& rt : java_state_.zulu) { ++java_installed; java_bytes += rt.bytes; }

    // ---- Giao diện -------------------------------------------------------
    section(L"Giao diện", L"áp dụng ngay");
    auto appearance = card();
    {
        auto language = box(Kind::Row, 30.0f, 2.0f);
        language->style.pad_l = language->style.pad_r = 2.0f;
        language->style.radius = 8.0f;
        language->style.bg = ui_token(L"input");
        language->style.border = true;
        language->style.border_color = ui_token(L"border");
        auto option = [&](const std::wstring& label, bool active, const std::wstring& action) {
            auto opt = box(Kind::Row, 26.0f);
            opt->style.pad_l = opt->style.pad_r = 12.0f;
            opt->style.radius = 6.0f;
            if (active) opt->style.bg = ui_token(L"surface");
            opt->action = action;
            opt->kids.push_back(text(label, 11.0f, 600,
                                     active ? ui_token(L"accent") : ui_token(L"label")));
            return opt;
        };
        language->kids.push_back(option(L"Tiếng Việt", !settings_lang_en_, L"settings:lang-vi"));
        language->kids.push_back(option(L"English", settings_lang_en_, L"settings:lang-en"));
        appearance->kids.push_back(row(L"assets/icons/translate.svg", L"Ngôn ngữ", L"",
                                       std::move(language)));
        appearance->kids.push_back(sep());

        auto theme_switch = box(Kind::Row, 30.0f);
        theme_switch->id = L"theme-switch";
        theme_switch->style.width = 74.0f;
        theme_switch->style.radius = 15.0f;
        theme_switch->action = L"toggle:theme";
        if (theme_locked_) theme_switch->style.opacity = 0.55f;
        appearance->kids.push_back(row(
            ui_is_dark() ? L"assets/icons/moon-stars.svg" : L"assets/icons/sun.svg", L"Giao diện",
            theme_locked_ ? L"Đang khóa khi dùng ảnh nền — chọn \"Theo giao diện\" để đổi sáng/tối"
                          : L"Bật/tắt chế độ tối",
            std::move(theme_switch)));
        appearance->kids.push_back(sep());

        appearance->kids.push_back(row(L"assets/icons/sparkle.svg", L"Hiệu ứng chuyển cảnh",
                                       L"Bật hiệu ứng khi mở instance và khi quay lại",
                                       toggle(effects_enabled_, L"settings:effects")));
    }
    root->kids.push_back(std::move(appearance));

    auto backgrounds = card();
    {
        auto head = box(Kind::Column, -1.0f, 3.0f);
        head->style.pad_l = head->style.pad_r = 16.0f;
        head->style.pad_t = 14.0f;
        head->style.pad_b = 10.0f;
        auto title_row = box(Kind::Row, 18.0f, 8.0f);
        title_row->kids.push_back(text(L"Ảnh nền", 12.0f, 600, ui_token(L"text")));
        title_row->kids.push_back(spacer(0, 0, true));
        if (!settings_error_.empty())
            title_row->kids.push_back(text(settings_error_, 10.0f, 500, ui_token(L"bad")));
        head->kids.push_back(std::move(title_row));
        head->kids.push_back(text(L"Ảnh mặc định có sẵn; ảnh khác cần tải về rồi mới áp dụng được.",
                                  10.0f, 400, ui_token(L"faint"), -1.0f, false, true));
        backgrounds->kids.push_back(std::move(head));

        auto make_tile = [&](bool theme_tile, const BgItem* item) {
            bool active = theme_tile ? background_id_.empty() || background_id_ == L"theme"
                                     : background_id_ == item->id;
            auto tile = box(Kind::Column, 96.0f, 0.0f);
            tile->style.grow_x = true;
            tile->style.radius = 12.0f;
            tile->style.bg = ui_token(L"input");
            tile->style.border = true;
            tile->style.border_color = active ? ui_token(L"accent") : ui_token(L"border");

            auto preview = box(Kind::Row, 56.0f);
            preview->style.grow_x = true;
            preview->style.radius = 11.0f;
            if (theme_tile) {
                preview->kids.push_back(spacer(0, 0, true));
                preview->kids.push_back(text(L"Sáng / Tối", 10.0f, 500, ui_token(L"faint")));
                preview->kids.push_back(spacer(0, 0, true));
            } else if (item->ready) {
                preview->style.bg_image = item->file;
            } else {
                preview->kids.push_back(spacer(0, 0, true));
                preview->kids.push_back(text(L"Chưa tải", 10.0f, 500, ui_token(L"faint")));
                preview->kids.push_back(spacer(0, 0, true));
            }
            tile->kids.push_back(std::move(preview));

            auto bottom = box(Kind::Row, 40.0f, 6.0f);
            bottom->style.pad_l = bottom->style.pad_r = 8.0f;
            bottom->style.pad_t = bottom->style.pad_b = 6.0f;
            bottom->style.grow_x = true;
            auto name = text(theme_tile ? L"Theo giao diện" : item->name, 10.0f, 600,
                             ui_token(L"text"));
            name->style.grow_x = true;
            bottom->kids.push_back(std::move(name));
            if (active) {
                bottom->kids.push_back(text(L"Đang dùng", 9.0f, 700, ui_token(L"accent")));
            } else if (theme_tile) {
                bottom->kids.push_back(button(L"Áp dụng", L"settings:bg-theme", false, L"", 22.0f));
            } else if (item->ready) {
                bottom->kids.push_back(button(L"Áp dụng", L"settings:bg-apply:" + item->id,
                                              false, L"", 22.0f));
            } else {
                bool busy = bg_busy_ == item->id;
                bottom->kids.push_back(button(busy ? L"Đang tải…" : L"Tải về",
                                              L"settings:bg-download:" + item->id, true,
                                              L"assets/icons/download-simple.svg", 22.0f));
            }
            tile->kids.push_back(std::move(bottom));
            return tile;
        };

        size_t index = 0;
        auto add_grid_row = [&]() {
            auto grid = box(Kind::Row, 96.0f, 10.0f);
            grid->style.pad_l = grid->style.pad_r = 14.0f;
            for (int slot = 0; slot < 3; ++slot) {
                if (index == 0) {
                    grid->kids.push_back(make_tile(true, nullptr));
                    ++index;
                } else if (index - 1 < bg_items_.size()) {
                    grid->kids.push_back(make_tile(false, &bg_items_[index - 1]));
                    ++index;
                } else {
                    auto filler = spacer(0, 0, true);
                    grid->kids.push_back(std::move(filler));
                }
            }
            backgrounds->kids.push_back(std::move(grid));
            backgrounds->kids.push_back(spacer(0, 10));
        };
        add_grid_row();
        add_grid_row();
    }
    root->kids.push_back(std::move(backgrounds));

    // ---- Trò chơi --------------------------------------------------------
    section(L"Trò chơi", hide_on_launch_ ? L"đang bật" : L"đang tắt");
    auto game = card();
    game->kids.push_back(row(
        L"assets/icons/tray.svg", L"Tự động ẩn launcher khi chơi game",
        L"Launcher tự ẩn khi game bắt đầu chạy và tự hiện lại khi game đóng. Mở lại bằng biểu "
        L"tượng XyoLauncher ở khay hệ thống (tray).",
        toggle(hide_on_launch_, L"settings:hide-launch")));
    root->kids.push_back(std::move(game));

    // ---- Discord ---------------------------------------------------------
    section(L"Discord",
            rich_presence_ ? L"chờ Discord" : L"đang tắt");
    auto discord_card = card();
    discord_card->kids.push_back(row(
        L"assets/img/discord-logo.png", L"Rich Presence",
        rich_presence_ ? L"Chưa mở Discord — launcher sẽ tự kết nối khi Discord chạy"
                       : L"Đang tắt — bật để hiện hoạt động cho bạn bè",
        toggle(rich_presence_, L"settings:rpc")));
    discord_card->kids.push_back(sep());
    discord_card->kids.push_back(row(
        L"assets/img/discord-logo.png", L"Cộng đồng XyoLauncher",
        discord_invite_,
        button(L"Tham gia Discord", L"settings:discord-join", true,
               L"assets/img/discord-logo.png")));
    discord_card->kids.push_back(sep());
    discord_card->kids.push_back(row(
        L"assets/img/discord-logo.png", L"Đang hiển thị",
        L"Tên phiên bản, Minecraft + trình tải, thời gian đã chơi",
        text(L"chưa có hoạt động", 10.0f, 500, ui_token(L"label"), 220.0f, true)));
    root->kids.push_back(std::move(discord_card));

    // ---- Java ------------------------------------------------------------
    std::wstring java_hint = java_state_.managed.empty() && java_state_.zulu.empty()
                                 ? (java_loading_ ? L"đang quét…" : L"chưa tải bản nào")
                                 : std::to_wstring(java_installed) + L" bản · " +
                                       format_bytes(java_bytes);
    section(L"Java", java_hint, L"assets/icons/arrows-clockwise.svg", L"settings:java-refresh");

    auto java_card = card();
    if (java_state_.managed.empty() && java_loading_) {
        auto loading = box(Kind::Column, -1.0f, 6.0f);
        loading->style.pad_l = loading->style.pad_r = 16.0f;
        loading->style.pad_t = loading->style.pad_b = 16.0f;
        loading->kids.push_back(text(L"Đang đọc danh sách Java runtime…", 11.0f, 400,
                                     ui_token(L"label")));
        java_card->kids.push_back(std::move(loading));
    } else if (java_state_.managed.empty()) {
        auto empty = box(Kind::Column, -1.0f, 0.0f);
        empty->style.pad_l = empty->style.pad_r = 16.0f;
        empty->style.pad_t = empty->style.pad_b = 20.0f;
        empty->kids.push_back(text(L"Không có bản Java nào cho nền tảng này.", 11.0f, 400,
                                   ui_token(L"label")));
        java_card->kids.push_back(std::move(empty));
    } else {
        static const struct { const wchar_t* component; const wchar_t* target; } targets[] = {
            { L"java-runtime-epsilon", L"26.x" },
            { L"java-runtime-delta", L"1.20.5 – 1.21.x" },
            { L"java-runtime-beta", L"1.18 – 1.20.4" },
            { L"java-runtime-gamma", L"1.18 – 1.20.4" },
            { L"jre-legacy", L"≤ 1.16.5" },
        };
        auto target_of = [&](const std::wstring& component) -> std::wstring {
            for (const auto& t : targets)
                if (component == t.component) return t.target;
            return L"";
        };
        for (size_t i = 0; i < java_state_.managed.size(); ++i) {
            const ManagedJava& rt = java_state_.managed[i];
            if (i > 0) java_card->kids.push_back(sep());
            auto jr = box(Kind::Row, 48.0f, 10.0f);
            jr->style.pad_l = jr->style.pad_r = 16.0f;
            jr->kids.push_back(image(asset(L"assets/icons/coffee.svg"), 15.0f, 15.0f, 0.0f,
                                     rt.installed ? Color::rgb(0x22C55E) : ui_token(L"faint")));
            auto info = box(Kind::Column, -1.0f, 2.0f);
            info->style.grow_x = true;
            auto title = box(Kind::Row, 18.0f, 8.0f);
            title->kids.push_back(text(L"Java " + (rt.major ? std::to_wstring(rt.major) : L"?"),
                                       11.0f, 600, ui_token(L"text")));
            if (!rt.name.empty())
                title->kids.push_back(text(rt.name, 10.0f, 400, ui_token(L"faint"), -1.0f, true));
            std::wstring target = target_of(rt.component);
            if (!target.empty()) title->kids.push_back(chip(target));
            info->kids.push_back(std::move(title));
            std::wstring sub = rt.component;
            if (rt.installed) sub = format_bytes(rt.bytes) + L" · " + sub;
            info->kids.push_back(text(sub, 9.5f, 400, ui_token(L"faint"), -1.0f, true));
            jr->kids.push_back(std::move(info));
            if (rt.installed) {
                jr->kids.push_back(text(L"đã có", 10.0f, 700, Color::rgb(0x22C55E)));
            } else {
                jr->kids.push_back(text(L"chưa tải", 10.0f, 400, ui_token(L"faint")));
            }
            if (java_confirm_ == rt.component) {
                auto confirm = box(Kind::Row, 28.0f, 6.0f);
                confirm->kids.push_back(button(L"Huỷ", L"settings:java-cancel", false, L"", 26.0f));
                confirm->kids.push_back(button(L"Xoá", L"settings:java-delete:" + rt.component,
                                               false, L"", 26.0f));
                jr->kids.push_back(std::move(confirm));
            } else if (rt.installed) {
                auto del = box(Kind::Row, 26.0f);
                del->style.width = 26.0f;
                del->style.radius = 7.0f;
                del->style.bg = ui_token(L"input");
                del->style.border = true;
                del->style.border_color = ui_token(L"border");
                del->action = L"settings:java-ask:" + rt.component;
                del->kids.push_back(spacer(0, 0, true));
                del->kids.push_back(image(asset(L"assets/icons/trash.svg"), 13.0f, 13.0f, 0.0f,
                                          Color::rgb(0xEF4444)));
                del->kids.push_back(spacer(0, 0, true));
                jr->kids.push_back(std::move(del));
            } else {
                jr->kids.push_back(button(L"Tải", L"settings:java-install:" + rt.component,
                                          true, L"assets/icons/download-simple.svg"));
            }
            java_card->kids.push_back(std::move(jr));
        }
    }
    root->kids.push_back(std::move(java_card));

    auto zulu_card = card();
    {
        auto zulu_row = box(Kind::Row, -1.0f, 10.0f);
        zulu_row->style.pad_l = zulu_row->style.pad_r = 16.0f;
        zulu_row->style.pad_t = zulu_row->style.pad_b = 12.0f;
        zulu_row->kids.push_back(icon_tile(L"assets/icons/coffee.svg", ui_token(L"accent")));
        auto info = box(Kind::Column, -1.0f, 2.0f);
        info->style.grow_x = true;
        info->kids.push_back(text(L"Tải Java từ Azul Zulu", 12.0f, 600, ui_token(L"text")));
        info->kids.push_back(text(L"Zulu là bản OpenJDK miễn phí của Azul — chọn phiên bản rồi tải "
                                  L"thẳng vào thư mục runtime của launcher.",
                                  10.0f, 400, ui_token(L"faint"), -1.0f, false, true));
        zulu_row->kids.push_back(std::move(info));
        auto pick = [&](const std::wstring& label, const std::wstring& action) {
            auto node = box(Kind::Row, 28.0f, 6.0f);
            node->style.width = 82.0f;
            node->style.pad_l = node->style.pad_r = 10.0f;
            node->style.radius = 8.0f;
            node->style.bg = ui_token(L"input");
            node->style.border = true;
            node->style.border_color = ui_token(L"border");
            node->action = action;
            node->kids.push_back(text(label, 10.0f, 600, ui_token(L"label")));
            node->kids.push_back(spacer(0, 0, true));
            node->kids.push_back(image(asset(L"assets/icons/caret-right.svg"), 10.0f, 10.0f, 0.0f,
                                       ui_token(L"faint")));
            return node;
        };
        zulu_row->kids.push_back(pick(L"Java " + zulu_major_, L"settings:zulu-major"));
        zulu_row->kids.push_back(pick(zulu_kind_ == L"jdk" ? L"JDK" : L"JRE",
                                      L"settings:zulu-kind"));
        zulu_row->kids.push_back(button(L"Tải", L"settings:zulu-download", true,
                                        L"assets/icons/download-simple.svg"));
        zulu_card->kids.push_back(std::move(zulu_row));
        for (size_t i = 0; i < java_state_.zulu.size(); ++i) {
            const ZuluJava& z = java_state_.zulu[i];
            zulu_card->kids.push_back(sep());
            auto zr = box(Kind::Row, 48.0f, 10.0f);
            zr->style.pad_l = zr->style.pad_r = 16.0f;
            zr->kids.push_back(image(asset(L"assets/icons/coffee.svg"), 15.0f, 15.0f, 0.0f,
                                     Color::rgb(0x22C55E)));
            auto info = box(Kind::Column, -1.0f, 2.0f);
            info->style.grow_x = true;
            auto title = box(Kind::Row, 18.0f, 8.0f);
            title->kids.push_back(text(z.name, 11.0f, 600, ui_token(L"text")));
            title->kids.push_back(chip(L"Zulu"));
            info->kids.push_back(std::move(title));
            info->kids.push_back(text(format_bytes(z.bytes) + L" · " + z.java_path, 9.5f, 400,
                                      ui_token(L"faint"), -1.0f, true));
            zr->kids.push_back(std::move(info));
            if (!java_path_.empty() && _wcsicmp(java_path_.c_str(), z.java_path.c_str()) == 0) {
                zr->kids.push_back(text(L"đang dùng", 10.0f, 700, ui_token(L"accent")));
            } else {
                zr->kids.push_back(button(L"Dùng", L"settings:java-use-z:" + std::to_wstring(i),
                                          false, L"", 26.0f));
            }
            if (zulu_confirm_ == z.java_path) {
                auto confirm = box(Kind::Row, 28.0f, 6.0f);
                confirm->kids.push_back(button(L"Huỷ", L"settings:zulu-cancel", false, L"", 26.0f));
                confirm->kids.push_back(button(L"Xoá", L"settings:zulu-delete:" + std::to_wstring(i),
                                               false, L"", 26.0f));
                zr->kids.push_back(std::move(confirm));
            } else {
                auto del = box(Kind::Row, 26.0f);
                del->style.width = 26.0f;
                del->style.radius = 7.0f;
                del->style.bg = ui_token(L"input");
                del->style.border = true;
                del->style.border_color = ui_token(L"border");
                del->action = L"settings:zulu-ask:" + std::to_wstring(i);
                del->kids.push_back(spacer(0, 0, true));
                del->kids.push_back(image(asset(L"assets/icons/trash.svg"), 13.0f, 13.0f, 0.0f,
                                          Color::rgb(0xEF4444)));
                del->kids.push_back(spacer(0, 0, true));
                zr->kids.push_back(std::move(del));
            }
            zulu_card->kids.push_back(std::move(zr));
        }
        if (!java_state_.external.empty()) {
            zulu_card->kids.push_back(sep());
            auto head = box(Kind::Row, 26.0f);
            head->style.pad_l = head->style.pad_r = 16.0f;
            head->kids.push_back(text(L"Java khác trên máy", 10.0f, 500, ui_token(L"faint")));
            zulu_card->kids.push_back(std::move(head));
        }
        for (size_t i = 0; i < java_state_.external.size(); ++i) {
            const ExternalJava& ext = java_state_.external[i];
            zulu_card->kids.push_back(sep());
            auto er = box(Kind::Row, 44.0f, 10.0f);
            er->style.pad_l = er->style.pad_r = 16.0f;
            er->kids.push_back(image(asset(L"assets/icons/coffee.svg"), 15.0f, 15.0f, 0.0f,
                                     ui_token(L"label")));
            auto info = box(Kind::Column, -1.0f, 2.0f);
            info->style.grow_x = true;
            auto title = box(Kind::Row, 18.0f, 8.0f);
            title->kids.push_back(text(ext.major ? L"Java " + std::to_wstring(ext.major) : ext.name,
                                       11.0f, 600, ui_token(L"text")));
            title->kids.push_back(chip(L"có sẵn"));
            info->kids.push_back(std::move(title));
            info->kids.push_back(text(ext.java_path, 9.5f, 400, ui_token(L"faint"), -1.0f, true));
            er->kids.push_back(std::move(info));
            if (!java_path_.empty() && _wcsicmp(java_path_.c_str(), ext.java_path.c_str()) == 0) {
                er->kids.push_back(text(L"đang dùng", 10.0f, 700, ui_token(L"accent")));
            } else {
                er->kids.push_back(button(L"Dùng", L"settings:java-use-e:" + std::to_wstring(i),
                                          false, L"", 26.0f));
            }
            zulu_card->kids.push_back(std::move(er));
        }
    }
    root->kids.push_back(std::move(zulu_card));

    auto override_card = card();
    {
        auto orow = box(Kind::Row, -1.0f, 12.0f);
        orow->style.pad_l = orow->style.pad_r = 16.0f;
        orow->style.pad_t = orow->style.pad_b = 12.0f;
        orow->kids.push_back(icon_tile(L"assets/icons/hard-drive.svg", ui_token(L"accent")));
        auto info = box(Kind::Column, -1.0f, 2.0f);
        info->style.grow_x = true;
        info->kids.push_back(text(L"Ghi đè Java (nâng cao)", 12.0f, 600, ui_token(L"text")));
        info->kids.push_back(text(java_path_.empty() ? L"Để trống = dùng Java tải kèm ở trên"
                                                     : java_path_,
                                  10.0f, 400, ui_token(L"faint"), -1.0f, false, true));
        orow->kids.push_back(std::move(info));
        auto field = box(Kind::Row, 28.0f);
        field->style.width = 200.0f;
        field->style.pad_l = field->style.pad_r = 10.0f;
        field->style.radius = 8.0f;
        field->style.bg = ui_token(L"input");
        field->style.border = true;
        field->style.border_color = ui_token(L"border");
        field->action = L"settings:java-browse";
        field->kids.push_back(text(java_path_.empty() ? L"Tự động phát hiện" : java_path_, 10.0f,
                                   400, ui_token(L"label"), 180.0f, true));
        orow->kids.push_back(std::move(field));
        orow->kids.push_back(button(L"Chọn", L"settings:java-browse", false));
        if (!java_path_.empty())
            orow->kids.push_back(button(L"Xoá", L"settings:java-clear", false));
        override_card->kids.push_back(std::move(orow));
    }
    root->kids.push_back(std::move(override_card));

    // ---- Cập nhật --------------------------------------------------------
    section(L"Cập nhật", L"v" + version);
    auto updates = card();
    updates->kids.push_back(row(
        L"assets/icons/arrows-clockwise.svg", L"Tự động cập nhật",
        L"Tự kiểm tra bản mới trên GitHub, tải sẵn và tự cài khi bạn thoát launcher.",
        toggle(auto_update_, L"settings:auto-update")));
    updates->kids.push_back(sep());
    updates->kids.push_back(row(
        L"assets/icons/sparkle.svg", L"Có gì mới trong bản này",
        L"Xem lại ghi chú phát hành của phiên bản đang chạy (tự hiện một lần sau khi cập nhật).",
        button(L"Xem", L"settings:whats-new", false)));
    updates->kids.push_back(sep());
    updates->kids.push_back(row(
        L"assets/icons/download-simple.svg", L"Phiên bản launcher", L"Chưa kiểm tra.",
        button(L"Kiểm tra", L"settings:update-check", false,
               L"assets/icons/arrows-clockwise.svg")));
    root->kids.push_back(std::move(updates));

    // ---- Máy tính --------------------------------------------------------
    section(L"Máy tính", platform_arch);
    auto machine_row = box(Kind::Row, -1.0f, 12.0f);
    auto meter_card = card();
    meter_card->style.grow_x = true;
    {
        auto inner = box(Kind::Column, -1.0f, 12.0f);
        inner->style.pad_l = inner->style.pad_r = 16.0f;
        inner->style.pad_t = inner->style.pad_b = 16.0f;
        auto meter = [&](const std::wstring& label, unsigned long long used,
                         unsigned long long total, Color color) {
            auto col = box(Kind::Column, -1.0f, 6.0f);
            auto head = box(Kind::Row, 16.0f);
            head->kids.push_back(text(label, 11.0f, 600, ui_token(L"text")));
            head->kids.push_back(spacer(0, 0, true));
            float pct = total ? float(double(used) / double(total)) : 0.0f;
            wchar_t value[96];
            swprintf(value, 96, L"%ls / %ls · %d%%", format_bytes(used).c_str(),
                     format_bytes(total).c_str(), int(pct * 100.0f + 0.5f));
            head->kids.push_back(text(value, 9.5f, 400, ui_token(L"faint"), -1.0f, true));
            col->kids.push_back(std::move(head));
            auto track = box(Kind::Row, 6.0f);
            track->style.radius = 3.0f;
            track->style.bg = ui_token(L"input");
            if (pct > 0.001f) {
                auto fill = spacer(std::max(6.0f, 300.0f * pct), 6.0f);
                fill->style.radius = 3.0f;
                fill->style.bg = color;
                track->kids.push_back(std::move(fill));
            }
            track->kids.push_back(spacer(0, 0, true));
            col->kids.push_back(std::move(track));
            return col;
        };
        if (system_info_.ok) {
            unsigned long long ram_used =
                system_info_.total_mem > system_info_.free_mem
                    ? system_info_.total_mem - system_info_.free_mem
                    : 0;
            unsigned long long disk_used =
                system_info_.disk_total > system_info_.disk_free
                    ? system_info_.disk_total - system_info_.disk_free
                    : 0;
            inner->kids.push_back(meter(L"RAM", ram_used, system_info_.total_mem,
                                        ui_token(L"accent")));
            inner->kids.push_back(meter(L"Ổ đĩa", disk_used, system_info_.disk_total,
                                        Color::rgb(0x22C55E)));
        } else {
            inner->kids.push_back(text(L"Đang đọc thông tin hệ thống…", 10.0f, 400,
                                       ui_token(L"faint")));
        }
        meter_card->kids.push_back(std::move(inner));
    }
    machine_row->kids.push_back(std::move(meter_card));

    auto facts_card = card();
    facts_card->style.grow_x = true;
    {
        auto inner = box(Kind::Column, -1.0f, 9.0f);
        inner->style.pad_l = inner->style.pad_r = 16.0f;
        inner->style.pad_t = inner->style.pad_b = 16.0f;
        auto fact = [&](const std::wstring& label, const std::wstring& value, bool mono = false) {
            auto line = box(Kind::Row, 16.0f);
            line->kids.push_back(text(label, 10.0f, 400, ui_token(L"faint")));
            line->kids.push_back(spacer(0, 0, true));
            line->kids.push_back(text(value, 10.0f, 500, ui_token(L"label"), -1.0f, mono));
            return line;
        };
        if (system_info_.ok) {
            inner->kids.push_back(fact(L"CPU", std::to_wstring(system_info_.cpu_threads) +
                                                  L" nhân"));
            inner->kids.push_back(fact(L"Nền tảng", platform_arch));
            inner->kids.push_back(fact(L"Dung lượng RAM",
                                       format_bytes(system_info_.total_mem), true));
            inner->kids.push_back(fact(L"Ổ đĩa trống", format_bytes(system_info_.disk_free),
                                       true));
            inner->kids.push_back(fact(L"Tài nguyên đã tải",
                                       format_bytes(system_info_.assets_bytes), true));
            inner->kids.push_back(fact(L"Java tải kèm",
                                       std::to_wstring(java_installed) + L" bản · " +
                                           format_bytes(java_bytes), true));
        } else {
            inner->kids.push_back(text(L"Đang đọc thông tin hệ thống…", 10.0f, 400,
                                       ui_token(L"faint")));
        }
        facts_card->kids.push_back(std::move(inner));
    }
    machine_row->kids.push_back(std::move(facts_card));
    root->kids.push_back(std::move(machine_row));

    // ---- Về XyoLauncher --------------------------------------------------
    section(L"Về XyoLauncher", L"v" + version);
    auto about = card();
    {
        auto inner = box(Kind::Column, -1.0f, 9.0f);
        inner->style.pad_l = inner->style.pad_r = 16.0f;
        inner->style.pad_t = inner->style.pad_b = 16.0f;
        auto fact = [&](const std::wstring& label, const std::wstring& value, bool mono = true) {
            auto line = box(Kind::Row, 16.0f);
            line->kids.push_back(text(label, 10.0f, 400, ui_token(L"faint")));
            line->kids.push_back(spacer(0, 0, true));
            line->kids.push_back(text(value, 10.0f, 500, ui_token(L"label"), -1.0f, mono));
            return line;
        };
        inner->kids.push_back(fact(L"Phiên bản launcher", L"v" + version));
        inner->kids.push_back(fact(L"Nền tảng", platform_arch, false));
        inner->kids.push_back(fact(L"Nhà phát triển", L"XyoLauncher", false));
        inner->kids.push_back(sep());
        inner->kids.push_back(text(
            L"Java được tải tự động theo phiên bản game và dùng chung cho mọi phiên bản cùng "
            L"nhóm. Vào tab Phiên bản để tạo phiên bản mới.",
            10.0f, 400, ui_token(L"faint"), -1.0f, false, true));
        about->kids.push_back(std::move(inner));
    }
    root->kids.push_back(std::move(about));
    root->kids.push_back(spacer(0, 20));

    settings_ = std::move(root);
    hovered_ = nullptr;
}

// Fixed sidebar perspective pose (no depth animation).
static constexpr float kSidebarDepth = 0.155f;

// Must mirror Renderer::draw_sidebar_3d (rotation about the left edge, depth 900).
static QuadMap sidebar_quad(const D2D1_RECT_F& rect, float depth) {
    float w = rect.right - rect.left;
    float h = rect.bottom - rect.top;
    float radians = std::fabs(depth) * 3.14159265f;
    float z = w * std::sin(radians);
    float scale = 900.0f / (900.0f + z);
    float rx = w * 0.5f + (w * std::cos(radians) - w * 0.5f) * scale;
    float inset_y = h * 0.5f * (1.0f - scale);
    return quad_map(rect.left, rect.top, rect.left + rx, rect.top + inset_y,
                    rect.left + rx, rect.bottom - inset_y, rect.left, rect.bottom);
}
void App::sidebar_project(float u, float v, float& x, float& y) const {
    quad_project(sidebar_quad(sidebar_rect_, kSidebarDepth), u, v, x, y);
}

bool App::sidebar_unproject(float x, float y, float& u, float& v) const {
    return quad_unproject(sidebar_quad(sidebar_rect_, kSidebarDepth), x, y, u, v);
}

Node* App::hit_test(float x, float y) {
    if (menu_open_) {
        if (Node* menu_hit = ui_hit(menu_.get(), x, y)) return menu_hit;
    }
    if (versions_menu_open_) {
        if (x >= versions_menu_rect_.left && x <= versions_menu_rect_.right &&
            y >= versions_menu_rect_.top && y <= versions_menu_rect_.bottom) {
            if (Node* item = ui_hit(versions_menu_.get(), x, y)) return item;
        }
    }
    if (sidebar3d_active_ && sidebar_rect_.right > sidebar_rect_.left) {
        float u = 0.0f, v = 0.0f;
        if (sidebar_unproject(x, y, u, v)) {
            float w = sidebar_rect_.right - sidebar_rect_.left;
            float h = sidebar_rect_.bottom - sidebar_rect_.top;
            if (Node* sidebar_hit = ui_hit(ui_.get(), sidebar_rect_.left + u * w,
                                           sidebar_rect_.top + v * h))
                return sidebar_hit;
        }
    }
    if (page_ == L"home" && home_ && x >= home_slot_rect_.left &&
        x <= home_slot_rect_.right && y >= home_slot_rect_.top && y <= home_slot_rect_.bottom) {
        if (Node* home_hit = ui_hit(home_.get(), x, y)) return home_hit;
    }
    if (page_ == L"settings" && settings_ && x >= settings_slot_rect_.left &&
        x <= settings_slot_rect_.right && y >= settings_slot_rect_.top &&
        y <= settings_slot_rect_.bottom) {
        if (Node* settings_hit = ui_hit(settings_.get(), x, y)) return settings_hit;
    }
    if (page_ == L"versions" && versions_ui_) {
        if (versions_picker_) {
            if (x >= versions_slot_rect_.left && x <= versions_slot_rect_.right &&
                y >= versions_slot_rect_.top && y <= versions_slot_rect_.bottom) {
                if (Node* hit = ui_hit(versions_ui_.get(), x, y)) return hit;
            }
        } else {
            const D2D1_RECT_F* areas[3] = { &versions_list_rect_, &versions_aside_rect_,
                                            &versions_footer_rect_ };
            Node* trees[3] = { versions_ui_.get(), versions_aside_.get(), versions_footer_.get() };
            for (int i = 0; i < 3; ++i) {
                const auto& area = *areas[i];
                if (!trees[i]) continue;
                if (x >= area.left && x <= area.right && y >= area.top && y <= area.bottom) {
                    if (Node* hit = ui_hit(trees[i], x, y)) return hit;
                }
            }
        }
    }
    ui_set_skip_id(sidebar3d_active_ ? L"sidebar" : L"");
    Node* hit = ui_hit(ui_.get(), x, y);
    ui_set_skip_id(L"");
    return hit;
}

void App::update_sidebar_lift(Node* hit) {
    Node* target = nullptr;
    if (hit && sidebar_rect_.right > sidebar_rect_.left && hit->style.no_hover_bg &&
        hit->rect.left >= sidebar_rect_.left - 1.0f &&
        hit->rect.right <= sidebar_rect_.right + 1.0f &&
        hit->rect.top >= sidebar_rect_.top - 1.0f &&
        hit->rect.bottom <= sidebar_rect_.bottom + 1.0f)
        target = hit;
    if (target == sidebar_item_) return;
    sidebar_item_ = target;
    sidebar_rise_ = 0.0f;
    if (!target) {
        anims_.cancel(L"sidebar.rise");
        sidebar_item_valid_ = false;
        InvalidateRect(hwnd_, nullptr, FALSE);
        return;
    }
    anims_.run(L"sidebar.rise", 0.0f, 1.0f, 240, anim_ease::Spring,
               [this](float v) { sidebar_rise_ = v; });
    SetTimer(hwnd_, 2, 16, nullptr);
}

void App::clear_sidebar_lift() {
    anims_.cancel(L"sidebar.rise");
    sidebar_item_ = nullptr;
    sidebar_rise_ = 0.0f;
    sidebar_item_valid_ = false;
}

void App::do_action(const std::wstring& action) {
    if (action == L"toggle:theme") {
        toggle_theme();
    } else if (action == L"menu:account") {
        toggle_account_menu();
    } else if (action.rfind(L"home:tab:", 0) == 0) {
        home_tab_ = std::stoi(action.substr(9));
        home_scroll_ = 0.0f;
        rebuild_home();
        ui_apply_page();
    } else if (action == L"home:launch") {
        const InstanceInfo* active = nullptr;
        for (const auto& inst : instances_)
            if (inst.status == L"running" || inst.status == L"starting" || inst.status == L"stopping") {
                active = &inst;
                break;
            }
        if (!active && !instances_.empty()) active = &instances_.front();
        if (active) launch_instance(active->id);
    } else if (action == L"home:open") {
        const InstanceInfo* active = nullptr;
        for (const auto& inst : instances_)
            if (inst.status == L"running" || inst.status == L"starting") {
                active = &inst;
                break;
            }
        if (!active && !instances_.empty()) active = &instances_.front();
        if (active) open_console(active->id);
    } else if (action.rfind(L"instance:open:", 0) == 0) {
        open_console(action.substr(14));
    } else if (action == L"console:play") {
        launch_instance(launch_ui_.id);
    } else if (action == L"console:stop") {
        stop_instance(launch_ui_.id);
    } else if (action == L"console:back") {
        page_ = L"home";
        rebuild_home();
        ui_apply_page();
    } else if (action == L"home:play-world") {
        const InstanceInfo* active = instances_.empty() ? nullptr : &instances_.front();
        for (const auto& inst : instances_)
            if (inst.status == L"running" || inst.status == L"starting") {
                active = &inst;
                break;
            }
        if (active && !active->worlds.empty())
            launch_instance(active->id, L"world", active->worlds.front().folder);
    } else if (action == L"home:play-server") {
        const InstanceInfo* active = instances_.empty() ? nullptr : &instances_.front();
        for (const auto& inst : instances_)
            if (inst.status == L"running" || inst.status == L"starting") {
                active = &inst;
                break;
            }
        if (active && !active->servers.empty()) {
            const auto& srv = active->servers.front();
            std::wstring address = srv.host;
            if (srv.port != 0 && srv.port != 25565)
                address += L":" + std::to_wstring(srv.port);
            launch_instance(active->id, L"server", address);
        }
    } else if (action == L"home:open-shared") {
        ShellExecuteW(nullptr, L"open", shared_dir_.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
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
    } else if (action.rfind(L"window:", 0) == 0) {
        if (action == L"window:minimize")
            ShowWindow(hwnd_, SW_MINIMIZE);
        else if (action == L"window:maximize")
            ShowWindow(hwnd_, IsZoomed(hwnd_) ? SW_RESTORE : SW_MAXIMIZE);
        else
            PostMessageW(hwnd_, WM_CLOSE, 0, 0);
    } else if (action == L"settings:save") {
        save_user_setting("javaPath", Json::string(wide_to_utf8(java_path_)));
        notify(L"Cài đặt", L"Đã lưu cài đặt.", L"success");
    } else if (action == L"settings:lang-vi") {
        settings_lang_en_ = false;
        rebuild_settings();
    } else if (action == L"settings:lang-en") {
        notify(L"Ngôn ngữ", L"Engine hiện chỉ hỗ trợ tiếng Việt.", L"info");
    } else if (action == L"settings:effects") {
        effects_enabled_ = !effects_enabled_;
        save_user_setting("effects", Json::boolean(effects_enabled_));
        rebuild_settings();
    } else if (action == L"settings:hide-launch") {
        hide_on_launch_ = !hide_on_launch_;
        save_user_setting("hideOnLaunch", Json::boolean(hide_on_launch_));
        rebuild_settings();
    } else if (action == L"settings:rpc") {
        rich_presence_ = !rich_presence_;
        save_user_setting("discordRpc", Json::boolean(rich_presence_));
        rebuild_settings();
    } else if (action == L"settings:auto-update") {
        auto_update_ = !auto_update_;
        save_user_setting("autoUpdate", Json::boolean(auto_update_));
        rebuild_settings();
    } else if (action == L"settings:discord-join") {
        ShellExecuteW(nullptr, L"open", discord_invite_.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    } else if (action == L"settings:bg-theme") {
        apply_background(L"theme");
    } else if (action.rfind(L"settings:bg-apply:", 0) == 0) {
        apply_background(action.substr(18));
    } else if (action.rfind(L"settings:bg-download:", 0) == 0) {
        start_background_download(action.substr(21));
    } else if (action == L"settings:java-refresh") {
        java_state_ = JavaState{};
        load_java_state_async(true);
    } else if (action == L"settings:java-browse") {
        browse_java_exe();
    } else if (action == L"settings:java-clear") {
        java_path_.clear();
        save_user_setting("javaPath", Json::string(""));
        rebuild_settings();
    } else if (action.rfind(L"settings:java-use-z:", 0) == 0) {
        size_t index = size_t(std::stoul(action.substr(19)));
        if (index < java_state_.zulu.size()) {
            java_path_ = java_state_.zulu[index].java_path;
            save_user_setting("javaPath", Json::string(wide_to_utf8(java_path_)));
            rebuild_settings();
        }
    } else if (action.rfind(L"settings:java-use-e:", 0) == 0) {
        size_t index = size_t(std::stoul(action.substr(19)));
        if (index < java_state_.external.size()) {
            java_path_ = java_state_.external[index].java_path;
            save_user_setting("javaPath", Json::string(wide_to_utf8(java_path_)));
            rebuild_settings();
        }
    } else if (action.rfind(L"settings:java-ask:", 0) == 0) {
        java_confirm_ = action.substr(17);
        rebuild_settings();
    } else if (action == L"settings:java-cancel") {
        java_confirm_.clear();
        rebuild_settings();
    } else if (action.rfind(L"settings:java-delete:", 0) == 0) {
        std::wstring component = action.substr(20);
        for (const auto& rt : java_state_.managed)
            if (rt.component == component) { remove_java_dir(rt.dir); break; }
        java_confirm_.clear();
        rebuild_settings();
    } else if (action.rfind(L"settings:java-install:", 0) == 0) {
        notify(L"Java", L"Tính năng tải Java runtime sẽ được port sau.", L"info");
    } else if (action == L"settings:zulu-major") {
        static const wchar_t* values[] = { L"8", L"11", L"17", L"21", L"25" };
        int index = 0;
        for (int i = 0; i < 5; ++i)
            if (zulu_major_ == values[i]) index = i;
        zulu_major_ = values[(index + 1) % 5];
        rebuild_settings();
    } else if (action == L"settings:zulu-kind") {
        zulu_kind_ = zulu_kind_ == L"jre" ? L"jdk" : L"jre";
        rebuild_settings();
    } else if (action == L"settings:zulu-download") {
        notify(L"Azul Zulu", L"Tính năng tải Java Zulu sẽ được port sau.", L"info");
    } else if (action.rfind(L"settings:zulu-ask:", 0) == 0) {
        size_t index = size_t(std::stoul(action.substr(17)));
        if (index < java_state_.zulu.size()) {
            zulu_confirm_ = java_state_.zulu[index].java_path;
            rebuild_settings();
        }
    } else if (action == L"settings:zulu-cancel") {
        zulu_confirm_.clear();
        rebuild_settings();
    } else if (action.rfind(L"settings:zulu-delete:", 0) == 0) {
        size_t index = size_t(std::stoul(action.substr(20)));
        if (index < java_state_.zulu.size()) remove_java_dir(java_state_.zulu[index].dir);
        zulu_confirm_.clear();
        rebuild_settings();
    } else if (action == L"settings:update-check") {
        notify(L"Cập nhật", L"Bạn đang dùng bản mới nhất (v2.0.0).", L"success");
    } else if (action == L"settings:whats-new") {
        notify(L"XyoLauncher+ 2.0.0",
               L"Engine native: sidebar 3D, tài khoản, trang chủ và hệ thống đầy đủ.", L"info");
    } else if (action.rfind(L"versions:loader:", 0) == 0) {
        versions_pick_loader(action.substr(16));
    } else if (action == L"versions:change-loader") {
        versions_picker_ = true;
        versions_menu_open_ = false;
        versions_focus_ = 0;
        versions_scroll_ = 0.0f;
        rebuild_versions();
    } else if (action.rfind(L"versions:pick:", 0) == 0) {
        versions_pick_game(action.substr(14));
    } else if (action == L"versions:snapshots") {
        versions_snapshots_ = !versions_snapshots_;
        versions_visible_ = 50;
        versions_scroll_ = 0.0f;
        rebuild_versions();
        ui_apply_page();
    } else if (action == L"versions:more") {
        versions_visible_ += 80;
        rebuild_versions();
    } else if (action == L"versions:refresh") {
        load_home_async();
        if (versions_loader_ != L"vanilla") {
            load_loader_games_async(versions_loader_);
            if (!versions_picked_.empty())
                load_loader_builds_async(versions_loader_, versions_picked_);
        }
        rebuild_versions();
    } else if (action == L"versions:import") {
        notify(L"Nhập profile", L"Tính năng nhập modpack sẽ có ở bản sau.", L"info");
    } else if (action == L"versions:focus-query") {
        versions_focus_ = 1;
        SetTimer(hwnd_, 2, 16, nullptr);
        InvalidateRect(hwnd_, nullptr, FALSE);
    } else if (action == L"versions:focus-name") {
        versions_focus_ = 2;
        SetTimer(hwnd_, 2, 16, nullptr);
        InvalidateRect(hwnd_, nullptr, FALSE);
    } else if (action == L"versions:build-menu") {
        if (versions_menu_open_)
            versions_close_build_menu();
        else
            versions_open_build_menu();
    } else if (action.rfind(L"versions:build:", 0) == 0) {
        size_t index = size_t(std::max(0, _wtoi(action.substr(15).c_str())));
        if (index < builds_.size()) versions_build_ = builds_[index].version;
        versions_focus_ = 0;
        versions_close_build_menu();
        rebuild_versions();
    } else if (action == L"versions:demo") {
        versions_demo_ = !versions_demo_;
        rebuild_versions();
    } else if (action.rfind(L"versions:mem:", 0) == 0) {
        versions_memory_ = std::clamp(_wtoi(action.substr(13).c_str()), 1024, 16384);
        rebuild_versions();
    } else if (action == L"versions:dir") {
        versions_browse_dir();
    } else if (action == L"versions:create") {
        versions_create_instance();
    } else if (action.rfind(L"nav:", 0) == 0) {
        page_ = action.substr(4);
        close_account_menu();
        if (page_ != L"versions") {
            versions_menu_open_ = false;
            versions_focus_ = 0;
        }
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
    if (anims_.tick(now)) busy = true;
    if (bg_flipping_ && !anims_.active(L"background.flip")) {
        bg_flipping_ = false;
        bg_flip_t_ = 0.0f;
        if (Node* root = ui_find(ui_.get(), L"root"))
            root->style.bg_image = background_file(background_id_);
        InvalidateRect(hwnd_, nullptr, FALSE);
    }
    update_toasts(now);
    if (page_ == L"console" && console_dirty_) {
        rebuild_console();
        dirty_ = true;
        busy = true;
    }
    if (page_ == L"versions" && versions_focus_) busy = true;
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
    std::wstring wallpaper = background_file(background_id_);
    if (!wallpaper.empty()) {
        float wdip = float(rc.right - rc.left) / renderer_.scale();
        float hdip = float(rc.bottom - rc.top) / renderer_.scale();
        if (renderer_.ensure_glass_bitmap(wallpaper, wdip, hdip, 22.0f))
            ui_set_glass(true, renderer_.glass_bitmap());
        else
            ui_set_glass(true, nullptr);
    } else {
        ui_set_glass(false, nullptr);
    }
    Node* sidebar_node = ui_find(ui_.get(), L"sidebar");
    bool captured = false;
    bool item_captured = false;
    if (sidebar_node) sidebar_rect_ = sidebar_node->rect;
    if (sidebar_item_ && sidebar_rise_ > 0.01f && sidebar_rect_.right > sidebar_rect_.left) {
        const float pad = 10.0f;
        D2D1_RECT_F row = sidebar_item_->rect;
        sidebar_item_rect_ = D2D1::RectF(row.left - pad, row.top - pad, row.right + pad,
                                         row.bottom + pad);
        float iw = sidebar_item_rect_.right - sidebar_item_rect_.left;
        float ih = sidebar_item_rect_.bottom - sidebar_item_rect_.top;
        ui_set_skip_id(L"");
        if (renderer_.capture_item_begin(iw, ih, sidebar_item_rect_.left,
                                         sidebar_item_rect_.top)) {
            ui_draw(sidebar_item_, renderer_, hovered_);
            renderer_.capture_item_end();
            item_captured = true;
            sidebar_item_valid_ = true;
        }
    }
    if (sidebar_node) {
        ui_set_skip_id(L"");
        ui_set_skip_node(item_captured ? sidebar_item_ : nullptr);
        float sidebar_w = sidebar_rect_.right - sidebar_rect_.left;
        float sidebar_h = sidebar_rect_.bottom - sidebar_rect_.top;
        if (renderer_.capture_begin(sidebar_w, sidebar_h, sidebar_rect_.left, sidebar_rect_.top)) {
            ui_draw(sidebar_node, renderer_, hovered_);
            renderer_.capture_end();
            captured = true;
        }
        ui_set_skip_node(nullptr);
    }
    bool use3d = captured && renderer_.sidebar_3d_ready();
    renderer_.begin(ui_color(L"bg"));
    if (bg_flipping_ && renderer_.ready()) {
        renderer_.end_main();
        renderer_.draw_wallpaper_flip(bg_flip_from_, bg_flip_to_, bg_flip_t_);
        renderer_.begin_overlay();
    }
    ui_set_skip_id(use3d ? L"sidebar" : L"");
    ui_draw(ui_.get(), renderer_, hovered_);
    ui_set_skip_id(L"");
    if (page_ == L"home" && home_) {
        layout_home();
        renderer_.clip_push(home_slot_rect_);
        ui_draw(home_.get(), renderer_, hovered_);
        renderer_.clip_pop();
    } else if (page_ == L"settings" && settings_) {
        layout_settings();
        renderer_.clip_push(settings_slot_rect_);
        ui_draw(settings_.get(), renderer_, hovered_);
        renderer_.clip_pop();
    } else if (page_ == L"versions" && versions_ui_) {
        layout_versions();
        renderer_.clip_push(versions_slot_rect_);
        if (versions_picker_) {
            ui_draw(versions_ui_.get(), renderer_, hovered_);
        } else {
            renderer_.clip_push(versions_list_rect_);
            ui_draw(versions_ui_.get(), renderer_, hovered_);
            renderer_.clip_pop();
            if (versions_aside_) {
                renderer_.clip_push(versions_aside_rect_);
                ui_draw(versions_aside_.get(), renderer_, hovered_);
                renderer_.clip_pop();
            }
            if (versions_footer_) {
                renderer_.clip_push(versions_footer_rect_);
                ui_draw(versions_footer_.get(), renderer_, hovered_);
                renderer_.clip_pop();
            }
            if (versions_mem_track_.right - versions_mem_track_.left > 10.0f) {
                float ratio = float(versions_memory_ - 1024) / float(16384 - 1024);
                float cy = (versions_mem_track_.top + versions_mem_track_.bottom) * 0.5f;
                float lx = versions_mem_track_.left, rx = versions_mem_track_.right;
                renderer_.fill_rect(D2D1::RectF(lx, cy - 3.0f, rx, cy + 3.0f), 3.0f,
                                    ui_color(L"border"));
                renderer_.fill_rect(
                    D2D1::RectF(lx, cy - 3.0f, lx + (rx - lx) * ratio, cy + 3.0f), 3.0f,
                    ui_color(L"accent"));
                float kx = lx + (rx - lx) * ratio;
                renderer_.fill_rect(D2D1::RectF(kx - 6.0f, cy - 6.0f, kx + 6.0f, cy + 6.0f),
                                    6.0f, ui_token(L"text"));
                renderer_.stroke_rect(D2D1::RectF(kx - 6.0f, cy - 6.0f, kx + 6.0f, cy + 6.0f),
                                      6.0f, ui_color(L"border"), 1.0f);
            }
        }
        if (versions_focus_) {
            Node* field = ui_find(versions_focus_ == 1 ? versions_ui_.get() : versions_aside_.get(),
                                  versions_focus_ == 1 ? L"versions-query-text"
                                                       : L"versions-name-text");
            if (field && (GetTickCount64() / 500) % 2 == 0) {
                std::wstring value = versions_focus_ == 1 ? versions_query_ : versions_name_;
                SizeF m = renderer_.measure_text(value, field->style.font_size, field->style.weight,
                                                 false, 10000.0f, 200.0f, false);
                float cx = field->rect.left + (value.empty() ? 0.0f : m.w) + 1.0f;
                float line_h = field->style.font_size * 1.35f;
                float top = (field->rect.top + field->rect.bottom) * 0.5f - line_h * 0.5f;
                renderer_.fill_rect(D2D1::RectF(cx, top, cx + 1.0f, top + line_h), 0.0f,
                                    ui_color(L"accent"), 0.9f);
            }
        }
        renderer_.clip_pop();
    }
    bool main_ok = renderer_.end_main();
    sidebar3d_active_ = false;
    if (use3d && main_ok)
        sidebar3d_active_ = renderer_.draw_sidebar_3d(sidebar_rect_, kSidebarDepth * 180.0f);
    if (sidebar3d_active_ && sidebar_item_valid_ && sidebar_rise_ > 0.005f)
        renderer_.draw_sidebar_item_3d(sidebar_item_rect_, sidebar_rect_,
                                       kSidebarDepth * 180.0f, sidebar_rise_);
    renderer_.begin_overlay();
    draw_account_menu();
    draw_versions_popup();
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
    if (!mouse_tracking_) {
        TRACKMOUSEEVENT track{};
        track.cbSize = sizeof(track);
        track.dwFlags = TME_LEAVE;
        track.hwndTrack = hwnd_;
        mouse_tracking_ = TrackMouseEvent(&track) != FALSE;
    }
    mouse_x_ = float(px) / renderer_.scale();
    mouse_y_ = float(py) / renderer_.scale();
    if (splash_active()) return;
    if (modal_open_) {
        hovered_ = nullptr;
        SetCursor(LoadCursorW(nullptr, IDC_ARROW));
        return;
    }
    if (versions_mem_drag_) {
        hovered_ = nullptr;
        versions_memory_from_x(float(px) / renderer_.scale());
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
    Node* hit = hit_test(x, y);
    update_sidebar_lift(hit);
    if (hit != hovered_) {
        hovered_ = hit;
        InvalidateRect(hwnd_, nullptr, FALSE);
    }
    SetCursor(LoadCursorW(nullptr, hit && !hit->action.empty() ? IDC_HAND : IDC_ARROW));
}

void App::on_mouse_leave() {
    mouse_tracking_ = false;
    update_sidebar_lift(nullptr);
    if (hovered_) {
        hovered_ = nullptr;
        InvalidateRect(hwnd_, nullptr, FALSE);
    }
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
        anims_.cancel(L"sidebar.pill");
        return;
    }
    float target = nav->rect.top;
    if (pill_pending_) {
        pill_cur_ = target;
        pill_pending_ = false;
        ui_set_sidebar_pill(target, true);
        return;
    }
    if (std::fabs(target - pill_cur_) < 0.5f) {
        anims_.cancel(L"sidebar.pill");
        ui_set_sidebar_pill(pill_cur_, true);
        return;
    }
    anims_.run(L"sidebar.pill", pill_cur_, target, 500, anim_ease::Spring,
               [this](float v) {
                   pill_cur_ = v;
                   ui_set_sidebar_pill(v, true);
               });
    SetTimer(hwnd_, 2, 16, nullptr);
}

void App::toggle_account_menu() {
    if (menu_open_) {
        close_account_menu();
        return;
    }
    menu_open_ = true;
    menu_t_ = 0.0f;
    caret_from_ = caret_cur_;
    caret_to_ = 180.0f;
    anims_.run(L"menu.open", 0.0f, 1.0f, 200, anim_ease::Menu,
               [this](float v) { menu_t_ = v; });
    anims_.run(L"menu.caret", caret_from_, caret_to_, 220, anim_ease::Spring,
               [this](float v) {
                   caret_cur_ = v;
                   ui_set_caret_angle(v);
               });
    if (Node* acct = ui_find(ui_.get(), L"acct-btn"))
        acct->style.bg = ui_token(L"surfaceActive");
    SetTimer(hwnd_, 2, 16, nullptr);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::close_account_menu() {
    if (!menu_open_) return;
    menu_open_ = false;
    anims_.cancel(L"menu.open");
    menu_t_ = 1.0f;
    hovered_ = nullptr;
    caret_from_ = caret_cur_;
    caret_to_ = 0.0f;
    anims_.run(L"menu.caret", caret_from_, caret_to_, 220, anim_ease::Spring,
               [this](float v) {
                   caret_cur_ = v;
                   ui_set_caret_angle(v);
               });
    if (Node* acct = ui_find(ui_.get(), L"acct-btn"))
        acct->style.bg = ui_token(page_ == L"accounts" ? L"surfaceActive" : L"hover");
    SetTimer(hwnd_, 2, 16, nullptr);
    InvalidateRect(hwnd_, nullptr, FALSE);
}

void App::on_key_down(WPARAM key) {
    if (account_modal_key(key)) return;
    if (page_ == L"versions") {
        if (key == VK_ESCAPE) {
            if (versions_menu_open_) {
                versions_close_build_menu();
                return;
            }
            if (versions_focus_) {
                versions_focus_ = 0;
                InvalidateRect(hwnd_, nullptr, FALSE);
                return;
            }
        }
        if (versions_focus_ && key == VK_BACK) {
            std::wstring& value = versions_focus_ == 1 ? versions_query_ : versions_name_;
            if (!value.empty()) {
                value.pop_back();
                if (versions_focus_ == 1) versions_visible_ = 50;
                rebuild_versions();
                dirty_ = true;
                InvalidateRect(hwnd_, nullptr, FALSE);
            }
            return;
        }
    }
    if (key == VK_ESCAPE) close_account_menu();
}

void App::on_char(wchar_t ch) {
    if (modal_open_) {
        account_modal_char(ch);
        return;
    }
    if (page_ == L"versions" && versions_focus_ && ch >= 32) {
        std::wstring& value = versions_focus_ == 1 ? versions_query_ : versions_name_;
        size_t limit = versions_focus_ == 1 ? 40 : 60;
        if (value.size() < limit) {
            value.push_back(ch);
            if (versions_focus_ == 1) versions_visible_ = 50;
            rebuild_versions();
            dirty_ = true;
            InvalidateRect(hwnd_, nullptr, FALSE);
        }
    }
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
    if (sidebar3d_active_ && sidebar_rect_.right > sidebar_rect_.left) {
        float w = sidebar_rect_.right - sidebar_rect_.left;
        float h = sidebar_rect_.bottom - sidebar_rect_.top;
        float u = (acct->rect.left - sidebar_rect_.left) / w;
        float v = (acct->rect.top - sidebar_rect_.top) / h;
        float px = 0.0f, py = 0.0f;
        sidebar_project(u, v, px, py);
        x = px;
        bottom = py - 6.0f;
    }
    float y = bottom - menu_h;
    if (y < 8.0f) y = 8.0f;
    if (x + menu_w > w - 8.0f) x = w - 8.0f - menu_w;
    (void)h;
    // Popup needs an opaque card; the wallpaper palette's surface is translucent.
    menu_->style.bg = theme_locked_ ? Color::rgb(0x13171F) : ui_token(L"surface");
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
    if (theme_locked_) {
        notify(L"Giao diện",
               L"Đang ở chế độ ảnh nền — chọn \"Theo giao diện\" để đổi sáng/tối.",
               L"info");
        return;
    }
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
    if (menu_open_) {
        Node* menu_hit = ui_hit(menu_.get(), x, y);
        if (menu_hit) {
            pressed_ = menu_hit->action;
            return;
        }
        Node* normal = hit_test(x, y);
        bool account = normal && normal->action == L"menu:account";
        close_account_menu();
        if (account) {
            pressed_.clear();
            return;
        }
    }
    if (page_ == L"versions" && versions_menu_open_) {
        if (x >= versions_menu_rect_.left && x <= versions_menu_rect_.right &&
            y >= versions_menu_rect_.top && y <= versions_menu_rect_.bottom) {
            Node* item = ui_hit(versions_menu_.get(), x, y);
            if (item) {
                pressed_ = item->action;
                return;
            }
        }
        versions_close_build_menu();
    }
    Node* hit = hit_test(x, y);
    if (page_ == L"versions" && !versions_picker_ && !hit &&
        versions_mem_track_.right - versions_mem_track_.left > 10.0f &&
        x >= versions_mem_track_.left - 6.0f && x <= versions_mem_track_.right + 6.0f &&
        y >= versions_mem_track_.top - 5.0f && y <= versions_mem_track_.bottom + 5.0f) {
        versions_mem_drag_ = true;
        SetCapture(hwnd_);
        versions_focus_ = 0;
        versions_memory_from_x(x);
        pressed_.clear();
        return;
    }
    if (page_ == L"versions" && hit &&
        hit->action.rfind(L"versions:focus-", 0) != 0)
        versions_focus_ = 0;
    pressed_ = hit ? hit->action : L"";
    if (pressed_ == L"window:drag") {
        pressed_.clear();
        ReleaseCapture();
        SendMessageW(hwnd_, WM_NCLBUTTONDOWN, HTCAPTION, 0);
    }
}

void App::on_mouse_up(int px, int py) {
    if (splash_active()) { pressed_.clear(); return; }
    if (versions_mem_drag_) {
        versions_mem_drag_ = false;
        ReleaseCapture();
        pressed_.clear();
        return;
    }
    if (modal_open_) { pressed_.clear(); return; }
    float x = px / renderer_.scale();
    float y = py / renderer_.scale();
    Node* hit = hit_test(x, y);
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
        case WM_APP + 9:
            if (app) app->handle_discord_waiting_msg(lp);
            return 0;
        case WM_APP + 10:
            if (app) app->handle_home_data_msg(lp);
            return 0;
        case WM_APP + 11:
            if (app) app->handle_system_msg(lp);
            return 0;
        case WM_APP + 13:
            if (app) app->handle_java_state(lp);
            return 0;
        case WM_APP + 14:
            if (app) app->handle_background_result(lp);
            return 0;
        case WM_APP + 15:
            if (app) app->handle_java_removed();
            return 0;
        case WM_APP + 16:
            if (app) app->handle_loader_games_msg(lp);
            return 0;
        case WM_APP + 17:
            if (app) app->handle_loader_builds_msg(lp);
            return 0;
        case WM_APP + 20:
            if (app) app->handle_launch_progress_msg(lp);
            return 0;
        case WM_APP + 21:
            if (app) app->handle_launch_log_msg(lp);
            return 0;
        case WM_APP + 22:
            if (app) app->handle_launch_state_msg(lp);
            return 0;
        case WM_APP + 23:
            if (app) app->handle_launch_exit_msg(lp);
            return 0;
        case WM_MOUSEWHEEL: {
            if (app) {
                POINT pt{ GET_X_LPARAM(lp), GET_Y_LPARAM(lp) };
                ScreenToClient(hwnd, &pt);
                app->on_wheel(GET_WHEEL_DELTA_WPARAM(wp), pt.x, pt.y);
            }
            return 0;
        }
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
        case WM_MOUSELEAVE:
            if (app) app->on_mouse_leave();
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
