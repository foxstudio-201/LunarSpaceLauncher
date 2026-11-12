#pragma once
#include "common.h"
#include <d3d11.h>
#include <dxgi1_3.h>
#include <d2d1_1.h>
#include <wincodec.h>

struct SizeF {
    float w = 0.0f;
    float h = 0.0f;
};

enum class TextAlign { Left, Center, Right };

bool make_head_png(const std::wstring& skin_path, const std::wstring& out_path);

class Renderer {
public:
    bool init(HWND hwnd);
    void resize(UINT width, UINT height);
    float scale() const { return scale_; }
    UINT pixel_width() const { return width_; }
    UINT pixel_height() const { return height_; }

    void begin(Color clear);
    void end();
    bool ready() const { return !!render_target_; }

    // Splits the frame so a D3D11 pass can run between the UI body and the
    // floating overlays (menu, toasts, modal, splash) on the same backbuffer.
    bool end_main();
    void begin_overlay();

    ID2D1Bitmap* image(const std::wstring& path);
    void unload(const std::wstring& path);

    SizeF measure_text(const std::wstring& text, float size, int weight, bool mono,
                       float max_width, float max_height, bool wrap = false);
    void draw_text(const std::wstring& text, D2D1_RECT_F rect, float size, int weight,
                   bool mono, TextAlign align, Color color, float opacity = 1.0f,
                   bool wrap = false);
    void fill_rect(D2D1_RECT_F rect, float radius, Color color, float opacity = 1.0f);
    void stroke_rect(D2D1_RECT_F rect, float radius, Color color, float width,
                     float opacity = 1.0f);
    void draw_image(ID2D1Bitmap* bitmap, D2D1_RECT_F rect, float radius, float opacity = 1.0f);
    void draw_image_path(const std::wstring& path, D2D1_RECT_F rect, float radius,
                         float opacity = 1.0f);
    void draw_svg(const std::wstring& path, D2D1_RECT_F rect, Color color, float opacity = 1.0f,
                  float rotation = 0.0f);
    void draw_rgba(const std::vector<unsigned char>& pixels, int width, int height,
                   D2D1_RECT_F rect, float opacity = 1.0f);
    bool load_pixels(const std::wstring& path, std::vector<unsigned char>& pixels,
                     unsigned& width, unsigned& height);
    void clip_push(D2D1_RECT_F rect);
    void clip_pop();
    void opacity_push(float value);
    void opacity_pop();

    // Sidebar offscreen capture + D3D11 perspective quad.
    bool capture_begin(float width, float height, float translate_x, float translate_y);
    void capture_end();
    bool sidebar_3d_ready();
    bool draw_sidebar_3d(const D2D1_RECT_F& rect, float angle_degrees);
    bool capture_item_begin(float width, float height, float translate_x, float translate_y);
    void capture_item_end();
    bool sidebar_item_ready();
    bool draw_sidebar_item_3d(const D2D1_RECT_F& rect, float angle_degrees, float lift);

private:
    bool create_target();
    bool ensure_quad_pipeline();
    bool ensure_surface(float width, float height, ComPtr<ID3D11Texture2D>& tex,
                        ComPtr<ID3D11ShaderResourceView>& srv, ComPtr<ID2D1Bitmap1>& bitmap,
                        UINT& pixel_w, UINT& pixel_h);
    void draw_textured_quad(ID3D11ShaderResourceView* srv, const float* verts,
                            const float* tint);
    void project_sidebar_quad(const D2D1_RECT_F& rect, float angle_degrees, float lift,
                              float* verts) const;
    IDWriteTextFormat* format(float size, int weight, bool mono, TextAlign align, bool wrap);
    IDWriteTextLayout* layout(const std::wstring& text, float size, int weight, bool mono,
                              float max_width, float max_height, TextAlign align,
                              SizeF* metrics, bool wrap);
    struct SvgPart {
        ComPtr<ID2D1PathGeometry> geometry;
        float opacity = 1.0f;
    };
    struct SvgDef {
        std::vector<SvgPart> parts;
        float vb_w = 256.0f;
        float vb_h = 256.0f;
    };
    struct FormatCache {
        ComPtr<IDWriteTextFormat> fmt;
        ComPtr<IDWriteInlineObject> sign;
    };
    SvgDef* ensure_svg(const std::wstring& path);

    HWND hwnd_ = nullptr;
    UINT width_ = 1;
    UINT height_ = 1;
    float scale_ = 1.0f;

    ComPtr<ID3D11Device> d3d_device_;
    ComPtr<ID3D11DeviceContext> d3d_context_;
    ComPtr<IDXGISwapChain1> swap_chain_;
    ComPtr<ID2D1Factory> d2d_factory_;
    ComPtr<ID2D1Device> d2d_device_;
    ComPtr<ID2D1DeviceContext> main_context_;
    ID2D1DeviceContext* d2d_context_ = nullptr;
    ComPtr<ID2D1Bitmap1> render_target_;
    ComPtr<IDWriteFactory> dwrite_;
    ComPtr<IWICImagingFactory> wic_;

    std::unordered_map<std::wstring, ComPtr<ID2D1Bitmap>> images_;
    std::unordered_map<std::wstring, FormatCache> formats_;
    std::unordered_map<std::wstring, SvgDef> svgs_;
    std::vector<ComPtr<ID2D1Layer>> layers_;

    ID2D1RenderTarget* target_ = nullptr;
    D2D1_MATRIX_3X2_F base_transform_ = D2D1::IdentityMatrix();

    ComPtr<ID3D11RenderTargetView> backbuffer_rtv_;
    ComPtr<ID3D11Texture2D> sidebar_tex_;
    ComPtr<ID3D11ShaderResourceView> sidebar_srv_;
    ComPtr<ID2D1Bitmap1> sidebar_bitmap_;
    ComPtr<ID3D11Texture2D> item_tex_;
    ComPtr<ID3D11ShaderResourceView> item_srv_;
    ComPtr<ID2D1Bitmap1> item_bitmap_;
    ComPtr<ID3D11VertexShader> quad_vs_;
    ComPtr<ID3D11PixelShader> quad_ps_;
    ComPtr<ID3D11InputLayout> quad_layout_;
    ComPtr<ID3D11Buffer> quad_vb_;
    ComPtr<ID3D11Buffer> quad_ib_;
    ComPtr<ID3D11Buffer> quad_cb_;
    ComPtr<ID3D11SamplerState> quad_sampler_;
    ComPtr<ID3D11BlendState> quad_blend_;
    ComPtr<ID3D11RasterizerState> quad_raster_;
    bool quad_ok_ = false;
    UINT sidebar_px_w_ = 0;
    UINT sidebar_px_h_ = 0;
    UINT item_px_w_ = 0;
    UINT item_px_h_ = 0;
};
