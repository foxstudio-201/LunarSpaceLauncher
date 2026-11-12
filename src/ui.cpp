#include "ui.h"
#include <cwctype>
#include <cstdlib>
#include <cwchar>
#include <cmath>
#include <d2d1helper.h>

namespace {

struct Palette {
    Color bg, bar, surface, surface_active, text, label, faint, border, border_soft;
    Color input, hover, accent, accent_hover, accent_soft, on_accent, ok, warn, bad, info, ink;
};

bool g_dark = true;
float g_night = 1.0f;
float g_theme_from = 1.0f;
float g_theme_to = 1.0f;
bool g_theme_anim = false;
ULONGLONG g_theme_start = 0;
float g_pill_top = 0.0f;
bool g_pill_show = false;
float g_caret_angle = 0.0f;
std::wstring g_skip_id;
Node* g_skip_node = nullptr;
bool g_glass = false;
ID2D1Bitmap* g_glass_bitmap = nullptr;

Palette make_palette(bool dark) {
    if (dark) {
        return Palette{ Color::rgb(0x0C0E12), Color::rgb(0x080A0D), Color::rgb(0x14171D),
                        Color::rgb(0x212630), Color::rgb(0xE8EBF1), Color::rgb(0x99A2B1),
                        Color::rgb(0x656D7B), Color::rgb(0x242A33), Color::rgb(0x1B2027),
                        Color::rgb(0x181C23), Color::rgb(0x1A1E25), Color::rgb(0xE9B872),
                        Color::rgb(0xF3C98A), Color::rgb(0xF0C991), Color::rgb(0x1B1409),
                        Color::rgb(0x22C55E), Color::rgb(0xF5B84B), Color::rgb(0xF87171),
                        Color::rgb(0x60A5FA), Color::rgb(0x05070A) };
    }
    return Palette{ Color::rgb(0xF4F5F8), Color::rgb(0xFFFFFF), Color::rgb(0xFFFFFF),
                    Color::rgb(0xE9EBF1), Color::rgb(0x171A20), Color::rgb(0x5C6472),
                    Color::rgb(0x8B93A2), Color::rgb(0xDFE3EA), Color::rgb(0xE9ECF1),
                    Color::rgb(0xF1F2F6), Color::rgb(0xEEF0F4), Color::rgb(0xC07A2C),
                    Color::rgb(0xA9661F), Color::rgb(0xB7791F), Color::rgb(0xFFFFFF),
                    Color::rgb(0x16A34A), Color::rgb(0xB77908), Color::rgb(0xDC2626),
                    Color::rgb(0x2563EB), Color::rgb(0x171A20) };
}

Palette& palette_dark() {
    static Palette dark = make_palette(true);
    return dark;
}

Palette& palette_light() {
    static Palette light = make_palette(false);
    return light;
}

const wchar_t* const kTokenNames[] = {
    L"bg",          L"bar",     L"surface",   L"surfaceActive", L"text",
    L"label",       L"faint",   L"border",    L"borderSoft",    L"input",
    L"hover",       L"accent",  L"accentHover", L"accentSoft",  L"onAccent",
    L"ok",          L"warn",    L"bad",       L"info",          L"ink",
};
constexpr int kTokenCount = int(sizeof(kTokenNames) / sizeof(kTokenNames[0]));
constexpr float kTokenBase = -1000.0f;

int token_index(const std::wstring& key) {
    for (int i = 0; i < kTokenCount; ++i)
        if (key == kTokenNames[i]) return i;
    return -1;
}

Color pick(const Palette& p, const std::wstring& key) {
    if (key == L"bg") return p.bg;
    if (key == L"bar") return p.bar;
    if (key == L"surface") return p.surface;
    if (key == L"surfaceActive") return p.surface_active;
    if (key == L"text") return p.text;
    if (key == L"label") return p.label;
    if (key == L"faint") return p.faint;
    if (key == L"border") return p.border;
    if (key == L"borderSoft") return p.border_soft;
    if (key == L"input") return p.input;
    if (key == L"hover") return p.hover;
    if (key == L"accent") return p.accent;
    if (key == L"accentHover") return p.accent_hover;
    if (key == L"accentSoft") return p.accent_soft;
    if (key == L"onAccent") return p.on_accent;
    if (key == L"ok") return p.ok;
    if (key == L"warn") return p.warn;
    if (key == L"bad") return p.bad;
    if (key == L"info") return p.info;
    if (key == L"ink") return p.ink;
    return p.text;
}

Color blend(Color a, Color b, float t) {
    return Color{ a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t,
                  a.a + (b.a - a.a) * t };
}

}  // namespace

void ui_set_dark(bool dark) { g_dark = dark; }
bool ui_is_dark() { return g_dark; }
void ui_set_theme_anim(float value) {
    g_night = std::clamp(value, 0.0f, 1.0f);
    g_theme_from = g_theme_to = g_night;
    g_theme_anim = false;
}
static float spring_curve(float x);
void ui_start_theme_anim(bool dark) {
    ULONGLONG now = GetTickCount64();
    if (g_theme_anim) {
        float p = std::clamp(float(now - g_theme_start) / 900.0f, 0.0f, 1.0f);
        g_theme_from = g_theme_from + (g_theme_to - g_theme_from) * spring_curve(p);
    } else {
        g_theme_from = g_night;
    }
    g_theme_to = dark ? 1.0f : 0.0f;
    g_theme_start = now;
    g_theme_anim = true;
    g_dark = dark;
}
bool ui_theme_animating() {
    if (g_theme_anim && GetTickCount64() - g_theme_start >= 900) {
        g_night = g_theme_to;
        g_theme_anim = false;
    }
    return g_theme_anim;
}
void ui_set_sidebar_pill(float top, bool show) { g_pill_top = top; g_pill_show = show; }
void ui_set_caret_angle(float degrees) { g_caret_angle = degrees; }

Color ui_color(const wchar_t* token) {
    std::wstring key = token ? token : L"";
    float night = g_night;
    if (g_theme_anim) {
        float p = std::clamp(float(GetTickCount64() - g_theme_start) / 900.0f, 0.0f, 1.0f);
        p = 1.0f - std::pow(1.0f - p, 3.0f);
        night = g_theme_from + (g_theme_to - g_theme_from) * p;
    }
    if (night >= 0.999f) return pick(palette_dark(), key);
    if (night <= 0.001f) return pick(palette_light(), key);
    return blend(pick(palette_light(), key), pick(palette_dark(), key), night);
}

Color ui_token(const wchar_t* token) {
    int index = token_index(token ? token : L"");
    if (index < 0) return ui_color(token);
    return Color{ kTokenBase - float(index), 0.0f, 0.0f, 1.0f };
}

Color parse_color(const std::wstring& text) {
    if (!text.empty() && text[0] == L'$') {
        int index = token_index(text.substr(1));
        if (index >= 0) return Color{ kTokenBase - float(index), 0.0f, 0.0f, 1.0f };
        return ui_color(text.c_str() + 1);
    }
    std::wstring s = text;
    if (!s.empty() && s[0] == L'#') s.erase(0, 1);
    auto hexv = [](wchar_t c) -> unsigned {
        if (c >= L'0' && c <= L'9') return unsigned(c - L'0');
        if (c >= L'a' && c <= L'f') return unsigned(c - L'a' + 10);
        if (c >= L'A' && c <= L'F') return unsigned(c - L'A' + 10);
        return 0;
    };
    if (s.size() == 3) {
        unsigned r = hexv(s[0]), g = hexv(s[1]), b = hexv(s[2]);
        return Color{ r / 15.0f, g / 15.0f, b / 15.0f, 1.0f };
    }
    if (s.size() == 6) {
        unsigned r = hexv(s[0]) * 16 + hexv(s[1]);
        unsigned g = hexv(s[2]) * 16 + hexv(s[3]);
        unsigned b = hexv(s[4]) * 16 + hexv(s[5]);
        return Color{ r / 255.0f, g / 255.0f, b / 255.0f, 1.0f };
    }
    if (s.size() == 8) {
        unsigned r = hexv(s[0]) * 16 + hexv(s[1]);
        unsigned g = hexv(s[2]) * 16 + hexv(s[3]);
        unsigned b = hexv(s[4]) * 16 + hexv(s[5]);
        unsigned a = hexv(s[6]) * 16 + hexv(s[7]);
        return Color{ r / 255.0f, g / 255.0f, b / 255.0f, a / 255.0f };
    }
    return Color{};
}

std::wstring read_text_file(const std::wstring& path) {
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                              OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return L"";
    LARGE_INTEGER size{};
    GetFileSizeEx(file, &size);
    std::string bytes(size_t(size.QuadPart), '\0');
    DWORD read = 0;
    ReadFile(file, bytes.data(), DWORD(bytes.size()), &read, nullptr);
    CloseHandle(file);
    if (read == 0) return L"";
    int need = MultiByteToWideChar(CP_UTF8, 0, bytes.data(), int(read), nullptr, 0);
    std::wstring out(size_t(need), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, bytes.data(), int(read), out.data(), need);
    return out;
}

std::wstring widen(const std::string& text) {
    if (text.empty()) return L"";
    int need = MultiByteToWideChar(CP_UTF8, 0, text.data(), int(text.size()), nullptr, 0);
    std::wstring out(size_t(need), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), int(text.size()), out.data(), need);
    return out;
}

namespace {

enum class Tok { Ident, Number, String, Color, LBrace, RBrace, Equals, End };

struct Lexer {
    std::wstring src;
    size_t pos = 0;
    Tok tok = Tok::End;
    std::wstring text;

    explicit Lexer(std::wstring text) : src(std::move(text)) {}

    void next() {
        text.clear();
        while (pos < src.size() && std::iswspace(src[pos])) ++pos;
        if (pos >= src.size()) { tok = Tok::End; return; }
        wchar_t c = src[pos];
        if (c == L'/' && pos + 1 < src.size() && src[pos + 1] == L'/') {
            while (pos < src.size() && src[pos] != L'\n') ++pos;
            next();
            return;
        }
        if (c == L'{') { tok = Tok::LBrace; ++pos; return; }
        if (c == L'}') { tok = Tok::RBrace; ++pos; return; }
        if (c == L'=') { tok = Tok::Equals; ++pos; return; }
        if (c == L'"') {
            ++pos;
            while (pos < src.size() && src[pos] != L'"') {
                wchar_t ch = src[pos++];
                if (ch == L'\\' && pos < src.size()) ch = src[pos++];
                text.push_back(ch);
            }
            if (pos < src.size()) ++pos;
            tok = Tok::String;
            return;
        }
        if (c == L'#' || std::iswdigit(c) || c == L'-' || c == L'.') {
            while (pos < src.size() && (std::iswalnum(src[pos]) || src[pos] == L'#' ||
                                        src[pos] == L'.' || src[pos] == L'-'))
                text.push_back(src[pos++]);
            tok = (c == L'#' || text.find_first_of(L"ABCDEFabcdef") != std::wstring::npos)
                      ? Tok::Color
                      : Tok::Number;
            return;
        }
        if (std::iswalpha(c) || c == L'_' || c == L'$') {
            while (pos < src.size() && (std::iswalnum(src[pos]) || src[pos] == L'_' ||
                                        src[pos] == L'-' || src[pos] == L'/' ||
                                        src[pos] == L':' || src[pos] == L'.' ||
                                        src[pos] == L'$'))
                text.push_back(src[pos++]);
            tok = Tok::Ident;
            return;
        }
        ++pos;
        next();
    }

    float number(float fallback = 0.0f) const {
        wchar_t* end = nullptr;
        float value = std::wcstof(text.c_str(), &end);
        return end == text.c_str() ? fallback : value;
    }
};

bool is_node_name(const std::wstring& name) {
    return name == L"row" || name == L"column" || name == L"text" ||
           name == L"image" || name == L"spacer";
}

Kind kind_from(const std::wstring& name) {
    if (name == L"row") return Kind::Row;
    if (name == L"text") return Kind::Text;
    if (name == L"image") return Kind::Image;
    if (name == L"spacer") return Kind::Spacer;
    return Kind::Column;
}

void parse_attr(Lexer& lx, Node& node) {
    const std::wstring key = lx.text;
    Lexer peek = lx;
    peek.next();
    bool flag = true;
    bool has_value = peek.tok == Tok::Equals;
    if (has_value) {
        lx.next();  // '='
        lx.next();  // value
    }
    const Tok vt = has_value ? lx.tok : Tok::Ident;
    const std::wstring val = has_value ? lx.text : key;

    if (!has_value) {
        if (key == L"border") { node.style.border = true; node.style.border_width = 1.0f; }
        else if (key == L"mono") node.style.mono = true;
        else if (key == L"growx") node.style.grow_x = true;
        else if (key == L"growy") node.style.grow_y = true;
        else if (key == L"hidden") { node.style.visible = false; node.style.hidden_attr = true; }
        return;
    }

    if (key == L"id") node.id = val;
    else if (key == L"action") node.action = val;
    else if (key == L"value") node.text = val;
    else if (key == L"src") node.src = val;
    else if (key == L"width") node.style.width = lx.number();
    else if (key == L"height") node.style.height = lx.number();
    else if (key == L"grow") node.style.grow = lx.number(1.0f);
    else if (key == L"growx") node.style.grow_x = lx.number() != 0.0f;
    else if (key == L"growy") node.style.grow_y = lx.number() != 0.0f;
    else if (key == L"gap") node.style.gap = lx.number();
    else if (key == L"radius") node.style.radius = lx.number();
    else if (key == L"borderw") node.style.border_width = lx.number();
    else if (key == L"opacity") node.style.opacity = lx.number(1.0f);
    else if (key == L"size") node.style.font_size = lx.number(13.0f);
    else if (key == L"weight") node.style.weight = int(lx.number(400.0f));
    else if (key == L"padding") {
        float v = lx.number();
        node.style.pad_l = node.style.pad_r = node.style.pad_t = node.style.pad_b = v;
    } else if (key == L"paddingx") {
        float v = lx.number();
        node.style.pad_l = node.style.pad_r = v;
    } else if (key == L"paddingy") {
        float v = lx.number();
        node.style.pad_t = node.style.pad_b = v;
    } else if (key == L"bg") node.style.bg = parse_color(val);
    else if (key == L"bgimage") node.style.bg_image = val;
    else if (key == L"overlay") node.style.overlay = parse_color(val);
    else if (key == L"color") node.style.color = parse_color(val);
    else if (key == L"border") {
        if (vt == Tok::Color) {
            node.style.border = true;
            node.style.border_color = parse_color(val);
        } else {
            node.style.border = lx.number() != 0.0f;
        }
    } else if (key == L"bordercolor") {
        node.style.border_color = parse_color(val);
        node.style.border = true;
    } else if (key == L"mono") node.style.mono = lx.number() != 0.0f;
    else if (key == L"wrap") node.style.wrap = lx.number() != 0.0f;
    else if (key == L"accent") node.style.accent = lx.number() != 0.0f;
    else if (key == L"hoverbg") node.style.hover_bg = parse_color(val);
    else if (key == L"hovercolor") node.style.hover_color = parse_color(val);
    else if (key == L"nohoverbg") node.style.no_hover_bg = lx.number() != 0.0f;
    else if (key == L"hoveropacity") node.style.hover_opacity = lx.number(1.0f);
    else if (key == L"justify") node.style.center_main = val == L"center";
    else if (key == L"paddingleft") node.style.pad_l = lx.number();
    else if (key == L"paddingright") node.style.pad_r = lx.number();
    else if (key == L"paddingtop") node.style.pad_t = lx.number();
    else if (key == L"paddingbottom") node.style.pad_b = lx.number();
    else if (key == L"align") {
        if (val == L"center") node.style.align = TextAlign::Center;
        else if (val == L"right") node.style.align = TextAlign::Right;
        else node.style.align = TextAlign::Left;
    } else if (key == L"hidden") node.style.visible = lx.number() == 0.0f;
    (void)flag;
}

std::unique_ptr<Node> parse_node(Lexer& lx, const std::wstring& name) {
    auto node = std::make_unique<Node>();
    node->kind = kind_from(name);
    while (lx.tok != Tok::LBrace && lx.tok != Tok::RBrace && lx.tok != Tok::End) {
        if (lx.tok != Tok::Ident) { lx.next(); continue; }
        if (is_node_name(lx.text)) break;
        parse_attr(lx, *node);
        lx.next();
    }
    if (lx.tok == Tok::LBrace) {
        lx.next();
        while (lx.tok != Tok::RBrace && lx.tok != Tok::End) {
            if (lx.tok != Tok::Ident) { lx.next(); continue; }
            std::wstring child = lx.text;
            lx.next();
            node->kids.push_back(parse_node(lx, child));
        }
        if (lx.tok == Tok::RBrace) lx.next();
    }
    return node;
}

SizeF pref_size(Node* node, Renderer& renderer) {
    if (!node->style.visible) return {};
    switch (node->kind) {
        case Kind::Text: {
            float maxw = node->style.width > 0.0f ? node->style.width : 1e6f;
            SizeF m = renderer.measure_text(node->text, node->style.font_size,
                                            node->style.weight, node->style.mono, maxw, 1e6f,
                                            node->style.wrap);
            if (node->style.width > 0.0f) m.w = node->style.width;
            if (node->style.height > 0.0f) m.h = node->style.height;
            return m;
        }
        case Kind::Image: {
            ID2D1Bitmap* bitmap = renderer.image(node->src);
            SizeF m{ 0.0f, 0.0f };
            if (bitmap) {
                D2D1_SIZE_F s = bitmap->GetSize();
                m = { s.width, s.height };
            }
            if (node->style.width > 0.0f && node->style.height > 0.0f)
                return { node->style.width, node->style.height };
            if (node->style.width > 0.0f && m.h > 0.0f)
                return { node->style.width, node->style.width * m.h / std::max(m.w, 1.0f) };
            if (node->style.height > 0.0f && m.w > 0.0f)
                return { node->style.height * m.w / std::max(m.h, 1.0f), node->style.height };
            return m;
        }
        case Kind::Spacer:
            return { std::max(0.0f, node->style.width), std::max(0.0f, node->style.height) };
        default: {
            float total_w = node->style.pad_l + node->style.pad_r;
            float total_h = node->style.pad_t + node->style.pad_b;
            bool row = node->kind == Kind::Row;
            float main = 0.0f;
            float cross = 0.0f;
            bool first = true;
            for (auto& kid : node->kids) {
                SizeF s = pref_size(kid.get(), renderer);
                float cw = kid->style.width > 0.0f ? kid->style.width : s.w;
                float ch = kid->style.height > 0.0f ? kid->style.height : s.h;
                if (row) {
                    main += cw;
                    cross = std::max(cross, ch);
                } else {
                    main += ch;
                    cross = std::max(cross, cw);
                }
                if (!first) main += node->style.gap;
                first = false;
            }
            if (row) return { total_w + main, total_h + cross };
            return { total_w + cross, total_h + main };
        }
    }
}

void arrange(Node* node, D2D1_RECT_F rect, Renderer& renderer) {
    node->rect = rect;
    const float x = rect.left;
    const float y = rect.top;
    const float w = rect.right - rect.left;
    const float h = rect.bottom - rect.top;
    float ix = x + node->style.pad_l;
    float iy = y + node->style.pad_t;
    float iw = std::max(0.0f, w - node->style.pad_l - node->style.pad_r);
    float ih = std::max(0.0f, h - node->style.pad_t - node->style.pad_b);

    if (node->kind == Kind::Text || node->kind == Kind::Image || node->kind == Kind::Spacer)
        return;
    if (node->kids.empty()) return;

    const bool row = node->kind == Kind::Row;
    std::vector<float> main_sizes(node->kids.size(), 0.0f);
    std::vector<float> weights(node->kids.size(), 0.0f);
    float fixed = 0.0f;
    size_t visible_count = 0;
    for (size_t i = 0; i < node->kids.size(); ++i) {
        Node* kid = node->kids[i].get();
        if (!kid->style.visible) continue;
        SizeF s = pref_size(kid, renderer);
        float main = row ? (kid->style.width > 0.0f ? kid->style.width : s.w)
                         : (kid->style.height > 0.0f ? kid->style.height : s.h);
        main_sizes[i] = main;
        float weight = kid->style.grow > 0.0f ? kid->style.grow
                       : (row ? (kid->style.grow_x ? 1.0f : 0.0f)
                              : (kid->style.grow_y ? 1.0f : 0.0f));
        weights[i] = weight;
        fixed += main;
        ++visible_count;
    }
    fixed += node->style.gap * float(visible_count > 0 ? visible_count - 1 : 0);
    const float avail = row ? iw : ih;
    const float extra = avail - fixed;
    float total_weight = 0.0f;
    for (float weight : weights) total_weight += weight;
    if (extra > 0.0f && total_weight > 0.0f) {
        for (size_t i = 0; i < node->kids.size(); ++i)
            if (weights[i] > 0.0f) main_sizes[i] += extra * weights[i] / total_weight;
    }

    float cursor = (row ? ix : iy) +
                   ((extra > 0.0f && total_weight <= 0.0f && node->style.center_main)
                        ? extra * 0.5f
                        : 0.0f);
    bool first_visible = true;
    for (size_t i = 0; i < node->kids.size(); ++i) {
        Node* kid = node->kids[i].get();
        if (!kid->style.visible) continue;
        if (!first_visible) cursor += node->style.gap;
        first_visible = false;
        float cw = row ? main_sizes[i] : (kid->style.width > 0.0f ? kid->style.width : iw);
        float ch = row ? (kid->style.height > 0.0f ? kid->style.height : ih) : main_sizes[i];
        if (row) {
            if (cw > iw - (cursor - ix)) cw = std::max(0.0f, iw - (cursor - ix));
        } else {
            if (ch > ih - (cursor - iy)) ch = std::max(0.0f, ih - (cursor - iy));
        }
        float child_y = row ? iy + (ih - ch) * 0.5f : cursor;
        float child_x = row ? cursor : ix;
        arrange(kid, D2D1::RectF(child_x, child_y, child_x + cw, child_y + ch), renderer);
        cursor += row ? cw : ch;
    }
}

Node* hit_node(Node* node, float x, float y) {
    if (!node->style.visible) return nullptr;
    if (!g_skip_id.empty() && node->id == g_skip_id) return nullptr;
    const auto& r = node->rect;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return nullptr;
    for (auto it = node->kids.rbegin(); it != node->kids.rend(); ++it) {
        if (Node* hit = hit_node(it->get(), x, y)) return hit;
    }
    return node->action.empty() ? nullptr : node;
}

}  // namespace

std::unique_ptr<Node> ui_parse(const std::wstring& path) {
    Lexer lx(read_text_file(path));
    lx.next();
    if (lx.tok != Tok::Ident) return nullptr;
    std::wstring name = lx.text;
    lx.next();
    return parse_node(lx, name);
}

Node* ui_find(Node* root, const std::wstring& id) {
    if (!root) return nullptr;
    if (root->id == id) return root;
    for (auto& kid : root->kids)
        if (Node* found = ui_find(kid.get(), id)) return found;
    return nullptr;
}

void ui_layout(Node* root, float width, float height, Renderer& renderer) {
    if (!root) return;
    arrange(root, D2D1::RectF(0.0f, 0.0f, width, height), renderer);
}

void ui_move(Node* node, float dx, float dy) {
    if (!node) return;
    node->rect = D2D1::RectF(node->rect.left + dx, node->rect.top + dy,
                             node->rect.right + dx, node->rect.bottom + dy);
    for (auto& kid : node->kids) ui_move(kid.get(), dx, dy);
}

Node* ui_hit(Node* root, float x, float y) { return root ? hit_node(root, x, y) : nullptr; }

void ui_set_visible(Node* node, bool visible) {
    if (!node) return;
    node->style.visible = visible;
}

void ui_set_skip_id(const wchar_t* id) { g_skip_id = id ? id : L""; }

void ui_set_skip_node(Node* node) { g_skip_node = node; }

void ui_set_glass(bool enabled, ID2D1Bitmap* bitmap) {
    g_glass = enabled;
    g_glass_bitmap = bitmap;
}

static Color cv(const Color& color) {
    if (color.r <= kTokenBase + 0.5f) {
        int index = int(kTokenBase - color.r);
        if (index >= 0 && index < kTokenCount) return ui_color(kTokenNames[index]);
    }
    return color;
}

static float bezier_progress(float x, float x1, float y1, float x2, float y2) {
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

static float ease_curve(float x) { return bezier_progress(x, 0.25f, 0.1f, 0.25f, 1.0f); }
static float spring_curve(float x) { return bezier_progress(x, 0.34f, 1.45f, 0.64f, 1.0f); }

static void draw_theme_switch(Renderer& renderer, D2D1_RECT_F r, float opacity) {
    float sw = r.right - r.left;
    float sh = r.bottom - r.top;
    float pad = std::round(sh * 0.1136f);
    float knob = sh - pad * 2.0f;
    float travel = sw - pad * 2.0f - knob;
    float s = knob / 34.0f;

    float elapsed = g_theme_anim ? float(GetTickCount64() - g_theme_start) : 900.0f;
    auto amount = [&](float duration, bool spring) {
        float p = std::clamp(elapsed / duration, 0.0f, 1.0f);
        p = spring ? spring_curve(p) : ease_curve(p);
        return g_theme_from + (g_theme_to - g_theme_from) * p;
    };
    float sky = std::clamp(amount(800.0f, false), 0.0f, 1.0f);
    float star_p = std::clamp(amount(600.0f, true), 0.0f, 1.6f);
    float cloud_p = amount(800.0f, true);
    float knob_p = amount(900.0f, true);
    float face_p = std::clamp(amount(800.0f, false), 0.0f, 1.0f);

    renderer.clip_push(r);
    Color day = blend(Color::rgb(0x5DB7FF), Color::rgb(0x9ED8FF), 0.5f);
    Color night = blend(Color::rgb(0x141A3A), Color::rgb(0x232C5C), 0.5f);
    renderer.fill_rect(r, sh * 0.5f, blend(day, night, sky), opacity);

    static const float stars[6][3] = { { 13, 10, 2 }, { 26, 25, 1.5f }, { 37, 12, 2 },
                                       { 19, 31, 1.5f }, { 45, 27, 1 }, { 9, 21, 1 } };
    for (const auto& star : stars) {
        float x = r.left + star[0] * s;
        float y = r.top + star[1] * s - (1.0f - star_p) * 14.0f * s;
        float d = star[2] * s;
        renderer.fill_rect(D2D1::RectF(x, y, x + d, y + d), d * 0.5f,
                           Color::rgb(0xFFFFFF, 0.95f * star_p), opacity);
    }

    struct Cloud { float right, bottom, w, h; unsigned color; };
    static const Cloud clouds[4] = { { 6, 6, 42, 16, 0xFFFFFF }, { 24, 3, 30, 15, 0xFFFFFF },
                                     { 38, 9, 24, 13, 0xFFFFFF }, { 16, 0, 30, 11, 0xE3F1FF } };
    float cloud_alpha = std::clamp(1.0f - cloud_p, 0.0f, 1.0f) * 0.95f;
    for (const auto& cloud : clouds) {
        float w = cloud.w * s;
        float h = cloud.h * s;
        float x = r.right - cloud.right * s - w;
        float y = r.bottom - cloud.bottom * s - h + cloud_p * 36.0f * s;
        renderer.fill_rect(D2D1::RectF(x, y, x + w, y + h), h * 0.5f,
                           Color::rgb(cloud.color, cloud_alpha), opacity);
    }

    float knob_x = r.left + pad + travel * knob_p;
    float knob_y = r.top + pad;
    float cx = knob_x + knob * 0.5f;
    float cy = knob_y + knob * 0.5f;
    for (float diameter : { 26.0f, 32.0f, 38.0f }) {
        float size = diameter * s;
        renderer.fill_rect(D2D1::RectF(cx - size * 0.5f, cy - size * 0.5f,
                                       cx + size * 0.5f, cy + size * 0.5f),
                           size * 0.5f, Color::rgb(0xFFFFFF, 0.06f), opacity);
    }
    D2D1_RECT_F knob_rect = D2D1::RectF(knob_x, knob_y, knob_x + knob, knob_y + knob);
    renderer.fill_rect(knob_rect, knob * 0.5f, blend(Color::rgb(0xFFF1A8), Color::rgb(0xF8A91E), 0.5f),
                       opacity);
    Color moon = blend(Color::rgb(0xF4F6FB), Color::rgb(0xA9B0C2), 0.5f);
    if (face_p > 0.001f)
        renderer.fill_rect(knob_rect, knob * 0.5f, Color{ moon.r, moon.g, moon.b, face_p },
                           opacity);
    float spot = 15.0f * s;
    renderer.fill_rect(D2D1::RectF(knob_x + 4.0f * s, knob_y + 3.0f * s,
                                   knob_x + 4.0f * s + spot, knob_y + 3.0f * s + spot),
                       spot * 0.5f, Color::rgb(0xFFFFFF, 0.53f * (1.0f - face_p)), opacity);
    static const float craters[3][3] = { { 9, 7, 9 }, { 20, 18, 6 }, { 10, 21, 4 } };
    for (const auto& crater : craters) {
        float d = crater[2] * s;
        float x = knob_x + crater[0] * s;
        float y = knob_y + crater[1] * s;
        renderer.fill_rect(D2D1::RectF(x, y, x + d, y + d), d * 0.5f,
                           Color::rgb(0xA3AABC, face_p), opacity);
    }
    renderer.clip_pop();
}

static void draw_node(Node* node, Renderer& renderer, Node* hovered, bool inside_hover) {
    if (!node || !node->style.visible || node->style.opacity <= 0.001f) return;
    if (node == g_skip_node) return;
    if (!g_skip_id.empty() && node->id == g_skip_id) return;
    const auto& r = node->rect;
    const auto& st = node->style;
    if (node->id == L"theme-switch") {
        draw_theme_switch(renderer, r, st.opacity);
        return;
    }
    if (cv(st.bg).visible() &&
        (!g_glass || !st.glass || !g_glass_bitmap))
        renderer.fill_rect(r, st.radius, cv(st.bg), st.opacity);
    if (g_glass && st.glass && g_glass_bitmap) {
        renderer.draw_glass_backdrop(r, st.radius, g_glass_bitmap);
        Color tint = g_dark ? Color::rgb(0x0B0E13, 0.46f)
                            : Color::rgb(0xFFFFFF, 0.52f);
        renderer.fill_rect(r, st.radius, tint, st.opacity);
    }
    if (!st.bg_image.empty()) {
        renderer.draw_image_path(st.bg_image, r, st.radius, st.opacity);
    }
    if (cv(st.overlay).visible())
        renderer.fill_rect(r, st.radius, cv(st.overlay), st.opacity);
    if (st.border)
        renderer.stroke_rect(r, st.radius, cv(st.border_color), st.border_width, st.opacity);
    if (node->id == L"sidebar" && g_pill_show) {
        D2D1_RECT_F pill = D2D1::RectF(r.left + 10.0f, g_pill_top, r.right - 10.0f,
                                       g_pill_top + 48.0f);
        renderer.fill_rect(pill, 15.0f, ui_color(L"surfaceActive"), st.opacity);
        renderer.fill_rect(D2D1::RectF(pill.left, pill.top + 12.0f, pill.left + 4.0f,
                                       pill.bottom - 12.0f),
                           2.0f, ui_color(L"accent"), st.opacity);
    }
    const bool drag_hover = hovered && hovered->action == L"window:drag";
    const bool hover_inside = node == hovered || (inside_hover && !drag_hover);
    if (node == hovered && !node->action.empty() && node->action != L"window:drag" &&
        !st.no_hover_bg) {
        Color hb = cv(st.hover_bg);
        if (!hb.visible()) hb = g_dark ? Color::rgb(0xFFFFFF, 0.05f)
                                       : Color::rgb(0x10141A, 0.06f);
        renderer.fill_rect(r, st.radius, hb, st.opacity);
    }
    if (st.accent)
        renderer.fill_rect(D2D1::RectF(r.left, r.top + 12.0f, r.left + 4.0f, r.bottom - 12.0f),
                           2.0f, ui_color(L"accent"), st.opacity);

    renderer.clip_push(r);
    switch (node->kind) {
        case Kind::Text: {
            Color color = cv(st.color);
            if (hover_inside && cv(st.hover_color).visible()) color = cv(st.hover_color);
            renderer.draw_text(node->text, r, st.font_size, st.weight, st.mono, st.align,
                               color, st.opacity, st.wrap);
            break;
        }
        case Kind::Image: {
            float image_opacity = (hover_inside && st.hover_opacity >= 0.0f) ? st.hover_opacity
                                                                           : st.opacity;
            std::wstring lower = node->src;
            for (auto& ch : lower) ch = wchar_t(towlower(ch));
            if (lower.size() > 4 && lower.substr(lower.size() - 4) == L".svg") {
                Color tint = (hover_inside && cv(st.hover_color).visible()) ? cv(st.hover_color)
                                                                           : cv(st.color);
                renderer.draw_svg(node->src, r, tint, image_opacity,
                                  node->id == L"acct-caret" ? g_caret_angle : 0.0f);
            }
            else
                renderer.draw_image_path(node->src, r, st.radius, image_opacity);
            break;
        }
        case Kind::Row:
        case Kind::Column:
            for (auto& kid : node->kids)
                draw_node(kid.get(), renderer, hovered, hover_inside);
            break;
        default:
            break;
    }
    renderer.clip_pop();
}

void ui_draw(Node* node, Renderer& renderer, Node* hovered) {
    draw_node(node, renderer, hovered, false);
}
