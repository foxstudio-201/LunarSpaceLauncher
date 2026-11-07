use crate::models::Instance;
use crate::ui::app::LauncherApp;
use crate::ui::theme::*;
use crate::ui::widgets;
use crate::util::format_bytes;
use gpui::{AnyElement, AnimationExt, Context, FontWeight, IntoElement, Window, div, prelude::*, px};
use serde_json::{Value, json};

const LOADERS: [(&str, &str, &str); 6] = [
    ("vanilla", "Vanilla", "Bản gốc Mojang, không mod"),
    ("fabric", "Fabric", "Loader nhẹ, cập nhật nhanh"),
    ("quilt", "Quilt", "Kế thừa Fabric, hiện đại hơn"),
    ("forge", "Forge", "Loader lâu đời, nhiều mod nhất"),
    ("neoforge", "NeoForge", "Bản tách từ Forge, hiện đại hơn"),
    ("lunar", "LunarLoader", "Loader riêng của LunarSpace"),
];

fn loader_name(id: &str) -> &'static str {
    LOADERS.iter().find(|(key, _, _)| *key == id).map(|(_, name, _)| *name).unwrap_or("Vanilla")
}

fn loader_image(id: &str) -> std::path::PathBuf {
    crate::ui::assets::image_path(&format!("loader-icon/{id}.png"))
}

fn date_of(iso: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(iso)
        .map(|d| d.format("%d/%m/%Y").to_string())
        .unwrap_or_else(|_| iso.chars().take(10).collect())
}

fn time_ago(iso: &str) -> String {
    let Ok(date) = chrono::DateTime::parse_from_rfc3339(iso) else {
        return String::new();
    };
    let delta = chrono::Utc::now().signed_duration_since(date.with_timezone(&chrono::Utc));
    if delta.num_hours() < 24 {
        format!("{} giờ trước", delta.num_hours().max(0))
    } else if delta.num_days() < 30 {
        format!("{} ngày trước", delta.num_days())
    } else if delta.num_days() < 365 {
        format!("{} tháng trước", delta.num_days() / 30)
    } else {
        format!("{} năm trước", delta.num_days() / 365)
    }
}

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

fn set_loader(app: &mut LauncherApp, kind: &str, key: &str, value: Value) {
    let mut map = app.home_loaders.as_object().cloned().unwrap_or_default();
    let mut entry = map.get(kind).cloned().unwrap_or_else(|| json!({}));
    if let Some(obj) = entry.as_object_mut() {
        obj.insert(key.to_string(), value);
    }
    map.insert(kind.to_string(), entry);
    app.home_loaders = Value::Object(map);
}

pub fn ensure_loaders(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    let latest = app
        .latest
        .get("release")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| app.versions.first().map(|v| v.id.clone()))
        .unwrap_or_default();
    if latest.is_empty() || app.home_loaders_for == latest {
        return;
    }
    app.home_loaders_for = latest.clone();
    app.home_loaders = json!({"vanilla": {"supported": true, "build": latest, "vanilla": true}});
    for (kind, _, _) in LOADERS {
        if kind == "vanilla" {
            continue;
        }
        let kind_owned = kind.to_string();
        let rx = app.backend.loader_versions(kind.to_string(), latest.clone());
        let kind_versions = kind_owned.clone();
        app.on_result(cx, rx, move |this, value, _cx| {
            let rows = value.get("versions").and_then(Value::as_array).cloned().unwrap_or_default();
            if let Some(first) = rows.first() {
                set_loader(this, &kind_versions, "supported", Value::Bool(true));
                set_loader(this, &kind_versions, "build", first.get("version").cloned().unwrap_or(Value::Null));
                set_loader(this, &kind_versions, "buildNumber", first.get("build").cloned().unwrap_or(Value::Null));
                set_loader(this, &kind_versions, "stable", first.get("stable").cloned().unwrap_or(Value::Bool(false)));
            } else {
                set_loader(this, &kind_versions, "supported", Value::Bool(false));
            }
        });
        let rx = app.backend.loader_games(kind.to_string());
        let kind_games = kind_owned;
        app.on_result(cx, rx, move |this, value, _cx| {
            let games = value.get("games").and_then(Value::as_array).map(|r| r.len()).unwrap_or(0);
            set_loader(this, &kind_games, "games", json!(games));
        });
    }
    if !app.home_java_loaded {
        app.home_java_loaded = true;
        app.load_java(cx);
    }
}

fn section_header(theme: &Theme, title: &str, hint: String, action: Option<AnyElement>) -> AnyElement {
    div()
        .flex()
        .items_center()
        .gap(px(12.0))
        .child(
            div()
                .flex_shrink_0()
                .text_size(px(10.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.muted)
                .child(title.to_uppercase()),
        )
        .child(div().h(px(1.0)).flex_1().bg(theme.border_soft))
        .when(!hint.is_empty(), |el| {
            el.child(
                div()
                    .flex_shrink_0()
                    .text_size(px(10.0))
                    .font_family(MONO)
                    .text_color(theme.faint)
                    .child(hint),
            )
        })
        .when_some(action, |el, action| el.child(action))
        .into_any_element()
}

fn card(theme: &Theme) -> gpui::Div {
    div()
        .rounded(px(12.0))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border)
}

fn chip(label: String, dim: bool) -> impl IntoElement {
    div()
        .h(px(21.0))
        .px(px(7.0))
        .flex()
        .items_center()
        .rounded(px(4.0))
        .border_1()
        .border_color(gpui::rgba(0xffffff29))
        .bg(if dim { gpui::rgba(0xffffff14) } else { gpui::rgba(0xffffff1f) })
        .text_size(px(10.0))
        .font_family(MONO)
        .text_color(if dim { gpui::rgba(0xffffff99) } else { gpui::rgba(0xffffffd1) })
        .child(label)
}

fn meter_row(theme: &Theme, label: &str, used: u64, total: u64, color: gpui::Rgba) -> AnyElement {
    let percent = if total > 0 {
        (used.min(total) as f32 / total as f32).clamp(0.0, 1.0)
    } else {
        0.0
    };
    div()
        .flex()
        .flex_col()
        .gap(px(6.0))
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_2()
                .child(
                    div()
                        .text_size(px(10.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.muted)
                        .child(label.to_uppercase()),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .text_size(px(10.0))
                        .font_family(MONO)
                        .text_color(theme.text)
                        .child(format_bytes(used))
                        .child(div().text_color(theme.faint).child(format!(" / {}", format_bytes(total)))),
                ),
        )
        .child(
            div()
                .h(px(6.0))
                .w_full()
                .rounded_full()
                .bg(theme.elevated)
                .overflow_hidden()
                .child(div().h_full().w(gpui::relative(percent)).rounded_full().bg(color)),
        )
        .into_any_element()
}

fn fact_row(theme: &Theme, label: &str, value: String) -> AnyElement {
    div()
        .flex()
        .items_center()
        .gap(px(12.0))
        .min_w(px(0.0))
        .child(
            div()
                .w(px(104.0))
                .flex_shrink_0()
                .text_size(px(10.0))
                .text_color(theme.faint)
                .child(label.to_string()),
        )
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .text_size(px(11.0))
                .font_family(MONO)
                .text_color(theme.text)
                .truncate()
                .child(value),
        )
        .into_any_element()
}

fn stat_white(icon_name: &str, label: &str, value: String) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .gap_2()
        .child(widgets::icon(icon_name, 16.0, gpui::rgba(0xffffff99)))
        .child(
            div()
                .flex()
                .flex_col()
                .child(
                    div()
                        .text_size(px(9.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(gpui::rgba(0xffffff8c))
                        .child(label.to_uppercase()),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(gpui::white())
                        .child(value),
                ),
        )
}

fn status_color(theme: &Theme, status: &str) -> gpui::Rgba {
    match status {
        "running" => theme.ok,
        "starting" | "installing" | "stopping" => theme.warn,
        "error" => theme.bad,
        _ => theme.faint,
    }
}

fn status_label(status: &str) -> &'static str {
    match status {
        "running" => "ĐANG CHƠI",
        "starting" => "ĐANG KHỞI ĐỘNG",
        "installing" => "ĐANG CÀI ĐẶT",
        "stopping" => "ĐANG DỪNG",
        "error" => "GẶP LỖI",
        _ => "SẴN SÀNG",
    }
}

fn empty_text(theme: &Theme, title: &str, hint: &str) -> AnyElement {
    card(theme)
        .p(px(16.0))
        .flex()
        .flex_col()
        .gap(px(3.0))
        .child(div().text_size(px(11.0)).font_weight(FontWeight::MEDIUM).text_color(theme.muted).child(title.to_string()))
        .child(div().text_size(px(10.5)).text_color(theme.faint).child(hint.to_string()))
        .into_any_element()
}

pub fn render(app: &mut LauncherApp, window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    ensure_loaders(app, cx);
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();

    let latest_release = app
        .latest
        .get("release")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| app.versions.first().map(|v| v.id.clone()))
        .unwrap_or_default();
    let latest_row = app
        .versions
        .iter()
        .find(|v| v.id == latest_release)
        .or_else(|| app.versions.first())
        .cloned();
    let snapshot = app.latest.get("snapshot").and_then(Value::as_str).unwrap_or("").to_string();
    let running_count = app.instances.iter().filter(|i| i.status == "running").count();
    let active: Option<Instance> = app
        .instances
        .iter()
        .find(|i| i.status == "running")
        .or_else(|| app.instances.iter().find(|i| i.status == "starting"))
        .or_else(|| app.instances.first())
        .cloned();
    let active_progress = active.as_ref().and_then(|i| app.instance_progress(&i.id));
    let active_error = active.as_ref().and_then(|i| i.error.clone()).unwrap_or_default();

    let view_versions = view.clone();
    let view_theme = view.clone();
    let versions_button = div()
        .id("home-open-versions")
        .flex()
        .items_center()
        .gap_2()
        .h(px(36.0))
        .px(px(12.0))
        .rounded(px(8.0))
        .bg(theme.elevated)
        .border_1()
        .border_color(theme.border)
        .text_size(px(11.0))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(theme.muted)
        .cursor_pointer()
        .hover(|st| st.text_color(theme.text))
        .on_click(move |_, _, cx| {
            let _ = view_versions.update(cx, |this, cx| {
                crate::ui::pages::versions::open_versions(this, cx, None, None);
            });
        })
        .child(widgets::icon("cube", 14.0, theme.faint))
        .child("Phiên bản")
        .child(widgets::icon("arrow-right", 11.0, theme.faint));
    let theme_button = crate::ui::pages::settings::theme_switch_small(
        &theme,
        theme.dark,
        view_theme.clone(),
    );

    let header = div()
        .flex_shrink_0()
        .w_full()
        .bg(theme.bg)
        .border_b_1()
        .border_color(theme.border_soft)
        .child(
            div()
                .px(px(24.0))
                .py(px(13.0))
                .flex()
                .items_center()
                .gap(px(12.0))
                .child(
                    div()
                        .min_w(px(0.0))
                        .flex()
                        .flex_col()
                        .child(div().text_size(px(16.0)).font_weight(FontWeight::BOLD).text_color(theme.text).truncate().child("Trang chủ"))
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(theme.muted)
                                .truncate()
                                .child(format!(
                                    "{} bản phát hành · {} phiên bản đã tạo · mới nhất {}",
                                    app.versions.len(),
                                    app.instances.len(),
                                    if latest_release.is_empty() { "—" } else { &latest_release }
                                )),
                        ),
                )
                .child(div().flex_1())
                .child(versions_button)
                .child(theme_button),
        );

    let view_tabs = view.clone();
    let mut tabs = div().flex().items_center().gap(px(6.0));
    for (key, label) in [("overview", "Tổng quan"), ("recent", "Chơi gần đây"), ("instances", "Phiên bản"), ("system", "Hệ thống")] {
        let active_tab = app.home_tab == key;
        let view_tab = view_tabs.clone();
        let key = key.to_string();
        tabs = tabs.child(
            div()
                .id(gpui::SharedString::from(format!("home-tab-{key}")))
                .h(px(32.0))
                .px(px(12.0))
                .flex()
                .items_center()
                .rounded(px(8.0))
                .bg(if active_tab { theme.elevated } else { theme.bg })
                .border_1()
                .border_color(if active_tab { theme.border } else { theme.bg })
                .text_size(px(11.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(if active_tab { theme.text } else { theme.faint })
                .cursor_pointer()
                .hover(|st| st.text_color(theme.muted))
                .on_click(move |_, _, cx| {
                    let key = key.clone();
                    let _ = view_tab.update(cx, |this, cx| {
                        this.home_tab = key;
                        cx.notify();
                    });
                })
                .child(label.to_string()),
        );
    }
    let tab_strip = div()
        .flex_shrink_0()
        .px(px(24.0))
        .pt(px(12.0))
        .child(div().max_w(px(1024.0)).mx_auto().w_full().child(tabs));

    let mut content = div().flex().flex_col().gap(px(24.0)).w_full().min_w(px(0.0));

    match app.home_tab.as_str() {
        "recent" => {
            let mut worlds = Vec::new();
            let mut servers = Vec::new();
            for instance in &app.instances {
                for row in &instance.recent_worlds {
                    if row.get("folder").and_then(Value::as_str).map(|v| !v.is_empty()).unwrap_or(false) {
                        worlds.push((instance.clone(), row.clone()));
                    }
                }
                for row in &instance.recent_servers {
                    if row.get("host").and_then(Value::as_str).map(|v| !v.is_empty()).unwrap_or(false) {
                        servers.push((instance.clone(), row.clone()));
                    }
                }
            }
            worlds.sort_by_key(|(_, row)| std::cmp::Reverse(row.get("playedAt").and_then(Value::as_str).unwrap_or("").to_string()));
            servers.sort_by_key(|(_, row)| std::cmp::Reverse(row.get("playedAt").and_then(Value::as_str).unwrap_or("").to_string()));

            let world_rows = if worlds.is_empty() {
                empty_text(&theme, "Chưa có thế giới nào được ghi lại", "Vào Singleplayer một lần để lịch sử xuất hiện ở đây.")
            } else {
                let mut list = card(&theme).flex().flex_col();
                for (index, (instance, row)) in worlds.iter().take(8).enumerate() {
                    let folder = row.get("folder").and_then(Value::as_str).unwrap_or("").to_string();
                    let name = row.get("name").and_then(Value::as_str).unwrap_or(&folder).to_string();
                    let played = row.get("playedAt").and_then(Value::as_str).unwrap_or("");
                    let view_play = view.clone();
                    let id = instance.id.clone();
                    let quick = json!({"type": "world", "folder": folder, "name": name});
                    list = list.child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.0))
                            .h(px(56.0))
                            .px(px(14.0))
                            .when(index > 0, |el| el.border_t_1().border_color(theme.border))
                            .child(gpui::img(loader_image(&instance.loader)).size(px(28.0)).rounded(px(4.0)).flex_shrink_0().object_fit(gpui::ObjectFit::Contain))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .flex_1()
                                    .min_w(px(0.0))
                                    .child(div().text_size(px(11.0)).font_weight(FontWeight::BOLD).text_color(theme.text).truncate().child(name))
                                    .child(div().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).truncate().child(format!("{} · {}", instance.name, folder))),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(4.0))
                                    .flex_shrink_0()
                                    .child(widgets::icon("clock", 11.0, theme.faint))
                                    .child(div().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).child(if played.is_empty() { "—".into() } else { time_ago(played) })),
                            )
                            .child(
                                div()
                                    .id(gpui::SharedString::from(format!("home-world-play-{}", instance.id)))
                                    .flex()
                                    .items_center()
                                    .gap(px(5.0))
                                    .h(px(32.0))
                                    .px(px(12.0))
                                    .rounded(px(8.0))
                                    .bg(gpui::rgba(0x22c55e24))
                                    .text_size(px(10.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(gpui::rgb(0x22c55e))
                                    .cursor_pointer()
                                    .hover(|st| st.bg(gpui::rgba(0x22c55e3a)))
                                    .on_click(move |_, _, cx| {
                                        let id = id.clone();
                                        let quick = quick.clone();
                                        let _ = view_play.update(cx, |this, cx| this.play_instance_quick(&id, quick, cx));
                                    })
                                    .child(widgets::icon("play-fill", 11.0, gpui::rgb(0x22c55e)))
                                    .child("Vào world"),
                            ),
                    );
                }
                list.into_any_element()
            };

            let server_rows = if servers.is_empty() {
                empty_text(&theme, "Chưa có server nào được ghi lại", "Tham gia Multiplayer một lần để lịch sử xuất hiện ở đây.")
            } else {
                let mut list = card(&theme).flex().flex_col();
                for (index, (instance, row)) in servers.iter().take(8).enumerate() {
                    let host = row.get("host").and_then(Value::as_str).unwrap_or("").to_string();
                    let port = row.get("port").and_then(Value::as_u64).unwrap_or(25565);
                    let played = row.get("playedAt").and_then(Value::as_str).unwrap_or("");
                    let view_play = view.clone();
                    let id = instance.id.clone();
                    let quick = json!({"type": "server", "host": host, "port": port});
                    let address = if port != 25565 { format!("{host}:{port}") } else { host.clone() };
                    list = list.child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.0))
                            .h(px(56.0))
                            .px(px(14.0))
                            .when(index > 0, |el| el.border_t_1().border_color(theme.border))
                            .child(gpui::img(loader_image(&instance.loader)).size(px(28.0)).rounded(px(4.0)).flex_shrink_0().object_fit(gpui::ObjectFit::Contain))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .flex_1()
                                    .min_w(px(0.0))
                                    .child(div().text_size(px(11.0)).font_weight(FontWeight::BOLD).text_color(theme.text).truncate().child(address))
                                    .child(div().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).truncate().child(format!("{} · {} {}", instance.name, loader_name(&instance.loader), instance.version))),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(4.0))
                                    .flex_shrink_0()
                                    .child(widgets::icon("clock", 11.0, theme.faint))
                                    .child(div().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).child(if played.is_empty() { "—".into() } else { time_ago(played) })),
                            )
                            .child(
                                div()
                                    .id(gpui::SharedString::from(format!("home-server-play-{}", instance.id)))
                                    .flex()
                                    .items_center()
                                    .gap(px(5.0))
                                    .h(px(32.0))
                                    .px(px(12.0))
                                    .rounded(px(8.0))
                                    .bg(gpui::rgba(0x22c55e24))
                                    .text_size(px(10.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(gpui::rgb(0x22c55e))
                                    .cursor_pointer()
                                    .hover(|st| st.bg(gpui::rgba(0x22c55e3a)))
                                    .on_click(move |_, _, cx| {
                                        let id = id.clone();
                                        let quick = quick.clone();
                                        let _ = view_play.update(cx, |this, cx| this.play_instance_quick(&id, quick, cx));
                                    })
                                    .child(widgets::icon("play-fill", 11.0, gpui::rgb(0x22c55e)))
                                    .child("Tham gia"),
                            ),
                    );
                }
                list.into_any_element()
            };

            content = content
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(10.0))
                        .child(section_header(&theme, "Thế giới gần đây", "bấm để vào nhanh".into(), None))
                        .child(world_rows),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(10.0))
                        .child(section_header(&theme, "Server gần đây", "tham gia lại nhanh".into(), None))
                        .child(server_rows),
                );
        }
        "instances" => {
            let view_create = view.clone();
            let count = app.instances.len();
            let create_button = div()
                .id("home-instances-create")
                .flex()
                .items_center()
                .h(px(32.0))
                .px(px(12.0))
                .rounded(px(8.0))
                .bg(theme.accent)
                .text_size(px(10.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.on_accent)
                .cursor_pointer()
                .hover(|st| st.bg(theme.accent_hover))
                .on_click(move |_, _, cx| {
                    let _ = view_create.update(cx, |this, cx| {
                        crate::ui::pages::versions::open_versions(this, cx, None, None);
                    });
                })
                .child("Tạo phiên bản");
            let mut ordered = app.instances.clone();
            ordered.sort_by_key(|i| std::cmp::Reverse(i.last_played.clone().unwrap_or_else(|| i.created.clone().unwrap_or_default())));

            let body = if ordered.is_empty() {
                let view_create = view.clone();
                card(&theme)
                    .p(px(18.0))
                    .flex()
                    .items_center()
                    .gap(px(14.0))
                    .child(widgets::icon("cube", 22.0, theme.accent))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w(px(0.0))
                            .child(div().text_size(px(12.0)).font_weight(FontWeight::BOLD).text_color(theme.text).child("Chưa có phiên bản nào"))
                            .child(div().text_size(px(10.0)).text_color(theme.faint).child("Tạo phiên bản để bắt đầu chơi.")),
                    )
                    .child(
                        div()
                            .id("home-instances-empty-create")
                            .h(px(32.0))
                            .px(px(12.0))
                            .flex()
                            .items_center()
                            .rounded(px(8.0))
                            .bg(theme.accent)
                            .text_size(px(10.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(theme.on_accent)
                            .cursor_pointer()
                            .on_click(move |_, _, cx| {
                                let _ = view_create.update(cx, |this, cx| {
                                    crate::ui::pages::versions::open_versions(this, cx, None, None);
                                });
                            })
                            .child("Tạo phiên bản"),
                    )
                    .into_any_element()
            } else {
                let mut list = card(&theme).flex().flex_col();
                for (index, instance) in ordered.iter().enumerate() {
                    let icon_path = app.instance_icon_path(instance);
                    let loader = loader_image(&instance.loader);
                    let view_open = view.clone();
                    let view_play = view.clone();
                    let open_id = instance.id.clone();
                    let play_id = instance.id.clone();
                    let busy = matches!(instance.status.as_str(), "running" | "starting" | "stopping");
                    let color = status_color(&theme, &instance.status);
                    let meta = format!(
                        "{}{} · {} · {} MB",
                        loader_name(&instance.loader),
                        instance.loader_version.as_deref().filter(|v| !v.is_empty()).map(|v| format!(" {v}")).unwrap_or_default(),
                        instance.version,
                        instance.memory_mb
                    );
                    let last = instance.last_played.as_deref().map(crate::ui::pages::short_time).unwrap_or_else(|| "chưa chơi".into());
                    list = list.child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.0))
                            .h(px(48.0))
                            .px(px(14.0))
                            .when(index > 0, |el| el.border_t_1().border_color(theme.border))
                            .when_some(icon_path, |el, path| {
                                el.child(gpui::img(path).size(px(28.0)).rounded(px(6.0)).flex_shrink_0().object_fit(gpui::ObjectFit::Cover))
                            })
                            .when(instance_has_no_icon(&instance), |el| {
                                el.child(gpui::img(loader).size(px(28.0)).rounded(px(6.0)).flex_shrink_0().object_fit(gpui::ObjectFit::Contain))
                            })
                            .child(
                                div()
                                    .id(gpui::SharedString::from(format!("home-inst-open-{}", instance.id)))
                                    .flex()
                                    .flex_col()
                                    .flex_1()
                                    .min_w(px(0.0))
                                    .cursor_pointer()
                                    .on_click(move |_, _, cx| {
                                        let id = open_id.clone();
                                        let _ = view_open.update(cx, |this, cx| this.open_instance(id, cx));
                                    })
                                    .child(div().text_size(px(11.0)).font_weight(FontWeight::BOLD).text_color(theme.text).truncate().child(instance.name.clone()))
                                    .child(div().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).truncate().child(meta)),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(4.0))
                                    .flex_shrink_0()
                                    .child(widgets::icon("clock", 11.0, theme.faint))
                                    .child(div().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).child(last)),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(5.0))
                                    .h(px(20.0))
                                    .px(px(7.0))
                                    .rounded(px(6.0))
                                    .bg(gpui::Rgba { a: 0.14, ..color })
                                    .text_size(px(9.5))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(color)
                                    .flex_shrink_0()
                                    .child(div().size(px(5.0)).rounded_full().bg(color))
                                    .child(crate::ui::pages::status_text(&instance.status)),
                            )
                            .child(
                                div()
                                    .id(gpui::SharedString::from(format!("home-inst-play-{}", instance.id)))
                                    .size(px(32.0))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .rounded(px(8.0))
                                    .bg(if busy { gpui::rgba(0xef444424) } else { gpui::rgba(0x22c55e24) })
                                    .cursor_pointer()
                                    .when(instance.status == "installing", |el| el.opacity(0.4))
                                    .on_click(move |_, _, cx| {
                                        let id = play_id.clone();
                                        let _ = view_play.update(cx, |this, cx| this.play_instance(&id, cx));
                                    })
                                    .child(widgets::icon(
                                        if busy { "stop-fill" } else { "play-fill" },
                                        13.0,
                                        if busy { gpui::rgb(0xef4444) } else { gpui::rgb(0x22c55e) },
                                    )),
                            ),
                    );
                }
                list.into_any_element()
            };

            content = content.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(10.0))
                    .child(section_header(&theme, "Phiên bản của bạn", format!("{count} phiên bản"), Some(create_button.into_any_element())))
                    .child(body),
            );
        }
        "system" => {
            let total_mem = app.system.get("totalMem").and_then(Value::as_u64).unwrap_or(0);
            let free_mem = app.system.get("freeMem").and_then(Value::as_u64).unwrap_or(0);
            let used_mem = total_mem.saturating_sub(free_mem);
            let disk_total = app.system.pointer("/disk/total").and_then(Value::as_u64).unwrap_or(0);
            let disk_free = app.system.pointer("/disk/free").and_then(Value::as_u64).unwrap_or(0);
            let cpu = app.system.get("cpuModel").and_then(Value::as_str).unwrap_or("CPU").to_string();
            let threads = app.system.get("cpuThreads").and_then(Value::as_u64).unwrap_or(0);
            let platform = app.system.get("platform").and_then(Value::as_str).unwrap_or("—").to_string();
            let arch = app.system.get("arch").and_then(Value::as_str).unwrap_or("—").to_string();
            let cache = app.system.get("cacheBytes").and_then(Value::as_u64).unwrap_or(0);
            let shared = app.backend.store.shared_dir().to_string_lossy().into_owned();
            let installed = app.settings_ui.runtimes.iter().filter(|r| r.get("installed").and_then(Value::as_bool).unwrap_or(false)).count();
            let runtime_bytes: u64 = app.settings_ui.runtimes.iter().filter(|r| r.get("installed").and_then(Value::as_bool).unwrap_or(false)).filter_map(|r| r.get("bytes").and_then(Value::as_u64)).sum();
            let shared_for_click = shared.clone();

            let left = card(&theme)
                .p(px(16.0))
                .flex()
                .flex_col()
                .gap(px(14.0))
                .flex_1()
                .min_w(px(0.0))
                .child(meter_row(&theme, "RAM", used_mem, total_mem, theme.accent))
                .child(meter_row(&theme, "Ổ đĩa", disk_total.saturating_sub(disk_free), disk_total, theme.ok))
                .child(div().h(px(1.0)).w_full().bg(theme.border))
                .child(fact_row(&theme, "CPU", format!("{threads} nhân")))
                .child(fact_row(&theme, "Kiến trúc", format!("{platform} {arch}")))
                .child(div().text_size(px(9.0)).font_family(MONO).text_color(theme.faint).truncate().child(cpu));

            let right = card(&theme)
                .p(px(16.0))
                .flex()
                .flex_col()
                .gap(px(10.0))
                .flex_1()
                .min_w(px(0.0))
                .child(fact_row(&theme, "Thư mục chung", shared.clone()))
                .child(fact_row(&theme, "Dung lượng tài nguyên", format_bytes(cache)))
                .child(fact_row(&theme, "Java", format!("{installed} bản · {}", format_bytes(runtime_bytes))))
                .child(fact_row(&theme, "Java mặc định", "Java tải kèm".into()))
                .child(div().flex_1())
                .child(
                    div()
                        .id("home-open-shared")
                        .h(px(32.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .gap(px(6.0))
                        .rounded(px(8.0))
                        .bg(theme.elevated)
                        .border_1()
                        .border_color(theme.border)
                        .text_size(px(10.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.muted)
                        .cursor_pointer()
                        .hover(|st| st.bg(theme.surface_hover).text_color(theme.text))
                        .on_click(move |_, _, _cx| {
                            let _ = open::that(&shared_for_click);
                        })
                        .child(widgets::icon("folder-open", 12.0, theme.muted))
                        .child("Mở thư mục"),
                );

            content = content.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(10.0))
                    .child(section_header(&theme, "Hệ thống & lưu trữ", String::new(), None))
                    .child(div().flex().gap(px(12.0)).items_start().child(left).child(right)),
            );
        }
        _ => {
            let active_id = active.as_ref().map(|i| i.id.clone());
            let active_status = active.as_ref().map(|i| i.status.clone()).unwrap_or_default();
            let starting = active_status == "starting";
            let running = active_status == "running";
            let installing = active_status == "installing";
            let view_play = view.clone();
            let view_open = view.clone();
            let view_create = view.clone();
            let view_all = view.clone();
            let play_id = active_id.clone();
            let open_id = active_id.clone();
            let has_active = active.is_some();
            let active_name = active.as_ref().map(|i| i.name.clone()).unwrap_or_else(|| "Chưa có phiên bản nào".into());
            let active_loader = active.as_ref().map(|i| {
                let base = loader_name(&i.loader);
                match i.loader_version.as_deref() {
                    Some(version) if !version.is_empty() => format!("{base} {version}"),
                    _ => base.to_string(),
                }
            }).unwrap_or_default();
            let active_version = active.as_ref().map(|i| i.version.clone()).unwrap_or_default();
            let active_memory = active.as_ref().map(|i| i.memory_mb).unwrap_or(0);
            let active_playtime = active.as_ref().map(|i| i.playtime_ms).unwrap_or(0);
            let active_last = active.as_ref().and_then(|i| i.last_played.clone()).map(|value| crate::ui::pages::short_time(&value)).unwrap_or_else(|| "chưa chơi".into());
            let play_bg = if starting || installing { gpui::rgb(0xeab308) } else if running { gpui::rgb(0xef4444) } else { gpui::rgb(0x22c55e) };
            let play_letter = if starting || installing { gpui::rgb(0x1a1405) } else if running { gpui::white().into() } else { gpui::rgb(0x04140a) };
            let spinner = || {
                gpui::svg()
                    .path(widgets::icon_source("arrows-clockwise"))
                    .size(px(30.0))
                    .text_color(play_letter)
                    .with_animation(
                        "hero-spin",
                        gpui::Animation::new(std::time::Duration::from_millis(900)).repeat(),
                        |el, t| el.with_transformation(gpui::Transformation::rotate(gpui::radians(t * std::f32::consts::TAU))),
                    )
            };
            let hero = div()
                .relative()
                .flex()
                .flex_col()
                .rounded(px(12.0))
                .overflow_hidden()
                .border_1()
                .border_color(theme.border)
                .child(gpui::img(crate::ui::assets::image_path("background.png")).absolute().inset_0().size_full().object_fit(gpui::ObjectFit::Cover))
                .child(
                    div()
                        .absolute()
                        .inset_0()
                        .bg(gpui::linear_gradient(
                            100.0,
                            gpui::linear_color_stop(gpui::rgba(0x000000f2), 0.0),
                            gpui::linear_color_stop(gpui::rgba(0x0000006b), 1.0),
                        )),
                )
                .child(
                    div()
                        .relative()
                        .flex()
                        .flex_col()
                        .gap(px(16.0))
                        .p(px(20.0))
                        .when(has_active, |el| {
                            el.child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(16.0))
                                    .child(
                                        div()
                                            .id("home-hero-play")
                                            .size(px(84.0))
                                            .flex_shrink_0()
                                            .relative()
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .rounded(px(16.0))
                                            .bg(play_bg)
                                            .border_2()
                                            .border_color(play_bg)
                                            .cursor_pointer()
                                            .hover(|st| st.opacity(0.94))
                                            .on_click(move |_, _, cx| {
                                                let id = play_id.clone();
                                                let _ = view_play.update(cx, |this, cx| {
                                                    if let Some(id) = id {
                                                        this.play_instance(&id, cx);
                                                    }
                                                });
                                            })
                                            .when(running, |el| el.child(widgets::icon("stop-fill", 34.0, gpui::white().into())))
                                            .when(starting || installing, |el| el.child(spinner()))
                                            .when(!running && !starting && !installing, |el| el.child(widgets::icon("play-fill", 38.0, play_letter)))
                                            .when(starting || installing, |el| {
                                                el.child(
                                                    div()
                                                        .absolute()
                                                        .inset_0()
                                                        .rounded(px(16.0))
                                                        .bg(gpui::rgba(0xeab30859))
                                                        .with_animation(
                                                            "hero-launch-pulse",
                                                            gpui::Animation::new(std::time::Duration::from_millis(1200)).repeat(),
                                                            |el, t| el.opacity(0.08 + 0.32 * (1.0 - t)),
                                                        ),
                                                )
                                            }),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap(px(6.0))
                                            .flex_1()
                                            .min_w(px(0.0))
                                            .child(
                                                div()
                                                    .flex()
                                                    .items_center()
                                                    .gap_2()
                                                    .child(div().size(px(6.0)).rounded_full().bg(status_color(&theme, &active_status)))
                                                    .child(div().text_size(px(10.0)).font_weight(FontWeight::SEMIBOLD).text_color(gpui::rgba(0xffffff99)).child(status_label(&active_status))),
                                            )
                                            .child(div().text_size(px(24.0)).font_weight(FontWeight::BOLD).text_color(gpui::white()).truncate().child(active_name.clone()))
                                            .child(
                                                div()
                                                    .flex()
                                                    .items_center()
                                                    .gap(px(6.0))
                                                    .flex_wrap()
                                                    .child(chip(active_loader.clone(), false))
                                                    .child(chip(active_version.clone(), false))
                                                    .child(chip(format!("{active_memory} MB"), false))
                                                    .when(starting, |el| el.child(chip("đang nạp game…".into(), true))),
                                            )
                                            .when(active_progress.is_some() || !active_error.is_empty(), |el| {
                                                let text = if active_error.is_empty() {
                                                    active_progress.as_ref().map(|(label, _, _, _)| label.clone()).unwrap_or_default()
                                                } else {
                                                    active_error.clone()
                                                };
                                                el.child(div().text_size(px(10.0)).font_family(MONO).text_color(if active_error.is_empty() { gpui::rgba(0xffffffb3) } else { gpui::rgb(0xf87171) }).truncate().child(text))
                                            }),
                                    )
                                    .child(
                                        div()
                                            .id("home-hero-open")
                                            .h(px(34.0))
                                            .px(px(14.0))
                                            .flex()
                                            .items_center()
                                            .rounded(px(8.0))
                                            .bg(gpui::rgba(0xffffff29))
                                            .border_1()
                                            .border_color(gpui::rgba(0xffffff33))
                                            .text_size(px(11.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(gpui::white())
                                            .cursor_pointer()
                                            .on_click(move |_, _, cx| {
                                                let id = open_id.clone();
                                                let _ = view_open.update(cx, |this, cx| {
                                                    if let Some(id) = id {
                                                        this.open_instance(id, cx);
                                                    }
                                                });
                                            })
                                            .child("Mở"),
                                    ),
                            )
                        })
                        .when(!has_active, |el| {
                            el.child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(20.0))
                                    .py(px(12.0))
                                    .child(
                                        div()
                                            .size(px(80.0))
                                            .rounded(px(16.0))
                                            .bg(gpui::rgba(0xffffff1a))
                                            .border_1()
                                            .border_color(gpui::rgba(0xffffff29))
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .child(widgets::icon("cube", 30.0, gpui::white().into())),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap(px(4.0))
                                            .flex_1()
                                            .min_w(px(0.0))
                                            .child(div().text_size(px(20.0)).font_weight(FontWeight::BOLD).text_color(gpui::white()).child("Chưa có phiên bản nào"))
                                            .child(div().text_size(px(12.0)).text_color(gpui::rgba(0xffffffa8)).child(format!("Tạo phiên bản từ Minecraft {} để bắt đầu chơi.", if latest_release.is_empty() { "—" } else { &latest_release })))
                                            .child(div().text_size(px(10.0)).font_family(MONO).text_color(gpui::rgba(0xffffff80)).child(format!("{} bản phát hành · 6 trình tải sẵn sàng", app.versions.len()))),
                                    )
                                    .child(
                                        div()
                                            .id("home-hero-create")
                                            .h(px(40.0))
                                            .px(px(16.0))
                                            .flex()
                                            .items_center()
                                            .rounded(px(8.0))
                                            .bg(gpui::rgba(0xfffffff0))
                                            .text_size(px(12.0))
                                            .font_weight(FontWeight::BOLD)
                                            .text_color(gpui::rgb(0x111111))
                                            .cursor_pointer()
                                            .hover(|st| st.bg(gpui::white()))
                                            .on_click(move |_, _, cx| {
                                                let _ = view_create.update(cx, |this, cx| {
                                                    crate::ui::pages::versions::open_versions(this, cx, None, None);
                                                });
                                            })
                                            .child("Tạo phiên bản"),
                                    ),
                            )
                        })
                        .when(has_active, |el| {
                            el.child(div().h(px(1.0)).w_full().bg(gpui::rgba(0xffffff1f)))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(28.0))
                                        .flex_wrap()
                                        .child(stat_white("memory", "RAM", format!("{active_memory} MB")))
                                        .child(stat_white("cube", "Trình tải", active_loader.clone()))
                                        .child(stat_white("clock", "Thời gian chơi", format_playtime(active_playtime)))
                                        .child(stat_white("calendar-blank", "Lần chơi cuối", active_last.clone())),
                                )
                        }),
                );

            let mut loader_rows = div().flex().flex_col().gap(px(2.0));
            for (kind, name, _) in LOADERS {
                if kind == "vanilla" {
                    continue;
                }
                let info = app.home_loaders.get(kind).cloned().unwrap_or(Value::Null);
                let supported = info.get("supported").and_then(Value::as_bool).unwrap_or(false);
                let build = info.get("build").cloned().unwrap_or(Value::Null);
                let games = info.get("games").and_then(Value::as_u64).unwrap_or(0);
                let build_text = match build {
                    Value::String(text) => text,
                    Value::Number(number) => number.to_string(),
                    _ => "—".into(),
                };
                loader_rows = loader_rows.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(10.0))
                        .h(px(28.0))
                        .child(gpui::img(loader_image(kind)).size(px(16.0)).object_fit(gpui::ObjectFit::Contain))
                        .child(div().w(px(72.0)).flex_shrink_0().text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text).child(name))
                        .when(supported, |el| {
                            el.child(widgets::icon("check", 11.0, gpui::rgb(0x22c55e)))
                                .child(div().text_size(px(11.0)).font_family(MONO).text_color(theme.muted).child(build_text.clone()))
                        })
                        .when(!supported, |el| {
                            el.child(widgets::icon("minus", 11.0, theme.faint))
                                .child(div().text_size(px(10.0)).text_color(theme.faint).child("chưa phát hành cho bản này"))
                        })
                        .when(games > 0, |el| {
                            el.child(div().ml_auto().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).child(format!("{games} phiên bản")))
                        }),
                );
            }
            let view_create_latest = view.clone();
            let latest_for_button = latest_release.clone();
            let released_line = match latest_row.as_ref() {
                Some(row) if !row.release_time.is_empty() => {
                    let ago = time_ago(&row.release_time);
                    if ago.is_empty() {
                        format!("Phát hành {}", date_of(&row.release_time))
                    } else {
                        format!("Phát hành {} · {}", date_of(&row.release_time), ago)
                    }
                }
                _ => "Phát hành —".to_string(),
            };
            let latest_card = card(&theme)
                .flex()
                .flex_col()
                .gap(px(14.0))
                .p(px(16.0))
                .child(
                    div()
                        .flex()
                        .items_start()
                        .gap(px(14.0))
                        .child(
                            div()
                                .size(px(48.0))
                                .rounded(px(12.0))
                                .bg(theme.elevated)
                                .border_1()
                                .border_color(theme.border)
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(gpui::img(loader_image("vanilla")).size(px(32.0)).object_fit(gpui::ObjectFit::Contain)),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(5.0))
                                .flex_1()
                                .min_w(px(0.0))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(8.0))
                                        .child(div().text_size(px(20.0)).font_family(MONO).font_weight(FontWeight::BOLD).text_color(theme.text).child(if latest_release.is_empty() { "—".into() } else { latest_release.clone() }))
                                        .child(div().h(px(18.0)).px(px(6.0)).flex().items_center().rounded(px(4.0)).bg(theme.accent_dim).text_size(px(8.5)).font_weight(FontWeight::BOLD).text_color(theme.accent_soft).child("MỚI NHẤT")),
                                )
                                .child(div().text_size(px(11.0)).text_color(theme.muted).truncate().child(released_line))
                                .when(!snapshot.is_empty(), |el| {
                                    el.child(div().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).child(format!("Bản thử nghiệm: {snapshot}")))
                                }),
                        ),
                )
                .child(div().h(px(1.0)).w_full().bg(theme.border))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(2.0))
                        .child(div().text_size(px(9.5)).font_weight(FontWeight::SEMIBOLD).text_color(theme.faint).mb(px(4.0)).child("TRÌNH TẢI HỖ TRỢ BẢN NÀY"))
                        .child(loader_rows),
                )
                .child(
                    div()
                        .id("home-create-latest")
                        .h(px(36.0))
                        .w_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(8.0))
                        .bg(theme.accent)
                        .text_size(px(11.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.on_accent)
                        .cursor_pointer()
                        .hover(|st| st.bg(theme.accent_hover))
                        .on_click(move |_, _, cx| {
                            let game = latest_for_button.clone();
                            let _ = view_create_latest.update(cx, |this, cx| {
                                crate::ui::pages::versions::open_versions(this, cx, None, Some(game.clone()));
                            });
                        })
                        .child(format!("Tạo phiên bản với {latest_release}")),
                );

            let releases_len = app.versions.len();
            let mut timeline = card(&theme).p(px(8.0)).flex().flex_col();
            for (index, row) in app.versions.iter().take(9).enumerate() {
                let is_latest = index == 0;
                let last = index + 1 >= app.versions.len().min(9);
                timeline = timeline.child(
                    div()
                        .relative()
                        .flex()
                        .items_center()
                        .gap(px(10.0))
                        .h(px(32.0))
                        .px(px(8.0))
                        .rounded(px(8.0))
                        .when(is_latest, |el| el.bg(theme.elevated))
                        .when(!last, |el| {
                            el.child(div().absolute().left(px(13.5)).top(px(16.0)).h(px(32.0)).w(px(1.0)).bg(theme.border_soft))
                        })
                        .child(div().ml(px(3.0)).size(px(6.0)).flex_shrink_0().rounded_full().bg(if is_latest { theme.accent } else { theme.faint }))
                        .child(div().w(px(74.0)).flex_shrink_0().text_size(px(11.0)).font_family(MONO).font_weight(FontWeight::BOLD).text_color(if is_latest { theme.accent_soft } else { theme.text }).child(row.id.clone()))
                        .child(div().flex_shrink_0().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).child(date_of(&row.release_time)))
                        .child(div().ml_auto().flex_shrink_0().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).child(time_ago(&row.release_time))),
                );
            }

            let view_all_button = div()
                .id("home-releases-all")
                .flex()
                .items_center()
                .gap(px(4.0))
                .flex_shrink_0()
                .text_size(px(10.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.accent_soft)
                .cursor_pointer()
                .hover(|st| st.opacity(0.8))
                .on_click(move |_, _, cx| {
                    let _ = view_all.update(cx, |this, cx| {
                        crate::ui::pages::versions::open_versions(this, cx, None, None);
                    });
                })
                .child("Xem tất cả")
                .child(widgets::icon("arrow-right", 11.0, theme.accent_soft));

            let mut loader_grid = div().flex().gap(px(12.0)).flex_wrap();
            for (kind, name, desc) in LOADERS {
                let info = app.home_loaders.get(kind).cloned().unwrap_or(Value::Null);
                let supported = info.get("supported").and_then(Value::as_bool).unwrap_or(false);
                let vanilla = info.get("vanilla").and_then(Value::as_bool).unwrap_or(kind == "vanilla");
                let stable = info.get("stable").and_then(Value::as_bool).unwrap_or(false);
                let build = info.get("build").cloned().unwrap_or(Value::Null);
                let view_loader = view.clone();
                let kind_owned = kind.to_string();
                let build_text = match build {
                    Value::String(text) => text,
                    Value::Number(number) => number.to_string(),
                    _ => "—".into(),
                };
                let (status_text, status_color) = if vanilla {
                    ("bản gốc".to_string(), theme.faint)
                } else if !supported {
                    ("không có build".to_string(), theme.faint)
                } else if stable {
                    ("ổn định".to_string(), gpui::rgb(0x22c55e))
                } else {
                    ("thử nghiệm".to_string(), gpui::rgb(0xeab308))
                };
                loader_grid = loader_grid.child(
                    div()
                        .id(gpui::SharedString::from(format!("home-loader-{kind}")))
                        .flex()
                        .items_start()
                        .gap(px(12.0))
                        .w(px(300.0))
                        .flex_grow()
                        .p(px(14.0))
                        .rounded(px(12.0))
                        .bg(theme.surface)
                        .border_1()
                        .border_color(theme.border)
                        .cursor_pointer()
                        .hover(|st| st.bg(theme.surface_hover))
                        .on_click(move |_, _, cx| {
                            let kind = kind_owned.clone();
                            let _ = view_loader.update(cx, |this, cx| {
                                crate::ui::pages::versions::open_versions(this, cx, Some(kind.clone()), None);
                            });
                        })
                        .child(
                            div()
                                .size(px(36.0))
                                .flex_shrink_0()
                                .rounded(px(9.0))
                                .bg(theme.elevated)
                                .border_1()
                                .border_color(theme.border)
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(gpui::img(loader_image(kind)).size(px(24.0)).object_fit(gpui::ObjectFit::Contain)),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w(px(0.0))
                                .child(div().text_size(px(12.0)).font_weight(FontWeight::BOLD).text_color(theme.text).child(name))
                                .child(div().text_size(px(10.0)).text_color(theme.faint).truncate().child(desc))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(4.0))
                                        .mt(px(6.0))
                                        .text_size(px(10.0))
                                        .font_family(MONO)
                                        .text_color(theme.muted)
                                        .when(supported, |el| el.child(build_text))
                                        .child(div().text_color(theme.faint).child(" · "))
                                        .child(div().text_color(status_color).child(status_text)),
                                ),
                        ),
                );
            }

            content = content
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(10.0))
                        .child(section_header(&theme, "Sẵn sàng chơi", if running_count > 0 { format!("{running_count} đang chạy") } else { "không có tiến trình".into() }, None))
                        .child(hero),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(10.0))
                        .child(section_header(&theme, "Bản phát hành", format!("{releases_len} bản"), Some(view_all_button.into_any_element())))
                        .child(
                            div()
                                .flex()
                                .gap(px(12.0))
                                .items_start()
                                .child(div().flex_1().min_w(px(0.0)).child(latest_card))
                                .child(div().w(px(460.0)).flex_shrink_0().child(timeline)),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(10.0))
                        .child(section_header(&theme, "Trình tải mod", format!("bản mới nhất cho {}", if latest_release.is_empty() { "—" } else { &latest_release }), None))
                        .child(loader_grid),
                );
        }
    }

    let root_height = (f32::from(window.bounds().size.height) - 44.0).max(240.0);
    div()
        .flex()
        .flex_col()
        .h(px(root_height))
        .min_h(px(0.0))
        .w_full()
        .child(header)
        .child(tab_strip)
        .child(
            div()
                .id("home-scroll")
                .flex_1()
                .min_h(px(0.0))
                .overflow_y_scroll()
                .track_scroll(&app.home_scroll)
                .p(px(24.0))
                .child(div().max_w(px(1024.0)).mx_auto().w_full().child(content)),
        )
        .into_any_element()
}

fn instance_has_no_icon(instance: &Instance) -> bool {
    instance
        .icon
        .as_deref()
        .map(|icon| icon.trim().is_empty() || !std::path::Path::new(icon).is_file())
        .unwrap_or(true)
}
