use crate::models::LoaderRow;
use crate::ui::app::{ConfirmAction, CreateState, LauncherApp, Modal, Page};
use crate::ui::pages::{self, page_body, page_header, section_title};
use crate::ui::theme::*;
use crate::ui::widgets;
use gpui::{AnyElement, Context, FontWeight, IntoElement, Window, div, prelude::*, px};
use serde_json::json;

const LOADERS: [(&str, &str, &str); 6] = [
    ("vanilla", "Vanilla", "Bản gốc Mojang, không mod"),
    ("fabric", "Fabric", "Loader nhẹ, cập nhật nhanh"),
    ("quilt", "Quilt", "Kế thừa Fabric, hiện đại hơn"),
    ("forge", "Forge", "Loader lâu đời, nhiều mod nhất"),
    ("neoforge", "NeoForge", "Bản tách từ Forge, hiện đại hơn"),
    ("lunar", "LunarLoader", "Loader riêng của LunarSpace"),
];

fn is_release_version(version: &str) -> bool {
    let lower = version.to_lowercase();
    if lower.contains("snapshot")
        || lower.contains("pre")
        || lower.contains("-rc")
        || lower.contains("-beta")
        || lower.contains("-alpha")
    {
        return false;
    }
    !version.is_empty() && version.chars().all(|c| c.is_ascii_digit() || c == '.')
}

pub fn open_versions(
    app: &mut LauncherApp,
    cx: &mut Context<LauncherApp>,
    loader: Option<String>,
    game: Option<String>,
) {
    app.set_page(Page::Versions, cx);
    let had_loader = loader.is_some();
    if let Some(loader) = loader {
        app.create.loader = loader;
        app.create.loader_version.clear();
    }
    let had_game = game.is_some();
    if let Some(game) = game {
        app.create.game = game;
    }
    app.create.step = if had_loader || had_game { 1 } else { 0 };
    if app.create.step == 1 && app.create.loader.is_empty() {
        app.create.loader = "vanilla".into();
    }
    app.create.error.clear();
    load_create_loaders(app, cx);
    cx.notify();
}

pub fn open_create(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    app.create = CreateState {
        open: true,
        loader: "vanilla".into(),
        show_snapshots: app.snapshots,
        versions: app.versions.clone(),
        ..Default::default()
    };
    if app.versions.is_empty() {
        let rx = app.backend.versions(false, false);
        app.on_result(cx, rx, |this, value, cx| {
            if let Some(rows) = value.get("versions").and_then(serde_json::Value::as_array) {
                this.create.versions = rows
                    .iter()
                    .filter_map(|row| serde_json::from_value(row.clone()).ok())
                    .collect();
                if this.create.game.is_empty() {
                    if let Some(first) = this.create.versions.first() {
                        this.create.game = first.id.clone();
                        load_create_loaders(this, cx);
                    }
                }
            }
        });
    } else if let Some(first) = app.versions.first() {
        app.create.game = first.id.clone();
    }
    app.modal = Modal::Create;
    load_create_loaders(app, cx);
    cx.notify();
}

pub fn load_create_loaders(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    let loader = app.create.loader.clone();
    if loader == "vanilla" {
        app.create.loader_versions.clear();
        app.create.loader_version.clear();
        if let Some(first) = app.versions.first() {
            if app.create.game.is_empty() {
                app.create.game = first.id.clone();
            }
        }
        update_name(app, cx);
        return;
    }
    app.create.loading_loaders = true;
    let rx = app.backend.loader_games(loader.clone());
    app.on_result(cx, rx, move |this, value, cx| {
        let games = value
            .get("games")
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default();
        this.create.loader_games = games.clone();
        let valid = games
            .iter()
            .any(|g| g.get("version").and_then(serde_json::Value::as_str) == Some(this.create.game.as_str()));
        if !valid {
            let latest = this
                .latest
                .get("release")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_string();
            let pick = games
                .iter()
                .find(|g| g.get("version").and_then(serde_json::Value::as_str) == Some(latest.as_str()))
                .or_else(|| {
                    games.iter().find(|g| {
                        let version = g
                            .get("version")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or("");
                        is_release_version(version)
                    })
                })
                .or_else(|| games.first());
            if let Some(pick) = pick.and_then(|g| g.get("version")).and_then(serde_json::Value::as_str) {
                this.create.game = pick.to_string();
            }
        }
        let loader = this.create.loader.clone();
        let game = this.create.game.clone();
        let rx = this.backend.loader_versions(loader, game);
        this.on_result(cx, rx, |this, value, cx| {
            this.create.loading_loaders = false;
            this.create.loader_versions = value
                .get("versions")
                .and_then(serde_json::Value::as_array)
                .map(|rows| {
                    rows.iter()
                        .filter_map(|row| serde_json::from_value::<LoaderRow>(row.clone()).ok())
                        .collect()
                })
                .unwrap_or_default();
            if let Some(first) = this.create.loader_versions.first() {
                this.create.loader_version = first.id.clone();
            }
            update_name(this, cx);
        });
    });
}

fn refresh_loader_versions(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    let loader = app.create.loader.clone();
    if loader == "vanilla" {
        return;
    }
    app.create.loading_loaders = true;
    let game = app.create.game.clone();
    let rx = app.backend.loader_versions(loader, game);
    app.on_result(cx, rx, |this, value, _cx| {
        this.create.loading_loaders = false;
        this.create.loader_versions = value
            .get("versions")
            .and_then(serde_json::Value::as_array)
            .map(|rows| {
                rows.iter()
                    .filter_map(|row| serde_json::from_value::<LoaderRow>(row.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        if let Some(first) = this.create.loader_versions.first() {
            this.create.loader_version = first.id.clone();
        }
    });
}

fn loader_name(id: &str) -> &'static str {
    LOADERS
        .iter()
        .find(|(key, _, _)| *key == id)
        .map(|(_, name, _)| *name)
        .unwrap_or("Vanilla")
}

fn update_name(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    let name = format!("{} {}", loader_name(&app.create.loader), app.create.game);
    let entity = app.name_input.clone();
    entity.update(cx, |input, cx| {
        input.set_text(name, cx);
    });
}

fn create_instance(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    let name = app.name_input.read(cx).text().trim().to_string();
    let memory = app
        .memory_input
        .read(cx)
        .text()
        .trim()
        .parse::<u32>()
        .unwrap_or_else(|_| {
            app.settings
                .get("defaultMemory")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(4096) as u32
        })
        .clamp(512, 32768);
    if app.create.game.is_empty() {
        app.create.error = "Chọn phiên bản Minecraft.".into();
        cx.notify();
        return;
    }
    if app.create.loader != "vanilla" && app.create.loader != "lunar" && app.create.loader_version.is_empty() {
        app.create.error = "Chọn phiên bản trình tải.".into();
        cx.notify();
        return;
    }
    let username = app
        .accounts
        .iter()
        .find(|a| Some(&a.id) == app.active_account.as_ref())
        .map(|a| a.name.clone())
        .unwrap_or_else(|| "Player".into());
    let payload = json!({
        "name": if name.is_empty() {
            format!("{} {}", loader_name(&app.create.loader), app.create.game)
        } else {
            name
        },
        "version": app.create.game,
        "loader": app.create.loader,
        "loaderVersion": app.create.loader_version,
        "memoryMb": memory,
        "username": username,
    });
    app.modal = Modal::None;
    app.create.open = false;
    let rx = app.backend.create_instance(payload);
    app.on_result(cx, rx, |this, value, cx| {
        if value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
            this.refresh_instances();
            this.toast("ok", "Đã tạo phiên bản", "Đang tải tệp game ở nền…", cx);
            if let Some(id) = value.pointer("/instance/id").and_then(serde_json::Value::as_str) {
                this.selected_instance = Some(id.to_string());
            }
        } else {
            this.toast(
                "bad",
                "Tạo phiên bản thất bại",
                value
                    .get("error")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("Không rõ lỗi"),
                cx,
            );
        }
    });
}

fn loader_image(id: &str) -> std::path::PathBuf {
    crate::ui::assets::image_path(&format!("loader-icon/{id}.png"))
}

fn loader_desc(id: &str) -> &'static str {
    LOADERS.iter().find(|(key, _, _)| *key == id).map(|(_, _, desc)| *desc).unwrap_or("")
}

fn pick_loader(app: &mut LauncherApp, kind: String, cx: &mut Context<LauncherApp>) {
    app.create.loader = kind;
    app.create.game.clear();
    app.create.loader_version.clear();
    app.create.loader_versions.clear();
    app.create.loader_games.clear();
    app.create.step = 1;
    app.create.error.clear();
    app.create.demo = false;
    let dir = app.backend.store.default_instance_dir().to_string_lossy().into_owned();
    let dir_input = app.file_name_input.clone();
    dir_input.update(cx, |input, cx| input.set_text(dir, cx));
    let memory_input = app.memory_input.clone();
    let memory = app
        .settings
        .get("defaultMemory")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(4096);
    memory_input.update(cx, |input, cx| input.set_text(memory.to_string(), cx));
    load_create_loaders(app, cx);
    cx.notify();
}

fn submit_create(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    let name = app.name_input.read(cx).text().trim().to_string();
    let dir = app.file_name_input.read(cx).text().trim().to_string();
    let memory = app
        .memory_input
        .read(cx)
        .text()
        .trim()
        .parse::<u32>()
        .unwrap_or(4096)
        .clamp(512, 32768);
    if app.create.game.is_empty() {
        app.create.error = "Chọn phiên bản Minecraft.".into();
        cx.notify();
        return;
    }
    if app.create.loader != "vanilla" && app.create.loader != "lunar" && app.create.loader_version.is_empty() {
        app.create.error = "Chọn bản build trình tải.".into();
        cx.notify();
        return;
    }
    let username = app
        .accounts
        .iter()
        .find(|a| Some(&a.id) == app.active_account.as_ref())
        .map(|a| a.name.clone())
        .unwrap_or_else(|| "Player".into());
    let payload = json!({
        "name": if name.is_empty() {
            format!("{} {}", loader_name(&app.create.loader), app.create.game)
        } else {
            name
        },
        "version": app.create.game,
        "loader": app.create.loader,
        "loaderVersion": app.create.loader_version,
        "memoryMb": memory,
        "username": username,
        "demo": app.create.demo,
        "dir": if dir.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(dir) },
    });
    let rx = app.backend.create_instance(payload);
    app.on_result(cx, rx, |this, value, cx| {
        if value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
            this.refresh_instances();
            this.toast("ok", "Đã tạo phiên bản", "Đang tải tệp game ở nền…", cx);
            this.create.step = 0;
            this.create.game.clear();
            this.create.loader_version.clear();
        } else {
            let error = value
                .get("error")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("Không rõ lỗi")
                .to_string();
            this.create.error = error.clone();
            this.toast("bad", "Tạo phiên bản thất bại", error, cx);
        }
    });
}

pub fn render(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let view_back = view.clone();
    let view_refresh = view.clone();
    let view_snapshots = view.clone();

    let header = div()
        .flex()
        .items_end()
        .justify_between()
        .w_full()
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.0))
                .child(
                    div()
                        .text_size(px(22.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.text)
                        .child("Phiên bản"),
                )
                .child(
                    div()
                        .text_size(px(11.5))
                        .text_color(theme.faint)
                        .child("Chọn loader trước, sau đó chọn phiên bản Minecraft"),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(widgets::ghost_button("ver-refresh", "Làm mới", &theme, move |_, _, cx| {
                    let _ = view_refresh.update(cx, |this, cx| this.load_versions(this.snapshots, false, cx));
                }))
                .child(
                    div()
                        .id("ver-snapshots")
                        .flex()
                        .items_center()
                        .gap_2()
                        .h(px(32.0))
                        .px(px(10.0))
                        .rounded(px(6.0))
                        .bg(if app.snapshots { theme.accent_dim } else { theme.elevated })
                        .border_1()
                        .border_color(if app.snapshots { theme.accent } else { theme.border })
                        .text_size(px(10.5))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(if app.snapshots { theme.accent_soft } else { theme.muted })
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let _ = view_snapshots.update(cx, |this, cx| {
                                this.snapshots = !this.snapshots;
                                let snapshots = this.snapshots;
                                this.load_versions(snapshots, false, cx);
                            });
                        })
                        .child(if app.snapshots { "Có snapshot" } else { "Bản phát hành" }),
                ),
        );

    let mut body = div()
        .flex()
        .flex_col()
        .gap(px(22.0))
        .p(px(24.0))
        .w_full()
        .min_w(px(0.0))
        .max_w(px(1024.0))
        .mx_auto()
        .child(header);

    if app.create.step == 0 {
        let view_loader = view.clone();
        let mut grid = div().flex().gap_3().flex_wrap();
        for (key, name, desc) in LOADERS {
            let view = view_loader.clone();
            let key_owned = key.to_string();
            grid = grid.child(
                div()
                    .id(gpui::SharedString::from(format!("pick-loader-{key}")))
                    .flex()
                    .flex_col()
                    .gap(px(16.0))
                    .w(px(300.0))
                    .flex_grow()
                    .p(px(16.0))
                    .rounded(px(16.0))
                    .bg(theme.surface)
                    .border_1()
                    .border_color(theme.border)
                    .cursor_pointer()
                    .hover(|st| st.bg(theme.surface_hover).border_color(theme.border))
                    .on_click(move |_, _, cx| {
                        let key = key_owned.clone();
                        let _ = view.update(cx, |this, cx| pick_loader(this, key, cx));
                    })
                    .child(
                        div()
                            .flex()
                            .items_start()
                            .gap(px(12.0))
                            .child(
                                div()
                                    .size(px(56.0))
                                    .rounded(px(16.0))
                                    .bg(theme.elevated)
                                    .border_1()
                                    .border_color(theme.border)
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .child(gpui::img(loader_image(key)).size(px(36.0)).object_fit(gpui::ObjectFit::Contain)),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(4.0))
                                    .flex_1()
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(7.0))
                                            .child(div().text_size(px(13.0)).font_weight(FontWeight::BOLD).text_color(theme.text).child(name))
                                            .when(key == "lunar", |el| {
                                                el.child(
                                                    div()
                                                        .h(px(16.0))
                                                        .px(px(5.0))
                                                        .flex()
                                                        .items_center()
                                                        .rounded(px(4.0))
                                                        .bg(theme.elevated)
                                                        .border_1()
                                                        .border_color(theme.border)
                                                        .text_size(px(7.5))
                                                        .font_weight(FontWeight::BOLD)
                                                        .text_color(theme.muted)
                                                        .child("KHUYẾN NGHỊ"),
                                                )
                                            }),
                                    )
                                    .child(div().text_size(px(10.0)).text_color(theme.faint).child(desc)),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .text_size(px(8.5))
                                    .font_family(MONO)
                                    .text_color(theme.faint)
                                    .child(if key == "vanilla" { "KHÔNG MOD" } else { "HỖ TRỢ MOD" }),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(3.0))
                                    .text_size(px(10.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(theme.accent_soft)
                                    .child("Chọn")
                                    .child("→"),
                            ),
                    ),
            );
        }
        body = body
            .child(
                div()
                    .flex()
                    .items_end()
                    .justify_between()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(4.0))
                            .child(div().text_size(px(15.0)).font_weight(FontWeight::BOLD).text_color(theme.text).child("Chọn loader"))
                            .child(div().text_size(px(11.0)).text_color(theme.faint).child("Chọn loại loader trước, sau đó chọn phiên bản Minecraft và cấu hình instance.")),
                    )
                    .child(div().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).child("Bước 1 / 2")),
            )
            .child(grid)
            .child(div().text_size(px(10.0)).text_color(theme.faint).child("Có thể đổi loader sau ở cột bên phải. LunarLoader đi kèm shaderpack, HUD client và renderer tối ưu."));
        return body.into_any_element();
    }

    let active_loader = app.create.loader.clone();
    let active_name = loader_name(&active_loader);
    let view_change = view.clone();
    let view_game = view.clone();
    let view_build = view.clone();
    let view_browse = view.clone();
    let view_memory = view.clone();
    let view_demo = view.clone();
    let view_create = view.clone();

    let query = app.version_search.read(cx).text().to_lowercase();
    let use_loader_games = active_loader != "vanilla";
    let mut games: Vec<(String, String, bool)> = if use_loader_games {
        app.create
            .loader_games
            .iter()
            .filter_map(|row| {
                let version = row.get("version")?.as_str()?.to_string();
                let kind = if is_release_version(&version) { "release" } else { "snapshot" };
                Some((version.clone(), kind.into(), false))
            })
            .collect()
    } else {
        app.versions
            .iter()
            .map(|row| (row.id.clone(), row.kind.clone(), row.id == app.latest.get("release").and_then(serde_json::Value::as_str).unwrap_or("")))
            .collect()
    };
    games.retain(|(version, _, _)| query.is_empty() || version.to_lowercase().contains(&query));
    if !app.create.show_snapshots {
        games.retain(|(_, kind, _)| kind == "release");
    }
    let count = games.len();
    let latest_release = app.latest.get("release").and_then(serde_json::Value::as_str).unwrap_or("").to_string();
    let mut game_grid = div().flex().gap_2().flex_wrap();
    if app.versions_loading && games.is_empty() {
        game_grid = game_grid.child(
            div()
                .w_full()
                .py(px(48.0))
                .flex()
                .justify_center()
                .text_size(px(11.0))
                .text_color(theme.muted)
                .child("Đang tải danh sách phiên bản…"),
        );
    }
    for (version, kind, is_latest) in games.iter().take(200) {
        let active = app.create.game == *version;
        let view = view_game.clone();
        let version_owned = version.clone();
        let is_latest = *is_latest || version == &latest_release;
        let snapshot = kind != "release";
        game_grid = game_grid.child(
            div()
                .id(gpui::SharedString::from(format!("ver-game-{version}")))
                .flex()
                .flex_col()
                .gap(px(9.0))
                .w(px(190.0))
                .flex_grow()
                .p(px(12.0))
                .rounded(px(12.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border })
                .cursor_pointer()
                .hover(|st| st.bg(theme.surface_hover))
                .on_click(move |_, _, cx| {
                    let version = version_owned.clone();
                    let _ = view.update(cx, |this, cx| {
                        if this.create.game != version {
                            this.create.game = version;
                            refresh_loader_versions(this, cx);
                            update_name(this, cx);
                            this.create.error.clear();
                            cx.notify();
                        }
                    });
                })
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(9.0))
                        .child(
                            div()
                                .size(px(36.0))
                                .rounded(px(8.0))
                                .bg(theme.elevated)
                                .border_1()
                                .border_color(theme.border)
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(gpui::img(loader_image(&active_loader)).size(px(24.0)).object_fit(gpui::ObjectFit::Contain)),
                        )
                        .child(
                            div()
                                .flex_1()
                                .font_family(MONO)
                                .text_size(px(13.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(if active { theme.accent_soft } else { theme.text })
                                .child(version.clone()),
                        )
                        .when(active, |el| el.child(widgets::icon("check", 14.0, theme.accent))),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(5.0))
                        .flex_wrap()
                        .child(
                            div()
                                .h(px(16.0))
                                .px(px(5.0))
                                .flex()
                                .items_center()
                                .rounded(px(4.0))
                                .bg(if snapshot { gpui::rgba(0xeab30824) } else { gpui::rgba(0x22c55e24) })
                                .text_size(px(7.5))
                                .font_weight(FontWeight::BOLD)
                                .text_color(if snapshot { gpui::rgb(0xeab308) } else { gpui::rgb(0x22c55e) })
                                .child(if snapshot { "SNAPSHOT" } else { "RELEASE" }),
                        )
                        .when(is_latest, |el| {
                            el.child(
                                div()
                                    .h(px(16.0))
                                    .px(px(5.0))
                                    .flex()
                                    .items_center()
                                    .rounded(px(4.0))
                                    .bg(theme.accent_dim)
                                    .text_size(px(7.5))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(theme.accent_soft)
                                    .child("LATEST"),
                            )
                        }),
                ),
        );
    }
    if !app.versions_loading && games.is_empty() {
        game_grid = game_grid.child(
            div()
                .w_full()
                .py(px(40.0))
                .text_size(px(11.0))
                .text_color(theme.faint)
                .child("Không có phiên bản phù hợp."),
        );
    }

    let mut build_list = div()
        .id("ver-build-list")
        .flex()
        .flex_col()
        .gap(px(1.0))
        .max_h(px(130.0))
        .overflow_y_scroll()
        .on_scroll_wheel(|_, _, cx| cx.stop_propagation())
        .p(px(3.0))
        .rounded(px(6.0))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft);
    if app.create.loading_loaders {
        build_list = build_list.child(div().p(px(8.0)).text_size(px(10.0)).text_color(theme.faint).child("Đang tải build…"));
    } else if app.create.loader_versions.is_empty() {
        build_list = build_list.child(div().p(px(8.0)).text_size(px(10.0)).text_color(theme.faint).child("Chọn phiên bản game trước."));
    }
    for row in app.create.loader_versions.iter().take(40).cloned().collect::<Vec<_>>() {
        let active = app.create.loader_version == row.id;
        let view = view_build.clone();
        let id = row.id.clone();
        build_list = build_list.child(
            div()
                .id(gpui::SharedString::from(format!("ver-build-{}", row.id)))
                .flex()
                .items_center()
                .justify_between()
                .h(px(26.0))
                .px(px(8.0))
                .rounded(px(5.0))
                .when(active, |el| el.bg(theme.accent_dim))
                .when(!active, |el| el.hover(|st| st.bg(theme.surface_hover)))
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let id = id.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.create.loader_version = id;
                        cx.notify();
                    });
                })
                .child(div().font_family(MONO).text_size(px(10.0)).text_color(if active { theme.accent_soft } else { theme.muted }).child(row.version.clone()))
                .when(row.latest, |el| el.child(div().text_size(px(8.0)).text_color(theme.accent_soft).child("MỚI NHẤT")))
                .when(row.stable && !row.latest, |el| el.child(div().text_size(px(8.0)).text_color(theme.ok).child("ỔN ĐỊNH"))),
        );
    }

    let dir = app.file_name_input.read(cx).text().to_string();
    let memory_steps = [1024u32, 2048, 3072, 4096, 6144, 8192, 12288, 16384];
    let current_memory = app.memory_input.read(cx).text().trim().parse::<u32>().unwrap_or(4096);
    let mut memory_row = div().flex().gap(px(4.0)).flex_wrap();
    for step in memory_steps {
        let active = current_memory == step;
        let view = view_memory.clone();
        memory_row = memory_row.child(
            div()
                .id(gpui::SharedString::from(format!("ver-mem-{step}")))
                .h(px(24.0))
                .px(px(7.0))
                .flex()
                .items_center()
                .rounded(px(4.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .text_size(px(9.0))
                .font_family(MONO)
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        let input = this.memory_input.clone();
                        input.update(cx, |input, cx| input.set_text(step.to_string(), cx));
                        cx.notify();
                    });
                })
                .child(step.to_string()),
        );
    }

    let config_panel = div()
        .flex()
        .flex_col()
        .gap(px(14.0))
        .w(px(320.0))
        .flex_shrink_0()
        .h_full()
        .pl(px(18.0))
        .border_l_1()
        .border_color(theme.border)
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(gpui::img(loader_image(&active_loader)).size(px(28.0)).rounded(px(8.0)).object_fit(gpui::ObjectFit::Contain))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .child(div().text_size(px(12.0)).font_weight(FontWeight::BOLD).text_color(theme.text).child("Tạo phiên bản"))
                        .child(div().text_size(px(10.0)).text_color(theme.faint).child("Chọn loader và phiên bản")),
                )
                .child(widgets::ghost_button("ver-change-loader", "Đổi loader", &theme, move |_, _, cx| {
                    let _ = view_change.update(cx, |this, cx| {
                        this.create.step = 0;
                        cx.notify();
                    });
                })),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .p(px(9.0))
                .rounded(px(6.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border)
                .child(gpui::img(loader_image(&active_loader)).size(px(18.0)).object_fit(gpui::ObjectFit::Contain))
                .child(div().text_size(px(11.0)).font_weight(FontWeight::BOLD).text_color(theme.accent_soft).child(active_name))
                .child(div().text_size(px(9.0)).text_color(theme.faint).child(loader_desc(&active_loader))),
        )
        .when(active_loader != "vanilla", |el| {
            el.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(5.0))
                    .child(div().text_size(px(9.5)).font_weight(FontWeight::SEMIBOLD).text_color(theme.faint).child("BẢN BUILD LOADER"))
                    .child(build_list),
            )
        })
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(5.0))
                .child(div().text_size(px(9.5)).font_weight(FontWeight::SEMIBOLD).text_color(theme.faint).child("TÊN PHIÊN BẢN"))
                .child(widgets::text_input_box(&theme).child(app.name_input.clone())),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(5.0))
                .child(div().text_size(px(9.5)).font_weight(FontWeight::SEMIBOLD).text_color(theme.faint).child("THƯ MỤC"))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(div().flex_1().min_w(px(0.0)).child(widgets::text_input_box(&theme).child(app.file_name_input.clone())))
                        .child(widgets::icon_button("ver-browse", "folder-open", &theme, move |_, _, cx| {
                            let view = view_browse.clone();
                            cx.spawn(async move |cx| {
                                let picked = rfd::AsyncFileDialog::new().pick_folder().await;
                                if let Some(folder) = picked {
                                    let path = folder.path().to_string_lossy().into_owned();
                                    let _ = view.update(cx, |this, cx| {
                                        let input = this.file_name_input.clone();
                                        input.update(cx, |input, cx| input.set_text(path, cx));
                                        cx.notify();
                                    });
                                }
                            })
                            .detach();
                        })),
                ),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(5.0))
                .child(div().text_size(px(9.5)).font_weight(FontWeight::SEMIBOLD).text_color(theme.faint).child("BỘ NHỚ (MB)"))
                .child(widgets::text_input_box(&theme).child(app.memory_input.clone()))
                .child(memory_row),
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
                        .child(div().text_size(px(11.0)).font_weight(FontWeight::MEDIUM).text_color(theme.text).child("Chế độ demo"))
                        .child(div().text_size(px(9.0)).text_color(theme.faint).child("Thế giới giới hạn 5 ngày")),
                )
                .child(
                    div()
                        .id("ver-demo")
                        .w(px(38.0))
                        .h(px(22.0))
                        .rounded_full()
                        .bg(if app.create.demo { theme.accent } else { theme.surface_active })
                        .p(px(3.0))
                        .flex()
                        .items_center()
                        .when(app.create.demo, |el| el.justify_end())
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let _ = view_demo.update(cx, |this, cx| {
                                this.create.demo = !this.create.demo;
                                cx.notify();
                            });
                        })
                        .child(div().size(px(16.0)).rounded_full().bg(gpui::white())),
                ),
        )
        .when(!app.create.error.is_empty(), |el| {
            el.child(div().text_size(px(10.0)).text_color(theme.bad).child(app.create.error.clone()))
        })
        .child(widgets::button("ver-create-submit", "Tạo phiên bản", &theme, true, move |_, _, cx| {
            let _ = view_create.update(cx, |this, cx| submit_create(this, cx));
        }))
        .child(
            div()
                .text_size(px(9.0))
                .font_family(MONO)
                .text_color(theme.faint)
                .child(format!("{} bản phù hợp{}{}", count, if app.create.game.is_empty() { "" } else { " · " }, app.create.game.clone())),
        );

    let split = div()
        .flex()
        .gap(px(18.0))
        .items_start()
        .w_full()
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(12.0))
                .flex_1()
                .min_w(px(0.0))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .flex_1()
                                .max_w(px(300.0))
                                .child(widgets::text_input_box(&theme).child(app.version_search.clone())),
                        )
                        .child(div().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).child(format!("{count} kết quả")))
                        .when(use_loader_games, |el| {
                            el.child(div().text_size(px(10.0)).font_family(MONO).text_color(theme.accent_soft).child(format!("{} hỗ trợ {} phiên bản", active_name, count)))
                        }),
                )
                .child(game_grid),
        )
        .child(config_panel);

    body.child(split).into_any_element()
}

pub fn create_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let close_view = cx.entity().downgrade();
    let close_view2 = close_view.clone();
    let submit_view = cx.entity().downgrade();
    let loader_view = cx.entity().downgrade();
    let game_view = cx.entity().downgrade();
    let snap_view = cx.entity().downgrade();
    let query = app.version_search.read(cx).text().to_lowercase();

    let mut loader_row = div().flex().gap_2().flex_wrap();
    for (key, label, desc) in LOADERS {
        let active = app.create.loader == key;
        let view = loader_view.clone();
        let key_owned = key.to_string();
        loader_row = loader_row.child(
            div()
                .id(gpui::SharedString::from(format!("loader-{key}")))
                .flex()
                .items_center()
                .gap_2()
                .w(px(190.0))
                .p(px(10.0))
                .rounded(px(RADIUS_SM))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1()
                .border_color(if active { theme.accent } else { theme.border_soft })
                .cursor_pointer()
                .hover(|s| s.border_color(theme.border))
                .on_click(move |_, _, cx| {
                    let key = key_owned.clone();
                    let _ = view.update(cx, |this, cx| {
                        if this.create.loader != key {
                            this.create.loader = key;
                            this.create.loader_version.clear();
                            this.create.error.clear();
                            load_create_loaders(this, cx);
                            cx.notify();
                        }
                    });
                })
                .child(
                    gpui::img(crate::ui::assets::image_path(&format!("loader-icon/{key}.png")))
                        .size(px(28.0))
                        .object_fit(gpui::ObjectFit::Contain),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .min_w(px(0.0))
                        .child(
                            div()
                                .text_size(px(TEXT_SM))
                                .font_weight(semibold())
                                .text_color(if active { theme.text } else { theme.muted })
                                .child((*label).to_string()),
                        )
                        .child(
                            div()
                                .text_size(px(9.5))
                                .text_color(theme.faint)
                                .child((*desc).to_string()),
                        ),
                ),
        );
    }

    let use_loader_games = matches!(app.create.loader.as_str(), "forge" | "neoforge");
    let mut games: Vec<(String, String)> = if use_loader_games {
        app.create
            .loader_games
            .iter()
            .filter_map(|row| {
                let version = row.get("version")?.as_str()?.to_string();
                Some((version.clone(), version))
            })
            .collect()
    } else {
        app.create
            .versions
            .iter()
            .filter(|row| query.is_empty() || row.id.to_lowercase().contains(&query))
            .map(|row| (row.id.clone(), row.release_time.clone()))
            .collect()
    };
    if app.create.show_snapshots && !use_loader_games {
        // versions list already includes all when snapshots loaded; nothing extra
    }
    games.truncate(260);
    let mut game_list = div()
        .id("create-game-list")
        .flex()
        .flex_col()
        .gap(px(2.0))
        .h(px(210.0))
        .overflow_y_scroll()
        .on_scroll_wheel(|_, _, cx| cx.stop_propagation())
        .p(px(4.0))
        .rounded(px(RADIUS_SM))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft);
    if games.is_empty() {
        game_list = game_list.child(
            div()
                .p(px(12.0))
                .text_size(px(TEXT_SM))
                .text_color(theme.faint)
                .child("Không có phiên bản phù hợp."),
        );
    }
    for (version, meta) in games {
        let active = app.create.game == version;
        let view = game_view.clone();
        let version_owned = version.clone();
        game_list = game_list.child(
            div()
                .id(gpui::SharedString::from(format!("game-{version}")))
                .flex()
                .items_center()
                .justify_between()
                .h(px(32.0))
                .px(px(10.0))
                .rounded(px(6.0))
                .cursor_pointer()
                .when(active, |el| el.bg(theme.accent_dim))
                .when(!active, |el| el.hover(|s| s.bg(theme.surface_hover)))
                .on_click(move |_, _, cx| {
                    let version = version_owned.clone();
                    let _ = view.update(cx, |this, cx| {
                        if this.create.game != version {
                            this.create.game = version;
                            refresh_loader_versions(this, cx);
                            update_name(this, cx);
                            cx.notify();
                        }
                    });
                })
                .child(
                    div()
                        .text_size(px(TEXT_SM))
                        .font_weight(if active { semibold() } else { medium() })
                        .text_color(if active { theme.text } else { theme.muted })
                        .child(version),
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.faint)
                        .child(if use_loader_games {
                            String::new()
                        } else {
                            meta.chars().take(10).collect()
                        }),
                ),
        );
    }

    let mut loader_list = div()
        .id("create-loader-list")
        .flex()
        .flex_col()
        .gap(px(2.0))
        .h(px(120.0))
        .overflow_y_scroll()
        .on_scroll_wheel(|_, _, cx| cx.stop_propagation())
        .p(px(4.0))
        .rounded(px(RADIUS_SM))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft);
    let show_loader_versions = app.create.loader != "vanilla";
    if app.create.loading_loaders {
        loader_list = loader_list.child(
            div()
                .p(px(10.0))
                .text_size(px(TEXT_SM))
                .text_color(theme.faint)
                .child("Đang tải danh sách trình tải…"),
        );
    } else if app.create.loader_versions.is_empty() {
        loader_list = loader_list.child(
            div()
                .p(px(10.0))
                .text_size(px(TEXT_SM))
                .text_color(theme.faint)
                .child("Không có bản trình tải cho phiên bản này."),
        );
    }
    let lv_view = loader_view.clone();
    for row in app.create.loader_versions.iter().take(120).cloned().collect::<Vec<_>>() {
        let active = app.create.loader_version == row.id;
        let view = lv_view.clone();
        let id = row.id.clone();
        loader_list = loader_list.child(
            div()
                .id(gpui::SharedString::from(format!("lv-{}", row.id)))
                .flex()
                .items_center()
                .justify_between()
                .h(px(30.0))
                .px(px(10.0))
                .rounded(px(6.0))
                .cursor_pointer()
                .when(active, |el| el.bg(theme.accent_dim))
                .when(!active, |el| el.hover(|s| s.bg(theme.surface_hover)))
                .on_click(move |_, _, cx| {
                    let id = id.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.create.loader_version = id;
                        cx.notify();
                    });
                })
                .child(
                    div()
                        .text_size(px(TEXT_SM))
                        .font_weight(if active { semibold() } else { medium() })
                        .text_color(if active { theme.text } else { theme.muted })
                        .child(row.version.clone()),
                )
                .when(row.latest, |el| {
                    el.child(
                        div()
                            .px(px(6.0))
                            .h(px(18.0))
                            .rounded(px(4.0))
                            .bg(theme.surface_active)
                            .text_size(px(9.0))
                            .text_color(theme.accent_soft)
                            .child("Mới nhất"),
                    )
                })
                .when(row.stable && !row.latest, |el| {
                    el.child(
                        div()
                            .text_size(px(9.0))
                            .text_color(theme.ok)
                            .child("Ổn định"),
                    )
                }),
        );
    }

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
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .text_size(px(TEXT_XL))
                                .font_weight(semibold())
                                .text_color(theme.text)
                                .child("Tạo phiên bản mới"),
                        )
                        .child(
                            div()
                                .text_size(px(TEXT_SM))
                                .text_color(theme.muted)
                                .child("Chọn trình tải mod và phiên bản Minecraft"),
                        ),
                )
                .child(widgets::icon_button("create-close", "x", &theme, move |_, _, cx| {
                    let _ = close_view.update(cx, |this, cx| {
                        this.modal = Modal::None;
                        this.create.open = false;
                        cx.notify();
                    });
                })),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap_2()
                .child(
                    div()
                        .text_size(px(TEXT_SM))
                        .font_weight(medium())
                        .text_color(theme.muted)
                        .child("Trình tải mod"),
                )
                .child(loader_row),
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
                        .flex_1()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(
                                    div()
                                        .text_size(px(TEXT_SM))
                                        .font_weight(medium())
                                        .text_color(theme.muted)
                                        .child("Phiên bản Minecraft"),
                                )
                                .when(!use_loader_games, |el| {
                                    el.child(
                                        div()
                                            .id("create-snap")
                                            .px(px(8.0))
                                            .h(px(22.0))
                                            .flex()
                                            .items_center()
                                            .rounded(px(5.0))
                                            .bg(if app.create.show_snapshots { theme.accent_dim } else { theme.surface_active })
                                            .text_size(px(10.0))
                                            .text_color(if app.create.show_snapshots { theme.accent_soft } else { theme.muted })
                                            .cursor_pointer()
                                            .on_click(move |_, _, cx| {
                                                let _ = snap_view.update(cx, |this, cx| {
                                                    this.create.show_snapshots = !this.create.show_snapshots;
                                                    let snapshots = this.create.show_snapshots;
                                                    this.snapshots = snapshots;
                                                    this.load_versions(snapshots, false, cx);
                                                });
                                            })
                                            .child("Snapshot"),
                                    )
                                }),
                        )
                        .when(!use_loader_games, |el| el.child(widgets::text_input_box(&theme).child(app.version_search.clone())))
                        .child(game_list),
                )
                .when(show_loader_versions, |el| {
                    el.child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .w(px(250.0))
                            .child(
                                div()
                                    .text_size(px(TEXT_SM))
                                    .font_weight(medium())
                                    .text_color(theme.muted)
                                    .child("Bản trình tải"),
                            )
                            .child(loader_list),
                    )
                }),
        )
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
                        .w(px(170.0))
                        .child(pages::field(&theme, "RAM (MB)", app.memory_input.clone(), "")),
                ),
        )
        .when(!app.create.error.is_empty(), |el| {
            el.child(
                div()
                    .text_size(px(TEXT_SM))
                    .text_color(theme.bad)
                    .child(app.create.error.clone()),
            )
        })
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
                        .child("Tệp game sẽ được tải ở nền sau khi tạo."),
                )
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .child(widgets::ghost_button("create-cancel", "Huỷ", &theme, move |_, _, cx| {
                            let _ = close_view2.update(cx, |this, cx| {
                                this.modal = Modal::None;
                                this.create.open = false;
                                cx.notify();
                            });
                        }))
                        .child(widgets::button("create-submit", "Tạo phiên bản", &theme, true, move |_, _, cx| {
                            let _ = submit_view.update(cx, |this, cx| create_instance(this, cx));
                        })),
                ),
        );
    let backdrop_view = cx.entity().downgrade();
    pages::modal_overlay(theme.clone(), 760.0, content, move |_, _, cx| {
        let _ = backdrop_view.update(cx, |this, cx| {
            this.modal = Modal::None;
            this.create.open = false;
            cx.notify();
        });
    })
    .into_any_element()
}
