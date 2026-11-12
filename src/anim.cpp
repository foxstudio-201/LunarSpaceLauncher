#include "anim.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <utility>

namespace {

float bezier_axis(float t, float p1, float p2) {
    float mt = 1.0f - t;
    return 3.0f * mt * mt * t * p1 + 3.0f * mt * t * t * p2 + t * t * t;
}

float ease_value(const AnimEasing& e, float x) {
    x = std::clamp(x, 0.0f, 1.0f);
    float lo = 0.0f, hi = 1.0f, t = x;
    for (int i = 0; i < 24; ++i) {
        float cx = bezier_axis(t, e.x1, e.x2);
        if (std::fabs(cx - x) < 1e-4f) break;
        if (cx < x) lo = t;
        else hi = t;
        t = (lo + hi) * 0.5f;
    }
    return bezier_axis(t, e.y1, e.y2);
}

}  // namespace

void AnimEngine::run(const std::wstring& channel, float from, float to, uint32_t duration_ms,
                     AnimEasing easing, Apply apply, uint32_t delay_ms) {
    cancel(channel);
    if (!apply) return;
    if (duration_ms == 0 && delay_ms == 0) {
        apply(to);
        return;
    }
    Track track;
    track.channel = channel;
    track.from = from;
    track.to = to;
    track.duration = std::max<uint32_t>(1, duration_ms);
    track.delay = delay_ms;
    track.easing = easing;
    track.apply = std::move(apply);
    track.start = 0;
    tracks_.push_back(std::move(track));
}

void AnimEngine::cancel(const std::wstring& channel) {
    tracks_.erase(std::remove_if(tracks_.begin(), tracks_.end(),
                                 [&](const Track& t) { return t.channel == channel; }),
                  tracks_.end());
}

void AnimEngine::clear() { tracks_.clear(); }

bool AnimEngine::active(const std::wstring& channel) const {
    for (const auto& track : tracks_)
        if (track.channel == channel) return true;
    return false;
}

bool AnimEngine::tick(uint64_t now_ms) {
    bool running = false;
    for (size_t i = 0; i < tracks_.size();) {
        Track& track = tracks_[i];
        if (track.start == 0) track.start = now_ms;
        uint64_t elapsed = now_ms - track.start;
        if (elapsed < track.delay) {
            running = true;
            ++i;
            continue;
        }
        float t = float(elapsed - track.delay) / float(track.duration);
        if (t >= 1.0f) {
            track.apply(track.to);
            tracks_.erase(tracks_.begin() + std::ptrdiff_t(i));
            continue;
        }
        track.apply(track.from + (track.to - track.from) * ease_value(track.easing, t));
        running = true;
        ++i;
    }
    return running;
}
