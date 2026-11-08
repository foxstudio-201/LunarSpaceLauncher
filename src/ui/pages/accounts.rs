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
    if !app.discord_ui.links_loaded {
        app.discord_ui.links_loaded = true;
        app.load_discord_links(cx);
    }
    let list = app.accounts.clone();
    let count = list.len();
    let view_add = view.clone();
    let view_discord = view.clone();
    let view_tab = view.clone();
    let header = page_header(
        &theme,
        "Tài khoản",
        "Tài khoản dùng khi khởi chạy game",
        div()
            .flex()
            .items_center()
            .gap_2()
            .child(
                div()
                    .text_size(px(10.0))
                    .font_family(MONO)
                    .text_color(theme.faint)
                    .child(format!("{count} tài khoản")),
            )
            .child(widgets::ghost_button(
                "acc-discord-header",
                "Liên kết Discord",
                &theme,
                move |_, _, cx| {
                    let _ = view_discord.update(cx, |this, cx| {
                        let input = this.discord_name_input.clone();
                        input.update(cx, |input, cx| input.clear(cx));
                        open_discord_link(this, String::new(), String::new(), false, cx);
                    });
                },
            ))
            .child(widgets::button(
                "acc-add",
                "Thêm tài khoản",
                &theme,
                true,
                move |_, _, cx| {
                    let _ = view_add.update(cx, |this, cx| {
                        this.modal = Modal::AddAccount;
                        this.account_ui.open = true;
                        this.account_ui.error.clear();
                        this.account_ui.ms_waiting = false;
                        cx.notify();
                    });
                },
            )),
    );
    let tab_row = div()
        .flex()
        .items_center()
        .gap(px(4.0))
        .child({
            let view = view_tab.clone();
            div()
                .id("acc-tab-list")
                .h(px(30.0))
                .px(px(12.0))
                .rounded(px(8.0))
                .flex()
                .items_center()
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border)
                .text_size(px(11.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text)
                .child("Danh sách tài khoản")
        })
        .child({
            let view = view_tab.clone();
            div()
                .id("acc-tab-skin")
                .h(px(30.0))
                .px(px(12.0))
                .rounded(px(8.0))
                .flex()
                .items_center()
                .text_size(px(11.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.faint)
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.accounts_tab = "skin".into();
                        cx.notify();
                    });
                })
                .child("Skin")
        });
    let hint = div()
        .w_full()
        .flex()
        .items_start()
        .gap(px(7.0))
        .p(px(10.0))
        .rounded(px(8.0))
        .bg(theme.elevated)
        .border_1()
        .border_color(theme.border_soft)
        .text_size(px(10.5))
        .line_height(px(15.0))
        .text_color(theme.muted)
        .child(widgets::icon("info", 13.0, theme.accent_soft))
        .child("Hỗ trợ Ngoại tuyến, Microsoft (vào được server online), ely.by và liên kết Discord. Phiên đăng nhập được lưu trên máy và tự làm mới.");

    let mut rows = div()
        .w_full()
        .rounded(px(RADIUS_LG))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft)
        .overflow_hidden()
        .flex()
        .flex_col();
    if list.is_empty() {
        rows = rows.child(
            div()
                .w_full()
                .py(px(56.0))
                .flex()
                .flex_col()
                .items_center()
                .gap(px(6.0))
                .child(widgets::icon("user", 28.0, theme.faint))
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.muted)
                        .child("Chưa có tài khoản nào"),
                )
                .child(
                    div()
                        .text_size(px(9.5))
                        .text_color(theme.faint)
                        .child("Thêm tài khoản ngoại tuyến, Microsoft, ely.by hoặc Discord để bắt đầu."),
                ),
        );
    }
    for (index, account) in list.iter().cloned().enumerate() {
        let active = app.active_account.as_deref() == Some(account.id.as_str());
        let online = account.kind != "offline";
        let kind_label = match account.kind.as_str() {
            "microsoft" => "Microsoft",
            "ely" => "ely.by",
            _ => "Ngoại tuyến",
        };
        let head = app.account_heads.get(&account.uuid).cloned();
        let link = app
            .discord_ui
            .links
            .iter()
            .find(|row| {
                row.get("accountUuid").and_then(Value::as_str) == Some(account.uuid.as_str())
                    || row.get("accountId").and_then(Value::as_str) == Some(account.id.as_str())
            })
            .cloned();
        let view_use = view.clone();
        let view_copy = view.clone();
        let view_refresh = view.clone();
        let view_delete = view.clone();
        let view_unlink = view.clone();
        let view_link = view.clone();
        let id_use = account.id.clone();
        let id_delete = account.id.clone();
        let id_unlink = account.id.clone();
        let id_refresh = account.id.clone();
        let uuid = account.uuid.clone();
        let account_name = account.name.clone();
        let account_id = account.id.clone();
        let mut row = div()
            .id(gpui::SharedString::from(format!("acc-row-{}", account.id)))
            .w_full()
            .flex()
            .items_center()
            .gap(px(12.0))
            .px(px(14.0))
            .py(px(12.0))
            .when(index > 0, |el| el.border_t_1().border_color(theme.border_soft))
            .child(
                div()
                    .size(px(40.0))
                    .flex_shrink_0()
                    .rounded(px(9.0))
                    .bg(theme.elevated)
                    .border_1()
                    .border_color(theme.border_soft)
                    .overflow_hidden()
                    .flex()
                    .items_center()
                    .justify_center()
                    .when_some(head, |el, path| {
                        el.child(
                            gpui::img(path)
                                .size(px(40.0))
                                .object_fit(gpui::ObjectFit::Cover),
                        )
                    })
                    .when(account_heads_missing(app, &account.uuid), |el| {
                        el.child(
                            div()
                                .text_size(px(16.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(theme.accent_soft)
                                .child(
                                    account_name
                                        .chars()
                                        .next()
                                        .unwrap_or('?')
                                        .to_uppercase()
                                        .to_string(),
                                ),
                        )
                    }),
            )
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.0))
                    .flex()
                    .flex_col()
                    .gap(px(3.0))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(7.0))
                            .child(
                                div()
                                    .text_size(px(12.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(theme.text)
                                    .truncate()
                                    .child(account_name.clone()),
                            )
                            .child(
                                div()
                                    .h(px(17.0))
                                    .px(px(5.0))
                                    .rounded(px(4.0))
                                    .bg(if online { theme.accent_dim } else { theme.elevated })
                                    .flex()
                                    .items_center()
                                    .text_size(px(8.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(if online { theme.accent_soft } else { theme.muted })
                                    .child(kind_label.to_uppercase()),
                            )
                            .when_some(link.clone(), |el, link| {
                                let label = link
                                    .get("label")
                                    .or_else(|| link.get("discordName"))
                                    .or_else(|| link.get("discordTag"))
                                    .and_then(Value::as_str)
                                    .unwrap_or("Discord")
                                    .to_string();
                                el.child(
                                    div()
                                        .h(px(17.0))
                                        .px(px(5.0))
                                        .rounded(px(4.0))
                                        .bg(gpui::rgba(0x5865F22A))
                                        .flex()
                                        .items_center()
                                        .gap(px(4.0))
                                        .text_size(px(8.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(gpui::rgb(0x8B95F7))
                                        .child(widgets::icon("discord-logo", 9.0, gpui::rgb(0x8B95F7)))
                                        .child(label),
                                )
                            }),
                    )
                    .child(
                        div()
                            .id(gpui::SharedString::from(format!("acc-uuid-{}", account.id)))
                            .flex()
                            .items_center()
                            .gap(px(5.0))
                            .max_w_full()
                            .cursor_pointer()
                            .on_click(move |_, _, cx| {
                                let uuid = uuid.clone();
                                cx.write_to_clipboard(gpui::ClipboardItem::new_string(uuid.clone()));
                                let _ = view_copy.update(cx, |this, cx| {
                                    this.toast("ok", "Đã sao chép UUID", uuid, cx);
                                });
                            })
                            .child(
                                div()
                                    .text_size(px(9.5))
                                    .font_family(MONO)
                                    .text_color(theme.faint)
                                    .truncate()
                                    .child(account.uuid.clone()),
                            )
                            .child(widgets::icon("copy", 10.0, theme.faint)),
                    ),
            )
            .when_some(link, |el, _| {
                let view = view_unlink.clone();
                let id = id_unlink.clone();
                el.child(
                    div()
                        .id(gpui::SharedString::from(format!("acc-unlink-{}", account_id)))
                        .size(px(28.0))
                        .rounded(px(7.0))
                        .bg(gpui::rgba(0x5865F21F))
                        .border_1()
                        .border_color(gpui::rgba(0x5865F266))
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let id = id.clone();
                            let _ = view.update(cx, |this, cx| {
                                let rx = this.backend.discord_unlink(id);
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
                        .child(widgets::icon("x", 11.0, gpui::rgb(0x8B95F7))),
                )
            })
            .when(link_is_none(app, &account), |el| {
                let view = view_link.clone();
                let id = account.id.clone();
                let name = account.name.clone();
                el.child(
                    div()
                        .id(gpui::SharedString::from(format!("acc-link-{}", account.id)))
                        .h(px(28.0))
                        .px(px(8.0))
                        .rounded(px(6.0))
                        .bg(gpui::rgba(0x5865F21F))
                        .border_1()
                        .border_color(gpui::rgba(0x5865F259))
                        .flex()
                        .items_center()
                        .gap(px(5.0))
                        .text_size(px(9.5))
                        .font_weight(FontWeight::BOLD)
                        .text_color(gpui::rgb(0x8B95F7))
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let id = id.clone();
                            let name = name.clone();
                            let _ = view.update(cx, |this, cx| {
                                open_discord_link(this, name, id, true, cx);
                            });
                        })
                        .child(widgets::icon("discord-logo", 11.0, gpui::rgb(0x8B95F7)))
                        .child("Liên kết"),
                )
            })
            .when(online, |el| {
                let view = view_refresh.clone();
                let id = id_refresh.clone();
                el.child(
                    div()
                        .id(gpui::SharedString::from(format!("acc-refresh-{}", id)))
                        .size(px(28.0))
                        .rounded(px(7.0))
                        .bg(theme.elevated)
                        .border_1()
                        .border_color(theme.border_soft)
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let id = id.clone();
                            let _ = view.update(cx, |this, cx| {
                                let rx = this.backend.account_refresh(id);
                                this.on_result(cx, rx, |this, value, cx| {
                                    if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                        this.refresh_accounts(cx);
                                        this.toast("ok", "Đã làm mới phiên đăng nhập", "", cx);
                                    } else {
                                        this.toast("bad", "Làm mới thất bại", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                                    }
                                });
                            });
                        })
                        .child(widgets::icon("arrow-clockwise", 12.0, theme.muted)),
                )
            })
            .child(if active {
                div()
                    .h(px(26.0))
                    .px(px(8.0))
                    .rounded(px(5.0))
                    .bg(theme.accent_dim)
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .text_size(px(9.5))
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.accent_soft)
                    .child(widgets::icon("check", 10.0, theme.accent_soft))
                    .child("Đang dùng")
                    .into_any_element()
            } else {
                div()
                    .id(gpui::SharedString::from(format!("acc-use-{}", account.id)))
                    .h(px(26.0))
                    .px(px(9.0))
                    .rounded(px(5.0))
                    .bg(theme.elevated)
                    .border_1()
                    .border_color(theme.border)
                    .flex()
                    .items_center()
                    .text_size(px(9.5))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.muted)
                    .cursor_pointer()
                    .on_click(move |_, _, cx| {
                        let id = id_use.clone();
                        let _ = view_use.update(cx, |this, cx| {
                            let value = this.backend.account_set_active(&id);
                            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                this.refresh_accounts(cx);
                                this.toast("ok", "Đã chọn tài khoản", "", cx);
                            }
                        });
                    })
                    .child("Dùng")
                    .into_any_element()
            })
            .child(
                div()
                    .id(gpui::SharedString::from(format!("acc-delete-{}", account.id)))
                    .size(px(28.0))
                    .rounded(px(7.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .cursor_pointer()
                    .hover(|style| style.bg(gpui::rgba(0xf871711a)))
                    .on_click(move |_, _, cx| {
                        let id = id_delete.clone();
                        let _ = view_delete.update(cx, |this, cx| {
                            let value = this.backend.account_remove(&id);
                            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                this.refresh_accounts(cx);
                                this.toast("ok", "Đã xoá tài khoản", "", cx);
                            }
                        });
                    })
                    .child(widgets::icon("trash", 13.0, theme.bad)),
            );
        rows = rows.child(row);
    }
    let content = div()
        .w_full()
        .max_w(px(768.0))
        .mx_auto()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .child(hint)
        .child(rows);
    page_body()
        .child(header)
        .child(tab_row)
        .child(content)
        .into_any_element()
}

fn account_heads_missing(app: &LauncherApp, uuid: &str) -> bool {
    !app.account_heads.contains_key(uuid)
}

fn link_is_none(app: &LauncherApp, account: &crate::models::Account) -> bool {
    !app.discord_ui.links.iter().any(|row| {
        row.get("accountUuid").and_then(Value::as_str) == Some(account.uuid.as_str())
            || row.get("accountId").and_then(Value::as_str) == Some(account.id.as_str())
    })
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
