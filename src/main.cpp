#include "common.h"
#include "render.h"
#include "ui.h"
#include <d2d1helper.h>
#include <windowsx.h>
#include <shellapi.h>
#include <string>
#include <vector>
#include <cmath>
#include <cstdio>

#pragma comment(lib, "d2d1")

namespace {

constexpr UINT kSplashTimer = 1;

ULONGLONG now_ms() { return GetTickCount64(); }

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
    void on_dpi_changed();
    bool splash_active() const { return splash_.phase != Splash::Phase::None; }

private:
    void ui_apply_page();
    void do_action(const std::wstring& action);
    void start_pill_slide();
    void toggle_account_menu();
    void draw_account_menu();
    void select_account(int index);
    void close_account_menu();
    void save_settings();
    std::wstring settings_path() const;
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
    int active_account_ = 0;
    bool accounts_skin_ = false;
    bool skin_upload_ = true;
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
    active_account_ = GetPrivateProfileIntW(L"engine", L"account", 0, settings_path().c_str());
    if (active_account_ != 1) active_account_ = 0;
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
        else if (page_ == L"home")
            sub->text = L"103 bản phát hành · 6 phiên bản đã tạo · mới nhất 26.3";
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

    if (Node* skin_name = ui_find(ui_.get(), L"skin-account-name"))
        skin_name->text = active_account_ == 0 ? L"Sharks909" : L"hung";
    if (Node* name = ui_find(ui_.get(), L"label-account"))
        name->text = active_account_ == 0 ? L"Sharks909" : L"hung";
    if (Node* head = ui_find(ui_.get(), L"acct-head"))
        head->src = asset(active_account_ == 0 ? L"assets\\img\\head.png"
                                               : L"assets\\img\\head-hung.png");
    bool first = active_account_ == 0;
    ui_set_visible(ui_find(ui_.get(), L"active-badge-sharks"), first);
    ui_set_visible(ui_find(ui_.get(), L"active-badge-hung"), !first);
    ui_set_visible(ui_find(menu_.get(), L"menu-check-sharks"), first);
    ui_set_visible(ui_find(menu_.get(), L"menu-check-hung"), !first);

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
    start_pill_slide();
    dirty_ = true;
}

void App::do_action(const std::wstring& action) {
    if (action == L"toggle:theme") {
        toggle_theme();
    } else if (action == L"menu:account") {
        toggle_account_menu();
    } else if (action == L"account:sharks") {
        select_account(0);
    } else if (action == L"account:hung") {
        select_account(1);
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
    if (!toasts_.empty()) busy = true;
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
    WritePrivateProfileStringW(L"engine", L"account", active_account_ == 1 ? L"1" : L"0",
                               path.c_str());
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
    if (key == VK_ESCAPE) close_account_menu();
}

void App::select_account(int index) {
    active_account_ = index;
    bool first = index == 0;
    if (Node* name = ui_find(ui_.get(), L"label-account"))
        name->text = first ? L"Sharks909" : L"hung";
    if (Node* name = ui_find(ui_.get(), L"skin-account-name"))
        name->text = first ? L"Sharks909" : L"hung";
    if (Node* head = ui_find(ui_.get(), L"acct-head"))
        head->src = asset(first ? L"assets\\img\\head.png" : L"assets\\img\\head-hung.png");
    ui_set_visible(ui_find(menu_.get(), L"menu-check-sharks"), first);
    ui_set_visible(ui_find(menu_.get(), L"menu-check-hung"), !first);
    ui_set_visible(ui_find(ui_.get(), L"active-badge-sharks"), first);
    ui_set_visible(ui_find(ui_.get(), L"active-badge-hung"), !first);
    notify(L"Tài khoản", first ? L"Đang dùng Sharks909" : L"Đang dùng hung", L"ok");
    save_settings();
    close_account_menu();
    dirty_ = true;
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
    const float menu_h = 247.0f;
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
    if (splash_active()) return;
    float x = px / renderer_.scale();
    float y = py / renderer_.scale();
    Node* hit = ui_hit(ui_.get(), x, y);
    if (hit && hit->action == L"window:drag") do_action(L"window:maximize");
}

void App::on_mouse_down(int px, int py) {
    if (splash_active()) return;
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
        case WM_TIMER:
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
