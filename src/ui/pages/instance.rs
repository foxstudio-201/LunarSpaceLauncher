use crate::models::Instance;
use crate::ui::app::{ConfirmAction, InstanceTab, LauncherApp, Modal};
use crate::ui::pages::{self, page_body};
use crate::ui::theme::*;
use crate::ui::widgets;
use gpui::{AnyElement, Context, FontWeight, IntoElement, Window, div, prelude::*, px};
use serde_json::Value;
use std::path::Path;

fn format_playtime(ms: u64) -> String {
    let minutes = ms / 60_000;
    if minutes == 0 {
        "Chưa chơi".into()
    } else if minutes < 60 {
        format!("{minutes} phút")
    } else {
        format!("{} giờ {} phút", minutes / 60, minutes % 60)
    }
}

fn selected_instance(app: &LauncherApp) -> Option<Instance> {
    app.selected_instance
        .as_ref()
        .and_then(|id| app.instances.iter().find(|i| &i.id == id))
        .cloned()
}

fn open_folder(dir: &str) {
    let _ = open::that(dir);
}

fn open_editor(app: &mut LauncherApp, rel: String, cx: &mut Context<LauncherApp>) {
    let Some(id) = app.selected_instance.clone() else {
        return;
    };
    let rx = app.backend.read_text_req(id, rel.clone());
    app.on_result(cx, rx, move |this, value, cx| {
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            let text = value
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            this.instance_ui.editor_open = true;
            this.instance_ui.editor_rel = rel.clone();
            this.instance_ui.editor_text = text.clone();
            this.instance_ui.editor_dirty = false;
            let input = this.editor_input.clone();
            input.update(cx, |input, cx| input.set_text(text, cx));
        } else {
            this.toast(
                "bad",
                "Không mở được tệp",
                value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Không rõ lỗi"),
                cx,
            );
        }
    });
}

fn reload_files(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    let Some(id) = app.selected_instance.clone() else {
        return;
    };
    let folder = match app.instance_tab {
        InstanceTab::Resourcepacks => "resourcepacks",
        InstanceTab::Shaderpacks => "shaderpacks",
        _ => "",
    };
    let rel = if folder.is_empty() {
        app.instance_ui.rel.clone()
    } else if app.instance_ui.rel.starts_with(folder) {
        app.instance_ui.rel.clone()
    } else if app.instance_ui.rel.is_empty() {
        folder.to_string()
    } else {
        format!("{folder}/{}", app.instance_ui.rel)
    };
    let value = app.backend.list_dir(&id, &rel);
    app.instance_ui.entries = value
        .get("entries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let _ = cx;
}

fn render_file_list(app: &mut LauncherApp, cx: &mut Context<LauncherApp>, theme: &Theme) -> AnyElement {
    let filter = app.file_search.read(cx).text().to_lowercase();
    let mut rows = div().flex().flex_col().gap(px(1.0)).w_full();
    let entries: Vec<Value> = app
        .instance_ui
        .entries
        .iter()
        .filter(|entry| {
            filter.is_empty()
                || entry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&filter)
        })
        .cloned()
        .collect();
    if entries.is_empty() {
        rows = rows.child(pages::empty_state(
            theme,
            "files",
            "Thư mục trống",
            "Kéo thả hoặc dùng nút Nhập tệp để thêm nội dung.",
        ));
    }
    let view = cx.entity().downgrade();
    for entry in entries {
        let name = entry
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let rel = entry
            .get("rel")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let dir = entry.get("dir").and_then(Value::as_bool).unwrap_or(false);
        let size = entry.get("size").and_then(Value::as_u64).unwrap_or(0);
        let disabled = entry
            .get("disabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let ext = Path::new(&name)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let text_like = matches!(
            ext.as_str(),
            "txt" | "json" | "json5" | "cfg" | "toml" | "properties" | "yml" | "yaml" | "log" | "md" | "ini" | "sh" | "bat" | "xml" | "mcmeta"
        );
        let can_toggle = dir == false
            && (ext == "jar" || ext == "zip" || name.ends_with(".disabled") || name.ends_with(".zip.txt"));
        let icon_name = if dir {
            "folder"
        } else if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp") {
            "image"
        } else if ext == "jar" || ext == "zip" {
            "package"
        } else if ext == "json" || ext == "toml" || ext == "cfg" {
            "code"
        } else if ext == "log" {
            "terminal"
        } else {
            "file"
        };
        let view_row = view.clone();
        let open_rel = rel.clone();
        let row = div()
            .id(gpui::SharedString::from(format!("file-{rel}")))
            .flex()
            .items_center()
            .gap_3()
            .h(px(40.0))
            .px(px(10.0))
            .rounded(px(6.0))
            .cursor_pointer()
            .hover(|s| s.bg(theme.surface_hover))
            .on_click(move |_, _, cx| {
                let _ = view_row.update(cx, |this, cx| {
                    if dir {
                        this.instance_ui.rel = open_rel.clone();
                        reload_files(this, cx);
                        cx.notify();
                    } else if text_like {
                        open_editor(this, open_rel.clone(), cx);
                    } else {
                        let full = this
                            .selected_instance()
                            .map(|i| Path::new(&i.dir).join(&open_rel))
                            .map(|p| p.to_string_lossy().into_owned())
                            .unwrap_or_default();
                        if !full.is_empty() {
                            let _ = open::that(&full);
                        }
                    }
                });
            })
            .child(widgets::icon(
                icon_name,
                16.0,
                if dir { theme.accent_soft } else { theme.muted },
            ))
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.0))
                    .truncate()
                    .text_size(px(TEXT_SM))
                    .font_weight(if dir { semibold() } else { regular() })
                    .text_color(if disabled { theme.faint } else { theme.text })
                    .child(name.clone()),
            )
            .when(!dir, |el| {
                el.child(
                    div()
                        .w(px(80.0))
                        .text_size(px(TEXT_XS))
                        .text_color(theme.faint)
                        .child(if size > 0 {
                            crate::util::format_bytes(size)
                        } else {
                            String::new()
                        }),
                )
            })
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .when(can_toggle, |el| {
                        let view = view.clone();
                        let rel = rel.clone();
                        let enable = disabled;
                        el.child(widgets::ghost_button(
                            gpui::SharedString::from(format!("toggle-file-{rel}")),
                            if disabled { "Bật" } else { "Tắt" },
                            theme,
                            move |_, _, cx| {
                                let rel = rel.clone();
                                let _ = view.update(cx, |this, cx| {
                                    if let Some(id) = this.selected_instance.clone() {
                                        this.backend.toggle_file(&id, &rel, enable);
                                        reload_files(this, cx);
                                        cx.notify();
                                    }
                                });
                            },
                        ))
                    })
                    .child(
                        {
                            let view = view.clone();
                            let rel = rel.clone();
                            widgets::ghost_button(
                                gpui::SharedString::from(format!("trash-file-{rel}")),
                                "Xoá",
                                theme,
                                move |_, _, cx| {
                                    let rel = rel.clone();
                                    let _ = view.update(cx, |this, cx| {
                                        let Some(id) = this.selected_instance.clone() else {
                                            return;
                                        };
                                        this.modal = Modal::Confirm {
                                            title: "Chuyển vào thùng rác?".into(),
                                            message: format!("{rel} sẽ được chuyển vào thùng rác của phiên bản, có thể khôi phục sau."),
                                            action: ConfirmAction::TrashFile(id, rel.clone()),
                                        };
                                        cx.notify();
                                    });
                                },
                            )
                        },
                    ),
            );
        rows = rows.child(row);
    }
    div()
        .flex()
        .flex_col()
        .gap_3()
        .w_full()
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_2()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(widgets::icon_button("files-up", "arrow-left", theme, {
                            let view = view.clone();
                            move |_, _, cx| {
                                let _ = view.update(cx, |this, cx| {
                                    let path = Path::new(&this.instance_ui.rel);
                                    this.instance_ui.rel = path
                                        .parent()
                                        .map(|p| p.to_string_lossy().replace('\\', "/"))
                                        .unwrap_or_default();
                                    reload_files(this, cx);
                                    cx.notify();
                                });
                            }
                        }))
                        .child(
                            div()
                                .text_size(px(TEXT_SM))
                                .text_color(theme.muted)
                                .child(if app.instance_ui.rel.is_empty() {
                                    "Thư mục gốc".to_string()
                                } else {
                                    app.instance_ui.rel.clone()
                                }),
                        )
                        .child(
                            div()
                                .w(px(240.0))
                                .child(widgets::text_input_box(theme).child(app.file_search.clone())),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(widgets::ghost_button("files-import", "Nhập tệp", theme, {
                            let view = view.clone();
                            move |_, _, cx| {
                                let view = view.clone();
                                cx.spawn(async move |cx| {
                                    let picked = rfd::AsyncFileDialog::new()
                                        .set_title("Chọn tệp để nhập")
                                        .pick_files()
                                        .await;
                                    if let Some(files) = picked {
                                        let paths: Vec<String> = files
                                            .iter()
                                            .map(|f| f.path().to_string_lossy().into_owned())
                                            .collect();
                                        let _ = view.update(cx, |this, cx| {
                                            let Some(id) = this.selected_instance.clone() else {
                                                return;
                                            };
                                            let folder = match this.instance_tab {
                                                InstanceTab::Resourcepacks => "resourcepacks",
                                                InstanceTab::Shaderpacks => "shaderpacks",
                                                _ => "",
                                            };
                                            let rel = if folder.is_empty() {
                                                this.instance_ui.rel.clone()
                                            } else if this.instance_ui.rel.is_empty() {
                                                folder.to_string()
                                            } else {
                                                this.instance_ui.rel.clone()
                                            };
                                            let rx = this.backend.import_paths_req(
                                                id,
                                                rel,
                                                paths.into_iter().map(std::path::PathBuf::from).collect(),
                                            );
                                            this.on_result(cx, rx, |this, value, cx| {
                                                if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                    this.toast("ok", "Đã nhập tệp", "", cx);
                                                    reload_files(this, cx);
                                                } else {
                                                    this.toast("bad", "Nhập tệp thất bại", "", cx);
                                                }
                                            });
                                        });
                                    }
                                })
                                .detach();
                            }
                        }))
                        .when(app.instance_tab != InstanceTab::Files, |el| {
                            let view = view.clone();
                            let kind = match app.instance_tab {
                                InstanceTab::Resourcepacks => "resourcepacks",
                                InstanceTab::Shaderpacks => "shaderpacks",
                                _ => "mods",
                            };
                            el.child(widgets::ghost_button("files-browse", "Thêm từ Modrinth", theme, move |_, _, cx| {
                                let view = view.clone();
                                let _ = view.update(cx, |this, cx| {
                                    if let Some(id) = this.selected_instance.clone() {
                                        crate::ui::pages::modpack::open_browser(this, kind, id, cx);
                                    }
                                });
                            }))
                        })
                        .child(widgets::ghost_button("files-reload", "Làm mới", theme, {
                            let view = view.clone();
                            move |_, _, cx| {
                                let _ = view.update(cx, |this, cx| {
                                    reload_files(this, cx);
                                    cx.notify();
                                });
                            }
                        })),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(
                    div()
                        .w(px(260.0))
                        .child(widgets::text_input_box(theme).child(app.file_name_input.clone())),
                )
                .child(widgets::ghost_button("files-create-file", "Tạo tệp", theme, {
                    let view = view.clone();
                    move |_, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            let Some(id) = this.selected_instance.clone() else { return };
                            let name = this.file_name_input.read(cx).text().trim().to_string();
                            if name.is_empty() {
                                this.toast("warn", "Nhập tên tệp", "", cx);
                                return;
                            }
                            let folder = match this.instance_tab {
                                InstanceTab::Resourcepacks => "resourcepacks",
                                InstanceTab::Shaderpacks => "shaderpacks",
                                _ => "",
                            };
                            let rel = if folder.is_empty() {
                                this.instance_ui.rel.clone()
                            } else if this.instance_ui.rel.is_empty() {
                                folder.to_string()
                            } else {
                                this.instance_ui.rel.clone()
                            };
                            let value = this.backend.create_entry(&id, &rel, &name, false);
                            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                this.toast("ok", "Đã tạo tệp", name, cx);
                                reload_files(this, cx);
                            } else {
                                this.toast("bad", "Không tạo được", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                            }
                        });
                    }
                }))
                .child(widgets::ghost_button("files-create-dir", "Tạo thư mục", theme, {
                    let view = view.clone();
                    move |_, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            let Some(id) = this.selected_instance.clone() else { return };
                            let name = this.file_name_input.read(cx).text().trim().to_string();
                            if name.is_empty() {
                                this.toast("warn", "Nhập tên thư mục", "", cx);
                                return;
                            }
                            let folder = match this.instance_tab {
                                InstanceTab::Resourcepacks => "resourcepacks",
                                InstanceTab::Shaderpacks => "shaderpacks",
                                _ => "",
                            };
                            let rel = if folder.is_empty() {
                                this.instance_ui.rel.clone()
                            } else if this.instance_ui.rel.is_empty() {
                                folder.to_string()
                            } else {
                                this.instance_ui.rel.clone()
                            };
                            let value = this.backend.create_entry(&id, &rel, &name, true);
                            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                this.toast("ok", "Đã tạo thư mục", name, cx);
                                reload_files(this, cx);
                            } else {
                                this.toast("bad", "Không tạo được", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                            }
                        });
                    }
                })),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .w_full()
                .rounded(px(RADIUS))
                .bg(theme.surface)
                .border_1()
                .border_color(theme.border_soft)
                .truncate()
                .child(rows),
        )
        .into_any_element()
}

pub fn render(app: &mut LauncherApp, window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let Some(instance) = selected_instance(app) else {
        return page_body()
            .child(pages::empty_state(
                &theme,
                "cube",
                "Chưa chọn phiên bản",
                "Quay lại trang Phiên bản và chọn một phiên bản để mở.",
            ))
            .into_any_element();
    };
    let view = cx.entity().downgrade();
    let id = instance.id.clone();

    if app.instance_ui.editor_open {
        return render_editor(app, window, cx).into_any_element();
    }

    let running = instance.running
        || matches!(instance.status.as_str(), "running" | "starting" | "stopping");
    let installing = instance.status == "installing";
    let status_label = match instance.status.as_str() {
        "running" => "Đang chơi",
        "starting" => "Đang khởi động",
        "stopping" => "Đang dừng",
        "installing" => "Đang cài đặt",
        "error" => "Gặp lỗi",
        _ => "Sẵn sàng",
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
    let progress = app.instance_progress(&instance.id);
    let loader_label = match instance.loader.as_str() {
        "vanilla" => "Vanilla".to_string(),
        "fabric" => "Fabric".into(),
        "quilt" => "Quilt".into(),
        "forge" => "Forge".into(),
        "neoforge" => "NeoForge".into(),
        "lunar" => "LunarLoader".into(),
        other => other.to_string(),
    };
    let icon = app.instance_icon_path(&instance);

    let view_play = view.clone();
    let folder_dir = instance.dir.clone();
    let mut header = div()
        .flex()
        .items_center()
        .justify_between()
        .gap_4()
        .child(
            div()
                .flex()
                .items_center()
                .gap_3()
                .child(
                    div()
                        .size(px(56.0))
                        .rounded(px(14.0))
                        .bg(theme.surface_active)
                        .truncate()
                        .flex()
                        .items_center()
                        .justify_center()
                        .when_some(icon, |el, path| {
                            el.child(gpui::img(path).size(px(56.0)).object_fit(gpui::ObjectFit::Cover))
                        })
                        .when(app.instance_icon_path(&instance).is_none(), |el| {
                            el.child(widgets::icon("cube", 26.0, theme.accent_soft))
                        }),
                )
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
                                .child(instance.name.clone()),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(widgets::tag(format!("Minecraft {}", instance.version), theme.accent_soft, &theme))
                                .child(widgets::tag(loader_label, theme.info, &theme))
                                .when_some(instance.loader_version.clone(), |el, version| {
                                    el.child(widgets::tag(version, theme.muted, &theme))
                                })
                                .child(widgets::tag(status_label, status_color, &theme)),
                        ),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(widgets::ghost_button("inst-folder", "Mở thư mục", &theme, move |_, _, _cx| {
                    let _ = open::that(&folder_dir);
                }))
                .child(widgets::button(
                    "inst-play",
                    if running {
                        "Dừng"
                    } else if installing {
                        "Đang cài đặt…"
                    } else {
                        "Chơi"
                    },
                    &theme,
                    !running && !installing,
                    move |_, _, cx| {
                        let id = id.clone();
                        let _ = view_play.update(cx, |this, cx| this.play_instance(&id, cx));
                    },
                )),
        );
    if let Some((label, percent, indeterminate, _)) = progress {
        header = header.child(
            div()
                .flex()
                .flex_col()
                .gap_2()
                .w_full()
                .child(
                    div()
                        .flex()
                        .justify_between()
                        .text_size(px(TEXT_XS))
                        .text_color(theme.muted)
                        .child(if label.is_empty() {
                            "Đang tải dữ liệu…".to_string()
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

    let mut body = page_body();
    body = body.child(header);

    match app.instance_tab {
        InstanceTab::Overview => {
            let stats = [
                (
                    "clock",
                    "Thời gian chơi",
                    format_playtime(instance.playtime_ms),
                ),
                (
                    "chart-line",
                    "Lần chơi cuối",
                    instance
                        .last_played
                        .as_deref()
                        .map(pages::short_time)
                        .unwrap_or_else(|| "Chưa chơi".into()),
                ),
                ("memory", "RAM", format!("{} MB", instance.memory_mb)),
                (
                    "coffee",
                    "Java",
                    instance
                        .java_major
                        .map(|m| format!("Java {m}"))
                        .unwrap_or_else(|| "Tự động".into()),
                ),
            ];
            let mut stat_row = div().flex().gap_3().w_full();
            for (icon_name, label, value) in stats {
                stat_row = stat_row.child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .flex_1()
                        .p(px(14.0))
                        .rounded(px(RADIUS))
                        .bg(theme.surface)
                        .border_1()
                        .border_color(theme.border_soft)
                        .child(
                            div()
                                .size(px(34.0))
                                .rounded(px(9.0))
                                .bg(theme.surface_active)
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(widgets::icon(icon_name, 16.0, theme.accent_soft)),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .child(
                                    div()
                                        .text_size(px(TEXT_XS))
                                        .text_color(theme.faint)
                                        .child(label),
                                )
                                .child(
                                    div()
                                        .text_size(px(TEXT_BASE))
                                        .font_weight(semibold())
                                        .text_color(theme.text)
                                        .child(value),
                                ),
                        ),
                );
            }
            let mut card = div()
                .flex()
                .flex_col()
                .gap_3()
                .p(px(18.0))
                .rounded(px(RADIUS_LG))
                .bg(theme.surface)
                .border_1()
                .border_color(theme.border_soft)
                .child(pages::section_title(&theme, "Thông tin phiên bản", ""))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .text_size(px(TEXT_SM))
                        .text_color(theme.muted)
                        .child(format!("Thư mục: {}", instance.dir))
                        .child(format!(
                            "Phiên bản game: {} ({})",
                            instance.version,
                            instance.version_id.as_deref().unwrap_or("chưa cài")
                        ))
                        .child(format!(
                            "Tài khoản mặc định: {}",
                            instance.username
                        ))
                        .when(instance.demo, |el| el.child("Chế độ demo: có"))
                        .when(instance.boost, |el| {
                            el.child("Tăng FPS (JVM flags): đang bật")
                        }),
                );
            if let Some(modpack) = instance.modpack.as_ref() {
                card = card.child(pages::section_title(&theme, "Modpack", ""));
                card = card.child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .p(px(12.0))
                        .rounded(px(RADIUS_SM))
                        .bg(theme.elevated)
                        .border_1()
                        .border_color(theme.border_soft)
                        .child(widgets::icon("stack", 20.0, theme.accent_soft))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .child(
                                    div()
                                        .text_size(px(TEXT_SM))
                                        .font_weight(semibold())
                                        .text_color(theme.text)
                                        .child(
                                            modpack
                                                .get("name")
                                                .and_then(Value::as_str)
                                                .unwrap_or("Modpack")
                                                .to_string(),
                                        ),
                                )
                                .child(
                                    div()
                                        .text_size(px(TEXT_XS))
                                        .text_color(theme.faint)
                                        .child(format!(
                                            "{} · {} mod",
                                            modpack
                                                .get("version")
                                                .and_then(Value::as_str)
                                                .unwrap_or(""),
                                            modpack.get("mods").and_then(Value::as_u64).unwrap_or(0)
                                        )),
                                ),
                        ),
                );
            }
            if instance.status == "error" {
                if let Some(error) = instance.error.clone() {
                    card = card.child(
                        div()
                            .p(px(12.0))
                            .rounded(px(RADIUS_SM))
                            .bg(theme.surface_active)
                            .text_size(px(TEXT_SM))
                            .text_color(theme.bad)
                            .child(error),
                    );
                }
            }
            body = body.child(stat_row).child(card);
            let count_dir = |name: &str| {
                std::fs::read_dir(Path::new(&instance.dir).join(name))
                    .map(|entries| entries.flatten().count())
                    .unwrap_or(0)
            };
            let mods_count = count_dir("mods");
            let saves_count = count_dir("saves");
            let packs_count = count_dir("resourcepacks");
            let shaders_count = count_dir("shaderpacks");
            let view_quick = view.clone();
            let quick_cards = [
                ("puzzle-piece", "Mods", mods_count, InstanceTab::Mods),
                ("archive", "Bản lưu", saves_count, InstanceTab::Saves),
                ("image", "Gói tài nguyên", packs_count, InstanceTab::Resourcepacks),
                ("paint-brush", "Shader", shaders_count, InstanceTab::Shaderpacks),
            ];
            let mut quick = div().flex().gap_3().flex_wrap();
            for (icon_name, label, count, tab) in quick_cards {
                let view = view_quick.clone();
                quick = quick.child(
                    div()
                        .id(gpui::SharedString::from(format!("quick-{}", label)))
                        .flex()
                        .items_center()
                        .gap_3()
                        .w(px(220.0))
                        .flex_grow()
                        .p(px(12.0))
                        .rounded(px(RADIUS))
                        .bg(theme.surface)
                        .border_1()
                        .border_color(theme.border_soft)
                        .cursor_pointer()
                        .hover(|st| st.bg(theme.surface_hover).border_color(theme.border))
                        .on_click(move |_, _, cx| {
                            let _ = view.update(cx, |this, cx| {
                                this.instance_tab = tab;
                                let target = 78.0 + tab as usize as f32 * 38.0;
                                this.update_pill(target, true, cx);
                                this.load_instance_tab(cx);
                                cx.notify();
                            });
                        })
                        .child(
                            div()
                                .size(px(34.0))
                                .rounded(px(9.0))
                                .bg(theme.surface_active)
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(widgets::icon(icon_name, 16.0, theme.accent_soft)),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .child(div().text_size(px(TEXT_XS)).text_color(theme.faint).child(label))
                                .child(div().text_size(px(TEXT_MD)).font_weight(semibold()).text_color(theme.text).child(format!("{count} mục"))),
                        ),
                );
            }
            body = body.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(pages::section_title(&theme, "Truy cập nhanh", ""))
                    .child(quick),
            );
            let recent_logs = app.logs.get(&instance.id).cloned().unwrap_or_default();
            if !recent_logs.is_empty() {
                let view_log = view.clone();
                let mut lines = div().flex().flex_col();
                for line in recent_logs.iter().rev().take(6).rev() {
                    lines = lines.child(
                        div()
                            .text_size(px(11.0))
                            .font_family(MONO)
                            .text_color(console_color(line, &theme))
                            .truncate()
                            .child(crate::util::strip_minecraft_codes(line)),
                    );
                }
                body = body.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .p(px(14.0))
                        .rounded(px(RADIUS))
                        .bg(if theme.dark { gpui::rgb(0x07090c) } else { gpui::rgb(0xf7f8fa) })
                        .border_1()
                        .border_color(theme.border_soft)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .child(widgets::icon("terminal", 14.0, theme.accent_soft))
                                        .child(div().text_size(px(TEXT_SM)).font_weight(semibold()).text_color(theme.text).child("Console gần đây")),
                                )
                                .child(widgets::ghost_button("overview-console", "Mở console", &theme, move |_, _, cx| {
                                    let _ = view_log.update(cx, |this, cx| {
                                        this.instance_tab = InstanceTab::Console;
                                        this.update_pill(78.0 + InstanceTab::Console as usize as f32 * 38.0, true, cx);
                                        this.load_instance_tab(cx);
                                        cx.notify();
                                    });
                                })),
                        )
                        .child(lines),
                );
            }
            if !app.instance_ui.worlds.is_empty() {
                let mut list = div().flex().flex_col().gap_2();
                for world in app.instance_ui.worlds.iter().take(6).cloned().collect::<Vec<_>>() {
                    let name = world
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("World")
                        .to_string();
                    let folder = world
                        .get("folder")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let version = world
                        .get("version")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let view_world = view.clone();
                    list = list.child(
                        div()
                            .id(gpui::SharedString::from(format!("overview-world-{folder}")))
                            .flex()
                            .items_center()
                            .justify_between()
                            .p(px(10.0))
                            .rounded(px(RADIUS_SM))
                            .bg(theme.elevated)
                            .cursor_pointer()
                            .hover(|s| s.bg(theme.surface_hover))
                            .on_click(move |_, _, cx| {
                                let folder = folder.clone();
                                let _ = view_world.update(cx, |this, cx| {
                                    this.instance_tab = InstanceTab::Saves;
                                    this.instance_ui.world_open = Some(folder);
                                    this.load_worlds(cx);
                                    cx.notify();
                                });
                            })
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(widgets::icon("archive", 15.0, theme.accent_soft))
                                    .child(
                                        div()
                                            .text_size(px(TEXT_SM))
                                            .font_weight(medium())
                                            .text_color(theme.text)
                                            .child(name),
                                    ),
                            )
                            .child(
                                div()
                                    .text_size(px(TEXT_XS))
                                    .text_color(theme.faint)
                                    .child(version),
                            ),
                    );
                }
                body = body.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .p(px(18.0))
                        .rounded(px(RADIUS_LG))
                        .bg(theme.surface)
                        .border_1()
                        .border_color(theme.border_soft)
                        .child(pages::section_title(&theme, "Bản lưu gần đây", ""))
                        .child(list),
                );
            }
        }
        InstanceTab::Console => {
            let instance = selected_instance(app);
            let logs_all = app.instance_ui.logs.clone();
            let filter = app.console_filter.read(cx).text().to_lowercase();
            let search = app.console_search_input.read(cx).text().trim().to_lowercase();
            let level = app.instance_ui.console_level.clone();
            let font = app.instance_ui.console_font;
            let hidden = app.instance_ui.console_hidden.min(logs_all.len());
            let console_height = (f32::from(window.viewport_size().height) - 390.0).clamp(220.0, 900.0);

            let mut text = String::new();
            let mut runs: Vec<(std::ops::Range<usize>, gpui::HighlightStyle)> = Vec::new();
            let mut shown = 0usize;
            for line in &logs_all[hidden..] {
                let clean = crate::util::strip_minecraft_codes(&crate::util::strip_ansi(line));
                let line_level = console_level_of(&clean);
                if !level.is_empty() && line_level != level {
                    continue;
                }
                if !filter.is_empty() && !clean.to_lowercase().contains(&filter) {
                    continue;
                }
                if shown > 0 {
                    text.push('\n');
                }
                let base = text.len();
                let pieces = console_pieces(&clean, &theme);
                let mut line_text = String::new();
                let mut spans = Vec::new();
                for piece in &pieces {
                    let start = line_text.len();
                    line_text.push_str(&piece.text);
                    spans.push((start, line_text.len(), piece));
                }
                let lowered = line_text.to_lowercase();
                let matches: Vec<(usize, usize)> = if !search.is_empty() && lowered.len() == line_text.len() {
                    lowered
                        .match_indices(&search)
                        .map(|(start, hit)| (start, start + hit.len()))
                        .collect()
                } else {
                    Vec::new()
                };
                for (start, end, piece) in spans {
                    let mut bounds = vec![start, end];
                    for (match_start, match_end) in &matches {
                        if *match_end <= start || *match_start >= end {
                            continue;
                        }
                        bounds.push((*match_start).clamp(start, end));
                        bounds.push((*match_end).clamp(start, end));
                    }
                    bounds.sort_unstable();
                    bounds.dedup();
                    for pair in bounds.windows(2) {
                        let (from, to) = (pair[0], pair[1]);
                        if from >= to {
                            continue;
                        }
                        let hit = matches
                            .iter()
                            .any(|(match_start, match_end)| from >= *match_start && to <= *match_end);
                        runs.push((
                            base + from..base + to,
                            gpui::HighlightStyle {
                                color: Some(piece.color.into()),
                                font_weight: if piece.bold { Some(FontWeight::BOLD) } else { None },
                                background_color: if hit { Some(gpui::rgba(0xE9B87240).into()) } else { None },
                                ..Default::default()
                            },
                        ));
                    }
                }
                text.push_str(&line_text);
                shown += 1;
            }

            let mut style = gpui::TextStyle::default();
            style.color = theme.text.into();
            style.font_family = MONO.into();
            style.font_size = px(font).into();
            style.line_height = px(font * 1.45).into();

            let mut terminal = div()
                .w_full()
                .rounded(px(RADIUS_SM))
                .bg(if theme.dark { gpui::rgb(0x07090c) } else { gpui::rgb(0xf7f8fa) })
                .border_1()
                .border_color(theme.border_soft);
            if text.is_empty() {
                terminal = terminal.child(
                    div()
                        .h(px(console_height - 22.0))
                        .w_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .text_size(px(11.5))
                                .text_color(theme.faint)
                                .child(if logs_all.is_empty() {
                                    "Chưa có log. Bấm Chơi để bắt đầu."
                                } else {
                                    "Không có dòng log khớp bộ lọc."
                                }),
                        ),
                );
            } else {
                terminal = terminal.child(
                    div()
                        .w_full()
                        .p(px(10.0))
                        .child(gpui::StyledText::new(text).with_default_highlights(&style, runs)),
                );
            }

            let view_search_btn = view.clone();
            let view_minus = view.clone();
            let view_plus = view.clone();
            let view_bottom = view.clone();
            let view_copy = view.clone();
            let view_upload = view.clone();
            let view_clear = view.clone();
            let view_filter_clear = view.clone();
            let view_auto = view.clone();

            let searching = app.instance_ui.console_search_open;
            let status = instance.as_ref().map(|i| i.status.clone()).unwrap_or_else(|| "ready".into());
            let running = instance.as_ref().map(|i| i.running).unwrap_or(false)
                || matches!(status.as_str(), "running" | "starting" | "stopping");
            let (state_color, state_label) = if running {
                if status == "stopping" { (theme.warn, "Đang dừng") } else { (theme.ok, "Đang chạy") }
            } else if status == "error" {
                (theme.bad, "Lỗi")
            } else {
                (theme.faint, "Sẵn sàng")
            };

            let mut level_row = div().flex().items_center().gap(px(4.0));
            for (key, label) in [("", "Tất cả"), ("INFO", "Info"), ("WARN", "Warn"), ("ERROR", "Lỗi")] {
                let active = app.instance_ui.console_level == key;
                let view_level = view.clone();
                let key = key.to_string();
                level_row = level_row.child(
                    div()
                        .id(gpui::SharedString::from(format!("console-level-{label}")))
                        .h(px(24.0))
                        .px(px(9.0))
                        .flex()
                        .items_center()
                        .rounded_full()
                        .bg(if active { theme.accent_dim } else { theme.elevated })
                        .border_1()
                        .border_color(if active { theme.accent } else { theme.border_soft })
                        .text_size(px(10.0))
                        .font_weight(if active { semibold() } else { medium() })
                        .text_color(if active { theme.accent_soft } else { theme.muted })
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let key = key.clone();
                            let _ = view_level.update(cx, |this, cx| {
                                this.instance_ui.console_level = key;
                                this.instance_ui.console_hidden = 0;
                                cx.notify();
                            });
                        })
                        .child(label.to_string()),
                );
            }

            let mut toolbar_actions = div().flex().items_center().gap_1();
            toolbar_actions = toolbar_actions
                .child(
                    div()
                        .id("console-search-toggle")
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(28.0))
                        .rounded(px(6.0))
                        .bg(if searching { theme.accent_dim } else { theme.elevated })
                        .cursor_pointer()
                        .hover(|s| s.bg(theme.surface_hover))
                        .on_click(move |_, _, cx| {
                            let _ = view_search_btn.update(cx, |this, cx| {
                                this.instance_ui.console_search_open = !this.instance_ui.console_search_open;
                                if !this.instance_ui.console_search_open {
                                    let input = this.console_search_input.clone();
                                    input.update(cx, |input, cx| input.clear(cx));
                                }
                                cx.notify();
                            });
                        })
                        .child(widgets::icon("magnifying-glass", 14.0, if searching { theme.accent_soft } else { theme.muted })),
                )
                .child(
                    div()
                        .id("console-font-minus")
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(28.0))
                        .rounded(px(6.0))
                        .cursor_pointer()
                        .hover(|s| s.bg(theme.surface_hover))
                        .on_click(move |_, _, cx| {
                            let _ = view_minus.update(cx, |this, cx| {
                                this.instance_ui.console_font = (this.instance_ui.console_font - 1.0).max(9.0);
                                cx.notify();
                            });
                        })
                        .child(widgets::icon("minus", 13.0, theme.muted)),
                )
                .child(
                    div()
                        .min_w(px(34.0))
                        .text_center()
                        .text_size(px(10.0))
                        .font_family(MONO)
                        .text_color(theme.faint)
                        .child(format!("{}px", font as i32)),
                )
                .child(
                    div()
                        .id("console-font-plus")
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(28.0))
                        .rounded(px(6.0))
                        .cursor_pointer()
                        .hover(|s| s.bg(theme.surface_hover))
                        .on_click(move |_, _, cx| {
                            let _ = view_plus.update(cx, |this, cx| {
                                this.instance_ui.console_font = (this.instance_ui.console_font + 1.0).min(24.0);
                                cx.notify();
                            });
                        })
                        .child(widgets::icon("plus", 13.0, theme.muted)),
                );

            let mut console = div()
                .flex()
                .flex_col()
                .w_full()
                .gap(px(8.0))
                .p(px(10.0))
                .rounded(px(RADIUS))
                .bg(theme.surface)
                .border_1()
                .border_color(theme.border_soft)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(div().size(px(7.0)).rounded_full().bg(state_color))
                                .child(div().text_size(px(11.0)).font_weight(semibold()).text_color(state_color).child(state_label)),
                        )
                        .child(toolbar_actions),
                )
                .child(level_row)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .text_size(px(10.0))
                        .text_color(theme.faint)
                        .child(format!("{shown} / {} dòng", logs_all.len().saturating_sub(hidden))),
                );

            if searching {
                console = console.child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(div().flex_1().child(widgets::text_input_box(&theme).child(app.console_search_input.clone()))),
                );
            }

            console = console
                .child(
                    div()
                        .id("console-scroll")
                        .h(px(console_height))
                        .overflow_y_scroll()
                        .track_scroll(&app.console_scroll)
                        .child(terminal),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .flex_1()
                                .child(widgets::text_input_box(&theme).child(app.console_filter.clone())),
                        )
                        .when(!filter.is_empty(), |el| {
                            el.child(widgets::ghost_button("console-filter-clear", "Bỏ lọc", &theme, move |_, _, cx| {
                                let _ = view_filter_clear.update(cx, |this, cx| {
                                    let input = this.console_filter.clone();
                                    input.update(cx, |input, cx| input.clear(cx));
                                    cx.notify();
                                });
                            }))
                        })
                        .child(
                            div()
                                .id("console-auto")
                                .h(px(30.0))
                                .px(px(9.0))
                                .flex()
                                .items_center()
                                .rounded(px(5.0))
                                .bg(if app.console_auto { theme.accent_dim } else { theme.elevated })
                                .border_1()
                                .border_color(if app.console_auto { theme.accent } else { theme.border })
                                .text_size(px(10.0))
                                .text_color(if app.console_auto { theme.accent_soft } else { theme.muted })
                                .cursor_pointer()
                                .on_click(move |_, _, cx| {
                                    let _ = view_auto.update(cx, |this, cx| {
                                        this.console_auto = !this.console_auto;
                                        if this.console_auto {
                                            this.console_scroll.scroll_to_bottom();
                                        }
                                        cx.notify();
                                    });
                                })
                                .child(if app.console_auto { "Tự cuộn" } else { "Tự cuộn: tắt" }),
                        )
                        .child(widgets::ghost_button("console-bottom", "Cuối log", &theme, {
                            let view = view_bottom;
                            move |_, _, cx| {
                                let _ = view.update(cx, |this, cx| {
                                    this.console_scroll.scroll_to_bottom();
                                    cx.notify();
                                });
                            }
                        }))
                        .child(widgets::ghost_button("console-copy", "Sao chép", &theme, {
                            let text = logs_all.join("\n");
                            move |_, _, cx| {
                                cx.write_to_clipboard(gpui::ClipboardItem::new_string(text.clone()));
                            }
                        }))
                        .child(widgets::ghost_button("console-upload", "Gửi log", &theme, move |_, _, cx| {
                            let text = logs_all.join("\n");
                            let _ = view_upload.update(cx, |this, cx| {
                                if text.is_empty() {
                                    this.toast("warn", "Chưa có log", "Chạy game để có log.", cx);
                                    return;
                                }
                                let rx = this.backend.upload_log_req(text.clone());
                                this.on_result(cx, rx, |this, value, cx| {
                                    if let Some(url) = value.get("url").and_then(Value::as_str) {
                                        let _ = open::that(url);
                                        this.toast("ok", "Đã gửi log", url.to_string(), cx);
                                    } else {
                                        this.toast("bad", "Gửi log thất bại", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                                    }
                                });
                            });
                        }))
                        .child(widgets::ghost_button("console-clear", "Xoá", &theme, move |_, _, cx| {
                            let _ = view_clear.update(cx, |this, cx| {
                                this.instance_ui.console_hidden = this.instance_ui.logs.len();
                                this.console_scroll.scroll_to_bottom();
                                cx.notify();
                            });
                        })),
                );

            let launch_error = app
                .selected_instance
                .as_ref()
                .and_then(|id| app.launch_errors.get(id))
                .cloned();
            if let Some(error) = launch_error {
                body = body.child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .p(px(10.0))
                        .rounded(px(RADIUS_SM))
                        .bg(gpui::rgba(0xEF444426))
                        .border_1()
                        .border_color(gpui::rgba(0xEF444459))
                        .child(widgets::icon("warning-circle", 14.0, theme.bad))
                        .child(div().flex_1().text_size(px(11.0)).text_color(theme.bad).child(error)),
                );
            }

            let footer = {
                let mut row = div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .text_size(px(10.0))
                    .text_color(theme.faint)
                    .child(div().size(px(5.0)).rounded_full().bg(state_color))
                    .child(state_label)
                    .child(div().flex_1());
                if let Some(instance) = instance.as_ref() {
                    let loader = if instance.loader.is_empty() { "vanilla".to_string() } else { instance.loader.clone() };
                    let loader = match instance.loader_version.as_deref() {
                        Some(version) if !version.is_empty() => format!("{loader}-{version}"),
                        _ => loader,
                    };
                    row = row
                        .child(div().font_family(MONO).child(loader))
                        .child(div().font_family(MONO).child(instance.version.clone()));
                    if instance.java_major.is_some() {
                        row = row.child(div().font_family(MONO).child(format!("Java {}+", instance.java_major.unwrap_or(0))));
                    }
                }
                row
            };

            body = body.child(console).child(footer);
        }
        InstanceTab::Mods => {
            let filter = app.file_search.read(cx).text().to_lowercase();
            let view = view.clone();
            let mut rows = div().flex().flex_col().gap(px(2.0)).w_full();
            let mods: Vec<Value> = app
                .instance_ui
                .mods
                .iter()
                .filter(|m| {
                    filter.is_empty()
                        || m.get("title")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_lowercase()
                            .contains(&filter)
                })
                .cloned()
                .collect();
            if mods.is_empty() {
                rows = rows.child(pages::empty_state(
                    &theme,
                    "puzzle-piece",
                    "Chưa có mod nào",
                    "Thêm mod bằng nút Nhập tệp hoặc cài modpack.",
                ));
            }
            for item in mods {
                let name = item
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let title = item
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or(&name)
                    .to_string();
                let rel = item
                    .get("rel")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let disabled = item
                    .get("disabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let size = item.get("size").and_then(Value::as_u64).unwrap_or(0);
                let view_toggle = view.clone();
                let view_delete = view.clone();
                let rel_toggle = rel.clone();
                let rel_delete = rel.clone();
                let icon_path = item
                    .get("icon")
                    .and_then(Value::as_str)
                    .and_then(|url| app.icon_cache.get(url))
                    .cloned();
                rows = rows.child(
                    div()
                        .id(gpui::SharedString::from(format!("mod-{rel}")))
                        .flex()
                        .items_center()
                        .gap_3()
                        .h(px(46.0))
                        .px(px(10.0))
                        .rounded(px(6.0))
                        .hover(|s| s.bg(theme.surface_hover))
                        .child(
                            div()
                                .size(px(30.0))
                                .rounded(px(7.0))
                                .bg(theme.surface_active)
                                .truncate()
                                .flex()
                                .items_center()
                                .justify_center()
                                .when_some(icon_path, |el, path| {
                                    el.child(gpui::img(path).size(px(30.0)).object_fit(gpui::ObjectFit::Cover))
                                })
                                .when(item.get("icon").and_then(Value::as_str).map(|url| !app.icon_cache.contains_key(url)).unwrap_or(true), |el| {
                                    el.child(widgets::icon("puzzle-piece", 15.0, theme.accent_soft))
                                }),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w(px(0.0))
                                .child(
                                    div()
                                        .text_size(px(TEXT_SM))
                                        .font_weight(medium())
                                        .text_color(if disabled { theme.faint } else { theme.text })
                                        .truncate()
                                        .child(title),
                                )
                                .child(
                                    div()
                                        .text_size(px(10.0))
                                        .text_color(theme.faint)
                                        .truncate()
                                        .child(format!(
                                            "{} · {}",
                                            crate::util::format_bytes(size),
                                            if disabled { "Đã tắt" } else { "Đang bật" }
                                        )),
                                ),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.0))
                                .child(widgets::ghost_button(
                                    gpui::SharedString::from(format!("mod-toggle-{rel}")),
                                    if disabled { "Bật" } else { "Tắt" },
                                    &theme,
                                    move |_, _, cx| {
                                        let rel = rel_toggle.clone();
                                        let _ = view_toggle.update(cx, |this, cx| {
                                            if let Some(id) = this.selected_instance.clone() {
                                                this.backend.toggle_file(&id, &rel, disabled);
                                                let rx = this.backend.mods_inventory(id);
                                                this.on_result(cx, rx, |this, value, cx| {
                                                    this.instance_ui.mods = value
                                                        .get("mods")
                                                        .and_then(Value::as_array)
                                                        .cloned()
                                                        .unwrap_or_default();
                                                    cx.notify();
                                                });
                                            }
                                        });
                                    },
                                ))
                                .child(widgets::ghost_button(
                                    gpui::SharedString::from(format!("mod-del-{rel}")),
                                    "Xoá",
                                    &theme,
                                    move |_, _, cx| {
                                        let rel = rel_delete.clone();
                                        let _ = view_delete.update(cx, |this, cx| {
                                            if let Some(id) = this.selected_instance.clone() {
                                                this.modal = Modal::Confirm {
                                                    title: "Chuyển mod vào thùng rác?".into(),
                                                    message: format!("{rel} sẽ được chuyển vào thùng rác của phiên bản."),
                                                    action: ConfirmAction::TrashFile(id, rel.clone()),
                                                };
                                                cx.notify();
                                            }
                                        });
                                    },
                                )),
                        ),
                );
            }
            body = body.child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_2()
                    .child(
                        div()
                            .w(px(280.0))
                            .child(widgets::text_input_box(&theme).child(app.file_search.clone())),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(widgets::ghost_button("mods-import", "Nhập tệp", &theme, {
                                let view = view.clone();
                                move |_, _, cx| {
                                    let view = view.clone();
                                    cx.spawn(async move |cx| {
                                        let picked = rfd::AsyncFileDialog::new()
                                            .add_filter("Mod", &["jar", "zip"])
                                            .pick_files()
                                            .await;
                                        if let Some(files) = picked {
                                            let paths: Vec<std::path::PathBuf> = files
                                                .iter()
                                                .map(|f| f.path().to_path_buf())
                                                .collect();
                                            let _ = view.update(cx, |this, cx| {
                                                if let Some(id) = this.selected_instance.clone() {
                                                    let rx = this.backend.import_paths_req(id, "mods".into(), paths);
                                                    this.on_result(cx, rx, |this, value, cx| {
                                                        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                            this.toast("ok", "Đã thêm mod", "", cx);
                                                            this.load_instance_tab(cx);
                                                        } else {
                                                            this.toast("bad", "Nhập mod thất bại", "", cx);
                                                        }
                                                    });
                                                }
                                            });
                                        }
                                    })
                                    .detach();
                                }
                            }))
                            .child(widgets::ghost_button("mods-browse", "Thêm từ Modrinth", &theme, {
                                let view = view.clone();
                                move |_, _, cx| {
                                    let view = view.clone();
                                    let _ = view.update(cx, |this, cx| {
                                        if let Some(id) = this.selected_instance.clone() {
                                            crate::ui::pages::modpack::open_browser(this, "mods", id, cx);
                                        }
                                    });
                                }
                            }))
                            .child(widgets::ghost_button("mods-folder", "Mở thư mục mods", &theme, {
                                let dir = Path::new(&instance.dir).join("mods").to_string_lossy().into_owned();
                                move |_, _, _cx| {
                                    let _ = open::that(&dir);
                                }
                            })),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .w_full()
                    .rounded(px(RADIUS))
                    .bg(theme.surface)
                    .border_1()
                    .border_color(theme.border_soft)
                    .truncate()
                    .child(rows),
            );
        }
        InstanceTab::Files | InstanceTab::Resourcepacks | InstanceTab::Shaderpacks => {
            body = body.child(render_file_list(app, cx, &theme));
        }
        InstanceTab::Trash => {
            let view = view.clone();
            let mut rows = div().flex().flex_col().gap(px(2.0)).w_full();
            if app.instance_ui.trash.is_empty() {
                rows = rows.child(pages::empty_state(
                    &theme,
                    "trash",
                    "Thùng rác trống",
                    "Tệp bị xoá trong phiên bản này sẽ nằm ở đây và có thể khôi phục.",
                ));
            }
            for item in app.instance_ui.trash.iter().cloned().collect::<Vec<_>>() {
                let entry_id = item
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let name = item
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let rel = item
                    .get("rel")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let size = item.get("size").and_then(Value::as_u64).unwrap_or(0);
                let view_restore = view.clone();
                let view_purge = view.clone();
                let id_restore = entry_id.clone();
                let id_purge = entry_id.clone();
                rows = rows.child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .h(px(44.0))
                        .px(px(10.0))
                        .rounded(px(6.0))
                        .hover(|s| s.bg(theme.surface_hover))
                        .child(widgets::icon("trash", 15.0, theme.faint))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w(px(0.0))
                                .child(
                                    div()
                                        .text_size(px(TEXT_SM))
                                        .text_color(theme.text)
                                        .truncate()
                                        .child(name),
                                )
                                .child(
                                    div()
                                        .text_size(px(10.0))
                                        .text_color(theme.faint)
                                        .child(format!("{rel} · {}", crate::util::format_bytes(size))),
                                ),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.0))
                                .child(widgets::ghost_button("trash-restore", "Khôi phục", &theme, move |_, _, cx| {
                                    let entry_id = id_restore.clone();
                                    let _ = view_restore.update(cx, |this, cx| {
                                        if let Some(id) = this.selected_instance.clone() {
                                            let value = this.backend.restore_trash(&id, &entry_id);
                                            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                this.toast("ok", "Đã khôi phục", "", cx);
                                                this.load_instance_tab(cx);
                                            }
                                        }
                                    });
                                }))
                                .child(widgets::ghost_button("trash-purge", "Xoá hẳn", &theme, move |_, _, cx| {
                                    let entry_id = id_purge.clone();
                                    let _ = view_purge.update(cx, |this, cx| {
                                        if let Some(id) = this.selected_instance.clone() {
                                            this.modal = Modal::Confirm {
                                                title: "Xoá hẳn?".into(),
                                                message: "Mục này sẽ bị xoá vĩnh viễn khỏi thùng rác.".into(),
                                                action: ConfirmAction::PurgeTrash(id, vec![entry_id.clone()]),
                                            };
                                            cx.notify();
                                        }
                                    });
                                })),
                        ),
                );
            }
            body = body.child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .text_size(px(TEXT_SM))
                            .text_color(theme.muted)
                            .child(format!("{} mục trong thùng rác", app.instance_ui.trash.len())),
                    )
                    .child(widgets::button("trash-empty", "Dọn sạch", &theme, false, {
                        let view = view.clone();
                        move |_, _, cx| {
                            let _ = view.update(cx, |this, cx| {
                                if let Some(id) = this.selected_instance.clone() {
                                    let ids: Vec<String> = this
                                        .instance_ui
                                        .trash
                                        .iter()
                                        .filter_map(|row| row.get("id").and_then(Value::as_str).map(str::to_string))
                                        .collect();
                                    this.modal = Modal::Confirm {
                                        title: "Dọn sạch thùng rác?".into(),
                                        message: "Toàn bộ mục trong thùng rác sẽ bị xoá vĩnh viễn.".into(),
                                        action: ConfirmAction::PurgeTrash(id, ids),
                                    };
                                    cx.notify();
                                }
                            });
                        }
                    })),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .w_full()
                    .rounded(px(RADIUS))
                    .bg(theme.surface)
                    .border_1()
                    .border_color(theme.border_soft)
                    .truncate()
                    .child(rows),
            );
        }
        InstanceTab::Saves => {
            let view = view.clone();
            let mut grid = div().flex().gap_3().flex_wrap();
            if app.instance_ui.worlds.is_empty() {
                grid = grid.child(
                    div()
                        .w_full()
                        .child(pages::empty_state(
                            &theme,
                            "archive",
                            "Chưa có bản lưu",
                            "Vào game tạo thế giới mới, bản lưu sẽ xuất hiện ở đây.",
                        )),
                );
            }
            for world in app.instance_ui.worlds.iter().cloned().collect::<Vec<_>>() {
                let folder = world
                    .get("folder")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let name = world
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("World")
                    .to_string();
                let version = world
                    .get("version")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let seed = world
                    .get("seed")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let size = world.get("size").and_then(Value::as_u64).unwrap_or(0);
                let icon = world
                    .get("icon")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let view_folder = view.clone();
                let view_map = view.clone();
                let folder_map = folder.clone();
                let dir = instance.dir.clone();
                grid = grid.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .w(px(300.0))
                        .flex_grow()
                        .p(px(14.0))
                        .rounded(px(RADIUS_LG))
                        .bg(theme.surface)
                        .border_1()
                        .border_color(theme.border_soft)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_3()
                                .child(
                                    div()
                                        .size(px(42.0))
                                        .rounded(px(10.0))
                                        .bg(theme.surface_active)
                                        .truncate()
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .when_some(icon, |el, path| {
                                            el.child(gpui::img(path).size(px(42.0)).object_fit(gpui::ObjectFit::Cover))
                                        })
                                        .when(world.get("icon").and_then(Value::as_str).is_none(), |el| {
                                            el.child(widgets::icon("map-trifold", 20.0, theme.accent_soft))
                                        }),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .min_w(px(0.0))
                                        .child(
                                            div()
                                                .text_size(px(TEXT_MD))
                                                .font_weight(semibold())
                                                .text_color(theme.text)
                                                .truncate()
                                                .child(name),
                                        )
                                        .child(
                                            div()
                                                .text_size(px(TEXT_XS))
                                                .text_color(theme.faint)
                                                .child(format!(
                                                    "{} · {}",
                                                    version,
                                                    crate::util::format_bytes(size)
                                                )),
                                        ),
                                ),
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(theme.faint)
                                .child(format!("Seed: {seed}")),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(widgets::ghost_button("world-folder", "Mở thư mục", &theme, move |_, _, _cx| {
                                    let _ = open::that(Path::new(&dir).join("saves").join(&folder));
                                }))
                                .child(widgets::ghost_button("world-map", "Bản đồ", &theme, {
                                    let folder = folder_map.clone();
                                    move |_, _, cx| {
                                        let folder = folder.clone();
                                        let _ = view_map.update(cx, |this, cx| {
                                            this.instance_ui.world_open = Some(folder);
                                            this.instance_tab = InstanceTab::Map;
                                            cx.notify();
                                        });
                                    }
                                })),
                        ),
                );
            }
            body = body.child(grid);
        }
        InstanceTab::Map => {
            let worlds = app.instance_ui.worlds.clone();
            let view_map = view.clone();
            let mut chips = div().flex().items_center().gap_2().flex_wrap();
            for world in &worlds {
                let folder = world.get("folder").and_then(Value::as_str).unwrap_or("").to_string();
                let name = world.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                let active = app.instance_ui.world_open.as_deref() == Some(folder.as_str());
                let view = view.clone();
                let folder_click = folder.clone();
                chips = chips.child(
                    div()
                        .id(gpui::SharedString::from(format!("map-world-{folder}")))
                        .h(px(30.0))
                        .px(px(10.0))
                        .flex()
                        .items_center()
                        .gap_2()
                        .rounded(px(6.0))
                        .bg(if active { theme.accent_dim } else { theme.surface })
                        .border_1()
                        .border_color(if active { theme.accent } else { theme.border_soft })
                        .text_size(px(TEXT_SM))
                        .text_color(if active { theme.text } else { theme.muted })
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let folder = folder_click.clone();
                            let _ = view.update(cx, |this, cx| {
                                this.instance_ui.world_open = Some(folder.clone());
                                this.generate_map(folder, cx);
                            });
                        })
                        .child(widgets::icon("map-trifold", 13.0, if active { theme.accent_soft } else { theme.faint }))
                        .child(name),
                );
            }
            let selected_world = app
                .instance_ui
                .world_open
                .clone()
                .or_else(|| worlds.first().and_then(|w| w.get("folder").and_then(Value::as_str).map(str::to_string)));
            let map_image = app.instance_ui.map_image.clone();
            let map_busy = app.instance_ui.map_busy;
            let map_meta = app.instance_ui.map_meta.clone();
            let view_gen = view.clone();
            let generate_folder = selected_world.clone();
            body = body.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .gap_2()
                            .child(if worlds.is_empty() {
                                pages::empty_state(&theme, "map-trifold", "Chưa có thế giới", "Tạo thế giới trong game rồi quay lại đây.").into_any_element()
                            } else {
                                chips.into_any_element()
                            })
                            .when(selected_world.is_some(), |el| {
                                el.child(widgets::button("map-generate", "Tạo bản đồ", &theme, true, move |_, _, cx| {
                                    let folder = generate_folder.clone();
                                    let _ = view_gen.update(cx, |this, cx| {
                                        if let Some(folder) = folder {
                                            this.generate_map(folder, cx);
                                        }
                                    });
                                }))
                            }),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .items_center()
                            .justify_center()
                            .gap_3()
                            .min_h(px(420.0))
                            .w_full()
                            .rounded(px(RADIUS_LG))
                            .bg(theme.surface)
                            .border_1()
                            .border_color(theme.border_soft)
                            .p(px(10.0))
                            .when(map_busy, |el| {
                                el.child(widgets::spinner(26.0, theme.accent_soft))
                                    .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child("Đang đọc region và render bản đồ…"))
                            })
                            .when(!map_busy && map_image.is_some(), |el| {
                                el.child(
                                    gpui::img(map_image.clone().unwrap())
                                        .w_full()
                                        .h(px(520.0))
                                        .object_fit(gpui::ObjectFit::Contain)
                                        .rounded(px(8.0)),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_3()
                                        .text_size(px(TEXT_XS))
                                        .font_family(MONO)
                                        .text_color(theme.faint)
                                        .child(format!(
                                            "{}×{} · {} chunk",
                                            map_meta.get("width").and_then(Value::as_u64).unwrap_or(0),
                                            map_meta.get("height").and_then(Value::as_u64).unwrap_or(0),
                                            map_meta.get("chunks").and_then(Value::as_u64).unwrap_or(0)
                                        )),
                                )
                            })
                            .when(!map_busy && map_image.is_none(), |el| {
                                el.child(widgets::icon("map-trifold", 40.0, theme.faint))
                                    .child(div().text_size(px(TEXT_LG)).font_weight(semibold()).text_color(theme.text).child("Bản đồ thế giới"))
                                    .child(
                                        div()
                                            .text_size(px(TEXT_SM))
                                            .text_color(theme.muted)
                                            .child(if selected_world.is_some() {
                                                "Bấm Tạo bản đồ để render địa hình từ tệp region của world."
                                            } else {
                                                "Chọn thế giới để xem bản đồ."
                                            }),
                                    )
                            }),
                    ),
            );
            let _ = view_map;
        }
        InstanceTab::Settings => {
            let view_save = view.clone();
            let view_delete = view.clone();
            let view_choose = view.clone();
            let view_clear_java = view.clone();
            let boost = instance.boost;
            let view_boost = view.clone();
            let java_override = instance.java_path.clone().unwrap_or_default();
            body = body.child(
                div()
                    .flex()
                    .gap_3()
                    .items_start()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_4()
                            .flex_1()
                            .p(px(18.0))
                            .rounded(px(RADIUS_LG))
                            .bg(theme.surface)
                            .border_1()
                            .border_color(theme.border_soft)
                            .child(pages::section_title(&theme, "Cài đặt phiên bản", ""))
                            .child(
                                div()
                                    .flex()
                                    .gap_3()
                                    .child(
                                        div()
                                            .flex_1()
                                            .child(pages::field(&theme, "Tên phiên bản", app.name_input.clone(), "")),
                                    )
                                    .child(
                                        div()
                                            .w(px(160.0))
                                            .child(pages::field(&theme, "RAM (MB)", app.memory_input.clone(), "")),
                                    ),
                            )
                            .child(pages::field(&theme, "Tham số JVM", app.jvm_input.clone(), "Ví dụ: -XX:+UseG1GC -Dfoo=bar"))
                            .child(pages::field(
                                &theme,
                                "Java riêng",
                                app.file_name_input.clone(),
                                "Để trống để dùng Java tự động. Dùng nút Chọn java.exe bên dưới.",
                            ))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(widgets::ghost_button("inst-choose-java", "Chọn java.exe", &theme, move |_, _, cx| {
                                        let view = view_choose.clone();
                                        cx.spawn(async move |cx| {
                                            let picked = rfd::AsyncFileDialog::new()
                                                .add_filter("Java", &["exe"])
                                                .pick_file()
                                                .await;
                                            if let Some(file) = picked {
                                                let path = file.path().to_string_lossy().into_owned();
                                                let _ = view.update(cx, |this, cx| {
                                                    if let Some(id) = this.selected_instance.clone() {
                                                        this.backend.update_instance(&id, serde_json::json!({"javaPath": path}));
                                                        this.refresh_instances();
                                                        this.toast("ok", "Đã đặt Java riêng", "", cx);
                                                    }
                                                });
                                            }
                                        })
                                        .detach();
                                    }))
                                    .child(widgets::ghost_button("inst-clear-java", "Dùng Java tự động", &theme, move |_, _, cx| {
                                        let _ = view_clear_java.update(cx, |this, cx| {
                                            if let Some(id) = this.selected_instance.clone() {
                                                this.backend.update_instance(&id, serde_json::json!({"javaPath": serde_json::Value::Null}));
                                                this.refresh_instances();
                                                cx.notify();
                                            }
                                        });
                                    }))
                                    .child(
                                        div()
                                            .text_size(px(TEXT_XS))
                                            .text_color(theme.faint)
                                            .child(if java_override.is_empty() {
                                                "Đang dùng Java tự động".to_string()
                                            } else {
                                                java_override.clone()
                                            }),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .child(
                                                div()
                                                    .text_size(px(TEXT_BASE))
                                                    .font_weight(medium())
                                                    .text_color(theme.text)
                                                    .child("Tăng FPS (JVM flags)"),
                                            )
                                            .child(
                                                div()
                                                    .text_size(px(TEXT_XS))
                                                    .text_color(theme.faint)
                                                    .child("G1GC tối ưu cho client, ưu tiên tiến trình game."),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .id("boost-toggle")
                                            .w(px(42.0))
                                            .h(px(24.0))
                                            .rounded_full()
                                            .bg(if boost { theme.accent } else { theme.surface_active })
                                            .p(px(3.0))
                                            .flex()
                                            .items_center()
                                            .when(boost, |el| el.justify_end())
                                            .cursor_pointer()
                                            .on_click(move |_, _, cx| {
                                                let _ = view_boost.update(cx, |this, cx| {
                                                    if let Some(id) = this.selected_instance.clone() {
                                                        let next = !this
                                                            .instances
                                                            .iter()
                                                            .find(|i| i.id == id)
                                                            .map(|i| i.boost)
                                                            .unwrap_or(false);
                                                        this.backend.update_instance(&id, serde_json::json!({"boost": next}));
                                                        this.refresh_instances();
                                                        cx.notify();
                                                    }
                                                });
                                            })
                                            .child(div().size(px(18.0)).rounded_full().bg(gpui::white())),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .justify_end()
                                    .child(widgets::button("inst-save", "Lưu cài đặt", &theme, true, move |_, _, cx| {
                                        let _ = view_save.update(cx, |this, cx| {
                                            let Some(id) = this.selected_instance.clone() else {
                                                return;
                                            };
                                            let name = this.name_input.read(cx).text().trim().to_string();
                                            let memory = this
                                                .memory_input
                                                .read(cx)
                                                .text()
                                                .trim()
                                                .parse::<u32>()
                                                .unwrap_or(4096)
                                                .clamp(512, 32768);
                                            let jvm = this.jvm_input.read(cx).text().trim().to_string();
                                            let patch = serde_json::json!({
                                                "name": if name.is_empty() { None } else { Some(name) },
                                                "memoryMb": memory,
                                                "jvmArgs": if jvm.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(jvm) },
                                            });
                                            let patch = if patch.get("name") == Some(&serde_json::Value::Null) {
                                                let mut map = patch.as_object().cloned().unwrap_or_default();
                                                map.remove("name");
                                                serde_json::Value::Object(map)
                                            } else {
                                                patch
                                            };
                                            this.backend.update_instance(&id, patch);
                                            this.refresh_instances();
                                            this.toast("ok", "Đã lưu cài đặt", "", cx);
                                        });
                                    })),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_3()
                            .w(px(300.0))
                            .p(px(18.0))
                            .rounded(px(RADIUS_LG))
                            .bg(theme.surface)
                            .border_1()
                            .border_color(theme.border_soft)
                            .child(pages::section_title(&theme, "Thao tác khác", ""))
                            .child(widgets::ghost_button("inst-change-icon", "Đổi icon", &theme, {
                                let view = view.clone();
                                let id = instance.id.clone();
                                move |_, _, cx| {
                                    let view = view.clone();
                                    let id = id.clone();
                                    cx.spawn(async move |cx| {
                                        let picked = rfd::AsyncFileDialog::new()
                                            .add_filter("Ảnh", &["png", "jpg", "jpeg", "webp"])
                                            .pick_file()
                                            .await;
                                        if let Some(file) = picked {
                                            let path = file.path().to_string_lossy().into_owned();
                                            let _ = view.update(cx, |this, cx| {
                                                let value = this.backend.set_instance_icon(&id, &path);
                                                if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                    this.refresh_instances();
                                                    this.toast("ok", "Đã đổi icon", "", cx);
                                                } else {
                                                    this.toast("bad", "Ảnh không hợp lệ", "", cx);
                                                }
                                            });
                                        }
                                    })
                                    .detach();
                                }
                            }))
                            .child(widgets::ghost_button("inst-open-folder", "Mở thư mục instance", &theme, {
                                let dir = instance.dir.clone();
                                move |_, _, _cx| {
                                    let _ = open::that(&dir);
                                }
                            }))
                            .child(widgets::ghost_button("inst-open-logs", "Mở thư mục logs", &theme, {
                                let dir = Path::new(&instance.dir).join("logs").to_string_lossy().into_owned();
                                move |_, _, _cx| {
                                    let _ = open::that(&dir);
                                }
                            }))
                            .child(widgets::ghost_button("inst-open-profile", "Mở launcher_profiles.json", &theme, {
                                let dir = instance.dir.clone();
                                move |_, _, _cx| {
                                    let _ = open::that(Path::new(&dir).join("launcher_profiles.json"));
                                }
                            }))
                            .child(
                                div()
                                    .text_size(px(TEXT_XS))
                                    .text_color(theme.bad)
                                    .child("Vùng nguy hiểm"),
                            )
                            .child(widgets::button("inst-delete", "Xoá phiên bản", &theme, false, move |_, _, cx| {
                                let id = instance.id.clone();
                                let name = instance.name.clone();
                                let _ = view_delete.update(cx, |this, cx| {
                                    this.modal = Modal::Confirm {
                                        title: "Xoá phiên bản?".into(),
                                        message: format!(
                                            "\"{name}\" sẽ bị xoá khỏi launcher. Tệp game trong thư mục vẫn được giữ lại."
                                        ),
                                        action: ConfirmAction::DeleteInstance(id.clone()),
                                    };
                                    cx.notify();
                                });
                            })),
                    ),
            );
        }
    }

    body.into_any_element()
}

fn render_editor(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let title = app.instance_ui.editor_rel.clone();
    let content = div()
        .flex()
        .flex_col()
        .gap_3()
        .h_full()
        .p(px(18.0))
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(widgets::icon("code", 18.0, theme.accent_soft))
                        .child(
                            div()
                                .text_size(px(TEXT_MD))
                                .font_weight(semibold())
                                .text_color(theme.text)
                                .child(title.clone()),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(widgets::ghost_button("editor-close", "Đóng", &theme, {
                            let view = view.clone();
                            move |_, _, cx| {
                                let _ = view.update(cx, |this, cx| {
                                    this.instance_ui.editor_open = false;
                                    cx.notify();
                                });
                            }
                        }))
                        .child(widgets::button("editor-save", "Lưu", &theme, true, {
                            let view = view.clone();
                            move |_, _, cx| {
                                let _ = view.update(cx, |this, cx| {
                                    let Some(id) = this.selected_instance.clone() else {
                                        return;
                                    };
                                    let text = this.editor_input.read(cx).text().to_string();
                                    let rel = this.instance_ui.editor_rel.clone();
                                    let rx = this.backend.write_text_req(id, rel, text);
                                    this.on_result(cx, rx, |this, value, cx| {
                                        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                            this.instance_ui.editor_dirty = false;
                                            this.toast("ok", "Đã lưu tệp", "", cx);
                                        } else {
                                            this.toast("bad", "Lưu tệp thất bại", "", cx);
                                        }
                                    });
                                });
                            }
                        })),
                ),
        )
        .child(
            div()
                .flex_1()
                .min_h(px(500.0))
                .p(px(12.0))
                .rounded(px(RADIUS))
                .bg(if theme.dark {
                    gpui::rgb(0x07090c)
                } else {
                    gpui::rgb(0xf7f8fa)
                })
                .border_1()
                .border_color(theme.border_soft)
                .text_size(px(12.0))
                .font_family(MONO)
                .text_color(theme.text)
                .child(app.editor_input.clone()),
        )
        .child(
            div()
                .text_size(px(TEXT_XS))
                .text_color(theme.faint)
                .child("Lưu tệp sẽ tạo bản .bak bên cạnh tệp gốc."),
        );
    page_body().child(content).into_any_element()
}



struct ConsolePiece {
    text: String,
    color: gpui::Rgba,
    bold: bool,
}

fn console_logger_color(theme: &Theme) -> gpui::Rgba {
    if theme.dark { gpui::rgb(0x7d8796) } else { gpui::rgb(0x55606f) }
}

fn console_parse(clean: &str) -> Option<(String, String, String, String, String)> {
    static RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
        regex::Regex::new(r"^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]:?\s?(.*)$").unwrap()
    });
    let caps = RE.captures(clean)?;
    let stamp = caps.get(1)?.as_str().to_string();
    let thread_level = caps.get(2)?.as_str();
    let logger = caps.get(3)?.as_str().to_string();
    let message = caps.get(4).map(|m| m.as_str()).unwrap_or("").to_string();
    let (thread, level) = thread_level.rsplit_once('/').unwrap_or(("", thread_level));
    Some((stamp, thread.to_string(), level.to_string(), logger, message))
}

fn console_level_of(clean: &str) -> &'static str {
    if let Some((_, _, level, _, _)) = console_parse(clean) {
        let level = level.to_uppercase();
        if level.starts_with("ERROR") || level == "FATAL" {
            "ERROR"
        } else if level.starts_with("WARN") {
            "WARN"
        } else if level == "DEBUG" || level == "TRACE" {
            "DEBUG"
        } else {
            "INFO"
        }
    } else {
        let lower = clean.to_lowercase();
        if lower.contains("error") || lower.contains("exception") || lower.contains("fatal") {
            "ERROR"
        } else if lower.contains("warn") {
            "WARN"
        } else {
            "INFO"
        }
    }
}

fn console_pieces(clean: &str, theme: &Theme) -> Vec<ConsolePiece> {
    if let Some((stamp, thread, level, logger, message)) = console_parse(clean) {
        let upper = level.to_uppercase();
        let (color, bold) = match upper.as_str() {
            "ERROR" | "FATAL" => (theme.bad, true),
            "WARN" | "WARNING" => (theme.warn, true),
            "DEBUG" | "TRACE" => (theme.faint, false),
            _ => (theme.ok, false),
        };
        let message_color = if bold { color } else { theme.text };
        vec![
            ConsolePiece { text: format!("[{stamp}] "), color: theme.faint, bold: false },
            ConsolePiece { text: format!("{thread}/"), color: theme.faint, bold: false },
            ConsolePiece { text: level, color, bold },
            ConsolePiece { text: "] ".into(), color: theme.faint, bold: false },
            ConsolePiece { text: format!("{logger} "), color: console_logger_color(theme), bold: false },
            ConsolePiece { text: message, color: message_color, bold: false },
        ]
    } else {
        vec![ConsolePiece { text: clean.to_string(), color: console_color(clean, theme), bold: false }]
    }
}

fn console_color(line: &str, theme: &Theme) -> gpui::Rgba {
    let text = line.to_lowercase();
    if text.contains("error") || text.contains("exception") || text.contains("fatal") {
        theme.bad
    } else if text.contains("warn") {
        theme.warn
    } else if text.contains("[xyolauncher]") {
        theme.accent_soft
    } else if text.contains("done (") || text.contains("server started") {
        theme.ok
    } else if text.contains("starting") || text.contains("loading") || text.contains("connecting") {
        theme.info
    } else if text.contains("<") && text.contains(">") && text.contains("chat") {
        theme.ok
    } else {
        theme.muted
    }
}


impl LauncherApp {
    pub fn generate_map(&mut self, world: String, cx: &mut Context<Self>) {
        let Some(id) = self.selected_instance.clone() else {
            return;
        };
        if self.instance_ui.map_busy {
            return;
        }
        self.instance_ui.map_busy = true;
        self.instance_ui.map_image = None;
        self.instance_ui.world_open = Some(world.clone());
        let rx = self.backend.world_map(id, world);
        self.on_result(cx, rx, |this, value, cx| {
            this.instance_ui.map_busy = false;
            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                this.instance_ui.map_image = value
                    .get("path")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                this.instance_ui.map_meta = value;
            } else {
                this.toast(
                    "bad",
                    "Không render được bản đồ",
                    value.get("error").and_then(Value::as_str).unwrap_or(""),
                    cx,
                );
            }
        });
    }
}
