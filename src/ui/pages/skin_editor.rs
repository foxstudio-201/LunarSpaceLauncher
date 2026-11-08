use crate::mc::skin3d;
use crate::ui::app::LauncherApp;
use crate::ui::theme::*;
use crate::ui::widgets;
use gpui::{AnyElement, Context, FontWeight, IntoElement, Window, div, prelude::*, px};
use std::cell::RefCell;
use std::rc::Rc;

pub fn ensure(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    let Some(first) = app
        .accounts
        .iter()
        .find(|account| account.kind == "offline")
        .cloned()
    else {
        return;
    };
    let valid = app
        .accounts
        .iter()
        .any(|account| account.kind == "offline" && account.uuid == app.skin_ui.uuid);
    if !valid {
        app.skin_ui.uuid = first.uuid;
        app.skin_ui.loaded_uuid.clear();
    }
    if app.skin_ui.loaded_uuid != app.skin_ui.uuid {
        app.load_skin_editor(cx);
    }
}

fn swatch(hex: &str) -> gpui::Rgba {
    let hex = hex.trim_start_matches('#');
    let r = u8::from_str_radix(hex.get(0..2).unwrap_or("E9"), 16).unwrap_or(233);
    let g = u8::from_str_radix(hex.get(2..4).unwrap_or("B8"), 16).unwrap_or(184);
    let b = u8::from_str_radix(hex.get(4..6).unwrap_or("72"), 16).unwrap_or(114);
    gpui::rgb((r as u32) << 16 | (g as u32) << 8 | b as u32)
}

fn small_chip(
    theme: &Theme,
    id: String,
    label: String,
    active: bool,
    width: Option<f32>,
    view: gpui::WeakEntity<LauncherApp>,
    action: impl Fn(&mut LauncherApp, &mut Context<LauncherApp>) + 'static,
) -> AnyElement {
    let action = std::rc::Rc::new(action);
    div()
        .id(gpui::SharedString::from(id))
        .when_some(width, |el, width| el.w(px(width)))
        .h(px(26.0))
        .px(px(7.0))
        .rounded(px(5.0))
        .bg(if active { theme.accent_dim } else { theme.elevated })
        .border_1()
        .border_color(if active { theme.accent } else { theme.border_soft })
        .flex()
        .items_center()
        .justify_center()
        .text_size(px(9.5))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(if active { theme.accent_soft } else { theme.muted })
        .cursor_pointer()
        .on_click(move |_, _, cx| {
            let action = action.clone();
            let _ = view.update(cx, |this, cx| {
                action(this, cx);
                cx.notify();
            });
        })
        .child(label)
        .into_any_element()
}

pub fn render(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let name = app
        .accounts
        .iter()
        .find(|account| account.uuid == app.skin_ui.uuid)
        .map(|account| account.name.clone())
        .unwrap_or_else(|| "—".into());
    let asset = app.skin_ui.paint_asset.clone();
    let tool = app.skin_ui.paint_tool.clone();
    let color = app.skin_ui.paint_color.clone();
    let alpha = app.skin_ui.paint_alpha;
    let brush = app.skin_ui.paint_brush;
    let mirror = app.skin_ui.paint_mirror.clone();
    let model = app.skin_ui.model.clone();
    let layer = app.skin_ui.paint_layer.clone();
    let outer = app.skin_ui.paint_outer;
    let hidden = app.skin_ui.paint_hidden.clone();
    let preview = app.paint_preview.clone();
    let mode = if app.skin_ui.editor_mode.is_empty() {
        "draw".to_string()
    } else {
        app.skin_ui.editor_mode.clone()
    };
    let tools_open = app.skin_ui.tools_open;
    let colors_open = app.skin_ui.colors_open;
    let settings_open = app.skin_ui.settings_open;

    // Header
    let view_back = view.clone();
    let view_mode = view.clone();
    let header = div()
        .w_full()
        .flex()
        .items_center()
        .gap(px(8.0))
        .p(px(10.0))
        .rounded(px(10.0))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft)
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .flex()
                .flex_col()
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.text)
                        .truncate()
                        .child(name),
                )
                .child(
                    div()
                        .text_size(px(9.5))
                        .text_color(theme.faint)
                        .child(format!(
                            "Skin · {} · {} · skin 64×64 / cape 64×32",
                            if model == "slim" { "Slim" } else { "Classic" },
                            if asset == "cape" { "Cape" } else { "Skin" }
                        )),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(2.0))
                .p(px(2.0))
                .rounded(px(7.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border)
                .children([("draw", "Vẽ"), ("upload", "Tải lên")].into_iter().map(|(key, label)| {
                    let view = view_mode.clone();
                    let key_owned = key.to_string();
                    let active = mode == key;
                    div()
                        .id(gpui::SharedString::from(format!("skin-mode-{key}")))
                        .h(px(26.0))
                        .px(px(10.0))
                        .rounded(px(5.0))
                        .flex()
                        .items_center()
                        .text_size(px(10.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(if active { theme.on_accent } else { theme.muted })
                        .when(active, |el| el.bg(theme.accent))
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let key = key_owned.clone();
                            let _ = view.update(cx, |this, cx| {
                                this.skin_ui.editor_mode = key;
                                cx.notify();
                            });
                        })
                        .child(label)
                })),
        )
        .child(
            div()
                .id("skin-back")
                .h(px(30.0))
                .px(px(10.0))
                .rounded(px(6.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border)
                .flex()
                .items_center()
                .gap(px(5.0))
                .text_size(px(10.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text)
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view_back.update(cx, |this, cx| {
                        this.accounts_tab = "list".into();
                        cx.notify();
                    });
                })
                .child(widgets::icon("arrow-left", 12.0, theme.muted))
                .child("Danh sách"),
        );

    if mode == "upload" {
        let view_skin = view.clone();
        let view_cape = view.clone();
        let upload_card = |label: &str,
                           hint: &str,
                           view: gpui::WeakEntity<LauncherApp>,
                           cape: bool| {
            div()
                .id(gpui::SharedString::from(format!("skin-upload-{cape}")))
                .flex_1()
                .min_h(px(150.0))
                .p(px(18.0))
                .rounded(px(12.0))
                .bg(theme.surface)
                .border_2()
                .border_color(theme.border)
                .flex()
                .flex_col()
                .justify_between()
                .gap(px(10.0))
                .cursor_pointer()
                .hover(|style| style.border_color(theme.accent))
                .on_click(move |_, _, cx| {
                    let view = view.clone();
                    cx.spawn(async move |cx| {
                        let picked = rfd::AsyncFileDialog::new()
                            .add_filter("PNG", &["png"])
                            .pick_file()
                            .await;
                        if let Some(file) = picked {
                            let path = file.path().to_path_buf();
                            let _ = view.update(cx, |this, cx| {
                                if let Ok(image) = image::open(&path) {
                                    let image = image.to_rgba8();
                                    let ok = if cape {
                                        image.width() == 64 && image.height() == 32
                                    } else {
                                        image.width() == 64 && image.height() == 64
                                    };
                                    if ok {
                                        this.paint_begin_stroke();
                                        if cape {
                                            this.skin_ui.paint_cape = image.into_raw();
                                            this.skin_ui.paint_asset = "cape".into();
                                        } else {
                                            this.skin_ui.paint_skin = image.into_raw();
                                            this.skin_ui.paint_asset = "skin".into();
                                        }
                                        this.skin_ui.message = "Đã nạp tệp PNG".into();
                                        this.refresh_paint_preview();
                                    } else {
                                        this.skin_ui.message = if cape {
                                            "Cape phải là PNG 64×32".into()
                                        } else {
                                            "Skin phải là PNG 64×64".into()
                                        };
                                    }
                                    cx.notify();
                                }
                            });
                        }
                    })
                    .detach();
                })
                .child(widgets::icon("upload", 24.0, theme.accent_soft))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(3.0))
                        .child(
                            div()
                                .text_size(px(12.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(theme.text)
                                .child(label.to_string()),
                        )
                        .child(
                            div()
                                .text_size(px(9.5))
                                .text_color(theme.muted)
                                .child(hint.to_string()),
                        ),
                )
                .into_any_element()
        };
        let upload = div()
            .flex_1()
            .min_h(px(0.0))
            .w_full()
            .p(px(18.0))
            .flex()
            .flex_col()
            .gap(px(12.0))
            .child(
                div()
                    .flex()
                    .gap(px(12.0))
                    .child(upload_card(
                        "Tải skin",
                        "PNG 64×64 — thay toàn bộ skin hiện tại",
                        view_skin,
                        false,
                    ))
                    .child(upload_card(
                        "Tải cape",
                        "PNG 64×32 — cape hiển thị phía sau lưng",
                        view_cape,
                        true,
                    )),
            )
            .child(
                div()
                    .text_size(px(9.5))
                    .text_color(theme.faint)
                    .child("Sau khi nạp tệp, chuyển sang tab Vẽ để chỉnh hoặc bấm Lưu skin & cape."),
            );
        return div()
            .flex()
            .flex_col()
            .gap(px(8.0))
            .w_full()
            .h_full()
            .min_h(px(0.0))
            .p(px(18.0))
            .child(header)
            .child(upload)
            .into_any_element();
    }

    // 3D surface
    let bounds: Rc<RefCell<Option<gpui::Bounds<gpui::Pixels>>>> = Rc::new(RefCell::new(None));
    let bounds_paint = bounds.clone();
    let bounds_down = bounds.clone();
    let bounds_move = bounds.clone();
    let view_down = view.clone();
    let view_move = view.clone();
    let view_up = view.clone();
    let view_up_out = view.clone();
    let surface = div()
        .on_children_prepainted(move |children_bounds, _, _| {
            if let Some(first) = children_bounds.first() {
                *bounds_paint.borrow_mut() = Some(*first);
            }
        })
        .id("skin-surface")
        .relative()
        .w(px(640.0))
        .h(px(560.0))
        .rounded(px(12.0))
        .overflow_hidden()
        .bg(theme.elevated)
        .border_1()
        .border_color(theme.border)
        .cursor_crosshair()
        .when_some(preview, |el, image| {
            el.child(gpui::img(image).absolute().inset_0().size_full())
        })
        .child(
            div()
                .absolute()
                .top(px(8.0))
                .right(px(8.0))
                .flex()
                .flex_col()
                .gap(px(3.0))
                .child({
                    let view = view.clone();
                    div()
                        .id("skin-zoom-in")
                        .size(px(24.0))
                        .rounded(px(5.0))
                        .bg(theme.surface)
                        .border_1()
                        .border_color(theme.border)
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(13.0))
                        .text_color(theme.muted)
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let _ = view.update(cx, |this, cx| {
                                this.skin_ui.paint_zoom = (this.skin_ui.paint_zoom + 0.15).min(2.6);
                                this.refresh_paint_preview();
                                cx.notify();
                            });
                        })
                        .child("+")
                })
                .child({
                    let view = view.clone();
                    div()
                        .id("skin-zoom-out")
                        .size(px(24.0))
                        .rounded(px(5.0))
                        .bg(theme.surface)
                        .border_1()
                        .border_color(theme.border)
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(13.0))
                        .text_color(theme.muted)
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let _ = view.update(cx, |this, cx| {
                                this.skin_ui.paint_zoom = (this.skin_ui.paint_zoom - 0.15).max(0.65);
                                this.refresh_paint_preview();
                                cx.notify();
                            });
                        })
                        .child("−")
                }),
        )
        .on_mouse_down(gpui::MouseButton::Left, move |event, _, cx| {
            let Some(point) = bounds_down
                .borrow()
                .as_ref()
                .and_then(|bounds| bounds.localize(&event.position))
            else {
                return;
            };
            let x = f32::from(point.x);
            let y = f32::from(point.y);
            let _ = view_down.update(cx, |this, cx| {
                this.update_loupe(x, y, cx);
                match this.skin_ui.paint_tool.as_str() {
                    "rotate" | "pan" => {
                        this.skin_ui.dragging = true;
                        this.skin_drag_x = x;
                        this.skin_ui.paint_drag_y = y;
                    }
                    _ => {
                        this.paint_begin_stroke();
                        this.skin_ui.paint_painting = true;
                        this.skin_ui.paint_last = None;
                        this.paint_screen(x, y, cx);
                        if this.skin_ui.paint_tool == "fill" || this.skin_ui.paint_tool == "picker" {
                            this.skin_ui.paint_painting = false;
                            this.skin_ui.paint_last = None;
                        }
                    }
                }
                cx.notify();
            });
        })
        .on_mouse_move(move |event, _, cx| {
            let Some(point) = bounds_move
                .borrow()
                .as_ref()
                .and_then(|bounds| bounds.localize(&event.position))
            else {
                return;
            };
            let x = f32::from(point.x);
            let y = f32::from(point.y);
            let _ = view_move.update(cx, |this, cx| {
                if this.skin_ui.dragging {
                    let dx = x - this.skin_drag_x;
                    let dy = y - this.skin_ui.paint_drag_y;
                    this.skin_drag_x = x;
                    this.skin_ui.paint_drag_y = y;
                    if this.skin_ui.paint_tool == "rotate" {
                        this.skin_ui.angle += dx * 0.012;
                        this.skin_ui.paint_pitch =
                            (this.skin_ui.paint_pitch + dy * 0.008).clamp(-1.1, 1.1);
                    } else {
                        this.skin_ui.paint_pan_x += dx;
                        this.skin_ui.paint_pan_y += dy;
                    }
                    this.refresh_paint_preview();
                    cx.notify();
                } else if this.skin_ui.paint_painting {
                    this.paint_screen(x, y, cx);
                } else {
                    this.update_loupe(x, y, cx);
                }
            });
        })
        .on_mouse_up(gpui::MouseButton::Left, move |_, _, cx| {
            let _ = view_up.update(cx, |this, cx| {
                this.skin_ui.paint_painting = false;
                this.skin_ui.dragging = false;
                this.skin_ui.paint_last = None;
                this.note_recent_color();
                cx.notify();
            });
        })
        .on_mouse_up_out(gpui::MouseButton::Left, move |_, _, cx| {
            let _ = view_up_out.update(cx, |this, cx| {
                this.skin_ui.paint_painting = false;
                this.skin_ui.dragging = false;
                this.skin_ui.paint_last = None;
                this.skin_ui.paint_loupe = None;
                cx.notify();
            });
        });

    // Tools panel
    let mut accounts_panel = div().flex().flex_col().gap(px(3.0));
    for account in app.accounts.iter().filter(|a| a.kind == "offline").cloned() {
        let active = account.uuid == app.skin_ui.uuid;
        let view = view.clone();
        let uuid = account.uuid.clone();
        let head = app.account_heads.get(&account.uuid).cloned();
        accounts_panel = accounts_panel.child(
            div()
                .id(gpui::SharedString::from(format!("editor-account-{}", account.id)))
                .h(px(32.0))
                .px(px(6.0))
                .rounded(px(6.0))
                .flex()
                .items_center()
                .gap(px(7.0))
                .bg(if active { theme.accent_dim } else { gpui::rgba(0x00000000) })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let uuid = uuid.clone();
                    let _ = view.update(cx, |this, cx| {
                        if this.skin_ui.uuid != uuid {
                            this.skin_ui.uuid = uuid;
                            this.load_skin_editor(cx);
                        }
                    });
                })
                .when_some(head, |el, path| {
                    el.child(
                        gpui::img(path)
                            .size(px(22.0))
                            .rounded(px(4.0))
                            .object_fit(gpui::ObjectFit::Cover),
                    )
                })
                .child(
                    div()
                        .flex_1()
                        .text_size(px(10.5))
                        .text_color(if active { theme.accent_soft } else { theme.text })
                        .truncate()
                        .child(account.name),
                ),
        );
    }
    let mut asset_row = div().flex().items_center().gap(px(4.0));
    for (key, label) in [("skin", "Skin"), ("cape", "Cape")] {
        let view = view.clone();
        let key = key.to_string();
        let active = asset == key;
        asset_row = asset_row.child(
            div()
                .id(gpui::SharedString::from(format!("editor-asset-{key}")))
                .flex_1()
                .h(px(28.0))
                .rounded(px(6.0))
                .flex()
                .items_center()
                .justify_center()
                .bg(if active { theme.accent } else { theme.elevated })
                .text_size(px(10.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(if active { theme.on_accent } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let key = key.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.skin_ui.paint_asset = key;
                        this.skin_ui.paint_last = None;
                        this.refresh_paint_preview();
                        cx.notify();
                    });
                })
                .child(label),
        );
    }
    let view_save = view.clone();
    let view_reset = view.clone();
    let view_tools = view.clone();
    let message = app.skin_ui.message.clone();
    let tools_panel = div()
        .absolute()
        .left(px(8.0))
        .top(px(8.0))
        .bottom(px(8.0))
        .w(px(286.0))
        .rounded(px(12.0))
        .bg(theme.bg)
        .border_1()
        .border_color(theme.border)
        .shadow_lg()
        .flex()
        .flex_col()
        .child(
            div()
                .h(px(34.0))
                .px(px(10.0))
                .flex()
                .items_center()
                .justify_between()
                .border_b_1()
                .border_color(theme.border_soft)
                .bg(theme.surface)
                .child(
                    div()
                        .text_size(px(9.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.muted)
                        .child("CÔNG CỤ"),
                )
                .child(
                    div()
                        .id("skin-tools-hide")
                        .size(px(20.0))
                        .rounded(px(4.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor_pointer()
                        .hover(|style| style.bg(theme.surface_hover))
                        .on_click(move |_, _, cx| {
                            let _ = view_tools.update(cx, |this, cx| {
                                this.skin_ui.tools_open = false;
                                cx.notify();
                            });
                        })
                        .child(widgets::icon("caret-left", 11.0, theme.faint)),
                ),
        )
        .child(
            div()
                .id("skin-tools-scroll")
                .flex_1()
                .min_h(px(0.0))
                .overflow_y_scroll()
                .p(px(10.0))
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(asset_row)
                .child(
                    div()
                        .text_size(px(8.5))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.faint)
                        .child("TÀI KHOẢN"),
                )
                .child(accounts_panel)
                .child(
                    div()
                        .id("editor-save")
                        .h(px(32.0))
                        .w_full()
                        .rounded(px(7.0))
                        .bg(theme.accent)
                        .flex()
                        .items_center()
                        .justify_center()
                        .gap(px(5.0))
                        .text_size(px(10.5))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.on_accent)
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let _ = view_save.update(cx, |this, cx| {
                                this.paint_save(cx);
                            });
                        })
                        .child(widgets::icon("floppy-disk", 12.0, theme.on_accent))
                        .child("Lưu skin & cape"),
                )
                .child(
                    div()
                        .id("editor-reset")
                        .h(px(30.0))
                        .w_full()
                        .rounded(px(7.0))
                        .bg(theme.elevated)
                        .border_1()
                        .border_color(theme.border_soft)
                        .flex()
                        .items_center()
                        .justify_center()
                        .gap(px(5.0))
                        .text_size(px(10.0))
                        .text_color(theme.bad)
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let _ = view_reset.update(cx, |this, cx| {
                                let uuid = this.skin_ui.uuid.clone();
                                if uuid.is_empty() {
                                    return;
                                }
                                this.backend.skin_remove(&uuid);
                                this.skin_ui.paint_skin = vec![0; 64 * 64 * 4];
                                this.skin_ui.paint_cape = vec![0; 64 * 32 * 4];
                                this.skin_ui.model = "classic".into();
                                this.skin_ui.message = "Đã xoá skin tuỳ chỉnh.".into();
                                this.refresh_paint_preview();
                                this.refresh_skin_preview();
                                this.refresh_accounts(cx);
                                cx.notify();
                            });
                        })
                        .child(widgets::icon("trash", 11.0, theme.bad))
                        .child("Xoá skin tuỳ chỉnh"),
                )
                .when(!message.is_empty(), |el| {
                    el.child(
                        div()
                            .text_size(px(9.0))
                            .text_color(theme.faint)
                            .child(message),
                    )
                }),
        );

    // Colour panel
    let palette = [
        "#ffffff", "#d4d4d8", "#a1a1aa", "#52525b", "#18181b", "#3b2412",
        "#7a4a20", "#c98b4b", "#e9b872", "#f2d49b", "#ef4444", "#f97316",
        "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#10b981", "#14b8a6",
        "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#d946ef", "#ec4899",
    ];
    let hex_input = app.paint_hex_input.clone();
    if app.skin_ui.paint_hex_sync != color {
        hex_input.update(cx, |input, cx| input.set_text(color.clone(), cx));
        app.skin_ui.paint_hex_sync = color.clone();
    }
    let recent_colors = app.skin_ui.paint_recent.clone();
    let mut palette_grid = div().flex().flex_wrap().gap(px(4.0));
    for hex in palette {
        let view = view.clone();
        let hex_value = hex.to_string();
        let active = color.eq_ignore_ascii_case(hex);
        palette_grid = palette_grid.child(
            div()
                .id(gpui::SharedString::from(format!("editor-color-{hex}")))
                .size(px(20.0))
                .rounded(px(4.0))
                .bg(swatch(hex))
                .border_2()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let hex = hex_value.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.skin_ui.paint_color = hex;
                        this.skin_ui.paint_alpha = 255;
                        if this.skin_ui.paint_tool == "eraser" || this.skin_ui.paint_tool == "picker" {
                            this.skin_ui.paint_tool = "pencil".into();
                        }
                        cx.notify();
                    });
                }),
        );
    }
    let mut recent_row = div().flex().flex_wrap().gap(px(4.0));
    for hex in recent_colors.iter().take(10) {
        let view = view.clone();
        let value = hex.clone();
        recent_row = recent_row.child(
            div()
                .id(gpui::SharedString::from(format!("recent-{hex}")))
                .size(px(18.0))
                .rounded(px(4.0))
                .bg(swatch(hex))
                .border_1()
                .border_color(theme.border_soft)
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let value = value.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.skin_ui.paint_color = value;
                        this.skin_ui.paint_alpha = 255;
                        this.note_recent_color();
                        cx.notify();
                    });
                }),
        );
    }
    let (hue, sat, val) = rgb_to_hsv(hex_rgb(&color));
    let sv_image = build_sv_image(hue, 198, 130);
    let hue_image = build_hue_image(198, 12);
    let alpha_image = build_alpha_image(&color, 198, 12);
    let sv_bounds: Rc<RefCell<Option<gpui::Bounds<gpui::Pixels>>>> =
        Rc::new(RefCell::new(None));
    let hue_bounds: Rc<RefCell<Option<gpui::Bounds<gpui::Pixels>>>> =
        Rc::new(RefCell::new(None));
    let alpha_bounds: Rc<RefCell<Option<gpui::Bounds<gpui::Pixels>>>> =
        Rc::new(RefCell::new(None));
    let sv_bounds_set = sv_bounds.clone();
    let hue_bounds_set = hue_bounds.clone();
    let alpha_bounds_set = alpha_bounds.clone();
    let sv_down = sv_bounds.clone();
    let hue_down = hue_bounds.clone();
    let alpha_down = alpha_bounds.clone();
    let sv_move = sv_bounds.clone();
    let hue_move = hue_bounds.clone();
    let alpha_move = alpha_bounds.clone();
    let sv_view_down = view.clone();
    let sv_view_move = view.clone();
    let hue_view_down = view.clone();
    let hue_view_move = view.clone();
    let alpha_view_down = view.clone();
    let alpha_view_move = view.clone();
    let sv_up = view.clone();
    let hue_up = view.clone();
    let alpha_up = view.clone();
    let sv_widget = div()
        .on_children_prepainted(move |children, _, _| {
            if let Some(first) = children.first() {
                *sv_bounds_set.borrow_mut() = Some(*first);
            }
        })
        .id("hsv-square")
        .relative()
        .w_full()
        .h(px(130.0))
        .rounded(px(7.0))
        .overflow_hidden()
        .border_1()
        .border_color(theme.border)
        .cursor_crosshair()
        .child(gpui::img(std::sync::Arc::new(gpui::RenderImage::new(vec![image::Frame::new(sv_image)]))).size_full())
        .on_mouse_down(gpui::MouseButton::Left, move |event, _, cx| {
            let Some(point) = sv_down
                .borrow()
                .as_ref()
                .and_then(|bounds| bounds.localize(&event.position))
            else {
                return;
            };
            let x = (f32::from(point.x) / 198.0).clamp(0.0, 1.0);
            let y = (f32::from(point.y) / 130.0).clamp(0.0, 1.0);
            let _ = sv_view_move.update(cx, |this, cx| {
                this.skin_ui.paint_color_drag = "sv".into();
                let (hue, _, _) = rgb_to_hsv(hex_rgb(&this.skin_ui.paint_color));
                let (r, g, b) = hsv_to_rgb(hue, x, 1.0 - y);
                this.skin_ui.paint_color = rgb_hex(r, g, b);
                if this.skin_ui.paint_tool == "eraser" || this.skin_ui.paint_tool == "picker" {
                    this.skin_ui.paint_tool = "pencil".into();
                }
                cx.notify();
            });
        })
        .on_mouse_move(move |event, _, cx| {
            let Some(point) = sv_move
                .borrow()
                .as_ref()
                .and_then(|bounds| bounds.localize(&event.position))
            else {
                return;
            };
            let x = (f32::from(point.x) / 198.0).clamp(0.0, 1.0);
            let y = (f32::from(point.y) / 130.0).clamp(0.0, 1.0);
            let _ = sv_view_down.update(cx, |this, cx| {
                if this.skin_ui.paint_color_drag != "sv" {
                    return;
                }
                let (hue, _, _) = rgb_to_hsv(hex_rgb(&this.skin_ui.paint_color));
                let (r, g, b) = hsv_to_rgb(hue, x, 1.0 - y);
                this.skin_ui.paint_color = rgb_hex(r, g, b);
                cx.notify();
            });
        })
        .on_mouse_up(gpui::MouseButton::Left, move |_, _, cx| {
            let _ = sv_up.update(cx, |this, cx| {
                this.skin_ui.paint_color_drag.clear();
                cx.notify();
            });
        });
    let hue_widget = div()
        .on_children_prepainted(move |children, _, _| {
            if let Some(first) = children.first() {
                *hue_bounds_set.borrow_mut() = Some(*first);
            }
        })
        .id("hue-slider")
        .relative()
        .w_full()
        .h(px(12.0))
        .rounded(px(4.0))
        .overflow_hidden()
        .border_1()
        .border_color(theme.border)
        .cursor_crosshair()
        .child(gpui::img(std::sync::Arc::new(gpui::RenderImage::new(vec![image::Frame::new(hue_image)]))).size_full())
        .on_mouse_down(gpui::MouseButton::Left, move |event, _, cx| {
            let Some(point) = hue_down
                .borrow()
                .as_ref()
                .and_then(|bounds| bounds.localize(&event.position))
            else {
                return;
            };
            let x = (f32::from(point.x) / 198.0).clamp(0.0, 1.0);
            let _ = hue_view_move.update(cx, |this, cx| {
                this.skin_ui.paint_color_drag = "hue".into();
                let (_, s, v) = rgb_to_hsv(hex_rgb(&this.skin_ui.paint_color));
                let (r, g, b) = hsv_to_rgb(x * 360.0, s, v);
                this.skin_ui.paint_color = rgb_hex(r, g, b);
                if this.skin_ui.paint_tool == "eraser" || this.skin_ui.paint_tool == "picker" {
                    this.skin_ui.paint_tool = "pencil".into();
                }
                cx.notify();
            });
        })
        .on_mouse_move(move |event, _, cx| {
            let Some(point) = hue_move
                .borrow()
                .as_ref()
                .and_then(|bounds| bounds.localize(&event.position))
            else {
                return;
            };
            let x = (f32::from(point.x) / 198.0).clamp(0.0, 1.0);
            let _ = hue_view_down.update(cx, |this, cx| {
                if this.skin_ui.paint_color_drag != "hue" {
                    return;
                }
                let (_, s, v) = rgb_to_hsv(hex_rgb(&this.skin_ui.paint_color));
                let (r, g, b) = hsv_to_rgb(x * 360.0, s, v);
                this.skin_ui.paint_color = rgb_hex(r, g, b);
                cx.notify();
            });
        })
        .on_mouse_up(gpui::MouseButton::Left, move |_, _, cx| {
            let _ = hue_up.update(cx, |this, cx| {
                this.skin_ui.paint_color_drag.clear();
                cx.notify();
            });
        });
    let alpha_widget = div()
        .on_children_prepainted(move |children, _, _| {
            if let Some(first) = children.first() {
                *alpha_bounds_set.borrow_mut() = Some(*first);
            }
        })
        .id("alpha-slider")
        .relative()
        .w_full()
        .h(px(12.0))
        .rounded(px(4.0))
        .overflow_hidden()
        .border_1()
        .border_color(theme.border)
        .cursor_crosshair()
        .child(gpui::img(std::sync::Arc::new(gpui::RenderImage::new(vec![image::Frame::new(alpha_image)]))).size_full())
        .on_mouse_down(gpui::MouseButton::Left, move |event, _, cx| {
            let Some(point) = alpha_down
                .borrow()
                .as_ref()
                .and_then(|bounds| bounds.localize(&event.position))
            else {
                return;
            };
            let x = (f32::from(point.x) / 198.0).clamp(0.0, 1.0);
            let _ = alpha_view_move.update(cx, |this, cx| {
                this.skin_ui.paint_color_drag = "alpha".into();
                this.skin_ui.paint_alpha = (x * 255.0).round() as u8;
                cx.notify();
            });
        })
        .on_mouse_move(move |event, _, cx| {
            let Some(point) = alpha_move
                .borrow()
                .as_ref()
                .and_then(|bounds| bounds.localize(&event.position))
            else {
                return;
            };
            let x = (f32::from(point.x) / 198.0).clamp(0.0, 1.0);
            let _ = alpha_view_down.update(cx, |this, cx| {
                if this.skin_ui.paint_color_drag != "alpha" {
                    return;
                }
                this.skin_ui.paint_alpha = (x * 255.0).round() as u8;
                cx.notify();
            });
        })
        .on_mouse_up(gpui::MouseButton::Left, move |_, _, cx| {
            let _ = alpha_up.update(cx, |this, cx| {
                this.skin_ui.paint_color_drag.clear();
                cx.notify();
            });
        });
    let view_colors = view.clone();
    let colors_panel = div()
        .absolute()
        .right(px(8.0))
        .top(px(8.0))
        .bottom(px(8.0))
        .w(px(218.0))
        .flex()
        .flex_col()
        .gap(px(8.0))
        .p(px(10.0))
        .rounded(px(12.0))
        .bg(theme.bg)
        .border_1()
        .border_color(theme.border)
        .shadow_lg()
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(9.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.muted)
                        .child("MÀU"),
                )
                .child(
                    div()
                        .id("skin-colors-hide")
                        .size(px(20.0))
                        .rounded(px(4.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor_pointer()
                        .hover(|style| style.bg(theme.surface_hover))
                        .on_click(move |_, _, cx| {
                            let _ = view_colors.update(cx, |this, cx| {
                                this.skin_ui.colors_open = false;
                                cx.notify();
                            });
                        })
                        .child(widgets::icon("caret-right", 11.0, theme.faint)),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                .child(
                    div()
                        .size(px(30.0))
                        .rounded(px(6.0))
                        .bg(swatch(&color))
                        .border_1()
                        .border_color(theme.border),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w(px(0.0))
                        .child(widgets::text_input_box(&theme).child(app.paint_hex_input.clone())),
                ),
        )
        .child(sv_widget)
        .child(hue_widget)
        .child(
            div()
                .text_size(px(8.5))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.faint)
                .child(format!("ĐỘ ĐỤC · {}", alpha)),
        )
        .child(alpha_widget)
        .child(palette_grid)
        .when(!recent_colors.is_empty(), |el| {
            el.child(
                div()
                    .text_size(px(8.5))
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.faint)
                    .child("GẦN ĐÂY"),
            )
            .child(recent_row)
        })
        .child(
            div()
                .flex_1()
                .text_size(px(9.0))
                .line_height(px(13.0))
                .text_color(theme.faint)
                .child("Bấm/chéo trên mô hình để vẽ. Chọn Xoay/Di chuyển rồi kéo để đổi góc nhìn."),
        );

    // Bottom toolbar
    let tools = [
        ("pencil", "pencil-simple", "Bút"),
        ("eraser", "eraser", "Tẩy"),
        ("fill", "paint-brush", "Đổ"),
        ("picker", "eye", "Hút"),
        ("rotate", "arrow-clockwise", "Xoay"),
        ("pan", "arrow-right", "Di chuyển"),
    ];
    let mut tool_row = div().flex().items_center().gap(px(3.0));
    for (key, icon, label) in tools {
        let view = view.clone();
        let key = key.to_string();
        let active = tool == key;
        tool_row = tool_row.child(
            div()
                .id(gpui::SharedString::from(format!("editor-tool-{key}")))
                .h(px(26.0))
                .px(px(6.0))
                .rounded(px(5.0))
                .bg(if active { theme.accent } else { theme.elevated })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .flex()
                .items_center()
                .gap(px(4.0))
                .text_size(px(9.0))
                .text_color(if active { theme.on_accent } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let key = key.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.skin_ui.paint_tool = key;
                        this.skin_ui.paint_painting = false;
                        this.skin_ui.dragging = false;
                        cx.notify();
                    });
                })
                .child(widgets::icon(icon, 11.0, if active { theme.on_accent } else { theme.faint }))
                .child(label),
        );
    }
    let mut brush_row = div().flex().items_center().gap(px(3.0));
    for size in [1u32, 2, 3, 4, 6, 8] {
        let view = view.clone();
        let active = brush == size;
        brush_row = brush_row.child(
            div()
                .id(gpui::SharedString::from(format!("editor-brush-{size}")))
                .size(px(24.0))
                .rounded(px(4.0))
                .bg(if active { theme.accent_dim } else { theme.elevated })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(9.0))
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.skin_ui.paint_brush = size;
                        cx.notify();
                    });
                })
                .child(size.to_string()),
        );
    }
    let mut mirror_row = div().flex().items_center().gap(px(3.0));
    for (key, label) in [("off", "Off"), ("x", "X"), ("y", "Y"), ("z", "Z")] {
        let view = view.clone();
        let key = key.to_string();
        let active = mirror == key;
        mirror_row = mirror_row.child(
            div()
                .id(gpui::SharedString::from(format!("editor-mirror-{key}")))
                .h(px(24.0))
                .px(px(6.0))
                .rounded(px(4.0))
                .bg(if active { theme.accent_dim } else { theme.elevated })
                .text_size(px(9.0))
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let key = key.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.skin_ui.paint_mirror = key;
                        cx.notify();
                    });
                })
                .child(label),
        );
    }
    let view_undo = view.clone();
    let view_redo = view.clone();
    let view_clear = view.clone();
    let view_settings = view.clone();
    let view_tools_show = view.clone();
    let view_colors_show = view.clone();
    let toolbar = div()
        .flex()
        .items_center()
        .gap(px(6.0))
        .p(px(6.0))
        .rounded(px(10.0))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft)
        .child(tool_row)
        .child(div().w(px(1.0)).h(px(18.0)).bg(theme.border))
        .child(brush_row)
        .child(div().w(px(1.0)).h(px(18.0)).bg(theme.border))
        .child(
            div()
                .id("editor-undo")
                .size(px(26.0))
                .rounded(px(5.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border_soft)
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view_undo.update(cx, |this, cx| {
                        this.paint_undo();
                        cx.notify();
                    });
                })
                .child(widgets::icon("arrow-counter-clockwise", 12.0, theme.muted)),
        )
        .child(
            div()
                .id("editor-redo")
                .size(px(26.0))
                .rounded(px(5.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border_soft)
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view_redo.update(cx, |this, cx| {
                        this.paint_redo();
                        cx.notify();
                    });
                })
                .child(widgets::icon("arrow-clockwise", 12.0, theme.muted)),
        )
        .child(
            div()
                .text_size(px(8.5))
                .text_color(theme.faint)
                .child("Đối xứng"),
        )
        .child(mirror_row)
        .child({
            let view = view.clone();
            let active = app.skin_ui.paint_soft;
            div()
                .id("editor-soft")
                .h(px(24.0))
                .px(px(7.0))
                .rounded(px(5.0))
                .bg(if active { theme.accent_dim } else { theme.elevated })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .flex()
                .items_center()
                .text_size(px(9.0))
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.skin_ui.paint_soft = !this.skin_ui.paint_soft;
                        cx.notify();
                    });
                })
                .child(if active { "Cọ mềm" } else { "Cọ pixel" })
        })
        .child({
            let view = view.clone();
            let active = app.skin_ui.paint_model_grid;
            div()
                .id("editor-grid")
                .h(px(24.0))
                .px(px(7.0))
                .rounded(px(5.0))
                .bg(if active { theme.accent_dim } else { theme.elevated })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .flex()
                .items_center()
                .text_size(px(9.0))
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.skin_ui.paint_model_grid = !this.skin_ui.paint_model_grid;
                        this.refresh_paint_preview();
                        cx.notify();
                    });
                })
                .child("Lưới")
        })
        .child(
            div()
                .id("editor-settings")
                .h(px(24.0))
                .px(px(8.0))
                .rounded(px(5.0))
                .bg(if settings_open { theme.accent } else { theme.elevated })
                .border_1()
                .border_color(theme.border_soft)
                .flex()
                .items_center()
                .gap(px(4.0))
                .text_size(px(9.0))
                .text_color(if settings_open { theme.on_accent } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view_settings.update(cx, |this, cx| {
                        this.skin_ui.settings_open = !this.skin_ui.settings_open;
                        cx.notify();
                    });
                })
                .child(widgets::icon("gear-six", 11.0, if settings_open { theme.on_accent } else { theme.faint }))
                .child("Cài đặt"),
        )
        .child(
            div()
                .id("editor-clear")
                .h(px(24.0))
                .px(px(8.0))
                .rounded(px(5.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border_soft)
                .flex()
                .items_center()
                .text_size(px(9.0))
                .text_color(theme.muted)
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view_clear.update(cx, |this, cx| {
                        this.paint_begin_stroke();
                        if this.skin_ui.paint_asset == "cape" {
                            this.skin_ui.paint_cape = vec![0; 64 * 32 * 4];
                        } else {
                            this.skin_ui.paint_skin = vec![0; 64 * 64 * 4];
                        }
                        this.refresh_paint_preview();
                        cx.notify();
                    });
                })
                .child("Xoá"),
        );

    // Collapsed panel buttons
    if !tools_open {
        tools_panel_hidden(app, &theme, view.clone());
    }
    let collapsed_tools = (!tools_open).then(|| {
        div()
            .id("editor-tools-show")
            .absolute()
            .left(px(8.0))
            .top(px(8.0))
            .h(px(30.0))
            .px(px(9.0))
            .rounded(px(7.0))
            .bg(theme.surface)
            .border_1()
            .border_color(theme.border)
            .flex()
            .items_center()
            .gap(px(5.0))
            .text_size(px(9.5))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(theme.text)
            .cursor_pointer()
            .on_click(move |_, _, cx| {
                let _ = view_tools_show.update(cx, |this, cx| {
                    this.skin_ui.tools_open = true;
                    cx.notify();
                });
            })
            .child(widgets::icon("gear-six", 12.0, theme.faint))
            .child("Công cụ")
    });
    let collapsed_colors = (!colors_open).then(|| {
        div()
            .id("editor-colors-show")
            .absolute()
            .right(px(8.0))
            .top(px(8.0))
            .h(px(30.0))
            .px(px(9.0))
            .rounded(px(7.0))
            .bg(theme.surface)
            .border_1()
            .border_color(theme.border)
            .flex()
            .items_center()
            .gap(px(5.0))
            .text_size(px(9.5))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(theme.text)
            .cursor_pointer()
            .on_click(move |_, _, cx| {
                let _ = view_colors_show.update(cx, |this, cx| {
                    this.skin_ui.colors_open = true;
                    cx.notify();
                });
            })
            .child(widgets::icon("list", 12.0, theme.faint))
            .child("Màu")
    });

    // Settings popover
    let settings_panel = settings_open.then(|| {
        let view_close = view.clone();
        let view_model = view.clone();
        let view_layer = view.clone();
        let view_outer = view.clone();
        let mut model_row = div().flex().items_center().gap(px(4.0));
        for (key, label) in [("classic", "Classic"), ("slim", "Slim")] {
            model_row = model_row.child(small_chip(
                &theme,
                format!("settings-model-{key}"),
                label.into(),
                model == key,
                None,
                view_model.clone(),
                move |this, cx| {
                    this.skin_ui.model = key.into();
                    this.refresh_paint_preview();
                    this.refresh_skin_preview();
                    cx.notify();
                },
            ));
        }
        let mut layer_row = div().flex().items_center().gap(px(4.0));
        for (key, label) in [("inner", "Trong"), ("outer", "Ngoài")] {
            layer_row = layer_row.child(small_chip(
                &theme,
                format!("settings-layer-{key}"),
                label.into(),
                layer == key,
                None,
                view_layer.clone(),
                move |this, cx| {
                    this.skin_ui.paint_layer = key.into();
                    cx.notify();
                },
            ));
        }
        let parts_data = [
            ("Đầu", skin3d::HEAD),
            ("Thân", skin3d::BODY),
            ("Tay phải", skin3d::RIGHT_ARM),
            ("Tay trái", skin3d::LEFT_ARM),
            ("Chân phải", skin3d::RIGHT_LEG),
            ("Chân trái", skin3d::LEFT_LEG),
            ("Cape", skin3d::CAPE),
        ];
        let mut parts_grid = div().flex().flex_wrap().gap(px(3.0));
        for (label, part) in parts_data {
            let view = view.clone();
            let is_hidden = hidden.contains(&part);
            parts_grid = parts_grid.child(
                div()
                    .id(gpui::SharedString::from(format!("settings-part-{part}")))
                    .h(px(24.0))
                    .w(px(128.0))
                    .rounded(px(5.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(if is_hidden { theme.elevated } else { theme.surface })
                    .border_1()
                    .border_color(theme.border_soft)
                    .text_size(px(9.0))
                    .text_color(if is_hidden { theme.faint } else { theme.muted })
                    .cursor_pointer()
                    .on_click(move |_, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            if let Some(index) =
                                this.skin_ui.paint_hidden.iter().position(|p| *p == part)
                            {
                                this.skin_ui.paint_hidden.remove(index);
                            } else {
                                this.skin_ui.paint_hidden.push(part);
                            }
                            this.refresh_paint_preview();
                            cx.notify();
                        });
                    })
                    .child(label),
            );
        }
        let panel = div()
            .id("skin-settings-panel")
            .w(px(300.0))
            .p(px(10.0))
            .rounded(px(12.0))
            .bg(theme.surface)
            .border_1()
            .border_color(theme.border)
            .shadow_lg()
            .flex()
            .flex_col()
            .gap(px(8.0))
            .child(
                div()
                    .text_size(px(8.5))
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.faint)
                    .child("MẪU"),
            )
            .child(model_row)
            .child(
                div()
                    .text_size(px(8.5))
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.faint)
                    .child("LỚP"),
            )
            .child(layer_row)
            .child({
                let view = view.clone();
                div()
                    .id("settings-outer")
                    .h(px(26.0))
                    .w_full()
                    .px(px(7.0))
                    .rounded(px(5.0))
                    .bg(theme.elevated)
                    .border_1()
                    .border_color(theme.border_soft)
                    .flex()
                    .items_center()
                    .justify_between()
                    .text_size(px(9.5))
                    .text_color(theme.muted)
                    .cursor_pointer()
                    .on_click(move |_, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            this.skin_ui.paint_outer = !this.skin_ui.paint_outer;
                            this.refresh_paint_preview();
                            cx.notify();
                        });
                    })
                    .child("Hiện lớp ngoài")
                    .child(
                        div()
                            .text_size(px(9.0))
                            .text_color(if outer { theme.accent_soft } else { theme.faint })
                            .child(if outer { "BẬT" } else { "TẮT" }),
                    )
            })
            .child(
                div()
                    .text_size(px(8.5))
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.faint)
                    .child("BỘ PHẬN"),
            )
            .child(parts_grid);
        let backdrop = gpui::deferred(
            div()
                .id("skin-settings-backdrop")
                .absolute()
                .inset_0()
                .occlude()
                .on_click(move |_, _, cx| {
                    let _ = view_close.update(cx, |this, cx| {
                        this.skin_ui.settings_open = false;
                        cx.notify();
                    });
                }),
        )
        .with_priority(1);
        let panel = gpui::deferred(panel).with_priority(2);
        div()
            .absolute()
            .inset_0()
            .child(backdrop)
            .child(
                div()
                    .absolute()
                    .bottom(px(44.0))
                    .left(px(0.0))
                    .right(px(0.0))
                    .flex()
                    .justify_center()
                    .child(panel),
            )
    });

    let loupe = app.skin_ui.paint_loupe.clone().map(|image| {
        div()
            .absolute()
            .bottom(px(58.0))
            .right(px(if colors_open { 238.0 } else { 12.0 }))
            .w(px(120.0))
            .h(px(120.0))
            .rounded(px(8.0))
            .overflow_hidden()
            .bg(theme.elevated)
            .border_2()
            .border_color(theme.border)
            .shadow_lg()
            .child(gpui::img(image).size_full())
    });
    let axis_layout = [
        ("X", (1.0f32, 0.0, 0.0), gpui::rgb(0xef5350), -std::f32::consts::FRAC_PI_2, 0.0),
        ("Y", (0.0, 1.0, 0.0), gpui::rgb(0x4ade80), 0.0, std::f32::consts::FRAC_PI_2),
        ("Z", (0.0, 0.0, 1.0), gpui::rgb(0x60a5fa), 0.0, 0.0),
        ("−X", (-1.0, 0.0, 0.0), gpui::rgba(0xef535099), std::f32::consts::FRAC_PI_2, 0.0),
        ("−Y", (0.0, -1.0, 0.0), gpui::rgba(0x4ade8099), 0.0, -std::f32::consts::FRAC_PI_2),
        ("−Z", (0.0, 0.0, -1.0), gpui::rgba(0x60a5fa99), std::f32::consts::PI, 0.0),
    ];
    let mut gizmo = div()
        .absolute()
        .bottom(px(10.0))
        .left(px(if tools_open { 300.0 } else { 12.0 }))
        .size(px(112.0))
        .rounded_full()
        .bg(gpui::rgba(0x0d0d10cc))
        .border_1()
        .border_color(theme.border_soft);
    for (label, vector, color, yaw, pitch) in axis_layout {
        let (sin_y, cos_y) = app.skin_ui.angle.sin_cos();
        let (sin_p, cos_p) = app.skin_ui.paint_pitch.sin_cos();
        let xr = vector.0 * cos_y + vector.2 * sin_y;
        let zr = -vector.0 * sin_y + vector.2 * cos_y;
        let yr = vector.1 * cos_p - zr * sin_p;
        let center = 56.0;
        let x = (center + xr * 34.0).clamp(8.0, 96.0);
        let y = (center - yr * 34.0).clamp(8.0, 96.0);
        let view_axis = view.clone();
        gizmo = gizmo.child(
            div()
                .id(gpui::SharedString::from(format!("gizmo-{label}")))
                .absolute()
                .left(px(x - 9.0))
                .top(px(y - 9.0))
                .size(px(18.0))
                .rounded_full()
                .bg(color)
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(8.0))
                .font_weight(FontWeight::BOLD)
                .text_color(gpui::rgb(0x0a0a0a))
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view_axis.update(cx, |this, cx| {
                        this.skin_ui.angle = yaw;
                        this.skin_ui.paint_pitch = pitch.clamp(-1.1, 1.1);
                        this.refresh_paint_preview();
                        cx.notify();
                    });
                })
                .child(label),
        );
    }

    let viewer = div()
        .relative()
        .flex_1()
        .min_h(px(0.0))
        .w_full()
        .flex()
        .items_center()
        .justify_center()
        .child(surface)
        .when(tools_open, |el| el.child(tools_panel))
        .when(colors_open, |el| el.child(colors_panel))
        .children(collapsed_tools)
        .children(collapsed_colors)
        .children(loupe)
        .child(gizmo)
        .children(settings_panel);

    let overlay = div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .w_full()
        .h_full()
        .min_h(px(0.0))
        .p(px(18.0))
        .child(header)
        .child(viewer)
        .child(div().flex().justify_center().child(toolbar));
    overlay.into_any_element()
}

fn tools_panel_hidden(_app: &LauncherApp, _theme: &Theme, _view: gpui::WeakEntity<LauncherApp>) {}


fn hex_rgb(hex: &str) -> (u8, u8, u8) {
    let hex = hex.trim_start_matches('#');
    let r = u8::from_str_radix(hex.get(0..2).unwrap_or("ff"), 16).unwrap_or(255);
    let g = u8::from_str_radix(hex.get(2..4).unwrap_or("ff"), 16).unwrap_or(255);
    let b = u8::from_str_radix(hex.get(4..6).unwrap_or("ff"), 16).unwrap_or(255);
    (r, g, b)
}

fn rgb_hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02X}{g:02X}{b:02X}")
}

fn rgb_to_hsv((r, g, b): (u8, u8, u8)) -> (f32, f32, f32) {
    let r = r as f32 / 255.0;
    let g = g as f32 / 255.0;
    let b = b as f32 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let delta = max - min;
    let h = if delta <= f32::EPSILON {
        0.0
    } else if max == r {
        60.0 * (((g - b) / delta) % 6.0)
    } else if max == g {
        60.0 * ((b - r) / delta + 2.0)
    } else {
        60.0 * ((r - g) / delta + 4.0)
    };
    let h = if h < 0.0 { h + 360.0 } else { h };
    let s = if max <= f32::EPSILON { 0.0 } else { delta / max };
    (h, s, max)
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (u8, u8, u8) {
    let c = v * s;
    let hp = (h % 360.0) / 60.0;
    let x = c * (1.0 - (hp % 2.0 - 1.0).abs());
    let (r, g, b) = if hp < 1.0 {
        (c, x, 0.0)
    } else if hp < 2.0 {
        (x, c, 0.0)
    } else if hp < 3.0 {
        (0.0, c, x)
    } else if hp < 4.0 {
        (0.0, x, c)
    } else if hp < 5.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };
    let m = v - c;
    (
        ((r + m) * 255.0).round() as u8,
        ((g + m) * 255.0).round() as u8,
        ((b + m) * 255.0).round() as u8,
    )
}

fn build_sv_image(hue: f32, width: u32, height: u32) -> image::RgbaImage {
    let mut image = image::RgbaImage::new(width, height);
    for y in 0..height {
        for x in 0..width {
            let s = x as f32 / (width - 1).max(1) as f32;
            let v = 1.0 - y as f32 / (height - 1).max(1) as f32;
            let (r, g, b) = hsv_to_rgb(hue, s, v);
            image.put_pixel(x, y, image::Rgba([r, g, b, 255]));
        }
    }
    image
}

fn build_hue_image(width: u32, height: u32) -> image::RgbaImage {
    let mut image = image::RgbaImage::new(width, height);
    for x in 0..width {
        let h = x as f32 / (width - 1).max(1) as f32 * 360.0;
        let (r, g, b) = hsv_to_rgb(h, 1.0, 1.0);
        for y in 0..height {
            image.put_pixel(x, y, image::Rgba([r, g, b, 255]));
        }
    }
    image
}

fn build_alpha_image(color: &str, width: u32, height: u32) -> image::RgbaImage {
    let (r, g, b) = hex_rgb(color);
    let mut image = image::RgbaImage::new(width, height);
    for x in 0..width {
        let alpha = (x as f32 / (width - 1).max(1) as f32 * 255.0).round() as u8;
        for y in 0..height {
            let checker = if ((x / 6) + (y / 6)) % 2 == 0 { 80u8 } else { 45u8 };
            let a = alpha as f32 / 255.0;
            let cr = (r as f32 * a + checker as f32 * (1.0 - a)) as u8;
            let cg = (g as f32 * a + checker as f32 * (1.0 - a)) as u8;
            let cb = (b as f32 * a + checker as f32 * (1.0 - a)) as u8;
            image.put_pixel(x, y, image::Rgba([cr, cg, cb, 255]));
        }
    }
    image
}
