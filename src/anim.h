#pragma once
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

// Small time-driven animation engine. Every track targets a named channel, so
// starting an animation on a busy channel replaces it mid-flight.
struct AnimEasing {
    float x1, y1, x2, y2;
};

namespace anim_ease {
inline constexpr AnimEasing Linear{ 0.0f, 0.0f, 1.0f, 1.0f };
inline constexpr AnimEasing Spring{ 0.34f, 1.45f, 0.64f, 1.0f };
inline constexpr AnimEasing OutCubic{ 0.33f, 1.0f, 0.68f, 1.0f };
inline constexpr AnimEasing Menu{ 0.16f, 1.0f, 0.30f, 1.0f };
}  // namespace anim_ease

class AnimEngine {
public:
    using Apply = std::function<void(float)>;

    void run(const std::wstring& channel, float from, float to, uint32_t duration_ms,
             AnimEasing easing, Apply apply, uint32_t delay_ms = 0);
    void cancel(const std::wstring& channel);
    void clear();
    bool active(const std::wstring& channel) const;
    bool busy() const { return !tracks_.empty(); }

    // Advances all tracks to now_ms. Returns true while any track still runs.
    bool tick(uint64_t now_ms);

private:
    struct Track {
        std::wstring channel;
        float from = 0.0f;
        float to = 0.0f;
        uint32_t duration = 1;
        uint32_t delay = 0;
        AnimEasing easing = anim_ease::Linear;
        Apply apply;
        uint64_t start = 0;
    };
    std::vector<Track> tracks_;
};
