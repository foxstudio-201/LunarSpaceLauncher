use crate::ui::app::{ConfirmAction, LauncherApp, Modal};
use crate::ui::pages::{self, page_body, page_header, section_title};
use crate::ui::theme::*;
use crate::ui::widgets;
use gpui::{AnyElement, Context, FontWeight, IntoElement, MouseButton, Window, div, prelude::*, px};
use serde_json::{Value, json};
use std::path::Path;

pub fn render(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    if app.accounts_tab == "skin" {
        crate::ui::pages::skin_editor::ensure(app, cx);
        return crate::ui::pages::skin_editor::render(app, cx);
    }
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let add_view = view.clone();
    let refresh_view = view.clone();
    if !app.discord_ui.links_loaded {
        app.discord_ui.links_loaded = true;
        app.load_discord_links(cx);
    }

    let mut list = div().flex().gap_3().flex_wrap();
    if app.accounts.is_empty() {
        list = list.child(
            div()
                .w_full()
                .child(pages::empty_state(
                    &theme,
                    "user",
                    "Chưa có tài khoản nào",
                    "Thêm tài khoản ngoại tuyến, Microsoft, ely.by hoặc liên kết Discord để bắt đầu chơi.",
                )),
        );
    }
    for account in app.accounts.iter().cloned().collect::<Vec<_>>() {
        let active = app.active_account.as_deref() == Some(account.id.as_str());
        let kind_label = match account.kind.as_str() {
            "microsoft" => "Microsoft",
            "ely" => "ely.by",
            _ => "Ngoại tuyến",
        };
        let kind_color = match account.kind.as_str() {
            "microsoft" => theme.info,
            "ely" => theme.ok,
            _ => theme.accent_soft,
        };
        let head = app.account_heads.get(&account.uuid).cloned();
        let discord_link = app
            .discord_ui
            .links
            .iter()
            .find(|link| {
                link.get("accountUuid").and_then(Value::as_str) == Some(account.uuid.as_str())
                    || link.get("accountId").and_then(Value::as_str) == Some(account.id.as_str())
            })
            .cloned();
        let view_use = view.clone();
        let view_copy = view.clone();
        let view_refresh = view.clone();
        let view_remove = view.clone();
        let view_discord = view.clone();
        let id = account.id.clone();
        let id_use = id.clone();
        let id_copy = id.clone();
        let id_refresh = id.clone();
        let remove_id = account.id.clone();
        let name = account.name.clone();
        let uuid = account.uuid.clone();
        let mut card = div()
            .flex()
            .flex_col()
            .gap_3()
            .w(px(320.0))
            .flex_grow()
            .p(px(16.0))
            .rounded(px(RADIUS_LG))
            .bg(theme.surface)
            .border_1()
            .border_color(if active { theme.accent } else { theme.border_soft });
        card = card.child(
            div()
                .flex()
                .items_center()
                .gap_3()
                .child(
                    div()
                        .size(px(44.0))
                        .rounded(px(10.0))
                        .bg(theme.surface_active)
                        .truncate()
                        .flex()
                        .items_center()
                        .justify_center()
                        .when_some(head, |el, path| {
                            el.child(gpui::img(path).size(px(44.0)).object_fit(gpui::ObjectFit::Cover))
                        })
                        .when(account.kind != "offline" || !app.backend.skin_read(&account.uuid).get("skinPath").map(|v| !v.is_null()).unwrap_or(false), |el| {
                            el.child(
                                div()
                                    .text_size(px(16.0))
                                    .font_weight(bold())
                                    .text_color(theme.accent_soft)
                                    .child(name.chars().next().unwrap_or('?').to_uppercase().to_string()),
                            )
                        })
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
                                .text_size(px(TEXT_MD))
                                .font_weight(semibold())
                                .text_color(theme.text)
                                .truncate()
                                .child(name.clone()),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(widgets::tag(kind_label.to_string(), kind_color, &theme))
                                .when(active, |el| {
                                    el.child(widgets::tag("Đang dùng", theme.ok, &theme))
                                })
                                .when_some(discord_link.clone(), |el, link| {
                                    let label = link
                                        .get("label")
                                        .or_else(|| link.get("discordName"))
                                        .or_else(|| link.get("discordTag"))
                                        .and_then(Value::as_str)
                                        .unwrap_or("Discord")
                                        .to_string();
                                    el.child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(4.0))
                                            .h(px(18.0))
                                            .px(px(6.0))
                                            .rounded(px(4.0))
                                            .bg(gpui::rgba(0x5865F22A))
                                            .text_size(px(9.0))
                                            .font_weight(bold())
                                            .text_color(gpui::rgb(0x8B95F7))
                                            .child(widgets::icon("discord-logo", 10.0, gpui::rgb(0x8B95F7)))
                                            .child(label),
                                    )
                                }),
                        ),
                ),
        );
        // default head for offline without skin
        if account.kind == "offline" && !app.backend.skin_read(&account.uuid).get("skinPath").map(|v| !v.is_null()).unwrap_or(false) {
            card = card.child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .text_size(px(TEXT_XS))
                    .text_color(theme.faint)
                    .child(widgets::icon("sparkle", 12.0, theme.faint))
                    .child("UUID chuẩn Mojang (offline)"),
            );
        }
        card = card.child(
            div()
                .text_size(px(10.5))
                .text_color(theme.faint)
                .truncate()
                .child(uuid.clone()),
        );
        card = card.child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .when(!active, |el| {
                    el.child(widgets::button(
                        gpui::SharedString::from(format!("use-{}", id)),
                        "Dùng",
                        &theme,
                        true,
                        move |_, _, cx| {
                            let id = id_use.clone();
                            let _ = view_use.update(cx, |this, cx| {
                                let value = this.backend.account_set_active(&id);
                                if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                    this.refresh_accounts(cx);
                                    this.toast("ok", "Đã chọn tài khoản", "", cx);
                                }
                            });
                        },
                    ))
                })
                .child(widgets::ghost_button(
                    gpui::SharedString::from(format!("copy-{}", id)),
                    "UUID",
                    &theme,
                    {
                        let uuid = uuid.clone();
                        let view = view_copy.clone();
                        move |_, _, cx| {
                            let uuid = uuid.clone();
                            let _ = view.update(cx, |this, cx| {
                                cx.write_to_clipboard(gpui::ClipboardItem::new_string(uuid.clone()));
                                this.toast("ok", "Đã sao chép UUID", uuid.clone(), cx);
                            });
                        }
                    },
                ))
                .when(account.kind != "offline", |el| {
                    let view = view_refresh.clone();
                    let id = id_refresh.clone();
                    el.child(widgets::ghost_button(
                        gpui::SharedString::from(format!("refresh-{}", account.id)),
                        "Làm mới",
                        &theme,
                        move |_, _, cx| {
                            let id = id.clone();
                            let _ = view.update(cx, |this, cx| {
                                let rx = this.backend.account_refresh(id.clone());
                                this.on_result(cx, rx, |this, value, cx| {
                                    if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                        this.toast("ok", "Đã làm mới phiên đăng nhập", "", cx);
                                    } else {
                                        this.toast("bad", "Làm mới thất bại", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                                    }
                                });
                            });
                        },
                    ))
                })
                .when_some(discord_link.clone(), |el, _link| {
                    let view = view_discord.clone();
                    let id = account.id.clone();
                    el.child(
                        div()
                            .id(gpui::SharedString::from(format!("discord-unlink-{}", account.id)))
                            .size(px(28.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(px(7.0))
                            .bg(gpui::rgba(0x5865F226))
                            .border_1()
                            .border_color(gpui::rgba(0x5865F266))
                            .cursor_pointer()
                            .on_click(move |_, _, cx| {
                                let id = id.clone();
                                let _ = view.update(cx, |this, cx| {
                                    let rx = this.backend.discord_unlink(id.clone());
                                    this.on_result(cx, rx, |this, value, cx| {
                                        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                            this.load_discord_links(cx);
                                            this.toast("ok", "Đã gỡ liên kết Discord", "", cx);
                                        } else {
                                            this.toast("bad", "Gỡ liên kết thất bại", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                                        }
                                    });
                                });
                            })
                            .child(widgets::icon("x", 12.0, gpui::rgb(0x8B95F7))),
                    )
                })
                .when(discord_link.is_none(), |el| {
                    let view = view_discord.clone();
                    let id = account.id.clone();
                    let name = account.name.clone();
                    el.child(
                        div()
                            .id(gpui::SharedString::from(format!("discord-link-{}", account.id)))
                            .h(px(28.0))
                            .px(px(8.0))
                            .flex()
                            .items_center()
                            .gap(px(4.0))
                            .rounded(px(6.0))
                            .bg(gpui::rgba(0x5865F21F))
                            .border_1()
                            .border_color(gpui::rgba(0x5865F259))
                            .text_size(px(9.5))
                            .font_weight(bold())
                            .text_color(gpui::rgb(0x8B95F7))
                            .cursor_pointer()
                            .on_click(move |_, _, cx| {
                                let id = id.clone();
                                let name = name.clone();
                                let _ = view.update(cx, |this, cx| {
                                    let input = this.discord_name_input.clone();
                                    input.update(cx, |input, cx| input.set_text(name.clone(), cx));
                                    open_discord_link(this, name.clone(), id.clone(), true, cx);
                                });
                            })
                            .child(widgets::icon("discord-logo", 11.0, gpui::rgb(0x8B95F7)))
                            .child("Discord"),
                    )
                })
                .child(widgets::ghost_button(
                    gpui::SharedString::from(format!("remove-{}", remove_id)),
                    "Xoá",
                    &theme,
                    move |_, _, cx| {
                        let id = remove_id.clone();
                        let _ = view_remove.update(cx, |this, cx| {
                            this.modal = Modal::Confirm {
                                title: "Xoá tài khoản?".into(),
                                message: "Phiên đăng nhập đã lưu của tài khoản này cũng sẽ bị xoá.".into(),
                                action: ConfirmAction::RemoveAccount(id.clone()),
                            };
                            cx.notify();
                        });
                    },
                )),
        );
        list = list.child(card);
    }

    // skin section
    let offline: Vec<_> = app.accounts.iter().filter(|a| a.kind == "offline").cloned().collect();
    if app.skin_ui.uuid.is_empty() {
        if let Some(first) = offline.first() {
            app.skin_ui.uuid = first.uuid.clone();
            let skin = app.backend.skin_read(&first.uuid);
            app.skin_ui.model = skin
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or("classic")
                .to_string();
            app.skin_ui.skin_path = skin
                .get("skinPath")
                .and_then(Value::as_str)
                .map(str::to_string);
            app.skin_ui.cape_path = skin
                .get("capePath")
                .and_then(Value::as_str)
                .map(str::to_string);
            app.refresh_skin_preview();
        }
    }
    let mut skin_accounts = div().flex().items_center().gap_2().flex_wrap();
    for account in &offline {
        let active = app.skin_ui.uuid == account.uuid;
        let view_acc = view.clone();
        let uuid = account.uuid.clone();
        let name = account.name.clone();
        skin_accounts = skin_accounts.child(
            div()
                .id(gpui::SharedString::from(format!("skin-acc-{}", account.uuid)))
                .flex()
                .items_center()
                .gap_2()
                .h(px(30.0))
                .px(px(10.0))
                .rounded(px(6.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .text_size(px(TEXT_SM))
                .text_color(if active { theme.text } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let uuid = uuid.clone();
                    let _ = view_acc.update(cx, |this, cx| {
                        this.skin_ui.uuid = uuid.clone();
                        let skin = this.backend.skin_read(&uuid);
                        this.skin_ui.model = skin
                            .get("model")
                            .and_then(Value::as_str)
                            .unwrap_or("classic")
                            .to_string();
                        this.skin_ui.skin_path = skin
                            .get("skinPath")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        this.skin_ui.cape_path = skin
                            .get("capePath")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                        this.skin_ui.message.clear();
                        this.refresh_skin_preview();
                        cx.notify();
                    });
                })
                .child(widgets::icon("user", 13.0, if active { theme.accent_soft } else { theme.faint }))
                .child(name),
        );
    }
    let skin = if app.skin_ui.uuid.is_empty() {
        Value::Null
    } else {
        app.backend.skin_read(&app.skin_ui.uuid)
    };
    let current_model = skin
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("classic")
        .to_string();
    let skin_head = skin
        .get("skinPath")
        .and_then(Value::as_str)
        .and_then(|path| crate::mc::skins::head_png(&app.backend.store, Path::new(path), &app.skin_ui.uuid));

    let view_paint = view.clone();
    let view_upload_skin = view.clone();
    let view_upload_cape = view.clone();
    let view_model = view.clone();
    let view_save = view.clone();
    let view_reset = view.clone();
    let skin_upload = div()
        .flex()
        .items_center()
        .gap_2()
        .child(widgets::ghost_button("skin-upload", "Tải skin PNG", &theme, move |_, _, cx| {
            let view = view_upload_skin.clone();
            cx.spawn(async move |cx| {
                let picked = rfd::AsyncFileDialog::new()
                    .add_filter("PNG", &["png"])
                    .pick_file()
                    .await;
                if let Some(file) = picked {
                    let path = file.path().to_string_lossy().into_owned();
                    let _ = view.update(cx, |this, cx| {
                        this.skin_ui.skin_path = Some(path);
                        this.skin_ui.message = "Đã nạp skin — nhấn Lưu để áp dụng.".into();
                        this.refresh_skin_preview();
                        cx.notify();
                    });
                }
            })
            .detach();
        }))
        .child(widgets::ghost_button("skin-paint", "Vẽ skin", &theme, move |_, _, cx| {
            let _ = view_paint.update(cx, |this, cx| this.open_skin_painter(cx));
        }))
        .child(widgets::ghost_button("cape-upload", "Tải cape PNG", &theme, move |_, _, cx| {
            let view = view_upload_cape.clone();
            cx.spawn(async move |cx| {
                let picked = rfd::AsyncFileDialog::new()
                    .add_filter("PNG", &["png"])
                    .pick_file()
                    .await;
                if let Some(file) = picked {
                    let path = file.path().to_string_lossy().into_owned();
                    let _ = view.update(cx, |this, cx| {
                        this.skin_ui.cape_path = Some(path);
                        this.skin_ui.message = "Đã nạp cape — nhấn Lưu để áp dụng.".into();
                        this.refresh_skin_preview();
                        cx.notify();
                    });
                }
            })
            .detach();
        }));

    let model_row = {
        let mut row = div().flex().gap_2();
        for (key, label) in [("classic", "Classic (tay 4 px)"), ("slim", "Slim (tay 3 px)")] {
            let active = app.skin_ui.model == key;
            let view = view_model.clone();
            let key = key.to_string();
            row = row.child(
                div()
                    .id(gpui::SharedString::from(format!("skin-model-{key}")))
                    .h(px(30.0))
                    .px(px(10.0))
                    .flex()
                    .items_center()
                    .rounded(px(6.0))
                    .bg(if active { theme.accent_dim } else { theme.surface })
                    .border_1()
                    .border_color(if active { theme.accent } else { theme.border_soft })
                    .text_size(px(TEXT_SM))
                    .text_color(if active { theme.text } else { theme.muted })
                    .cursor_pointer()
                    .on_click(move |_, _, cx| {
                        let key = key.clone();
                        let _ = view.update(cx, |this, cx| {
                            this.skin_ui.model = key;
                            cx.notify();
                        });
                    })
                    .child(label),
            );
        }
        row
    };

    let view_tab = cx.entity().downgrade();
    let mut tab_row = div().flex().items_center().gap(px(6.0));
    for (key, label) in [("list", "Danh sách tài khoản"), ("skin", "Skin")] {
        let active = app.accounts_tab == key;
        let view = view_tab.clone();
        let key = key.to_string();
        tab_row = tab_row.child(
            div()
                .id(gpui::SharedString::from(format!("acc-tab-{key}")))
                .h(px(30.0))
                .px(px(12.0))
                .flex()
                .items_center()
                .rounded(px(8.0))
                .bg(if active { theme.elevated } else { theme.bg })
                .border_1()
                .border_color(if active { theme.border } else { theme.bg })
                .text_size(px(11.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(if active { theme.text } else { theme.faint })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let key = key.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.accounts_tab = key;
                        cx.notify();
                    });
                })
                .child(label.to_string()),
        );
    }
    page_body()
        .child(page_header(
            &theme,
            "Tài khoản",
            "Tài khoản dùng khi khởi chạy game",
            div()
                .flex()
                .items_center()
                .gap_2()
                .child({
                    let discord_view = view.clone();
                    let discord_blue = gpui::rgb(0x5865F2);
                    div()
                        .id("acc-discord-header")
                        .h(px(34.0))
                        .px(px(11.0))
                        .flex()
                        .items_center()
                        .gap(px(6.0))
                        .rounded(px(6.0))
                        .bg(gpui::rgba(0x5865F21F))
                        .border_1()
                        .border_color(gpui::rgba(0x5865F259))
                        .text_size(px(11.0))
                        .font_weight(semibold())
                        .text_color(gpui::rgb(0x8B95F7))
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let _ = discord_view.update(cx, |this, cx| {
                                let input = this.discord_name_input.clone();
                                input.update(cx, |input, cx| input.clear(cx));
                                open_discord_link(this, String::new(), String::new(), false, cx);
                            });
                        })
                        .child(widgets::icon("discord-logo", 13.0, discord_blue))
                        .child("Liên kết Discord")
                })
                .child(widgets::ghost_button("acc-refresh", "Làm mới", &theme, move |_, _, cx| {
                    let _ = refresh_view.update(cx, |this, cx| {
                        this.refresh_accounts(cx);
                        cx.notify();
                    });
                }))
                .child(widgets::button("acc-add", "Thêm tài khoản", &theme, true, move |_, _, cx| {
                    let _ = add_view.update(cx, |this, cx| {
                        this.modal = Modal::AddAccount;
                        this.account_ui.open = true;
                        this.account_ui.error.clear();
                        this.account_ui.ms_waiting = false;
                        cx.notify();
                    });
                })),
        ))
        .child(tab_row)
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .p(px(12.0))
                .rounded(px(RADIUS))
                .bg(theme.accent_dim)
                .text_size(px(TEXT_SM))
                .text_color(theme.accent_soft)
                .child(widgets::icon("info", 15.0, theme.accent_soft))
                .child("Hỗ trợ Ngoại tuyến, Microsoft (vào được server online), ely.by và liên kết Discord. Phiên đăng nhập được lưu trên máy và tự làm mới.")
                .when(app.accounts_tab != "list", |el| el.hidden()),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap_3()
                .child(section_title(
                    &theme,
                    "Danh sách tài khoản",
                    format!("{} tài khoản", app.accounts.len()),
                ))
                .child(list)
                .when(app.accounts_tab != "list", |el| el.hidden()),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap_4()
                .p(px(18.0))
                .rounded(px(RADIUS_LG))
                .bg(theme.surface)
                .border_1()
                .border_color(theme.border_soft)
                .child(section_title(
                    &theme,
                    "Skin & cape",
                    "Chỉ áp dụng cho tài khoản ngoại tuyến",
                ))
                .when(offline.is_empty(), |el| {
                    el.child(pages::empty_state(
                        &theme,
                        "user",
                        "Chưa có tài khoản ngoại tuyến",
                        "Skin tuỳ chỉnh chỉ dùng cho tài khoản ngoại tuyến. Thêm một tài khoản rồi quay lại đây.",
                    ))
                })
                .when(!offline.is_empty(), |el| {
                    el.child(skin_accounts)
                        .child(
                            div()
                                .flex()
                                .gap_4()
                                .child({
                                    let view_drag = view.clone();
                                    let view_drag_move = view_drag.clone();
                                    let view_up = view.clone();
                                    let view_up_out = view_up.clone();
                                    let view_spin = view.clone();
                                    div()
                                        .id("skin-preview-3d")
                                        .relative()
                                        .w(px(220.0))
                                        .h(px(300.0))
                                        .rounded(px(RADIUS))
                                        .bg(theme.elevated)
                                        .border_1()
                                        .border_color(theme.border_soft)
                                        .overflow_hidden()
                                        .cursor_pointer()
                                        .on_mouse_down(MouseButton::Left, move |event, _, cx| {
                                            let x = f32::from(event.position.x);
                                            let _ = view_drag.update(cx, |this, cx| {
                                                this.skin_ui.dragging = true;
                                                this.skin_drag_x = x;
                                                cx.notify();
                                            });
                                        })
                                        .on_mouse_move(move |event, _, cx| {
                                            let x = f32::from(event.position.x);
                                            let _ = view_drag_move.update(cx, |this, cx| {
                                                if !this.skin_ui.dragging {
                                                    return;
                                                }
                                                let delta = x - this.skin_drag_x;
                                                this.skin_drag_x = x;
                                                this.skin_ui.angle += delta * 0.012;
                                                this.refresh_skin_preview();
                                                cx.notify();
                                            });
                                        })
                                        .on_mouse_up(MouseButton::Left, move |_, _, cx| {
                                            let _ = view_up.update(cx, |this, cx| {
                                                this.skin_ui.dragging = false;
                                                cx.notify();
                                            });
                                        })
                                        .on_mouse_up_out(MouseButton::Left, move |_, _, cx| {
                                            let _ = view_up_out.update(cx, |this, cx| {
                                                this.skin_ui.dragging = false;
                                                cx.notify();
                                            });
                                        })
                                        .child(
                                            div()
                                                .id("skin-spin")
                                                .absolute()
                                                .top(px(6.0))
                                                .right(px(6.0))
                                                .flex()
                                                .items_center()
                                                .justify_center()
                                                .size(px(26.0))
                                                .rounded(px(6.0))
                                                .bg(theme.surface)
                                                .border_1()
                                                .border_color(theme.border_soft)
                                                .cursor_pointer()
                                                .hover(|s| s.bg(theme.surface_hover))
                                                .on_click(move |_, _, cx| {
                                                    let _ = view_spin.update(cx, |this, cx| {
                                                        if this.skin_ui.auto_spin {
                                                            this.stop_skin_spin();
                                                        } else {
                                                            this.start_skin_spin(cx);
                                                        }
                                                        cx.notify();
                                                    });
                                                })
                                                .child(widgets::icon(
                                                    "arrows-clockwise",
                                                    13.0,
                                                    if app.skin_ui.auto_spin { theme.accent_soft } else { theme.faint },
                                                )),
                                        )
                                        .when_some(app.skin_preview.clone(), |el, image| {
                                            el.child(gpui::img(image).absolute().inset_0().size_full().object_fit(gpui::ObjectFit::Contain))
                                        })
                                        .when(app.skin_preview.is_none(), |el| {
                                            el.child(
                                                div()
                                                    .absolute()
                                                    .inset_0()
                                                    .flex()
                                                    .items_center()
                                                    .justify_center()
                                                    .child(widgets::icon("user", 46.0, theme.faint)),
                                            )
                                        })
                                        .child(
                                            div()
                                                .absolute()
                                                .bottom(px(7.0))
                                                .left(px(9.0))
                                                .text_size(px(TEXT_XS))
                                                .text_color(theme.faint)
                                                .child("Kéo để xoay"),
                                        )
                                })
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .gap_3()
                                        .flex_1()
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap_2()
                                                .child(
                                                    div()
                                                        .text_size(px(TEXT_SM))
                                                        .font_weight(medium())
                                                        .text_color(theme.muted)
                                                        .child("Kiểu nhân vật"),
                                                )
                                                .child(model_row),
                                        )
                                        .child(skin_upload)
                                        .when(!app.skin_ui.message.is_empty(), |el| {
                                            el.child(
                                                div()
                                                    .text_size(px(TEXT_SM))
                                                    .text_color(theme.ok)
                                                    .child(app.skin_ui.message.clone()),
                                            )
                                        })
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap_2()
                                                .child(widgets::button("skin-save", "Lưu skin & cape", &theme, true, move |_, _, cx| {
                                                    let view = view_save.clone();
                                                    let _ = view.update(cx, |this, cx| {
                                                        let uuid = this.skin_ui.uuid.clone();
                                                        let name = this
                                                            .accounts
                                                            .iter()
                                                            .find(|a| a.uuid == uuid)
                                                            .map(|a| a.name.clone())
                                                            .unwrap_or_default();
                                                        let model = if this.skin_ui.model.is_empty() {
                                                            "classic".to_string()
                                                        } else {
                                                            this.skin_ui.model.clone()
                                                        };
                                                        let skin_path = this.skin_ui.skin_path.clone();
                                                        let cape_path = this.skin_ui.cape_path.clone();
                                                        if skin_path.is_none() && cape_path.is_none() {
                                                            this.skin_ui.message = "Chọn ảnh skin hoặc cape trước.".into();
                                                            cx.notify();
                                                            return;
                                                        }
                                                        let rx = this.backend.skin_save(uuid, name, model, skin_path, cape_path);
                                                        this.on_result(cx, rx, |this, value, cx| {
                                                            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                                this.skin_ui.message = "Đã lưu skin. Mở lại game để áp dụng.".into();
                                                                this.toast("ok", "Đã lưu skin", "", cx);
                                                            } else {
                                                                this.skin_ui.message = value
                                                                    .get("error")
                                                                    .and_then(Value::as_str)
                                                                    .unwrap_or("Lưu skin thất bại")
                                                                    .to_string();
                                                            }
                                                        });
                                                    });
                                                }))
                                                .child(widgets::ghost_button("skin-reset", "Xoá skin tuỳ chỉnh", &theme, move |_, _, cx| {
                                                    let view = view_reset.clone();
                                                    let _ = view.update(cx, |this, cx| {
                                                        this.backend.skin_remove(&this.skin_ui.uuid);
                                                        this.skin_ui.skin_path = None;
                                                        this.skin_ui.cape_path = None;
                                                        this.skin_ui.message = "Đã xoá skin tuỳ chỉnh.".into();
                                                        this.toast("ok", "Đã xoá skin", "", cx);
                                                    });
                                                })),
                                        ),
                                ),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .text_size(px(TEXT_XS))
                                .text_color(theme.faint)
                                .child("PNG 64×64 cho skin, 64×32 cho cape. Skin được chia sẻ để người chơi khác dùng launcher thấy.")
                                .when_some(skin_head, |el, path| {
                                    el.child(gpui::img(path).size(px(28.0)).rounded(px(6.0)))
                                }),
                        )
                })
                .when(app.accounts_tab != "skin", |el| el.hidden()),
        )
        .into_any_element()
}

pub fn add_account_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let close_view = cx.entity().downgrade();
    let tab_view = cx.entity().downgrade();
    let submit_view = cx.entity().downgrade();
    let discord_blue = gpui::rgb(0x5865F2);

    let kinds = [
        ("offline", "user", "Ngoại tuyến", theme.accent, "Chơi không cần tài khoản Mojang. Tên chỉ gồm chữ, số, gạch dưới và dài 3–16 ký tự."),
        ("microsoft", "microsoft", "Microsoft", theme.accent, "Đăng nhập bằng tài khoản Microsoft đã sở hữu Minecraft Java Edition trong cửa sổ Microsoft riêng."),
        ("ely", "globe", "ely.by", theme.accent, "Tài khoản ely.by qua authlib-injector: chơi được trên server có bật ely.by và dùng skin của ely.by."),
        ("discord", "discord-logo", "Discord", discord_blue, "Tạo tài khoản launcher và xác minh quyền sở hữu qua Discord. Không cần mật khẩu."),
    ];
    let active_kind = app.account_ui.tab.clone();
    let description = kinds
        .iter()
        .find(|(key, ..)| *key == active_kind)
        .map(|(_, _, _, _, desc)| *desc)
        .unwrap_or("");

    let mut kind_row = div().flex().items_center().gap_2();
    for (key, icon_name, label, tint, _) in kinds {
        let active = app.account_ui.tab == key;
        let view = tab_view.clone();
        let key = key.to_string();
        kind_row = kind_row.child(
            div()
                .id(gpui::SharedString::from(format!("acc-kind-{key}")))
                .flex()
                .flex_col()
                .items_start()
                .justify_center()
                .gap(px(5.0))
                .flex_1()
                .h(px(62.0))
                .px(px(10.0))
                .rounded(px(10.0))
                .bg(if active { theme.elevated } else { theme.bg })
                .border_1()
                .border_color(if active { tint } else { theme.border_soft })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let key = key.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.account_ui.tab = key;
                        this.account_ui.error.clear();
                        cx.notify();
                    });
                })
                .child(widgets::icon(icon_name, 15.0, if active { tint } else { theme.muted }))
                .child(
                    div()
                        .text_size(px(11.0))
                        .font_weight(bold())
                        .text_color(if active { theme.text } else { theme.muted })
                        .child(label),
                ),
        );
    }

    let body = match app.account_ui.tab.as_str() {
        "microsoft" => div()
            .flex()
            .flex_col()
            .gap_3()
            .child(
                div()
                    .flex()
                    .items_start()
                    .gap_2()
                    .p(px(12.0))
                    .rounded(px(RADIUS_SM))
                    .bg(theme.elevated)
                    .border_1()
                    .border_color(theme.border)
                    .child(widgets::icon("shield-check", 14.0, theme.accent_soft))
                    .child(
                        div()
                            .flex_1()
                            .min_w(px(0.0))
                            .text_size(px(TEXT_SM))
                            .text_color(theme.muted)
                            .child("Cửa sổ đăng nhập Microsoft sẽ mở riêng.
Launcher không thấy mật khẩu của bạn.
Phiên đăng nhập được lưu an toàn trên máy."),
                    ),
            )
            .when(app.account_ui.ms_waiting, |el| {
                el.child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(widgets::spinner(14.0, theme.accent_soft))
                        .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child("Đang chờ bạn đăng nhập trong cửa sổ Microsoft…")),
                )
            })
            .into_any_element(),
        "ely" => div()
            .flex()
            .flex_col()
            .gap_3()
            .child(pages::field(&theme, "Tên đăng nhập hoặc email", app.ely_user.clone(), ""))
            .child(pages::field(&theme, "Mật khẩu", app.ely_pass.clone(), "Mật khẩu chỉ gửi trực tiếp tới authserver.ely.by."))
            .child(
                div()
                    .flex()
                    .items_start()
                    .gap_2()
                    .p(px(12.0))
                    .rounded(px(RADIUS_SM))
                    .bg(theme.elevated)
                    .border_1()
                    .border_color(theme.border)
                    .child(widgets::icon("shield-check", 14.0, theme.accent_soft))
                    .child(
                        div()
                            .flex_1()
                            .min_w(px(0.0))
                            .text_size(px(TEXT_SM))
                            .text_color(theme.muted)
                            .child("Launcher tự cài authlib-injector để đăng nhập ely.by khi chơi."),
                    ),
            )
            .into_any_element(),
        "discord" => div()
            .flex()
            .flex_col()
            .gap_3()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .child(
                        div()
                            .size(px(38.0))
                            .rounded(px(9.0))
                            .bg(gpui::rgba(0x5865F22A))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(widgets::icon("discord-logo", 18.0, discord_blue)),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w(px(0.0))
                            .child(div().text_size(px(10.0)).font_weight(bold()).text_color(theme.muted).child("Tên tài khoản launcher"))
                            .child(widgets::text_input_box(&theme).child(app.discord_name_input.clone())),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_start()
                    .gap_2()
                    .p(px(12.0))
                    .rounded(px(RADIUS_SM))
                    .bg(theme.elevated)
                    .border_1()
                    .border_color(theme.border)
                    .child(widgets::icon("arrow-square-out", 14.0, discord_blue))
                    .child(
                        div()
                            .flex_1()
                            .min_w(px(0.0))
                            .text_size(px(TEXT_SM))
                            .text_color(theme.muted)
                            .child("Bạn sẽ được chuyển sang trang Discord để xác minh.
Tài khoản launcher sẽ được tạo và liên kết sau khi xác minh xong."),
                    ),
            )
            .into_any_element(),
        _ => div()
            .flex()
            .flex_col()
            .gap_3()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .child(
                        div()
                            .size(px(38.0))
                            .rounded(px(9.0))
                            .bg(theme.surface_active)
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(widgets::icon("user", 18.0, theme.accent_soft)),
                    )
                    .child(
                        div()
                            .flex_1()
                            .child(widgets::text_input_box(&theme).child(app.account_name.clone())),
                    ),
            )
            .child(
                div()
                    .text_size(px(TEXT_XS))
                    .text_color(theme.faint)
                    .child("UUID được tạo chuẩn Mojang từ OfflinePlayer:tên."),
            )
            .into_any_element(),
    };

    let tab = app.account_ui.tab.clone();
    let busy = app.account_ui.ms_waiting;
    let submit_label = match tab.as_str() {
        "offline" => "Tạo",
        "discord" => "Xác minh Discord",
        _ => "Đăng nhập",
    };
    let footer_hint = match tab.as_str() {
        "offline" => "Tên chỉ gồm chữ, số, gạch dưới và dài 3–16 ký tự.",
        "microsoft" => "Cửa sổ đăng nhập Microsoft mở riêng; launcher không lưu mật khẩu.",
        "ely" => "Đăng nhập qua authserver.ely.by và tự cài authlib-injector.",
        _ => "Bạn sẽ được chuyển sang Discord để xác minh.",
    };
    let submit_bg = if tab == "discord" { discord_blue } else { theme.accent };
    let submit_fg: gpui::Rgba = if tab == "discord" { gpui::rgb(0xFFFFFF) } else { theme.on_accent };

    let content = div()
        .flex()
        .flex_col()
        .gap(px(14.0))
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(widgets::icon("user", 15.0, theme.accent_soft))
                .child(div().flex_1().text_size(px(12.0)).font_weight(bold()).text_color(theme.text).child("Thêm tài khoản"))
                .child(widgets::icon_button("acc-close", "x", &theme, {
                    let view = close_view.clone();
                    move |_, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            this.modal = Modal::None;
                            this.account_ui.open = false;
                            cx.notify();
                        });
                    }
                })),
        )
        .child(kind_row)
        .child(div().text_size(px(10.5)).text_color(theme.faint).child(description))
        .child(body)
        .when(!app.account_ui.error.is_empty(), |el| {
            el.child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .p(px(10.0))
                    .rounded(px(RADIUS_SM))
                    .bg(gpui::rgba(0xEF44441A))
                    .border_1()
                    .border_color(gpui::rgba(0xEF44444D))
                    .child(widgets::icon("warning-circle", 13.0, theme.bad))
                    .child(div().flex_1().min_w(px(0.0)).text_size(px(TEXT_SM)).text_color(theme.bad).child(app.account_ui.error.clone())),
            )
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .pt(px(4.0))
                .child(div().flex_1().text_size(px(10.0)).text_color(theme.faint).child(footer_hint))
                .child(widgets::ghost_button("acc-cancel", "Huỷ", &theme, {
                    let view = close_view.clone();
                    move |_, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            this.modal = Modal::None;
                            this.account_ui.open = false;
                            cx.notify();
                        });
                    }
                }))
                .child(
                    div()
                        .id("acc-submit")
                        .h(px(34.0))
                        .px(px(13.0))
                        .flex()
                        .items_center()
                        .gap_2()
                        .rounded(px(6.0))
                        .bg(submit_bg)
                        .text_size(px(11.0))
                        .font_weight(bold())
                        .text_color(submit_fg)
                        .when(busy, |el| el.opacity(0.4))
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let _ = submit_view.update(cx, |this, cx| {
                                if this.account_ui.ms_waiting {
                                    return;
                                }
                                match this.account_ui.tab.as_str() {
                                    "offline" => {
                                        let name = this.account_name.read(cx).text().trim().to_string();
                                        let value = this.backend.account_add_offline(&name);
                                        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                            this.refresh_accounts(cx);
                                            this.modal = Modal::None;
                                            this.account_ui.open = false;
                                            this.toast("ok", "Đã thêm tài khoản", "", cx);
                                        } else {
                                            this.account_ui.error = value
                                                .get("error")
                                                .and_then(Value::as_str)
                                                .unwrap_or("Tên không hợp lệ")
                                                .to_string();
                                            cx.notify();
                                        }
                                    }
                                    "microsoft" => {
                                        this.account_ui.error.clear();
                                        this.account_ui.ms_waiting = true;
                                        let rx = this.backend.start_ms_login();
                                        this.on_result(cx, rx, |this, value, cx| {
                                            this.account_ui.ms_waiting = false;
                                            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                this.refresh_accounts(cx);
                                                this.modal = Modal::None;
                                                this.account_ui.open = false;
                                                this.toast("ok", "Đã đăng nhập Microsoft", "", cx);
                                            } else {
                                                this.account_ui.error = value
                                                    .get("error")
                                                    .and_then(Value::as_str)
                                                    .unwrap_or("Đăng nhập Microsoft thất bại")
                                                    .to_string();
                                                cx.notify();
                                            }
                                        });
                                    }
                                    "ely" => {
                                        let user = this.ely_user.read(cx).text().to_string();
                                        let pass = this.ely_pass.read(cx).text().to_string();
                                        if user.trim().is_empty() || pass.is_empty() {
                                            this.account_ui.error = "Nhập đủ tên đăng nhập và mật khẩu ely.by.".into();
                                            cx.notify();
                                            return;
                                        }
                                        let rx = this.backend.ely_login(user, pass);
                                        this.on_result(cx, rx, |this, value, cx| {
                                            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                this.refresh_accounts(cx);
                                                this.modal = Modal::None;
                                                this.account_ui.open = false;
                                                this.toast("ok", "Đã thêm tài khoản ely.by", "", cx);
                                            } else {
                                                this.account_ui.error = value
                                                    .get("error")
                                                    .and_then(Value::as_str)
                                                    .unwrap_or("Đăng nhập ely.by thất bại")
                                                    .to_string();
                                                cx.notify();
                                            }
                                        });
                                    }
                                    _ => {
                                        let name = this.discord_name_input.read(cx).text().trim().to_string();
                                        this.account_ui.open = false;
                                        open_discord_link(this, name, String::new(), true, cx);
                                    }
                                }
                            });
                        })
                        .child(if tab == "discord" {
                            widgets::icon("discord-logo", 13.0, gpui::rgb(0xFFFFFF)).into_any_element()
                        } else if busy {
                            widgets::spinner(12.0, submit_fg).into_any_element()
                        } else {
                            widgets::icon("check-circle", 12.0, submit_fg).into_any_element()
                        })
                        .child(submit_label),
                ),
        );

    let backdrop_view = cx.entity().downgrade();
    pages::modal_overlay(theme, 560.0, content, move |_, _, cx| {
        let _ = backdrop_view.update(cx, |this, cx| {
            if !this.account_ui.ms_waiting {
                this.modal = Modal::None;
                this.account_ui.open = false;
                cx.notify();
            }
        });
    })
    .into_any_element()
}

pub fn open_discord_link(app: &mut LauncherApp, name: String, account_id: String, start: bool, cx: &mut Context<LauncherApp>) {
    app.discord_ui.open = true;
    app.discord_ui.name = name.clone();
    app.discord_ui.account_id = account_id;
    app.discord_ui.phase = "idle".into();
    app.discord_ui.error.clear();
    app.discord_ui.conflict = false;
    app.discord_ui.holder.clear();
    app.discord_ui.authorize_url.clear();
    app.discord_ui.link = Value::Null;
    app.discord_ui.created = false;
    let input = app.discord_name_input.clone();
    input.update(cx, |input, cx| input.set_text(name.clone(), cx));
    app.modal = Modal::DiscordLink;
    if start {
        app.start_discord_link(false, cx);
    } else {
        cx.notify();
    }
}

impl LauncherApp {
    pub fn start_discord_link(&mut self, force: bool, cx: &mut Context<Self>) {
        let name = self.discord_name_input.read(cx).text().trim().to_string();
        if name.is_empty() && self.discord_ui.account_id.is_empty() {
            self.discord_ui.phase = "error".into();
            self.discord_ui.error = "Nhập tên tài khoản launcher trước khi liên kết.".into();
            cx.notify();
            return;
        }
        self.discord_ui.name = name.clone();
        self.discord_ui.phase = "starting".into();
        self.discord_ui.error.clear();
        self.discord_ui.conflict = false;
        let rx = self.backend.discord_link_start(json!({
            "name": name,
            "accountId": self.discord_ui.account_id,
            "force": force,
        }));
        self.on_result(cx, rx, |this, value, cx| {
            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                this.discord_ui.phase = "waiting".into();
                this.discord_ui.authorize_url = value
                    .get("authorizeUrl")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
            } else {
                this.discord_ui.phase = "error".into();
                this.discord_ui.error = value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Không bắt đầu được liên kết Discord.")
                    .to_string();
            }
            cx.notify();
        });
    }
}

pub fn discord_link_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let discord_blue = gpui::rgb(0x5865F2);
    let close_view = cx.entity().downgrade();
    let start_view = cx.entity().downgrade();
    let cancel_view = cx.entity().downgrade();
    let override_view = cx.entity().downgrade();
    let reopen_view = cx.entity().downgrade();
    let phase = app.discord_ui.phase.clone();
    let link = app.discord_ui.link.clone();
    let account_name = if app.discord_ui.account_id.is_empty() {
        app.discord_ui.name.clone()
    } else {
        app.accounts
            .iter()
            .find(|row| row.id == app.discord_ui.account_id)
            .map(|row| row.name.clone())
            .unwrap_or_else(|| app.discord_ui.name.clone())
    };
    let avatar_url = link
        .get("discordAvatar")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let avatar = app.icon_cache.get(&avatar_url).cloned();
    let tag = link
        .get("discordTag")
        .or_else(|| link.get("discordName"))
        .and_then(Value::as_str)
        .unwrap_or("Discord")
        .to_string();

    let body: AnyElement = match phase.as_str() {
        "done" => div()
            .flex()
            .flex_col()
            .gap_3()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .p(px(12.0))
                    .rounded(px(RADIUS))
                    .bg(theme.elevated)
                    .border_1()
                    .border_color(theme.accent)
                    .child(widgets::icon("check-circle", 20.0, theme.accent_soft))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w(px(0.0))
                            .child(div().text_size(px(TEXT_MD)).font_weight(semibold()).text_color(theme.text).child("Đã liên kết Discord"))
                            .child(div().text_size(px(11.0)).text_color(theme.muted).truncate().child(format!("{tag} → {account_name}"))),
                    )
                    .when_some(avatar, |el, path| {
                        el.child(gpui::img(path).size(px(36.0)).rounded_full().object_fit(gpui::ObjectFit::Cover))
                    }),
            )
            .when(app.discord_ui.created, |el| {
                el.child(div().text_size(px(10.5)).text_color(theme.accent_soft).child(format!("Đã tạo tài khoản launcher {account_name}.")))
            })
            .child(div().text_size(px(10.5)).text_color(theme.faint).child("Tài khoản đã sẵn sàng dùng để chơi và đã có huy hiệu Discord trong danh sách tài khoản."))
            .into_any_element(),
        _ => {
            let mut card = div()
                .flex()
                .flex_col()
                .gap_3()
                .child(
                    div()
                        .text_size(px(10.5))
                        .text_color(theme.faint)
                        .child("Kết quả uỷ quyền được gửi về launcher qua cổng nội bộ 127.0.0.1."),
                );
            if phase == "waiting" || phase == "starting" {
                card = card.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .p(px(12.0))
                        .rounded(px(RADIUS))
                        .bg(theme.elevated)
                        .border_1()
                        .border_color(theme.border)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(widgets::spinner(13.0, theme.accent_soft))
                                .child(div().text_size(px(TEXT_SM)).font_weight(semibold()).text_color(theme.text).child(
                                    if phase == "starting" { "Đang mở trang Discord…" } else { "Đang chờ Discord xác minh…" },
                                )),
                        )
                        .child(div().text_size(px(10.0)).text_color(theme.faint).child("Hoàn tất cấp quyền trong trình duyệt rồi quay lại đây."))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(div()
                                    .id("discord-reopen")
                                    .h(px(30.0)).px(px(10.0)).flex().items_center().rounded(px(6.0))
                                    .bg(discord_blue).text_size(px(10.0)).font_weight(bold()).text_color(gpui::white()).cursor_pointer()
                                    .on_click(move |_, _, cx| {
                                        let _ = reopen_view.update(cx, |this, _cx| {
                                            if !this.discord_ui.authorize_url.is_empty() {
                                                let _ = open::that(&this.discord_ui.authorize_url);
                                            }
                                        });
                                    })
                                    .child("Mở lại trang Discord"))
                                .child(widgets::ghost_button("discord-cancel", "Huỷ chờ", &theme, move |_, _, cx| {
                                    let _ = cancel_view.update(cx, |this, cx| {
                                        this.backend.discord_cancel();
                                        this.discord_ui.phase = "idle".into();
                                        this.discord_ui.error.clear();
                                        cx.notify();
                                    });
                                })),
                        ),
                );
            } else {
                let mut field = div().flex().items_center().gap_3();
                if !app.discord_ui.account_id.is_empty() {
                    field = field.child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .flex_1()
                            .p(px(10.0))
                            .rounded(px(RADIUS_SM))
                            .bg(theme.elevated)
                            .border_1()
                            .border_color(theme.border)
                            .child(widgets::icon("user", 14.0, theme.accent_soft))
                            .child(div().text_size(px(TEXT_SM)).text_color(theme.text).child(account_name.clone())),
                    );
                } else {
                    field = field.child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .flex_1()
                            .child(div().text_size(px(10.0)).font_weight(bold()).text_color(theme.muted).child("Tên tài khoản launcher"))
                            .child(widgets::text_input_box(&theme).child(app.discord_name_input.clone())),
                    );
                }
                card = card
                    .child(field)
                    .child(
                        div()
                            .flex()
                            .items_start()
                            .gap_2()
                            .p(px(10.0))
                            .rounded(px(RADIUS_SM))
                            .bg(theme.elevated)
                            .border_1()
                            .border_color(theme.border)
                            .child(widgets::icon("discord-logo", 14.0, discord_blue))
                            .child(
                                div()
                                    .flex_1()
                                    .text_size(px(10.5))
                                    .text_color(theme.muted)
                                    .child(if app.discord_ui.account_id.is_empty() {
                                        "Một tài khoản launcher mới sẽ được tạo nếu tên chưa tồn tại."
                                    } else {
                                        "Tài khoản này sẽ được gắn huy hiệu Discord sau khi xác minh."
                                    }),
                            ),
                    );
                if phase == "error" {
                    let mut error_box = div()
                        .flex()
                        .items_start()
                        .gap_2()
                        .p(px(10.0))
                        .rounded(px(RADIUS_SM))
                        .bg(gpui::rgba(0xEF44441A))
                        .border_1()
                        .border_color(gpui::rgba(0xEF44444D))
                        .child(widgets::icon("warning-circle", 13.0, theme.bad))
                        .child(div().flex_1().text_size(px(10.5)).text_color(theme.bad).child(app.discord_ui.error.clone()));
                    if app.discord_ui.conflict {
                        let holder = app.discord_ui.holder.clone();
                        error_box = error_box.child(widgets::ghost_button("discord-override", "Ghi đè liên kết cũ", &theme, move |_, _, cx| {
                            let _ = override_view.update(cx, |this, cx| {
                                let _ = holder;
                                this.start_discord_link(true, cx);
                            });
                        }));
                    }
                    card = card.child(error_box);
                }
            }
            card.into_any_element()
        }
    };

    let footer = if phase == "done" {
        div()
            .flex()
            .justify_end()
            .child(widgets::button("discord-done", "Xong", &theme, true, {
                let view = close_view.clone();
                move |_, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.discord_ui.open = false;
                        this.modal = Modal::None;
                        cx.notify();
                    });
                }
            }))
    } else if phase == "waiting" || phase == "starting" {
        div()
    } else {
        div()
            .flex()
            .items_center()
            .gap_2()
            .child(div().flex_1().text_size(px(10.0)).text_color(theme.faint).child("Xác minh để gắn huy hiệu Discord vào tài khoản launcher."))
            .child(widgets::ghost_button("discord-close", "Huỷ", &theme, {
                let view = close_view.clone();
                move |_, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.backend.discord_cancel();
                        this.discord_ui.open = false;
                        this.modal = Modal::None;
                        cx.notify();
                    });
                }
            }))
            .child(
                div()
                    .id("discord-start")
                    .h(px(34.0))
                    .px(px(12.0))
                    .flex()
                    .items_center()
                    .gap_2()
                    .rounded(px(6.0))
                    .bg(discord_blue)
                    .text_size(px(11.0))
                    .font_weight(bold())
                    .text_color(gpui::white())
                    .cursor_pointer()
                    .on_click(move |_, _, cx| {
                        let _ = start_view.update(cx, |this, cx| this.start_discord_link(false, cx));
                    })
                    .child(widgets::icon("discord-logo", 13.0, gpui::rgb(0xFFFFFF)))
                    .child("Xác minh Discord"),
            )
    };

    let content = div()
        .flex()
        .flex_col()
        .gap(px(14.0))
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(widgets::icon("discord-logo", 16.0, discord_blue))
                .child(div().flex_1().text_size(px(12.0)).font_weight(bold()).text_color(theme.text).child("Liên kết Discord"))
                .child(widgets::icon_button("discord-x", "x", &theme, {
                    let view = close_view.clone();
                    move |_, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            if this.discord_ui.phase == "waiting" || this.discord_ui.phase == "starting" {
                                this.backend.discord_cancel();
                            }
                            this.discord_ui.open = false;
                            this.modal = Modal::None;
                            cx.notify();
                        });
                    }
                })),
        )
        .child(body)
        .child(footer);

    let backdrop_view = cx.entity().downgrade();
    pages::modal_overlay(theme, 520.0, content, move |_, _, cx| {
        let _ = backdrop_view.update(cx, |this, cx| {
            if this.discord_ui.phase == "waiting" || this.discord_ui.phase == "starting" {
                return;
            }
            this.discord_ui.open = false;
            this.modal = Modal::None;
            cx.notify();
        });
    })
    .into_any_element()
}
