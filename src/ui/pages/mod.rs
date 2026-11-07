pub mod accounts;
pub mod home;
pub mod host;
pub mod instance;
pub mod modpack;
pub mod servers;
pub mod settings;
pub mod versions;

use crate::models::Instance;
use crate::ui::app::{ConfirmAction, LauncherApp, Modal, Toast};
use crate::ui::theme::*;
use crate::ui::widgets::{self, TextField};
use gpui::{
    AnyElement, AnimationExt, Context, Div, Entity, FontWeight, IntoElement, SharedString, Window,
    div, prelude::*, px,
};
use serde_json::json;

pub fn page_header(
    theme: &Theme,
    title: impl Into<SharedString>,
    subtitle: impl Into<SharedString>,
    actions: impl IntoElement,
) -> impl IntoElement {
    div()
        .flex()
        .items_end()
        .justify_between()
        .gap_4()
        .w_full()
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.0))
                .child(
                    div()
                        .text_size(px(TEXT_2XL))
                        .font_weight(bold())
                        .text_color(theme.text)
                        .child(title.into()),
                )
                .child(
                    div()
                        .text_size(px(TEXT_BASE))
                        .text_color(theme.muted)
                        .child(subtitle.into()),
                ),
        )
        .child(div().flex().items_center().gap_2().child(actions))
}

pub fn page_body() -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(18.0))
        .p(px(26.0))
        .w_full()
        .min_w(px(0.0))
        .max_w(px(1360.0))
        .mx_auto()
}

pub fn section_title(theme: &Theme, title: impl Into<SharedString>, hint: impl Into<SharedString>) -> impl IntoElement {
    div()
        .flex()
        .items_end()
        .justify_between()
        .w_full()
        .child(
            div()
                .text_size(px(TEXT_LG))
                .font_weight(semibold())
                .text_color(theme.text)
                .child(title.into()),
        )
        .child(
            div()
                .text_size(px(TEXT_SM))
                .text_color(theme.faint)
                .child(hint.into()),
        )
}

pub fn field(theme: &Theme, label: &str, input: Entity<TextField>, hint: &str) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(px(6.0))
        .w_full()
        .child(
            div()
                .text_size(px(TEXT_SM))
                .font_weight(medium())
                .text_color(theme.muted)
                .child(label.to_string()),
        )
        .child(widgets::text_input_box(theme).child(input))
        .when(!hint.is_empty(), |el| {
            el.child(
                div()
                    .text_size(px(TEXT_XS))
                    .text_color(theme.faint)
                    .child(hint.to_string()),
            )
        })
}

pub fn empty_state(theme: &Theme, icon_name: &'static str, title: &str, hint: &str) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap_3()
        .py(px(56.0))
        .w_full()
        .child(
            div()
                .size(px(56.0))
                .rounded(px(RADIUS_LG))
                .bg(theme.surface)
                .border_1()
                .border_color(theme.border_soft)
                .flex()
                .items_center()
                .justify_center()
                .child(widgets::icon(icon_name, 24.0, theme.faint)),
        )
        .child(
            div()
                .text_size(px(TEXT_LG))
                .font_weight(semibold())
                .text_color(theme.text)
                .child(title.to_string()),
        )
        .child(
            div()
                .text_size(px(TEXT_BASE))
                .text_color(theme.muted)
                .child(hint.to_string()),
        )
}

pub fn splash(app: &LauncherApp, _window: &mut Window, _cx: &mut Context<LauncherApp>) -> impl IntoElement {
    let loading_progress = app
        .splash_loading_at
        .map(|at| (at.elapsed().as_secs_f32() / 0.28).clamp(0.0, 1.0))
        .unwrap_or(0.0);
    let fade = app
        .splash_fade_at
        .map(|at| (1.0 - at.elapsed().as_secs_f32() / 0.42).clamp(0.0, 1.0))
        .unwrap_or(1.0);
    let alpha = (loading_progress * fade * 255.0) as u32;
    let base_alpha = (fade * 255.0) as u32;
    let video_opacity = (1.0 - loading_progress) * fade;
    let loading_opacity = alpha as f32 / 255.0;
    div()
        .absolute()
        .inset_0()
        .truncate()
        .child(
            div()
                .absolute()
                .inset_0()
                .bg(gpui::rgba((0x0c0e12 << 8) | base_alpha)),
        )
        .when_some(app.splash_image.clone(), |el, frame| {
            el.child(
                gpui::img(frame)
                    .absolute()
                    .inset_0()
                    .size_full()
                    .object_fit(gpui::ObjectFit::Cover)
                    .opacity(video_opacity),
            )
        })
        .child(
            div()
                .absolute()
                .inset_0()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(18.0))
                .opacity(loading_opacity)
                .child(
                    gpui::img(crate::ui::assets::image_path("xyolauncher.png"))
                        .size(px(88.0))
                        .rounded(px(22.0))
                        .object_fit(gpui::ObjectFit::Cover),
                )
                .child(
                    div()
                        .text_size(px(24.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(gpui::rgb(0xe8ebf1))
                        .child("XyoLauncher"),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(gpui::rgb(0x656d7b))
                        .child("Đang tải dữ liệu…"),
                )
                .child(widgets::spinner(20.0, gpui::rgb(0xe9b872))),
        )
}

pub fn modal_overlay(
    theme: Theme,
    width: f32,
    content: impl IntoElement,
    close: impl Fn(&gpui::ClickEvent, &mut Window, &mut gpui::App) + 'static,
) -> impl IntoElement {
    div()
        .id("modal-backdrop")
        .absolute()
        .inset_0()
        .flex()
        .items_center()
        .justify_center()
        .bg(theme.overlay)
        .on_click(close)
        .child(
            div()
                .id("modal-content")
                .w(px(width))
                .max_h(px(760.0))
                .overflow_y_scroll()
                .on_scroll_wheel(|_, _, cx| cx.stop_propagation())
                .rounded(px(RADIUS_LG))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border)
                .shadow_lg()
                .p(px(22.0))
                .on_click(|_, _, cx| cx.stop_propagation())
                .child(content)
                .with_animation(
                    "modal-content-in",
                    gpui::Animation::new(std::time::Duration::from_millis(240)),
                    |el, t| el.opacity(t).mt(px(16.0 * (1.0 - t))),
                ),
        )
}

pub fn loader_change_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> impl IntoElement {
    let theme = app.theme.clone();
    let (id, loader, game, builds, selected) = match &app.modal {
        Modal::LoaderChange { id, loader, game, builds, selected } => (
            id.clone(),
            loader.clone(),
            game.clone(),
            builds.clone(),
            selected.clone(),
        ),
        _ => (String::new(), String::new(), String::new(), Vec::new(), None),
    };
    let view_close = cx.entity().downgrade();
    let view_pick = cx.entity().downgrade();
    let view_save = cx.entity().downgrade();
    let mut rows = div().id("loader-builds").flex().flex_col().gap(px(3.0)).max_h(px(340.0)).overflow_y_scroll()
        .on_scroll_wheel(|_, _, cx| cx.stop_propagation());
    if builds.is_empty() {
        rows = rows.child(
            div().p(px(12.0)).text_size(px(TEXT_SM)).text_color(theme.faint).child("Không có bản loader nào cho phiên bản này."),
        );
    }
    for build in builds.iter().take(80).cloned().collect::<Vec<_>>() {
        let build_id = build.get("id").and_then(serde_json::Value::as_str).unwrap_or("").to_string();
        let label = build
            .get("version")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(&build_id)
            .to_string();
        let stable = build.get("stable").and_then(serde_json::Value::as_bool).unwrap_or(true);
        let latest = build.get("latest").and_then(serde_json::Value::as_bool).unwrap_or(false);
        let number = build.get("build").and_then(serde_json::Value::as_str).unwrap_or("");
        let active = selected.as_deref() == Some(build_id.as_str());
        let view = view_pick.clone();
        rows = rows.child(
            div()
                .id(gpui::SharedString::from(format!("loader-build-{build_id}")))
                .flex()
                .items_center()
                .gap_3()
                .p(px(9.0))
                .rounded(px(RADIUS_SM))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .cursor_pointer()
                .hover(|s| s.bg(theme.surface_hover))
                .on_click(move |_, _, cx| {
                    let build_id = build_id.clone();
                    let _ = view.update(cx, |this, cx| {
                        if let Modal::LoaderChange { selected, .. } = &mut this.modal {
                            *selected = Some(build_id.clone());
                        }
                        cx.notify();
                    });
                })
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .flex_1()
                        .child(div().text_size(px(TEXT_SM)).font_family(MONO).text_color(theme.text).child(label))
                        .when(stable, |el| el.child(widgets::tag("Ổn định", theme.ok, &theme)))
                        .when(latest, |el| el.child(widgets::tag("Mới nhất", theme.accent_soft, &theme))),
                )
                .when(!number.is_empty(), |el| {
                    el.child(div().text_size(px(10.0)).text_color(theme.faint).child(format!("build {number}")))
                })
                .child(widgets::icon(
                    if active { "check-circle" } else { "circle" },
                    15.0,
                    if active { theme.accent_soft } else { theme.faint },
                )),
        );
    }

    let content = div()
        .flex()
        .flex_col()
        .gap_4()
        .child(
            div()
                .flex()
                .items_start()
                .justify_between()
                .gap_3()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .child(div().text_size(px(TEXT_2XL)).font_weight(bold()).text_color(theme.text).child("Đổi phiên bản loader"))
                        .child(
                            div()
                                .text_size(px(TEXT_SM))
                                .text_color(theme.muted)
                                .child(format!("{loader} · Minecraft {game} · tệp game sẽ được kiểm tra lại sau khi đổi.")),
                        ),
                )
                .child(widgets::icon_button("loader-close", "x", &theme, move |_, _, cx| {
                    let _ = view_close.update(cx, |this, cx| {
                        this.modal = Modal::None;
                        cx.notify();
                    });
                })),
        )
        .child(rows)
        .child(
            div()
                .flex()
                .items_center()
                .justify_end()
                .gap_2()
                .child(widgets::ghost_button("loader-cancel", "Đóng", &theme, {
                    let view = cx.entity().downgrade();
                    move |_, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            this.modal = Modal::None;
                            cx.notify();
                        });
                    }
                }))
                .child(widgets::button("loader-save", "Áp dụng", &theme, true, move |_, _, cx| {
                    let id = id.clone();
                    let _ = view_save.update(cx, |this, cx| {
                        let selected = match &this.modal {
                            Modal::LoaderChange { selected, .. } => selected.clone(),
                            _ => None,
                        };
                        let Some(selected) = selected else {
                            this.toast("warn", "Chọn phiên bản loader", "", cx);
                            return;
                        };
                        this.modal = Modal::None;
                        this.toast("info", "Đang cài loader", "Quá trình tải có thể mất vài phút.", cx);
                        let rx = this.backend.change_loader(id.clone(), selected);
                        this.on_result(cx, rx, |this, value, cx| {
                            if value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                                this.refresh_instances();
                                this.load_instance_tab(cx);
                                this.toast("ok", "Đã đổi loader", "", cx);
                            } else {
                                this.toast("bad", "Đổi loader thất bại", value.get("error").and_then(serde_json::Value::as_str).unwrap_or(""), cx);
                            }
                        });
                    });
                })),
        );

    let backdrop = cx.entity().downgrade();
    modal_overlay(theme, 560.0, content, move |_, _, cx| {
        let _ = backdrop.update(cx, |this, cx| {
            this.modal = Modal::None;
            cx.notify();
        });
    })
}

pub fn skin_paint_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> impl IntoElement {
    use std::cell::RefCell;
    use std::rc::Rc;
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let asset = app.skin_ui.paint_asset.clone();
    let tool = app.skin_ui.paint_tool.clone();
    let color = app.skin_ui.paint_color.clone();
    let (target_w, target_h) = if asset == "cape" { (384.0f32, 192.0f32) } else { (384.0f32, 384.0f32) };

    let bounds: Rc<RefCell<Option<gpui::Bounds<gpui::Pixels>>>> = Rc::new(RefCell::new(None));
    let bounds_paint = bounds.clone();
    let bounds_down = bounds.clone();
    let bounds_move = bounds.clone();
    let view_down = view.clone();
    let view_move = view.clone();
    let view_up = view.clone();
    let view_up_out = view.clone();
    let grid = app.skin_ui.paint_grid;
    let canvas = gpui::canvas(
        move |bounds, _, _| {
            *bounds_paint.borrow_mut() = Some(bounds);
        },
        move |bounds, _, window, _| {
            if grid {
                let line = gpui::rgba(0xFFFFFF22);
                for step in 0..=64 {
                    let x = bounds.origin.x + gpui::px(step as f32 * 6.0);
                    window.paint_quad(gpui::fill(
                        gpui::Bounds::new(
                            gpui::point(x, bounds.origin.y),
                            gpui::size(gpui::px(1.0), bounds.size.height),
                        ),
                        line,
                    ));
                    let y = bounds.origin.y + gpui::px(step as f32 * 6.0);
                    if step * 6 < target_h as usize * 6 {
                        window.paint_quad(gpui::fill(
                            gpui::Bounds::new(
                                gpui::point(bounds.origin.x, y),
                                gpui::size(bounds.size.width, gpui::px(1.0)),
                            ),
                            line,
                        ));
                    }
                }
            }
        },
    );

    let surface = div()
        .id("skin-paint-surface")
        .relative()
        .w(gpui::px(target_w))
        .h(gpui::px(target_h))
        .rounded(gpui::px(8.0))
        .overflow_hidden()
        .bg(theme.elevated)
        .border_1()
        .border_color(theme.border)
        .cursor_pointer()
        .when_some(app.paint_preview.clone(), |el, image| {
            el.child(gpui::img(image).absolute().inset_0().size_full())
        })
        .child(canvas.absolute().inset_0().size_full())
        .on_mouse_down(gpui::MouseButton::Left, move |event, _, cx| {
            let point = bounds_down
                .borrow()
                .as_ref()
                .and_then(|bounds| bounds.localize(&event.position));
            let Some(point) = point else { return };
            let x = (f32::from(point.x) / 6.0).floor() as i32;
            let y = (f32::from(point.y) / 6.0).floor() as i32;
            let _ = view_down.update(cx, |this, cx| {
                this.paint_begin_stroke();
                this.skin_ui.paint_painting = true;
                this.skin_ui.paint_last = None;
                this.paint_at(x, y, cx);
                if this.skin_ui.paint_tool == "fill" || this.skin_ui.paint_tool == "picker" {
                    this.skin_ui.paint_painting = false;
                    this.skin_ui.paint_last = None;
                }
                cx.notify();
            });
        })
        .on_mouse_move(move |event, _, cx| {
            let point = bounds_move
                .borrow()
                .as_ref()
                .and_then(|bounds| bounds.localize(&event.position));
            let Some(point) = point else { return };
            let x = (f32::from(point.x) / 6.0).floor() as i32;
            let y = (f32::from(point.y) / 6.0).floor() as i32;
            let _ = view_move.update(cx, |this, cx| {
                if this.skin_ui.paint_painting {
                    this.paint_at(x, y, cx);
                }
            });
        })
        .on_mouse_up(gpui::MouseButton::Left, move |_, _, cx| {
            let _ = view_up.update(cx, |this, cx| {
                this.skin_ui.paint_painting = false;
                this.skin_ui.paint_last = None;
                cx.notify();
            });
        })
        .on_mouse_up_out(gpui::MouseButton::Left, move |_, _, cx| {
            let _ = view_up_out.update(cx, |this, cx| {
                this.skin_ui.paint_painting = false;
                this.skin_ui.paint_last = None;
                cx.notify();
            });
        });

    let mut asset_row = div().flex().items_center().gap_2();
    for (key, label) in [("skin", "Skin 64×64"), ("cape", "Cape 64×32")] {
        let active = asset == key;
        let view = view.clone();
        let key = key.to_string();
        asset_row = asset_row.child(
            div()
                .id(gpui::SharedString::from(format!("paint-asset-{key}")))
                .h(gpui::px(28.0))
                .px(gpui::px(10.0))
                .flex()
                .items_center()
                .rounded(gpui::px(6.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .text_size(gpui::px(TEXT_XS))
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let key = key.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.skin_ui.paint_asset = key;
                        this.refresh_paint_preview();
                        cx.notify();
                    });
                })
                .child(label),
        );
    }

    let tools = [
        ("pencil", "pencil-simple", "Bút"),
        ("eraser", "eraser", "Tẩy"),
        ("fill", "paint-brush", "Đổ màu"),
        ("picker", "eye", "Hút màu"),
    ];
    let mut tool_row = div().flex().items_center().gap_2();
    for (key, icon_name, label) in tools {
        let active = tool == key;
        let view = view.clone();
        let key = key.to_string();
        tool_row = tool_row.child(
            div()
                .id(gpui::SharedString::from(format!("paint-tool-{key}")))
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(gpui::px(3.0))
                .w(gpui::px(58.0))
                .h(gpui::px(46.0))
                .rounded(gpui::px(7.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .cursor_pointer()
                .child(widgets::icon(icon_name, 16.0, if active { theme.accent_soft } else { theme.muted }))
                .child(div().text_size(gpui::px(9.0)).text_color(if active { theme.accent_soft } else { theme.faint }).child(label))
                .on_click(move |_, _, cx| {
                    let key = key.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.skin_ui.paint_tool = key;
                        cx.notify();
                    });
                }),
        );
    }

    let palette = [
        "#000000", "#1D1D21", "#3C3C46", "#6B6B78", "#A5A5B0", "#D9D9E0", "#FFFFFF", "#8B5E3C",
        "#5A3A22", "#C08A5A", "#E9B872", "#F0C991", "#F4D03F", "#F5A623", "#E74C3C", "#C0392B",
        "#8E44AD", "#6C5CE7", "#3B82F6", "#4FC3F7", "#06B6D4", "#22C55E", "#4ADE80", "#A3E635",
        "#166534", "#14532D", "#7F1D1D", "#B91C1C", "#9A3412", "#D97706", "#0F766E", "#1E3A8A",
    ];
    let mut palette_grid = div().flex().flex_wrap().gap(gpui::px(4.0));
    for hex in palette {
        let active = color.eq_ignore_ascii_case(hex);
        let view = view.clone();
        let hex = hex.to_string();
        palette_grid = palette_grid.child(
            div()
                .id(gpui::SharedString::from(format!("paint-color-{hex}")))
                .size(gpui::px(24.0))
                .rounded(gpui::px(5.0))
                .bg(gpui::rgb(
                    u32::from_str_radix(&hex[1..3], 16).unwrap_or(0) << 16
                        | u32::from_str_radix(&hex[3..5], 16).unwrap_or(0) << 8
                        | u32::from_str_radix(&hex[5..7], 16).unwrap_or(0),
                ))
                .border_2()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let hex = hex.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.skin_ui.paint_color = hex;
                        if this.skin_ui.paint_tool == "eraser" || this.skin_ui.paint_tool == "picker" {
                            this.skin_ui.paint_tool = "pencil".into();
                        }
                        cx.notify();
                    });
                }),
        );
    }

    let view_grid = view.clone();
    let view_undo = view.clone();
    let view_redo = view.clone();
    let view_save = view.clone();
    let view_close = view.clone();
    let current_swatch = div()
        .size(gpui::px(30.0))
        .rounded(gpui::px(6.0))
        .bg(gpui::rgb(
            u32::from_str_radix(color.trim_start_matches('#').get(0..2).unwrap_or("E9"), 16).unwrap_or(233) << 16
                | u32::from_str_radix(color.trim_start_matches('#').get(2..4).unwrap_or("B8"), 16).unwrap_or(184) << 8
                | u32::from_str_radix(color.trim_start_matches('#').get(4..6).unwrap_or("72"), 16).unwrap_or(114),
        ))
        .border_1()
        .border_color(theme.border);

    let right = div()
        .flex()
        .flex_col()
        .gap(gpui::px(14.0))
        .w(gpui::px(300.0))
        .child(
            div()
                .flex()
                .flex_col()
                .gap_2()
                .child(div().text_size(gpui::px(TEXT_SM)).text_color(theme.muted).child("Tư liệu"))
                .child(asset_row),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap_2()
                .child(div().text_size(gpui::px(TEXT_SM)).text_color(theme.muted).child("Công cụ"))
                .child(tool_row),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap_2()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(div().text_size(gpui::px(TEXT_SM)).text_color(theme.muted).child("Màu"))
                        .child(current_swatch)
                        .child(div().text_size(gpui::px(10.0)).font_family(MONO).text_color(theme.faint).child(color.clone())),
                )
                .child(palette_grid),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(
                    div()
                        .id("paint-grid")
                        .h(gpui::px(30.0))
                        .px(gpui::px(9.0))
                        .flex()
                        .items_center()
                        .rounded(gpui::px(6.0))
                        .bg(if app.skin_ui.paint_grid { theme.accent_dim } else { theme.surface })
                        .border_1()
                        .border_color(if app.skin_ui.paint_grid { theme.accent } else { theme.border_soft })
                        .text_size(gpui::px(10.0))
                        .text_color(if app.skin_ui.paint_grid { theme.accent_soft } else { theme.muted })
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let _ = view_grid.update(cx, |this, cx| {
                                this.skin_ui.paint_grid = !this.skin_ui.paint_grid;
                                this.refresh_paint_preview();
                                cx.notify();
                            });
                        })
                        .child("Lưới"),
                )
                .child(widgets::ghost_button("paint-undo", "Hoàn tác", &theme, move |_, _, cx| {
                    let _ = view_undo.update(cx, |this, cx| {
                        this.paint_undo();
                        cx.notify();
                    });
                }))
                .child(widgets::ghost_button("paint-redo", "Làm lại", &theme, move |_, _, cx| {
                    let _ = view_redo.update(cx, |this, cx| {
                        this.paint_redo();
                        cx.notify();
                    });
                })),
        )
        .child(
            div()
                .text_size(gpui::px(TEXT_XS))
                .text_color(theme.faint)
                .child("Bấm và kéo để tô. Dùng Hút màu để lấy màu có sẵn, Đổ màu để lấp kín vùng cùng màu."),
        );

    let content = div()
        .flex()
        .flex_col()
        .gap_4()
        .child(
            div()
                .flex()
                .items_start()
                .justify_between()
                .gap_3()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .child(div().text_size(gpui::px(TEXT_2XL)).font_weight(bold()).text_color(theme.text).child("Vẽ skin"))
                        .child(div().text_size(gpui::px(TEXT_SM)).text_color(theme.muted).child("Chỉnh từng pixel rồi lưu; skin sẽ được chia sẻ cho người dùng launcher khác.")),
                )
                .child(widgets::icon_button("paint-close", "x", &theme, move |_, _, cx| {
                    let _ = view_close.update(cx, |this, cx| {
                        this.modal = Modal::None;
                        cx.notify();
                    });
                })),
        )
        .child(
            div()
                .flex()
                .gap_4()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(surface)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_3()
                                .text_size(gpui::px(10.0))
                                .text_color(theme.faint)
                                .child(format!("{asset} · 6× zoom"))
                                .child(format!("{} thao tác hoàn tác", app.skin_ui.paint_undo.len())),
                        ),
                )
                .child(right),
        )
        .child(
            div()
                .flex()
                .items_center()
                .justify_end()
                .gap_2()
                .child(widgets::ghost_button("paint-cancel", "Huỷ", &theme, {
                    let view = view.clone();
                    move |_, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            this.modal = Modal::None;
                            cx.notify();
                        });
                    }
                }))
                .child(widgets::button("paint-save", "Lưu skin", &theme, true, move |_, _, cx| {
                    let _ = view_save.update(cx, |this, cx| {
                        this.paint_save(cx);
                    });
                })),
        );

    let backdrop = cx.entity().downgrade();
    modal_overlay(theme, 780.0, content, move |_, _, cx| {
        let _ = backdrop.update(cx, |this, cx| {
            this.modal = Modal::None;
            cx.notify();
        });
    })
}

pub fn world_edit_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> impl IntoElement {
    let theme = app.theme.clone();
    let (id, folder) = match &app.modal {
        Modal::WorldEdit { id, folder, .. } => (id.clone(), folder.clone()),
        _ => (String::new(), String::new()),
    };
    let view_close = cx.entity().downgrade();
    let view_save = cx.entity().downgrade();
    let view_game = cx.entity().downgrade();
    let view_difficulty = cx.entity().downgrade();
    let view_hardcore = cx.entity().downgrade();
    let view_cheats = cx.entity().downgrade();

    let mut game_row = div().flex().items_center().gap_2();
    for (value, label) in [(0i64, "Sinh tồn"), (1, "Sáng tạo"), (2, "Phiêu lưu"), (3, "Khán giả")] {
        let active = app.instance_ui.world_game_type == value;
        let view = view_game.clone();
        game_row = game_row.child(
            div()
                .id(gpui::SharedString::from(format!("world-game-{value}")))
                .h(px(28.0))
                .px(px(10.0))
                .flex()
                .items_center()
                .rounded(px(6.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .text_size(px(TEXT_XS))
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.instance_ui.world_game_type = value;
                        cx.notify();
                    });
                })
                .child(label.to_string()),
        );
    }
    let mut difficulty_row = div().flex().items_center().gap_2();
    for (value, label) in [(0i64, "Bình yên"), (1, "Dễ"), (2, "Thường"), (3, "Khó")] {
        let active = app.instance_ui.world_difficulty == value;
        let view = view_difficulty.clone();
        difficulty_row = difficulty_row.child(
            div()
                .id(gpui::SharedString::from(format!("world-diff-{value}")))
                .h(px(28.0))
                .px(px(10.0))
                .flex()
                .items_center()
                .rounded(px(6.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .text_size(px(TEXT_XS))
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.instance_ui.world_difficulty = value;
                        cx.notify();
                    });
                })
                .child(label.to_string()),
        );
    }

    let toggle = |key: &'static str,
                  label: &'static str,
                  active: bool,
                  view: gpui::WeakEntity<LauncherApp>,
                  hardcore: bool| {
        let theme = theme.clone();
        div()
            .id(gpui::SharedString::from(format!("world-toggle-{key}")))
            .flex()
            .items_center()
            .justify_between()
            .gap_4()
            .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child(label))
            .child(
                div()
                    .id(gpui::SharedString::from(format!("world-switch-{key}")))
                    .w(px(40.0))
                    .h(px(22.0))
                    .rounded_full()
                    .bg(if active { theme.accent } else { theme.surface_active })
                    .p(px(3.0))
                    .flex()
                    .items_center()
                    .when(active, |el| el.justify_end())
                    .cursor_pointer()
                    .on_click(move |_, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            if hardcore {
                                this.instance_ui.world_hardcore = !this.instance_ui.world_hardcore;
                            } else {
                                this.instance_ui.world_cheats = !this.instance_ui.world_cheats;
                            }
                            cx.notify();
                        });
                    })
                    .child(div().size(px(16.0)).rounded_full().bg(gpui::white())),
            )
    };

    let content = div()
        .flex()
        .flex_col()
        .gap_4()
        .child(
            div()
                .flex()
                .items_start()
                .justify_between()
                .gap_3()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .child(div().text_size(px(TEXT_2XL)).font_weight(bold()).text_color(theme.text).child("Sửa thế giới"))
                        .child(
                            div()
                                .text_size(px(TEXT_SM))
                                .text_color(theme.muted)
                                .child(format!("saves/{folder} · level.dat sẽ được sao lưu trước khi ghi.")),
                        ),
                )
                .child(widgets::icon_button("world-close", "x", &theme, move |_, _, cx| {
                    let _ = view_close.update(cx, |this, cx| {
                        this.modal = Modal::None;
                        cx.notify();
                    });
                })),
        )
        .child(
            div()
                .flex()
                .gap_3()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .flex_1()
                        .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child("Tên thế giới"))
                        .child(widgets::text_input_box(&theme).child(app.name_input.clone())),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .flex_1()
                        .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child("Seed (số nguyên)"))
                        .child(widgets::text_input_box(&theme).child(app.memory_input.clone())),
                ),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap_2()
                .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child("Chế độ chơi"))
                .child(game_row)
                .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child("Độ khó"))
                .child(difficulty_row),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap_2()
                .child(toggle("hardcore", "Chế độ sinh tồn khó (hardcore)", app.instance_ui.world_hardcore, view_hardcore, true))
                .child(toggle("cheats", "Cho phép lệnh (cheats)", app.instance_ui.world_cheats, view_cheats, false)),
        )
        .child(
            div()
                .flex()
                .items_center()
                .justify_end()
                .gap_2()
                .child(widgets::ghost_button("world-cancel", "Huỷ", &theme, {
                    let view = cx.entity().downgrade();
                    move |_, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            this.modal = Modal::None;
                            cx.notify();
                        });
                    }
                }))
                .child(widgets::button("world-save", "Lưu thay đổi", &theme, true, move |_, _, cx| {
                    let _ = view_save.update(cx, |this, cx| {
                        let name = this.name_input.read(cx).text().trim().to_string();
                        let seed = this.memory_input.read(cx).text().trim().to_string();
                        let patch = json!({
                            "name": name,
                            "seed": seed,
                            "gameType": this.instance_ui.world_game_type,
                            "difficulty": this.instance_ui.world_difficulty,
                            "hardcore": this.instance_ui.world_hardcore,
                            "cheats": this.instance_ui.world_cheats,
                        });
                        let value = this.backend.world_settings_write(&id, &folder, patch);
                        if value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                            this.modal = Modal::None;
                            this.toast("ok", "Đã lưu thế giới", "level.dat được sao lưu thành .bak", cx);
                            this.load_worlds(cx);
                        } else {
                            this.toast("bad", "Lưu thế giới thất bại", value.get("error").and_then(serde_json::Value::as_str).unwrap_or(""), cx);
                        }
                    });
                })),
        );

    let backdrop = cx.entity().downgrade();
    modal_overlay(theme, 520.0, content, move |_, _, cx| {
        let _ = backdrop.update(cx, |this, cx| {
            this.modal = Modal::None;
            cx.notify();
        });
    })
}

pub fn modpack_update_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> impl IntoElement {
    let theme = app.theme.clone();
    let (id, versions, selected, current) = match &app.modal {
        Modal::ModpackUpdate { id, versions, selected, current } => (
            id.clone(),
            versions.clone(),
            selected.clone(),
            current.clone(),
        ),
        _ => (String::new(), Vec::new(), None, None),
    };
    let view_close = cx.entity().downgrade();
    let view_pick = cx.entity().downgrade();
    let view_install = cx.entity().downgrade();

    let mut rows = div().id("update-versions").flex().flex_col().gap(px(3.0)).max_h(px(360.0)).overflow_y_scroll()
        .on_scroll_wheel(|_, _, cx| cx.stop_propagation());
    if versions.is_empty() {
        rows = rows.child(
            div().p(px(12.0)).text_size(px(TEXT_SM)).text_color(theme.faint).child("Không có phiên bản nào."),
        );
    }
    for version in versions.iter().take(80).cloned().collect::<Vec<_>>() {
        let version_id = version.get("id").and_then(serde_json::Value::as_str).unwrap_or("").to_string();
        let number = version
            .get("versionNumber")
            .and_then(serde_json::Value::as_str)
            .or_else(|| version.get("name").and_then(serde_json::Value::as_str))
            .unwrap_or("")
            .to_string();
        let name = version.get("name").and_then(serde_json::Value::as_str).unwrap_or("").to_string();
        let game = version
            .get("gameVersions")
            .and_then(serde_json::Value::as_array)
            .map(|rows| rows.iter().filter_map(serde_json::Value::as_str).take(3).collect::<Vec<_>>().join(", "))
            .unwrap_or_default();
        let loaders = version
            .get("loaders")
            .and_then(serde_json::Value::as_array)
            .map(|rows| rows.iter().filter_map(serde_json::Value::as_str).collect::<Vec<_>>().join(", "))
            .unwrap_or_default();
        let date = version.get("datePublished").and_then(serde_json::Value::as_str).unwrap_or("");
        let is_current = current.as_deref() == Some(version_id.as_str());
        let active = selected.as_deref() == Some(version_id.as_str());
        let view = view_pick.clone();
        rows = rows.child(
            div()
                .id(gpui::SharedString::from(format!("update-ver-{version_id}")))
                .flex()
                .items_center()
                .gap_3()
                .p(px(10.0))
                .rounded(px(RADIUS_SM))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .cursor_pointer()
                .hover(|s| s.bg(theme.surface_hover))
                .on_click(move |_, _, cx| {
                    let version_id = version_id.clone();
                    let _ = view.update(cx, |this, cx| {
                        if let Modal::ModpackUpdate { selected, .. } = &mut this.modal {
                            *selected = Some(version_id.clone());
                        }
                        cx.notify();
                    });
                })
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w(px(0.0))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(div().text_size(px(TEXT_SM)).font_weight(semibold()).text_color(theme.text).child(number.clone()))
                                .when(is_current, |el| el.child(widgets::tag("Đang dùng", theme.info, &theme))),
                        )
                        .when(name != number && !name.is_empty(), |el| {
                            el.child(div().text_size(px(10.0)).text_color(theme.faint).truncate().child(name))
                        })
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(theme.faint)
                                .child(format!("{game} · {loaders} · {}", short_time(date))),
                        ),
                )
                .child(widgets::icon(
                    if active { "check-circle" } else { "circle" },
                    15.0,
                    if active { theme.accent_soft } else { theme.faint },
                )),
        );
    }

    let pill = div()
        .flex()
        .items_center()
        .gap_2()
        .text_size(px(TEXT_XS))
        .text_color(theme.faint)
        .child(widgets::icon("info", 13.0, theme.faint))
        .child("Chỉ cập nhật khi Minecraft và loader không đổi. Cấu hình được giữ nguyên.");

    let content = div()
        .flex()
        .flex_col()
        .gap_4()
        .child(
            div()
                .flex()
                .items_start()
                .justify_between()
                .gap_3()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .child(div().text_size(px(TEXT_2XL)).font_weight(bold()).text_color(theme.text).child("Cập nhật modpack"))
                        .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child("Chọn phiên bản mới để tải các tệp còn thiếu và thay tệp cũ.")),
                )
                .child(widgets::icon_button("update-close", "x", &theme, move |_, _, cx| {
                    let _ = view_close.update(cx, |this, cx| {
                        this.modal = Modal::None;
                        cx.notify();
                    });
                })),
        )
        .child(rows)
        .child(pill)
        .child(
            div()
                .flex()
                .items_center()
                .justify_end()
                .gap_2()
                .child(widgets::ghost_button("update-cancel", "Đóng", &theme, {
                    let view = cx.entity().downgrade();
                    move |_, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            this.modal = Modal::None;
                            cx.notify();
                        });
                    }
                }))
                .child(widgets::button("update-run", "Cập nhật", &theme, true, move |_, _, cx| {
                    let _ = view_install.update(cx, |this, cx| {
                        let selected = match &this.modal {
                            Modal::ModpackUpdate { selected, .. } => selected.clone(),
                            _ => None,
                        };
                        let Some(selected) = selected else {
                            this.toast("warn", "Chọn phiên bản", "Hãy chọn một phiên bản modpack.", cx);
                            return;
                        };
                        this.modal = Modal::None;
                        this.instance_ui.modpack_busy = true;
                        let id = id.clone();
                        let rx = this.backend.modpack_update(id.clone(), selected);
                        this.on_result(cx, rx, move |this, value, cx| {
                            this.instance_ui.modpack_busy = false;
                            if value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                                this.refresh_instances();
                                this.load_instance_tab(cx);
                                let version = value.get("version").and_then(serde_json::Value::as_str).unwrap_or("");
                                this.toast("ok", "Đã cập nhật modpack", version.to_string(), cx);
                            } else {
                                this.toast("bad", "Cập nhật thất bại", value.get("error").and_then(serde_json::Value::as_str).unwrap_or(""), cx);
                            }
                        });
                    });
                })),
        );

    let backdrop = cx.entity().downgrade();
    modal_overlay(theme, 640.0, content, move |_, _, cx| {
        let _ = backdrop.update(cx, |this, cx| {
            this.modal = Modal::None;
            cx.notify();
        });
    })
}


fn delete_instance_content(
    app: &mut LauncherApp,
    theme: &Theme,
    id: String,
    cx: &mut Context<LauncherApp>,
) -> AnyElement {
    use gpui::AnimationExt;
    let instance = app.instances.iter().find(|item| item.id == id).cloned();
    let name = if app.delete_name.is_empty() {
        instance.as_ref().map(|item| item.name.clone()).unwrap_or_default()
    } else {
        app.delete_name.clone()
    };
    let meta = instance
        .map(|item| format!("{} · {}", item.version, item.loader))
        .unwrap_or_default();
    let typed = app.delete_text.clone();
    let matches = !name.is_empty() && typed == name;
    let typed_len = typed.chars().count();
    let mut letters = div().flex().gap(px(1.0));
    for (index, ch) in name.chars().enumerate() {
        let ok = index < typed_len && typed.chars().nth(index) == Some(ch);
        letters = letters.child(
            div()
                .text_size(px(15.0))
                .font_weight(FontWeight::BOLD)
                .text_color(if ok { theme.bad } else { theme.faint })
                .child(ch.to_string()),
        );
    }
    let input_box = widgets::text_input_box(theme).child(app.delete_input.clone());
    let shake = app.delete_shake;
    let input_el: AnyElement = if shake > 0 {
        input_box
            .with_animation(
                gpui::SharedString::from(format!("del-shake-{shake}")),
                gpui::Animation::new(std::time::Duration::from_millis(350)),
                |el, t| {
                    let dx = (t * std::f32::consts::TAU * 2.0).sin() * 4.0 * (1.0 - t);
                    el.left(px(dx))
                },
            )
            .into_any_element()
    } else {
        input_box.into_any_element()
    };
    let view = cx.entity().downgrade();
    let cancel_view = view.clone();
    let delete_view = view.clone();
    let confirm: AnyElement = if matches {
        div()
            .id("delete-confirm")
            .h(px(36.0))
            .px(px(14.0))
            .rounded(px(8.0))
            .bg(theme.bad)
            .text_color(gpui::rgb(0xffffff))
            .text_size(px(12.0))
            .font_weight(FontWeight::BOLD)
            .flex()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .on_click(move |_, _, cx| {
                let id = id.clone();
                let _ = delete_view.update(cx, |this, cx| {
                    let value = this.backend.remove_instance(&id, true);
                    this.modal = Modal::None;
                    this.delete_text.clear();
                    this.delete_name.clear();
                    this.delete_shake = 0;
                    let input = this.delete_input.clone();
                    input.update(cx, |input, cx| input.clear(cx));
                    if value
                        .get("ok")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false)
                    {
                        this.refresh_instances();
                        this.toast(
                            "ok",
                            "Đã xoá hoàn toàn",
                            "Toàn bộ tệp game đã bị xoá khỏi đĩa.",
                            cx,
                        );
                    } else {
                        this.toast("bad", "Xoá thất bại", "Không xoá được phiên bản.", cx);
                    }
                    cx.notify();
                });
            })
            .child("Xoá vĩnh viễn")
            .into_any_element()
    } else {
        div()
            .h(px(36.0))
            .px(px(14.0))
            .rounded(px(8.0))
            .bg(theme.elevated)
            .text_color(theme.faint)
            .text_size(px(12.0))
            .font_weight(FontWeight::BOLD)
            .flex()
            .items_center()
            .justify_center()
            .child("Xoá vĩnh viễn")
            .into_any_element()
    };
    div()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .child(
            div()
                .text_size(px(16.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.text)
                .child("Xoá phiên bản"),
        )
        .child(
            div()
                .text_size(px(11.5))
                .text_color(theme.muted)
                .child("Phiên bản này và toàn bộ tệp game sẽ bị xoá khỏi đĩa. Không thể hoàn tác."),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(10.0))
                .p(px(10.0))
                .rounded(px(14.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border_soft)
                .child(
                    div()
                        .size(px(38.0))
                        .rounded(px(10.0))
                        .bg(theme.surface_active)
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(widgets::icon("cube", 20.0, theme.accent_soft)),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .min_w(px(0.0))
                        .child(
                            div()
                                .text_size(px(13.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(theme.text)
                                .truncate()
                                .child(name.clone()),
                        )
                        .child(div().text_size(px(10.0)).text_color(theme.faint).child(meta)),
                ),
        )
        .child(
            div()
                .p(px(10.0))
                .rounded(px(14.0))
                .border_1()
                .border_color(theme.bad)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.0))
                        .child(widgets::icon("warning", 13.0, theme.bad))
                        .child(
                            div()
                                .text_size(px(11.5))
                                .font_weight(FontWeight::BOLD)
                                .text_color(theme.bad)
                                .child("Vùng nguy hiểm"),
                        ),
                )
                .child(
                    div()
                        .mt(px(4.0))
                        .text_size(px(10.5))
                        .text_color(theme.muted)
                        .child("Nhập chính xác tên bên dưới để xác nhận."),
                ),
        )
        .child(letters)
        .child(input_el)
        .child(
            div()
                .flex()
                .justify_end()
                .gap(px(8.0))
                .child(widgets::ghost_button(
                    "delete-cancel",
                    "Huỷ",
                    theme,
                    move |_, _, cx| {
                        let _ = cancel_view.update(cx, |this, cx| {
                            this.modal = Modal::None;
                            this.delete_text.clear();
                            this.delete_name.clear();
                            cx.notify();
                        });
                    },
                ))
                .child(confirm),
        )
        .into_any_element()
}

pub fn confirm_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let (title, message) = match &app.modal {
        Modal::Confirm { title, message, .. } => (title.clone(), message.clone()),
        _ => (String::new(), String::new()),
    };
    let view = cx.entity().downgrade();
    let close_view = view.clone();
    let backdrop_view = view.clone();
    let delete_id = match &app.modal {
        Modal::Confirm {
            action: ConfirmAction::DeleteInstance(id),
            ..
        } => Some(id.clone()),
        _ => None,
    };
    if let Some(id) = delete_id {
        let content = delete_instance_content(app, &theme, id, cx);
        return modal_overlay(theme.clone(), 440.0, content, move |_, _, cx| {
            let _ = backdrop_view.update(cx, |this, cx| {
                this.modal = Modal::None;
                cx.notify();
            });
        })
        .into_any_element();
    }
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
                .text_size(px(TEXT_BASE))
                .text_color(theme.muted)
                .child(message),
        )
        .child(
            div()
                .flex()
                .justify_end()
                .gap_2()
                .child(widgets::ghost_button("confirm-cancel", "Huỷ", &theme, move |_, _, cx| {
                    let _ = close_view.update(cx, |this, cx| {
                        this.modal = Modal::None;
                        cx.notify();
                    });
                }))
                .child(widgets::button("confirm-ok", "Đồng ý", &theme, true, move |_, _, cx| {
                    let _ = view.update(cx, |this, cx| this.run_confirm(cx));
                })),
        );
    modal_overlay(theme.clone(), 440.0, content, move |_, _, cx| {
        let _ = backdrop_view.update(cx, |this, cx| {
            this.modal = Modal::None;
            cx.notify();
        });
    })
    .into_any_element()
}

pub fn hide_launcher_window() {
    #[cfg(windows)]
    unsafe {
        use windows::core::PCWSTR;
        use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, ShowWindow, SW_HIDE};
        if let Ok(hwnd) = FindWindowW(PCWSTR::null(), windows::core::w!("XyoLauncher")) {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
    }
}

pub fn show_launcher_window() {
    #[cfg(windows)]
    unsafe {
        use windows::core::PCWSTR;
        use windows::Win32::UI::WindowsAndMessaging::{
            FindWindowW, SW_RESTORE, SW_SHOW, SetForegroundWindow, ShowWindow,
        };
        if let Ok(hwnd) = FindWindowW(PCWSTR::null(), windows::core::w!("XyoLauncher")) {
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

pub fn status_text(status: &str) -> &'static str {
    match status {
        "running" => "Đang chơi",
        "starting" => "Đang khởi động",
        "stopping" => "Đang dừng",
        "installing" => "Đang cài",
        "error" => "Lỗi",
        _ => "Sẵn sàng",
    }
}

impl LauncherApp {
    pub fn run_confirm(&mut self, cx: &mut Context<Self>) {
        let action = match &self.modal {
            Modal::Confirm { action, .. } => action.clone(),
            _ => return,
        };
        match action {
            ConfirmAction::DeleteInstance(id) => {
                let value = self.backend.remove_instance(&id, true);
                if value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                    self.refresh_instances();
                    self.toast("ok", "Đã xoá phiên bản", "Toàn bộ tệp game đã bị xoá khỏi đĩa.", cx);
                }
            }
            ConfirmAction::TrashFile(id, rel) => {
                let value = self.backend.trash_files(&id, vec![rel]);
                if value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                    self.load_instance_tab(cx);
                    self.toast("ok", "Đã chuyển vào thùng rác", "", cx);
                }
            }
            ConfirmAction::PurgeTrash(id, ids) => {
                self.backend.purge_trash(&id, ids);
                self.load_instance_tab(cx);
                self.toast("ok", "Đã dọn thùng rác", "", cx);
            }
            ConfirmAction::ScheduleDelete(server_id, schedule_id) => {
                let value = self.backend.servers();
                if let Some(entry) = value
                    .get("servers")
                    .and_then(serde_json::Value::as_array)
                    .and_then(|rows| {
                        rows.iter().find(|row| {
                            row.get("id").and_then(serde_json::Value::as_str) == Some(server_id.as_str())
                        })
                    })
                    .cloned()
                {
                    let mut schedules = entry
                        .get("schedules")
                        .and_then(serde_json::Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    schedules.retain(|row| {
                        row.get("id").and_then(serde_json::Value::as_str) != Some(schedule_id.as_str())
                    });
                    self.backend.server_update(&server_id, json!({"schedules": schedules.clone()}));
                    self.server_ui.schedules = schedules;
                    self.toast("ok", "Đã xoá lịch", "", cx);
                }
            }
            ConfirmAction::ServerDelete(id) => {
                let value = self.backend.server_remove(&id, true);
                if value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                    self.load_servers(cx);
                    self.server_ui.selected = None;
                    self.toast("ok", "Đã xoá server", "Thư mục server được chuyển vào thùng rác.", cx);
                }
            }
            ConfirmAction::RemoveAccount(id) => {
                let value = self.backend.account_remove(&id);
                if value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                    self.refresh_accounts();
                    self.toast("ok", "Đã xoá tài khoản", "", cx);
                }
            }
        }
        self.modal = Modal::None;
        cx.notify();
    }

    pub fn play_instance(&mut self, id: &str, cx: &mut Context<Self>) {
        self.launch_instance_with(id, serde_json::Value::Null, cx);
    }

    pub fn play_instance_quick(&mut self, id: &str, quick: serde_json::Value, cx: &mut Context<Self>) {
        self.launch_instance_with(id, quick, cx);
    }

    fn launch_instance_with(&mut self, id: &str, quick: serde_json::Value, cx: &mut Context<Self>) {
        let Some(instance) = self.instances.iter().find(|i| i.id == id) else {
            return;
        };
        let busy = instance.running || matches!(instance.status.as_str(), "running" | "starting" | "stopping");
        let installing = instance.status == "installing";
        if busy {
            self.backend.stop_instance(id.to_string());
            self.toast("info", "Đang dừng game", "", cx);
            return;
        }
        if installing {
            self.toast("warn", "Đang cài đặt", "Chờ cài xong rồi chơi.", cx);
            return;
        }
        let opts = if quick.is_null() {
            json!({"id": id})
        } else {
            json!({"id": id, "quickPlay": quick})
        };
        let rx = self.backend.launch(opts);
        self.launch_errors.remove(id);
        self.toast("info", "Đang khởi chạy", "Chuẩn bị Java và kiểm tra tệp game…", cx);
        let launch_id = id.to_string();
        self.on_result(cx, rx, move |this, value, cx| {
            if !value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                let error = value
                    .get("error")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("Không khởi chạy được");
                this.launch_errors.insert(launch_id.clone(), error.to_string());
                this.toast("bad", "Khởi chạy thất bại", error.to_string(), cx);
            }
        });
    }

    pub fn instance_card(&self, instance: &Instance, cx: &Context<Self>, compact: bool) -> AnyElement {
        let theme = self.theme.clone();
        let view = cx.entity().downgrade();
        let view_play = view.clone();
        let view_settings = view.clone();
        let icon_path = self.instance_icon_path(instance);
        let has_icon = icon_path.is_some();
        let running = instance.running
            || matches!(instance.status.as_str(), "running" | "starting" | "stopping");
        let installing = instance.status == "installing";
        let progress = self.instance_progress(&instance.id);
        let id = instance.id.clone();
        let open_id = id.clone();
        let play_id = id.clone();
        let settings_id = id.clone();
        let loader_label = match instance.loader.as_str() {
            "vanilla" => "Vanilla".to_string(),
            "fabric" => "Fabric".into(),
            "quilt" => "Quilt".into(),
            "forge" => "Forge".into(),
            "neoforge" => "NeoForge".into(),
            "lunar" => "LunarLoader".into(),
            other => other.to_string(),
        };
        let status_color = if running {
            theme.ok
        } else if instance.status == "error" {
            theme.bad
        } else if installing {
            theme.warn
        } else {
            theme.faint
        };
        let status_label = match instance.status.as_str() {
            "running" => "Đang chơi",
            "starting" => "Đang khởi động",
            "stopping" => "Đang dừng",
            "installing" => "Đang cài",
            "error" => "Lỗi",
            _ => "Sẵn sàng",
        };

        let mut card = div()
            .id(SharedString::from(format!("inst-{}", instance.id)))
            .flex()
            .flex_col()
            .gap(px(12.0))
            .p(px(16.0))
            .w_full()
            .rounded(px(RADIUS_LG))
            .bg(theme.surface)
            .border_1()
            .border_color(theme.border_soft)
            .cursor_pointer()
            .hover(|s| s.bg(theme.surface_hover).border_color(theme.border))
            .on_click(move |_, _, cx| {
                let _ = view.update(cx, |this, cx| this.open_instance(open_id.clone(), cx));
            });

        let head = div()
            .flex()
            .items_center()
            .gap_3()
            .child(
                div()
                    .size(px(if compact { 40.0 } else { 48.0 }))
                    .rounded(px(11.0))
                    .bg(theme.surface_active)
                    .flex()
                    .items_center()
                    .justify_center()
                    .truncate()
                    .when_some(icon_path, |el, path| {
                        el.child(
                            gpui::img(path)
                                .size(px(if compact { 40.0 } else { 48.0 }))
                                .object_fit(gpui::ObjectFit::Cover),
                        )
                    })
                    .when(!has_icon, |el| {
                        el.child(widgets::icon("cube", 22.0, theme.accent_soft))
                    }),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(3.0))
                    .flex_1()
                    .truncate()
                    .child(
                        div()
                            .text_size(px(TEXT_MD))
                            .font_weight(semibold())
                            .text_color(theme.text)
                            .truncate()
                            .child(instance.name.clone()),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .text_size(px(TEXT_SM))
                            .text_color(theme.muted)
                            .child(format!("Minecraft {}", instance.version))
                            .child(
                                div()
                                    .h(px(3.0))
                                    .w(px(3.0))
                                    .rounded_full()
                                    .bg(theme.faint),
                            )
                            .child(loader_label),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .child(
                        div()
                            .size(px(7.0))
                            .rounded_full()
                            .bg(status_color),
                    )
                    .child(
                        div()
                            .text_size(px(TEXT_XS))
                            .font_weight(medium())
                            .text_color(status_color)
                            .child(status_label),
                    ),
            );

        card = card.child(head);

        if let Some((label, percent, indeterminate, _phase)) = progress {
            card = card.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div()
                            .flex()
                            .justify_between()
                            .text_size(px(TEXT_XS))
                            .text_color(theme.muted)
                            .child(if label.is_empty() {
                                "Đang tải…".to_string()
                            } else {
                                label
                            })
                            .child(if indeterminate {
                                String::new()
                            } else {
                                format!("{percent:.0}%")
                            }),
                    )
                    .child(widgets::progress_bar(percent, &theme, indeterminate)),
            );
        }

        card = card.child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_2()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .text_size(px(TEXT_XS))
                        .text_color(theme.faint)
                        .child(format!("{} MB RAM", instance.memory_mb))
                        .child(if let Some(played) = instance.last_played.as_deref() {
                            format!("Chơi lần cuối {}", short_time(played))
                        } else {
                            "Chưa chơi".to_string()
                        }),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.0))
                        .child(
                            div()
                                .id(SharedString::from(format!("inst-play-{}", instance.id)))
                                .flex()
                                .items_center()
                                .gap_2()
                                .h(px(30.0))
                                .px(px(12.0))
                                .rounded(px(RADIUS_SM))
                                .bg(if running { theme.surface_active } else { theme.accent })
                                .text_color(if running { theme.text } else { gpui::white().into() })
                                .text_size(px(TEXT_SM))
                                .font_weight(semibold())
                                .cursor_pointer()
                                .hover(|s| s.opacity(0.9))
                                .on_click(move |_, _, cx| {
                                    let _ = view_play.update(cx, |this, cx| this.play_instance(&play_id, cx));
                                })
                                .child(widgets::icon(
                                    if running { "stop-fill" } else { "play-fill" },
                                    13.0,
                                    if running { theme.text } else { gpui::white().into() },
                                ))
                                .child(if running { "Dừng" } else { "Chơi" }),
                        )
                        .child(
                            div()
                                .id(SharedString::from(format!("inst-settings-{}", instance.id)))
                                .flex()
                                .items_center()
                                .justify_center()
                                .size(px(30.0))
                                .rounded(px(RADIUS_SM))
                                .cursor_pointer()
                                .hover(|s| s.bg(theme.surface_active))
                                .on_click(move |_, _, cx| {
                                    let id = settings_id.clone();
                                    let _ = view_settings.update(cx, |this, cx| {
                                        this.open_instance(id.clone(), cx);
                                        this.instance_tab = crate::ui::app::InstanceTab::Settings;
                                        this.load_instance_tab(cx);
                                        cx.notify();
                                    });
                                })
                                .child(widgets::icon("gear-six", 15.0, theme.muted)),
                        ),
                ),
        );
        card.into_any_element()
    }
}

pub fn short_time(iso: &str) -> String {
    let Ok(date) = chrono::DateTime::parse_from_rfc3339(iso) else {
        return iso.to_string();
    };
    let now = chrono::Utc::now();
    let delta = now.signed_duration_since(date.with_timezone(&chrono::Utc));
    if delta.num_minutes() < 1 {
        "vừa xong".into()
    } else if delta.num_minutes() < 60 {
        format!("{} phút trước", delta.num_minutes())
    } else if delta.num_hours() < 24 {
        format!("{} giờ trước", delta.num_hours())
    } else if delta.num_days() < 30 {
        format!("{} ngày trước", delta.num_days())
    } else {
        date.format("%d/%m/%Y").to_string()
    }
}

pub fn toast_local(app: &mut LauncherApp, tone: &'static str, title: &str, message: &str, cx: &mut Context<LauncherApp>) {
    app.toast_seq += 1;
    app.toasts.push(Toast {
        id: app.toast_seq,
        tone,
        title: title.to_string(),
        message: message.to_string(),
    });
    let id = app.toast_seq;
    cx.spawn(async move |this, cx| {
        cx.background_executor()
            .timer(std::time::Duration::from_secs(5))
            .await;
        let _ = this.update(cx, |this, cx| {
            this.toasts.retain(|t| t.id != id);
            cx.notify();
        });
    })
    .detach();
}

pub fn crash_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> impl IntoElement {
    let theme = app.theme.clone();
    let crash = app.crash.clone().unwrap_or(serde_json::Value::Null);
    let title = crash
        .get("title")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("Game gặp lỗi")
        .to_string();
    let hint = crash
        .get("hint")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let cause = crash
        .get("cause")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let close_view = cx.entity().downgrade();
    let close_view2 = close_view.clone();
    let upload_view = cx.entity().downgrade();
    let content = div()
        .flex()
        .flex_col()
        .gap_4()
        .child(
            div()
                .flex()
                .items_center()
                .gap_3()
                .child(
                    div()
                        .size(px(40.0))
                        .rounded(px(11.0))
                        .bg(theme.surface_active)
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(widgets::icon("warning-octagon", 20.0, theme.bad)),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .text_size(px(TEXT_XL))
                                .font_weight(semibold())
                                .text_color(theme.text)
                                .child(title),
                        )
                        .child(
                            div()
                                .text_size(px(TEXT_SM))
                                .text_color(theme.muted)
                                .child("Minecraft vừa thoát với lỗi."),
                        ),
                ),
        )
        .when(!hint.is_empty(), |el| {
            el.child(
                div()
                    .p(px(12.0))
                    .rounded(px(RADIUS_SM))
                    .bg(theme.surface)
                    .border_1()
                    .border_color(theme.border_soft)
                    .text_size(px(TEXT_SM))
                    .text_color(theme.muted)
                    .child(hint),
            )
        })
        .when(!cause.is_empty(), |el| {
            el.child(
                div()
                    .id("crash-cause")
                    .max_h(px(160.0))
                    .overflow_y_scroll()
                    .on_scroll_wheel(|_, _, cx| cx.stop_propagation())
                    .p(px(10.0))
                    .rounded(px(RADIUS_SM))
                    .bg(if theme.dark { gpui::rgb(0x07090c) } else { gpui::rgb(0xf7f8fa) })
                    .border_1()
                    .border_color(theme.border_soft)
                    .text_size(px(11.0))
                    .font_family(MONO)
                    .text_color(theme.bad)
                    .child(cause),
            )
        })
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(widgets::ghost_button("crash-upload", "Gửi log cho XyoLauncher", &theme, move |_, _, cx| {
                    let _ = upload_view.update(cx, |this, cx| {
                        let text = this
                            .selected_instance
                            .as_ref()
                            .map(|id| this.logs.get(id).cloned().unwrap_or_default().join("\n"))
                            .unwrap_or_default();
                        if text.is_empty() {
                            this.toast("warn", "Chưa có log", "Chạy lại game để có log rồi thử lại.", cx);
                            return;
                        }
                        let rx = this.backend.upload_log_req(text);
                        this.on_result(cx, rx, |this, value, cx| {
                            if let Some(url) = value.get("url").and_then(serde_json::Value::as_str) {
                                let _ = open::that(url);
                                this.toast("ok", "Đã gửi log", url.to_string(), cx);
                            } else {
                                this.toast(
                                    "bad",
                                    "Gửi log thất bại",
                                    value.get("error").and_then(serde_json::Value::as_str).unwrap_or(""),
                                    cx,
                                );
                            }
                        });
                    });
                }))
                .child(widgets::button("crash-close", "Đóng", &theme, true, move |_, _, cx| {
                    let _ = close_view.update(cx, |this, cx| {
                        this.crash = None;
                        cx.notify();
                    });
                })),
        );
    modal_overlay(theme, 560.0, content, move |_, _, cx| {
        let _ = close_view2.update(cx, |this, cx| {
            this.crash = None;
            cx.notify();
        });
    })
}
