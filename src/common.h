#pragma once
#include <windows.h>
#include <d2d1.h>
#include <dwrite.h>
#include <string>
#include <vector>
#include <unordered_map>
#include <memory>
#include <algorithm>

template <class T>
class ComPtr {
public:
    ComPtr() = default;
    ComPtr(const ComPtr&) = delete;
    ComPtr& operator=(const ComPtr&) = delete;
    ComPtr(ComPtr&& other) noexcept : ptr_(other.ptr_) { other.ptr_ = nullptr; }
    ComPtr& operator=(ComPtr&& other) noexcept {
        if (this != &other) {
            reset();
            ptr_ = other.ptr_;
            other.ptr_ = nullptr;
        }
        return *this;
    }
    ~ComPtr() { reset(); }

    void reset() {
        if (ptr_) {
            ptr_->Release();
            ptr_ = nullptr;
        }
    }
    T* get() const { return ptr_; }
    T** put() {
        reset();
        return &ptr_;
    }
    T* operator->() const { return ptr_; }
    explicit operator bool() const { return ptr_ != nullptr; }

private:
    T* ptr_ = nullptr;
};

struct Color {
    float r = 0.0f, g = 0.0f, b = 0.0f, a = 0.0f;
    bool visible() const { return a > 0.002f; }
    static Color rgb(unsigned hex, float alpha = 1.0f) {
        return Color{ ((hex >> 16) & 0xFF) / 255.0f, ((hex >> 8) & 0xFF) / 255.0f,
                      (hex & 0xFF) / 255.0f, alpha };
    }
};

inline D2D1_COLOR_F to_d2d(Color c) { return D2D1::ColorF(c.r, c.g, c.b, c.a); }

Color parse_color(const std::wstring& text);

std::wstring read_text_file(const std::wstring& path);
std::wstring widen(const std::string& text);
