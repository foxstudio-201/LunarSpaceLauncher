use crate::ui::app::{LauncherApp, Modal};
use crate::ui::pages::{modal_overlay, page_body, page_header};
use crate::ui::theme::*;
use crate::ui::widgets;
use gpui::{AnyElement, Context, Div, IntoElement, Window, div, prelude::*, px};
use serde_json::{Value, json};

fn tr(en: bool, vi: &str, english: &str) -> String {
    if en { english.to_string() } else { vi.to_string() }
}

fn target_range(component: &str) -> &'static str {
    match component {
        "java-runtime-epsilon" => "26.x",
        "java-runtime-delta" => "1.20.5 – 1.21.x",
        "java-runtime-beta" => "1.18 – 1.20.4",
        "java-runtime-gamma" => "1.18 – 1.20.4",
        "jre-legacy" => "≤ 1.16.5",
        _ => "",
    }
}

fn date_of(value: &str) -> String {
    value.chars().take(10).collect::<String>().replace('-', "/")
}

fn section_header(theme: &Theme, title: String, hint: String) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .gap_3()
        .w_full()
        .child(
            div()
                .text_size(px(10.5))
                .font_weight(semibold())
                .text_color(theme.muted)
                .child(title.to_uppercase()),
        )
        .child(div().flex_1().h(px(1.0)).bg(theme.border_soft))
        .when(!hint.is_empty(), |el| {
            el.child(
                div()
                    .text_size(px(TEXT_XS))
                    .text_color(theme.faint)
                    .child(hint),
            )
        })
}

fn card(theme: &Theme) -> Div {
    div()
        .flex()
        .flex_col()
        .w_full()
        .rounded(px(RADIUS_LG))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft)
        .overflow_hidden()
}

fn row(
    theme: &Theme,
    icon: &str,
    title: String,
    hint: String,
    first: bool,
    control: impl IntoElement,
) -> impl IntoElement {
    let theme = theme.clone();
    div()
        .flex()
        .items_center()
        .gap_3()
        .px(px(16.0))
        .py(px(12.0))
        .when(!first, |el| el.border_t_1().border_color(theme.border_soft))
        .child(
            div()
                .size(px(30.0))
                .rounded(px(8.0))
                .flex()
                .items_center()
                .justify_center()
                .bg(theme.elevated)
                .child(widgets::icon(icon, 15.0, theme.accent_soft)),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(2.0))
                .flex_1()
                .min_w(px(0.0))
                .child(
                    div()
                        .text_size(px(TEXT_SM))
                        .font_weight(semibold())
                        .text_color(theme.text)
                        .truncate()
                        .child(title),
                )
                .when(!hint.is_empty(), |el| {
                    el.child(
                        div()
                            .text_size(px(TEXT_XS))
                            .text_color(theme.faint)
                            .truncate()
                            .child(hint),
                    )
                }),
        )
        .child(
            div()
                .flex()
                .items_center()
                .justify_end()
                .gap_2()
                .flex_shrink_0()
                .child(control),
        )
}

fn badge(theme: &Theme, label: &str, color: gpui::Rgba) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .h(px(19.0))
        .px(px(6.0))
        .rounded(px(5.0))
        .bg(theme.elevated)
        .text_size(px(9.5))
        .font_weight(semibold())
        .text_color(color)
        .child(label.to_string())
}

fn mini_button(
    theme: &Theme,
    id: String,
    label: String,
    primary: bool,
    danger: bool,
    on_click: impl Fn(&gpui::ClickEvent, &mut Window, &mut gpui::App) + 'static,
) -> impl IntoElement {
    let theme = theme.clone();
    let base = div()
        .id(gpui::SharedString::from(id))
        .h(px(28.0))
        .px(px(10.0))
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(6.0))
        .text_size(px(10.5))
        .font_weight(semibold())
        .cursor_pointer()
        .on_click(on_click);
    if primary {
        base.bg(theme.accent)
            .text_color(theme.on_accent)
            .hover(|s| s.bg(theme.accent_hover))
            .child(label)
    } else if danger {
        base.text_color(theme.bad)
            .hover(|s| s.bg(theme.surface_hover))
            .child(label)
    } else {
        base.bg(theme.elevated)
            .border_1()
            .border_color(theme.border)
            .text_color(theme.muted)
            .hover(|s| s.bg(theme.surface_hover).text_color(theme.text))
            .child(label)
    }
}

fn icon_action(
    theme: &Theme,
    id: String,
    icon: &'static str,
    color: gpui::Rgba,
    on_click: impl Fn(&gpui::ClickEvent, &mut Window, &mut gpui::App) + 'static,
) -> impl IntoElement {
    let theme = theme.clone();
    div()
        .id(gpui::SharedString::from(id))
        .size(px(28.0))
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(6.0))
        .cursor_pointer()
        .hover(|s| s.bg(theme.surface_hover))
        .child(widgets::icon(icon, 14.0, color))
        .on_click(on_click)
}


fn theme_switch(
    theme: &Theme,
    is_night: bool,
    animate: bool,
    day_label: String,
    night_label: String,
    view: gpui::WeakEntity<LauncherApp>,
) -> impl IntoElement {
    use gpui::AnimationExt;
    let ease = |x: f32| {
        let t = x.clamp(0.0, 1.0);
        1.0 - (1.0 - t).powi(3)
    };
    let view_click = view;
    let target = if is_night { 138.0f32 } else { 8.0 };
    let start_left = if is_night { 8.0f32 } else { 138.0 };
    let day_sky = gpui::linear_gradient(
        180.0,
        gpui::linear_color_stop(gpui::rgb(0x5DB7FF), 0.0),
        gpui::linear_color_stop(gpui::rgb(0x9ED8FF), 1.0),
    );
    let night_sky = gpui::linear_gradient(
        180.0,
        gpui::linear_color_stop(gpui::rgb(0x141A3A), 0.0),
        gpui::linear_color_stop(gpui::rgb(0x232C5C), 1.0),
    );
    let sky: AnyElement = {
        let layer = div().absolute().inset_0().rounded_full().bg(night_sky);
        if animate {
            layer
                .with_animation(
                    gpui::SharedString::from(format!("tsw-sky-{is_night}")),
                    gpui::Animation::new(std::time::Duration::from_millis(800)).with_easing(ease),
                    move |el, t| el.opacity(if is_night { t } else { 1.0 - t }),
                )
                .into_any_element()
        } else {
            layer.opacity(if is_night { 1.0 } else { 0.0 }).into_any_element()
        }
    };
    let stars_data = [
        (30.0f32, 20.0f32, 4.0f32),
        (58.0, 56.0, 3.0),
        (86.0, 26.0, 4.0),
        (44.0, 72.0, 3.0),
        (110.0, 60.0, 2.0),
        (20.0, 46.0, 2.0),
    ];
    let mut star_layer = div().absolute().inset_0();
    for (i, (x, y, size)) in stars_data.into_iter().enumerate() {
        star_layer = star_layer.child(
            div()
                .absolute()
                .left(px(x))
                .top(px(y))
                .w(px(size))
                .h(px(size))
                .rounded_full()
                .bg(gpui::rgb(0xFFFFFF))
                .with_animation(
                    gpui::SharedString::from(format!("tsw-star-{i}")),
                    gpui::Animation::new(std::time::Duration::from_millis(2400)).repeat(),
                    |el, t| {
                        el.opacity(0.3 + 0.7 * (t * std::f32::consts::TAU).cos().abs())
                    },
                ),
        );
    }
    let stars: AnyElement = {
        let layer = star_layer;
        if animate {
            layer
                .with_animation(
                    gpui::SharedString::from(format!("tsw-stars-{is_night}")),
                    gpui::Animation::new(std::time::Duration::from_millis(600)).with_easing(ease),
                    move |el, t| {
                        let n = if is_night { t } else { 1.0 - t };
                        el.top(px(-30.0 * (1.0 - n))).opacity(n)
                    },
                )
                .into_any_element()
        } else {
            layer
                .top(px(if is_night { 0.0 } else { -30.0 }))
                .opacity(if is_night { 1.0 } else { 0.0 })
                .into_any_element()
        }
    };
    let halo_circle = |size: f32| {
        div()
            .absolute()
            .left(px(-size / 2.0))
            .top(px(-size / 2.0))
            .w(px(size))
            .h(px(size))
            .rounded_full()
            .bg(gpui::rgba(0xffffff1f))
    };
    let halo_base = || {
        div()
            .absolute()
            .left(px(47.0))
            .top(px(47.0))
            .child(halo_circle(64.0))
            .child(halo_circle(78.0))
            .child(halo_circle(92.0))
    };
    let halo: AnyElement = {
        let layer = halo_base();
        if animate {
            layer
                .with_animation(
                    gpui::SharedString::from(format!("tsw-halo-{is_night}")),
                    gpui::Animation::new(std::time::Duration::from_millis(900))
                        .with_easing(|x| crate::ui::app::spring_ease(x)),
                    move |el, t| {
                        let n = if is_night { t } else { 1.0 - t };
                        el.left(px(47.0 + 130.0 * n))
                    },
                )
                .into_any_element()
        } else {
            layer
                .left(px(if is_night { 177.0 } else { 47.0 }))
                .into_any_element()
        }
    };
    let clouds_base = || {
        div()
            .absolute()
            .inset_0()
            .child(div().absolute().right(px(10.0)).bottom(px(10.0)).w(px(92.0)).h(px(34.0)).rounded_full().bg(gpui::rgb(0xFFFFFF)))
            .child(div().absolute().right(px(52.0)).bottom(px(4.0)).w(px(64.0)).h(px(30.0)).rounded_full().bg(gpui::rgb(0xFFFFFF)))
            .child(div().absolute().right(px(6.0)).bottom(px(20.0)).w(px(56.0)).h(px(28.0)).rounded_full().bg(gpui::rgb(0xFFFFFF)))
            .child(div().absolute().right(px(34.0)).bottom(px(0.0)).w(px(74.0)).h(px(24.0)).rounded_full().bg(gpui::rgb(0xE3F1FF)))
            .child(div().absolute().right(px(94.0)).bottom(px(0.0)).w(px(44.0)).h(px(20.0)).rounded_full().bg(gpui::rgb(0xE3F1FF)))
    };
    let clouds: AnyElement = {
        let layer = clouds_base();
        if animate {
            layer
                .with_animation(
                    gpui::SharedString::from(format!("tsw-clouds-{is_night}")),
                    gpui::Animation::new(std::time::Duration::from_millis(800)).with_easing(ease),
                    move |el, t| {
                        let n = if is_night { t } else { 1.0 - t };
                        el.top(px(80.0 * n)).opacity(1.0 - n)
                    },
                )
                .into_any_element()
        } else {
            layer
                .top(px(if is_night { 80.0 } else { 0.0 }))
                .opacity(if is_night { 0.0 } else { 1.0 })
                .into_any_element()
        }
    };
    let crater = |left: f32, top: f32, size: f32| {
        div()
            .absolute()
            .left(px(left))
            .top(px(top))
            .w(px(size))
            .h(px(size))
            .rounded_full()
            .bg(gpui::rgb(0xA3AABC))
    };
    let moon_base = || {
        div()
            .absolute()
            .inset_0()
            .rounded_full()
            .bg(gpui::linear_gradient(
                140.0,
                gpui::linear_color_stop(gpui::rgb(0xF4F6FB), 0.0),
                gpui::linear_color_stop(gpui::rgb(0xA9B0C2), 1.0),
            ))
            .child(crater(20.0, 16.0, 20.0))
            .child(crater(46.0, 40.0, 14.0))
            .child(crater(24.0, 48.0, 9.0))
    };
    let moon: AnyElement = {
        let layer = moon_base();
        if animate {
            layer
                .with_animation(
                    gpui::SharedString::from(format!("tsw-moon-{is_night}")),
                    gpui::Animation::new(std::time::Duration::from_millis(800)).with_easing(ease),
                    move |el, t| {
                        let left = if is_night { 78.0 * (1.0 - t) } else { 78.0 * t };
                        let opacity = if is_night { t } else { 1.0 - t };
                        el.left(px(left)).opacity(opacity)
                    },
                )
                .into_any_element()
        } else {
            layer
                .left(px(if is_night { 0.0 } else { 78.0 }))
                .opacity(if is_night { 1.0 } else { 0.0 })
                .into_any_element()
        }
    };
    let sun_base = || {
        div()
            .absolute()
            .w(px(78.0))
            .h(px(78.0))
            .rounded_full()
            .overflow_hidden()
            .bg(gpui::linear_gradient(
                140.0,
                gpui::linear_color_stop(gpui::rgb(0xFFF1A8), 0.0),
                gpui::linear_color_stop(gpui::rgb(0xF8A91E), 1.0),
            ))
            .child(
                div()
                    .absolute()
                    .left(px(8.0))
                    .top(px(6.0))
                    .w(px(34.0))
                    .h(px(34.0))
                    .rounded_full()
                    .bg(gpui::rgba(0xffffff88)),
            )
    };
    let knob: AnyElement = {
        let layer = sun_base().child(moon);
        if animate {
            layer
                .with_animation(
                    gpui::SharedString::from(format!("tsw-knob-{is_night}")),
                    gpui::Animation::new(std::time::Duration::from_millis(900))
                        .with_easing(|x| crate::ui::app::spring_ease(x)),
                    move |el, t| el.left(px(start_left + (target - start_left) * t)).top(px(8.0)),
                )
                .into_any_element()
        } else {
            layer.left(px(target)).top(px(8.0)).into_any_element()
        }
    };
    let label_base = |text: String| {
        div()
            .absolute()
            .left(px(0.0))
            .right(px(0.0))
            .text_center()
            .child(text)
    };
    let day_target_top = if is_night { -24.0f32 } else { 0.0 };
    let day_start_top = if is_night { 0.0 } else { -24.0 };
    let day_target_op = if is_night { 0.0f32 } else { 1.0 };
    let day_start_op = 1.0 - day_target_op;
    let night_target_top = if is_night { 0.0f32 } else { 24.0 };
    let night_start_top = if is_night { 24.0 } else { 0.0 };
    let night_target_op = 1.0 - day_target_op;
    let night_start_op = day_target_op;
    let day_el: AnyElement = {
        let base = label_base(day_label)
            .top(px(day_start_top))
            .opacity(day_start_op);
        if animate {
            base.with_animation(
                gpui::SharedString::from(format!("tsw-lab-day-{is_night}")),
                gpui::Animation::new(std::time::Duration::from_millis(550))
                    .with_easing(|x| crate::ui::app::spring_ease(x)),
                move |el, t| {
                    el.top(px(day_start_top + (day_target_top - day_start_top) * t))
                        .opacity(day_start_op + (day_target_op - day_start_op) * t)
                },
            )
            .into_any_element()
        } else {
            base.top(px(day_target_top))
                .opacity(day_target_op)
                .into_any_element()
        }
    };
    let night_el: AnyElement = {
        let base = label_base(night_label)
            .top(px(night_start_top))
            .opacity(night_start_op);
        if animate {
            base.with_animation(
                gpui::SharedString::from(format!("tsw-lab-night-{is_night}")),
                gpui::Animation::new(std::time::Duration::from_millis(550))
                    .with_easing(|x| crate::ui::app::spring_ease(x)),
                move |el, t| {
                    el.top(px(night_start_top + (night_target_top - night_start_top) * t))
                        .opacity(night_start_op + (night_target_op - night_start_op) * t)
                },
            )
            .into_any_element()
        } else {
            base.top(px(night_target_top))
                .opacity(night_target_op)
                .into_any_element()
        }
    };
    let label_layers: AnyElement = div()
        .relative()
        .w(px(200.0))
        .h(px(24.0))
        .overflow_hidden()
        .text_size(px(16.0))
        .font_weight(gpui::FontWeight::BOLD)
        .text_color(theme.text)
        .child(day_el)
        .child(night_el)
        .into_any_element();
    div()
        .flex()
        .flex_col()
        .items_center()
        .gap(px(20.0))
        .child(
            div()
                .id("theme-switch")
                .relative()
                .w(px(224.0))
                .h(px(94.0))
                .rounded_full()
                .overflow_hidden()
                .bg(day_sky)
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let next = if is_night { "light" } else { "dark" };
                    let _ = view_click.update(cx, |this, cx| {
                        this.theme_switch_at = Some(std::time::Instant::now());
                        this.backend.settings_set(json!({ "theme": next }));
                        this.refresh_settings();
                        cx.notify();
                    });
                })
                .child(sky)
                .child(stars)
                .child(halo)
                .child(clouds)
                .child(knob),
        )
        .child(label_layers)
}

fn setting_chip(
    theme: &Theme,
    value: &str,
    label: &str,
    current: &str,
    view: gpui::WeakEntity<LauncherApp>,
    key: &'static str,
) -> impl IntoElement {
    let active = current == value;
    let value = value.to_string();
    div()
        .id(gpui::SharedString::from(format!("chip-{key}-{value}")))
        .h(px(28.0))
        .px(px(11.0))
        .flex()
        .items_center()
        .rounded(px(6.0))
        .bg(if active { theme.accent_dim } else { theme.elevated })
        .border_1()
        .border_color(if active { theme.accent } else { theme.border_soft })
        .text_size(px(TEXT_SM))
        .font_weight(if active { semibold() } else { medium() })
        .text_color(if active { theme.accent_soft } else { theme.muted })
        .cursor_pointer()
        .on_click(move |_, _, cx| {
            let value = value.clone();
            let _ = view.update(cx, |this, cx| {
                this.backend.settings_set(json!({ key: value }));
                this.refresh_settings();
                if key == "language" {
                    this.load_discord(cx);
                }
                cx.notify();
            });
        })
        .child(label.to_string())
}

fn zulu_chip(
    theme: &Theme,
    label: &str,
    active: bool,
    view: gpui::WeakEntity<LauncherApp>,
    major: Option<&str>,
    kind: Option<&str>,
) -> impl IntoElement {
    let id = match (major, kind) {
        (Some(value), _) => format!("zulu-major-{value}"),
        (_, Some(value)) => format!("zulu-kind-{value}"),
        _ => "zulu-chip".to_string(),
    };
    let major = major.map(str::to_string);
    let kind = kind.map(str::to_string);
    div()
        .id(gpui::SharedString::from(id))
        .h(px(28.0))
        .px(px(11.0))
        .flex()
        .items_center()
        .rounded(px(6.0))
        .bg(if active { theme.accent_dim } else { theme.elevated })
        .border_1()
        .border_color(if active { theme.accent } else { theme.border_soft })
        .text_size(px(TEXT_SM))
        .font_weight(if active { semibold() } else { medium() })
        .text_color(if active { theme.accent_soft } else { theme.muted })
        .cursor_pointer()
        .on_click(move |_, _, cx| {
            let _ = view.update(cx, |this, cx| {
                if let Some(value) = major.clone() {
                    this.settings_ui.zulu_major = value;
                }
                if let Some(value) = kind.clone() {
                    this.settings_ui.zulu_kind = value;
                }
                cx.notify();
            });
        })
        .child(label.to_string())
}

fn toggle(
    theme: &Theme,
    id: &'static str,
    on: bool,
    on_click: impl Fn(&gpui::ClickEvent, &mut Window, &mut gpui::App) + 'static,
) -> impl IntoElement {
    let theme = theme.clone();
    div()
        .id(gpui::SharedString::from(format!("toggle-{id}")))
        .w(px(42.0))
        .h(px(24.0))
        .rounded_full()
        .bg(if on { theme.accent } else { theme.surface_active })
        .p(px(3.0))
        .flex()
        .items_center()
        .when(on, |el| el.justify_end())
        .cursor_pointer()
        .on_click(on_click)
        .child(div().size(px(18.0)).rounded_full().bg(gpui::rgb(0xFFFFFF)))
}

fn meter(
    theme: &Theme,
    label: String,
    value: String,
    hint: String,
    percent: f32,
    color: gpui::Rgba,
) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap_2()
        .child(
            div()
                .flex()
                .justify_between()
                .text_size(px(10.0))
                .font_weight(semibold())
                .text_color(theme.faint)
                .child(label.to_uppercase())
                .child(hint),
        )
        .child(
            div()
                .text_size(px(15.0))
                .font_weight(bold())
                .text_color(theme.text)
                .child(value),
        )
        .child(
            div()
                .h(px(5.0))
                .w_full()
                .rounded_full()
                .bg(theme.surface_active)
                .truncate()
                .child(
                    div()
                        .h_full()
                        .w(gpui::relative((percent / 100.0).clamp(0.0, 1.0)))
                        .rounded_full()
                        .bg(color),
                ),
        )
}

fn fact(theme: &Theme, label: String, value: String) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .justify_between()
        .gap_4()
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.faint)
                .child(label),
        )
        .child(
            div()
                .text_size(px(11.0))
                .font_family(MONO)
                .text_color(theme.muted)
                .child(value),
        )
}

fn status_text(en: bool, ui: &crate::ui::app::SettingsUi) -> String {
    match ui.update_phase.as_str() {
        "checking" => tr(en, "Đang kiểm tra bản mới…", "Checking for updates…"),
        "available" => tr(
            en,
            &format!("Có bản mới v{} — bấm “Tải bản mới”.", ui.update_latest),
            &format!("v{} available — press “Download”.", ui.update_latest),
        ),
        "current" => tr(en, "Bạn đang dùng bản mới nhất.", "You are on the latest version."),
        "error" => {
            if ui.update_error.is_empty() {
                tr(en, "Kiểm tra cập nhật thất bại.", "Update check failed.")
            } else {
                ui.update_error.clone()
            }
        }
        _ => tr(en, "Chưa kiểm tra.", "Not checked yet."),
    }
}

pub fn render(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let lang = app
        .settings
        .get("language")
        .and_then(Value::as_str)
        .unwrap_or("vi")
        .to_string();
    let en = lang == "en";
    let theme_key = app
        .settings
        .get("theme")
        .and_then(Value::as_str)
        .unwrap_or("dark")
        .to_string();
    let hide_on_launch = app
        .settings
        .get("hideOnLaunch")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let auto_update = app
        .settings
        .get("autoUpdate")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let discord_rpc = app
        .settings
        .get("discordRpc")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let java_path = app
        .settings
        .get("javaPath")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let shared = app.backend.store.shared_dir().to_string_lossy().into_owned();
    let default_instances = app.backend.store.default_instance_dir().to_string_lossy().into_owned();
    let default_memory = app
        .settings
        .get("defaultMemory")
        .and_then(Value::as_u64)
        .unwrap_or(4096);

    let runtimes = app.settings_ui.runtimes.clone();
    let external = app.settings_ui.java_external.clone();
    let selected_java = app
        .settings_ui
        .java_selected
        .clone()
        .unwrap_or_else(|| java_path.clone());
    let installed_runtimes: Vec<&Value> = runtimes
        .iter()
        .filter(|runtime| runtime.get("installed").and_then(Value::as_bool).unwrap_or(false))
        .collect();
    let managed_installed: Vec<&Value> = installed_runtimes
        .iter()
        .filter(|runtime| runtime.get("kind").and_then(Value::as_str) != Some("zulu"))
        .copied()
        .collect();
    let managed_bytes: u64 = managed_installed
        .iter()
        .filter_map(|runtime| runtime.get("bytes").and_then(Value::as_u64))
        .sum();
    let managed: Vec<Value> = runtimes
        .iter()
        .filter(|runtime| runtime.get("kind").and_then(Value::as_str) != Some("zulu"))
        .cloned()
        .collect();
    let zulu_list: Vec<Value> = runtimes
        .iter()
        .filter(|runtime| runtime.get("kind").and_then(Value::as_str) == Some("zulu"))
        .cloned()
        .collect();

    let discord = app.settings_ui.discord.clone();
    let discord_connected = discord
        .get("connected")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let discord_invite = discord
        .get("invite")
        .and_then(Value::as_str)
        .unwrap_or(crate::discord::DEFAULT_INVITE)
        .to_string();
    let discord_activity = discord
        .get("activity")
        .filter(|value| !value.is_null())
        .map(|activity| {
            let details = activity.get("details").and_then(Value::as_str).unwrap_or("");
            let state = activity.get("state").and_then(Value::as_str).unwrap_or("");
            [details, state]
                .iter()
                .filter(|part| !part.is_empty())
                .copied()
                .collect::<Vec<_>>()
                .join(" · ")
        })
        .unwrap_or_default();

    let view = cx.entity().downgrade();
    let view_hide = view.clone();
    let view_rpc = view.clone();
    let view_auto = view.clone();
    let view_refresh = view.clone();
    let view_sync = view.clone();
    let view_save = view.clone();
    let view_check = view.clone();
    let view_whats_new = view.clone();

    let lang_row = div()
        .flex()
        .items_center()
        .gap_1()
        .child(setting_chip(&theme, "vi", "Tiếng Việt", &lang, view.clone(), "language"))
        .child(setting_chip(&theme, "en", "English", &lang, view.clone(), "language"));

    let animate_theme = app
        .theme_switch_at
        .map(|at| at.elapsed() < std::time::Duration::from_millis(1500))
        .unwrap_or(false);
    let theme_row = theme_switch(
        &theme,
        theme_key == "dark",
        animate_theme,
        tr(en, "Ban ngày", "Clear day").to_string(),
        tr(en, "Ban đêm", "Quiet night").to_string(),
        view.clone(),
    );

    let page = page_body()
        .max_w(px(860.0))
        .child(page_header(
            &theme,
            tr(en, "Hệ thống", "System"),
            tr(en, "Cấu hình launcher và thông tin máy", "Launcher configuration and machine info"),
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(widgets::ghost_button("settings-test-sync", tr(en, "Thử đồng bộ", "Test sync"), &theme, move |_, _, cx| {
                    let _ = view_sync.update(cx, |this, cx| {
                        this.sync_open = true;
                        this.sync_done = false;
                        this.sync_running = false;
                        this.sync_error.clear();
                        this.sync_files = 0;
                        this.sync_total = 0;
                        this.sync_bytes = 0;
                        this.sync_bytes_total = 0;
                        cx.notify();
                    });
                }))
                .child(widgets::ghost_button("settings-refresh", tr(en, "Quét lại Java", "Refresh Java"), &theme, move |_, _, cx| {
                    let _ = view_refresh.update(cx, |this, cx| this.load_java(cx));
                }))
                .child(
                    div()
                        .id("settings-save")
                        .h(px(36.0))
                        .px(px(16.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .gap_2()
                        .rounded(px(RADIUS_SM))
                        .bg(if app.settings_ui.saved { theme.ok } else { theme.accent })
                        .text_size(px(TEXT_BASE))
                        .font_weight(semibold())
                        .text_color(if app.settings_ui.saved { gpui::rgb(0xFFFFFF) } else { theme.on_accent })
                        .cursor_pointer()
                        .hover(|s| s.opacity(0.92))
                        .on_click(move |_, _, cx| {
                            let _ = view_save.update(cx, |this, cx| this.save_settings(cx));
                        })
                        .child(widgets::icon(
                            if app.settings_ui.saved { "check-circle" } else { "floppy-disk" },
                            14.0,
                            if app.settings_ui.saved { gpui::rgb(0xFFFFFF) } else { theme.on_accent },
                        ))
                        .child(tr(en, if app.settings_ui.saved { "Đã lưu" } else { "Lưu" }, if app.settings_ui.saved { "Saved" } else { "Save" })),
                ),
        ))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(18.0))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(section_header(&theme, tr(en, "Giao diện", "Appearance"), tr(en, "áp dụng ngay", "applies instantly")))
                        .child(
                            card(&theme)
                                .child(row(
                                    &theme,
                                    "globe",
                                    tr(en, "Ngôn ngữ", "Language"),
                                    tr(en, "Chữ trong launcher", "Launcher text"),
                                    true,
                                    lang_row,
                                ))
                                .child(row(
                                    &theme,
                                    if theme_key == "light" { "sun" } else { "moon" },
                                    tr(en, "Giao diện", "Theme"),
                                    tr(en, "Tối hoặc sáng", "Dark or light"),
                                    false,
                                    theme_row,
                                )),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(section_header(
                            &theme,
                            tr(en, "Trò chơi", "Game"),
                            if hide_on_launch { tr(en, "đang bật", "on") } else { tr(en, "đang tắt", "off") },
                        ))
                        .child(
                            card(&theme)
                                .child(row(
                                    &theme,
                                    "game-controller",
                                    tr(en, "Tự động ẩn launcher khi chơi game", "Hide launcher while playing"),
                                    tr(
                                        en,
                                        "Launcher tự ẩn khi game bắt đầu chạy và tự hiện lại khi game đóng.",
                                        "The launcher hides when the game starts and returns when it closes.",
                                    ),
                                    true,
                                    toggle(&theme, "hide", hide_on_launch, move |_, _, cx| {
                                        let _ = view_hide.update(cx, |this, cx| {
                                            let next = !this
                                                .settings
                                                .get("hideOnLaunch")
                                                .and_then(Value::as_bool)
                                                .unwrap_or(true);
                                            this.backend.settings_set(json!({"hideOnLaunch": next}));
                                            this.refresh_settings();
                                            cx.notify();
                                        });
                                    }),
                                ))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_3()
                                        .px(px(16.0))
                                        .py(px(12.0))
                                        .border_t_1()
                                        .border_color(theme.border_soft)
                                        .child(
                                            div()
                                                .size(px(30.0))
                                                .rounded(px(8.0))
                                                .flex()
                                                .items_center()
                                                .justify_center()
                                                .bg(theme.elevated)
                                                .child(widgets::icon("memory", 15.0, theme.accent_soft)),
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .gap(px(2.0))
                                                .flex_1()
                                                .min_w(px(0.0))
                                                .child(
                                                    div()
                                                        .text_size(px(TEXT_SM))
                                                        .font_weight(semibold())
                                                        .text_color(theme.text)
                                                        .child(tr(en, "RAM mặc định", "Default RAM")),
                                                )
                                                .child(
                                                    div()
                                                        .text_size(px(TEXT_XS))
                                                        .text_color(theme.faint)
                                                        .child(tr(en, "Áp dụng cho phiên bản tạo mới.", "Applied to newly created instances.")),
                                                ),
                                        )
                                        .child(
                                            div()
                                                .w(px(110.0))
                                                .child(widgets::text_input_box(&theme).child(app.settings_memory_input.clone())),
                                        )
                                        .child(
                                            div()
                                                .text_size(px(TEXT_XS))
                                                .text_color(theme.faint)
                                                .child(format!("{default_memory} MB")),
                                        ),
                                ),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(section_header(
                            &theme,
                            "Discord".into(),
                            if !discord_rpc {
                                tr(en, "đang tắt", "disabled")
                            } else if discord_connected {
                                tr(en, "đã kết nối", "connected")
                            } else {
                                tr(en, "chờ Discord", "waiting for Discord")
                            },
                        ))
                        .child(
                            card(&theme)
                                .child(row(
                                    &theme,
                                    "discord-logo",
                                    "Rich Presence".into(),
                                    if !discord_rpc {
                                        tr(en, "Đang tắt — bật để hiện hoạt động cho bạn bè.", "Off — enable to show your activity to friends.")
                                    } else if discord_connected {
                                        tr(en, "Bạn bè thấy hoạt động của bạn trên Discord.", "Friends can see your activity on Discord.")
                                    } else {
                                        tr(en, "Chưa mở Discord — launcher sẽ tự kết nối khi Discord chạy.", "Discord is closed — the launcher connects automatically once it runs.")
                                    },
                                    true,
                                    toggle(&theme, "rpc", discord_rpc, move |_, _, cx| {
                                        let _ = view_rpc.update(cx, |this, cx| {
                                            let next = !this
                                                .settings
                                                .get("discordRpc")
                                                .and_then(Value::as_bool)
                                                .unwrap_or(true);
                                            this.backend.settings_set(json!({"discordRpc": next}));
                                            this.refresh_settings();
                                            this.load_discord(cx);
                                            cx.notify();
                                        });
                                    }),
                                ))
                                .child(row(
                                    &theme,
                                    "discord-logo",
                                    tr(en, "Cộng đồng XyoLauncher", "XyoLauncher community"),
                                    discord_invite.clone(),
                                    false,
                                    if discord_invite.starts_with("http") {
                                        let invite = discord_invite.clone();
                                        mini_button(
                                            &theme,
                                            "discord-invite".into(),
                                            tr(en, "Tham gia Discord", "Join Discord"),
                                            true,
                                            false,
                                            move |_, _, _cx| {
                                                let _ = open::that(&invite);
                                            },
                                        )
                                        .into_any_element()
                                    } else {
                                        div().into_any_element()
                                    },
                                ))
                                .child(row(
                                    &theme,
                                    "discord-logo",
                                    tr(en, "Đang hiển thị", "Currently showing"),
                                    tr(
                                        en,
                                        "Tên phiên bản, Minecraft + trình tải, thời gian đã chơi",
                                        "Instance name, Minecraft + loader, elapsed play time",
                                    ),
                                    false,
                                    div()
                                        .max_w(px(240.0))
                                        .text_size(px(10.5))
                                        .font_family(MONO)
                                        .text_color(theme.muted)
                                        .truncate()
                                        .child(if discord_rpc && !discord_activity.is_empty() {
                                            discord_activity.clone()
                                        } else {
                                            tr(en, "chưa có hoạt động", "no activity yet")
                                        })
                                        .into_any_element(),
                                )),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(section_header(
                            &theme,
                            "Java".into(),
                            if managed_installed.is_empty() {
                                tr(en, "chưa tải bản nào", "none installed")
                            } else {
                                format!(
                                    "{} {} · {}",
                                    managed_installed.len(),
                                    tr(en, "bản", "runtimes"),
                                    crate::util::format_bytes(managed_bytes)
                                )
                            },
                        ))
                        .child({
                            let mut list = card(&theme);
                            if managed.is_empty() {
                                list = list.child(
                                    div()
                                        .px(px(16.0))
                                        .py(px(18.0))
                                        .text_size(px(TEXT_SM))
                                        .text_color(theme.muted)
                                        .child(tr(en, "Đang quét Java trên máy…", "Scanning Java runtimes…")),
                                );
                            }
                            for (index, runtime) in managed.iter().enumerate() {
                                let component = runtime
                                    .get("component")
                                    .and_then(Value::as_str)
                                    .unwrap_or("")
                                    .to_string();
                                let name = runtime
                                    .get("name")
                                    .and_then(Value::as_str)
                                    .unwrap_or("Java")
                                    .to_string();
                                let major = runtime.get("major").and_then(Value::as_u64).unwrap_or(0);
                                let installed = runtime
                                    .get("installed")
                                    .and_then(Value::as_bool)
                                    .unwrap_or(false);
                                let bytes = runtime.get("bytes").and_then(Value::as_u64).unwrap_or(0);
                                let installed_at = runtime
                                    .get("installedAt")
                                    .and_then(Value::as_str)
                                    .unwrap_or("")
                                    .to_string();
                                let dir = runtime
                                    .get("dir")
                                    .and_then(Value::as_str)
                                    .unwrap_or("")
                                    .to_string();
                                let busy = app.settings_ui.busy == component;
                                let confirming = app.settings_ui.confirming.as_deref() == Some(component.as_str());
                                let range = target_range(&component);
                                let meta = if installed && !installed_at.is_empty() {
                                    format!(
                                        "{} · {} · {}",
                                        crate::util::format_bytes(bytes),
                                        date_of(&installed_at),
                                        component
                                    )
                                } else if installed {
                                    format!("{} · {}", crate::util::format_bytes(bytes), component)
                                } else if !range.is_empty() {
                                    format!("{component} · {range}")
                                } else {
                                    component.clone()
                                };
                                let first = index == 0;
                                let status = if busy {
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_1()
                                        .child(widgets::spinner(12.0, theme.accent))
                                        .child(
                                            div()
                                                .text_size(px(10.0))
                                                .text_color(theme.accent)
                                                .child(tr(en, "đang tải…", "downloading…")),
                                        )
                                        .into_any_element()
                                } else if installed {
                                    div()
                                        .text_size(px(10.0))
                                        .font_weight(semibold())
                                        .text_color(theme.ok)
                                        .child(tr(en, "đã có", "installed"))
                                        .into_any_element()
                                } else {
                                    div()
                                        .text_size(px(10.0))
                                        .text_color(theme.faint)
                                        .child(tr(en, "chưa tải", "not installed"))
                                        .into_any_element()
                                };
                                let actions = if confirming {
                                    let view_cancel = view.clone();
                                    let view_delete = view.clone();
                                    let component_delete = component.clone();
                                    let dir_delete = dir.clone();
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_1()
                                        .child(mini_button(&theme, format!("java-cancel-{component}"), tr(en, "Huỷ", "Cancel"), false, false, move |_, _, cx| {
                                            let _ = view_cancel.update(cx, |this, cx| {
                                                this.settings_ui.confirming = None;
                                                cx.notify();
                                            });
                                        }))
                                        .child(mini_button(&theme, format!("java-delete-{component}"), tr(en, "Xoá", "Delete"), false, true, move |_, _, cx| {
                                            let component = component_delete.clone();
                                            let dir = dir_delete.clone();
                                            let _ = view_delete.update(cx, |this, cx| {
                                                this.settings_ui.confirming = None;
                                                this.settings_ui.busy = component.clone();
                                                this.settings_ui.message.clear();
                                                let rx = this.backend.remove_runtime(component.clone(), String::new(), dir);
                                                this.on_result(cx, rx, |this, value, cx| {
                                                    this.settings_ui.busy.clear();
                                                    if !value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                        this.settings_ui.message = value
                                                            .get("error")
                                                            .and_then(Value::as_str)
                                                            .unwrap_or("Xoá Java thất bại")
                                                            .to_string();
                                                    }
                                                    this.load_java(cx);
                                                });
                                            });
                                        }))
                                        .into_any_element()
                                } else if installed {
                                    let view_confirm = view.clone();
                                    let component_confirm = component.clone();
                                    icon_action(&theme, format!("java-remove-{component}"), "trash", theme.bad, move |_, _, cx| {
                                        let component = component_confirm.clone();
                                        let _ = view_confirm.update(cx, |this, cx| {
                                            this.settings_ui.confirming = Some(component);
                                            cx.notify();
                                        });
                                    })
                                    .into_any_element()
                                } else {
                                    let view_install = view.clone();
                                    let component_install = component.clone();
                                    mini_button(&theme, format!("java-install-{component}"), tr(en, "Tải", "Get"), true, false, move |_, _, cx| {
                                        let component = component_install.clone();
                                        let _ = view_install.update(cx, |this, cx| {
                                            this.settings_ui.busy = component.clone();
                                            this.settings_ui.message.clear();
                                            let rx = this.backend.install_runtime(component.clone());
                                            this.on_result(cx, rx, |this, value, cx| {
                                                this.settings_ui.busy.clear();
                                                if !value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                    this.settings_ui.message = value
                                                        .get("error")
                                                        .and_then(Value::as_str)
                                                        .unwrap_or("Tải Java thất bại")
                                                        .to_string();
                                                }
                                                this.load_java(cx);
                                            });
                                        });
                                    })
                                    .into_any_element()
                                };
                                list = list.child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_3()
                                        .px(px(16.0))
                                        .h(px(52.0))
                                        .when(!first, |el| el.border_t_1().border_color(theme.border_soft))
                                        .child(widgets::icon("coffee", 15.0, if installed { theme.ok } else { theme.faint }))
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .gap(px(2.0))
                                                .flex_1()
                                                .min_w(px(0.0))
                                                .child(
                                                    div()
                                                        .flex()
                                                        .items_center()
                                                        .gap_2()
                                                        .min_w(px(0.0))
                                                        .child(
                                                            div()
                                                                .text_size(px(11.5))
                                                                .font_weight(semibold())
                                                                .text_color(theme.text)
                                                                .truncate()
                                                                .child(format!("Java {major}")),
                                                        )
                                                        .child(
                                                            div()
                                                                .text_size(px(10.0))
                                                                .font_family(MONO)
                                                                .text_color(theme.faint)
                                                                .truncate()
                                                                .child(name),
                                                        )
                                                        .when(!range.is_empty(), |el| {
                                                            el.child(badge(&theme, range, theme.muted))
                                                        }),
                                                )
                                                .child(
                                                    div()
                                                        .text_size(px(10.0))
                                                        .font_family(MONO)
                                                        .text_color(theme.faint)
                                                        .truncate()
                                                        .child(meta),
                                                ),
                                        )
                                        .child(status)
                                        .child(actions),
                                );
                            }
                            list
                        })
                        .child(
                            card(&theme)
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .gap_3()
                                        .p(px(16.0))
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap_3()
                                                .child(
                                                    div()
                                                        .size(px(30.0))
                                                        .rounded(px(8.0))
                                                        .flex()
                                                        .items_center()
                                                        .justify_center()
                                                        .bg(theme.elevated)
                                                        .child(widgets::icon("coffee", 15.0, theme.accent_soft)),
                                                )
                                                .child(
                                                    div()
                                                        .flex()
                                                        .flex_col()
                                                        .gap(px(2.0))
                                                        .flex_1()
                                                        .child(
                                                            div()
                                                                .text_size(px(TEXT_SM))
                                                                .font_weight(semibold())
                                                                .text_color(theme.text)
                                                                .child(tr(en, "Tải Java từ Azul Zulu", "Download Java from Azul Zulu")),
                                                        )
                                                        .child(
                                                            div()
                                                                .text_size(px(TEXT_XS))
                                                                .text_color(theme.faint)
                                                                .child(tr(
                                                                    en,
                                                                    "Chọn phiên bản rồi tải thẳng vào thư mục runtime của launcher.",
                                                                    "Pick a version and download it into the launcher runtime folder.",
                                                                )),
                                                        ),
                                                ),
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap_1()
                                                .child(
                                                    div()
                                                        .text_size(px(10.0))
                                                        .text_color(theme.faint)
                                                        .w(px(38.0))
                                                        .child("Java"),
                                                )
                                                .children(["8", "11", "17", "21", "25"].map(|value| {
                                                    zulu_chip(
                                                        &theme,
                                                        value,
                                                        app.settings_ui.zulu_major == value,
                                                        view.clone(),
                                                        Some(value),
                                                        None,
                                                    )
                                                })),
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap_2()
                                                .child(
                                                    div()
                                                        .flex()
                                                        .items_center()
                                                        .gap_1()
                                                        .child(zulu_chip(&theme, "JRE", app.settings_ui.zulu_kind == "jre", view.clone(), None, Some("jre")))
                                                        .child(zulu_chip(&theme, "JDK", app.settings_ui.zulu_kind == "jdk", view.clone(), None, Some("jdk"))),
                                                )
                                                .child({
                                                    let view_zulu = view.clone();
                                                    let major = app.settings_ui.zulu_major.parse::<u32>().unwrap_or(21);
                                                    let kind = app.settings_ui.zulu_kind.clone();
                                                    let busy = app.settings_ui.zulu_busy;
                                                    if busy {
                                                        div()
                                                            .h(px(32.0))
                                                            .px(px(12.0))
                                                            .flex()
                                                            .items_center()
                                                            .gap_2()
                                                            .rounded(px(RADIUS_SM))
                                                            .bg(theme.elevated)
                                                            .text_size(px(TEXT_SM))
                                                            .text_color(theme.accent)
                                                            .child(widgets::spinner(12.0, theme.accent))
                                                            .child(tr(en, "đang tải…", "downloading…"))
                                                            .into_any_element()
                                                    } else {
                                                        widgets::button(
                                                            "zulu-install",
                                                            tr(en, "Tải", "Download"),
                                                            &theme,
                                                            true,
                                                            move |_, _, cx| {
                                                                let kind = kind.clone();
                                                                let _ = view_zulu.update(cx, |this, cx| {
                                                                    this.settings_ui.zulu_busy = true;
                                                                    this.settings_ui.message.clear();
                                                                    let rx = this.backend.install_zulu(major, kind);
                                                                    this.on_result(cx, rx, |this, value, cx| {
                                                                        this.settings_ui.zulu_busy = false;
                                                                        if !value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                                            this.settings_ui.message = value
                                                                                .get("error")
                                                                                .and_then(Value::as_str)
                                                                                .unwrap_or("Tải Zulu thất bại")
                                                                                .to_string();
                                                                        }
                                                                        this.load_java(cx);
                                                                    });
                                                                });
                                                            },
                                                        )
                                                        .into_any_element()
                                                    }
                                                }),
                                        )
                                        .when(!app.settings_ui.message.is_empty(), |el| {
                                            el.child(
                                                div()
                                                    .text_size(px(TEXT_SM))
                                                    .text_color(theme.muted)
                                                    .child(app.settings_ui.message.clone()),
                                            )
                                        })
                                        .children(zulu_list.iter().map(|runtime| {
                                            let dir = runtime.get("dir").and_then(Value::as_str).unwrap_or("").to_string();
                                            let java = runtime.get("javaPath").and_then(Value::as_str).unwrap_or("").to_string();
                                            let name = runtime.get("name").and_then(Value::as_str).unwrap_or("Zulu").to_string();
                                            let bytes = runtime.get("bytes").and_then(Value::as_u64).unwrap_or(0);
                                            let installed_at = runtime.get("installedAt").and_then(Value::as_str).unwrap_or("");
                                            let in_use = selected_java == java;
                                            let confirming = app.settings_ui.zulu_confirm.as_deref() == Some(dir.as_str());
                                            let view_use = view.clone();
                                            let view_confirm = view.clone();
                                            let view_cancel = view.clone();
                                            let view_remove = view.clone();
                                            let dir_remove = dir.clone();
                                            let java_use = java.clone();
                                            let mut actions = div().flex().items_center().gap_1();
                                            if in_use {
                                                actions = actions.child(
                                                    div()
                                                        .text_size(px(10.0))
                                                        .font_weight(semibold())
                                                        .text_color(theme.accent)
                                                        .child(tr(en, "đang dùng", "in use")),
                                                );
                                            } else {
                                                actions = actions.child(mini_button(
                                                    &theme,
                                                    format!("zulu-use-{dir}"),
                                                    tr(en, "Dùng", "Use"),
                                                    false,
                                                    false,
                                                    move |_, _, cx| {
                                                        let path = java_use.clone();
                                                        let _ = view_use.update(cx, |this, cx| this.use_java(path, cx));
                                                    },
                                                ));
                                            }
                                            if confirming {
                                                actions = actions
                                                    .child(mini_button(&theme, format!("zulu-cancel-{dir}"), tr(en, "Huỷ", "Cancel"), false, false, move |_, _, cx| {
                                                        let _ = view_cancel.update(cx, |this, cx| {
                                                            this.settings_ui.zulu_confirm = None;
                                                            cx.notify();
                                                        });
                                                    }))
                                                    .child(mini_button(&theme, format!("zulu-delete-{dir}"), tr(en, "Xoá", "Delete"), false, true, move |_, _, cx| {
                                                        let dir = dir_remove.clone();
                                                        let _ = view_remove.update(cx, |this, cx| {
                                                            this.settings_ui.zulu_confirm = None;
                                                            this.settings_ui.zulu_busy = true;
                                                            let rx = this.backend.remove_runtime(String::new(), "zulu".into(), dir);
                                                            this.on_result(cx, rx, |this, value, cx| {
                                                                this.settings_ui.zulu_busy = false;
                                                                if !value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                                    this.settings_ui.message = value
                                                                        .get("error")
                                                                        .and_then(Value::as_str)
                                                                        .unwrap_or("Xoá Zulu thất bại")
                                                                        .to_string();
                                                                }
                                                                this.load_java(cx);
                                                            });
                                                        });
                                                    }));
                                            } else {
                                                let dir_confirm = dir.clone();
                                                actions = actions.child(icon_action(&theme, format!("zulu-remove-{dir}"), "trash", theme.bad, move |_, _, cx| {
                                                    let dir = dir_confirm.clone();
                                                    let _ = view_confirm.update(cx, |this, cx| {
                                                        this.settings_ui.zulu_confirm = Some(dir);
                                                        cx.notify();
                                                    });
                                                }));
                                            }
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap_3()
                                                .pt(px(10.0))
                                                .border_t_1()
                                                .border_color(theme.border_soft)
                                                .child(widgets::icon("coffee", 15.0, theme.ok))
                                                .child(
                                                    div()
                                                        .flex()
                                                        .flex_col()
                                                        .gap(px(2.0))
                                                        .flex_1()
                                                        .min_w(px(0.0))
                                                        .child(
                                                            div()
                                                                .flex()
                                                                .items_center()
                                                                .gap_2()
                                                                .child(
                                                                    div()
                                                                        .text_size(px(11.5))
                                                                        .font_weight(semibold())
                                                                        .text_color(theme.text)
                                                                        .truncate()
                                                                        .child(name),
                                                                )
                                                                .child(badge(&theme, "Zulu", theme.muted)),
                                                        )
                                                        .child(
                                                            div()
                                                                .text_size(px(10.0))
                                                                .font_family(MONO)
                                                                .text_color(theme.faint)
                                                                .truncate()
                                                                .child(if installed_at.is_empty() {
                                                                    format!("{} · {}", crate::util::format_bytes(bytes), java)
                                                                } else {
                                                                    format!("{} · {} · {}", crate::util::format_bytes(bytes), date_of(installed_at), java)
                                                                }),
                                                        ),
                                                )
                                                .child(actions)
                                        }))
                                        .when(!external.is_empty(), |el| {
                                            el.child(
                                                div()
                                                    .pt(px(10.0))
                                                    .border_t_1()
                                                    .border_color(theme.border_soft)
                                                    .text_size(px(10.0))
                                                    .text_color(theme.faint)
                                                    .child(tr(en, "Java khác trên máy", "Other Java installs on this PC")),
                                            )
                                        })
                                        .children(external.iter().map(|java| {
                                            let path = java.get("path").and_then(Value::as_str).unwrap_or("").to_string();
                                            let major = java.get("major").and_then(Value::as_u64).unwrap_or(0);
                                            let in_use = selected_java == path;
                                            let view_use = view.clone();
                                            let path_use = path.clone();
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap_3()
                                                .pt(px(10.0))
                                                .border_t_1()
                                                .border_color(theme.border_soft)
                                                .child(widgets::icon("coffee", 15.0, theme.muted))
                                                .child(
                                                    div()
                                                        .flex()
                                                        .flex_col()
                                                        .gap(px(2.0))
                                                        .flex_1()
                                                        .min_w(px(0.0))
                                                        .child(
                                                            div()
                                                                .flex()
                                                                .items_center()
                                                                .gap_2()
                                                                .child(
                                                                    div()
                                                                        .text_size(px(11.5))
                                                                        .font_weight(semibold())
                                                                        .text_color(theme.text)
                                                                        .child(format!("Java {major}")),
                                                                )
                                                                .child(badge(&theme, &tr(en, "có sẵn", "installed"), theme.muted)),
                                                        )
                                                        .child(
                                                            div()
                                                                .text_size(px(10.0))
                                                                .font_family(MONO)
                                                                .text_color(theme.faint)
                                                                .truncate()
                                                                .child(path.clone()),
                                                        ),
                                                )
                                                .child(if in_use {
                                                    div()
                                                        .text_size(px(10.0))
                                                        .font_weight(semibold())
                                                        .text_color(theme.accent)
                                                        .child(tr(en, "đang dùng", "in use"))
                                                        .into_any_element()
                                                } else {
                                                    mini_button(&theme, format!("external-use-{path}"), tr(en, "Dùng", "Use"), false, false, move |_, _, cx| {
                                                        let path = path_use.clone();
                                                        let _ = view_use.update(cx, |this, cx| this.use_java(path, cx));
                                                    })
                                                    .into_any_element()
                                                })
                                        }))
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .gap_2()
                                                .pt(px(12.0))
                                                .border_t_1()
                                                .border_color(theme.border_soft)
                                                .child(
                                                    div()
                                                        .flex()
                                                        .items_center()
                                                        .gap_3()
                                                        .child(widgets::icon("hard-drive", 15.0, theme.muted))
                                                        .child(
                                                            div()
                                                                .flex()
                                                                .flex_col()
                                                                .gap(px(2.0))
                                                                .flex_1()
                                                                .min_w(px(0.0))
                                                                .child(
                                                                    div()
                                                                        .text_size(px(TEXT_SM))
                                                                        .font_weight(semibold())
                                                                        .text_color(theme.text)
                                                                        .child(tr(en, "Ghi đè Java (nâng cao)", "Java override (advanced)")),
                                                                )
                                                                .child(
                                                                    div()
                                                                        .text_size(px(TEXT_XS))
                                                                        .text_color(theme.faint)
                                                                        .truncate()
                                                                        .child(if java_path.is_empty() {
                                                                            tr(en, "Để trống = dùng Java tải kèm ở trên.", "Empty = use the bundled runtime above.")
                                                                        } else {
                                                                            java_path.clone()
                                                                        }),
                                                                ),
                                                        ),
                                                )
                                                .child(
                                                    div()
                                                        .flex()
                                                        .items_center()
                                                        .gap_2()
                                                        .child(
                                                            div()
                                                                .w(px(430.0))
                                                                .min_w(px(0.0))
                                                                .overflow_hidden()
                                                                .child(widgets::text_input_box(&theme).child(app.settings_java_input.clone())),
                                                        )
                                                        .child({
                                                            let view_browse = view.clone();
                                                            mini_button(&theme, "java-browse".into(), tr(en, "Chọn", "Browse"), false, false, move |_, _, cx| {
                                                                let view = view_browse.clone();
                                                                cx.spawn(async move |cx| {
                                                                    let picked = rfd::AsyncFileDialog::new()
                                                                        .add_filter("Java", &["exe"])
                                                                        .set_title("Chọn java.exe")
                                                                        .pick_file()
                                                                        .await;
                                                                    if let Some(file) = picked {
                                                                        let path = file.path().to_string_lossy().into_owned();
                                                                        let _ = view.update(cx, |this, cx| this.use_java(path, cx));
                                                                    }
                                                                })
                                                                .detach();
                                                            })
                                                        })
                                                        .child({
                                                            let view_auto = view.clone();
                                                            mini_button(&theme, "java-auto".into(), tr(en, "Tự động", "Auto"), false, false, move |_, _, cx| {
                                                                let _ = view_auto.update(cx, |this, cx| this.use_java(String::new(), cx));
                                                            })
                                                        }),
                                                ),
                                        ),
                                ),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(section_header(
                            &theme,
                            tr(en, "Cập nhật", "Updates"),
                            format!("v{}", env!("CARGO_PKG_VERSION")),
                        ))
                        .child(
                            card(&theme)
                                .child(row(
                                    &theme,
                                    "arrows-clockwise-fill",
                                    tr(en, "Tự động cập nhật", "Automatic updates"),
                                    tr(
                                        en,
                                        "Tự kiểm tra bản mới trên GitHub khi mở launcher.",
                                        "Check GitHub for new builds when the launcher opens.",
                                    ),
                                    true,
                                    toggle(&theme, "auto", auto_update, move |_, _, cx| {
                                        let _ = view_auto.update(cx, |this, cx| {
                                            let next = !this
                                                .settings
                                                .get("autoUpdate")
                                                .and_then(Value::as_bool)
                                                .unwrap_or(true);
                                            this.backend.settings_set(json!({"autoUpdate": next}));
                                            this.refresh_settings();
                                            cx.notify();
                                        });
                                    }),
                                ))
                                .child(row(
                                    &theme,
                                    "sparkle",
                                    tr(en, "Có gì mới trong bản này", "What's new in this build"),
                                    tr(en, "Xem ghi chú phát hành của phiên bản đang chạy.", "Read the release notes for this build."),
                                    false,
                                    mini_button(&theme, "whats-new".into(), tr(en, "Xem", "Open"), false, false, move |_, _, cx| {
                                        let _ = view_whats_new.update(cx, |this, cx| this.open_whats_new(cx));
                                    }),
                                ))
                                .child(row(
                                    &theme,
                                    "download-simple",
                                    tr(en, "Phiên bản launcher", "Launcher version"),
                                    status_text(en, &app.settings_ui),
                                    false,
                                    {
                                        let phase = app.settings_ui.update_phase.clone();
                                        if phase == "available" {
                                            let url = app.settings_ui.update_url.clone();
                                            mini_button(&theme, "update-download".into(), tr(en, "Tải bản mới", "Download"), true, false, move |_, _, _cx| {
                                                if url.starts_with("http") {
                                                    let _ = open::that(&url);
                                                }
                                            })
                                            .into_any_element()
                                        } else if phase == "checking" {
                                            div()
                                                .h(px(28.0))
                                                .px(px(10.0))
                                                .flex()
                                                .items_center()
                                                .gap_2()
                                                .rounded(px(6.0))
                                                .bg(theme.elevated)
                                                .text_size(px(10.5))
                                                .text_color(theme.muted)
                                                .child(widgets::spinner(12.0, theme.accent))
                                                .child(tr(en, "Đang kiểm tra…", "Checking…"))
                                                .into_any_element()
                                        } else {
                                            let view_check = view_check.clone();
                                            mini_button(&theme, "update-check".into(), tr(en, "Kiểm tra", "Check"), false, false, move |_, _, cx| {
                                                let _ = view_check.update(cx, |this, cx| this.check_update(true, cx));
                                            })
                                            .into_any_element()
                                        }
                                    },
                                ))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .justify_end()
                                        .px(px(16.0))
                                        .py(px(10.0))
                                        .border_t_1()
                                        .border_color(theme.border_soft)
                                        .child(widgets::ghost_button("open-releases", tr(en, "Trang phát hành", "Releases page"), &theme, move |_, _, _cx| {
                                            let _ = open::that("https://github.com/foxstudio-201/LunarSpaceLauncher/releases");
                                        })),
                                ),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(section_header(
                            &theme,
                            tr(en, "Máy tính", "Machine"),
                            {
                                let platform = app.system.get("platform").and_then(Value::as_str).unwrap_or("");
                                let arch = app.system.get("arch").and_then(Value::as_str).unwrap_or("");
                                if platform.is_empty() { String::new() } else { format!("{platform} {arch}") }
                            },
                        ))
                        .child({
                            let total_mem = app.system.get("totalMem").and_then(Value::as_u64).unwrap_or(0);
                            let free_mem = app.system.get("freeMem").and_then(Value::as_u64).unwrap_or(0);
                            let used_mem = total_mem.saturating_sub(free_mem);
                            let disk_total = app.system.pointer("/disk/total").and_then(Value::as_u64).unwrap_or(0);
                            let disk_free = app.system.pointer("/disk/free").and_then(Value::as_u64).unwrap_or(0);
                            let disk_used = disk_total.saturating_sub(disk_free);
                            let threads = app.system.get("cpuThreads").and_then(Value::as_u64).unwrap_or(0);
                            let cache = app.system.get("cacheBytes").and_then(Value::as_u64).unwrap_or(0);
                            let platform = app.system.get("platform").and_then(Value::as_str).unwrap_or("");
                            let arch = app.system.get("arch").and_then(Value::as_str).unwrap_or("");
                            div()
                                .flex()
                                .gap_3()
                                .child(
                                    card(&theme)
                                        .flex_1()
                                        .p(px(16.0))
                                        .gap_4()
                                        .child(meter(
                                            &theme,
                                            tr(en, "RAM", "RAM"),
                                            format!("{} / {}", crate::util::format_bytes(used_mem), crate::util::format_bytes(total_mem.max(1))),
                                            format!("{}%", if total_mem > 0 { used_mem * 100 / total_mem } else { 0 }),
                                            if total_mem > 0 { used_mem as f32 / total_mem as f32 * 100.0 } else { 0.0 },
                                            theme.info,
                                        ))
                                        .child(meter(
                                            &theme,
                                            tr(en, "Ổ đĩa", "Disk"),
                                            format!("{} / {}", crate::util::format_bytes(disk_used), crate::util::format_bytes(disk_total.max(1))),
                                            format!("{} {}", crate::util::format_bytes(disk_free), tr(en, "trống", "free")),
                                            if disk_total > 0 { disk_used as f32 / disk_total as f32 * 100.0 } else { 0.0 },
                                            theme.ok,
                                        )),
                                )
                                .child(
                                    card(&theme)
                                        .flex_1()
                                        .p(px(16.0))
                                        .gap_2()
                                        .child(fact(&theme, tr(en, "CPU", "CPU"), format!("{threads} {}", tr(en, "nhân", "threads"))))
                                        .child(fact(&theme, tr(en, "Nền tảng", "Platform"), format!("{platform} {arch}")))
                                        .child(fact(&theme, tr(en, "Dung lượng RAM", "Total RAM"), crate::util::format_bytes(total_mem)))
                                        .child(fact(&theme, tr(en, "Ổ đĩa trống", "Free disk"), crate::util::format_bytes(disk_free)))
                                        .child(fact(&theme, tr(en, "Tài nguyên đã tải", "Downloaded assets"), crate::util::format_bytes(cache)))
                                        .child(fact(
                                            &theme,
                                            tr(en, "Java tải kèm", "Bundled Java"),
                                            format!(
                                                "{} {} · {}",
                                                managed_installed.len(),
                                                tr(en, "bản", "runtimes"),
                                                crate::util::format_bytes(managed_bytes)
                                            ),
                                        )),
                                )
                        }),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(section_header(
                            &theme,
                            tr(en, "Về XyoLauncher", "About XyoLauncher"),
                            format!("v{}", env!("CARGO_PKG_VERSION")),
                        ))
                        .child(
                            card(&theme)
                                .p(px(16.0))
                                .gap_2()
                                .child(fact(&theme, tr(en, "Phiên bản launcher", "Launcher version"), format!("v{}", env!("CARGO_PKG_VERSION"))))
                                .child(fact(
                                    &theme,
                                    tr(en, "Nền tảng", "Platform"),
                                    format!(
                                        "{} {}",
                                        app.system.get("platform").and_then(Value::as_str).unwrap_or("win32"),
                                        app.system.get("arch").and_then(Value::as_str).unwrap_or(std::env::consts::ARCH)
                                    ),
                                ))
                                .child(fact(&theme, tr(en, "Nhà phát triển", "Made by"), "XyoLauncher".into()))
                                .child(
                                    div()
                                        .pt(px(10.0))
                                        .border_t_1()
                                        .border_color(theme.border_soft)
                                        .text_size(px(TEXT_XS))
                                        .line_height(px(17.0))
                                        .text_color(theme.faint)
                                        .child(tr(
                                            en,
                                            "Java được tải tự động theo phiên bản game và dùng chung cho mọi phiên bản cùng nhóm. Vào tab Phiên bản để tạo phiên bản mới.",
                                            "Java is downloaded automatically per game version and shared across versions. Open the Versions tab to create a new instance.",
                                        )),
                                ),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(section_header(&theme, tr(en, "Thư mục", "Folders"), String::new()))
                        .child(
                            card(&theme)
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_3()
                                        .px(px(16.0))
                                        .py(px(12.0))
                                        .child(widgets::icon("folder-simple", 15.0, theme.muted))
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .gap(px(2.0))
                                                .flex_1()
                                                .min_w(px(0.0))
                                                .child(
                                                    div()
                                                        .text_size(px(TEXT_SM))
                                                        .font_weight(semibold())
                                                        .text_color(theme.text)
                                                        .child(tr(en, "Thư mục dùng chung", "Shared folder")),
                                                )
                                                .child(
                                                    div()
                                                        .text_size(px(10.0))
                                                        .font_family(MONO)
                                                        .text_color(theme.faint)
                                                        .truncate()
                                                        .child(shared.clone()),
                                                ),
                                        )
                                        .child({
                                            let shared = shared.clone();
                                            mini_button(&theme, "open-shared".into(), tr(en, "Mở", "Open"), false, false, move |_, _, _cx| {
                                                let _ = open::that(&shared);
                                            })
                                        }),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_3()
                                        .px(px(16.0))
                                        .py(px(12.0))
                                        .border_t_1()
                                        .border_color(theme.border_soft)
                                        .child(widgets::icon("folder-open", 15.0, theme.muted))
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .gap(px(2.0))
                                                .flex_1()
                                                .min_w(px(0.0))
                                                .child(
                                                    div()
                                                        .text_size(px(TEXT_SM))
                                                        .font_weight(semibold())
                                                        .text_color(theme.text)
                                                        .child(tr(en, "Thư mục phiên bản", "Instances folder")),
                                                )
                                                .child(
                                                    div()
                                                        .text_size(px(10.0))
                                                        .font_family(MONO)
                                                        .text_color(theme.faint)
                                                        .truncate()
                                                        .child(default_instances.clone()),
                                                ),
                                        )
                                        .child({
                                            let dir = default_instances.clone();
                                            mini_button(&theme, "open-instances".into(), tr(en, "Mở", "Open"), false, false, move |_, _, _cx| {
                                                let _ = open::that(&dir);
                                            })
                                        }),
                                ),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_center()
                        .pt(px(2.0))
                        .pb(px(12.0))
                        .text_size(px(TEXT_XS))
                        .text_color(theme.faint)
                        .child(tr(en, "XyoLauncher · Rust + GPUI", "XyoLauncher · Rust + GPUI")),
                ),
        );
    page.into_any_element()
}

pub fn whats_new_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> impl IntoElement {
    let theme = app.theme.clone();
    let (title, notes, url) = match &app.modal {
        Modal::WhatsNew { title, notes, url } => (title.clone(), notes.clone(), url.clone()),
        _ => (String::new(), String::new(), String::new()),
    };
    let view = cx.entity().downgrade();
    let close_view = view.clone();
    let content = div()
        .flex()
        .flex_col()
        .gap_4()
        .child(
            div()
                .text_size(px(TEXT_XL))
                .font_weight(semibold())
                .text_color(theme.text)
                .child(title),
        )
        .child(
            div()
                .w_full()
                .text_size(px(TEXT_BASE))
                .line_height(px(20.0))
                .text_color(theme.muted)
                .child(if notes.is_empty() {
                    "Chưa có ghi chú phát hành.".to_string()
                } else {
                    notes
                }),
        )
        .child(
            div()
                .flex()
                .justify_between()
                .gap_2()
                .child(widgets::ghost_button("whats-new-release", "Trang phát hành", &theme, move |_, _, _cx| {
                    if url.starts_with("http") {
                        let _ = open::that(&url);
                    }
                }))
                .child(widgets::button("whats-new-close", "Đóng", &theme, true, move |_, _, cx| {
                    let _ = close_view.update(cx, |this, cx| {
                        this.modal = Modal::None;
                        cx.notify();
                    });
                })),
        );
    modal_overlay(theme.clone(), 520.0, content, move |_, _, cx| {
        let _ = view.update(cx, |this, cx| {
            this.modal = Modal::None;
            cx.notify();
        });
    })
}

impl LauncherApp {
    pub fn load_java(&mut self, cx: &mut Context<Self>) {
        let rx = self.backend.java_options();
        self.on_result(cx, rx, |this, value, cx| {
            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                this.settings_ui.runtimes = value
                    .get("runtimes")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                this.settings_ui.java_external = value
                    .get("external")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                this.settings_ui.java_selected = value
                    .get("selected")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                cx.notify();
            }
        });
    }

    pub fn load_discord(&mut self, cx: &mut Context<Self>) {
        let value = self.backend.discord_status();
        if self.settings_ui.discord != value {
            self.settings_ui.discord = value;
            cx.notify();
        }
    }

    pub fn save_settings(&mut self, cx: &mut Context<Self>) {
        let memory = self
            .settings_memory_input
            .read(cx)
            .text()
            .trim()
            .parse::<u32>()
            .unwrap_or_else(|_| {
                self.settings
                    .get("defaultMemory")
                    .and_then(Value::as_u64)
                    .unwrap_or(4096) as u32
            });
        let java = self.settings_java_input.read(cx).text().trim().to_string();
        let java = if java.is_empty() { Value::Null } else { Value::String(java) };
        self.backend.settings_set(json!({"defaultMemory": memory, "javaPath": java}));
        self.refresh_settings();
        self.settings_ui.saved = true;
        self.load_java(cx);
        self.settings_saved_flash(cx);
        self.toast("ok", "Đã lưu cài đặt", "", cx);
        cx.notify();
    }

    pub fn settings_saved_flash(&mut self, cx: &mut Context<Self>) {
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(std::time::Duration::from_millis(1800))
                .await;
            let _ = this.update(cx, |this, cx| {
                this.settings_ui.saved = false;
                cx.notify();
            });
        })
        .detach();
    }

    pub fn use_java(&mut self, path: String, cx: &mut Context<Self>) {
        let value = if path.trim().is_empty() {
            Value::Null
        } else {
            Value::String(path.trim().to_string())
        };
        self.backend.settings_set(json!({"javaPath": value}));
        self.refresh_settings();
        self.settings_java_input
            .update(cx, |input, cx| input.set_text(path.trim().to_string(), cx));
        self.load_java(cx);
        self.settings_ui.saved = true;
        self.settings_saved_flash(cx);
        cx.notify();
    }

    pub fn check_update(&mut self, manual: bool, cx: &mut Context<Self>) {
        if self.settings_ui.update_phase == "checking" {
            return;
        }
        self.settings_ui.update_phase = "checking".into();
        self.settings_ui.update_error.clear();
        let rx = self.backend.update_check();
        self.on_result(cx, rx, move |this, value, cx| {
            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                this.settings_ui.update_latest = value
                    .get("latest")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                this.settings_ui.update_notes = value
                    .get("notes")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                this.settings_ui.update_url = value
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let newer = value.get("newer").and_then(Value::as_bool).unwrap_or(false);
                this.settings_ui.update_phase = if newer { "available".into() } else { "current".into() };
                if manual && !newer {
                    this.toast("ok", "Đang dùng bản mới nhất", "", cx);
                }
            } else {
                this.settings_ui.update_phase = "error".into();
                this.settings_ui.update_error = value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Không kiểm tra được cập nhật")
                    .to_string();
                if manual {
                    this.toast("bad", "Không kiểm tra được cập nhật", "", cx);
                }
            }
            cx.notify();
        });
    }

    pub fn open_whats_new(&mut self, cx: &mut Context<Self>) {
        if !self.settings_ui.update_notes.is_empty() {
            let latest = if self.settings_ui.update_latest.is_empty() {
                env!("CARGO_PKG_VERSION").to_string()
            } else {
                self.settings_ui.update_latest.clone()
            };
            self.modal = Modal::WhatsNew {
                title: format!("Bản phát hành mới nhất · v{latest}"),
                notes: self.settings_ui.update_notes.clone(),
                url: self.settings_ui.update_url.clone(),
            };
            cx.notify();
            return;
        }
        self.settings_ui.update_phase = "checking".into();
        let rx = self.backend.update_check();
        self.on_result(cx, rx, |this, value, cx| {
            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                this.settings_ui.update_latest = value
                    .get("latest")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                this.settings_ui.update_notes = value
                    .get("notes")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                this.settings_ui.update_url = value
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let newer = value.get("newer").and_then(Value::as_bool).unwrap_or(false);
                this.settings_ui.update_phase = if newer { "available".into() } else { "current".into() };
                let latest = if this.settings_ui.update_latest.is_empty() {
                    env!("CARGO_PKG_VERSION").to_string()
                } else {
                    this.settings_ui.update_latest.clone()
                };
                this.modal = Modal::WhatsNew {
                    title: format!("Bản phát hành mới nhất · v{latest}"),
                    notes: this.settings_ui.update_notes.clone(),
                    url: this.settings_ui.update_url.clone(),
                };
            } else {
                this.settings_ui.update_phase = "error".into();
                this.settings_ui.update_error = value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Không kiểm tra được cập nhật")
                    .to_string();
                this.toast("bad", "Không kiểm tra được cập nhật", "", cx);
            }
            cx.notify();
        });
    }
}
