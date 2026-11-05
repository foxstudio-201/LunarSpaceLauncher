use crate::ui::app::{ConfirmAction, LauncherApp, Modal};
use crate::ui::pages::{self, page_body, page_header, section_title};
use crate::ui::theme::*;
use crate::ui::widgets;
use gpui::{AnyElement, Context, IntoElement, Window, div, prelude::*, px};
use serde_json::{Value, json};
use std::path::Path;

const EGGS: [(&str, &str); 6] = [
    ("vanilla", "Vanilla"),
    ("paper", "Paper"),
    ("purpur", "Purpur"),
    ("fabric", "Fabric"),
    ("forge", "Forge"),
    ("neoforge", "NeoForge"),
];

fn egg_label(egg: &str) -> &'static str {
    EGGS.iter().find(|(key, _)| *key == egg).map(|(_, label)| *label).unwrap_or("Vanilla")
}

fn status_color(status: &str, theme: &Theme) -> gpui::Rgba {
    match status {
        "online" => theme.ok,
        "starting" | "installing" | "stopping" => theme.warn,
        "error" => theme.bad,
        _ => theme.faint,
    }
}

fn status_label(status: &str) -> &'static str {
    match status {
        "online" => "Đang chạy",
        "starting" => "Đang khởi động",
        "installing" => "Đang cài đặt",
        "stopping" => "Đang dừng",
        "error" => "Lỗi",
        _ => "Ngoại tuyến",
    }
}

fn selected_server(app: &LauncherApp) -> Option<Value> {
    let id = app.server_ui.selected.as_ref()?;
    app.server_ui
        .servers
        .iter()
        .find(|row| row.get("id").and_then(Value::as_str) == Some(id.as_str()))
        .cloned()
}

pub fn render(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    if let Some(server) = selected_server(app) {
        if app.server_ui.editor_open {
            return render_editor(app, cx, &server).into_any_element();
        }
        return render_detail(app, cx, &server).into_any_element();
    }
    render_list(app, cx).into_any_element()
}

fn render_list(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) -> impl IntoElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let mut instance_chips = div().flex().items_center().gap_2().flex_wrap();
    for instance in app.instances.iter().cloned().collect::<Vec<_>>() {
        let active = app.server_ui.instance_id == instance.id;
        let view = view.clone();
        let id = instance.id.clone();
        let name = instance.name.clone();
        let version = instance.version.clone();
        instance_chips = instance_chips.child(
            div()
                .id(gpui::SharedString::from(format!("srv-inst-{}", instance.id)))
                .flex().items_center().gap_2().h(px(32.0)).px(px(10.0))
                .rounded(px(6.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1().border_color(if active { theme.accent } else { theme.border_soft })
                .text_size(px(TEXT_SM)).text_color(if active { theme.text } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let id = id.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.server_ui.instance_id = id;
                        cx.notify();
                    });
                })
                .child(widgets::icon("cube", 13.0, if active { theme.accent_soft } else { theme.faint }))
                .child(name)
                .child(div().text_size(px(TEXT_XS)).text_color(theme.faint).child(version)),
        );
    }
    let mut egg_chips = div().flex().gap_2().flex_wrap();
    for (key, label) in EGGS {
        let active = app.server_ui.egg == key;
        let view = view.clone();
        let key = key.to_string();
        egg_chips = egg_chips.child(
            div()
                .id(gpui::SharedString::from(format!("srv-egg-{key}")))
                .h(px(30.0)).px(px(12.0)).flex().items_center().rounded(px(6.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1().border_color(if active { theme.accent } else { theme.border_soft })
                .text_size(px(TEXT_SM)).font_weight(if active { semibold() } else { medium() })
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let key = key.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.server_ui.egg = key;
                        cx.notify();
                    });
                })
                .child(label.to_string()),
        );
    }

    let mut cards = div().flex().gap_3().flex_wrap();
    if app.server_ui.servers.is_empty() {
        cards = cards.child(div().w_full().child(pages::empty_state(
            &theme, "hard-drives", "Chưa có server nào", "Chọn một phiên bản và tạo máy chủ đầu tiên.",
        )));
    }
    for server in app.server_ui.servers.iter().cloned().collect::<Vec<_>>() {
        let id = server.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        let name = server.get("name").and_then(Value::as_str).unwrap_or("Server").to_string();
        let mc = server.get("mc").and_then(Value::as_str).unwrap_or("").to_string();
        let egg = server.get("egg").and_then(Value::as_str).unwrap_or("vanilla").to_string();
        let port = server.get("port").and_then(Value::as_u64).unwrap_or(0);
        let status = server.get("status").and_then(Value::as_str).unwrap_or("offline").to_string();
        let running = matches!(status.as_str(), "online" | "starting" | "stopping");
        let color = status_color(&status, &theme);
        let view_open = view.clone();
        let view_toggle = view.clone();
        let open_id = id.clone();
        let toggle_id = id.clone();
        cards = cards.child(
            div()
                .flex().flex_col().gap_3().w(px(340.0)).flex_grow().p(px(16.0))
                .rounded(px(RADIUS_LG)).bg(theme.surface).border_1().border_color(theme.border_soft)
                .child(
                    div().flex().items_center().gap_3()
                        .child(div().size(px(40.0)).rounded(px(10.0)).bg(theme.surface_active)
                            .flex().items_center().justify_center()
                            .child(widgets::icon("hard-drives", 18.0, theme.accent_soft)))
                        .child(
                            div().flex().flex_col().flex_1().min_w(px(0.0))
                                .child(div().text_size(px(TEXT_MD)).font_weight(semibold())
                                    .text_color(theme.text).truncate().child(name))
                                .child(div().text_size(px(TEXT_XS)).text_color(theme.faint)
                                    .child(format!("{} · Minecraft {} · :{}", egg_label(&egg), mc, port))),
                        )
                        .child(
                            div().flex().items_center().gap(px(5.0))
                                .child(div().size(px(6.0)).rounded_full().bg(color))
                                .child(div().text_size(px(TEXT_XS)).text_color(color).child(status_label(&status))),
                        ),
                )
                .child(
                    div().flex().items_center().gap_2()
                        .child(widgets::button("srv-open", "Quản lý", &theme, false, move |_, _, cx| {
                            let id = open_id.clone();
                            let _ = view_open.update(cx, |this, cx| this.open_server(id.clone(), cx));
                        }))
                        .child(widgets::button("srv-toggle", if running { "Dừng" } else { "Chạy" }, &theme, !running,
                            move |_, _, cx| {
                                let id = toggle_id.clone();
                                let _ = view_toggle.update(cx, |this, cx| this.toggle_server(id.clone(), running, cx));
                            })),
                ),
        );
    }

    page_body()
        .child(page_header(
            &theme,
            "ServerLocalHost",
            "Tạo máy chủ Minecraft ngay trên máy này",
            widgets::ghost_button("srv-refresh", "Làm mới", &theme, {
                let view = view.clone();
                move |_, _, cx| {
                    let _ = view.update(cx, |this, cx| this.load_servers(cx));
                }
            }),
        ))
        .child(
            div().flex().flex_col().gap_4().p(px(18.0)).rounded(px(RADIUS_LG))
                .bg(theme.surface).border_1().border_color(theme.border_soft)
                .child(section_title(&theme, "Tạo server mới", "Chọn phiên bản để lấy Minecraft + mod"))
                .child(div().flex().flex_col().gap_2()
                    .child(div().text_size(px(TEXT_SM)).font_weight(medium()).text_color(theme.muted).child("Chọn phiên bản"))
                    .child(instance_chips))
                .child(div().flex().flex_col().gap_2()
                    .child(div().text_size(px(TEXT_SM)).font_weight(medium()).text_color(theme.muted).child("Loại server"))
                    .child(egg_chips))
                .child(div().flex().gap_3()
                    .child(div().flex_1().child(pages::field(&theme, "Tên server", app.name_input.clone(), "")))
                    .child(div().w(px(170.0)).child(pages::field(&theme, "RAM (MB)", app.memory_input.clone(), ""))))
                .when(app.server_ui.creating, |el| {
                    el.child(div().flex().items_center().gap_2()
                        .child(widgets::spinner(14.0, theme.accent_soft))
                        .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child("Đang tạo và cài đặt server…")))
                })
                .child(div().flex().justify_end().child(widgets::button("srv-create", "Tạo server", &theme, true, {
                    let view = view.clone();
                    move |_, _, cx| {
                        let _ = view.update(cx, |this, cx| this.create_server(cx));
                    }
                }))),
        )
        .child(div().flex().flex_col().gap_3()
            .child(section_title(&theme, "Server của bạn", format!("{} server", app.server_ui.servers.len())))
            .child(cards))
}

fn render_detail(app: &mut LauncherApp, cx: &mut Context<LauncherApp>, server: &Value) -> impl IntoElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let id = server.get("id").and_then(Value::as_str).unwrap_or("").to_string();
    let name = server.get("name").and_then(Value::as_str).unwrap_or("Server").to_string();
    let mc = server.get("mc").and_then(Value::as_str).unwrap_or("").to_string();
    let egg = server.get("egg").and_then(Value::as_str).unwrap_or("vanilla").to_string();
    let port = server.get("port").and_then(Value::as_u64).unwrap_or(0);
    let ram = server.get("ramMb").and_then(Value::as_u64).unwrap_or(0);
    let status = server.get("status").and_then(Value::as_str).unwrap_or("offline").to_string();
    let dir = server.get("dir").and_then(Value::as_str).unwrap_or("").to_string();
    let running = matches!(status.as_str(), "online" | "starting" | "stopping");
    let color = status_color(&status, &theme);
    let view_back = view.clone();
    let view_toggle = view.clone();
    let view_tab = view.clone();
    let view_delete = view.clone();
    let id_toggle = id.clone();
    let id_delete = id.clone();

    let tabs = [("overview", "Tổng quan"), ("console", "Console"), ("config", "Cấu hình"), ("users", "Người chơi"), ("schedules", "Lịch"), ("files", "Tệp tin"), ("backups", "Sao lưu")];
    let mut tab_row = div().flex().items_center().gap(px(4.0));
    for (key, label) in tabs {
        let active = app.server_ui.tab == key;
        let view = view_tab.clone();
        let key = key.to_string();
        tab_row = tab_row.child(
            div()
                .id(gpui::SharedString::from(format!("srv-tab-{key}")))
                .h(px(30.0)).px(px(12.0)).flex().items_center().rounded(px(6.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .text_size(px(TEXT_SM)).font_weight(if active { semibold() } else { medium() })
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let key = key.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.server_ui.tab = key;
                        cx.notify();
                    });
                })
                .child(label.to_string()),
        );
    }

    let mut body = div().flex().flex_col().gap_3();
    match app.server_ui.tab.as_str() {
        "console" => {
            let logs = app.server_ui.console.clone();
            let filter = app.server_filter.read(cx).text().to_lowercase();
            let level = app.server_ui.console_level.clone();
            let start = logs.len().saturating_sub(1200);
            let mut filtered: Vec<String> = Vec::new();
            for line in &logs[start..] {
                let clean = crate::util::strip_minecraft_codes(&crate::util::strip_ansi(line));
                let line_level = crate::ui::logs::level_of(&clean);
                if !level.is_empty() && line_level != level {
                    continue;
                }
                if !filter.is_empty() && !clean.to_lowercase().contains(&filter) {
                    continue;
                }
                filtered.push(line.clone());
            }
            let mut level_row = div().flex().items_center().gap(px(4.0));
            for (key, label) in [("", "Tất cả"), ("INFO", "Info"), ("WARN", "Warn"), ("ERROR", "Lỗi")] {
                let active = app.server_ui.console_level == key;
                let view_level = view.clone();
                let key = key.to_string();
                level_row = level_row.child(
                    div()
                        .id(gpui::SharedString::from(format!("srv-level-{label}")))
                        .h(px(24.0)).px(px(9.0)).flex().items_center().rounded_full()
                        .bg(if active { theme.accent_dim } else { theme.elevated })
                        .border_1().border_color(if active { theme.accent } else { theme.border_soft })
                        .text_size(px(10.0))
                        .font_weight(if active { semibold() } else { medium() })
                        .text_color(if active { theme.accent_soft } else { theme.muted })
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let key = key.clone();
                            let _ = view_level.update(cx, |this, cx| {
                                this.server_ui.console_level = key;
                                cx.notify();
                            });
                        })
                        .child(label.to_string()),
                );
            }
            let colored = crate::ui::logs::styled(&filtered, "", 11.5, &theme);
            let view_stop = view.clone();
            let view_start = view.clone();
            body = body
                .child(
                    div().flex().items_center().gap_2()
                        .child(level_row)
                        .child(div().w(px(200.0)).child(widgets::text_input_box(&theme).child(app.server_filter.clone())))
                        .child(div().flex_1())
                        .child(widgets::ghost_button("srv-console-copy", "Sao chép", &theme, {
                            let text = logs.join("\n");
                            move |_, _, cx| {
                                cx.write_to_clipboard(gpui::ClipboardItem::new_string(text.clone()));
                            }
                        }))
                        .child(widgets::ghost_button("srv-console-save", "Lưu", &theme, {
                            let text = logs.join("
");
                            let view = view.clone();
                            move |_, _, cx| {
                                let view = view.clone();
                                let text = text.clone();
                                cx.spawn(async move |cx| {
                                    let picked = rfd::AsyncFileDialog::new()
                                        .set_file_name("server-log.txt")
                                        .add_filter("Log", &["txt", "log"])
                                        .save_file()
                                        .await;
                                    if let Some(file) = picked {
                                        let target = file.path().to_path_buf();
                                        let result = std::fs::write(&target, text);
                                        let _ = view.update(cx, |this, cx| {
                                            if result.is_ok() {
                                                this.toast("ok", "Đã lưu log server", target.to_string_lossy(), cx);
                                            } else {
                                                this.toast("bad", "Không lưu được log", "", cx);
                                            }
                                        });
                                    }
                                })
                                .detach();
                            }
                        }))
                        .child(widgets::button("srv-console-toggle", if running { "Dừng server" } else { "Chạy server" }, &theme, !running,
                            move |_, _, cx| {
                                if running {
                                    let _ = view_stop.update(cx, |this, _cx| this.backend.server_stop(id_toggle.clone(), false));
                                } else {
                                    let _ = view_start.update(cx, |this, cx| this.start_server(id_toggle.clone(), cx));
                                }
                            })),
                )
                .child(
                    div().id("server-console").h(px(460.0)).overflow_y_scroll().track_scroll(&app.server_scroll).rounded(px(RADIUS))
                        .bg(if theme.dark { gpui::rgb(0x07090c) } else { gpui::rgb(0xf7f8fa) })
                        .border_1().border_color(theme.border_soft)
                        .when_some(colored, |el, content| el.child(content))
                        .when(filtered.is_empty(), |el| {
                            el.child(div().h(px(430.0)).w_full().flex().items_center().justify_center()
                                .text_size(px(11.0)).text_color(theme.faint)
                                .child(if logs.is_empty() { "Chưa có log. Chạy server để xem console." } else { "Không có dòng log khớp bộ lọc." }))
                        }),
                )
                .child(
                    div().flex().items_center().gap_2()
                        .child(div().flex_1().child(widgets::text_input_box(&theme).child(app.server_cmd.clone())))
                        .child(widgets::button("srv-send", "Gửi", &theme, true, {
                            let view = view.clone();
                            move |_, _, cx| {
                                let _ = view.update(cx, |this, cx| this.send_server_command(cx));
                            }
                        })),
                );
        }
        "users" => {
            let view_add = view.clone();
            let view_wl = view.clone();
            let view_op = view.clone();
            let add_serv = id.clone();
            let mut whitelist_rows = div().flex().flex_col().gap_2();
            if app.server_ui.users_whitelist.is_empty() {
                whitelist_rows = whitelist_rows.child(
                    div().text_size(px(TEXT_SM)).text_color(theme.faint).p(px(6.0)).child("Danh sách trắng đang trống."),
                );
            }
            for user in app.server_ui.users_whitelist.iter().cloned().collect::<Vec<_>>() {
                let name = user.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                let uuid = user.get("uuid").and_then(Value::as_str).unwrap_or("").to_string();
                let has_op = app
                    .server_ui
                    .users_ops
                    .iter()
                    .any(|row| row.get("name").and_then(Value::as_str).map(|v| v.eq_ignore_ascii_case(&name)).unwrap_or(false));
                let view_remove = view_wl.clone();
                let sid = id.clone();
                let remove_name = name.clone();
                whitelist_rows = whitelist_rows.child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .h(px(40.0))
                        .px(px(10.0))
                        .rounded(px(6.0))
                        .bg(theme.surface)
                        .border_1()
                        .border_color(theme.border_soft)
                        .child(div().size(px(24.0)).rounded(px(5.0)).bg(theme.surface_active).flex().items_center().justify_center()
                            .child(widgets::icon("user", 13.0, theme.accent_soft)))
                        .child(div().flex().flex_col().flex_1().min_w(px(0.0))
                            .child(div().text_size(px(TEXT_SM)).text_color(theme.text).truncate().child(name))
                            .child(div().text_size(px(9.0)).font_family(MONO).text_color(theme.faint).truncate().child(uuid)))
                        .when(has_op, |el| el.child(widgets::tag("OP", theme.warn, &theme)))
                        .child(widgets::ghost_button("wl-remove", "Xoá", &theme, move |_, _, cx| {
                            let sid = sid.clone();
                            let name = remove_name.clone();
                            let _ = view_remove.update(cx, |this, cx| {
                                this.backend.server_user_set(&sid, name.clone(), false, has_op);
                                let value = this.backend.server_users(&sid);
                                this.server_ui.users_whitelist = value.get("whitelist").and_then(Value::as_array).cloned().unwrap_or_default();
                                this.server_ui.users_ops = value.get("ops").and_then(Value::as_array).cloned().unwrap_or_default();
                                cx.notify();
                            });
                        })),
                );
            }
            let mut op_rows = div().flex().flex_col().gap_2();
            if app.server_ui.users_ops.is_empty() {
                op_rows = op_rows.child(
                    div().text_size(px(TEXT_SM)).text_color(theme.faint).p(px(6.0)).child("Chưa có ai là OP."),
                );
            }
            for user in app.server_ui.users_ops.iter().cloned().collect::<Vec<_>>() {
                let name = user.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                let uuid = user.get("uuid").and_then(Value::as_str).unwrap_or("").to_string();
                let has_white = app
                    .server_ui
                    .users_whitelist
                    .iter()
                    .any(|row| row.get("name").and_then(Value::as_str).map(|v| v.eq_ignore_ascii_case(&name)).unwrap_or(false));
                let view_remove = view_op.clone();
                let sid = id.clone();
                let remove_name = name.clone();
                op_rows = op_rows.child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .h(px(40.0))
                        .px(px(10.0))
                        .rounded(px(6.0))
                        .bg(theme.surface)
                        .border_1()
                        .border_color(theme.border_soft)
                        .child(div().size(px(24.0)).rounded(px(5.0)).bg(theme.surface_active).flex().items_center().justify_center()
                            .child(widgets::icon("shield-check", 13.0, theme.warn)))
                        .child(div().flex().flex_col().flex_1().min_w(px(0.0))
                            .child(div().text_size(px(TEXT_SM)).text_color(theme.text).truncate().child(name))
                            .child(div().text_size(px(9.0)).font_family(MONO).text_color(theme.faint).truncate().child(uuid)))
                        .when(has_white, |el| el.child(widgets::tag("Whitelist", theme.info, &theme)))
                        .child(widgets::ghost_button("op-remove", "Xoá", &theme, move |_, _, cx| {
                            let sid = sid.clone();
                            let name = remove_name.clone();
                            let _ = view_remove.update(cx, |this, cx| {
                                this.backend.server_user_set(&sid, name.clone(), has_white, false);
                                let value = this.backend.server_users(&sid);
                                this.server_ui.users_whitelist = value.get("whitelist").and_then(Value::as_array).cloned().unwrap_or_default();
                                this.server_ui.users_ops = value.get("ops").and_then(Value::as_array).cloned().unwrap_or_default();
                                cx.notify();
                            });
                        })),
                );
            }

            let view_flag_white = view.clone();
            let view_flag_op = view.clone();
            body = body
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .p(px(14.0))
                        .rounded(px(RADIUS))
                        .bg(theme.elevated)
                        .border_1()
                        .border_color(theme.border_soft)
                        .child(section_title(&theme, "Thêm người chơi", "Áp dụng ngay cho server đang chạy"))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_3()
                                .child(div().flex_1().child(widgets::text_input_box(&theme).child(app.user_name.clone())))
                                .child(
                                    div()
                                        .id("user-flag-white")
                                        .h(px(30.0))
                                        .px(px(10.0))
                                        .flex()
                                        .items_center()
                                        .rounded(px(6.0))
                                        .bg(if app.server_ui.user_add_whitelist { theme.accent_dim } else { theme.surface })
                                        .border_1()
                                        .border_color(if app.server_ui.user_add_whitelist { theme.accent } else { theme.border_soft })
                                        .text_size(px(10.0))
                                        .text_color(if app.server_ui.user_add_whitelist { theme.accent_soft } else { theme.muted })
                                        .cursor_pointer()
                                        .on_click(move |_, _, cx| {
                                            let _ = view_flag_white.update(cx, |this, cx| {
                                                this.server_ui.user_add_whitelist = !this.server_ui.user_add_whitelist;
                                                cx.notify();
                                            });
                                        })
                                        .child("Whitelist"),
                                )
                                .child(
                                    div()
                                        .id("user-flag-op")
                                        .h(px(30.0))
                                        .px(px(10.0))
                                        .flex()
                                        .items_center()
                                        .rounded(px(6.0))
                                        .bg(if app.server_ui.user_add_op { theme.accent_dim } else { theme.surface })
                                        .border_1()
                                        .border_color(if app.server_ui.user_add_op { theme.accent } else { theme.border_soft })
                                        .text_size(px(10.0))
                                        .text_color(if app.server_ui.user_add_op { theme.accent_soft } else { theme.muted })
                                        .cursor_pointer()
                                        .on_click(move |_, _, cx| {
                                            let _ = view_flag_op.update(cx, |this, cx| {
                                                this.server_ui.user_add_op = !this.server_ui.user_add_op;
                                                cx.notify();
                                            });
                                        })
                                        .child("OP"),
                                )
                                .child(widgets::button("user-add", "Thêm", &theme, true, move |_, _, cx| {
                                    let sid = add_serv.clone();
                                    let _ = view_add.update(cx, |this, cx| {
                                        let name = this.user_name.read(cx).text().trim().to_string();
                                        if name.is_empty() {
                                            this.toast("warn", "Nhập tên người chơi", "", cx);
                                            return;
                                        }
                                        if !this.server_ui.user_add_whitelist && !this.server_ui.user_add_op {
                                            this.toast("warn", "Chọn Whitelist hoặc OP", "", cx);
                                            return;
                                        }
                                        let value = this.backend.server_user_set(
                                            &sid,
                                            name,
                                            this.server_ui.user_add_whitelist,
                                            this.server_ui.user_add_op,
                                        );
                                        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                            let value = this.backend.server_users(&sid);
                                            this.server_ui.users_whitelist = value.get("whitelist").and_then(Value::as_array).cloned().unwrap_or_default();
                                            this.server_ui.users_ops = value.get("ops").and_then(Value::as_array).cloned().unwrap_or_default();
                                            this.toast("ok", "Đã thêm người chơi", "Server đọc danh sách ngay khi lưu.", cx);
                                        } else {
                                            this.toast("bad", "Thêm thất bại", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                                        }
                                    });
                                })),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(section_title(&theme, "Whitelist", format!("{} người chơi", app.server_ui.users_whitelist.len())))
                        .child(whitelist_rows),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(section_title(&theme, "Quản trị viên (OP)", format!("{} người chơi", app.server_ui.users_ops.len())))
                        .child(op_rows),
                );
        }
        "schedules" => {
            let view_add = view.clone();
            let view_save = view.clone();
            let view_test = view.clone();
            let view_cancel = view.clone();
            let server_id = id.clone();
            let mut rows = div().flex().flex_col().gap_2();
            if app.server_ui.schedules.is_empty() {
                rows = rows.child(pages::empty_state(
                    &theme,
                    "calendar-blank",
                    "Chưa có lịch",
                    "Lên lịch lệnh, sao lưu hoặc khởi động lại server theo giờ.",
                ));
            }
            for schedule in app.server_ui.schedules.iter().cloned().collect::<Vec<_>>() {
                let schedule_id = schedule.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                let name = schedule.get("name").and_then(Value::as_str).unwrap_or("Lịch").to_string();
                let cron = schedule.get("cron").and_then(Value::as_str).unwrap_or("").to_string();
                let action = schedule.get("action").and_then(Value::as_str).unwrap_or("command").to_string();
                let power = schedule.get("power").and_then(Value::as_str).unwrap_or("restart").to_string();
                let command = schedule.get("command").and_then(Value::as_str).unwrap_or("").to_string();
                let enabled = schedule.get("enabled").and_then(Value::as_bool).unwrap_or(true);
                let summary = match action.as_str() {
                    "power" => format!("Nguồn: {power}"),
                    "backup" => "Tạo bản sao lưu".to_string(),
                    _ => format!("> {command}"),
                };
                let view_toggle = view.clone();
                let view_run = view.clone();
                let view_edit = view.clone();
                let view_delete = view.clone();
                let toggle_serv = server_id.clone();
                let run_serv = server_id.clone();
                let toggle_sched = schedule_id.clone();
                let run_sched = schedule.clone();
                let edit_sched = schedule.clone();
                let delete_serv = server_id.clone();
                let delete_sched = schedule_id.clone();
                rows = rows.child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .p(px(12.0))
                        .rounded(px(RADIUS_SM))
                        .bg(theme.elevated)
                        .border_1()
                        .border_color(theme.border_soft)
                        .child(widgets::icon("calendar-blank", 17.0, if enabled { theme.accent_soft } else { theme.faint }))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w(px(0.0))
                                .child(div().text_size(px(TEXT_SM)).font_weight(semibold()).text_color(if enabled { theme.text } else { theme.faint }).truncate().child(name))
                                .child(
                                    div()
                                        .text_size(px(10.0))
                                        .font_family(MONO)
                                        .text_color(theme.faint)
                                        .truncate()
                                        .child(format!("{cron} · {summary}")),
                                ),
                        )
                        .child(
                            div()
                                .id(gpui::SharedString::from(format!("sched-toggle-{schedule_id}")))
                                .w(px(38.0))
                                .h(px(21.0))
                                .rounded_full()
                                .bg(if enabled { theme.accent } else { theme.surface_active })
                                .p(px(3.0))
                                .flex()
                                .items_center()
                                .when(enabled, |el| el.justify_end())
                                .cursor_pointer()
                                .on_click(move |_, _, cx| {
                                    let server_id = toggle_serv.clone();
                                    let schedule_id = toggle_sched.clone();
                                    let _ = view_toggle.update(cx, |this, cx| {
                                        let mut schedules = this.server_ui.schedules.clone();
                                        if let Some(row) = schedules.iter_mut().find(|row| row.get("id").and_then(Value::as_str) == Some(schedule_id.as_str())) {
                                            let next = !row.get("enabled").and_then(Value::as_bool).unwrap_or(true);
                                            row["enabled"] = json!(next);
                                        }
                                        this.backend.server_update(&server_id, json!({"schedules": schedules.clone()}));
                                        this.server_ui.schedules = schedules;
                                        cx.notify();
                                    });
                                })
                                .child(div().size(px(15.0)).rounded_full().bg(gpui::white())),
                        )
                        .child(widgets::ghost_button("sched-run", "Chạy ngay", &theme, move |_, _, cx| {
                            let server_id = run_serv.clone();
                            let schedule = run_sched.clone();
                            let _ = view_run.update(cx, |this, cx| {
                                let rx = this.backend.server_schedule_run(server_id, schedule);
                                this.on_result(cx, rx, |this, _value, cx| {
                                    this.toast("ok", "Đã chạy lịch", "", cx);
                                });
                            });
                        }))
                        .child(widgets::ghost_button("sched-edit", "Sửa", &theme, move |_, _, cx| {
                            let schedule = edit_sched.clone();
                            let _ = view_edit.update(cx, |this, cx| {
                                this.server_ui.schedule_form = true;
                                this.server_ui.schedule_edit = schedule.get("id").and_then(Value::as_str).map(str::to_string);
                                this.server_ui.schedule_action = schedule.get("action").and_then(Value::as_str).unwrap_or("command").into();
                                this.server_ui.schedule_power = schedule.get("power").and_then(Value::as_str).unwrap_or("restart").into();
                                let name = schedule.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                                let cron = schedule.get("cron").and_then(Value::as_str).unwrap_or("").to_string();
                                let command = schedule.get("command").and_then(Value::as_str).unwrap_or("").to_string();
                                let input = this.sched_name.clone();
                                input.update(cx, |input, cx| input.set_text(name, cx));
                                let input = this.sched_cron.clone();
                                input.update(cx, |input, cx| input.set_text(cron, cx));
                                let input = this.sched_command.clone();
                                input.update(cx, |input, cx| input.set_text(command, cx));
                                cx.notify();
                            });
                        }))
                        .child(widgets::ghost_button("sched-delete", "Xoá", &theme, move |_, _, cx| {
                            let server_id = delete_serv.clone();
                            let schedule_id = delete_sched.clone();
                            let _ = view_delete.update(cx, |this, cx| {
                                this.modal = Modal::Confirm {
                                    title: "Xoá lịch?".into(),
                                    message: "Lịch này sẽ bị gỡ khỏi server.".into(),
                                    action: ConfirmAction::ScheduleDelete(server_id.clone(), schedule_id.clone()),
                                };
                                cx.notify();
                            });
                        })),
                );
            }

            let form = if app.server_ui.schedule_form {
                let view_action = view.clone();
                let view_power = view.clone();
                let view_preset = view.clone();
                let mut action_row = div().flex().items_center().gap_2();
                for (key, label) in [("command", "Lệnh"), ("power", "Nguồn"), ("backup", "Sao lưu")] {
                    let active = app.server_ui.schedule_action == key;
                    let view = view_action.clone();
                    let key = key.to_string();
                    action_row = action_row.child(
                        div()
                            .id(gpui::SharedString::from(format!("sched-action-{key}")))
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
                                let key = key.clone();
                                let _ = view.update(cx, |this, cx| {
                                    this.server_ui.schedule_action = key;
                                    cx.notify();
                                });
                            })
                            .child(label),
                    );
                }
                let mut power_row = div().flex().items_center().gap_2();
                for (key, label) in [("start", "Khởi động"), ("stop", "Dừng"), ("restart", "Khởi động lại"), ("kill", "Tắt cưỡng bức")] {
                    let active = app.server_ui.schedule_power == key;
                    let view = view_power.clone();
                    let key = key.to_string();
                    power_row = power_row.child(
                        div()
                            .id(gpui::SharedString::from(format!("sched-power-{key}")))
                            .h(px(26.0))
                            .px(px(9.0))
                            .flex()
                            .items_center()
                            .rounded(px(5.0))
                            .bg(if active { theme.accent_dim } else { theme.surface })
                            .border_1()
                            .border_color(if active { theme.accent } else { theme.border_soft })
                            .text_size(px(10.0))
                            .text_color(if active { theme.accent_soft } else { theme.muted })
                            .cursor_pointer()
                            .on_click(move |_, _, cx| {
                                let key = key.clone();
                                let _ = view.update(cx, |this, cx| {
                                    this.server_ui.schedule_power = key;
                                    cx.notify();
                                });
                            })
                            .child(label),
                    );
                }
                let mut preset_row = div().flex().items_center().gap_2().flex_wrap();
                for (expr, label) in [
                    ("*/5 * * * *", "Mỗi 5 phút"),
                    ("0 * * * *", "Mỗi giờ"),
                    ("0 0 * * *", "Hàng ngày 00:00"),
                    ("0 0 * * 0", "Hàng tuần CN"),
                    ("0 0 1 * *", "Hàng tháng"),
                    ("30 3 * * *", "Hàng ngày 03:30"),
                ] {
                    let view = view_preset.clone();
                    let expr = expr.to_string();
                    preset_row = preset_row.child(
                        div()
                            .id(gpui::SharedString::from(format!("sched-preset-{expr}")))
                            .h(px(24.0))
                            .px(px(8.0))
                            .flex()
                            .items_center()
                            .rounded(px(5.0))
                            .bg(theme.surface)
                            .border_1()
                            .border_color(theme.border_soft)
                            .text_size(px(10.0))
                            .text_color(theme.muted)
                            .cursor_pointer()
                            .on_click(move |_, _, cx| {
                                let expr = expr.clone();
                                let _ = view.update(cx, |this, cx| {
                                    let input = this.sched_cron.clone();
                                    input.update(cx, |input, cx| input.set_text(expr, cx));
                                    cx.notify();
                                });
                            })
                            .child(label),
                    );
                }
                let action = app.server_ui.schedule_action.clone();
                let mut form = div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .p(px(14.0))
                    .rounded(px(RADIUS))
                    .bg(theme.elevated)
                    .border_1()
                    .border_color(theme.accent)
                    .child(section_title(&theme, if app.server_ui.schedule_edit.is_some() { "Sửa lịch" } else { "Lịch mới" }, "Cú pháp cron 5 trường: phút giờ ngày tháng thứ"))
                    .child(
                        div()
                            .flex()
                            .gap_3()
                            .child(div().flex_1().child(pages::field(&theme, "Tên lịch", app.sched_name.clone(), "")))
                            .child(div().w(px(170.0)).child(pages::field(&theme, "Cron", app.sched_cron.clone(), ""))),
                    )
                    .child(preset_row)
                    .child(action_row);
                if action == "command" {
                    form = form.child(pages::field(&theme, "Lệnh gửi tới console", app.sched_command.clone(), ""));
                } else if action == "power" {
                    form = form.child(power_row);
                }
                form.child(
                    div()
                        .flex()
                        .items_center()
                        .justify_end()
                        .gap_2()
                        .child(widgets::ghost_button("sched-form-cancel", "Huỷ", &theme, move |_, _, cx| {
                            let _ = view_cancel.update(cx, |this, cx| {
                                this.server_ui.schedule_form = false;
                                this.server_ui.schedule_edit = None;
                                cx.notify();
                            });
                        }))
                        .child(widgets::button("sched-form-save", "Lưu lịch", &theme, true, move |_, _, cx| {
                            let server_id = server_id.clone();
                            let _ = view_save.update(cx, |this, cx| {
                                let name = this.sched_name.read(cx).text().trim().to_string();
                                let cron = this.sched_cron.read(cx).text().trim().to_string();
                                let command = this.sched_command.read(cx).text().trim().to_string();
                                if cron.split_whitespace().count() != 5 {
                                    this.toast("warn", "Cron không hợp lệ", "Cần 5 trường: phút giờ ngày tháng thứ.", cx);
                                    return;
                                }
                                let id = this
                                    .server_ui
                                    .schedule_edit
                                    .clone()
                                    .unwrap_or_else(|| format!("sch-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]));
                                let schedule = json!({
                                    "id": id,
                                    "name": if name.is_empty() { "Lịch".to_string() } else { name },
                                    "cron": cron,
                                    "enabled": true,
                                    "action": this.server_ui.schedule_action,
                                    "command": command,
                                    "power": this.server_ui.schedule_power,
                                });
                                let mut schedules = this.server_ui.schedules.clone();
                                if let Some(row) = schedules.iter_mut().find(|row| row.get("id").and_then(Value::as_str) == Some(id.as_str())) {
                                    let enabled = row.get("enabled").cloned().unwrap_or(json!(true));
                                    let mut next = schedule.clone();
                                    next["enabled"] = enabled;
                                    *row = next;
                                } else {
                                    schedules.push(schedule);
                                }
                                let value = this.backend.server_update(&server_id, json!({"schedules": schedules.clone()}));
                                if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                    this.server_ui.schedules = schedules;
                                    this.server_ui.schedule_form = false;
                                    this.server_ui.schedule_edit = None;
                                    this.toast("ok", "Đã lưu lịch", "", cx);
                                } else {
                                    this.toast("bad", "Lưu lịch thất bại", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                                }
                            });
                        })),
                )
            } else {
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child(format!("{} lịch", app.server_ui.schedules.len())))
                    .child(widgets::button("sched-add", "Thêm lịch", &theme, true, move |_, _, cx| {
                        let _ = view_add.update(cx, |this, cx| {
                            this.server_ui.schedule_form = true;
                            this.server_ui.schedule_edit = None;
                            this.server_ui.schedule_action = "command".into();
                            this.server_ui.schedule_power = "restart".into();
                            let input = this.sched_name.clone();
                            input.update(cx, |input, cx| input.clear(cx));
                            let input = this.sched_cron.clone();
                            input.update(cx, |input, cx| input.set_text("0 4 * * *", cx));
                            let input = this.sched_command.clone();
                            input.update(cx, |input, cx| input.clear(cx));
                            cx.notify();
                        });
                    }))
            };

            body = body.child(div().flex().flex_col().gap_3().child(form).child(rows));
        }
        "files" => {
            let view = view.clone();
            let mut rows = div().flex().flex_col().gap(px(1.0));
            if app.server_ui.files.is_empty() {
                rows = rows.child(pages::empty_state(&theme, "files", "Thư mục trống", "Nhấn Làm mới để tải danh sách tệp."));
            }
            for entry in app.server_ui.files.iter().cloned().collect::<Vec<_>>() {
                let entry_name = entry.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                let rel = entry.get("rel").and_then(Value::as_str).unwrap_or("").to_string();
                let is_dir = entry.get("dir").and_then(Value::as_bool).unwrap_or(false);
                let size = entry.get("size").and_then(Value::as_u64).unwrap_or(0);
                let view = view.clone();
                let rel_click = rel.clone();
                rows = rows.child(
                    div()
                        .id(gpui::SharedString::from(format!("srv-file-{rel}")))
                        .flex().items_center().gap_3().h(px(38.0)).px(px(10.0)).rounded(px(6.0))
                        .cursor_pointer().hover(|s| s.bg(theme.surface_hover))
                        .on_click(move |_, _, cx| {
                            let rel = rel_click.clone();
                            let _ = view.update(cx, |this, cx| this.open_server_file(rel, is_dir, cx));
                        })
                        .child(widgets::icon(if is_dir { "folder" } else { "file" }, 15.0, if is_dir { theme.accent_soft } else { theme.faint }))
                        .child(div().flex_1().text_size(px(TEXT_SM)).text_color(theme.text).truncate().child(entry_name))
                        .child(div().text_size(px(TEXT_XS)).text_color(theme.faint)
                            .child(if is_dir { String::new() } else { crate::util::format_bytes(size) })),
                );
            }
            body = body
                .child(
                    div().flex().items_center().justify_between()
                        .child(
                            div().flex().items_center().gap_2()
                                .child(widgets::icon_button("srv-files-up", "arrow-left", &theme, {
                                    let view = view.clone();
                                    move |_, _, cx| {
                                        let _ = view.update(cx, |this, cx| {
                                            let parent = Path::new(&this.server_ui.rel).parent()
                                                .map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
                                            this.server_ui.rel = parent.clone();
                                            if let Some(id) = this.server_ui.selected.clone() {
                                                let value = this.backend.server_file_list(&id, &parent);
                                                this.server_ui.files = value.get("entries").and_then(Value::as_array).cloned().unwrap_or_default();
                                            }
                                            cx.notify();
                                        });
                                    }
                                }))
                                .child(div().text_size(px(TEXT_SM)).text_color(theme.muted)
                                    .child(if app.server_ui.rel.is_empty() { "Thư mục server".to_string() } else { app.server_ui.rel.clone() })),
                        )
                        .child(widgets::ghost_button("srv-files-open", "Mở thư mục", &theme, {
                            let dir = dir.clone();
                            move |_, _, _cx| {
                                let _ = open::that(&dir);
                            }
                        })),
                )
                .child(rows);
        }
        "backups" => {
            let view = view.clone();
            let view_create = view.clone();
            let mut rows = div().flex().flex_col().gap(px(2.0));
            if app.server_ui.backups.is_empty() {
                rows = rows.child(pages::empty_state(&theme, "archive", "Chưa có bản sao lưu", "Tạo bản sao lưu để quay lại khi cần."));
            }
            for backup in app.server_ui.backups.iter().cloned().collect::<Vec<_>>() {
                let backup_id = backup.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                let backup_name = backup.get("name").and_then(Value::as_str).unwrap_or("Sao lưu").to_string();
                let size = backup.get("size").and_then(Value::as_u64).unwrap_or(0);
                let created = backup.get("created").and_then(Value::as_str).unwrap_or("");
                let view_restore = view.clone();
                let view_delete = view.clone();
                let view_download = view.clone();
                let id_restore = backup_id.clone();
                let id_delete = backup_id.clone();
                let download_file = backup.get("file").and_then(Value::as_str).unwrap_or("").to_string();
                let download_name = format!("{}.zip", crate::util::safe_name(&backup_name));
                rows = rows.child(
                    div()
                        .flex().items_center().gap_3().h(px(44.0)).px(px(10.0)).rounded(px(6.0))
                        .hover(|s| s.bg(theme.surface_hover))
                        .child(widgets::icon("archive", 15.0, theme.accent_soft))
                        .child(
                            div().flex().flex_col().flex_1()
                                .child(div().text_size(px(TEXT_SM)).text_color(theme.text).child(backup_name))
                                .child(div().text_size(px(10.0)).text_color(theme.faint)
                                    .child(format!("{} · {}", crate::util::format_bytes(size), pages::short_time(created)))),
                        )
                        .child(
                            div().flex().items_center().gap(px(4.0))
                                .child(widgets::ghost_button("srv-backup-download", "Tải xuống", &theme, {
                                    let source = download_file.clone();
                                    let file_name = download_name.clone();
                                    move |_, _, cx| {
                                        let view = view_download.clone();
                                        let source = source.clone();
                                        let file_name = file_name.clone();
                                        cx.spawn(async move |cx| {
                                            let picked = rfd::AsyncFileDialog::new()
                                                .set_file_name(file_name)
                                                .add_filter("Zip", &["zip"])
                                                .save_file()
                                                .await;
                                            if let Some(file) = picked {
                                                let target = file.path().to_path_buf();
                                                let result = std::fs::copy(&source, &target);
                                                let _ = view.update(cx, |this, cx| {
                                                    if result.is_ok() {
                                                        this.toast("ok", "Đã lưu bản sao lưu", target.to_string_lossy(), cx);
                                                    } else {
                                                        this.toast("bad", "Không lưu được bản sao lưu", "", cx);
                                                    }
                                                });
                                            }
                                        })
                                        .detach();
                                    }
                                }))
                                .child(widgets::ghost_button("srv-backup-restore", "Khôi phục", &theme, move |_, _, cx| {
                                    let backup_id = id_restore.clone();
                                    let _ = view_restore.update(cx, |this, cx| {
                                        let Some(id) = this.server_ui.selected.clone() else { return };
                                        let rx = this.backend.server_backup_restore(id, backup_id.clone());
                                        this.on_result(cx, rx, |this, value, cx| {
                                            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                this.toast("ok", "Đã khôi phục bản sao lưu", "", cx);
                                            } else {
                                                this.toast("bad", "Khôi phục thất bại", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                                            }
                                        });
                                    });
                                }))
                                .child(widgets::ghost_button("srv-backup-delete", "Xoá", &theme, move |_, _, cx| {
                                    let backup_id = id_delete.clone();
                                    let _ = view_delete.update(cx, |this, cx| {
                                        if let Some(id) = this.server_ui.selected.clone() {
                                            this.backend.server_backup_delete(&id, &backup_id);
                                            this.server_ui.backups.retain(|row| row.get("id").and_then(Value::as_str) != Some(backup_id.as_str()));
                                            cx.notify();
                                        }
                                    });
                                })),
                        ),
                );
            }
            body = body
                .child(
                    div().flex().items_center().justify_between()
                        .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child(format!("{} bản sao lưu", app.server_ui.backups.len())))
                        .child(widgets::button("srv-backup-create", "Tạo bản sao lưu", &theme, true, move |_, _, cx| {
                            let _ = view_create.update(cx, |this, cx| {
                                let Some(id) = this.server_ui.selected.clone() else { return };
                                let rx = this.backend.server_backup_create(id, format!("Sao lưu {}", chrono::Local::now().format("%d/%m %H:%M")));
                                this.on_result(cx, rx, |this, value, cx| {
                                    if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                        this.toast("ok", "Đã tạo bản sao lưu", "", cx);
                                        if let Some(id) = this.server_ui.selected.clone() {
                                            let value = this.backend.server_backups(&id);
                                            this.server_ui.backups = value.get("backups").and_then(Value::as_array).cloned().unwrap_or_default();
                                        }
                                    } else {
                                        this.toast("bad", "Sao lưu thất bại", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                                    }
                                });
                            });
                        })),
                )
                .child(rows);
        }
        "config" => {
            let save_id = id.clone();
            let view_save = view.clone();
            let view_mode = view.clone();
            let view_difficulty = view.clone();
            let view_online = view.clone();
            let view_pvp = view.clone();
            let ram_value = server.get("ramMb").and_then(Value::as_u64).unwrap_or(4096);
            let mut mode_row = div().flex().items_center().gap_2();
            for (key, label) in [("survival", "Sinh tồn"), ("creative", "Sáng tạo"), ("adventure", "Phiêu lưu"), ("spectator", "Khán giả")] {
                let active = app.server_ui.game_mode == key;
                let view = view_mode.clone();
                let key = key.to_string();
                mode_row = mode_row.child(
                    div()
                        .id(gpui::SharedString::from(format!("srv-mode-{key}")))
                        .h(px(28.0)).px(px(10.0)).flex().items_center().rounded(px(6.0))
                        .bg(if active { theme.accent_dim } else { theme.surface })
                        .border_1().border_color(if active { theme.accent } else { theme.border_soft })
                        .text_size(px(TEXT_XS)).text_color(if active { theme.accent_soft } else { theme.muted })
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let key = key.clone();
                            let _ = view.update(cx, |this, cx| {
                                this.server_ui.game_mode = key;
                                cx.notify();
                            });
                        })
                        .child(label.to_string()),
                );
            }
            let mut difficulty_row = div().flex().items_center().gap_2();
            for (key, label) in [("peaceful", "Bình yên"), ("easy", "Dễ"), ("normal", "Thường"), ("hard", "Khó")] {
                let active = app.server_ui.difficulty == key;
                let view = view_difficulty.clone();
                let key = key.to_string();
                difficulty_row = difficulty_row.child(
                    div()
                        .id(gpui::SharedString::from(format!("srv-diff-{key}")))
                        .h(px(28.0)).px(px(10.0)).flex().items_center().rounded(px(6.0))
                        .bg(if active { theme.accent_dim } else { theme.surface })
                        .border_1().border_color(if active { theme.accent } else { theme.border_soft })
                        .text_size(px(TEXT_XS)).text_color(if active { theme.accent_soft } else { theme.muted })
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let key = key.clone();
                            let _ = view.update(cx, |this, cx| {
                                this.server_ui.difficulty = key;
                                cx.notify();
                            });
                        })
                        .child(label.to_string()),
                );
            }
            let switch = |id: &'static str,
                          label: &'static str,
                          active: bool,
                          view: gpui::WeakEntity<LauncherApp>,
                          online: bool| {
                let theme = theme.clone();
                div()
                    .flex().items_center().justify_between().gap_4()
                    .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child(label))
                    .child(
                        div()
                            .id(id)
                            .w(px(40.0)).h(px(22.0)).rounded_full()
                            .bg(if active { theme.accent } else { theme.surface_active })
                            .p(px(3.0)).flex().items_center()
                            .when(active, |el| el.justify_end())
                            .cursor_pointer()
                            .on_click(move |_, _, cx| {
                                let _ = view.update(cx, |this, cx| {
                                    if online {
                                        this.server_ui.online = !this.server_ui.online;
                                    } else {
                                        this.server_ui.pvp = !this.server_ui.pvp;
                                    }
                                    cx.notify();
                                });
                            })
                            .child(div().size(px(16.0)).rounded_full().bg(gpui::white())),
                    )
            };
            body = body
                .child(
                    div()
                        .flex().flex_col().gap_4().p(px(16.0)).rounded(px(RADIUS))
                        .bg(theme.surface).border_1().border_color(theme.border_soft)
                        .child(section_title(&theme, "Cấu hình server", "Áp dụng sau khi khởi động lại server"))
                        .child(
                            div().flex().gap_3()
                                .child(div().flex_1().child(pages::field(&theme, "Tên server", app.name_input.clone(), "")))
                                .child(div().w(px(150.0)).child(pages::field(&theme, "RAM (MB)", app.memory_input.clone(), "")))
                                .child(div().w(px(150.0)).child(pages::field(&theme, "Cổng", app.server_port.clone(), ""))),
                        )
                        .child(div().flex_1().child(pages::field(&theme, "MOTD", app.server_motd.clone(), "")))
                        .child(pages::field(&theme, "Tham số JVM thêm", app.server_jvm.clone(), "Ví dụ: -XX:+UseG1GC -XX:+ParallelRefProcEnabled"))
                        .child(div().flex().items_center().gap_6()
                            .child(div().text_size(px(TEXT_SM)).text_color(theme.faint).child(format!("RAM hiện tại: {ram_value} MB")))
                            .child(switch("srv-online", "Chế độ online (xác thực Mojang)", app.server_ui.online, view_online, true))
                            .child(switch("srv-pvp", "PvP", app.server_ui.pvp, view_pvp, false)))
                        .child(div().flex().flex_col().gap_2()
                            .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child("Chế độ chơi"))
                            .child(mode_row)
                            .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child("Độ khó"))
                            .child(difficulty_row))
                        .child(div().flex().justify_end().child(widgets::button("srv-config-save", "Lưu cấu hình", &theme, true, move |_, _, cx| {
                            let id = save_id.clone();
                            let _ = view_save.update(cx, |this, cx| {
                                let name = this.name_input.read(cx).text().trim().to_string();
                                let mut ram = this.memory_input.read(cx).text().trim().parse::<u32>().unwrap_or(ram_value as u32);
                                ram = ram.clamp(512, 65536);
                                let port = this.server_port.read(cx).text().trim().parse::<u16>().unwrap_or(port as u16);
                                let motd = this.server_motd.read(cx).text().trim().to_string();
                                let jvm = this.server_jvm.read(cx).text().trim().to_string();
                                let patch = json!({
                                    "name": name,
                                    "ramMb": ram,
                                    "port": port,
                                    "vars": {
                                        "motd": if motd.is_empty() { "XyoLauncher Server".to_string() } else { motd },
                                        "gamemode": this.server_ui.game_mode,
                                        "difficulty": this.server_ui.difficulty,
                                        "online-mode": this.server_ui.online,
                                        "pvp": this.server_ui.pvp,
                                        "jvmArgs": jvm,
                                    },
                                });
                                let value = this.backend.server_update(&id, patch);
                                if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                    this.toast("ok", "Đã lưu cấu hình", "Khởi động lại server để áp dụng.", cx);
                                    this.load_servers(cx);
                                } else {
                                    this.toast("bad", "Lưu cấu hình thất bại", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                                }
                            });
                        }))),
                );
        }
        _ => {
            body = body
                .child(
                    div().flex().gap_3()
                        .child(info_card(&theme, "memory", "RAM", format!("{ram} MB")))
                        .child(info_card(&theme, "network", "Cổng", format!(":{port}")))
                        .child(info_card(&theme, "coffee", "Java", server.get("javaMajor").and_then(Value::as_u64).map(|v| format!("Java {v}")).unwrap_or_else(|| "Tự động".into())))
                        .child(info_card(&theme, "cube", "Minecraft", mc.clone())),
                )
                .child(
                    div().flex().flex_col().gap_2().p(px(16.0)).rounded(px(RADIUS))
                        .bg(theme.surface).border_1().border_color(theme.border_soft)
                        .child(section_title(&theme, "Thông tin", ""))
                        .child(info_line(&theme, "Loại server", egg_label(&egg)))
                        .child(info_line(&theme, "Thư mục", &dir))
                        .child(info_line(&theme, "Cấu hình", "server.properties (tab Tệp tin)")),
                )
                .child(
                    div().flex().items_center().gap_2()
                        .child(widgets::ghost_button("srv-open-folder", "Mở thư mục server", &theme, {
                            let dir = dir.clone();
                            move |_, _, _cx| { let _ = open::that(&dir); }
                        }))
                        .child(widgets::ghost_button("srv-prune", "Dọn mod client", &theme, {
                            let view = view.clone();
                            let prune_id = id.clone();
                            move |_, _, cx| {
                                let prune_id = prune_id.clone();
                                let _ = view.update(cx, |this, cx| {
                                    let value = this.backend.server_prune_mods(&prune_id);
                                    if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                        let checked = value.get("checked").and_then(Value::as_u64).unwrap_or(0);
                                        let moved = value.get("moved").and_then(Value::as_u64).unwrap_or(0);
                                        this.toast(
                                            if moved == 0 { "ok" } else { "info" },
                                            if moved == 0 { "Không có mod chỉ dành cho client" } else { "Đã tắt mod client" },
                                            format!("Đã dò {checked} tệp · chuyển {moved} mod vào mods/_client-only"),
                                            cx,
                                        );
                                    } else {
                                        this.toast("bad", "Dọn mod thất bại", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                                    }
                                });
                            }
                        }))
                        .child(widgets::button("srv-delete", "Xoá server", &theme, false, move |_, _, cx| {
                            let _ = view_delete.update(cx, |this, cx| {
                                this.modal = Modal::Confirm {
                                    title: "Xoá server?".into(),
                                    message: "Server và toàn bộ tệp sẽ được chuyển vào thùng rác của launcher.".into(),
                                    action: ConfirmAction::ServerDelete(id_delete.clone()),
                                };
                                cx.notify();
                            });
                        })),
                );
        }
    }

    page_body()
        .child(
            div().flex().items_center().justify_between()
                .child(
                    div().flex().items_center().gap_3()
                        .child(widgets::icon_button("srv-back", "arrow-left", &theme, move |_, _, cx| {
                            let _ = view_back.update(cx, |this, cx| {
                                this.server_ui.selected = None;
                                this.load_servers(cx);
                                cx.notify();
                            });
                        }))
                        .child(
                            div().flex().flex_col()
                                .child(div().text_size(px(TEXT_2XL)).font_weight(bold()).text_color(theme.text).child(name))
                                .child(
                                    div().flex().items_center().gap_2()
                                        .child(widgets::tag(egg_label(&egg), theme.accent_soft, &theme))
                                        .child(widgets::tag(format!("Minecraft {mc}"), theme.info, &theme))
                                        .child(widgets::tag(status_label(&status), color, &theme)),
                                ),
                        ),
                )
                .child(widgets::button("srv-detail-toggle", if running { "Dừng server" } else { "Chạy server" }, &theme, !running,
                    move |_, _, cx| {
                        if running {
                            let _ = view_toggle.update(cx, |this, _cx| this.backend.server_stop(id.clone(), false));
                        } else {
                            let _ = view_toggle.update(cx, |this, cx| this.start_server(id.clone(), cx));
                        }
                    })),
        )
        .child(tab_row)
        .child(body)
}

fn info_card(theme: &Theme, icon_name: &str, label: &str, value: String) -> impl IntoElement {
    div()
        .flex().items_center().gap_3().flex_1().p(px(14.0)).rounded(px(RADIUS))
        .bg(theme.surface).border_1().border_color(theme.border_soft)
        .child(div().size(px(34.0)).rounded(px(9.0)).bg(theme.surface_active)
            .flex().items_center().justify_center()
            .child(widgets::icon(icon_name, 16.0, theme.accent_soft)))
        .child(div().flex().flex_col()
            .child(div().text_size(px(TEXT_XS)).text_color(theme.faint).child(label.to_string()))
            .child(div().text_size(px(TEXT_BASE)).font_weight(semibold()).text_color(theme.text).child(value)))
}

fn info_line(theme: &Theme, label: &str, value: &str) -> impl IntoElement {
    div().flex().items_center().justify_between().gap_4()
        .child(div().text_size(px(TEXT_SM)).text_color(theme.faint).child(label.to_string()))
        .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child(value.to_string()))
}

fn render_editor(app: &mut LauncherApp, cx: &mut Context<LauncherApp>, server: &Value) -> impl IntoElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let id = server.get("id").and_then(Value::as_str).unwrap_or("").to_string();
    let rel = app.server_ui.editor_rel.clone();
    let save_rel = rel.clone();
    page_body()
        .child(
            div().flex().items_center().justify_between()
                .child(div().flex().items_center().gap_2()
                    .child(widgets::icon("code", 18.0, theme.accent_soft))
                    .child(div().text_size(px(TEXT_MD)).font_weight(semibold()).text_color(theme.text).child(rel.clone())))
                .child(div().flex().items_center().gap_2()
                    .child(widgets::ghost_button("srv-ed-close", "Đóng", &theme, {
                        let view = view.clone();
                        move |_, _, cx| {
                            let _ = view.update(cx, |this, cx| {
                                this.server_ui.editor_open = false;
                                cx.notify();
                            });
                        }
                    }))
                    .child(widgets::button("srv-ed-save", "Lưu", &theme, true, {
                        let view = view.clone();
                        let id = id.clone();
                        let rel = save_rel.clone();
                        move |_, _, cx| {
                            let id = id.clone();
                            let rel = rel.clone();
                            let _ = view.update(cx, |this, cx| this.save_server_file(id.clone(), rel.clone(), cx));
                        }
                    }))),
        )
        .child(
            div().h(px(560.0)).p(px(12.0)).rounded(px(RADIUS))
                .bg(if theme.dark { gpui::rgb(0x07090c) } else { gpui::rgb(0xf7f8fa) })
                .border_1().border_color(theme.border_soft).text_size(px(12.0)).font_family(MONO)
                .child(app.editor_input.clone()),
        )
}

impl LauncherApp {
    pub fn load_servers(&mut self, cx: &mut Context<Self>) {
        let value = self.backend.servers();
        self.server_ui.servers = value.get("servers").and_then(Value::as_array).cloned().unwrap_or_default();
        if self.server_ui.instance_id.is_empty() {
            if let Some(first) = self.instances.first() {
                self.server_ui.instance_id = first.id.clone();
                self.server_ui.egg = match first.loader.as_str() {
                    "fabric" => "fabric".into(),
                    "forge" => "forge".into(),
                    "neoforge" => "neoforge".into(),
                    _ => "vanilla".into(),
                };
            }
        }
        cx.notify();
    }

    pub fn open_server(&mut self, id: String, cx: &mut Context<Self>) {
        self.server_ui.selected = Some(id.clone());
        self.server_ui.tab = "overview".into();
        self.server_ui.rel.clear();
        self.server_ui.editor_open = false;
        let value = self.backend.server_logs(&id);
        self.server_ui.console = value
            .get("lines")
            .and_then(Value::as_array)
            .map(|rows| rows.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        let value = self.backend.server_backups(&id);
        self.server_ui.backups = value.get("backups").and_then(Value::as_array).cloned().unwrap_or_default();
        let value = self.backend.server_file_list(&id, "");
        self.server_ui.files = value.get("entries").and_then(Value::as_array).cloned().unwrap_or_default();
        self.server_ui.schedule_form = false;
        self.server_ui.schedule_edit = None;
        self.server_ui.schedule_action = "command".into();
        self.server_ui.schedule_power = "restart".into();
        if let Some(server) = self
            .server_ui
            .servers
            .iter()
            .find(|row| row.get("id").and_then(Value::as_str) == Some(id.as_str()))
            .cloned()
        {
            self.server_ui.schedules = server
                .get("schedules")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let users = self.backend.server_users(&id);
            self.server_ui.users_whitelist = users
                .get("whitelist")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            self.server_ui.users_ops = users
                .get("ops")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let vars = server.get("vars").cloned().unwrap_or(Value::Null);
            self.server_ui.game_mode = vars.get("gamemode").and_then(Value::as_str).unwrap_or("survival").to_string();
            self.server_ui.difficulty = vars.get("difficulty").and_then(Value::as_str).unwrap_or("normal").to_string();
            self.server_ui.online = vars
                .get("online-mode")
                .and_then(Value::as_bool)
                .or_else(|| vars.get("online-mode").and_then(Value::as_str).map(|v| v != "false"))
                .unwrap_or(false);
            self.server_ui.pvp = vars
                .get("pvp")
                .and_then(Value::as_bool)
                .or_else(|| vars.get("pvp").and_then(Value::as_str).map(|v| v != "false"))
                .unwrap_or(true);
            let name = server.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            let ram = server.get("ramMb").and_then(Value::as_u64).unwrap_or(4096).to_string();
            let port = server.get("port").and_then(Value::as_u64).unwrap_or(25565).to_string();
            let motd = vars.get("motd").and_then(Value::as_str).unwrap_or("XyoLauncher Server").to_string();
            let jvm = vars.get("jvmArgs").and_then(Value::as_str).unwrap_or("").to_string();
            let input = self.name_input.clone();
            input.update(cx, |input, cx| input.set_text(name, cx));
            let input = self.memory_input.clone();
            input.update(cx, |input, cx| input.set_text(ram, cx));
            let input = self.server_port.clone();
            input.update(cx, |input, cx| input.set_text(port, cx));
            let input = self.server_motd.clone();
            input.update(cx, |input, cx| input.set_text(motd, cx));
            let input = self.server_jvm.clone();
            input.update(cx, |input, cx| input.set_text(jvm, cx));
        }
        cx.notify();
    }

    pub fn create_server(&mut self, cx: &mut Context<Self>) {
        if self.server_ui.instance_id.is_empty() {
            self.toast("warn", "Chọn phiên bản", "Chọn một phiên bản để tạo server.", cx);
            return;
        }
        let Some(instance) = self.instances.iter().find(|entry| entry.id == self.server_ui.instance_id).cloned() else {
            return;
        };
        let name = self.name_input.read(cx).text().trim().to_string();
        let ram = self.memory_input.read(cx).text().trim().parse::<u32>().unwrap_or(4096);
        self.server_ui.creating = true;
        let rx = self.backend.server_create(json!({
            "name": if name.is_empty() { format!("{} Server", instance.name) } else { name },
            "instanceId": instance.id,
            "egg": self.server_ui.egg,
            "mc": instance.version,
            "loaderVersion": instance.loader_version,
            "ramMb": ram,
        }));
        self.on_result(cx, rx, |this, value, cx| {
            this.server_ui.creating = false;
            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                this.load_servers(cx);
                this.toast("ok", "Đã tạo server", "Đang cài đặt ở nền…", cx);
            } else {
                this.toast("bad", "Tạo server thất bại", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
            }
        });
    }

    pub fn toggle_server(&mut self, id: String, running: bool, cx: &mut Context<Self>) {
        if running {
            self.backend.server_stop(id, false);
        } else {
            self.start_server(id, cx);
        }
    }

    pub fn start_server(&mut self, id: String, cx: &mut Context<Self>) {
        let rx = self.backend.server_start(id);
        self.on_result(cx, rx, |this, value, cx| {
            if !value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                this.toast("bad", "Không chạy được server", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
            }
        });
    }

    pub fn send_server_command(&mut self, cx: &mut Context<Self>) {
        let text = self.server_cmd.read(cx).text().to_string();
        if text.trim().is_empty() {
            return;
        }
        if let Some(id) = self.server_ui.selected.clone() {
            self.backend.server_command(id, text);
            let input = self.server_cmd.clone();
            input.update(cx, |input, cx| input.clear(cx));
        }
    }

    pub fn open_server_file(&mut self, rel: String, is_dir: bool, cx: &mut Context<Self>) {
        let Some(id) = self.server_ui.selected.clone() else { return };
        if is_dir {
            self.server_ui.rel = rel.clone();
            let value = self.backend.server_file_list(&id, &rel);
            self.server_ui.files = value.get("entries").and_then(Value::as_array).cloned().unwrap_or_default();
        } else {
            let ext = Path::new(&rel)
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if matches!(ext.as_str(), "txt" | "json" | "properties" | "yml" | "yaml" | "log" | "cfg" | "toml" | "bat" | "sh" | "ini") {
                let value = self.backend.server_file_read(&id, &rel);
                if let Some(text) = value.get("text").and_then(Value::as_str) {
                    let text = text.to_string();
                    self.server_ui.editor_open = true;
                    self.server_ui.editor_rel = rel;
                    let input = self.editor_input.clone();
                    input.update(cx, |input, cx| input.set_text(text, cx));
                }
            }
        }
        cx.notify();
    }

    pub fn save_server_file(&mut self, id: String, rel: String, cx: &mut Context<Self>) {
        let text = self.editor_input.read(cx).text().to_string();
        let value = self.backend.server_file_write(&id, &rel, &text);
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            self.toast("ok", "Đã lưu tệp", "", cx);
        } else {
            self.toast("bad", "Lưu tệp thất bại", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
        }
    }
}
