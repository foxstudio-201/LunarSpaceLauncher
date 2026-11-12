#pragma once
#include "common.h"
#include "render.h"

enum class Kind { Column, Row, Text, Image, Spacer };

struct Style {
    float width = -1.0f;
    float height = -1.0f;
    float grow = 0.0f;
    bool grow_x = false;
    bool grow_y = false;
    float pad_l = 0.0f, pad_r = 0.0f, pad_t = 0.0f, pad_b = 0.0f;
    float gap = 0.0f;
    float radius = 0.0f;
    bool border = false;
    float border_width = 1.0f;
    Color bg;
    std::wstring bg_image;
    Color overlay;
    Color border_color;
    Color color = Color::rgb(0xE8EBF1);
    float font_size = 13.0f;
    int weight = 400;
    bool mono = false;
    bool wrap = false;
    bool no_hover_bg = false;
    bool center_main = false;
    TextAlign align = TextAlign::Left;
    float opacity = 1.0f;
    bool visible = true;
    bool hidden_attr = false;
    bool accent = false;
    Color hover_bg;
    Color hover_color;
    float hover_opacity = -1.0f;
    bool glass = false;
};

struct Node {
    Kind kind = Kind::Column;
    std::wstring id;
    std::wstring action;
    std::wstring text;
    std::wstring src;
    Style style;
    std::vector<std::unique_ptr<Node>> kids;

    D2D1_RECT_F rect = D2D1::RectF();
    bool hovered = false;
    SizeF measured{};
};

std::unique_ptr<Node> ui_parse(const std::wstring& path);
Node* ui_find(Node* root, const std::wstring& id);
void ui_layout(Node* root, float width, float height, Renderer& renderer);
void ui_move(Node* node, float dx, float dy);
Node* ui_hit(Node* root, float x, float y);
void ui_draw(Node* node, Renderer& renderer, Node* hovered);
void ui_set_dark(bool dark);
bool ui_is_dark();
Color ui_color(const wchar_t* token);
Color ui_token(const wchar_t* token);
void ui_set_theme_anim(float value);
void ui_start_theme_anim(bool dark);
bool ui_theme_animating();
void ui_set_sidebar_pill(float top, bool show);
void ui_set_caret_angle(float degrees);
void ui_set_visible(Node* node, bool visible);
void ui_set_skip_id(const wchar_t* id);
void ui_set_skip_node(Node* node);
void ui_set_glass(bool enabled, ID2D1Bitmap* bitmap);
