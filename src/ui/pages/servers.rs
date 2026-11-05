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
                                    .text_color(theme.text).overflow_hidden().child(name))
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

    let tabs = [("overview", "Tổng quan"), ("console", "Console"), ("files", "Tệp tin"), ("backups", "Sao lưu")];
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
            let start = logs.len().saturating_sub(700);
            let mut lines = div().flex().flex_col().p(px(10.0));
            for line in &logs[start..] {
                let color = if line.contains("ERROR") || line.contains("Exception") {
                    theme.bad
                } else if line.contains("WARN") {
                    theme.warn
                } else {
                    theme.muted
                };
                lines = lines.child(div().text_size(px(11.5)).font_family(MONO).text_color(color).child(line.clone()));
            }
            let view_stop = view.clone();
            let view_start = view.clone();
            body = body
                .child(
                    div().flex().items_center().gap_2()
                        .child(widgets::ghost_button("srv-console-copy", "Sao chép", &theme, {
                            let text = logs.join("\n");
                            move |_, _, cx| {
                                cx.write_to_clipboard(gpui::ClipboardItem::new_string(text.clone()));
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
                    div().id("server-console").h(px(460.0)).overflow_y_scroll().rounded(px(RADIUS))
                        .bg(if theme.dark { gpui::rgb(0x07090c) } else { gpui::rgb(0xf7f8fa) })
                        .border_1().border_color(theme.border_soft).child(lines),
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
                        .child(div().flex_1().text_size(px(TEXT_SM)).text_color(theme.text).overflow_hidden().child(entry_name))
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
                let id_restore = backup_id.clone();
                let id_delete = backup_id.clone();
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
