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

fn loader_image(id: &str) -> String {
    crate::ui::assets::image_path(&format!("loader-icon/{id}.png"))
        .to_string_lossy()
        .into_owned()
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
    app.home_loaders = json!({"vanilla": {"supported": true, "build": latest, "games": null}});
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

fn section(theme: &Theme, title: &str, hint: String) -> impl IntoElement {
    div()
        .flex()
        .items_end()
        .justify_between()
        .w_full()
        .child(
            div()
                .text_size(px(15.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.text)
                .child(title.to_string()),
        )
        .child(div().text_size(px(11.0)).text_color(theme.faint).child(hint))
}

fn chip(label: String, dim: bool) -> impl IntoElement {
    div()
        .h(px(21.0))
        .px(px(8.0))
        .flex()
        .items_center()
        .rounded(px(6.0))
        .bg(if dim { gpui::rgba(0xffffff14) } else { gpui::rgba(0xffffff24) })
        .text_size(px(10.0))
        .font_weight(FontWeight::MEDIUM)
        .text_color(if dim { gpui::rgba(0xffffffa8) } else { gpui::rgba(0xffffffee) })
        .child(label)
}

fn meter(theme: &Theme, label: &str, value: String, hint: String, percent: f32, color: gpui::Rgba) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap_2()
        .flex_1()
        .p(px(14.0))
        .rounded(px(RADIUS))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft)
        .child(
            div()
                .flex()
                .justify_between()
                .text_size(px(10.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.faint)
                .child(label.to_uppercase())
                .child(hint),
        )
        .child(
            div()
                .text_size(px(17.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.text)
                .child(value),
        )
        .child(
            div()
                .h(px(5.0))
                .w_full()
                .rounded_full()
                .bg(theme.surface_active)
                .truncate()
                .child(
                    div()
                        .h_full()
                        .w(gpui::relative((percent / 100.0).clamp(0.0, 1.0)))
                        .rounded_full()
                        .bg(color),
                ),
        )
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

fn pages_empty(theme: &Theme, title: &str, hint: &str) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .items_center()
        .gap(px(4.0))
        .py(px(28.0))
        .w_full()
        .child(div().text_size(px(12.0)).font_weight(FontWeight::MEDIUM).text_color(theme.muted).child(title.to_string()))
        .child(div().text_size(px(10.5)).text_color(theme.faint).child(hint.to_string()))
}

fn recent_row(theme: &Theme, icon_name: &str, title: String, instance: String, played: &str) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .gap(px(10.0))
        .h(px(38.0))
        .px(px(8.0))
        .rounded(px(6.0))
        .hover(|st| st.bg(theme.surface_hover))
        .child(widgets::icon(icon_name, 14.0, theme.faint))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w(px(0.0))
                .child(div().text_size(px(11.5)).font_weight(FontWeight::MEDIUM).text_color(theme.text).truncate().child(title))
                .child(div().text_size(px(9.5)).text_color(theme.faint).child(instance)),
        )
        .when(!played.is_empty(), |el| {
            el.child(div().text_size(px(9.5)).font_family(MONO).text_color(theme.faint).child(crate::ui::pages::short_time(played)))
        })
}

fn system_row(theme: &Theme, label: &str, value: &str) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .justify_between()
        .gap_4()
        .child(div().text_size(px(11.0)).text_color(theme.faint).child(label.to_string()))
        .child(div().text_size(px(11.0)).font_family(MONO).text_color(theme.muted).child(value.to_string()))
}

pub fn render(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
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

    let view_tab = view.clone();
    let view_theme = view.clone();
    let view_versions = view.clone();
    let tabs = [("overview", "Tổng quan"), ("recent", "Chơi gần đây"), ("instances", "Phiên bản"), ("system", "Hệ thống")];
    let mut tab_row = div().flex().items_center().gap(px(6.0));
    for (key, label) in tabs {
        let active_tab = app.home_tab == key;
        let view = view_tab.clone();
        let key = key.to_string();
        tab_row = tab_row.child(
            div()
                .id(gpui::SharedString::from(format!("home-tab-{key}")))
                .h(px(30.0))
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
                    let _ = view.update(cx, |this, cx| {
                        this.home_tab = key;
                        cx.notify();
                    });
                })
                .child(label.to_string()),
        );
    }

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
                .child(div().text_size(px(22.0)).font_weight(FontWeight::BOLD).text_color(theme.text).child("Trang chủ"))
                .child(
                    div()
                        .text_size(px(11.5))
                        .text_color(theme.faint)
                        .child(format!(
                            "{} bản phát hành · {} phiên bản đã tạo · mới nhất {}",
                            app.versions.len(),
                            app.instances.len(),
                            if latest_release.is_empty() { "—" } else { &latest_release }
                        )),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(
                    div()
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
                        .child(widgets::icon("arrow-right", 11.0, theme.faint)),
                )
                .child(
                    div()
                        .id("home-theme")
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(36.0))
                        .rounded(px(8.0))
                        .bg(theme.elevated)
                        .border_1()
                        .border_color(theme.border)
                        .cursor_pointer()
                        .hover(|st| st.opacity(0.8))
                        .on_click(move |_, _, cx| {
                            let _ = view_theme.update(cx, |this, cx| {
                                let next = if this.theme.dark { "light" } else { "dark" };
                                this.backend.settings_set(json!({"theme": next}));
                                this.refresh_settings();
                                cx.notify();
                            });
                        })
                        .child(widgets::icon(if theme.dark { "moon" } else { "sun" }, 15.0, theme.muted)),
                ),
        );

    let mut body = div()
        .flex()
        .flex_col()
        .gap(px(24.0))
        .p(px(24.0))
        .w_full()
        .min_w(px(0.0))
        .max_w(px(1024.0))
        .mx_auto()
        .child(header)
        .child(tab_row);

    match app.home_tab.as_str() {
        "recent" => {
            let mut worlds = Vec::new();
            let mut servers = Vec::new();
            for instance in &app.instances {
                for row in &instance.recent_worlds {
                    worlds.push((instance.clone(), row.clone()));
                }
                for row in &instance.recent_servers {
                    servers.push((instance.clone(), row.clone()));
                }
            }
            worlds.sort_by_key(|(_, row)| std::cmp::Reverse(row.get("playedAt").and_then(Value::as_str).unwrap_or("").to_string()));
            servers.sort_by_key(|(_, row)| std::cmp::Reverse(row.get("playedAt").and_then(Value::as_str).unwrap_or("").to_string()));
            let mut world_rows = div().flex().flex_col().gap(px(2.0));
            for (instance, row) in worlds.iter().take(8) {
                let name = row.get("name").and_then(Value::as_str).or_else(|| row.get("folder").and_then(Value::as_str)).unwrap_or("World").to_string();
                let played = row.get("playedAt").and_then(Value::as_str).unwrap_or("");
                world_rows = world_rows.child(recent_row(&theme, "archive", name, instance.name.clone(), played));
            }
            if worlds.is_empty() {
                world_rows = world_rows.child(pages_empty(&theme, "Chưa có thế giới nào", "Vào game tạo thế giới, launcher sẽ ghi nhớ tại đây."));
            }
            let mut server_rows = div().flex().flex_col().gap(px(2.0));
            for (instance, row) in servers.iter().take(8) {
                let host = row.get("host").and_then(Value::as_str).unwrap_or("");
                let port = row.get("port").and_then(Value::as_u64).unwrap_or(25565);
                let played = row.get("playedAt").and_then(Value::as_str).unwrap_or("");
                server_rows = server_rows.child(recent_row(&theme, "network", format!("{host}:{port}"), instance.name.clone(), played));
            }
            if servers.is_empty() {
                server_rows = server_rows.child(pages_empty(&theme, "Chưa có server nào", "Server bạn tham gia sẽ hiện ở đây."));
            }
            body = body
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .child(section(&theme, "Thế giới gần đây", format!("{} mục", worlds.len())))
                        .child(div().flex().flex_col().p(px(10.0)).rounded(px(RADIUS)).bg(theme.surface).border_1().border_color(theme.border_soft).child(world_rows)),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .child(section(&theme, "Server gần đây", format!("{} mục", servers.len())))
                        .child(div().flex().flex_col().p(px(10.0)).rounded(px(RADIUS)).bg(theme.surface).border_1().border_color(theme.border_soft).child(server_rows)),
                );
        }
        "instances" => {
            let view_create = view.clone();
            let mut grid = div().flex().gap_3().flex_wrap();
            if app.instances.is_empty() {
                grid = grid.child(div().w_full().child(pages_empty(&theme, "Chưa có phiên bản nào", "Tạo phiên bản Vanilla, Fabric hay Forge để bắt đầu.")));
            }
            for instance in app.instances.iter().take(12).cloned().collect::<Vec<_>>() {
                grid = grid.child(div().w(px(320.0)).flex_grow().child(app.instance_card(&instance, cx, false)));
            }
            body = body
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(section(&theme, "Phiên bản đã tạo", format!("{} phiên bản", app.instances.len())))
                        .child(widgets::button("home-create-instance", "Tạo phiên bản", &theme, true, move |_, _, cx| {
                            let _ = view_create.update(cx, |this, cx| {
                                crate::ui::pages::versions::open_versions(this, cx, None, None);
                            });
                        })),
                )
                .child(grid);
        }
        "system" => {
            let total_mem = app.system.get("totalMem").and_then(Value::as_u64).unwrap_or(0);
            let free_mem = app.system.get("freeMem").and_then(Value::as_u64).unwrap_or(0);
            let used_mem = total_mem.saturating_sub(free_mem);
            let disk_total = app.system.pointer("/disk/total").and_then(Value::as_u64).unwrap_or(0);
            let disk_free = app.system.pointer("/disk/free").and_then(Value::as_u64).unwrap_or(0);
            let cpu = app.system.get("cpuModel").and_then(Value::as_str).unwrap_or("CPU");
            let threads = app.system.get("cpuThreads").and_then(Value::as_u64).unwrap_or(0);
            let cache = app.system.get("cacheBytes").and_then(Value::as_u64).unwrap_or(0);
            let shared = app.backend.store.shared_dir().to_string_lossy().into_owned();
            let installed = app.settings_ui.runtimes.iter().filter(|r| r.get("installed").and_then(Value::as_bool).unwrap_or(false)).count();
            let runtime_bytes: u64 = app.settings_ui.runtimes.iter().filter(|r| r.get("installed").and_then(Value::as_bool).unwrap_or(false)).filter_map(|r| r.get("bytes").and_then(Value::as_u64)).sum();
            body = body
                .child(
                    div()
                        .flex()
                        .gap_3()
                        .child(meter(&theme, "RAM", format!("{} / {}", format_bytes(used_mem), format_bytes(total_mem.max(1))), format!("{}%", if total_mem > 0 { used_mem * 100 / total_mem } else { 0 }), if total_mem > 0 { used_mem as f32 / total_mem as f32 * 100.0 } else { 0.0 }, theme.accent))
                        .child(meter(&theme, "Ổ đĩa", format!("{} trống", format_bytes(disk_free)), format!("/ {}", format_bytes(disk_total)), if disk_total > 0 { (disk_total.saturating_sub(disk_free)) as f32 / disk_total as f32 * 100.0 } else { 0.0 }, theme.ok))
                        .child(meter(&theme, "CPU", format!("{threads} nhân"), cpu.chars().take(26).collect::<String>(), 0.0, theme.accent_soft)),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .p(px(16.0))
                        .rounded(px(RADIUS))
                        .bg(theme.surface)
                        .border_1()
                        .border_color(theme.border_soft)
                        .child(section(&theme, "Chi tiết", String::new()))
                        .child(system_row(&theme, "CPU", cpu))
                        .child(system_row(&theme, "Số luồng", &threads.to_string()))
                        .child(system_row(&theme, "RAM", &format!("{} / {}", format_bytes(used_mem), format_bytes(total_mem))))
                        .child(system_row(&theme, "Ổ đĩa", &format!("{} trống / {}", format_bytes(disk_free), format_bytes(disk_total))))
                        .child(system_row(&theme, "Java đã tải", &format!("{installed} bản · {}", format_bytes(runtime_bytes))))
                        .child(system_row(&theme, "Bộ nhớ đệm", &format_bytes(cache)))
                        .child(system_row(&theme, "Thư mục dùng chung", &shared)),
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
            let status_label = match active_status.as_str() {
                "running" => "ĐANG CHƠI",
                "starting" => "ĐANG KHỞI ĐỘNG",
                "installing" => "ĐANG CÀI ĐẶT",
                "stopping" => "ĐANG DỪNG",
                "error" => "GẶP LỖI",
                _ => "SẴN SÀNG",
            };
            let play_bg = if starting || installing { gpui::rgb(0xeab308) } else if running { gpui::rgb(0xef4444) } else { gpui::rgb(0x22c55e) };
            let play_icon = if running { "stop-fill" } else if starting || installing { "arrows-clockwise" } else { "play-fill" };
            let hero = div()
                .relative()
                .flex()
                .flex_col()
                .gap(px(16.0))
                .p(px(20.0))
                .rounded(px(12.0))
                .truncate()
                .border_1()
                .border_color(theme.border)
                .bg(theme.surface)
                .child(gpui::img(crate::ui::assets::image_path("background.png")).absolute().inset_0().size_full().object_fit(gpui::ObjectFit::Cover))
                .child(div().absolute().inset_0().bg(gpui::rgba(0x000000e0)))
                .child(
                    div()
                        .relative()
                        .flex()
                        .flex_col()
                        .gap(px(16.0))
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
                                            .cursor_pointer()
                                            .hover(|st| st.opacity(0.92))
                                            .on_click(move |_, _, cx| {
                                                let id = play_id.clone();
                                                let _ = view_play.update(cx, |this, cx| {
                                                    if let Some(id) = id {
                                                        this.play_instance(&id, cx);
                                                    }
                                                });
                                            })
                                            .child(widgets::icon(play_icon, if running { 30.0 } else { 34.0 }, if running { gpui::white().into() } else { gpui::rgb(0x04140a) }))
                                            .when(starting || installing, |el| {
                                                el.child(
                                                    div()
                                                        .absolute()
                                                        .inset_0()
                                                        .rounded(px(16.0))
                                                        .bg(gpui::rgba(0xeab30866))
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
                                                    .child(div().size(px(6.0)).rounded_full().bg(match active_status.as_str() {
                                                        "running" => gpui::rgb(0x22c55e),
                                                        "starting" | "installing" => gpui::rgb(0xeab308),
                                                        "error" => gpui::rgb(0xf87171),
                                                        _ => gpui::rgba(0xffffff88),
                                                    }))
                                                    .child(div().text_size(px(9.5)).font_weight(FontWeight::SEMIBOLD).text_color(gpui::rgba(0xffffff99)).child(status_label)),
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
                                                el.child(div().text_size(px(10.0)).font_family(MONO).text_color(if active_error.is_empty() { gpui::rgba(0xffffffb3) } else { gpui::rgb(0xf87171) }).child(text))
                                            }),
                                    )
                                    .when(has_active, |el| {
                                        el.child(
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
                                        )
                                    }),
                            )
                        })
                        .when(!has_active, |el| {
                            el.child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(20.0))
                                    .child(div().size(px(80.0)).rounded(px(16.0)).bg(gpui::rgba(0xffffff1a)).flex().items_center().justify_center().child(widgets::icon("cube", 30.0, gpui::white().into())))
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap(px(4.0))
                                            .flex_1()
                                            .child(div().text_size(px(20.0)).font_weight(FontWeight::BOLD).text_color(gpui::white()).child("Chưa có phiên bản nào"))
                                            .child(div().text_size(px(12.0)).text_color(gpui::rgba(0xffffffa8)).child(format!("Tạo phiên bản từ Minecraft {} để bắt đầu chơi.", if latest_release.is_empty() { "—" } else { &latest_release })))
                                            .child(div().text_size(px(10.0)).font_family(MONO).text_color(gpui::rgba(0xffffff80)).child(format!("{} bản phát hành · 6 trình tải sẵn sàng", app.versions.len()))),
                                    )
                                    .child(widgets::button("home-hero-create", "Tạo phiên bản", &theme, true, move |_, _, cx| {
                                        let _ = view_create.update(cx, |this, cx| {
                                            crate::ui::pages::versions::open_versions(this, cx, None, None);
                                        });
                                    })),
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

            let mut loader_rows = div().flex().flex_col().gap(px(1.0));
            for (kind, name, _) in LOADERS {
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
                        .gap(px(9.0))
                        .h(px(28.0))
                        .child(gpui::img(loader_image(kind)).size(px(16.0)).object_fit(gpui::ObjectFit::Contain))
                        .child(div().w(px(66.0)).text_size(px(11.0)).font_weight(FontWeight::SEMIBOLD).text_color(theme.text).child(name))
                        .when(supported, |el| {
                            el.child(widgets::icon("check", 11.0, theme.ok))
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
            let latest_card = div()
                .flex()
                .flex_col()
                .gap(px(14.0))
                .p(px(16.0))
                .rounded(px(RADIUS))
                .bg(theme.surface)
                .border_1()
                .border_color(theme.border_soft)
                .child(
                    div()
                        .flex()
                        .items_start()
                        .gap(px(14.0))
                        .child(div().size(px(48.0)).rounded(px(12.0)).bg(theme.elevated).border_1().border_color(theme.border).flex().items_center().justify_center().child(gpui::img(loader_image("vanilla")).size(px(32.0)).object_fit(gpui::ObjectFit::Contain)))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(5.0))
                                .flex_1()
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(8.0))
                                        .child(div().text_size(px(21.0)).font_family(MONO).font_weight(FontWeight::BOLD).text_color(theme.text).child(if latest_release.is_empty() { "—".into() } else { latest_release.clone() }))
                                        .child(div().h(px(18.0)).px(px(6.0)).flex().items_center().rounded(px(4.0)).bg(theme.accent_dim).text_size(px(8.5)).font_weight(FontWeight::BOLD).text_color(theme.accent_soft).child("MỚI NHẤT")),
                                )
                                .child(div().text_size(px(11.0)).text_color(theme.muted).child(format!("Phát hành {}", latest_row.as_ref().map(|v| date_of(&v.release_time)).unwrap_or_else(|| "—".into()))))
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
                .child(widgets::button("home-create-latest", format!("Tạo phiên bản với {latest_release}"), &theme, true, move |_, _, cx| {
                    let game = latest_for_button.clone();
                    let _ = view_create_latest.update(cx, |this, cx| {
                        crate::ui::pages::versions::open_versions(this, cx, None, Some(game.clone()));
                    });
                }));

            let mut timeline = div().flex().flex_col().gap(px(1.0)).p(px(8.0)).rounded(px(RADIUS)).bg(theme.surface).border_1().border_color(theme.border_soft);
            for (index, row) in app.versions.iter().take(9).enumerate() {
                let is_latest = index == 0;
                timeline = timeline.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(10.0))
                        .h(px(32.0))
                        .px(px(8.0))
                        .rounded(px(8.0))
                        .when(is_latest, |el| el.bg(theme.elevated))
                        .child(div().size(px(6.0)).rounded_full().bg(if is_latest { theme.accent } else { theme.faint }))
                        .child(div().w(px(78.0)).text_size(px(11.0)).font_family(MONO).font_weight(FontWeight::BOLD).text_color(if is_latest { theme.accent_soft } else { theme.text }).child(row.id.clone()))
                        .child(div().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).child(date_of(&row.release_time)))
                        .child(div().ml_auto().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).child(time_ago(&row.release_time))),
                );
            }

            let mut loader_grid = div().flex().gap_3().flex_wrap();
            for (kind, name, desc) in LOADERS {
                if kind == "vanilla" {
                    continue;
                }
                let info = app.home_loaders.get(kind).cloned().unwrap_or(Value::Null);
                let supported = info.get("supported").and_then(Value::as_bool).unwrap_or(false);
                let build = info.get("build").cloned().unwrap_or(Value::Null);
                let games = info.get("games").and_then(Value::as_u64).unwrap_or(0);
                let view_loader = view.clone();
                let kind_owned = kind.to_string();
                let build_text = match build {
                    Value::String(text) => text,
                    Value::Number(number) => number.to_string(),
                    _ => "—".into(),
                };
                loader_grid = loader_grid.child(
                    div()
                        .id(gpui::SharedString::from(format!("home-loader-{kind}")))
                        .flex()
                        .flex_col()
                        .gap(px(12.0))
                        .w(px(300.0))
                        .flex_grow()
                        .p(px(14.0))
                        .rounded(px(RADIUS))
                        .bg(theme.surface)
                        .border_1()
                        .border_color(theme.border_soft)
                        .cursor_pointer()
                        .hover(|st| st.bg(theme.surface_hover).border_color(theme.border))
                        .on_click(move |_, _, cx| {
                            let kind = kind_owned.clone();
                            let _ = view_loader.update(cx, |this, cx| {
                                crate::ui::pages::versions::open_versions(this, cx, Some(kind.clone()), None);
                            });
                        })
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(10.0))
                                .child(div().size(px(40.0)).rounded(px(10.0)).bg(theme.elevated).border_1().border_color(theme.border).flex().items_center().justify_center().child(gpui::img(loader_image(kind)).size(px(26.0)).object_fit(gpui::ObjectFit::Contain)))
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .gap(px(2.0))
                                        .child(div().text_size(px(13.0)).font_weight(FontWeight::BOLD).text_color(theme.text).child(name))
                                        .child(div().text_size(px(10.0)).text_color(theme.faint).child(desc)),
                                ),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .child(div().text_size(px(10.0)).font_family(MONO).text_color(if supported { theme.muted } else { theme.faint }).child(if supported { format!("build {build_text}") } else { "chưa phát hành".into() }))
                                .child(div().text_size(px(10.0)).font_family(MONO).text_color(theme.faint).child(if games > 0 { format!("{games} phiên bản") } else { String::new() })),
                        ),
                );
            }

            let total_mem = app.system.get("totalMem").and_then(Value::as_u64).unwrap_or(0);
            let free_mem = app.system.get("freeMem").and_then(Value::as_u64).unwrap_or(0);
            let used_mem = total_mem.saturating_sub(free_mem);
            let disk_total = app.system.pointer("/disk/total").and_then(Value::as_u64).unwrap_or(0);
            let disk_free = app.system.pointer("/disk/free").and_then(Value::as_u64).unwrap_or(0);
            let cpu = app.system.get("cpuModel").and_then(Value::as_str).unwrap_or("CPU");
            let threads = app.system.get("cpuThreads").and_then(Value::as_u64).unwrap_or(0);
            let shared = app.backend.store.shared_dir().to_string_lossy().into_owned();

            body = body
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .child(section(&theme, "Sẵn sàng chơi", if running_count > 0 { format!("{running_count} đang chạy") } else { "không có tiến trình".into() }))
                        .child(hero),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .child(section(&theme, "Bản phát hành", format!("{} bản", app.versions.len())))
                        .child(
                            div()
                                .flex()
                                .gap_3()
                                .items_start()
                                .child(div().flex_1().min_w(px(0.0)).child(latest_card))
                                .child(div().w(px(360.0)).flex_shrink_0().child(timeline)),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .child(section(&theme, "Trình tải mod", format!("bản mới nhất cho {}", if latest_release.is_empty() { "—" } else { &latest_release })))
                        .child(loader_grid),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .child(section(&theme, "Hệ thống", "Tài nguyên máy và thư mục dữ liệu".into()))
                        .child(
                            div()
                                .flex()
                                .gap_3()
                                .child(meter(&theme, "RAM", format!("{} / {}", format_bytes(used_mem), format_bytes(total_mem.max(1))), format!("{}%", if total_mem > 0 { used_mem * 100 / total_mem } else { 0 }), if total_mem > 0 { used_mem as f32 / total_mem as f32 * 100.0 } else { 0.0 }, theme.accent))
                                .child(meter(&theme, "Ổ đĩa", format!("{} trống", format_bytes(disk_free)), format!("/ {}", format_bytes(disk_total)), if disk_total > 0 { (disk_total.saturating_sub(disk_free)) as f32 / disk_total as f32 * 100.0 } else { 0.0 }, theme.ok))
                                .child(meter(&theme, "CPU", format!("{threads} nhân"), cpu.chars().take(26).collect::<String>(), 0.0, theme.accent_soft)),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .p(px(12.0))
                                .rounded(px(RADIUS))
                                .bg(theme.surface)
                                .border_1()
                                .border_color(theme.border_soft)
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .child(widgets::icon("folder-open", 14.0, theme.faint))
                                        .child(div().text_size(px(10.5)).font_family(MONO).text_color(theme.muted).child(shared.clone())),
                                )
                                .child(widgets::ghost_button("home-open-shared", "Mở thư mục", &theme, move |_, _, _cx| {
                                    let _ = open::that(&shared);
                                })),
                        ),
                );
        }
    }

    body.into_any_element()
}
