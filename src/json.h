#pragma once
#include <windows.h>
#include <string>
#include <vector>
#include <utility>
#include <cstdio>
#include <cstdlib>
#include <cmath>

struct Json {
    enum class Type { Null, Bool, Number, String, Array, Object };
    Type type = Type::Null;
    bool b = false;
    double num = 0.0;
    std::string str;
    std::vector<Json> arr;
    std::vector<std::pair<std::string, Json>> obj;

    const Json* find(const char* key) const {
        for (const auto& kv : obj)
            if (kv.first == key) return &kv.second;
        return nullptr;
    }
    Json* find(const char* key) {
        for (auto& kv : obj)
            if (kv.first == key) return &kv.second;
        return nullptr;
    }
    std::string text(const char* key, const std::string& fallback = "") const {
        const Json* v = find(key);
        return v && v->type == Type::String ? v->str : fallback;
    }
    double number(const char* key, double fallback = 0.0) const {
        const Json* v = find(key);
        return v && v->type == Type::Number ? v->num : fallback;
    }
    bool boolean(const char* key, bool fallback = false) const {
        const Json* v = find(key);
        if (!v) return fallback;
        if (v->type == Type::Bool) return v->b;
        if (v->type == Type::Number) return v->num != 0.0;
        return fallback;
    }
    const Json* at(size_t index) const { return index < arr.size() ? &arr[index] : nullptr; }
    size_t size() const { return type == Type::Array ? arr.size() : obj.size(); }

    static Json object() { Json j; j.type = Type::Object; return j; }
    static Json array() { Json j; j.type = Type::Array; return j; }
    static Json string(const std::string& value) {
        Json j; j.type = Type::String; j.str = value; return j;
    }
    static Json number(double value) { Json j; j.type = Type::Number; j.num = value; return j; }
    static Json boolean(bool value) { Json j; j.type = Type::Bool; j.b = value; return j; }

    Json& set(const std::string& key, Json value) {
        if (type != Type::Object) { type = Type::Object; }
        if (Json* existing = find(key.c_str())) { *existing = std::move(value); return *existing; }
        obj.emplace_back(key, std::move(value));
        return obj.back().second;
    }

    bool parse(const std::string& text, std::string* error = nullptr) {
        size_t pos = 0;
        bool ok = parse_value(text, pos);
        skip(text, pos);
        if (ok && pos != text.size()) ok = false;
        if (!ok && error) *error = "JSON không hợp lệ";
        return ok;
    }

    std::string dump(int indent = 0) const {
        std::string out;
        write(out, indent);
        return out;
    }

private:
    static void skip(const std::string& s, size_t& p) {
        while (p < s.size() && (s[p] == ' ' || s[p] == '\t' || s[p] == '\n' || s[p] == '\r')) ++p;
    }
    bool parse_value(const std::string& s, size_t& p) {
        skip(s, p);
        if (p >= s.size()) return false;
        char c = s[p];
        if (c == '{') return parse_object(s, p);
        if (c == '[') return parse_array(s, p);
        if (c == '"') { type = Type::String; return parse_string(s, p, str); }
        if (c == 't' && s.compare(p, 4, "true") == 0) { type = Type::Bool; b = true; p += 4; return true; }
        if (c == 'f' && s.compare(p, 5, "false") == 0) { type = Type::Bool; b = false; p += 5; return true; }
        if (c == 'n' && s.compare(p, 4, "null") == 0) { type = Type::Null; p += 4; return true; }
        return parse_number(s, p);
    }
    bool parse_object(const std::string& s, size_t& p) {
        type = Type::Object;
        obj.clear();
        ++p;
        skip(s, p);
        if (p < s.size() && s[p] == '}') { ++p; return true; }
        while (p < s.size()) {
            std::string key;
            skip(s, p);
            if (p >= s.size() || s[p] != '"' || !parse_string(s, p, key)) return false;
            skip(s, p);
            if (p >= s.size() || s[p] != ':') return false;
            ++p;
            Json value;
            if (!value.parse_value(s, p)) return false;
            obj.emplace_back(std::move(key), std::move(value));
            skip(s, p);
            if (p < s.size() && s[p] == ',') { ++p; continue; }
            if (p < s.size() && s[p] == '}') { ++p; return true; }
            return false;
        }
        return false;
    }
    bool parse_array(const std::string& s, size_t& p) {
        type = Type::Array;
        arr.clear();
        ++p;
        skip(s, p);
        if (p < s.size() && s[p] == ']') { ++p; return true; }
        while (p < s.size()) {
            Json value;
            if (!value.parse_value(s, p)) return false;
            arr.push_back(std::move(value));
            skip(s, p);
            if (p < s.size() && s[p] == ',') { ++p; continue; }
            if (p < s.size() && s[p] == ']') { ++p; return true; }
            return false;
        }
        return false;
    }
    static void append_utf8(std::string& out, unsigned cp) {
        if (cp <= 0x7F) out.push_back(char(cp));
        else if (cp <= 0x7FF) {
            out.push_back(char(0xC0 | (cp >> 6)));
            out.push_back(char(0x80 | (cp & 0x3F)));
        } else if (cp <= 0xFFFF) {
            out.push_back(char(0xE0 | (cp >> 12)));
            out.push_back(char(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(char(0x80 | (cp & 0x3F)));
        } else {
            out.push_back(char(0xF0 | (cp >> 18)));
            out.push_back(char(0x80 | ((cp >> 12) & 0x3F)));
            out.push_back(char(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(char(0x80 | (cp & 0x3F)));
        }
    }
    static bool parse_hex4(const std::string& s, size_t& p, unsigned& value) {
        if (p + 4 > s.size()) return false;
        value = 0;
        for (int i = 0; i < 4; ++i) {
            char c = s[p++];
            value <<= 4;
            if (c >= '0' && c <= '9') value |= unsigned(c - '0');
            else if (c >= 'a' && c <= 'f') value |= unsigned(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') value |= unsigned(c - 'A' + 10);
            else return false;
        }
        return true;
    }
    bool parse_string(const std::string& s, size_t& p, std::string& out) {
        if (p >= s.size() || s[p] != '"') return false;
        ++p;
        out.clear();
        while (p < s.size()) {
            char c = s[p++];
            if (c == '"') return true;
            if (c != '\\') { out.push_back(c); continue; }
            if (p >= s.size()) return false;
            char e = s[p++];
            switch (e) {
                case '"': out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/': out.push_back('/'); break;
                case 'b': out.push_back('\b'); break;
                case 'f': out.push_back('\f'); break;
                case 'n': out.push_back('\n'); break;
                case 'r': out.push_back('\r'); break;
                case 't': out.push_back('\t'); break;
                case 'u': {
                    unsigned cp = 0;
                    if (!parse_hex4(s, p, cp)) return false;
                    if (cp >= 0xD800 && cp <= 0xDBFF && p + 6 <= s.size() &&
                        s[p] == '\\' && s[p + 1] == 'u') {
                        size_t save = p;
                        p += 2;
                        unsigned low = 0;
                        if (parse_hex4(s, p, low) && low >= 0xDC00 && low <= 0xDFFF)
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                        else
                            p = save;
                    }
                    append_utf8(out, cp);
                    break;
                }
                default: return false;
            }
        }
        return false;
    }
    bool parse_number(const std::string& s, size_t& p) {
        size_t start = p;
        if (p < s.size() && s[p] == '-') ++p;
        while (p < s.size() && s[p] >= '0' && s[p] <= '9') ++p;
        if (p < s.size() && s[p] == '.') {
            ++p;
            while (p < s.size() && s[p] >= '0' && s[p] <= '9') ++p;
        }
        if (p < s.size() && (s[p] == 'e' || s[p] == 'E')) {
            ++p;
            if (p < s.size() && (s[p] == '+' || s[p] == '-')) ++p;
            while (p < s.size() && s[p] >= '0' && s[p] <= '9') ++p;
        }
        if (p == start) return false;
        type = Type::Number;
        num = std::strtod(s.substr(start, p - start).c_str(), nullptr);
        return true;
    }
    static void write_string(std::string& out, const std::string& value) {
        out.push_back('"');
        for (unsigned char c : value) {
            switch (c) {
                case '"': out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\b': out += "\\b"; break;
                case '\f': out += "\\f"; break;
                case '\n': out += "\\n"; break;
                case '\r': out += "\\r"; break;
                case '\t': out += "\\t"; break;
                default:
                    if (c < 0x20) {
                        char buf[8];
                        std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                        out += buf;
                    } else {
                        out.push_back(char(c));
                    }
            }
        }
        out.push_back('"');
    }
    void write(std::string& out, int indent) const {
        auto pad = [&](int level) { out.append(size_t(level) * 2, ' '); };
        switch (type) {
            case Type::Null: out += "null"; break;
            case Type::Bool: out += b ? "true" : "false"; break;
            case Type::Number: {
                if (std::isfinite(num) && num == std::floor(num) && std::fabs(num) < 1e15)
                    out += std::to_string(static_cast<long long>(num));
                else {
                    char buf[64];
                    std::snprintf(buf, sizeof(buf), "%.6g", num);
                    out += buf;
                }
                break;
            }
            case Type::String: write_string(out, str); break;
            case Type::Array: {
                if (arr.empty()) { out += "[]"; break; }
                out += "[\n";
                for (size_t i = 0; i < arr.size(); ++i) {
                    pad(indent + 1);
                    arr[i].write(out, indent + 1);
                    if (i + 1 < arr.size()) out += ',';
                    out += '\n';
                }
                pad(indent);
                out += ']';
                break;
            }
            case Type::Object: {
                if (obj.empty()) { out += "{}"; break; }
                out += "{\n";
                for (size_t i = 0; i < obj.size(); ++i) {
                    pad(indent + 1);
                    write_string(out, obj[i].first);
                    out += ": ";
                    obj[i].second.write(out, indent + 1);
                    if (i + 1 < obj.size()) out += ',';
                    out += '\n';
                }
                pad(indent);
                out += '}';
                break;
            }
        }
    }
};

inline std::wstring utf8_to_wide(const std::string& text) {
    if (text.empty()) return L"";
    int need = MultiByteToWideChar(CP_UTF8, 0, text.data(), int(text.size()), nullptr, 0);
    std::wstring out(size_t(need), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), int(text.size()), out.data(), need);
    return out;
}

inline std::string wide_to_utf8(const std::wstring& text) {
    if (text.empty()) return "";
    int need = WideCharToMultiByte(CP_UTF8, 0, text.data(), int(text.size()), nullptr, 0,
                                   nullptr, nullptr);
    std::string out(size_t(need), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.data(), int(text.size()), out.data(), need, nullptr,
                        nullptr);
    return out;
}
