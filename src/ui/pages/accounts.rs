use crate::ui::app::{ConfirmAction, LauncherApp, Modal};
use crate::ui::pages::{self, page_body, page_header, section_title};
use crate::ui::theme::*;
use crate::ui::widgets;
use gpui::{AnyElement, Context, FontWeight, IntoElement, Window, div, prelude::*, px};
use serde_json::Value;
use std::path::Path;

pub fn render(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let add_view = view.clone();
    let refresh_view = view.clone();

    let mut list = div().flex().gap_3().flex_wrap();
    if app.accounts.is_empty() {
        list = list.child(
            div()
                .w_full()
                .child(pages::empty_state(
                    &theme,
                    "user",
                    "Chưa có tài khoản nào",
                    "Thêm tài khoản ngoại tuyến, Microsoft hoặc ely.by để bắt đầu chơi.",
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
        let head = if account.kind == "offline" {
            let skin = app.backend.skin_read(&account.uuid);
            skin.get("skinPath")
                .and_then(Value::as_str)
                .and_then(|path| {
                    crate::mc::skins::head_png(
                        &app.backend.store,
                        Path::new(path),
                        &account.uuid,
                    )
                })
        } else {
            None
        };
        let view_use = view.clone();
        let view_copy = view.clone();
        let view_refresh = view.clone();
        let view_remove = view.clone();
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
                                    this.refresh_accounts();
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
                        this.skin_ui.uuid = uuid;
                        this.skin_ui.skin_path = None;
                        this.skin_ui.cape_path = None;
                        this.skin_ui.message.clear();
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
    let skin_image = skin
        .get("skinPath")
        .and_then(Value::as_str)
        .and_then(|path| {
            crate::mc::skins::front_png(
                &app.backend.store,
                Path::new(path),
                &app.skin_ui.uuid,
            )
        })
        .map(|path| path.to_string_lossy().into_owned());
    let cape_image = skin
        .get("capePath")
        .and_then(Value::as_str)
        .map(str::to_string);
    let skin_head = skin
        .get("skinPath")
        .and_then(Value::as_str)
        .and_then(|path| crate::mc::skins::head_png(&app.backend.store, Path::new(path), &app.skin_ui.uuid));

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
                        cx.notify();
                    });
                }
            })
            .detach();
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
                .child(widgets::ghost_button("acc-refresh", "Làm mới", &theme, move |_, _, cx| {
                    let _ = refresh_view.update(cx, |this, cx| {
                        this.refresh_accounts();
                        cx.notify();
                    });
                }))
                .child(widgets::button("acc-add", "Thêm tài khoản", &theme, true, move |_, _, cx| {
                    let _ = add_view.update(cx, |this, cx| {
                        this.modal = Modal::AddAccount;
                        this.account_ui.open = true;
                        this.account_ui.error.clear();
                        this.account_ui.ms_waiting = false;
                        this.account_ui.ms_code.clear();
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
                .child("Hỗ trợ Ngoại tuyến, Microsoft (vào được server online) và ely.by. Phiên đăng nhập được lưu trên máy và tự làm mới.")
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
                                .child(
                                    div()
                                        .w(px(170.0))
                                        .h(px(170.0))
                                        .rounded(px(RADIUS))
                                        .bg(theme.elevated)
                                        .border_1()
                                        .border_color(theme.border_soft)
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .truncate()
                                        .when_some(skin_image.clone(), |el, path| {
                                            el.child(
                                                gpui::img(path)
                                                    .size(px(160.0))
                                                    .object_fit(gpui::ObjectFit::Contain),
                                            )
                                        })
                                        .when(skin_image.is_none(), |el| {
                                            el.child(widgets::icon("image", 34.0, theme.faint))
                                        }),
                                )
                                .child(
                                    div()
                                        .w(px(120.0))
                                        .h(px(170.0))
                                        .rounded(px(RADIUS))
                                        .bg(theme.elevated)
                                        .border_1()
                                        .border_color(theme.border_soft)
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .truncate()
                                        .when_some(cape_image.clone(), |el, path| {
                                            el.child(
                                                gpui::img(path)
                                                    .size(px(110.0))
                                                    .object_fit(gpui::ObjectFit::Contain),
                                            )
                                        })
                                        .when(cape_image.is_none(), |el| {
                                            el.child(widgets::icon("shield", 30.0, theme.faint))
                                        }),
                                )
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
    let close_view2 = close_view.clone();
    let tab_view = cx.entity().downgrade();
    let offline_view = cx.entity().downgrade();
    let ms_view = cx.entity().downgrade();
    let ely_view = cx.entity().downgrade();

    let tabs = [("offline", "Ngoại tuyến"), ("microsoft", "Microsoft"), ("ely", "ely.by")];
    let mut tab_row = div().flex().gap_2();
    for (key, label) in tabs {
        let active = app.account_ui.tab == key;
        let view = tab_view.clone();
        let key = key.to_string();
        tab_row = tab_row.child(
            div()
                .id(gpui::SharedString::from(format!("acc-tab-{key}")))
                .h(px(32.0))
                .px(px(12.0))
                .flex()
                .items_center()
                .rounded(px(6.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .text_size(px(TEXT_SM))
                .font_weight(if active { semibold() } else { medium() })
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let key = key.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.account_ui.tab = key;
                        this.account_ui.error.clear();
                        cx.notify();
                    });
                })
                .child(label),
        );
    }

    let body = match app.account_ui.tab.as_str() {
        "microsoft" => {
            let waiting = app.account_ui.ms_waiting;
            let code = app.account_ui.ms_code.clone();
            let uri = app.account_ui.ms_uri.clone();
            div()
                .flex()
                .flex_col()
                .gap_3()
                .child(
                    div()
                        .text_size(px(TEXT_SM))
                        .text_color(theme.muted)
                        .child("Đăng nhập bằng tài khoản Microsoft đã sở hữu Minecraft Java Edition. Mã sẽ hiện bên dưới — nhập mã tại trang Microsoft rồi quay lại đây."),
                )
                .when(code.is_empty(), |el| {
                    el.child(widgets::button("ms-start", "Mở trang đăng nhập", &theme, true, move |_, _, cx| {
                        let view = ms_view.clone();
                        let _ = view.update(cx, |this, cx| {
                            this.account_ui.ms_waiting = true;
                            this.account_ui.error.clear();
                            let rx = this.backend.start_ms_login();
                            this.on_result(cx, rx, |this, value, _cx| {
                                if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                    this.account_ui.ms_code = value
                                        .get("userCode")
                                        .and_then(Value::as_str)
                                        .unwrap_or("")
                                        .to_string();
                                    this.account_ui.ms_uri = value
                                        .get("verificationUri")
                                        .and_then(Value::as_str)
                                        .unwrap_or("https://www.microsoft.com/link")
                                        .to_string();
                                } else {
                                    this.account_ui.ms_waiting = false;
                                    this.account_ui.error = value
                                        .get("error")
                                        .and_then(Value::as_str)
                                        .unwrap_or("Không tạo được mã đăng nhập")
                                        .to_string();
                                }
                            });
                        });
                    }))
                })
                .when(!code.is_empty(), |el| {
                    el.child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .items_center()
                            .p(px(18.0))
                            .rounded(px(RADIUS))
                            .bg(theme.surface)
                            .border_1()
                            .border_color(theme.border)
                            .child(
                                div()
                                    .text_size(px(TEXT_XS))
                                    .text_color(theme.faint)
                                    .child("MÃ ĐĂNG NHẬP"),
                            )
                            .child(
                                div()
                                    .text_size(px(32.0))
                                    .font_weight(bold())
                                    .text_color(theme.accent_soft)
                                    .child(code.clone()),
                            )
                            .child(
                                div()
                                    .text_size(px(TEXT_SM))
                                    .text_color(theme.muted)
                                    .child(format!("Nhập mã tại {uri}")),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .when(waiting, |el| {
                                        el.child(widgets::spinner(14.0, theme.accent_soft))
                                            .child(
                                                div()
                                                    .text_size(px(TEXT_SM))
                                                    .text_color(theme.muted)
                                                    .child("Đang chờ bạn hoàn tất đăng nhập…"),
                                            )
                                    })
                                    .child(widgets::ghost_button("ms-open", "Mở lại trang", &theme, {
                                        let uri = uri.clone();
                                        move |_, _, _cx| {
                                            let _ = open::that(&uri);
                                        }
                                    })),
                            ),
                    )
                })
        }
        "ely" => div()
            .flex()
            .flex_col()
            .gap_3()
            .child(
                div()
                    .text_size(px(TEXT_SM))
                    .text_color(theme.muted)
                    .child("Tài khoản ely.by qua authlib-injector: chơi được trên server có bật ely.by và dùng skin của ely.by."),
            )
            .child(pages::field(&theme, "Tên đăng nhập hoặc email", app.ely_user.clone(), ""))
            .child(pages::field(&theme, "Mật khẩu", app.ely_pass.clone(), "Mật khẩu chỉ gửi trực tiếp tới authserver.ely.by."))
            .child(widgets::button("ely-login", "Đăng nhập ely.by", &theme, true, move |_, _, cx| {
                let view = ely_view.clone();
                let _ = view.update(cx, |this, cx| {
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
                            this.refresh_accounts();
                            this.modal = Modal::None;
                            this.account_ui.open = false;
                            this.toast("ok", "Đã thêm tài khoản ely.by", "", cx);
                        } else {
                            this.account_ui.error = value
                                .get("error")
                                .and_then(Value::as_str)
                                .unwrap_or("Đăng nhập ely.by thất bại")
                                .to_string();
                        }
                    });
                });
            }))
        ,
        _ => div()
            .flex()
            .flex_col()
            .gap_3()
            .child(
                div()
                    .text_size(px(TEXT_SM))
                    .text_color(theme.muted)
                    .child("Chơi không cần tài khoản Mojang. Tên chỉ gồm chữ, số, gạch dưới và dài 3–16 ký tự."),
            )
            .child(pages::field(&theme, "Tên người chơi", app.name_input.clone(), "UUID được tạo chuẩn Mojang từ OfflinePlayer:tên."))
            .child(widgets::button("off-add", "Thêm tài khoản", &theme, true, move |_, _, cx| {
                let view = offline_view.clone();
                let _ = view.update(cx, |this, cx| {
                    let name = this.name_input.read(cx).text().to_string();
                    let value = this.backend.account_add_offline(&name);
                    if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                        this.refresh_accounts();
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
                });
            })),
    };

    let content = div()
        .flex()
        .flex_col()
        .gap_4()
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(TEXT_XL))
                        .font_weight(semibold())
                        .text_color(theme.text)
                        .child("Thêm tài khoản"),
                )
                .child(widgets::icon_button("acc-close", "x", &theme, move |_, _, cx| {
                    let _ = close_view2.update(cx, |this, cx| {
                        this.modal = Modal::None;
                        this.account_ui.open = false;
                        cx.notify();
                    });
                })),
        )
        .child(tab_row)
        .child(if app.account_ui.ms_waiting && app.account_ui.ms_code.is_empty() {
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(widgets::spinner(14.0, theme.accent_soft))
                .child("Đang tạo mã đăng nhập…")
                .into_any_element()
        } else {
            body.into_any_element()
        })
        .when(!app.account_ui.error.is_empty(), |el| {
            el.child(
                div()
                    .text_size(px(TEXT_SM))
                    .text_color(theme.bad)
                    .child(app.account_ui.error.clone()),
            )
        });

    let backdrop_view = cx.entity().downgrade();
    pages::modal_overlay(theme.clone(), 560.0, content, move |_, _, cx| {
        let _ = backdrop_view.update(cx, |this, cx| {
            this.modal = Modal::None;
            this.account_ui.open = false;
            cx.notify();
        });
    })
    .into_any_element()
}
