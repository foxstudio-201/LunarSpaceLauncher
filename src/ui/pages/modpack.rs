use crate::ui::app::{ContentState, LauncherApp, Modal};
use crate::ui::pages::{self, page_body, page_header};
use crate::ui::theme::*;
use crate::ui::widgets;
use gpui::{AnyElement, Context, IntoElement, Window, div, prelude::*, px};
use serde_json::{Value, json};

fn kind_for_page(page: crate::ui::app::Page) -> &'static str {
    match page {
        crate::ui::app::Page::Modpacks => "modpacks",
        _ => "modpacks",
    }
}

impl LauncherApp {
    pub fn search_content(&mut self, query: String, cx: &mut Context<Self>) {
        search_content(self, query, cx);
    }
}

pub fn search_content(app: &mut LauncherApp, query: String, cx: &mut Context<LauncherApp>) {
    app.content.loading = true;
    app.content.error.clear();
    app.content.offset = 0;
    let kind = app.content.kind.clone();
    let source = app.content.source.clone();
    let sort = app.content.sort.clone();
    let game = app.content.game.clone();
    let loader = app.content.loader.clone();
    let category = app.content.category.clone();
    let environment = app.content.environment.clone();
    let rx = app.backend.content_search(json!({
        "kind": kind,
        "source": source,
        "query": query,
        "sort": sort,
        "offset": 0,
        "limit": 24,
        "game": if game.is_empty() { Value::Null } else { Value::String(game) },
        "loader": if loader.is_empty() { Value::Null } else { Value::String(loader) },
        "category": if category.is_empty() { Value::Null } else { Value::String(category) },
        "environment": if environment.is_empty() { Value::Null } else { Value::String(environment) },
    }));
    app.on_result(cx, rx, |this, value, cx| {
        this.content.loading = false;
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            this.content.hits = value
                .get("hits")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            this.content.total = value.get("total").and_then(Value::as_u64).unwrap_or(0);
            let urls: Vec<String> = this
                .content
                .hits
                .iter()
                .filter_map(|hit| hit.get("icon").and_then(Value::as_str).map(str::to_string))
                .filter(|url| !url.is_empty())
                .collect();
            this.cache_icons(urls, cx);
        } else {
            this.content.error = value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Không tải được danh sách")
                .to_string();
        }
    });
}

pub fn load_more_content(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    if app.content.loading {
        return;
    }
    let offset = app.content.hits.len() as u32;
    app.content.loading = true;
    let kind = app.content.kind.clone();
    let source = app.content.source.clone();
    let sort = app.content.sort.clone();
    let game = app.content.game.clone();
    let loader = app.content.loader.clone();
    let category = app.content.category.clone();
    let environment = app.content.environment.clone();
    let query = app.content_search.read(cx).text().to_string();
    let rx = app.backend.content_search(json!({
        "kind": kind,
        "source": source,
        "query": query,
        "sort": sort,
        "offset": offset,
        "limit": 24,
        "game": if game.is_empty() { Value::Null } else { Value::String(game) },
        "loader": if loader.is_empty() { Value::Null } else { Value::String(loader) },
        "category": if category.is_empty() { Value::Null } else { Value::String(category) },
        "environment": if environment.is_empty() { Value::Null } else { Value::String(environment) },
    }));
    app.on_result(cx, rx, |this, value, cx| {
        this.content.loading = false;
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            let rows = value.get("hits").and_then(Value::as_array).cloned().unwrap_or_default();
            let existing: std::collections::HashSet<String> = this
                .content
                .hits
                .iter()
                .filter_map(|row| row.get("id").and_then(Value::as_str).map(str::to_string))
                .collect();
            let mut added = 0;
            for row in &rows {
                let id = row.get("id").and_then(Value::as_str).unwrap_or("");
                if !id.is_empty() && !existing.contains(id) {
                    this.content.hits.push(row.clone());
                    added += 1;
                }
            }
            if added == 0 {
                this.content.total = this.content.hits.len() as u64;
            }
            this.content.total = this.content.total.max(this.content.hits.len() as u64);
            let urls: Vec<String> = rows
                .iter()
                .filter_map(|hit| hit.get("icon").and_then(Value::as_str).map(str::to_string))
                .filter(|url| !url.is_empty())
                .collect();
            if !urls.is_empty() {
                this.cache_icons(urls, cx);
            }
        } else {
            this.toast("bad", "Tải thêm thất bại", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
        }
    });
}

pub fn open_detail(app: &mut LauncherApp, hit: Value, cx: &mut Context<LauncherApp>) {
    app.content.selected = Some(hit.clone());
    app.content.selected_versions.clear();
    app.content.selected_version = None;
    app.content.detail = None;
    app.content.detail_loading = true;
    app.content.detail_tab = "about".into();
    app.content.error.clear();
    app.modal = Modal::ContentDetail;
    let kind = app.content.kind.clone();
    let source = app.content.source.clone();
    let id = hit
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let rx = app.backend.content_versions(kind.clone(), source.clone(), id.clone());
    app.on_result(cx, rx, |this, value, _cx| {
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            this.content.selected_versions = value
                .get("versions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if let Some(first) = this.content.selected_versions.first() {
                this.content.selected_version = first
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
        }
    });
    let rx = app.backend.content_project(kind, source, id);
    app.on_result(cx, rx, |this, value, cx| {
        this.content.detail_loading = false;
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            let urls: Vec<String> = value
                .get("gallery")
                .and_then(Value::as_array)
                .map(|rows| {
                    rows.iter()
                        .filter_map(|row| {
                            row.get("url")
                                .or_else(|| row.get("raw_url"))
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        })
                        .collect()
                })
                .unwrap_or_default();
            if !urls.is_empty() {
                this.cache_icons(urls, cx);
            }
            this.content.detail = Some(value);
        }
    });
}

fn install_pack(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    let Some(hit) = app.content.selected.clone() else {
        return;
    };
    let Some(version) = app.content.selected_version.clone() else {
        app.toast("warn", "Chọn phiên bản modpack", "", cx);
        return;
    };
    let source = app.content.source.clone();
    let pack_id = hit
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let name = hit
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Modpack")
        .to_string();
    let slug = hit
        .get("slug")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let token = format!(
        "pack-{}",
        chrono::Utc::now().timestamp_millis()
    );
    app.modal = Modal::None;
    app.toast("info", "Đang cài modpack", format!("{name} · đang tải manifest…"), cx);
    let memory = app
        .memory_input
        .read(cx)
        .text()
        .parse::<u32>()
        .unwrap_or(4096)
        .clamp(1024, 32768);
    let rx = app.backend.modpack_install(json!({
        "source": source,
        "packId": pack_id,
        "fileId": version,
        "name": name,
        "slug": slug,
        "memoryMb": memory,
        "token": token,
    }));
    app.on_result(cx, rx, |this, value, cx| {
        if !value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            this.toast(
                "bad",
                "Cài modpack thất bại",
                value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Không rõ lỗi"),
                cx,
            );
        }
    });
}

fn import_pack(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    let view = cx.entity().downgrade();
    cx.spawn(async move |this, cx| {
        let picked = rfd::AsyncFileDialog::new()
            .add_filter("Modpack", &["mrpack", "zip"])
            .set_title("Chọn tệp modpack")
            .pick_file()
            .await;
        if let Some(file) = picked {
            let path = file.path().to_string_lossy().into_owned();
            let _ = this.update(cx, |this, cx| {
                let name = std::path::Path::new(&path)
                    .file_stem()
                    .map(|v| v.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "Modpack".into());
                let token = format!("import-{}", chrono::Utc::now().timestamp_millis());
                this.toast("info", "Đang nhập modpack", name.clone(), cx);
                let rx = this
                    .backend
                    .modpack_import_file(path, name, 4096, token);
                this.on_result(cx, rx, |this, value, cx| {
                    if !value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                        this.toast(
                            "bad",
                            "Nhập modpack thất bại",
                            value
                                .get("error")
                                .and_then(Value::as_str)
                                .unwrap_or("Không rõ lỗi"),
                            cx,
                        );
                    } else {
                        this.refresh_instances();
                        this.toast("ok", "Đã nhập modpack", "Đang cài tệp game ở nền…", cx);
                    }
                });
            });
        }
        let _ = view;
    })
    .detach();
}

pub fn render(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let view_source = view.clone();
    let view_sort = view.clone();
    let view_loader = view.clone();
    let view_import = view.clone();
    let view_search_btn = view.clone();

    let active_source = app.content.source.clone();
    let source_toggle = div()
        .flex()
        .items_center()
        .gap(px(2.0))
        .p(px(3.0))
        .rounded(px(RADIUS_SM))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft)
        .child(source_button(&theme, "modrinth", "Modrinth", &active_source, view_source.clone()))
        .child(source_button(&theme, "curseforge", "CurseForge", &active_source, view_source.clone()))
        .child(source_button(&theme, "lunar", "LunarModpack", &active_source, view_source.clone()));

    let sorts: Vec<(&str, &str)> = if active_source == "lunar" {
        vec![
            ("downloads", "Tải nhiều"),
            ("newest", "Mới nhất"),
            ("name", "Tên A-Z"),
        ]
    } else {
        vec![
            ("relevance", "Liên quan"),
            ("downloads", "Tải nhiều"),
            ("newest", "Mới nhất"),
            ("updated", "Cập nhật"),
        ]
    };
    let mut sort_row = div().flex().items_center().gap(px(4.0));
    for (key, label) in sorts {
        let active = app.content.sort == key;
        let view = view_sort.clone();
        let key = key.to_string();
        sort_row = sort_row.child(
            div()
                .id(gpui::SharedString::from(format!("sort-{key}")))
                .h(px(28.0))
                .px(px(10.0))
                .flex()
                .items_center()
                .rounded(px(6.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .text_size(px(TEXT_XS))
                .font_weight(if active { semibold() } else { medium() })
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .cursor_pointer()
                .hover(|s| s.bg(theme.surface_hover))
                .on_click(move |_, _, cx| {
                    let key = key.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.content.sort = key;
                        let query = this.content_search.read(cx).text().to_string();
                        search_content(this, query, cx);
                    });
                })
                .child(label),
        );
    }

    let loaders = ["", "fabric", "forge", "neoforge", "quilt"];
    let mut loader_row = div().flex().items_center().gap(px(4.0)).flex_wrap();
    for key in loaders {
        let active = app.content.loader == key;
        let view = view_loader.clone();
        let key = key.to_string();
        let label = if key.is_empty() {
            "Mọi loader".to_string()
        } else {
            match key.as_str() {
                "neoforge" => "NeoForge".into(),
                "fabric" => "Fabric".into(),
                "forge" => "Forge".into(),
                "quilt" => "Quilt".into(),
                other => other.to_string(),
            }
        };
        loader_row = loader_row.child(
            div()
                .id(gpui::SharedString::from(format!("loader-filter-{key}")))
                .h(px(28.0))
                .px(px(10.0))
                .flex()
                .items_center()
                .rounded(px(6.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .text_size(px(TEXT_XS))
                .font_weight(if active { semibold() } else { medium() })
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .cursor_pointer()
                .hover(|s| s.border_color(theme.border))
                .on_click(move |_, _, cx| {
                    let key = key.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.content.loader = key;
                        let query = this.content_search.read(cx).text().to_string();
                        search_content(this, query, cx);
                    });
                })
                .child(label),
        );
    }

    let mut grid = div().flex().gap_3().flex_wrap();
    if app.content.loading {
        grid = grid.child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .p(px(20.0))
                .text_size(px(TEXT_SM))
                .text_color(theme.muted)
                .child(widgets::spinner(16.0, theme.accent_soft))
                .child("Đang tải modpack…"),
        );
    } else if app.content.hits.is_empty() {
        grid = grid.child(
            div()
                .w_full()
                .child(pages::empty_state(
                    &theme,
                    "stack",
                    "Không tìm thấy modpack",
                    if app.content.error.is_empty() {
                        "Thử đổi từ khoá, loader hoặc nguồn tìm kiếm."
                    } else {
                        &app.content.error
                    },
                )),
        );
    }
    for hit in app.content.hits.iter().take(48).cloned().collect::<Vec<_>>() {
        let view = view.clone();
        let id = hit
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let name = hit
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let summary = hit
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let author = hit
            .get("author")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let downloads = hit.get("downloads").and_then(Value::as_u64).unwrap_or(0);
        let icon_url = hit
            .get("icon")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let icon = app.icon_cache.get(&icon_url).cloned();
        let hit_for_click = hit.clone();
        grid = grid.child(
            div()
                .id(gpui::SharedString::from(format!("pack-{id}")))
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
                .cursor_pointer()
                .hover(|s| s.bg(theme.surface_hover).border_color(theme.border))
                .on_click(move |_, _, cx| {
                    let hit = hit_for_click.clone();
                    let _ = view.update(cx, |this, cx| open_detail(this, hit, cx));
                })
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .child(
                            div()
                                .size(px(48.0))
                                .rounded(px(11.0))
                                .bg(theme.surface_active)
                                .truncate()
                                .flex()
                                .items_center()
                                .justify_center()
                                .when_some(icon, |el, path| {
                                    el.child(
                                        gpui::img(path)
                                            .size(px(48.0))
                                            .object_fit(gpui::ObjectFit::Cover),
                                    )
                                })
                                .when(icon_url.is_empty() || !app.icon_cache.contains_key(&icon_url), |el| {
                                    el.child(widgets::icon("stack", 22.0, theme.accent_soft))
                                }),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(2.0))
                                .min_w(px(0.0))
                                .flex_1()
                                .child(
                                    div()
                                        .text_size(px(TEXT_MD))
                                        .font_weight(semibold())
                                        .text_color(theme.text)
                                        .truncate()
                                        .child(clip_text(&name, 24)),
                                )
                                .child(
                                    div()
                                        .text_size(px(TEXT_XS))
                                        .text_color(theme.faint)
                                        .truncate()
                                        .child(format!("{author} · {} lượt tải", compact_number(downloads))),
                                ),
                        ),
                )
                .child(
                    div()
                        .h(px(34.0))
                        .line_clamp(2)
                        .text_size(px(TEXT_SM))
                        .text_color(theme.muted)
                        .child(clip_text(&summary, 82)),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.0))
                                .children(
                                    hit.get("loaders")
                                        .and_then(Value::as_array)
                                        .map(|rows| {
                                            rows.iter()
                                                .filter_map(|v| v.as_str())
                                                .take(3)
                                                .map(|loader| {
                                                    widgets::tag(
                                                        loader.to_string(),
                                                        theme.accent_soft,
                                                        &theme,
                                                    )
                                                    .into_any_element()
                                                })
                                                .collect::<Vec<_>>()
                                        })
                                        .unwrap_or_default(),
                                ),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.0))
                                .text_size(px(TEXT_XS))
                                .text_color(theme.accent_soft)
                                .child("Cài đặt")
                                .child(widgets::icon("arrow-right", 12.0, theme.accent_soft)),
                        ),
                ),
        );
    }

    // modpack progress banner
    let pack_progress = app
        .progress
        .values()
        .find(|row| row.get("type").and_then(Value::as_str) == Some("modpack"))
        .cloned();
    let progress_banner = pack_progress.map(|row| {
        let phase = row.get("phase").and_then(Value::as_str).unwrap_or("");
        if !matches!(phase, "download" | "install") {
            return div().into_any_element();
        }
        let total = row.get("totalBytes").and_then(Value::as_f64).unwrap_or(0.0);
        let bytes = row.get("bytesDone").and_then(Value::as_f64).unwrap_or(0.0);
        let count = row.get("total").and_then(Value::as_f64).unwrap_or(0.0);
        let done = row.get("done").and_then(Value::as_f64).unwrap_or(0.0);
        let percent = if total > 0.0 {
            (bytes / total * 100.0) as f32
        } else if count > 0.0 {
            (done / count * 100.0) as f32
        } else {
            0.0
        };
        let name = row
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Modpack");
        div()
            .flex()
            .flex_col()
            .gap_2()
            .p(px(14.0))
            .rounded(px(RADIUS))
            .bg(theme.surface)
            .border_1()
            .border_color(theme.border)
            .child(
                div()
                    .flex()
                    .justify_between()
                    .text_size(px(TEXT_SM))
                    .text_color(theme.text)
                    .child(format!("Đang cài {name}"))
                    .child(if total > 0.0 {
                        format!("{:.0}%", percent)
                    } else {
                        "Đang chuẩn bị…".into()
                    }),
            )
            .child(widgets::progress_bar(percent, &theme, total <= 0.0 && count <= 0.0))
            .into_any_element()
    });

    page_body()
        .child(page_header(
            &theme,
            "Modpack",
            "Cài modpack từ Modrinth, CurseForge hoặc LunarModpack chỉ với một cú nhấp",
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(widgets::ghost_button("pack-import", "Nhập tệp", &theme, move |_, _, cx| {
                    let _ = view_import.update(cx, |this, cx| import_pack(this, cx));
                })),
        ))
        .when_some(progress_banner, |el, banner| el.child(banner))
        .child(
            div()
                .flex()
                .flex_col()
                .gap_3()
                .p(px(14.0))
                .rounded(px(RADIUS_LG))
                .bg(theme.surface)
                .border_1()
                .border_color(theme.border_soft)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(div().flex_1().child(widgets::text_input_box(&theme).child(app.content_search.clone())))
                        .child(
                            div()
                                .id("pack-search")
                                .flex()
                                .items_center()
                                .justify_center()
                                .size(px(38.0))
                                .rounded(px(RADIUS_SM))
                                .bg(theme.accent)
                                .text_color(theme.on_accent)
                                .cursor_pointer()
                                .hover(|s| s.bg(theme.accent_hover))
                                .on_click(move |_, _, cx| {
                                    let _ = view_search_btn.update(cx, |this, cx| {
                                        let query = this.content_search.read(cx).text().to_string();
                                        search_content(this, query, cx);
                                    });
                                })
                                .child(widgets::icon("magnifying-glass", 16.0, theme.on_accent)),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap_3()
                        .child(source_toggle)
                        .child(
                            div()
                                .text_size(px(TEXT_XS))
                                .text_color(theme.faint)
                                .child(match active_source.as_str() {
                                    "lunar" => "Cộng đồng LunarSpace",
                                    "curseforge" => "CurseForge",
                                    _ => "Modrinth",
                                }),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap_3()
                        .child(loader_row)
                        .child(sort_row),
                ),
        )
        .child(grid)
        .when(app.content.loading, |el| {
            el.child(div().w_full().flex().justify_center().py(px(10.0)).child(widgets::spinner(18.0, theme.accent_soft)))
        })
        .when(
            !app.content.loading && (app.content.total as usize) > app.content.hits.len(),
            |el| {
                let view = cx.entity().downgrade();
                el.child(
                    div().w_full().flex().justify_center().py(px(6.0)).child(widgets::ghost_button(
                        "pack-more",
                        format!("Tải thêm ({} / {})", app.content.hits.len(), app.content.total),
                        &theme,
                        move |_, _, cx| {
                            let _ = view.update(cx, |this, cx| load_more_content(this, cx));
                        },
                    )),
                )
            },
        )
        .into_any_element()
}

fn source_button(
    theme: &Theme,
    source: &str,
    label: &str,
    active_source: &str,
    view: gpui::WeakEntity<LauncherApp>,
) -> impl IntoElement {
    let active = active_source == source;
    let source = source.to_string();
    div()
        .id(gpui::SharedString::from(format!("source-{source}")))
        .h(px(28.0))
        .px(px(12.0))
        .flex()
        .items_center()
        .rounded(px(6.0))
        .bg(if active { theme.accent_dim } else { theme.surface })
        .text_size(px(TEXT_XS))
        .font_weight(if active { semibold() } else { medium() })
        .text_color(if active { theme.accent_soft } else { theme.muted })
        .cursor_pointer()
        .on_click(move |_, _, cx| {
            let source = source.clone();
            let _ = view.update(cx, |this, cx| {
                if this.content.source != source {
                    this.content.source = source.clone();
                    if source == "lunar"
                        && !matches!(this.content.sort.as_str(), "downloads" | "newest" | "name")
                    {
                        this.content.sort = "newest".into();
                    }
                    let query = this.content_search.read(cx).text().to_string();
                    search_content(this, query, cx);
                }
            });
        })
        .child(label.to_string())
}

fn clip_text(value: &str, max: usize) -> String {
    let mut out: String = value.chars().take(max).collect();
    if value.chars().count() > max {
        out.push('…');
    }
    out
}

fn compact_number(value: u64) -> String {
    if value >= 1_000_000 {
        format!("{:.1}M", value as f64 / 1_000_000.0)
    } else if value >= 1_000 {
        format!("{:.1}K", value as f64 / 1_000.0)
    } else {
        value.to_string()
    }
}

pub fn detail_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let close_view = cx.entity().downgrade();
    let install_view = cx.entity().downgrade();
    let hit = app.content.selected.clone().unwrap_or(Value::Null);
    let name = hit
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Modpack")
        .to_string();
    let author = hit
        .get("author")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let summary = hit
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let icon_url = hit
        .get("icon")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let icon = app.icon_cache.get(&icon_url).cloned();
    let detail = app.content.detail.clone().unwrap_or(Value::Null);
    let description = crate::util::markdown_to_text(
        detail
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or(&summary),
    );

    let mut version_list = div()
        .id("pack-versions")
        .flex()
        .flex_col()
        .gap(px(2.0))
        .h(px(190.0))
        .overflow_y_scroll()
        .on_scroll_wheel(|_, _, cx| cx.stop_propagation())
        .p(px(4.0))
        .rounded(px(RADIUS_SM))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft);
    if app.content.selected_versions.is_empty() {
        version_list = version_list.child(
            div()
                .p(px(10.0))
                .text_size(px(TEXT_SM))
                .text_color(theme.faint)
                .child("Đang tải danh sách phiên bản…"),
        );
    }
    for version in app.content.selected_versions.iter().take(60).cloned().collect::<Vec<_>>() {
        let id = version
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let active = app.content.selected_version.as_deref() == Some(id.as_str());
        let label = version
            .get("name")
            .and_then(Value::as_str)
            .or_else(|| version.get("versionNumber").and_then(Value::as_str))
            .unwrap_or("")
            .to_string();
        let meta = format!(
            "{} · {}",
            version
                .get("gameVersions")
                .and_then(Value::as_array)
                .map(|rows| rows.iter().filter_map(|v| v.as_str()).take(3).collect::<Vec<_>>().join(", "))
                .unwrap_or_default(),
            version
                .get("loaders")
                .and_then(Value::as_array)
                .map(|rows| rows.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(", "))
                .unwrap_or_default()
        );
        let view = close_view.clone();
        version_list = version_list.child(
            div()
                .id(gpui::SharedString::from(format!("pack-ver-{id}")))
                .flex()
                .items_center()
                .justify_between()
                .gap_2()
                .h(px(38.0))
                .px(px(10.0))
                .rounded(px(6.0))
                .cursor_pointer()
                .when(active, |el| el.bg(theme.accent_dim))
                .when(!active, |el| el.hover(|s| s.bg(theme.surface_hover)))
                .on_click(move |_, _, cx| {
                    let id = id.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.content.selected_version = Some(id);
                        cx.notify();
                    });
                })
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .min_w(px(0.0))
                        .child(
                            div()
                                .text_size(px(TEXT_SM))
                                .font_weight(if active { semibold() } else { medium() })
                                .text_color(if active { theme.text } else { theme.muted })
                                .child(label),
                        )
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(theme.faint)
                                .child(meta),
                        ),
                )
                .child(widgets::icon(
                    if active { "check-circle" } else { "circle" },
                    14.0,
                    if active { theme.accent_soft } else { theme.faint },
                )),
        );
    }

    let mut detail_tabs = div().flex().items_center().gap(px(4.0));
    for (key, label) in [("about", "Mô tả"), ("gallery", "Ảnh"), ("changelog", "Thay đổi")] {
        let active = app.content.detail_tab == key;
        let view = close_view.clone();
        let key = key.to_string();
        detail_tabs = detail_tabs.child(
            div()
                .id(gpui::SharedString::from(format!("detail-tab-{key}")))
                .h(px(28.0))
                .px(px(10.0))
                .flex()
                .items_center()
                .rounded(px(6.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .text_size(px(TEXT_SM))
                .font_weight(if active { semibold() } else { medium() })
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let key = key.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.content.detail_tab = key;
                        cx.notify();
                    });
                })
                .child(label.to_string()),
        );
    }
    let gallery_rows: Vec<(String, Option<String>)> = detail
        .get("gallery")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let url = row
                        .get("url")
                        .or_else(|| row.get("raw_url"))
                        .and_then(Value::as_str)?
                        .to_string();
                    let cached = app.icon_cache.get(&url).cloned();
                    Some((url, cached))
                })
                .collect()
        })
        .unwrap_or_default();
    let changelog = app
        .content
        .selected_version
        .as_ref()
        .and_then(|selected| {
            app.content
                .selected_versions
                .iter()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(selected.as_str()))
        })
        .and_then(|row| row.get("changelog").and_then(Value::as_str))
        .map(crate::util::markdown_to_text)
        .unwrap_or_default();
    let detail_body = match app.content.detail_tab.as_str() {
        "gallery" => {
            if gallery_rows.is_empty() {
                div()
                    .text_size(px(TEXT_SM))
                    .text_color(theme.faint)
                    .child("Chưa có ảnh cho dự án này.")
                    .into_any_element()
            } else {
                let mut grid = div().flex().gap_2().flex_wrap();
                for (url, cached) in gallery_rows.into_iter().take(12) {
                    let view = close_view.clone();
                    let mut cell = div()
                        .id(gpui::SharedString::from(format!("gallery-{url}")))
                        .w(px(170.0))
                        .h(px(105.0))
                        .rounded(px(8.0))
                        .bg(theme.surface_active)
                        .border_1()
                        .border_color(theme.border_soft)
                        .overflow_hidden()
                        .cursor_pointer();
                    if let Some(path) = cached {
                        cell = cell.child(gpui::img(path).size_full().object_fit(gpui::ObjectFit::Cover));
                    }
                    cell = cell.on_click(move |_, _, cx| {
                        let url = url.clone();
                        let _ = view.update(cx, |_, _| {
                            let _ = open::that(&url);
                        });
                    });
                    grid = grid.child(cell);
                }
                grid.into_any_element()
            }
        }
        "changelog" => div()
            .text_size(px(TEXT_SM))
            .text_color(theme.muted)
            .child(if changelog.trim().is_empty() {
                "Phiên bản này chưa có ghi chú thay đổi.".to_string()
            } else {
                changelog
            })
            .into_any_element(),
        _ => div()
            .text_size(px(TEXT_SM))
            .text_color(theme.muted)
            .child(if description.trim().is_empty() {
                summary.clone()
            } else {
                description.clone()
            })
            .into_any_element(),
    };

    let content = div()
        .flex()
        .flex_col()
        .gap_4()
        .child(
            div()
                .flex()
                .items_start()
                .gap_3()
                .child(
                    div()
                        .size(px(72.0))
                        .rounded(px(15.0))
                        .bg(theme.surface_active)
                        .truncate()
                        .flex()
                        .items_center()
                        .justify_center()
                        .when_some(icon, |el, path| {
                            el.child(gpui::img(path).size(px(72.0)).object_fit(gpui::ObjectFit::Cover))
                        })
                        .when(icon_url.is_empty(), |el| el.child(widgets::icon("stack", 28.0, theme.accent_soft))),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(4.0))
                        .flex_1()
                        .min_w(px(0.0))
                        .child(
                            div()
                                .text_size(px(TEXT_2XL))
                                .font_weight(bold())
                                .text_color(theme.text)
                                .child(name),
                        )
                        .child(
                            div()
                                .text_size(px(TEXT_SM))
                                .text_color(theme.muted)
                                .child(if author.is_empty() {
                                    summary.clone()
                                } else {
                                    format!("Bởi {author}")
                                }),
                        ),
                )
                .child(widgets::icon_button("pack-close", "x", &theme, move |_, _, cx| {
                    let _ = close_view.update(cx, |this, cx| {
                        this.modal = Modal::None;
                        cx.notify();
                    });
                })),
        )
        .child(detail_tabs)
        .child(
            div()
                .id("pack-desc")
                .max_h(px(170.0))
                .overflow_y_scroll()
        .on_scroll_wheel(|_, _, cx| cx.stop_propagation())
                .child(detail_body),
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
                        .child(
                            div()
                                .text_size(px(TEXT_SM))
                                .font_weight(medium())
                                .text_color(theme.muted)
                                .child("Phiên bản modpack"),
                        )
                        .child(version_list),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .w(px(200.0))
                        .child(
                            div()
                                .text_size(px(TEXT_SM))
                                .font_weight(medium())
                                .text_color(theme.muted)
                                .child("RAM"),
                        )
                        .child(widgets::text_input_box(&theme).child(app.memory_input.clone()))
                        .child(
                            div()
                                .text_size(px(TEXT_XS))
                                .text_color(theme.faint)
                                .child("Nên đặt 4096 MB hoặc hơn cho modpack lớn."),
                        ),
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
                        .items_center()
                        .gap_2()
                        .text_size(px(TEXT_XS))
                        .text_color(theme.faint)
                        .child(widgets::icon("info", 13.0, theme.faint))
                        .child("Launcher sẽ tạo phiên bản và tải toàn bộ mod, config, overrides."),
                )
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .child(widgets::ghost_button("pack-cancel", "Đóng", &theme, {
                            let view = cx.entity().downgrade();
                            move |_, _, cx| {
                                let _ = view.update(cx, |this, cx| {
                                    this.modal = Modal::None;
                                    cx.notify();
                                });
                            }
                        }))
                        .child(widgets::button("pack-install", "Cài modpack", &theme, true, move |_, _, cx| {
                            let _ = install_view.update(cx, |this, cx| install_pack(this, cx));
                        })),
                ),
        );

    let backdrop_view = cx.entity().downgrade();
    pages::modal_overlay(theme.clone(), 780.0, content, move |_, _, cx| {
        let _ = backdrop_view.update(cx, |this, cx| {
            this.modal = Modal::None;
            cx.notify();
        });
    })
    .into_any_element()
}

pub fn open_browser(app: &mut LauncherApp, kind: &str, instance_id: String, cx: &mut Context<LauncherApp>) {
    app.content.kind = kind.to_string();
    app.content.source = "modrinth".into();
    app.content.instance_id = Some(instance_id.clone());
    app.content.hits.clear();
    app.content.error.clear();
    if let Some(instance) = app.instances.iter().find(|entry| entry.id == instance_id).cloned() {
        app.content.game = instance.version.clone();
        app.content.loader = if instance.loader == "quilt" {
            "quilt".into()
        } else {
            instance.loader.clone()
        };
    }
    let input = app.content_search.clone();
    input.update(cx, |input, cx| input.clear(cx));
    search_content(app, String::new(), cx);
    app.modal = Modal::ContentBrowser;
    cx.notify();
}

fn browser_kind_label(kind: &str) -> &'static str {
    match kind {
        "resourcepacks" => "gói tài nguyên",
        "shaderpacks" => "shader",
        _ => "mod",
    }
}

fn install_browser_hit(app: &mut LauncherApp, hit: Value, cx: &mut Context<LauncherApp>) {
    let Some(instance_id) = app.content.instance_id.clone() else {
        app.toast("bad", "Chưa chọn phiên bản", "", cx);
        return;
    };
    let Some(instance) = app
        .instances
        .iter()
        .find(|entry| entry.id == instance_id)
        .cloned()
    else {
        app.toast("bad", "Không tìm thấy phiên bản", "", cx);
        return;
    };
    let kind = app.content.kind.clone();
    let source = app.content.source.clone();
    let id = hit.get("id").and_then(Value::as_str).unwrap_or("").to_string();
    let name = hit
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Nội dung")
        .to_string();
    if id.is_empty() {
        return;
    }
    let rx = app.backend.content_versions(kind.clone(), source.clone(), id.clone());
    app.on_result(cx, rx, move |this, value, cx| {
        let versions = value
            .get("versions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let pick = versions
            .iter()
            .find(|version| {
                let game_ok = version
                    .get("gameVersions")
                    .and_then(Value::as_array)
                    .map(|rows| rows.iter().any(|v| v.as_str() == Some(instance.version.as_str())))
                    .unwrap_or(false);
                let loader_ok = kind != "mods"
                    || version
                        .get("loaders")
                        .and_then(Value::as_array)
                        .map(|rows| {
                            rows.iter().any(|v| {
                                v.as_str() == Some(instance.loader.as_str())
                                    || (instance.loader == "quilt" && v.as_str() == Some("fabric"))
                            })
                        })
                        .unwrap_or(true);
                game_ok && loader_ok
            })
            .or_else(|| versions.first());
        let Some(version) = pick else {
            this.toast(
                "bad",
                "Không có bản phù hợp",
                format!("{name} không có bản cho {} {}.", instance.version, instance.loader),
                cx,
            );
            return;
        };
        let version_id = version
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let rx = this.backend.content_install(json!({
            "kind": kind,
            "source": source,
            "id": id,
            "versionId": version_id,
            "instanceId": instance_id,
            "game": instance.version,
            "loader": instance.loader,
        }));
        this.on_result(cx, rx, |this, value, cx| {
            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                let added = value.get("added").and_then(Value::as_u64).unwrap_or(0);
                let failed = value
                    .get("failed")
                    .and_then(Value::as_array)
                    .map(|v| v.len())
                    .unwrap_or(0);
                if failed > 0 {
                    this.toast(
                        "warn",
                        "Cài chưa đủ",
                        format!("Đã thêm {added} tệp · {failed} tệp lỗi."),
                        cx,
                    );
                } else {
                    this.toast("ok", "Đã cài nội dung", format!("{added} tệp"), cx);
                }
                if this.instance_tab == crate::ui::app::InstanceTab::Mods {
                    this.load_instance_tab(cx);
                } else {
                    reload_instance_files(this, cx);
                }
            } else {
                this.toast(
                    "bad",
                    "Cài nội dung thất bại",
                    value.get("error").and_then(Value::as_str).unwrap_or(""),
                    cx,
                );
            }
        });
    });
}

fn reload_instance_files(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    let Some(id) = app.selected_instance.clone() else {
        return;
    };
    let folder = match app.instance_tab {
        crate::ui::app::InstanceTab::Resourcepacks => "resourcepacks",
        crate::ui::app::InstanceTab::Shaderpacks => "shaderpacks",
        _ => "",
    };
    let rel = if folder.is_empty() {
        app.instance_ui.rel.clone()
    } else if app.instance_ui.rel.is_empty() {
        folder.to_string()
    } else {
        app.instance_ui.rel.clone()
    };
    let value = app.backend.list_dir(&id, &rel);
    app.instance_ui.entries = value
        .get("entries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let _ = cx;
}

pub fn browser_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let close_view = cx.entity().downgrade();
    let view_search = cx.entity().downgrade();
    let view_source = cx.entity().downgrade();
    let kind = app.content.kind.clone();
    let label = browser_kind_label(&kind);
    let source = app.content.source.clone();
    let mut list = div()
        .id("browser-list")
        .flex()
        .flex_col()
        .gap(px(2.0))
        .h(px(430.0))
        .overflow_y_scroll()
        .on_scroll_wheel(|_, _, cx| cx.stop_propagation())
        .p(px(4.0))
        .rounded(px(RADIUS_SM))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft);
    if app.content.loading {
        list = list.child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .p(px(14.0))
                .child(widgets::spinner(15.0, theme.accent_soft))
                .child(div().text_size(px(TEXT_SM)).text_color(theme.muted).child("Đang tìm…")),
        );
    } else if app.content.hits.is_empty() {
        list = list.child(
            div()
                .p(px(14.0))
                .text_size(px(TEXT_SM))
                .text_color(theme.faint)
                .child("Không tìm thấy kết quả. Thử từ khoá khác."),
        );
    }
    let view_install = cx.entity().downgrade();
    for hit in app.content.hits.iter().take(40).cloned().collect::<Vec<_>>() {
        let name = hit.get("name").and_then(Value::as_str).unwrap_or("").to_string();
        let author = hit.get("author").and_then(Value::as_str).unwrap_or("").to_string();
        let summary = hit.get("summary").and_then(Value::as_str).unwrap_or("").to_string();
        let downloads = hit.get("downloads").and_then(Value::as_u64).unwrap_or(0);
        let icon_url = hit.get("icon").and_then(Value::as_str).unwrap_or("").to_string();
        let icon = app.icon_cache.get(&icon_url).cloned();
        let has_icon = icon.is_some();
        let id = hit.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        let hit_for_install = hit.clone();
        let install_view = view_install.clone();
        list = list.child(
            div()
                .id(gpui::SharedString::from(format!("browser-{id}")))
                .flex()
                .items_center()
                .gap_3()
                .p(px(8.0))
                .rounded(px(6.0))
                .hover(|s| s.bg(theme.surface_hover))
                .child(
                    div()
                        .size(px(38.0))
                        .rounded(px(9.0))
                        .bg(theme.surface_active)
                        .truncate()
                        .flex()
                        .items_center()
                        .justify_center()
                        .when_some(icon, |el, path| {
                            el.child(gpui::img(path).size(px(38.0)).object_fit(gpui::ObjectFit::Cover))
                        })
                        .when(!has_icon, |el| {
                            el.child(widgets::icon("puzzle-piece", 18.0, theme.accent_soft))
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
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(
                                    div()
                                        .text_size(px(TEXT_SM))
                                        .font_weight(semibold())
                                        .text_color(theme.text)
                                        .child(name),
                                )
                                .child(
                                    div().text_size(px(10.0)).text_color(theme.faint).child(author),
                                ),
                        )
                        .child(
                            div()
                                .text_size(px(10.5))
                                .text_color(theme.faint)
                                .truncate()
                                .child(format!(
                                    "{summary} · {} lượt tải",
                                    compact_number(downloads)
                                )),
                        ),
                )
                .child(widgets::button("browser-install", "Cài", &theme, true, move |_, _, cx| {
                    let hit = hit_for_install.clone();
                    let _ = install_view.update(cx, |this, cx| install_browser_hit(this, hit, cx));
                })),
        );
    }

    let content = div()
        .flex()
        .flex_col()
        .gap_3()
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
                                .text_size(px(TEXT_XL))
                                .font_weight(semibold())
                                .text_color(theme.text)
                                .child(format!("Thêm {label}")),
                        )
                        .child(
                            div()
                                .text_size(px(TEXT_SM))
                                .text_color(theme.muted)
                                .child("Tìm trực tiếp trong Modrinth và cài vào phiên bản đang mở."),
                        ),
                )
                .child(widgets::icon_button("browser-close", "x", &theme, move |_, _, cx| {
                    let _ = close_view.update(cx, |this, cx| {
                        this.modal = Modal::None;
                        cx.notify();
                    });
                })),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(
                    div()
                        .flex_1()
                        .child(widgets::text_input_box(&theme).child(app.content_search.clone())),
                )
                .child(widgets::button("browser-search", "Tìm", &theme, true, move |_, _, cx| {
                    let _ = view_search.update(cx, |this, cx| {
                        let query = this.content_search.read(cx).text().to_string();
                        search_content(this, query, cx);
                    });
                }))
                .child(
                    div()
                        .id("browser-source")
                        .h(px(38.0))
                        .px(px(12.0))
                        .flex()
                        .items_center()
                        .rounded(px(6.0))
                        .bg(theme.surface)
                        .border_1()
                        .border_color(theme.border_soft)
                        .text_size(px(TEXT_SM))
                        .text_color(theme.muted)
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let _ = view_source.update(cx, |this, cx| {
                                this.content.source = if this.content.source == "modrinth" {
                                    "curseforge".into()
                                } else {
                                    "modrinth".into()
                                };
                                let query = this.content_search.read(cx).text().to_string();
                                search_content(this, query, cx);
                            });
                        })
                        .child(if source == "curseforge" {
                            "CurseForge"
                        } else {
                            "Modrinth"
                        }),
                ),
        )
        .child(list)
        .when(
            !app.content.loading && (app.content.total as usize) > app.content.hits.len(),
            |el| {
                let view = cx.entity().downgrade();
                el.child(
                    div().w_full().flex().justify_center().child(widgets::ghost_button(
                        "browser-more",
                        format!("Tải thêm ({} / {})", app.content.hits.len(), app.content.total),
                        &theme,
                        move |_, _, cx| {
                            let _ = view.update(cx, |this, cx| load_more_content(this, cx));
                        },
                    )),
                )
            },
        );
    let backdrop_view = cx.entity().downgrade();
    pages::modal_overlay(theme, 840.0, content, move |_, _, cx| {
        let _ = backdrop_view.update(cx, |this, cx| {
            this.modal = Modal::None;
            cx.notify();
        });
    })
    .into_any_element()
}
