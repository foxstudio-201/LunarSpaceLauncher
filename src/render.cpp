#include "render.h"
#include <d2d1helper.h>
#include <d2d1_1helper.h>
#include <d3dcompiler.h>
#include <wincodec.h>
#include <dxgi1_3.h>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <cctype>
#include <cmath>
#include <iterator>

#pragma comment(lib, "d3d11")
#pragma comment(lib, "dxgi")
#pragma comment(lib, "d2d1")
#pragma comment(lib, "dwrite")
#pragma comment(lib, "windowscodecs")

static DWRITE_FONT_WEIGHT dw_weight(int weight) {
    if (weight >= 700) return DWRITE_FONT_WEIGHT_BOLD;
    if (weight >= 600) return DWRITE_FONT_WEIGHT_SEMI_BOLD;
    if (weight >= 500) return DWRITE_FONT_WEIGHT_MEDIUM;
    return DWRITE_FONT_WEIGHT_NORMAL;
}

static DWRITE_TEXT_ALIGNMENT dw_align(TextAlign align) {
    switch (align) {
        case TextAlign::Center: return DWRITE_TEXT_ALIGNMENT_CENTER;
        case TextAlign::Right: return DWRITE_TEXT_ALIGNMENT_TRAILING;
        default: return DWRITE_TEXT_ALIGNMENT_LEADING;
    }
}

bool Renderer::init(HWND hwnd) {
    hwnd_ = hwnd;
    RECT rc{};
    GetClientRect(hwnd, &rc);
    width_ = std::max<UINT>(1, UINT(rc.right - rc.left));
    height_ = std::max<UINT>(1, UINT(rc.bottom - rc.top));
    UINT dpi = GetDpiForWindow(hwnd);
    scale_ = dpi > 0 ? dpi / 96.0f : 1.0f;

    D3D_FEATURE_LEVEL levels[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0,
                                   D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0 };
    D3D_FEATURE_LEVEL feature{};
    HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
                                   D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels,
                                   UINT(std::size(levels)), D3D11_SDK_VERSION,
                                   d3d_device_.put(), &feature, d3d_context_.put());
    if (FAILED(hr)) return false;

    ComPtr<IDXGIDevice> dxgi_device;
    if (FAILED(d3d_device_->QueryInterface(__uuidof(IDXGIDevice),
                                           (void**)dxgi_device.put())))
        return false;
    ComPtr<IDXGIAdapter> adapter;
    if (FAILED(dxgi_device->GetAdapter(adapter.put()))) return false;
    ComPtr<IDXGIFactory2> factory;
    if (FAILED(adapter->GetParent(__uuidof(IDXGIFactory2), (void**)factory.put())))
        return false;

    D2D1_FACTORY_OPTIONS options{};
    if (FAILED(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED,
                                 __uuidof(ID2D1Factory), &options,
                                 (void**)d2d_factory_.put())))
        return false;
    ComPtr<ID2D1Factory1> factory1;
    if (FAILED(d2d_factory_->QueryInterface(__uuidof(ID2D1Factory1), (void**)factory1.put())))
        return false;
    if (FAILED(factory1->CreateDevice(dxgi_device.get(), d2d_device_.put())))
        return false;
    if (FAILED(d2d_device_->CreateDeviceContext(D2D1_DEVICE_CONTEXT_OPTIONS_NONE,
                                                main_context_.put())))
        return false;
    d2d_context_ = main_context_.get();
    target_ = d2d_context_;
    d2d_context_->SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);

    if (FAILED(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory),
                                   (IUnknown**)dwrite_.put())))
        return false;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                                __uuidof(IWICImagingFactory), (void**)wic_.put())))
        return false;

    DXGI_SWAP_CHAIN_DESC1 desc{};
    desc.Width = width_;
    desc.Height = height_;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    desc.BufferCount = 2;
    desc.Scaling = DXGI_SCALING_STRETCH;
    desc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
    desc.AlphaMode = DXGI_ALPHA_MODE_IGNORE;
    if (FAILED(factory->CreateSwapChainForHwnd(d3d_device_.get(), hwnd, &desc, nullptr,
                                               nullptr, swap_chain_.put())))
        return false;
    return create_target();
}

void Renderer::resize(UINT width, UINT height) {
    width = std::max<UINT>(1, width);
    height = std::max<UINT>(1, height);
    if (!swap_chain_ || (width == width_ && height == height_)) return;
    width_ = width;
    height_ = height;
    render_target_.reset();
    backbuffer_rtv_.reset();
    d2d_context_->SetTarget(nullptr);
    if (FAILED(swap_chain_->ResizeBuffers(0, width, height, DXGI_FORMAT_UNKNOWN, 0))) return;
    create_target();
}

bool Renderer::create_target() {
    if (!swap_chain_ || !d2d_context_) return false;
    ComPtr<ID3D11Texture2D> buffer;
    if (FAILED(swap_chain_->GetBuffer(0, __uuidof(ID3D11Texture2D), (void**)buffer.put())))
        return false;
    if (FAILED(d3d_device_->CreateRenderTargetView(buffer.get(), nullptr,
                                                   backbuffer_rtv_.put())))
        return false;
    ComPtr<IDXGISurface> surface;
    if (FAILED(buffer->QueryInterface(__uuidof(IDXGISurface), (void**)surface.put())))
        return false;
    D2D1_BITMAP_PROPERTIES1 props = D2D1::BitmapProperties1(
        D2D1_BITMAP_OPTIONS_TARGET | D2D1_BITMAP_OPTIONS_CANNOT_DRAW,
        D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_IGNORE),
        96.0f, 96.0f);
    if (FAILED(d2d_context_->CreateBitmapFromDxgiSurface(surface.get(), &props,
                                                         render_target_.put())))
        return false;
    d2d_context_->SetTarget(render_target_.get());
    return true;
}

void Renderer::begin(Color clear) {
    if (!d2d_context_ || !render_target_) return;
    target_ = d2d_context_;
    if (hwnd_) {
        UINT dpi = GetDpiForWindow(hwnd_);
        if (dpi > 0) scale_ = dpi / 96.0f;
    }
    target_->BeginDraw();
    base_transform_ = D2D1::Matrix3x2F::Scale(scale_, scale_);
    target_->SetTransform(base_transform_);
    target_->Clear(to_d2d(clear));
}

void Renderer::end() {
    if (!d2d_context_ || !swap_chain_) return;
    target_ = d2d_context_;
    HRESULT hr = target_->EndDraw();
    if (hr == D2DERR_RECREATE_TARGET) {
        render_target_.reset();
        backbuffer_rtv_.reset();
        d2d_context_->SetTarget(nullptr);
        create_target();
        return;
    }
    swap_chain_->Present(1, 0);
}

bool Renderer::end_main() {
    if (!d2d_context_) return false;
    target_ = d2d_context_;
    HRESULT hr = target_->EndDraw();
    if (hr == D2DERR_RECREATE_TARGET) {
        render_target_.reset();
        backbuffer_rtv_.reset();
        d2d_context_->SetTarget(nullptr);
        create_target();
        return false;
    }
    return SUCCEEDED(hr);
}

void Renderer::begin_overlay() {
    if (!d2d_context_ || !render_target_) return;
    target_ = d2d_context_;
    target_->BeginDraw();
    base_transform_ = D2D1::Matrix3x2F::Scale(scale_, scale_);
    target_->SetTransform(base_transform_);
}

IDWriteTextFormat* Renderer::format(float size, int weight, bool mono, TextAlign align,
                                    bool wrap) {
    wchar_t key[96];
    swprintf(key, 96, L"%ls|%.1f|%d|%d|%d", mono ? L"M" : L"S", size, weight, int(align),
             wrap ? 1 : 0);
    auto it = formats_.find(key);
    if (it != formats_.end()) return it->second.fmt.get();

    ComPtr<IDWriteTextFormat> fmt;
    const wchar_t* family = mono ? L"Consolas" : L"Segoe UI";
    if (FAILED(dwrite_->CreateTextFormat(family, nullptr, dw_weight(weight),
                                         DWRITE_FONT_STYLE_NORMAL,
                                         DWRITE_FONT_STRETCH_NORMAL, size, L"", fmt.put()))) {
        dwrite_->CreateTextFormat(L"Arial", nullptr, dw_weight(weight),
                                  DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL,
                                  size, L"", fmt.put());
    }
    fmt->SetWordWrapping(wrap ? DWRITE_WORD_WRAPPING_WRAP : DWRITE_WORD_WRAPPING_NO_WRAP);
    fmt->SetTextAlignment(dw_align(align));
    ComPtr<IDWriteInlineObject> sign;
    if (SUCCEEDED(dwrite_->CreateEllipsisTrimmingSign(fmt.get(), sign.put()))) {
        DWRITE_TRIMMING trimming{ DWRITE_TRIMMING_GRANULARITY_CHARACTER, 0, 0 };
        fmt->SetTrimming(&trimming, sign.get());
    }
    FormatCache cache;
    cache.fmt = std::move(fmt);
    cache.sign = std::move(sign);
    formats_[key] = std::move(cache);
    return formats_[key].fmt.get();
}

IDWriteTextLayout* Renderer::layout(const std::wstring& text, float size, int weight,
                                    bool mono, float max_width, float max_height,
                                    TextAlign align, SizeF* metrics, bool wrap) {
    if (max_width <= 0.0f) max_width = 1.0f;
    if (max_height <= 0.0f) max_height = 1e6f;
    IDWriteTextLayout* tl = nullptr;
    if (FAILED(dwrite_->CreateTextLayout(text.c_str(), UINT(text.size()),
                                         format(size, weight, mono, align, wrap), max_width,
                                         max_height, &tl)))
        return nullptr;
    if (metrics) {
        DWRITE_TEXT_METRICS m{};
        tl->GetMetrics(&m);
        metrics->w = m.width;
        metrics->h = m.height;
    }
    return tl;
}

SizeF Renderer::measure_text(const std::wstring& text, float size, int weight, bool mono,
                             float max_width, float max_height, bool wrap) {
    SizeF metrics{};
    if (text.empty()) return metrics;
    IDWriteTextLayout* tl = layout(text, size, weight, mono, max_width, max_height,
                                   TextAlign::Left, &metrics, wrap);
    if (tl) tl->Release();
    return metrics;
}

void Renderer::draw_text(const std::wstring& text, D2D1_RECT_F rect, float size, int weight,
                         bool mono, TextAlign align, Color color, float opacity, bool wrap) {
    if (text.empty() || !color.visible() || opacity <= 0.001f) return;
    SizeF metrics{};
    IDWriteTextLayout* tl = layout(text, size, weight, mono, rect.right - rect.left,
                                   rect.bottom - rect.top, align, &metrics, wrap);
    if (!tl) return;
    tl->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER);
    float y = rect.top;
    ComPtr<ID2D1SolidColorBrush> brush;
    target_->CreateSolidColorBrush(to_d2d(color), brush.put());
    if (brush) {
        brush->SetOpacity(std::clamp(opacity, 0.0f, 1.0f));
        target_->PushAxisAlignedClip(rect, D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
        target_->DrawTextLayout(D2D1::Point2F(rect.left, y), tl, brush.get());
        target_->PopAxisAlignedClip();
    }
    tl->Release();
}

void Renderer::fill_rect(D2D1_RECT_F rect, float radius, Color color, float opacity) {
    if (!color.visible() || opacity <= 0.001f) return;
    ComPtr<ID2D1SolidColorBrush> brush;
    target_->CreateSolidColorBrush(to_d2d(color), brush.put());
    if (!brush) return;
    brush->SetOpacity(std::clamp(opacity, 0.0f, 1.0f));
    float r = std::max(0.0f, radius);
    if (r > 0.5f)
        target_->FillRoundedRectangle(D2D1::RoundedRect(rect, r, r), brush.get());
    else
        target_->FillRectangle(rect, brush.get());
}

void Renderer::stroke_rect(D2D1_RECT_F rect, float radius, Color color, float width,
                           float opacity) {
    if (!color.visible() || opacity <= 0.001f || width <= 0.0f) return;
    ComPtr<ID2D1SolidColorBrush> brush;
    target_->CreateSolidColorBrush(to_d2d(color), brush.put());
    if (!brush) return;
    brush->SetOpacity(std::clamp(opacity, 0.0f, 1.0f));
    float r = std::max(0.0f, radius);
    if (r > 0.5f)
        target_->DrawRoundedRectangle(D2D1::RoundedRect(rect, r, r), brush.get(), width);
    else
        target_->DrawRectangle(rect, brush.get(), width);
}

void Renderer::draw_image(ID2D1Bitmap* bitmap, D2D1_RECT_F rect, float radius,
                          float opacity) {
    if (!bitmap || opacity <= 0.001f) return;
    D2D1_SIZE_F size = bitmap->GetSize();
    if (size.width <= 0.0f || size.height <= 0.0f) return;
    float dw = rect.right - rect.left;
    float dh = rect.bottom - rect.top;
    float scale = std::max(dw / size.width, dh / size.height);
    float sw = dw / scale;
    float sh = dh / scale;
    D2D1_RECT_F src = D2D1::RectF((size.width - sw) * 0.5f, (size.height - sh) * 0.5f,
                                  (size.width + sw) * 0.5f, (size.height + sh) * 0.5f);

    if (radius > 0.5f) {
        ComPtr<ID2D1RoundedRectangleGeometry> geometry;
        d2d_factory_->CreateRoundedRectangleGeometry(
            D2D1::RoundedRect(rect, radius, radius), geometry.put());
        ComPtr<ID2D1Layer> layer;
        target_->CreateLayer(nullptr, layer.put());
        if (geometry && layer) {
            D2D1_LAYER_PARAMETERS params = D2D1::LayerParameters(
                D2D1::InfiniteRect(), geometry.get(), D2D1_ANTIALIAS_MODE_PER_PRIMITIVE,
                D2D1::IdentityMatrix(), std::clamp(opacity, 0.0f, 1.0f));
            target_->PushLayer(&params, layer.get());
            target_->DrawBitmap(bitmap, rect, 1.0f,
                                     D2D1_BITMAP_INTERPOLATION_MODE_LINEAR, src);
            target_->PopLayer();
            return;
        }
    }
    target_->DrawBitmap(bitmap, rect, std::clamp(opacity, 0.0f, 1.0f),
                             D2D1_BITMAP_INTERPOLATION_MODE_LINEAR, src);
}

ID2D1Bitmap* Renderer::image(const std::wstring& path) {
    auto it = images_.find(path);
    if (it != images_.end()) return it->second.get();
    if (!wic_) return nullptr;
    std::wstring full = path;
    for (auto& ch : full) if (ch == L'/') ch = L'\\';
    wchar_t resolved[1024];
    DWORD n = GetFullPathNameW(full.c_str(), 1024, resolved, nullptr);
    std::wstring decodePath = (n > 0 && n < 1024) ? std::wstring(resolved, n) : full;
    ComPtr<IWICBitmapDecoder> decoder;
    if (FAILED(wic_->CreateDecoderFromFilename(decodePath.c_str(), nullptr, GENERIC_READ,
                                               WICDecodeMetadataCacheOnDemand,
                                               decoder.put())))
        return nullptr;
    ComPtr<IWICBitmapFrameDecode> frame;
    if (FAILED(decoder->GetFrame(0, frame.put()))) return nullptr;
    ComPtr<IWICFormatConverter> converter;
    if (FAILED(wic_->CreateFormatConverter(converter.put()))) return nullptr;
    if (FAILED(converter->Initialize(frame.get(), GUID_WICPixelFormat32bppPBGRA,
                                     WICBitmapDitherTypeNone, nullptr, 0.0,
                                     WICBitmapPaletteTypeCustom)))
        return nullptr;
    ComPtr<ID2D1Bitmap> bitmap;
    if (FAILED(d2d_context_->CreateBitmapFromWicBitmap(converter.get(), nullptr,
                                                       bitmap.put())))
        return nullptr;
    images_.emplace(path, std::move(bitmap));
    return images_[path].get();
}

void Renderer::unload(const std::wstring& path) { images_.erase(path); }

void Renderer::draw_image_path(const std::wstring& path, D2D1_RECT_F rect, float radius,
                               float opacity) {
    draw_image(image(path), rect, radius, opacity);
}

void Renderer::clip_push(D2D1_RECT_F rect) {
    target_->PushAxisAlignedClip(rect, D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
}

void Renderer::clip_pop() { target_->PopAxisAlignedClip(); }

void Renderer::opacity_push(float value) {
    if (!d2d_context_) return;
    ComPtr<ID2D1Layer> layer;
    if (FAILED(target_->CreateLayer(nullptr, layer.put())) || !layer) return;
    D2D1_LAYER_PARAMETERS params = D2D1::LayerParameters(
        D2D1::InfiniteRect(), nullptr, D2D1_ANTIALIAS_MODE_PER_PRIMITIVE,
        D2D1::IdentityMatrix(), std::clamp(value, 0.0f, 1.0f), nullptr,
        D2D1_LAYER_OPTIONS_NONE);
    target_->PushLayer(params, layer.get());
    layers_.push_back(std::move(layer));
}

void Renderer::opacity_pop() {
    if (!d2d_context_ || layers_.empty()) return;
    target_->PopLayer();
    layers_.pop_back();
}


bool Renderer::ensure_surface(float width, float height, ComPtr<ID3D11Texture2D>& tex,
                              ComPtr<ID3D11ShaderResourceView>& srv,
                              ComPtr<ID2D1Bitmap1>& bitmap, UINT& pixel_w, UINT& pixel_h) {
    if (!d3d_device_ || !main_context_) return false;
    UINT pw = std::max<UINT>(1, UINT(width * scale_ + 0.5f));
    UINT ph = std::max<UINT>(1, UINT(height * scale_ + 0.5f));
    if (bitmap && pixel_w == pw && pixel_h == ph) return true;

    bitmap.reset();
    srv.reset();
    tex.reset();

    D3D11_TEXTURE2D_DESC desc{};
    desc.Width = pw;
    desc.Height = ph;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    if (FAILED(d3d_device_->CreateTexture2D(&desc, nullptr, tex.put()))) return false;
    if (FAILED(d3d_device_->CreateShaderResourceView(tex.get(), nullptr, srv.put())))
        return false;
    ComPtr<IDXGISurface> surface;
    if (FAILED(tex->QueryInterface(__uuidof(IDXGISurface), (void**)surface.put())))
        return false;
    D2D1_BITMAP_PROPERTIES1 props = D2D1::BitmapProperties1(
        D2D1_BITMAP_OPTIONS_TARGET,
        D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED),
        96.0f * scale_, 96.0f * scale_);
    if (FAILED(main_context_->CreateBitmapFromDxgiSurface(surface.get(), &props, bitmap.put())))
        return false;
    pixel_w = pw;
    pixel_h = ph;
    return true;
}

bool Renderer::capture_begin(float width, float height, float translate_x, float translate_y) {
    if (!main_context_ || !render_target_) return false;
    if (hwnd_) {
        UINT dpi = GetDpiForWindow(hwnd_);
        if (dpi > 0) scale_ = dpi / 96.0f;
    }
    if (!ensure_surface(width, height, sidebar_tex_, sidebar_srv_, sidebar_bitmap_,
                        sidebar_px_w_, sidebar_px_h_))
        return false;
    main_context_->SetTarget(sidebar_bitmap_.get());
    main_context_->BeginDraw();
    main_context_->Clear(D2D1::ColorF(0, 0.0f));
    base_transform_ = D2D1::Matrix3x2F::Translation(-translate_x, -translate_y);
    target_ = main_context_.get();
    target_->SetTransform(base_transform_);
    return true;
}

void Renderer::capture_end() {
    if (!main_context_) return;
    HRESULT hr = main_context_->EndDraw();
    if (FAILED(hr) && hr != D2DERR_RECREATE_TARGET) {
        sidebar_bitmap_.reset();
        sidebar_srv_.reset();
        sidebar_tex_.reset();
    }
    main_context_->SetTarget(render_target_.get());
    target_ = d2d_context_;
    base_transform_ = D2D1::Matrix3x2F::Scale(scale_, scale_);
    if (target_) target_->SetTransform(base_transform_);
}

bool Renderer::capture_item_begin(float width, float height, float translate_x,
                                  float translate_y) {
    if (!main_context_ || !render_target_) return false;
    if (!ensure_surface(width, height, item_tex_, item_srv_, item_bitmap_, item_px_w_,
                        item_px_h_))
        return false;
    main_context_->SetTarget(item_bitmap_.get());
    main_context_->BeginDraw();
    main_context_->Clear(D2D1::ColorF(0, 0.0f));
    base_transform_ = D2D1::Matrix3x2F::Translation(-translate_x, -translate_y);
    target_ = main_context_.get();
    target_->SetTransform(base_transform_);
    return true;
}

void Renderer::capture_item_end() {
    if (!main_context_) return;
    HRESULT hr = main_context_->EndDraw();
    if (FAILED(hr) && hr != D2DERR_RECREATE_TARGET) {
        item_bitmap_.reset();
        item_srv_.reset();
        item_tex_.reset();
    }
    main_context_->SetTarget(render_target_.get());
    target_ = d2d_context_;
    base_transform_ = D2D1::Matrix3x2F::Scale(scale_, scale_);
    if (target_) target_->SetTransform(base_transform_);
}

bool Renderer::ensure_quad_pipeline() {
    if (quad_ok_) return true;
    if (!d3d_device_) return false;

    static const char* vs_src =
        "cbuffer QuadCB : register(b0) {\n"
        "  float2 half_dip; float2 pad; float4 tint;\n"
        "};\n"
        "struct VSIn { float2 pos : POSITION; float2 uv : TEXCOORD0; float w : TEXCOORD1; };\n"
        "struct VSOut { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; };\n"
        "VSOut VSMain(VSIn i) {\n"
        "  float2 ndc = float2(i.pos.x / half_dip.x - 1.0f, 1.0f - i.pos.y / half_dip.y);\n"
        "  VSOut o;\n"
        "  o.pos = float4(ndc * i.w, 0.0f, i.w);\n"
        "  o.uv = i.uv;\n"
        "  return o;\n"
        "}\n";
    static const char* ps_src =
        "cbuffer QuadCB : register(b0) {\n"
        "  float2 half_dip; float2 pad; float4 tint;\n"
        "};\n"
        "Texture2D sideTex : register(t0);\n"
        "SamplerState sideSamp : register(s0);\n"
        "float4 PSMain(float4 pos : SV_POSITION, float2 uv : TEXCOORD0) : SV_Target {\n"
        "  return sideTex.Sample(sideSamp, uv) * tint;\n"
        "}\n";

    ComPtr<ID3DBlob> vs_blob, ps_blob, errors;
    if (FAILED(D3DCompile(vs_src, strlen(vs_src), nullptr, nullptr, nullptr, "VSMain",
                          "vs_4_0", D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, vs_blob.put(),
                          errors.put())))
        return false;
    errors.reset();
    if (FAILED(D3DCompile(ps_src, strlen(ps_src), nullptr, nullptr, nullptr, "PSMain",
                          "ps_4_0", D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, ps_blob.put(),
                          errors.put())))
        return false;
    if (FAILED(d3d_device_->CreateVertexShader(vs_blob->GetBufferPointer(),
                                               vs_blob->GetBufferSize(), nullptr,
                                               quad_vs_.put())))
        return false;
    if (FAILED(d3d_device_->CreatePixelShader(ps_blob->GetBufferPointer(),
                                              ps_blob->GetBufferSize(), nullptr,
                                              quad_ps_.put())))
        return false;

    D3D11_INPUT_ELEMENT_DESC layout[] = {
        { "POSITION", 0, DXGI_FORMAT_R32G32_FLOAT, 0, 0, D3D11_INPUT_PER_VERTEX_DATA, 0 },
        { "TEXCOORD", 0, DXGI_FORMAT_R32G32_FLOAT, 0, 8, D3D11_INPUT_PER_VERTEX_DATA, 0 },
        { "TEXCOORD", 1, DXGI_FORMAT_R32_FLOAT, 0, 16, D3D11_INPUT_PER_VERTEX_DATA, 0 },
    };
    if (FAILED(d3d_device_->CreateInputLayout(layout, UINT(std::size(layout)),
                                              vs_blob->GetBufferPointer(),
                                              vs_blob->GetBufferSize(),
                                              quad_layout_.put())))
        return false;

    D3D11_BUFFER_DESC vb_desc{};
    vb_desc.ByteWidth = sizeof(float) * 5 * 4;
    vb_desc.Usage = D3D11_USAGE_DYNAMIC;
    vb_desc.BindFlags = D3D11_BIND_VERTEX_BUFFER;
    vb_desc.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    if (FAILED(d3d_device_->CreateBuffer(&vb_desc, nullptr, quad_vb_.put()))) return false;

    const unsigned short indices[6] = { 0, 1, 2, 0, 2, 3 };
    D3D11_BUFFER_DESC ib_desc{};
    ib_desc.ByteWidth = sizeof(indices);
    ib_desc.Usage = D3D11_USAGE_IMMUTABLE;
    ib_desc.BindFlags = D3D11_BIND_INDEX_BUFFER;
    D3D11_SUBRESOURCE_DATA ib_data{};
    ib_data.pSysMem = indices;
    if (FAILED(d3d_device_->CreateBuffer(&ib_desc, &ib_data, quad_ib_.put()))) return false;

    D3D11_BUFFER_DESC cb_desc{};
    cb_desc.ByteWidth = 32;
    cb_desc.Usage = D3D11_USAGE_DYNAMIC;
    cb_desc.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
    cb_desc.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    if (FAILED(d3d_device_->CreateBuffer(&cb_desc, nullptr, quad_cb_.put()))) return false;

    D3D11_SAMPLER_DESC samp{};
    samp.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    samp.AddressU = samp.AddressV = samp.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    samp.ComparisonFunc = D3D11_COMPARISON_NEVER;
    samp.MaxLOD = D3D11_FLOAT32_MAX;
    if (FAILED(d3d_device_->CreateSamplerState(&samp, quad_sampler_.put()))) return false;

    D3D11_BLEND_DESC blend{};
    blend.RenderTarget[0].BlendEnable = TRUE;
    blend.RenderTarget[0].SrcBlend = D3D11_BLEND_ONE;
    blend.RenderTarget[0].DestBlend = D3D11_BLEND_INV_SRC_ALPHA;
    blend.RenderTarget[0].BlendOp = D3D11_BLEND_OP_ADD;
    blend.RenderTarget[0].SrcBlendAlpha = D3D11_BLEND_ONE;
    blend.RenderTarget[0].DestBlendAlpha = D3D11_BLEND_INV_SRC_ALPHA;
    blend.RenderTarget[0].BlendOpAlpha = D3D11_BLEND_OP_ADD;
    blend.RenderTarget[0].RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
    if (FAILED(d3d_device_->CreateBlendState(&blend, quad_blend_.put()))) return false;

    D3D11_RASTERIZER_DESC raster{};
    raster.FillMode = D3D11_FILL_SOLID;
    raster.CullMode = D3D11_CULL_NONE;
    raster.DepthClipEnable = TRUE;
    if (FAILED(d3d_device_->CreateRasterizerState(&raster, quad_raster_.put()))) return false;

    quad_ok_ = true;
    return true;
}

bool Renderer::sidebar_3d_ready() {
    return ensure_quad_pipeline() && sidebar_srv_ && backbuffer_rtv_;
}

bool Renderer::sidebar_item_ready() {
    return ensure_quad_pipeline() && item_srv_ && backbuffer_rtv_;
}

void Renderer::project_sidebar_quad(const D2D1_RECT_F& rect, float angle_degrees,
                                    float* verts) const {
    float w = rect.right - rect.left;
    float h = rect.bottom - rect.top;
    const float depth = 900.0f;
    float radians = std::fabs(angle_degrees) * 3.14159265358979f / 180.0f;
    float cs = std::cos(radians);
    float sn = std::fabs(std::sin(radians));
    float pivot_y = rect.top + h * 0.5f;

    const float local[4][2] = {
        { 0.0f, 0.0f }, { w, 0.0f }, { w, h }, { 0.0f, h },
    };
    const float uv[4][2] = {
        { 0.0f, 0.0f }, { 1.0f, 0.0f }, { 1.0f, 1.0f }, { 0.0f, 1.0f },
    };
    for (int i = 0; i < 4; ++i) {
        float x = local[i][0];
        float y = local[i][1];
        float z = x * sn;
        float s = depth / (depth + z);
        float* v = verts + i * 5;
        v[0] = rect.left + x * cs * s;
        v[1] = pivot_y + (y - h * 0.5f) * s;
        v[2] = uv[i][0];
        v[3] = uv[i][1];
        v[4] = 1.0f / s;
    }
}

void Renderer::draw_textured_quad(ID3D11ShaderResourceView* srv, const float* verts,
                                  const float* tint) {
    D3D11_MAPPED_SUBRESOURCE mapped{};
    if (FAILED(d3d_context_->Map(quad_vb_.get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped)))
        return;
    memcpy(mapped.pData, verts, sizeof(float) * 5 * 4);
    d3d_context_->Unmap(quad_vb_.get(), 0);

    float cb[8] = { float(width_) / scale_ * 0.5f, float(height_) / scale_ * 0.5f,
                    0.0f, 0.0f, tint[0], tint[1], tint[2], tint[3] };
    if (FAILED(d3d_context_->Map(quad_cb_.get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped)))
        return;
    memcpy(mapped.pData, cb, sizeof(cb));
    d3d_context_->Unmap(quad_cb_.get(), 0);

    ID3D11RenderTargetView* rtv = backbuffer_rtv_.get();
    d3d_context_->OMSetRenderTargets(1, &rtv, nullptr);
    D3D11_VIEWPORT viewport{ 0.0f, 0.0f, float(width_), float(height_), 0.0f, 1.0f };
    d3d_context_->RSSetViewports(1, &viewport);
    d3d_context_->IASetInputLayout(quad_layout_.get());
    d3d_context_->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    UINT stride = sizeof(float) * 5, offset = 0;
    ID3D11Buffer* vb = quad_vb_.get();
    d3d_context_->IASetVertexBuffers(0, 1, &vb, &stride, &offset);
    d3d_context_->IASetIndexBuffer(quad_ib_.get(), DXGI_FORMAT_R16_UINT, 0);
    d3d_context_->VSSetShader(quad_vs_.get(), nullptr, 0);
    ID3D11Buffer* cb_buf = quad_cb_.get();
    d3d_context_->VSSetConstantBuffers(0, 1, &cb_buf);
    d3d_context_->PSSetShader(quad_ps_.get(), nullptr, 0);
    d3d_context_->PSSetConstantBuffers(0, 1, &cb_buf);
    d3d_context_->PSSetShaderResources(0, 1, &srv);
    ID3D11SamplerState* sampler = quad_sampler_.get();
    d3d_context_->PSSetSamplers(0, 1, &sampler);
    d3d_context_->OMSetBlendState(quad_blend_.get(), nullptr, 0xFFFFFFFF);
    d3d_context_->RSSetState(quad_raster_.get());
    d3d_context_->DrawIndexed(6, 0, 0);
}

bool Renderer::draw_sidebar_3d(const D2D1_RECT_F& rect, float angle_degrees) {
    if (!sidebar_3d_ready() || !d3d_context_ || !sidebar_bitmap_) return false;
    if (rect.right - rect.left <= 0.0f || rect.bottom - rect.top <= 0.0f) return false;
    float verts[4 * 5];
    project_sidebar_quad(rect, angle_degrees, verts);
    const float tint[4] = { 1.0f, 1.0f, 1.0f, 1.0f };
    draw_textured_quad(sidebar_srv_.get(), verts, tint);
    ID3D11ShaderResourceView* null_srv = nullptr;
    d3d_context_->PSSetShaderResources(0, 1, &null_srv);
    return true;
}

void Renderer::project_item_quad(const D2D1_RECT_F& item, const D2D1_RECT_F& sidebar,
                                 float angle_degrees, float lift, float* verts) const {
    float w = item.right - item.left;
    float h = item.bottom - item.top;
    const float depth = 900.0f;
    float radians = std::fabs(angle_degrees) * 3.14159265358979f / 180.0f;
    float cs = std::cos(radians);
    float sn = std::fabs(std::sin(radians));
    float side_left = sidebar.left;
    float center_y = sidebar.top + (sidebar.bottom - sidebar.top) * 0.5f;

    const float local[4][2] = {
        { 0.0f, 0.0f }, { w, 0.0f }, { w, h }, { 0.0f, h },
    };
    const float uv[4][2] = {
        { 0.0f, 0.0f }, { 1.0f, 0.0f }, { 1.0f, 1.0f }, { 0.0f, 1.0f },
    };
    for (int i = 0; i < 4; ++i) {
        // Project from the sidebar origin so the quad lands on its row.
        float xa = (item.left - side_left) + local[i][0];
        float ya = item.top + local[i][1];
        float z = xa * sn;
        float s = depth / (depth + z);
        float* v = verts + i * 5;
        v[0] = side_left + xa * cs * s;
        v[1] = center_y + (ya - center_y) * s;
        v[2] = uv[i][0];
        v[3] = uv[i][1];
        v[4] = 1.0f / s;
    }

    if (lift > 0.0001f) {
        // Same direction for every row: grow about the row's own centre and
        // drift up/right toward the viewer (no per-row fan-out).
        float cx = (verts[0] + verts[5] + verts[10] + verts[15]) * 0.25f;
        float cy = (verts[1] + verts[6] + verts[11] + verts[16]) * 0.25f;
        float scale = 1.0f + 0.07f * lift;
        float dx = 4.0f * lift;
        float dy = -2.5f * lift;
        for (int i = 0; i < 4; ++i) {
            float* v = verts + i * 5;
            v[0] = cx + (v[0] - cx) * scale + dx;
            v[1] = cy + (v[1] - cy) * scale + dy;
        }
    }
}

bool Renderer::draw_sidebar_item_3d(const D2D1_RECT_F& rect, const D2D1_RECT_F& sidebar,
                                    float angle_degrees, float lift) {
    if (!sidebar_item_ready() || !d3d_context_ || !item_bitmap_) return false;
    if (rect.right - rect.left <= 0.0f || rect.bottom - rect.top <= 0.0f) return false;
    lift = std::clamp(lift, 0.0f, 1.5f);

    float verts[4 * 5];
    project_item_quad(rect, sidebar, angle_degrees, lift, verts);
    const float tint[4] = { 1.0f, 1.0f, 1.0f, 1.0f };
    draw_textured_quad(item_srv_.get(), verts, tint);

    ID3D11ShaderResourceView* null_srv = nullptr;
    d3d_context_->PSSetShaderResources(0, 1, &null_srv);
    return true;
}

namespace {

std::string read_binary(const std::wstring& path) {
    std::string out;
    FILE* file = _wfopen(path.c_str(), L"rb");
    if (!file) return out;
    fseek(file, 0, SEEK_END);
    long size = ftell(file);
    fseek(file, 0, SEEK_SET);
    if (size > 0) {
        out.resize(size_t(size));
        fread(out.data(), 1, size_t(size), file);
    }
    fclose(file);
    return out;
}

bool tag_attr(const std::string& tag, const char* name, std::string& out) {
    std::string key = std::string(name) + "=";
    size_t pos = tag.find(key);
    if (pos == std::string::npos) return false;
    pos += key.size();
    if (pos >= tag.size()) return false;
    char quote = tag[pos];
    if (quote == '"' || quote == '\'') {
        ++pos;
        size_t end = tag.find(quote, pos);
        if (end == std::string::npos) return false;
        out = tag.substr(pos, end - pos);
        return true;
    }
    size_t end = pos;
    while (end < tag.size() && !std::isspace((unsigned char)tag[end]) && tag[end] != '>')
        ++end;
    out = tag.substr(pos, end - pos);
    return true;
}

struct SvgPathParser {
    ID2D1GeometrySink* sink = nullptr;
    const char* p = nullptr;
    const char* end = nullptr;
    bool figure = false;
    float cx = 0, cy = 0, sx = 0, sy = 0;
    float lcx = 0, lcy = 0;
    float lqx = 0, lqy = 0;
    char last = 0;

    void skip() {
        while (p < end && (std::isspace((unsigned char)*p) || *p == ',')) ++p;
    }
    bool number(float& value) {
        skip();
        char* stop = nullptr;
        value = std::strtof(p, &stop);
        if (stop == p) return false;
        p = stop;
        return true;
    }
    void begin(float x, float y) {
        if (figure) sink->EndFigure(D2D1_FIGURE_END_CLOSED);
        cx = sx = x;
        cy = sy = y;
        sink->BeginFigure(D2D1::Point2F(x, y), D2D1_FIGURE_BEGIN_FILLED);
        figure = true;
        last = 0;
    }
    void line(float x, float y) {
        if (!figure) begin(cx, cy);
        sink->AddLine(D2D1::Point2F(x, y));
        cx = x;
        cy = y;
    }
    void cubic(float x1, float y1, float x2, float y2, float x, float y) {
        if (!figure) begin(cx, cy);
        sink->AddBezier(D2D1::BezierSegment(D2D1::Point2F(x1, y1), D2D1::Point2F(x2, y2),
                                             D2D1::Point2F(x, y)));
        lcx = x2;
        lcy = y2;
        cx = x;
        cy = y;
    }
    void quad(float x1, float y1, float x, float y) {
        if (!figure) begin(cx, cy);
        sink->AddQuadraticBezier(D2D1::QuadraticBezierSegment(D2D1::Point2F(x1, y1),
                                                               D2D1::Point2F(x, y)));
        lqx = x1;
        lqy = y1;
        cx = x;
        cy = y;
    }
    void run() {
        char cmd = 0;
        while (true) {
            skip();
            if (p >= end) break;
            char c = *p;
            if (std::isalpha((unsigned char)c)) {
                cmd = c;
                ++p;
            } else if (cmd == 0) {
                ++p;
                continue;
            } else if (cmd == 'M') {
                cmd = 'L';
            } else if (cmd == 'm') {
                cmd = 'l';
            }
            float x = 0, y = 0, x1 = 0, y1 = 0, x2 = 0, y2 = 0;
            float rx = 0, ry = 0, rot = 0, large = 0, sweep = 0;
            switch (cmd) {
                case 'M':
                case 'm':
                    if (!number(x) || !number(y)) return;
                    if (cmd == 'm') { x += cx; y += cy; }
                    begin(x, y);
                    break;
                case 'L':
                case 'l':
                    if (!number(x) || !number(y)) return;
                    if (cmd == 'l') { x += cx; y += cy; }
                    line(x, y);
                    last = 'l';
                    break;
                case 'H':
                case 'h':
                    if (!number(x)) return;
                    if (cmd == 'h') x += cx;
                    line(x, cy);
                    last = 'h';
                    break;
                case 'V':
                case 'v':
                    if (!number(y)) return;
                    if (cmd == 'v') y += cy;
                    line(cx, y);
                    last = 'v';
                    break;
                case 'C':
                case 'c':
                    if (!number(x1) || !number(y1) || !number(x2) || !number(y2) ||
                        !number(x) || !number(y))
                        return;
                    if (cmd == 'c') {
                        x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy;
                    }
                    cubic(x1, y1, x2, y2, x, y);
                    last = 'c';
                    break;
                case 'S':
                case 's': {
                    float px = last == 'c' || last == 's' ? 2 * cx - lcx : cx;
                    float py = last == 'c' || last == 's' ? 2 * cy - lcy : cy;
                    if (!number(x2) || !number(y2) || !number(x) || !number(y)) return;
                    if (cmd == 's') { x2 += cx; y2 += cy; x += cx; y += cy; }
                    cubic(px, py, x2, y2, x, y);
                    last = 's';
                    break;
                }
                case 'Q':
                case 'q':
                    if (!number(x1) || !number(y1) || !number(x) || !number(y)) return;
                    if (cmd == 'q') { x1 += cx; y1 += cy; x += cx; y += cy; }
                    quad(x1, y1, x, y);
                    last = 'q';
                    break;
                case 'T':
                case 't': {
                    float px = last == 'q' || last == 't' ? 2 * cx - lqx : cx;
                    float py = last == 'q' || last == 't' ? 2 * cy - lqy : cy;
                    if (!number(x) || !number(y)) return;
                    if (cmd == 't') { x += cx; y += cy; }
                    quad(px, py, x, y);
                    last = 't';
                    break;
                }
                case 'A':
                case 'a':
                    if (!number(rx) || !number(ry) || !number(rot) || !number(large) ||
                        !number(sweep) || !number(x) || !number(y))
                        return;
                    if (cmd == 'a') { x += cx; y += cy; }
                    if (!figure) begin(cx, cy);
                    {
                        D2D1_ARC_SEGMENT arc = D2D1::ArcSegment(
                            D2D1::Point2F(x, y), D2D1::SizeF(std::fabs(rx), std::fabs(ry)),
                            rot, sweep != 0.0f ? D2D1_SWEEP_DIRECTION_CLOCKWISE
                                               : D2D1_SWEEP_DIRECTION_COUNTER_CLOCKWISE,
                            large != 0.0f ? D2D1_ARC_SIZE_LARGE : D2D1_ARC_SIZE_SMALL);
                        sink->AddArc(&arc);
                    }
                    cx = x;
                    cy = y;
                    last = 'a';
                    break;
                case 'Z':
                case 'z':
                    if (figure) {
                        sink->EndFigure(D2D1_FIGURE_END_CLOSED);
                        figure = false;
                        cx = sx;
                        cy = sy;
                    }
                    last = 'z';
                    break;
                default:
                    return;
            }
        }
        if (figure) sink->EndFigure(D2D1_FIGURE_END_CLOSED);
    }
};

}  // namespace

Renderer::SvgDef* Renderer::ensure_svg(const std::wstring& path) {
    auto it = svgs_.find(path);
    if (it != svgs_.end()) return &it->second;
    SvgDef def;
    std::string data = read_binary(path);
    if (data.empty()) {
        svgs_[path] = std::move(def);
        return &svgs_[path];
    }
    std::string view = "";
    size_t svg_tag = data.find("<svg");
    if (svg_tag != std::string::npos) {
        std::string tag = data.substr(svg_tag, data.find('>', svg_tag) - svg_tag);
        if (tag_attr(tag, "viewBox", view)) {
            float a = 0, b = 0, w = 256, h = 256;
            sscanf(view.c_str(), "%f %f %f %f", &a, &b, &w, &h);
            if (w > 0) def.vb_w = w;
            if (h > 0) def.vb_h = h;
        }
    }
    size_t pos = 0;
    while ((pos = data.find("<path", pos)) != std::string::npos) {
        size_t close = data.find('>', pos);
        if (close == std::string::npos) break;
        std::string tag = data.substr(pos, close - pos);
        pos = close + 1;
        std::string d;
        if (!tag_attr(tag, "d", d) || d.empty()) continue;
        std::string rule;
        bool evenodd = tag_attr(tag, "fill-rule", rule) && rule == "evenodd";
        float opacity = 1.0f;
        std::string op;
        if (tag_attr(tag, "opacity", op)) opacity = float(atof(op.c_str()));
        std::string fop;
        if (tag_attr(tag, "fill-opacity", fop)) opacity *= float(atof(fop.c_str()));

        ComPtr<ID2D1PathGeometry> geometry;
        if (FAILED(d2d_factory_->CreatePathGeometry(geometry.put()))) continue;
        ComPtr<ID2D1GeometrySink> sink;
        if (FAILED(geometry->Open(sink.put()))) continue;
        sink->SetFillMode(evenodd ? D2D1_FILL_MODE_ALTERNATE : D2D1_FILL_MODE_WINDING);
        SvgPathParser parser;
        parser.sink = sink.get();
        parser.p = d.c_str();
        parser.end = d.c_str() + d.size();
        parser.run();
        sink->Close();
        SvgPart part;
        part.geometry = std::move(geometry);
        part.opacity = opacity;
        def.parts.push_back(std::move(part));
    }
    svgs_[path] = std::move(def);
    return &svgs_[path];
}

void Renderer::draw_svg(const std::wstring& path, D2D1_RECT_F rect, Color color,
                        float opacity, float rotation) {
    SvgDef* def = ensure_svg(path);
    if (!def || def->parts.empty() || !color.visible() || opacity <= 0.001f) return;
    float w = rect.right - rect.left;
    float h = rect.bottom - rect.top;
    if (w <= 0.0f || h <= 0.0f) return;
    D2D1_MATRIX_3X2_F icon = {
        w / def->vb_w, 0.0f,
        0.0f, h / def->vb_h,
        rect.left, rect.top,
    };
    if (rotation != 0.0f) {
        D2D1_POINT_2F center = D2D1::Point2F(rect.left + w * 0.5f, rect.top + h * 0.5f);
        icon = icon * D2D1::Matrix3x2F::Rotation(rotation, center);
    }
    target_->PushAxisAlignedClip(rect, D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
    target_->SetTransform(icon * base_transform_);
    for (const auto& part : def->parts) {
        ComPtr<ID2D1SolidColorBrush> brush;
        target_->CreateSolidColorBrush(to_d2d(color), brush.put());
        if (!brush) continue;
        brush->SetOpacity(std::clamp(opacity * part.opacity, 0.0f, 1.0f));
        target_->FillGeometry(part.geometry.get(), brush.get());
    }
    target_->PopAxisAlignedClip();
    target_->SetTransform(base_transform_);
}

void Renderer::draw_rgba(const std::vector<unsigned char>& pixels, int width, int height,
                         D2D1_RECT_F rect, float opacity) {
    if (pixels.empty() || width <= 0 || height <= 0 || opacity <= 0.001f) return;
    ComPtr<ID2D1Bitmap> bitmap;
    D2D1_BITMAP_PROPERTIES props = D2D1::BitmapProperties(
        D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED),
        96.0f, 96.0f);
    if (FAILED(target_->CreateBitmap(D2D1::SizeU(UINT(width), UINT(height)),
                                          pixels.data(), UINT(width * 4), &props,
                                          bitmap.put())))
        return;
    target_->DrawBitmap(bitmap.get(), rect, std::clamp(opacity, 0.0f, 1.0f),
                             D2D1_BITMAP_INTERPOLATION_MODE_LINEAR, nullptr);
}

bool Renderer::load_pixels(const std::wstring& path, std::vector<unsigned char>& pixels,
                           unsigned& width, unsigned& height) {
    if (!wic_) return false;
    std::wstring full = path;
    for (auto& ch : full) if (ch == L'/') ch = L'\\';
    wchar_t resolved[1024];
    DWORD n = GetFullPathNameW(full.c_str(), 1024, resolved, nullptr);
    std::wstring decodePath = (n > 0 && n < 1024) ? std::wstring(resolved, n) : full;
    ComPtr<IWICBitmapDecoder> decoder;
    if (FAILED(wic_->CreateDecoderFromFilename(decodePath.c_str(), nullptr, GENERIC_READ,
                                               WICDecodeMetadataCacheOnDemand,
                                               decoder.put())))
        return false;
    ComPtr<IWICBitmapFrameDecode> frame;
    if (FAILED(decoder->GetFrame(0, frame.put()))) return false;
    ComPtr<IWICFormatConverter> converter;
    if (FAILED(wic_->CreateFormatConverter(converter.put()))) return false;
    if (FAILED(converter->Initialize(frame.get(), GUID_WICPixelFormat32bppPBGRA,
                                     WICBitmapDitherTypeNone, nullptr, 0.0,
                                     WICBitmapPaletteTypeCustom)))
        return false;
    UINT w = 0, h = 0;
    converter->GetSize(&w, &h);
    if (w == 0 || h == 0) return false;
    pixels.resize(size_t(w) * h * 4);
    if (FAILED(converter->CopyPixels(nullptr, w * 4, UINT(pixels.size()), pixels.data())))
        return false;
    width = w;
    height = h;
    return true;
}

bool make_head_png(const std::wstring& skin_path, const std::wstring& out_path) {
    ComPtr<IWICImagingFactory> factory;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(factory.put()))))
        return false;
    ComPtr<IWICBitmapDecoder> decoder;
    if (FAILED(factory->CreateDecoderFromFilename(skin_path.c_str(), nullptr, GENERIC_READ,
                                                  WICDecodeMetadataCacheOnLoad,
                                                  decoder.put())))
        return false;
    ComPtr<IWICBitmapFrameDecode> frame;
    if (FAILED(decoder->GetFrame(0, frame.put()))) return false;
    ComPtr<IWICFormatConverter> converter;
    if (FAILED(factory->CreateFormatConverter(converter.put()))) return false;
    if (FAILED(converter->Initialize(frame.get(), GUID_WICPixelFormat32bppBGRA,
                                     WICBitmapDitherTypeNone, nullptr, 0.0,
                                     WICBitmapPaletteTypeCustom)))
        return false;
    UINT w = 0, h = 0;
    if (FAILED(converter->GetSize(&w, &h)) || w < 64 || h < 32) return false;
    std::vector<unsigned char> pixels(size_t(w) * h * 4);
    if (FAILED(converter->CopyPixels(nullptr, w * 4, UINT(pixels.size()), pixels.data())))
        return false;
    std::vector<unsigned char> head(32 * 32 * 4);
    for (int y = 0; y < 32; ++y) {
        for (int x = 0; x < 32; ++x) {
            size_t face = (size_t(8 + y / 4) * w + (8 + x / 4)) * 4;
            float r = pixels[face + 2], g = pixels[face + 1], b = pixels[face + 0];
            float a = pixels[face + 3] / 255.0f;
            if (h >= 64) {
                size_t hat = (size_t(8 + y / 4) * w + (40 + x / 4)) * 4;
                float ha = pixels[hat + 3] / 255.0f;
                if (ha > 0.0f) {
                    float out_a = ha + a * (1.0f - ha);
                    r = (pixels[hat + 2] * ha + r * a * (1.0f - ha)) / out_a;
                    g = (pixels[hat + 1] * ha + g * a * (1.0f - ha)) / out_a;
                    b = (pixels[hat + 0] * ha + b * a * (1.0f - ha)) / out_a;
                    a = out_a;
                }
            }
            size_t dst = (size_t(y) * 32 + x) * 4;
            head[dst + 0] = (unsigned char)std::clamp(b, 0.0f, 255.0f);
            head[dst + 1] = (unsigned char)std::clamp(g, 0.0f, 255.0f);
            head[dst + 2] = (unsigned char)std::clamp(r, 0.0f, 255.0f);
            head[dst + 3] = (unsigned char)std::clamp(a * 255.0f, 0.0f, 255.0f);
        }
    }
    ComPtr<IWICBitmap> bitmap;
    if (FAILED(factory->CreateBitmapFromMemory(32, 32, GUID_WICPixelFormat32bppBGRA, 32 * 4,
                                               32 * 32 * 4, head.data(), bitmap.put())))
        return false;
    ComPtr<IWICStream> stream;
    if (FAILED(factory->CreateStream(stream.put()))) return false;
    if (FAILED(stream->InitializeFromFilename(out_path.c_str(), GENERIC_WRITE))) return false;
    ComPtr<IWICBitmapEncoder> encoder;
    if (FAILED(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, encoder.put())))
        return false;
    if (FAILED(encoder->Initialize(stream.get(), WICBitmapEncoderNoCache))) return false;
    ComPtr<IWICBitmapFrameEncode> encode_frame;
    ComPtr<IPropertyBag2> props;
    if (FAILED(encoder->CreateNewFrame(encode_frame.put(), props.put()))) return false;
    if (FAILED(encode_frame->Initialize(props.get()))) return false;
    if (FAILED(encode_frame->SetSize(32, 32))) return false;
    WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
    if (FAILED(encode_frame->SetPixelFormat(&format))) return false;
    if (FAILED(encode_frame->WriteSource(bitmap.get(), nullptr))) return false;
    if (FAILED(encode_frame->Commit())) return false;
    if (FAILED(encoder->Commit())) return false;
    stream->Commit(STGC_DEFAULT);
    return true;
}
