use crate::ui::app::LauncherApp;
use crate::ui::theme::*;
use crate::ui::widgets;
use gpui::{AnyElement, Context, FontWeight, IntoElement, SharedString, Window, div, prelude::*, px};
use serde_json::{Value, json};
use std::path::PathBuf;

const PAGE: u32 = 20;

fn text_of(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn num_of(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn list_of(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn compact(value: u64) -> String {
    if value >= 1_000_000_000 {
        format!("{:.1}B", value as f64 / 1_000_000_000.0)
    } else if value >= 1_000_000 {
        format!("{:.1}M", value as f64 / 1_000_000.0)
    } else if value >= 1_000 {
        format!("{:.1}K", value as f64 / 1_000.0)
    } else {
        value.to_string()
    }
}

fn bytes_label(size: u64) -> String {
    if size >= 1 << 20 {
        format!("{:.1} MB", size as f64 / 1_048_576.0)
    } else if size >= 1 << 10 {
        format!("{:.1} KB", size as f64 / 1024.0)
    } else if size > 0 {
        format!("{size} B")
    } else {
        String::new()
    }
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

fn date_of(iso: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(iso)
        .map(|value| value.format("%d/%m/%Y").to_string())
        .unwrap_or_else(|_| iso.chars().take(10).collect())
}

fn loader_image(id: &str) -> PathBuf {
    crate::ui::assets::image_path(&format!("loader-icon/{id}.png"))
}

fn loader_name(id: &str) -> &'static str {
    match id {
        "vanilla" => "Vanilla",
        "fabric" => "Fabric",
        "quilt" => "Quilt",
        "forge" => "Forge",
        "neoforge" => "NeoForge",
        "lunar" => "LunarLoader",
        _ => "Khác",
    }
}

static TAG_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"(?is)<[^>]+>").unwrap());
static IMAGE_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"(?is)!\[[^\]]*\]\([^)]*\)").unwrap());
static LINK_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"\[([^\]]+)\]\(([^)]+)\)").unwrap());
static REF_LINK_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"\[([^\]]+)\]\[[^\]]*\]").unwrap());
static CITATION_RE: once_cell::sync::Lazy<regex::Regex> =
    once_cell::sync::Lazy::new(|| regex::Regex::new(r"\[\d+\]").unwrap());

fn clean_text(raw: &str) -> String {
    let text = raw.replace("\r\n", "\n");
    let text = IMAGE_RE.replace_all(&text, "");
    let text = LINK_RE.replace_all(&text, "$1");
    let text = REF_LINK_RE.replace_all(&text, "$1");
    let text = CITATION_RE.replace_all(&text, "");
    let text = TAG_RE.replace_all(&text, "\n");
    let mut out = String::new();
    let mut blanks = 0;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            blanks += 1;
            if blanks > 1 {
                continue;
            }
        } else {
            blanks = 0;
            out.push_str(trimmed);
            out.push('\n');
        }
    }
    out.trim().to_string()
}

fn norm(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

fn owned_for(app: &LauncherApp, hit: &Value) -> Option<Value> {
    let project = text_of(hit, "id");
    let slug = norm(&text_of(hit, "slug"));
    let title = norm(&text_of(hit, "name"));
    app.content.inventory.iter().find_map(|row| {
        let row_project = text_of(row, "projectId");
        let row_slug = norm(&text_of(row, "slug"));
        let row_title = norm(&text_of(row, "title"));
        let by_project = !project.is_empty() && row_project == project;
        let by_slug = !slug.is_empty() && row_slug == slug;
        let by_title = !title.is_empty() && row_title == title;
        (by_project || by_slug || by_title).then(|| row.clone())
    })
}

fn kind_title(kind: &str) -> &'static str {
    match kind {
        "shaderpacks" => "Tải shader",
        "resourcepacks" => "Tải gói tài nguyên",
        _ => "Tải mod",
    }
}

fn kind_noun(kind: &str) -> &'static str {
    match kind {
        "shaderpacks" => "shader",
        "resourcepacks" => "gói tài nguyên",
        _ => "mod",
    }
}

fn kind_icon(kind: &str) -> &'static str {
    match kind {
        "shaderpacks" => "paint-brush",
        "resourcepacks" => "image",
        _ => "puzzle-piece",
    }
}

fn target_line(app: &LauncherApp) -> String {
    let Some(instance) = app
        .content
        .instance_id
        .as_ref()
        .and_then(|id| app.instances.iter().find(|entry| &entry.id == id))
    else {
        return String::new();
    };
    if instance.loader != "vanilla" && app.content.kind == "mods" {
        match instance.loader_version.as_deref() {
            Some(version) if !version.is_empty() => format!(
                "{} · {} {}",
                instance.version,
                loader_name(&instance.loader),
                version
            ),
            _ => format!("{} · {}", instance.version, loader_name(&instance.loader)),
        }
    } else {
        instance.version.clone()
    }
}

pub fn open(app: &mut LauncherApp, kind: &str, instance_id: String, cx: &mut Context<LauncherApp>) {
    let instance = app
        .instances
        .iter()
        .find(|entry| entry.id == instance_id)
        .cloned();
    app.content.kind = kind.to_string();
    app.content.instance_id = Some(instance_id);
    app.content.open = true;
    app.content.view = "list".into();
    app.content.source = "modrinth".into();
    app.content.sort = "relevance".into();
    app.content.game = instance.map(|entry| entry.version).unwrap_or_default();
    app.content.loader.clear();
    app.content.category.clear();
    app.content.environment.clear();
    app.content.hits.clear();
    app.content.total = 0;
    app.content.offset = 0;
    app.content.error.clear();
    app.content.selected = None;
    app.content.selected_versions.clear();
    app.content.selected_version = None;
    app.content.detail = None;
    app.content.detail_tab = "about".into();
    app.content.menu = None;
    app.content.installing.clear();
    app.content.install_error.clear();
    app.content.done = None;
    app.content.changelog_open.clear();
    app.content.changelogs.clear();
    app.content.detail_loading = false;
    app.content.versions_loading = false;
    let input = app.content_search.clone();
    input.update(cx, |input, cx| {
        input.placeholder = "Tìm theo tên…".into();
        input.clear(cx);
    });
    load_tags(app, cx);
    load_inventory(app, cx);
    run_search(app, cx, true);
    cx.notify();
}

pub fn close(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    app.content.open = false;
    app.content.view = "list".into();
    app.content.menu = None;
    cx.notify();
}

fn run_search(app: &mut LauncherApp, cx: &mut Context<LauncherApp>, reset: bool) {
    if !reset && app.content.loading {
        return;
    }
    let offset = if reset {
        0
    } else {
        app.content.hits.len() as u32
    };
    app.content.loading = true;
    app.content.error.clear();
    if reset {
        app.content.offset = 0;
    }
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
        "limit": PAGE,
        "game": if game.is_empty() { Value::Null } else { Value::String(game) },
        "loader": if loader.is_empty() { Value::Null } else { Value::String(loader) },
        "category": if category.is_empty() { Value::Null } else { Value::String(category) },
        "environment": if environment.is_empty() { Value::Null } else { Value::String(environment) },
    }));
    app.on_result(cx, rx, move |this, value, cx| {
        this.content.loading = false;
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            let rows = value
                .get("hits")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if reset {
                this.content.hits = rows.clone();
            } else {
                let mut seen: std::collections::HashSet<String> = this
                    .content
                    .hits
                    .iter()
                    .map(|row| text_of(row, "id"))
                    .collect();
                for row in rows.iter() {
                    let id = text_of(row, "id");
                    if !id.is_empty() && seen.insert(id) {
                        this.content.hits.push(row.clone());
                    }
                }
            }
            this.content.total = value.get("total").and_then(Value::as_u64).unwrap_or(0);
            let urls: Vec<String> = rows
                .iter()
                .map(|row| text_of(row, "icon"))
                .filter(|url| !url.is_empty())
                .collect();
            if !urls.is_empty() {
                this.cache_icons(urls, cx);
            }
        } else {
            this.content.error = value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Không tải được danh sách")
                .to_string();
        }
        cx.notify();
    });
}

fn load_tags(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    let kind = app.content.kind.clone();
    let source = app.content.source.clone();
    app.content.tags.clear();
    app.content.env_supported = false;
    let rx = app.backend.content_tags(kind, source);
    app.on_result(cx, rx, |this, value, cx| {
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            this.content.tags = value
                .get("options")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            this.content.env_supported =
                value.get("environment").and_then(Value::as_bool).unwrap_or(false);
        }
        cx.notify();
    });
}

fn load_inventory(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    let kind = app.content.kind.clone();
    let Some(instance_id) = app.content.instance_id.clone() else {
        return;
    };
    let rx = app.backend.content_inventory(kind, instance_id);
    app.on_result(cx, rx, |this, value, cx| {
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            this.content.inventory = value
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
        }
        cx.notify();
    });
}

pub fn open_detail(app: &mut LauncherApp, hit: Value, cx: &mut Context<LauncherApp>) {
    app.content.view = "detail".into();
    app.content.menu = None;
    app.content.selected = Some(hit.clone());
    app.content.selected_versions.clear();
    app.content.selected_version = None;
    app.content.detail = None;
    app.content.detail_loading = true;
    app.content.versions_loading = true;
    app.content.detail_tab = "about".into();
    app.content.installing.clear();
    app.content.install_error.clear();
    app.content.done = None;
    app.content.changelog_open.clear();
    app.content.changelogs.clear();
    let kind = app.content.kind.clone();
    let source = text_of(&hit, "source");
    let source = if source.is_empty() {
        app.content.source.clone()
    } else {
        source
    };
    let id = text_of(&hit, "id");
    let game = app
        .content
        .instance_id
        .as_ref()
        .and_then(|instance_id| {
            app.instances
                .iter()
                .find(|entry| &entry.id == instance_id)
                .map(|entry| entry.version.clone())
        })
        .unwrap_or_default();
    let filter_loader = app.content.loader.clone();
    let mods = app.content.kind == "mods";
    let rx = app.backend.content_versions(kind.clone(), source.clone(), id.clone());
    app.on_result(cx, rx, move |this, value, cx| {
        this.content.versions_loading = false;
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            let mut rows = value
                .get("versions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if !game.is_empty() {
                rows.retain(|row| {
                    list_of(row, "gameVersions")
                        .iter()
                        .any(|version| version == &game)
                });
            }
            if mods && !filter_loader.is_empty() && filter_loader != "vanilla" {
                let keep: Vec<Value> = rows
                    .iter()
                    .filter(|row| {
                        list_of(row, "loaders")
                            .iter()
                            .any(|loader| loader == &filter_loader)
                    })
                    .cloned()
                    .collect();
                if !keep.is_empty() {
                    rows = keep;
                }
            }
            this.content.selected_version = rows
                .first()
                .map(|row| text_of(row, "id"));
            this.content.selected_versions = rows;
        }
        cx.notify();
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
        cx.notify();
    });
}

fn install(app: &mut LauncherApp, version_id: String, cx: &mut Context<LauncherApp>) {
    if version_id.is_empty() || !app.content.installing.is_empty() {
        return;
    }
    let Some(hit) = app.content.selected.clone() else {
        return;
    };
    let Some(instance_id) = app.content.instance_id.clone() else {
        return;
    };
    let Some(instance) = app
        .instances
        .iter()
        .find(|entry| entry.id == instance_id)
        .cloned()
    else {
        return;
    };
    let version = app
        .content
        .selected_versions
        .iter()
        .find(|row| text_of(row, "id") == version_id)
        .cloned()
        .unwrap_or(Value::Null);
    app.content.installing = version_id.clone();
    app.content.install_error.clear();
    app.content.done = None;
    let kind = app.content.kind.clone();
    let source = text_of(&hit, "source");
    let source = if source.is_empty() {
        app.content.source.clone()
    } else {
        source
    };
    let loader = {
        let own = list_of(&version, "loaders")
            .into_iter()
            .find(|loader| loader != "vanilla");
        if !app.content.loader.is_empty() {
            app.content.loader.clone()
        } else {
            own.unwrap_or_default()
        }
    };
    let rx = app.backend.content_install(json!({
        "kind": kind,
        "source": source,
        "id": text_of(&hit, "id"),
        "versionId": version_id,
        "version": text_of(&version, "versionNumber"),
        "instanceId": instance_id,
        "game": instance.version,
        "loader": loader,
        "name": text_of(&hit, "name"),
        "slug": text_of(&hit, "slug"),
    }));
    app.on_result(cx, rx, |this, value, cx| {
        this.content.installing.clear();
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            this.content.done = Some(value);
            this.load_instance_tab(cx);
            load_inventory(this, cx);
        } else {
            this.content.install_error = value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Không cài được nội dung.")
                .to_string();
        }
        cx.notify();
    });
}

fn remove_owned(app: &mut LauncherApp, file: String, cx: &mut Context<LauncherApp>) {
    if file.is_empty() {
        return;
    }
    let Some(instance_id) = app.content.instance_id.clone() else {
        return;
    };
    let kind = app.content.kind.clone();
    let rx = app
        .backend
        .content_remove(json!({"kind": kind, "instanceId": instance_id, "file": file}));
    app.on_result(cx, rx, |this, value, cx| {
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            load_inventory(this, cx);
            this.load_instance_tab(cx);
        } else {
            this.content.install_error = value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Không gỡ được tệp.")
                .to_string();
        }
        cx.notify();
    });
}

fn load_changelog(app: &mut LauncherApp, version_id: String, cx: &mut Context<LauncherApp>) {
    if version_id.is_empty() || app.content.changelogs.contains_key(&version_id) {
        return;
    }
    let Some(hit) = app.content.selected.clone() else {
        return;
    };
    let source = text_of(&hit, "source");
    let source = if source.is_empty() {
        app.content.source.clone()
    } else {
        source
    };
    let id = text_of(&hit, "id");
    let rx = app.backend.content_changelog(json!({
        "source": source,
        "id": id,
        "versionId": version_id,
    }));
    app.on_result(cx, rx, move |this, value, cx| {
        let text = if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            text_of(&value, "text")
        } else {
            String::new()
        };
        this.content.changelogs.insert(version_id.clone(), text);
        cx.notify();
    });
}

struct Choice {
    value: String,
    label: String,
}

fn dropdown(
    theme: &Theme,
    field: &'static str,
    value: &str,
    placeholder: &str,
    choices: Vec<Choice>,
    disabled: bool,
    open: bool,
    view: gpui::WeakEntity<LauncherApp>,
    width: f32,
) -> AnyElement {
    let theme = theme.clone();
    let current = choices
        .iter()
        .find(|choice| choice.value == value)
        .map(|choice| choice.label.clone())
        .unwrap_or_else(|| placeholder.to_string());
    let view_toggle = view.clone();
    let field_toggle = field;
    let mut button = div()
        .id(SharedString::from(format!("content-select-{field}")))
        .h(px(34.0))
        .px(px(10.0))
        .rounded(px(8.0))
        .bg(theme.surface)
        .border_1()
        .border_color(if open { theme.accent } else { theme.border })
        .flex()
        .items_center()
        .justify_between()
        .gap_2()
        .w_full()
        .text_size(px(11.0))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(if disabled { theme.faint } else { theme.muted })
        .child(div().truncate().child(current))
        .child(widgets::icon(
            if open { "caret-up" } else { "caret-down" },
            10.0,
            theme.faint,
        ));
    if !disabled {
        button = button.cursor_pointer().on_click(move |_, _, cx| {
            let _ = view_toggle.update(cx, |this, cx| {
                this.content.menu = if this.content.menu.as_deref() == Some(field_toggle) {
                    None
                } else {
                    Some(field_toggle.to_string())
                };
                cx.notify();
            });
        });
    }
    let selected = value.to_string();
    let mut panel = div()
        .id(SharedString::from(format!("content-menu-{field}")))
        .absolute()
        .top(px(38.0))
        .left(px(0.0))
        .w(px(width))
        .max_h(px(260.0))
        .overflow_y_scroll()
        .rounded(px(9.0))
        .bg(theme.elevated)
        .border_1()
        .border_color(theme.border)
        .shadow_lg()
        .p(px(4.0))
        .flex()
        .flex_col()
        .gap(px(2.0));
    for choice in choices {
        let view_pick = view.clone();
        let value = choice.value.clone();
        let active = choice.value == selected;
        panel = panel.child(
            div()
                .id(SharedString::from(format!(
                    "content-opt-{field}-{}",
                    choice.value
                )))
                .h(px(28.0))
                .px(px(8.0))
                .rounded(px(5.0))
                .flex()
                .items_center()
                .text_size(px(11.0))
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .when(active, |el| el.bg(theme.accent_dim))
                .cursor_pointer()
                .hover(|style| style.bg(theme.surface_hover))
                .on_click(move |_, _, cx| {
                    let value = value.clone();
                    let field = field;
                    let _ = view_pick.update(cx, |this, cx| {
                        let reload = apply_filter(this, field, value);
                        this.content.menu = None;
                        if reload {
                            run_search(this, cx, true);
                        }
                        cx.notify();
                    });
                })
                .child(choice.label),
        );
    }
    div()
        .relative()
        .w_full()
        .child(button)
        .when(open, |el| {
            el.child(
                gpui::deferred(panel)
                    .with_priority(2)
                    .into_any_element(),
            )
        })
        .into_any_element()
}

fn menu_backdrop(view: &gpui::WeakEntity<LauncherApp>) -> AnyElement {
    let view = view.clone();
    gpui::deferred(
        div()
            .id("content-menu-backdrop")
            .absolute()
            .inset_0()
            .occlude()
            .on_click(move |_, _, cx| {
                let _ = view.update(cx, |this, cx| {
                    this.content.menu = None;
                    cx.notify();
                });
            }),
    )
    .with_priority(1)
    .into_any_element()
}

fn apply_filter(app: &mut LauncherApp, field: &str, value: String) -> bool {
    match field {
        "game" => app.content.game = value,
        "loader" => app.content.loader = value,
        "tag" => app.content.category = value,
        "environment" => app.content.environment = value,
        "sort" => app.content.sort = if value.is_empty() { "relevance".into() } else { value },
        "version_game" => {
            app.content.version_game = value;
            return false;
        }
        "version_loader" => {
            app.content.version_loader = value;
            return false;
        }
        _ => {}
    }
    true
}

fn choices(values: &[(&str, &str)]) -> Vec<Choice> {
    values
        .iter()
        .map(|(value, label)| Choice {
            value: value.to_string(),
            label: label.to_string(),
        })
        .collect()
}

fn icon_thumb(app: &LauncherApp, url: &str, size: f32, theme: &Theme) -> AnyElement {
    if url.is_empty() {
        return div()
            .size(px(size))
            .rounded(px(8.0))
            .bg(theme.elevated)
            .flex()
            .items_center()
            .justify_center()
            .child(widgets::icon("package", size * 0.45, theme.faint))
            .into_any_element();
    }
    if let Some(path) = app.icon_cache.get(url) {
        return gpui::img(path.clone())
            .size(px(size))
            .rounded(px(8.0))
            .object_fit(gpui::ObjectFit::Cover)
            .into_any_element();
    }
    div()
        .size(px(size))
        .rounded(px(8.0))
        .bg(theme.elevated)
        .flex()
        .items_center()
        .justify_center()
        .child(widgets::spinner(size * 0.3, theme.faint))
        .into_any_element()
}

fn env_chip(theme: &Theme, env: &str) -> Option<AnyElement> {
    let (label, color) = match env {
        "client" => ("Máy khách", theme.accent_soft),
        "server" => ("Máy chủ", theme.info),
        "both" => ("Cả hai", theme.ok),
        _ => return None,
    };
    Some(
        div()
            .h(px(18.0))
            .px(px(6.0))
            .rounded(px(5.0))
            .flex()
            .items_center()
            .gap(px(4.0))
            .bg(gpui::rgba(0xffffff0a))
            .text_size(px(8.5))
            .font_weight(FontWeight::BOLD)
            .text_color(color)
            .child(widgets::icon(
                if env == "server" { "hard-drives" } else { "monitor" },
                10.0,
                color,
            ))
            .child(label)
            .into_any_element(),
    )
}

fn loader_dots(theme: &Theme, loaders: &[String], size: f32) -> AnyElement {
    let mut row = div().flex().items_center().gap(px(3.0));
    for loader in loaders.iter().take(4) {
        row = row.child(
            div()
                .size(px(size + 4.0))
                .rounded(px(4.0))
                .bg(theme.elevated)
                .flex()
                .items_center()
                .justify_center()
                .child(
                    gpui::img(loader_image(loader))
                        .size(px(size))
                        .object_fit(gpui::ObjectFit::Contain),
                ),
        );
    }
    row.into_any_element()
}

fn tag_chip(theme: &Theme, label: &str) -> AnyElement {
    div()
        .h(px(22.0))
        .px(px(7.0))
        .rounded(px(5.0))
        .bg(theme.elevated)
        .border_1()
        .border_color(theme.border_soft)
        .flex()
        .items_center()
        .text_size(px(9.5))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(theme.muted)
        .child(label.to_string())
        .into_any_element()
}

fn stat_box(theme: &Theme, label: &str, value: String) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .gap(px(3.0))
        .min_w(px(120.0))
        .flex_1()
        .p(px(10.0))
        .rounded(px(10.0))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft)
        .child(
            div()
                .text_size(px(8.5))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.faint)
                .child(label.to_uppercase()),
        )
        .child(
            div()
                .text_size(px(12.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.text)
                .truncate()
                .child(value),
        )
        .into_any_element()
}

fn info_box(
    theme: &Theme,
    title: &str,
    icon: &str,
    body: impl IntoElement,
) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .p(px(12.0))
        .rounded(px(10.0))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(5.0))
                .child(widgets::icon(icon, 12.0, theme.accent_soft))
                .child(
                    div()
                        .text_size(px(9.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.muted)
                        .child(title.to_uppercase()),
                ),
        )
        .child(body)
        .into_any_element()
}

fn leader(theme: &Theme, label: &str, value: String) -> AnyElement {
    div()
        .w_full()
        .flex()
        .items_center()
        .justify_between()
        .gap(px(8.0))
        .text_size(px(10.0))
        .child(div().text_color(theme.faint).child(label.to_string()))
        .child(
            div()
                .text_color(theme.text)
                .truncate()
                .child(value),
        )
        .into_any_element()
}

fn install_banner(theme: &Theme, app: &LauncherApp) -> Option<AnyElement> {
    if !app.content.install_error.is_empty() {
        return Some(
            div()
                .w_full()
                .flex()
                .items_start()
                .gap(px(6.0))
                .p(px(9.0))
                .rounded(px(8.0))
                .bg(gpui::rgba(0xf871711a))
                .border_1()
                .border_color(gpui::rgba(0xf8717155))
                .text_size(px(10.0))
                .text_color(theme.bad)
                .child(widgets::icon("warning-circle", 12.0, theme.bad))
                .child(app.content.install_error.clone())
                .into_any_element(),
        );
    }
    if let Some(done) = app.content.done.as_ref() {
        let message = format!(
            "Đã thêm {} tệp vào {}/{}",
            num_of(done, "added"),
            app.content.kind,
            if num_of(done, "existed") > 0 {
                format!(" · {} đã có", num_of(done, "existed"))
            } else {
                String::new()
            }
        );
        return Some(
            div()
                .w_full()
                .flex()
                .items_center()
                .gap(px(6.0))
                .p(px(9.0))
                .rounded(px(8.0))
                .bg(gpui::rgba(0x22c55e1a))
                .border_1()
                .border_color(gpui::rgba(0x22c55e55))
                .text_size(px(10.0))
                .text_color(theme.ok)
                .child(widgets::icon("check-circle", 12.0, theme.ok))
                .child(message)
                .into_any_element(),
        );
    }
    None
}

pub fn render(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) -> AnyElement {
    if app.content.view == "detail" {
        detail_page(app, cx)
    } else {
        list_page(app, cx)
    }
}

fn header_bar(
    theme: &Theme,
    title: String,
    subtitle: String,
    back: impl Fn(&gpui::ClickEvent, &mut gpui::Window, &mut gpui::App) + 'static,
    trailing: impl IntoElement,
) -> AnyElement {
    let mut bar = div()
        .w_full()
        .flex()
        .items_center()
        .gap(px(8.0))
        .p(px(8.0))
        .rounded(px(10.0))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft)
        .child(
            div()
                .id("content-back")
                .size(px(28.0))
                .rounded(px(6.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border)
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .hover(|style| style.bg(theme.surface_hover))
                .on_click(back)
                .child(widgets::icon("arrow-left", 13.0, theme.muted)),
        )
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .flex()
                .flex_col()
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.text)
                        .truncate()
                        .child(title),
                )
                .child(
                    div()
                        .text_size(px(9.5))
                        .text_color(theme.faint)
                        .truncate()
                        .child(subtitle),
                ),
        );
    bar = bar.child(trailing);
    bar.into_any_element()
}

fn list_page(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let kind = app.content.kind.clone();
    let folder = kind.clone();
    let title = kind_title(&kind).to_string();
    let instance_label = app
        .content
        .instance_id
        .as_ref()
        .and_then(|id| app.instances.iter().find(|entry| &entry.id == id))
        .map(|entry| entry.name.clone())
        .unwrap_or_default();
    let subtitle = format!(
        "{} · {}/ · mặc định cho {}",
        instance_label,
        folder,
        target_line(app)
    );
    let view_back = view.clone();
    let source = app.content.source.clone();
    let view_source = view.clone();
    let view_reload = view.clone();
    let reload = div()
        .flex()
        .items_center()
        .gap(px(6.0))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(2.0))
                .p(px(2.0))
                .rounded(px(8.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border)
                .children(["modrinth", "curseforge"].into_iter().map(|id| {
                    let view = view_source.clone();
                    let active = source == id;
                    div()
                        .id(SharedString::from(format!("content-source-{id}")))
                        .h(px(26.0))
                        .px(px(10.0))
                        .rounded(px(6.0))
                        .flex()
                        .items_center()
                        .text_size(px(10.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(if active { theme.accent_soft } else { theme.muted })
                        .when(active, |el| {
                            el.bg(theme.surface).border_1().border_color(theme.border)
                        })
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let id = id.to_string();
                            let _ = view.update(cx, |this, cx| {
                                if this.content.source == id {
                                    return;
                                }
                                this.content.source = id;
                                this.content.category.clear();
                                this.content.environment.clear();
                                load_tags(this, cx);
                                run_search(this, cx, true);
                                cx.notify();
                            });
                        })
                        .child(if id == "curseforge" { "CurseForge" } else { "Modrinth" })
                })),
        )
        .child(
            div()
                .id("content-reload")
                .size(px(30.0))
                .rounded(px(7.0))
                .bg(theme.surface)
                .border_1()
                .border_color(theme.border)
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .hover(|style| style.bg(theme.surface_hover))
                .on_click(move |_, _, cx| {
                    let _ = view_reload.update(cx, |this, cx| {
                        run_search(this, cx, true);
                    });
                })
                .child(widgets::icon(
                    if app.content.loading { "spinner" } else { "arrow-clockwise" },
                    13.0,
                    theme.muted,
                )),
        );
    let header = header_bar(
        &theme,
        title,
        subtitle,
        move |_, _, cx| {
            let _ = view_back.update(cx, |this, cx| close(this, cx));
        },
        reload,
    );

    // Filters
    let mut game_values: Vec<String> = Vec::new();
    if !app.content.game.is_empty() {
        game_values.push(app.content.game.clone());
    }
    if let Some(instance) = app
        .content
        .instance_id
        .as_ref()
        .and_then(|id| app.instances.iter().find(|entry| &entry.id == id))
    {
        if !instance.version.is_empty() && !game_values.contains(&instance.version) {
            game_values.push(instance.version.clone());
        }
    }
    for hit in app.content.hits.iter() {
        for version in list_of(hit, "gameVersions") {
            if !version.is_empty() && !game_values.contains(&version) {
                game_values.push(version);
            }
        }
    }
    game_values.sort_by(|a, b| b.cmp(a));
    let mut game_choices = vec![Choice {
        value: String::new(),
        label: "Mọi phiên bản game".into(),
    }];
    game_choices.extend(game_values.into_iter().map(|value| Choice {
        label: value.clone(),
        value,
    }));
    let loader_choices = choices(&[
        ("", "Mọi loader"),
        ("vanilla", "Vanilla"),
        ("fabric", "Fabric"),
        ("quilt", "Quilt"),
        ("forge", "Forge"),
        ("neoforge", "NeoForge"),
    ]);
    let mut tag_choices = vec![Choice {
        value: String::new(),
        label: "Mọi thẻ".into(),
    }];
    for row in app.content.tags.iter() {
        let value = text_of(row, "value");
        let label = text_of(row, "label");
        if !value.is_empty() {
            tag_choices.push(Choice { value, label });
        }
    }
    let env_choices = choices(&[
        ("", "Mọi môi trường"),
        ("client", "Máy khách"),
        ("server", "Máy chủ"),
        ("both", "Cả hai"),
    ]);
    let sort_choices = choices(&[
        ("relevance", "Liên quan"),
        ("downloads", "Tải nhiều"),
        ("newest", "Mới nhất"),
        ("updated", "Vừa cập nhật"),
    ]);
    let is_mods = kind == "mods";
    let menu = app.content.menu.clone();
    let has_filter = !app.content.loader.is_empty()
        || !app.content.category.is_empty()
        || !app.content.environment.is_empty()
        || app
            .content
            .instance_id
            .as_ref()
            .and_then(|id| app.instances.iter().find(|entry| &entry.id == id))
            .map(|instance| app.content.game != instance.version)
            .unwrap_or(false);
    let view_clear = view.clone();
    let mut filter_row1 = div().flex().flex_wrap().items_center().gap(px(8.0)).w_full();
    filter_row1 = filter_row1.child(
        div()
            .w(px(190.0))
            .child(dropdown(
                &theme,
                "game",
                &app.content.game,
                "Mọi phiên bản game",
                game_choices,
                false,
                menu.as_deref() == Some("game"),
                view.clone(),
                190.0,
            )),
    );
    if is_mods {
        filter_row1 = filter_row1.child(
            div()
                .w(px(160.0))
                .child(dropdown(
                    &theme,
                    "loader",
                    &app.content.loader,
                    "Mọi loader",
                    loader_choices,
                    false,
                    menu.as_deref() == Some("loader"),
                    view.clone(),
                    160.0,
                )),
        );
        let view_tag = view.clone();
        filter_row1 = filter_row1.child(
            div()
                .w(px(170.0))
                .child(dropdown(
                    &theme,
                    "tag",
                    &app.content.category,
                    "Mọi thẻ",
                    tag_choices,
                    false,
                    menu.as_deref() == Some("tag"),
                    view_tag,
                    170.0,
                )),
        );
        let env_supported = app.content.env_supported;
        filter_row1 = filter_row1.child(
            div().w(px(160.0)).child(dropdown(
                &theme,
                "environment",
                &app.content.environment,
                "Mọi môi trường",
                env_choices,
                !env_supported,
                menu.as_deref() == Some("environment"),
                view.clone(),
                160.0,
            )),
        );
    } else {
        filter_row1 = filter_row1.child(
            div()
                .w(px(170.0))
                .child(dropdown(
                    &theme,
                    "tag",
                    &app.content.category,
                    "Mọi thẻ",
                    tag_choices,
                    false,
                    menu.as_deref() == Some("tag"),
                    view.clone(),
                    170.0,
                )),
        );
    }
    if has_filter {
        filter_row1 = filter_row1.child(
            div()
                .id("content-clear-filter")
                .h(px(34.0))
                .px(px(10.0))
                .rounded(px(8.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border)
                .flex()
                .items_center()
                .text_size(px(10.5))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.muted)
                .cursor_pointer()
                .hover(|style| style.text_color(theme.text))
                .on_click(move |_, _, cx| {
                    let _ = view_clear.update(cx, |this, cx| {
                        this.content.loader.clear();
                        this.content.category.clear();
                        this.content.environment.clear();
                        if let Some(instance) = this
                            .content
                            .instance_id
                            .as_ref()
                            .and_then(|id| this.instances.iter().find(|entry| &entry.id == id))
                            .cloned()
                        {
                            this.content.game = instance.version;
                        }
                        run_search(this, cx, true);
                        cx.notify();
                    });
                })
                .child("Xoá lọc"),
        );
    }
    let env_note = (is_mods && app.content.source == "curseforge" && !app.content.env_supported).then(|| {
        div()
            .w_full()
            .text_size(px(9.5))
            .line_height(px(14.0))
            .text_color(theme.faint)
            .child("CurseForge không trả dữ liệu máy khách/máy chủ qua API, nên bộ lọc môi trường chỉ dùng được với Modrinth.")
    });
    let mut filter_row2 = div()
        .flex()
        .items_center()
        .gap(px(8.0))
        .w_full()
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .flex()
                .items_center()
                .gap(px(4.0))
                .child(
                    div()
                        .flex_1()
                        .min_w(px(0.0))
                        .child(widgets::text_input_box(&theme).child(app.content_search.clone())),
                )
                .child(
                    div()
                        .id("content-search")
                        .size(px(34.0))
                        .rounded(px(8.0))
                        .bg(theme.accent)
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor_pointer()
                        .on_click({
                            let view = view.clone();
                            move |_, _, cx| {
                                let _ = view.update(cx, |this, cx| run_search(this, cx, true));
                            }
                        })
                        .child(widgets::icon("magnifying-glass", 14.0, theme.on_accent)),
                ),
        )
        .child(
            div().w(px(168.0)).child(dropdown(
                &theme,
                "sort",
                &app.content.sort,
                "Liên quan",
                sort_choices,
                false,
                menu.as_deref() == Some("sort"),
                view.clone(),
                168.0,
            )),
        )
        .child(
            div()
                .text_size(px(10.0))
                .font_family(MONO)
                .text_color(theme.faint)
                .child(if app.content.loading && app.content.hits.is_empty() {
                    "· · ·".to_string()
                } else {
                    format!("{}/{}", app.content.hits.len(), app.content.total)
                }),
        );

    let mut grid = div().flex().flex_wrap().gap(px(12.0)).w_full();
    if app.content.loading && app.content.hits.is_empty() {
        for index in 0..6 {
            grid = grid.child(
                div()
                    .id(SharedString::from(format!("content-skeleton-{index}")))
                    .w(px(290.0))
                    .flex_grow()
                    .h(px(118.0))
                    .rounded(px(12.0))
                    .bg(theme.surface)
                    .border_1()
                    .border_color(theme.border_soft)
                    .p(px(12.0))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(10.0))
                            .child(div().size(px(44.0)).rounded(px(8.0)).bg(theme.elevated))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(6.0))
                                    .flex_1()
                                    .child(div().h(px(9.0)).w(px(120.0)).rounded_full().bg(theme.elevated))
                                    .child(div().h(px(8.0)).w(px(70.0)).rounded_full().bg(theme.elevated)),
                            ),
                    ),
            );
        }
    } else if app.content.hits.is_empty() {
        let empty = div()
            .w_full()
            .py(px(48.0))
            .flex()
            .flex_col()
            .items_center()
            .gap(px(8.0))
            .child(widgets::icon(kind_icon(&kind), 26.0, theme.faint))
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(theme.muted)
                    .child("Không có kết quả phù hợp cho phiên bản này"),
            );
        grid = grid.child(empty);
    } else {
        let instance_version = app
            .content
            .instance_id
            .as_ref()
            .and_then(|id| app.instances.iter().find(|entry| &entry.id == id))
            .map(|entry| entry.version.clone())
            .unwrap_or_default();
        for hit in app.content.hits.iter().cloned().collect::<Vec<_>>() {
            let owned = owned_for(app, &hit);
            let id = text_of(&hit, "id");
            let icon = text_of(&hit, "icon");
            let name = text_of(&hit, "name");
            let author = text_of(&hit, "author");
            let summary = text_of(&hit, "summary");
            let downloads = num_of(&hit, "downloads");
            let loaders = list_of(&hit, "loaders");
            let game_versions = list_of(&hit, "gameVersions");
            let env = text_of(&hit, "env");
            let game_text = if game_versions.contains(&instance_version) {
                format!(
                    "{}{}",
                    instance_version,
                    if game_versions.len() > 1 {
                        format!(" +{}", game_versions.len() - 1)
                    } else {
                        String::new()
                    }
                )
            } else {
                format!(
                    "{}{}",
                    game_versions.iter().take(3).cloned().collect::<Vec<_>>().join(" · "),
                    if game_versions.len() > 3 {
                        format!(" +{}", game_versions.len() - 3)
                    } else {
                        String::new()
                    }
                )
            };
            let thumb = icon_thumb(app, &icon, 44.0, &theme);
            let view_open = view.clone();
            let hit_open = hit.clone();
            let owned_badge = owned.as_ref().map(|row| {
                let version = text_of(row, "version");
                format!(
                    "Đã cài{}",
                    if version.is_empty() {
                        String::new()
                    } else {
                        format!(" · {version}")
                    }
                )
            });
            let footer_env = if is_mods { env_chip(&theme, &env) } else { None };
            let dots = if is_mods && !loaders.is_empty() {
                Some(loader_dots(&theme, &loaders, 12.0))
            } else {
                None
            };
            let card = div()
                .id(SharedString::from(format!("content-card-{id}")))
                .w(px(290.0))
                .flex_grow()
                .p(px(12.0))
                .rounded(px(12.0))
                .bg(if owned.is_some() { theme.accent_dim } else { theme.surface })
                .border_1()
                .border_color(if owned.is_some() { theme.accent } else { theme.border_soft })
                .flex()
                .flex_col()
                .gap(px(8.0))
                .cursor_pointer()
                .hover(|style| style.bg(theme.surface_hover).border_color(theme.border))
                .on_click(move |_, _, cx| {
                    let hit = hit_open.clone();
                    let _ = view_open.update(cx, |this, cx| open_detail(this, hit, cx));
                })
                .child(
                    div()
                        .flex()
                        .items_start()
                        .gap(px(10.0))
                        .child(thumb)
                        .child(
                            div()
                                .flex_1()
                                .min_w(px(0.0))
                                .flex()
                                .flex_col()
                                .gap(px(2.0))
                                .child(
                                    div()
                                        .text_size(px(11.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(theme.text)
                                        .truncate()
                                        .child(name),
                                )
                                .child(
                                    div()
                                        .text_size(px(9.5))
                                        .text_color(theme.faint)
                                        .truncate()
                                        .child(if author.is_empty() {
                                            "—".to_string()
                                        } else {
                                            author
                                        }),
                                ),
                        )
                        .child(match owned_badge {
                            Some(label) => div()
                                .flex_shrink_0()
                                .h(px(20.0))
                                .px(px(6.0))
                                .rounded(px(5.0))
                                .bg(theme.accent_dim)
                                .border_1()
                                .border_color(theme.accent)
                                .flex()
                                .items_center()
                                .gap(px(3.0))
                                .text_size(px(8.5))
                                .text_color(theme.accent_soft)
                                .child(widgets::icon("check-circle", 9.0, theme.accent_soft))
                                .child(label)
                                .into_any_element(),
                            None => div()
                                .flex_shrink_0()
                                .flex()
                                .items_center()
                                .gap(px(3.0))
                                .text_size(px(9.0))
                                .font_family(MONO)
                                .text_color(theme.faint)
                                .child(widgets::icon("download", 10.0, theme.faint))
                                .child(compact(downloads))
                                .into_any_element(),
                        }),
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .line_height(px(15.0))
                        .max_h(px(30.0))
                        .text_color(theme.muted)
                        .child(if summary.is_empty() {
                            "—".to_string()
                        } else {
                            summary
                        }),
                )
                .child(
                    div()
                        .w_full()
                        .flex()
                        .items_center()
                        .gap(px(6.0))
                        .pt(px(7.0))
                        .border_t_1()
                        .border_color(theme.border_soft)
                        .when(owned.is_some(), |el| {
                            el.child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(3.0))
                                    .text_size(px(9.0))
                                    .font_family(MONO)
                                    .text_color(theme.faint)
                                    .child(widgets::icon("download", 10.0, theme.faint))
                                    .child(compact(downloads)),
                            )
                        })
                        .children(footer_env)
                        .children(dots)
                        .child(
                            div()
                                .flex_1()
                                .min_w(px(0.0))
                                .text_size(px(9.0))
                                .font_family(MONO)
                                .text_color(theme.muted)
                                .truncate()
                                .child(game_text),
                        )
                        .child(widgets::icon("caret-right", 11.0, theme.faint)),
                );
            grid = grid.child(card);
        }
    }
    let view_more = view.clone();
    let more = if !app.content.loading && (app.content.total as usize) > app.content.hits.len() {
        Some(
            div()
                .w_full()
                .flex()
                .justify_center()
                .child(widgets::ghost_button(
                    "content-more",
                    format!(
                        "Tải thêm ({} / {})",
                        app.content.hits.len(),
                        app.content.total
                    ),
                    &theme,
                    move |_, _, cx| {
                        let _ = view_more.update(cx, |this, cx| run_search(this, cx, false));
                    },
                )),
        )
    } else {
        None
    };
    let error = if app.content.error.is_empty() {
        None
    } else {
        Some(
            div()
                .w_full()
                .flex()
                .items_start()
                .gap(px(6.0))
                .p(px(9.0))
                .rounded(px(8.0))
                .bg(gpui::rgba(0xf871711a))
                .border_1()
                .border_color(gpui::rgba(0xf8717155))
                .text_size(px(10.0))
                .text_color(theme.bad)
                .child(widgets::icon("warning-circle", 12.0, theme.bad))
                .child(app.content.error.clone()),
        )
    };
    let _ = &mut filter_row2;
    let mut page = div()
        .relative()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .w_full()
        .child(header);
    page = page.child(filter_row1);
    if let Some(note) = env_note {
        page = page.child(note);
    }
    page = page.child(filter_row2);
    if let Some(error) = error {
        page = page.child(error);
    }
    page = page.child(grid);
    if let Some(more) = more {
        page = page.child(more);
    }
    if menu.is_some() {
        page = page.child(menu_backdrop(&view));
    }
    page.into_any_element()
}

fn detail_page(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let Some(hit) = app.content.selected.clone() else {
        return list_page(app, cx);
    };
    let detail = app.content.detail.clone().unwrap_or(Value::Null);
    let versions = app.content.selected_versions.clone();
    let latest = versions.first().cloned().unwrap_or(Value::Null);
    let kind = app.content.kind.clone();
    let is_mods = kind == "mods";
    let name = text_of(&hit, "name");
    let author = text_of(&hit, "author");
    let source = text_of(&hit, "source");
    let summary = if !text_of(&detail, "summary").is_empty() {
        text_of(&detail, "summary")
    } else {
        text_of(&hit, "summary")
    };
    let icon = if !text_of(&detail, "icon").is_empty() {
        text_of(&detail, "icon")
    } else {
        text_of(&hit, "icon")
    };
    let downloads = if num_of(&detail, "downloads") > 0 {
        num_of(&detail, "downloads")
    } else {
        num_of(&hit, "downloads")
    };
    let updated = if !text_of(&detail, "updated").is_empty() {
        text_of(&detail, "updated")
    } else {
        text_of(&hit, "updated")
    };
    let loaders = {
        let list = list_of(&detail, "loaders");
        if list.is_empty() {
            list_of(&hit, "loaders")
        } else {
            list
        }
    };
    let view_back = view.clone();
    let back = move |_: &gpui::ClickEvent, _: &mut gpui::Window, cx: &mut gpui::App| {
        let _ = view_back.update(cx, |this, cx| {
            this.content.view = "list".into();
            this.content.menu = None;
            cx.notify();
        });
    };
    let subtitle = format!(
        "{} · {}",
        if author.is_empty() { "—" } else { &author },
        if source == "curseforge" { "CurseForge" } else { "Modrinth" }
    );
    let view_close = view.clone();
    let header = header_bar(
        &theme,
        name.clone(),
        subtitle,
        back,
        div()
            .id("content-detail-close")
            .size(px(28.0))
            .rounded(px(6.0))
            .bg(theme.elevated)
            .border_1()
            .border_color(theme.border)
            .flex()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .on_click(move |_, _, cx| {
                let _ = view_close.update(cx, |this, cx| close(this, cx));
            })
            .child(widgets::icon("x", 12.0, theme.muted)),
    );

    let thumb = icon_thumb(app, &icon, 56.0, &theme);
    let loader_tags = if is_mods && !loaders.is_empty() {
        Some(loader_dots(&theme, &loaders, 14.0))
    } else {
        None
    };
    let latest_version = text_of(&latest, "versionNumber");
    let latest_id = text_of(&latest, "id");
    let installing = app.content.installing.clone();
    let install_latest_label = if installing == latest_id && !latest_id.is_empty() {
        "Đang tải…"
    } else {
        "Tải bản mới nhất"
    };
    let view_install = view.clone();
    let view_refresh = view.clone();
    let refresh_button = div()
        .id("content-detail-refresh")
        .size(px(30.0))
        .rounded(px(7.0))
        .bg(theme.elevated)
        .border_1()
        .border_color(theme.border)
        .flex()
        .items_center()
        .justify_center()
        .cursor_pointer()
        .on_click(move |_, _, cx| {
            let _ = view_refresh.update(cx, |this, cx| {
                let hit = this.content.selected.clone();
                if let Some(hit) = hit {
                    open_detail(this, hit, cx);
                }
            });
        })
        .child(widgets::icon("arrow-clockwise", 13.0, theme.muted));
    let hero = div()
        .w_full()
        .flex()
        .items_start()
        .gap(px(14.0))
        .p(px(14.0))
        .rounded(px(12.0))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft)
        .child(thumb)
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .flex()
                .flex_col()
                .gap(px(4.0))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .child(
                            div()
                                .text_size(px(15.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(theme.text)
                                .truncate()
                                .child(name.clone()),
                        )
                        .children(loader_tags),
                )
                .child(
                    div()
                        .text_size(px(10.5))
                        .text_color(theme.faint)
                        .child(format!(
                            "{} · {} · {} lượt tải{}",
                            if author.is_empty() { "—" } else { &author },
                            if source == "curseforge" { "CurseForge" } else { "Modrinth" },
                            compact(downloads),
                            if updated.is_empty() {
                                String::new()
                            } else {
                                format!(" · {}", time_ago(&updated))
                            }
                        )),
                )
                .when(!summary.is_empty(), |el| {
                    el.child(
                        div()
                            .mt(px(4.0))
                            .text_size(px(10.5))
                            .line_height(px(16.0))
                            .text_color(theme.muted)
                            .child(summary.clone()),
                    )
                }),
        )
        .child(
            div()
                .flex_shrink_0()
                .flex()
                .flex_col()
                .items_end()
                .gap(px(5.0))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.0))
                        .child(refresh_button)
                        .child(
                            div()
                                .id("content-install-latest")
                                .h(px(34.0))
                                .px(px(12.0))
                                .rounded(px(8.0))
                                .bg(theme.accent)
                                .flex()
                                .items_center()
                                .gap(px(6.0))
                                .text_size(px(10.5))
                                .font_weight(FontWeight::BOLD)
                                .text_color(theme.on_accent)
                                .cursor_pointer()
                                .when(latest_id.is_empty() || !installing.is_empty(), |el| {
                                    el.opacity(0.6)
                                })
                                .on_click(move |_, _, cx| {
                                    if latest_id.is_empty() {
                                        return;
                                    }
                                    let id = latest_id.clone();
                                    let _ = view_install.update(cx, |this, cx| install(this, id, cx));
                                })
                                .child(widgets::icon("sparkle", 13.0, theme.on_accent))
                                .child(install_latest_label),
                        ),
                )
                .child(
                    div()
                        .text_size(px(9.0))
                        .font_family(MONO)
                        .text_color(theme.faint)
                        .truncate()
                        .child(latest_version),
                ),
        );

    let tabs = [
        ("about", "Tổng quan", "info"),
        ("versions", "Bản phát hành", "list"),
        ("changelog", "Nhật ký thay đổi", "clock"),
        ("gallery", "Thư viện ảnh", "image"),
    ];
    let active_tab = app.content.detail_tab.clone();
    let view_tab = view.clone();
    let mut tab_row = div().flex().items_center().gap(px(2.0)).w_full();
    for (key, label, icon) in tabs {
        let view = view_tab.clone();
        let active = active_tab == key;
        let count = match key {
            "versions" | "changelog" => Some(versions.len()),
            "gallery" => Some(
                detail
                    .get("gallery")
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or(0),
            ),
            _ => None,
        };
        let key_owned = key.to_string();
        tab_row = tab_row.child(
            div()
                .id(SharedString::from(format!("content-tab-{key}")))
                .h(px(30.0))
                .px(px(9.0))
                .rounded(px(6.0))
                .flex()
                .items_center()
                .gap(px(5.0))
                .text_size(px(10.5))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .when(active, |el| el.bg(theme.elevated))
                .cursor_pointer()
                .hover(|style| style.text_color(theme.text))
                .on_click(move |_, _, cx| {
                    let key = key_owned.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.content.detail_tab = key;
                        cx.notify();
                    });
                })
                .child(widgets::icon(
                    icon,
                    12.0,
                    if active { theme.accent } else { theme.faint },
                ))
                .child(label)
                .when(count.is_some(), |el| {
                    el.child(
                        div()
                            .text_size(px(8.5))
                            .font_family(MONO)
                            .text_color(theme.faint)
                            .child(count.unwrap_or(0).to_string()),
                    )
                }),
        );
    }
    let link_button = detail
        .get("links")
        .and_then(Value::as_array)
        .and_then(|rows| rows.first())
        .cloned()
        .map(|link| {
            let url = text_of(&link, "url");
            let label = text_of(&link, "label");
            let label = if label.is_empty() {
                "Mở trang".to_string()
            } else {
                label
            };
            div()
                .id("content-open-link")
                .flex_shrink_0()
                .h(px(28.0))
                .px(px(8.0))
                .rounded(px(6.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border)
                .flex()
                .items_center()
                .gap(px(4.0))
                .text_size(px(9.5))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.muted)
                .cursor_pointer()
                .on_click(move |_, _, _| {
                    let _ = open::that(&url);
                })
                .child(label)
                .child(widgets::icon("arrow-square-out", 10.0, theme.faint))
        });
    let tab_header = div()
        .w_full()
        .flex()
        .items_center()
        .gap(px(6.0))
        .child(tab_row)
        .child(div().flex_1())
        .children(link_button);

    let mut body = div().flex().flex_col().gap(px(10.0)).w_full();
    match active_tab.as_str() {
        "versions" => body = body.child(versions_tab(app, &theme, &versions, &view)),
        "changelog" => body = body.child(changelog_tab(app, &theme, &versions, &view)),
        "gallery" => body = body.child(gallery_tab(app, &theme, &detail)),
        _ => body = body.child(about_tab(app, &theme, &detail, &hit, &versions)),
    }

    let mut footer = div().flex().flex_col().gap(px(6.0)).w_full();
    if let Some(banner) = install_banner(&theme, app) {
        footer = footer.child(banner);
    } else if installing.is_empty() {
        footer = footer.child(
            div()
                .text_size(px(9.5))
                .text_color(theme.faint)
                .child(format!(
                    "Tệp sẽ được tải vào {}/ của {}.",
                    app.content.kind,
                    app.content
                        .instance_id
                        .as_ref()
                        .and_then(|id| app.instances.iter().find(|entry| &entry.id == id))
                        .map(|entry| entry.name.clone())
                        .unwrap_or_default()
                )),
        );
    } else {
        footer = footer.child(
            div()
                .w_full()
                .flex()
                .items_center()
                .gap(px(6.0))
                .p(px(9.0))
                .rounded(px(8.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border_soft)
                .text_size(px(10.0))
                .text_color(theme.muted)
                .child(widgets::spinner(12.0, theme.accent_soft))
                .child("Đang tải nội dung…"),
        );
    }

    div()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .w_full()
        .child(header)
        .child(hero)
        .child(tab_header)
        .child(body)
        .child(footer)
        .into_any_element()
}

fn about_tab(
    app: &mut LauncherApp,
    theme: &Theme,
    detail: &Value,
    hit: &Value,
    versions: &[Value],
) -> AnyElement {
    let downloads = if num_of(detail, "downloads") > 0 {
        num_of(detail, "downloads")
    } else {
        num_of(hit, "downloads")
    };
    let followers = if num_of(detail, "followers") > 0 {
        num_of(detail, "followers")
    } else {
        app.content
            .selected
            .as_ref()
            .map(|row| num_of(row, "follows"))
            .unwrap_or(0)
    };
    let created = text_of(detail, "created");
    let updated = if !text_of(detail, "updated").is_empty() {
        text_of(detail, "updated")
    } else {
        text_of(hit, "updated")
    };
    let source = text_of(detail, "source");
    let stats = div()
        .w_full()
        .flex()
        .flex_wrap()
        .gap(px(8.0))
        .child(stat_box(
            theme,
            "Nguồn",
            if source == "curseforge" {
                "CurseForge".into()
            } else {
                "Modrinth".into()
            },
        ))
        .child(stat_box(theme, "Lượt tải", compact(downloads)))
        .child(stat_box(
            theme,
            "Theo dõi",
            if followers > 0 {
                compact(followers)
            } else {
                "—".into()
            },
        ))
        .child(stat_box(
            theme,
            "Phát hành",
            if created.is_empty() {
                "—".into()
            } else {
                date_of(&created)
            },
        ))
        .child(stat_box(
            theme,
            "Cập nhật",
            if updated.is_empty() {
                "—".into()
            } else {
                time_ago(&updated)
            },
        ));

    let description = if !text_of(detail, "description").is_empty() {
        clean_text(&text_of(detail, "description"))
    } else if !text_of(detail, "summary").is_empty() {
        text_of(detail, "summary")
    } else {
        "Dự án này không kèm mô tả.".to_string()
    };
    let desc_box = info_box(
        theme,
        "Mô tả",
        "file",
        div()
            .text_size(px(10.5))
            .line_height(px(16.0))
            .text_color(theme.muted)
            .child(description),
    );

    let mut game_versions = list_of(detail, "gameVersions");
    if game_versions.is_empty() {
        game_versions = list_of(hit, "gameVersions");
    }
    let mut loader_list = list_of(detail, "loaders");
    if loader_list.is_empty() {
        loader_list = list_of(hit, "loaders");
    }
    let mut categories = list_of(detail, "categories");
    if categories.is_empty() {
        categories = list_of(hit, "tags");
    }
    let mut compat = div().flex().flex_wrap().gap(px(4.0));
    for version in game_versions.iter().take(8) {
        compat = compat.child(tag_chip(theme, version));
    }
    if game_versions.is_empty() {
        compat = compat.child(div().text_size(px(10.0)).text_color(theme.faint).child("—"));
    }
    let mut compat_body = div().flex().flex_col().gap(px(6.0)).child(
        div()
            .text_size(px(10.0))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(theme.text)
            .child("Minecraft: Java Edition"),
    );
    compat_body = compat_body.child(compat);
    if !loader_list.is_empty() && app.content.kind == "mods" {
        let mut row = div().flex().flex_wrap().items_center().gap(px(4.0));
        for loader in loader_list.iter() {
            row = row.child(
                div()
                    .h(px(22.0))
                    .px(px(6.0))
                    .rounded(px(5.0))
                    .bg(theme.elevated)
                    .border_1()
                    .border_color(theme.border_soft)
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .text_size(px(9.0))
                    .text_color(theme.muted)
                    .child(gpui::img(loader_image(loader)).size(px(11.0)))
                    .child(loader_name(loader)),
            );
        }
        compat_body = compat_body
            .child(
                div()
                    .mt(px(2.0))
                    .text_size(px(8.5))
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.faint)
                    .child("TRÌNH TẢI"),
            )
            .child(row);
    }
    let compat_box = info_box(theme, "Tương thích", "cube", compat_body);

    let mut tags_body = div().flex().flex_wrap().gap(px(4.0));
    for tag in categories.iter().take(20) {
        tags_body = tags_body.child(tag_chip(theme, tag));
    }
    if categories.is_empty() {
        tags_body = tags_body.child(div().text_size(px(10.0)).text_color(theme.faint).child("—"));
    }
    let tags_box = info_box(theme, "Thẻ", "list", tags_body);

    let creators = detail
        .get("creators")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut creator_body = div().flex().flex_col().gap(px(6.0));
    for person in creators.iter() {
        creator_body = creator_body.child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                .child(
                    div()
                        .size(px(20.0))
                        .rounded(px(5.0))
                        .bg(theme.elevated)
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(widgets::icon("user", 10.0, theme.faint)),
                )
                .child(
                    div()
                        .flex_1()
                        .text_size(px(10.0))
                        .text_color(theme.text)
                        .truncate()
                        .child(text_of(person, "name")),
                )
                .child(
                    div()
                        .text_size(px(8.5))
                        .font_family(MONO)
                        .text_color(theme.faint)
                        .child(text_of(person, "role")),
                ),
        );
    }
    let creators_box = if !creators.is_empty() {
        Some(info_box(theme, "Tác giả", "users", creator_body))
    } else {
        None
    };

    let links = detail
        .get("links")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut link_body = div().flex().flex_col().gap(px(2.0));
    for link in links.iter() {
        let url = text_of(link, "url");
        let label = text_of(link, "label");
        link_body = link_body.child(
            div()
                .id(SharedString::from(format!("content-link-{label}")))
                .h(px(24.0))
                .flex()
                .items_center()
                .gap(px(6.0))
                .text_size(px(10.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text)
                .cursor_pointer()
                .hover(|style| style.text_color(theme.accent_soft))
                .on_click(move |_, _, _| {
                    let _ = open::that(&url);
                })
                .child(div().flex_1().truncate().child(label))
                .child(widgets::icon("arrow-square-out", 10.0, theme.faint)),
        );
    }
    let links_box = if !links.is_empty() {
        Some(info_box(theme, "Liên kết", "link-simple", link_body))
    } else {
        None
    };

    let last_game = game_versions.last().cloned().unwrap_or_default();
    let detail_body = div()
        .w_full()
        .flex()
        .flex_col()
        .gap(px(2.0))
        .when(!text_of(detail, "slug").is_empty(), |el| {
            el.child(leader(theme, "Slug", text_of(detail, "slug")))
        })
        .when(!text_of(detail, "license").is_empty(), |el| {
            el.child(leader(theme, "Giấy phép", text_of(detail, "license")))
        })
        .child(leader(
            theme,
            "Trình tải",
            if loader_list.is_empty() {
                "Không rõ".into()
            } else {
                loader_list
                    .iter()
                    .map(|loader| loader_name(loader))
                    .collect::<Vec<_>>()
                    .join(", ")
            },
        ))
        .child(leader(
            theme,
            "Hỗ trợ",
            if last_game.is_empty() {
                "—".into()
            } else {
                format!("tới {last_game}")
            },
        ))
        .child(leader(theme, "Lượt tải", compact(downloads)))
        .when(!created.is_empty(), |el| {
            el.child(leader(theme, "Phát hành", date_of(&created)))
        })
        .when(!updated.is_empty(), |el| {
            el.child(leader(theme, "Cập nhật", date_of(&updated)))
        })
        .child(leader(theme, "Mã dự án", text_of(hit, "id")));
    let details_box = info_box(theme, "Chi tiết", "info", detail_body);

    let mut side = div().flex().flex_col().gap(px(8.0)).w(px(280.0)).flex_shrink_0();
    side = side.child(compat_box).child(tags_box);
    if let Some(creators_box) = creators_box {
        side = side.child(creators_box);
    }
    if let Some(links_box) = links_box {
        side = side.child(links_box);
    }
    side = side.child(details_box);
    let _ = versions;

    div()
        .w_full()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .child(stats)
        .child(
            div()
                .w_full()
                .flex()
                .items_start()
                .gap(px(10.0))
                .child(div().flex_1().min_w(px(0.0)).child(desc_box))
                .child(side),
        )
        .into_any_element()
}

fn versions_tab(
    app: &mut LauncherApp,
    theme: &Theme,
    versions: &[Value],
    view: &gpui::WeakEntity<LauncherApp>,
) -> AnyElement {
    let target = target_line(app);
    let mut list = div()
        .w_full()
        .flex()
        .flex_col()
        .rounded(px(10.0))
        .border_1()
        .border_color(theme.border_soft)
        .overflow_hidden();
    if versions.is_empty() {
        return div()
            .w_full()
            .flex()
            .flex_col()
            .gap(px(6.0))
            .child(
                div()
                    .text_size(px(9.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.muted)
                    .child(format!("BẢN DÙNG ĐƯỢC CHO {target}")),
            )
            .child(
                div()
                    .py(px(20.0))
                    .text_size(px(10.0))
                    .text_color(theme.faint)
                    .child(format!("Không có bản nào cho {target}")),
            )
            .into_any_element();
    }
    let installing = app.content.installing.clone();
    let current_game = app
        .content
        .instance_id
        .as_ref()
        .and_then(|id| app.instances.iter().find(|entry| &entry.id == id))
        .map(|entry| entry.version.clone())
        .unwrap_or_default();
    for (index, version) in versions.iter().enumerate() {
        let id = text_of(version, "id");
        let version_number = text_of(version, "versionNumber");
        let game_versions = list_of(version, "gameVersions");
        let loaders = list_of(version, "loaders");
        let size = num_of(version, "fileSize");
        let downloads = num_of(version, "downloads");
        let date = text_of(version, "datePublished");
        let first = index == 0;
        let busy = installing == id;
        let mut meta = String::new();
        if game_versions.contains(&current_game) {
            meta.push_str(&current_game);
        } else {
            meta.push_str(
                &game_versions
                    .iter()
                    .take(3)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" · "),
            );
        }
        if !bytes_label(size).is_empty() {
            if !meta.is_empty() {
                meta.push_str(" · ");
            }
            meta.push_str(&bytes_label(size));
        }
        if downloads > 0 {
            meta.push_str(&format!(" · {} lượt tải", compact(downloads)));
        }
        if !date.is_empty() {
            meta.push_str(&format!(" · {}", time_ago(&date)));
        }
        let view_install = view.clone();
        let install_id = id.clone();
        let deps = version
            .get("dependencies")
            .and_then(Value::as_array)
            .map(|rows| {
                rows.iter()
                    .filter(|row| {
                        row.get("dependency_type").and_then(Value::as_str) == Some("required")
                            || row.get("relationType").and_then(Value::as_u64) == Some(3)
                    })
                    .count()
            })
            .unwrap_or(0);
        if deps > 0 {
            meta.push_str(&format!(" · kèm {deps} thư viện"));
        }
        let mut row = div()
            .w_full()
            .flex()
            .items_center()
            .gap(px(8.0))
            .px(px(10.0))
            .py(px(7.0))
            .when(index > 0, |el| {
                el.border_t_1().border_color(theme.border_soft)
            })
            .when(first, |el| el.bg(theme.accent_dim))
            .child(
                div()
                    .w(px(3.0))
                    .h(px(26.0))
                    .rounded_full()
                    .bg(if first { theme.accent } else { theme.border }),
            )
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.0))
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.0))
                            .child(
                                div()
                                    .text_size(px(10.5))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(theme.text)
                                    .truncate()
                                    .child(version_number),
                            )
                            .when(first, |el| {
                                el.child(
                                    div()
                                        .h(px(16.0))
                                        .px(px(5.0))
                                        .rounded(px(4.0))
                                        .bg(theme.accent_dim)
                                        .flex()
                                        .items_center()
                                        .text_size(px(8.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(theme.accent_soft)
                                        .child("MỚI NHẤT"),
                                )
                            }),
                    )
                    .child(
                        div()
                            .text_size(px(9.0))
                            .font_family(MONO)
                            .text_color(theme.faint)
                            .truncate()
                            .child(meta),
                    ),
            )
            .children(if !loaders.is_empty() {
                Some(loader_dots(theme, &loaders, 11.0))
            } else {
                None
            })
            .child(
                div()
                    .id(SharedString::from(format!("content-get-{id}")))
                    .h(px(26.0))
                    .px(px(9.0))
                    .rounded(px(6.0))
                    .bg(if first { theme.accent } else { theme.elevated })
                    .border_1()
                    .border_color(if first { theme.accent } else { theme.border })
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .text_size(px(9.5))
                    .font_weight(FontWeight::BOLD)
                    .text_color(if first { theme.on_accent } else { theme.muted })
                    .cursor_pointer()
                    .when(busy, |el| el.opacity(0.6))
                    .on_click(move |_, _, cx| {
                        let id = install_id.clone();
                        let _ = view_install.update(cx, |this, cx| install(this, id, cx));
                    })
                    .child(widgets::icon(
                        "download-simple",
                        11.0,
                        if first { theme.on_accent } else { theme.muted },
                    ))
                    .child(if busy { "Đang tải…" } else { "Tải" }),
            );
        list = list.child(row);
    }
    div()
        .w_full()
        .flex()
        .flex_col()
        .gap(px(6.0))
        .child(
            div()
                .text_size(px(9.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.muted)
                .child(format!("BẢN DÙNG ĐƯỢC CHO {target}")),
        )
        .child(list)
        .into_any_element()
}

fn changelog_tab(
    app: &mut LauncherApp,
    theme: &Theme,
    versions: &[Value],
    view: &gpui::WeakEntity<LauncherApp>,
) -> AnyElement {
    if versions.is_empty() {
        return div()
            .py(px(20.0))
            .text_size(px(10.0))
            .text_color(theme.faint)
            .child("Chưa có bản phát hành nào để xem.")
            .into_any_element();
    }
    let open = app.content.changelog_open.clone();
    let logs = app.content.changelogs.clone();
    let mut list = div()
        .w_full()
        .flex()
        .flex_col()
        .rounded(px(10.0))
        .border_1()
        .border_color(theme.border_soft)
        .overflow_hidden();
    for (index, version) in versions.iter().enumerate() {
        let id = text_of(version, "id");
        let version_number = text_of(version, "versionNumber");
        let date = text_of(version, "datePublished");
        let size = num_of(version, "fileSize");
        let expanded = open == id;
        let text = clean_text(
            &logs
                .get(&id)
                .cloned()
                .filter(|text| !text.is_empty())
                .unwrap_or_else(|| text_of(version, "changelog")),
        );
        let view_click = view.clone();
        let id_click = id.clone();
        let mut row = div()
            .id(SharedString::from(format!("content-log-{id}")))
            .w_full()
            .flex()
            .flex_col()
            .when(index > 0, |el| {
                el.border_t_1().border_color(theme.border_soft)
            })
            .child(
                div()
            .id(SharedString::from(format!("content-log-head-{id}")))
            .w_full()
            .flex()
            .items_center()
            .gap(px(8.0))
            .px(px(10.0))
            .py(px(7.0))
            .when(expanded, |el| el.bg(theme.elevated))
            .cursor_pointer()
            .on_click(move |_, _, cx| {
                let id = id_click.clone();
                let _ = view_click.update(cx, |this, cx| {
                    this.content.changelog_open = if this.content.changelog_open == id {
                        String::new()
                    } else {
                        id.clone()
                    };
                    if !id.is_empty() {
                        load_changelog(this, id, cx);
                    }
                    cx.notify();
                });
            })
            .child(
                div()
                    .w(px(3.0))
                    .h(px(24.0))
                    .rounded_full()
                    .bg(if index == 0 { theme.accent } else { theme.border }),
            )
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.0))
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .text_size(px(10.5))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.text)
                            .truncate()
                            .child(version_number),
                    )
                    .child(
                        div()
                            .text_size(px(9.0))
                            .font_family(MONO)
                            .text_color(theme.faint)
                            .child(format!(
                                "{}{}{}",
                                if date.is_empty() {
                                    String::new()
                                } else {
                                    time_ago(&date)
                                },
                                if size > 0 {
                                    format!(" · {}", bytes_label(size))
                                } else {
                                    String::new()
                                },
                                ""
                            )),
                    ),
            )
            .child(widgets::icon(
                if expanded { "caret-up" } else { "caret-down" },
                11.0,
                theme.faint,
            )),
            );
        if expanded {
            let block = if text.is_empty() {
                div()
                    .p(px(9.0))
                    .rounded(px(8.0))
                    .bg(theme.surface)
                    .border_1()
                    .border_color(theme.border_soft)
                    .flex()
                    .items_center()
                    .gap(px(5.0))
                    .text_size(px(9.5))
                    .text_color(theme.muted)
                    .child(widgets::icon("warning-circle", 11.0, theme.faint))
                    .child("Bản này không kèm nhật ký thay đổi.")
            } else {
                div()
                    .p(px(9.0))
                    .rounded(px(8.0))
                    .bg(theme.surface)
                    .border_1()
                    .border_color(theme.border_soft)
                    .text_size(px(10.0))
                    .line_height(px(15.0))
                    .text_color(theme.muted)
                    .child(text)
            };
            row = row.child(block);
        }
        list = list.child(row);
    }
    div()
        .w_full()
        .flex()
        .flex_col()
        .gap(px(6.0))
        .child(
            div()
                .text_size(px(9.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.muted)
                .child("NHẬT KÝ THAY ĐỔI"),
        )
        .child(list)
        .into_any_element()
}

fn gallery_tab(app: &LauncherApp, theme: &Theme, detail: &Value) -> AnyElement {
    let gallery = detail
        .get("gallery")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if gallery.is_empty() {
        return div()
            .py(px(20.0))
            .text_size(px(10.0))
            .text_color(theme.faint)
            .child("Dự án này không có ảnh.")
            .into_any_element();
    }
    let mut grid = div().flex().flex_wrap().gap(px(10.0)).w_full();
    for shot in gallery.iter() {
        let url = {
            let url = text_of(shot, "url");
            if url.is_empty() {
                text_of(shot, "raw_url")
            } else {
                url
            }
        };
        let title = text_of(shot, "title");
        let mut card = div()
            .w(px(230.0))
            .flex_grow()
            .rounded(px(10.0))
            .bg(theme.surface)
            .border_1()
            .border_color(theme.border_soft)
            .overflow_hidden()
            .flex()
            .flex_col();
        if let Some(path) = app.icon_cache.get(&url) {
            card = card.child(
                gpui::img(path.clone())
                    .w_full()
                    .h(px(130.0))
                    .object_fit(gpui::ObjectFit::Cover),
            );
        } else {
            card = card.child(
                div()
                    .w_full()
                    .h(px(130.0))
                    .bg(theme.elevated)
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(widgets::spinner(16.0, theme.faint)),
            );
        }
        if !title.is_empty() {
            card = card.child(
                div()
                    .px(px(8.0))
                    .py(px(5.0))
                    .text_size(px(9.5))
                    .text_color(theme.muted)
                    .truncate()
                    .child(title),
            );
        }
        grid = grid.child(card);
    }
    grid.into_any_element()
}

const PACK_SOURCES: [(&str, &str); 3] = [
    ("modrinth", "Modrinth"),
    ("curseforge", "CurseForge"),
    ("lunar", "LunarModpack"),
];
const PACK_OUTER_LOADERS: [(&str, &str); 4] =
    [("forge", "Forge"), ("neoforge", "NeoForge"), ("fabric", "Fabric"), ("quilt", "Quilt")];

fn pack_source_name(source: &str) -> &'static str {
    match source {
        "curseforge" => "CurseForge",
        "lunar" => "LunarModpack",
        _ => "Modrinth",
    }
}

fn pack_sort_choices(source: &str) -> Vec<Choice> {
    let values: &[(&str, &str)] = match source {
        "lunar" => &[("newest", "Mới nhất"), ("downloads", "Tải nhiều"), ("name", "Tên A-Z")],
        "curseforge" => &[("relevance", "Liên quan"), ("downloads", "Tải nhiều"), ("updated", "Vừa cập nhật")],
        _ => &[
            ("relevance", "Liên quan"),
            ("downloads", "Tải nhiều"),
            ("follows", "Theo dõi"),
            ("newest", "Mới nhất"),
            ("updated", "Vừa cập nhật"),
        ],
    };
    choices(values)
}

pub fn modpack_open(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) {
    app.content.kind = "modpacks".into();
    app.content.instance_id = None;
    app.content.source = "modrinth".into();
    app.content.sort = "relevance".into();
    app.content.game.clear();
    app.content.loader.clear();
    app.content.category.clear();
    app.content.environment.clear();
    app.content.hits.clear();
    app.content.total = 0;
    app.content.error.clear();
    app.content.view = "list".into();
    app.content.menu = None;
    app.content.selected = None;
    app.content.selected_versions.clear();
    app.content.selected_version = None;
    app.content.detail = None;
    app.content.detail_tab = "about".into();
    app.content.pack_import = None;
    app.content.pack_import_error.clear();
    app.content.pack_stage.clear();
    app.content.pack_token.clear();
    app.content.pack_created = None;
    app.content.pack_result = None;
    app.content.install_error.clear();
    app.content.changelog_open.clear();
    app.content.changelogs.clear();
    app.content.version_game.clear();
    app.content.version_loader.clear();
    let input = app.content_search.clone();
    input.update(cx, |input, cx| {
        input.placeholder = "Tìm modpack…".into();
        input.clear(cx);
    });
    load_tags(app, cx);
    run_search(app, cx, true);
    cx.notify();
}

fn pick_pack_source(app: &mut LauncherApp, source: String, cx: &mut Context<LauncherApp>) {
    if app.content.source == source {
        return;
    }
    app.content.source = source.clone();
    app.content.sort = pack_sort_choices(&source)
        .first()
        .map(|choice| choice.value.clone())
        .unwrap_or_else(|| "relevance".into());
    app.content.category.clear();
    app.content.environment.clear();
    app.content.game.clear();
    app.content.loader.clear();
    if source == "lunar" {
        app.content.tags.clear();
        app.content.env_supported = false;
        cx.notify();
    } else {
        load_tags(app, cx);
    }
    run_search(app, cx, true);
    cx.notify();
}

fn pack_live_progress(app: &LauncherApp) -> Option<(f32, String)> {
    if app.content.pack_token.is_empty() {
        return None;
    }
    let row = app.progress.get(&app.content.pack_token)?;
    let phase = row.get("phase").and_then(Value::as_str).unwrap_or("");
    if phase == "done" {
        return None;
    }
    let total = row.get("totalBytes").and_then(Value::as_f64).unwrap_or(0.0);
    let done = row.get("bytesDone").and_then(Value::as_f64).unwrap_or(0.0);
    let count = row.get("total").and_then(Value::as_f64).unwrap_or(0.0);
    let finished = row.get("done").and_then(Value::as_f64).unwrap_or(0.0);
    let percent = if total > 0.0 {
        (done / total * 100.0) as f32
    } else if count > 0.0 {
        (finished / count * 100.0) as f32
    } else {
        0.0
    };
    Some((percent, format!("Đang cài modpack · {percent:.0}%")))
}

pub(crate) fn pack_open_hit(app: &mut LauncherApp, hit: Value, cx: &mut Context<LauncherApp>) {
    app.content.view = "detail".into();
    app.content.menu = None;
    app.content.pack_import = None;
    app.content.pack_import_error.clear();
    app.content.selected = Some(hit.clone());
    app.content.selected_versions.clear();
    app.content.selected_version = None;
    app.content.detail = None;
    app.content.detail_loading = true;
    app.content.versions_loading = true;
    app.content.detail_tab = "about".into();
    app.content.pack_created = None;
    app.content.pack_result = None;
    app.content.pack_stage.clear();
    app.content.pack_token.clear();
    app.content.install_error.clear();
    app.content.changelog_open.clear();
    app.content.changelogs.clear();
    app.content.version_game.clear();
    app.content.version_loader.clear();
    let name = text_of(&hit, "name");
    let name_input = app.name_input.clone();
    name_input.update(cx, |input, cx| input.set_text(name, cx));
    let memory_input = app.memory_input.clone();
    memory_input.update(cx, |input, cx| input.set_text("4096", cx));
    let dir_input = app.create_dir_input.clone();
    dir_input.update(cx, |input, cx| input.clear(cx));
    let source = text_of(&hit, "source");
    let source = if source.is_empty() {
        app.content.source.clone()
    } else {
        source
    };
    let id = text_of(&hit, "id");
    let rx = app
        .backend
        .content_versions("modpacks".into(), source.clone(), id.clone());
    app.on_result(cx, rx, |this, value, cx| {
        this.content.versions_loading = false;
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            let rows = value
                .get("versions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            this.content.selected_version = rows.first().map(|row| text_of(row, "id"));
            this.content.selected_versions = rows;
        }
        cx.notify();
    });
    let rx = app.backend.content_project("modpacks".into(), source, id);
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
        cx.notify();
    });
}

fn pack_install(app: &mut LauncherApp, version_id: Option<String>, cx: &mut Context<LauncherApp>) {
    if !app.content.pack_stage.is_empty() {
        return;
    }
    let token = format!("pack-{}", chrono::Utc::now().timestamp_millis());
    app.content.pack_token = token.clone();
    app.content.pack_stage = "install".into();
    app.content.install_error.clear();
    app.content.pack_created = None;
    app.content.pack_result = None;
    let name = app.name_input.read(cx).text().trim().to_string();
    let memory = app
        .memory_input
        .read(cx)
        .text()
        .trim()
        .parse::<u32>()
        .unwrap_or(4096)
        .clamp(1024, 32768);
    let typed_dir = app.create_dir_input.read(cx).text().trim().to_string();
    let dir = if typed_dir.is_empty() {
        None
    } else {
        Some(typed_dir)
    };
    let rx = if let Some(import) = app.content.pack_import.clone() {
        let path = text_of(&import, "path");
        app.backend.modpack_import_file(path, name, memory, token, dir, None)
    } else {
        let Some(hit) = app.content.selected.clone() else {
            app.content.pack_stage.clear();
            return;
        };
        let version = version_id
            .or_else(|| app.content.selected_version.clone())
            .unwrap_or_default();
        let source = text_of(&hit, "source");
        let source = if source.is_empty() {
            app.content.source.clone()
        } else {
            source
        };
        app.backend.modpack_install(json!({
            "source": source,
            "packId": text_of(&hit, "id"),
            "fileId": version,
            "name": name,
            "slug": text_of(&hit, "slug"),
            "memoryMb": memory,
            "token": token,
            "dir": dir,
            "icon": text_of(&hit, "icon"),
        }))
    };
    app.on_result(cx, rx, |this, value, cx| {
        this.content.pack_stage.clear();
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            this.content.pack_created = value.get("instance").cloned();
            this.content.pack_result = value.get("plan").cloned();
            this.refresh_instances();
            let name = value
                .pointer("/instance/name")
                .and_then(Value::as_str)
                .unwrap_or("Modpack")
                .to_string();
            this.toast("ok", "Đang cài modpack", name, cx);
        } else {
            this.content.install_error = value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Không cài được modpack.")
                .to_string();
        }
        cx.notify();
    });
}

fn pack_accept_import(app: &mut LauncherApp, path: String, cx: &mut Context<LauncherApp>) {
    let file_name = std::path::Path::new(&path)
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let lower = file_name.to_lowercase();
    if !(lower.ends_with(".mrpack") || lower.ends_with(".zip")) {
        app.content.pack_import_error =
            "Chỉ nhận tệp .mrpack hoặc .zip (CurseForge hay bản xuất profile của LunarSpace).".into();
        return;
    }
    app.content.pack_import_error.clear();
    app.content.pack_import = Some(json!({"path": path, "name": file_name}));
    app.content.selected = None;
    app.content.view = "detail".into();
    app.content.detail = None;
    app.content.selected_versions.clear();
    app.content.selected_version = None;
    app.content.detail_tab = "about".into();
    app.content.pack_created = None;
    app.content.pack_result = None;
    app.content.pack_stage.clear();
    app.content.pack_token.clear();
    app.content.install_error.clear();
    app.modal = crate::ui::app::Modal::None;
    let stem = file_name
        .rsplit_once('.')
        .map(|(head, _)| head.to_string())
        .unwrap_or(file_name);
    let name_input = app.name_input.clone();
    name_input.update(cx, |input, cx| input.set_text(stem, cx));
    let memory_input = app.memory_input.clone();
    memory_input.update(cx, |input, cx| input.set_text("4096", cx));
    let dir_input = app.create_dir_input.clone();
    dir_input.update(cx, |input, cx| input.clear(cx));
    let rx = app.backend.modpack_import_plan(path);
    app.on_result(cx, rx, |this, value, cx| {
        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            if let Some(import) = this.content.pack_import.as_mut() {
                if let Some(object) = import.as_object_mut() {
                    object.insert("plan".into(), value);
                }
            }
        }
        cx.notify();
    });
    cx.notify();
}

fn pack_import_footer(app: &mut LauncherApp, theme: &Theme, view: &gpui::WeakEntity<LauncherApp>) -> AnyElement {
    let busy = !app.content.pack_stage.is_empty();
    let view_browse = view.clone();
    let view_install = view.clone();
    let memory_input = app.memory_input.clone();
    let dir_input = app.create_dir_input.clone();
    let picked = app
        .content
        .selected_versions
        .iter()
        .find(|row| app.content.selected_version.as_deref() == Some(text_of(row, "id").as_str()))
        .cloned();
    let label = if busy {
        if app.content.pack_stage == "install" {
            "Đang cài modpack…"
        } else {
            "Đang tải gói…"
        }
    } else {
        "Cài đặt modpack"
    };
    let mut panel = div()
        .w_full()
        .flex()
        .flex_col()
        .gap(px(6.0))
        .p(px(10.0))
        .rounded(px(10.0))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft)
        .child(
            div()
                .w_full()
                .flex()
                .items_end()
                .gap(px(8.0))
                .child(
                    div()
                        .flex_1()
                        .min_w(px(0.0))
                        .flex()
                        .flex_col()
                        .gap(px(3.0))
                        .child(
                            div()
                                .text_size(px(8.5))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.faint)
                                .child("TÊN PHIÊN BẢN"),
                        )
                        .child(widgets::text_input_box(theme).child(app.name_input.clone())),
                )
                .child(
                    div()
                        .w(px(104.0))
                        .flex_shrink_0()
                        .flex()
                        .flex_col()
                        .gap(px(3.0))
                        .child(
                            div()
                                .text_size(px(8.5))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.faint)
                                .child("RAM (MB)"),
                        )
                        .child(widgets::text_input_box(theme).child(memory_input)),
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
                                .text_size(px(8.5))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(theme.faint)
                                .child("THƯ MỤC"),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.0))
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w(px(0.0))
                                        .child(widgets::text_input_box(theme).child(dir_input)),
                                )
                                .child(
                                    div()
                                        .id("pack-browse-folder")
                                        .size(px(32.0))
                                        .rounded(px(7.0))
                                        .bg(theme.elevated)
                                        .border_1()
                                        .border_color(theme.border)
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .cursor_pointer()
                                        .on_click(move |_, _, cx| {
                                            let view = view_browse.clone();
                                            cx.spawn(async move |cx| {
                                                let picked = rfd::AsyncFileDialog::new().pick_folder().await;
                                                if let Some(folder) = picked {
                                                    let path = folder.path().to_string_lossy().into_owned();
                                                    let _ = view.update(cx, |this, cx| {
                                                        let input = this.create_dir_input.clone();
                                                        input.update(cx, |input, cx| input.set_text(path, cx));
                                                        cx.notify();
                                                    });
                                                }
                                            })
                                            .detach();
                                        })
                                        .child(widgets::icon("folder-open", 13.0, theme.muted)),
                                ),
                        ),
                )
                .child(
                    div()
                        .id("pack-install")
                        .h(px(34.0))
                        .px(px(14.0))
                        .rounded(px(8.0))
                        .bg(theme.accent)
                        .flex()
                        .items_center()
                        .gap(px(6.0))
                        .text_size(px(10.5))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.on_accent)
                        .cursor_pointer()
                        .when(busy, |el| el.opacity(0.65))
                        .on_click(move |_, _, cx| {
                            let _ = view_install.update(cx, |this, cx| pack_install(this, None, cx));
                        })
                        .child(widgets::icon(
                            if busy { "arrow-clockwise" } else { "download-simple" },
                            13.0,
                            theme.on_accent,
                        ))
                        .child(label),
                ),
        );
    if let Some(picked) = picked {
        panel = panel.child(
            div()
                .text_size(px(9.5))
                .text_color(theme.faint)
                .child(format!(
                    "Sẽ cài bản {} · Minecraft {}{}",
                    text_of(&picked, "versionNumber"),
                    list_of(&picked, "gameVersions")
                        .first()
                        .cloned()
                        .unwrap_or_default(),
                    {
                        let loaders = list_of(&picked, "loaders");
                        if loaders.is_empty() {
                            String::new()
                        } else {
                            format!(
                                " · {}",
                                loaders
                                    .iter()
                                    .map(|loader| loader_name(loader))
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            )
                        }
                    }
                )),
        );
    }
    if let Some((percent, label)) = pack_live_progress(app) {
        panel = panel
            .child(
                div()
                    .w_full()
                    .text_size(px(9.5))
                    .text_color(theme.muted)
                    .child(label),
            )
            .child(widgets::progress_bar(percent, theme, false));
    }
    if !app.content.install_error.is_empty() {
        panel = panel.child(
            div()
                .w_full()
                .flex()
                .items_start()
                .gap(px(6.0))
                .p(px(9.0))
                .rounded(px(8.0))
                .bg(gpui::rgba(0xf871711a))
                .border_1()
                .border_color(gpui::rgba(0xf8717155))
                .text_size(px(10.0))
                .text_color(theme.bad)
                .child(widgets::icon("warning-circle", 12.0, theme.bad))
                .child(app.content.install_error.clone()),
        );
    }
    if let Some(created) = app.content.pack_created.clone() {
        let view_open = view.clone();
        let id = text_of(&created, "id");
        let name = text_of(&created, "name");
        let mut banner = div()
            .w_full()
            .flex()
            .flex_col()
            .gap(px(3.0))
            .p(px(9.0))
            .rounded(px(8.0))
            .bg(gpui::rgba(0x22c55e1a))
            .border_1()
            .border_color(gpui::rgba(0x22c55e55))
            .child(
                div()
                    .w_full()
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .text_size(px(10.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.ok)
                    .child(widgets::icon("check-circle", 12.0, theme.ok))
                    .child(div().flex_1().truncate().child(format!("Đã tạo {name}")))
                    .child(
                        div()
                            .id("pack-open-instance")
                            .text_size(px(10.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(theme.accent_soft)
                            .cursor_pointer()
                            .on_click(move |_, _, cx| {
                                let id = id.clone();
                                let _ = view_open.update(cx, |this, cx| {
                                    if !id.is_empty() {
                                        this.open_instance(id, cx);
                                    }
                                });
                            })
                            .child("Mở"),
                    ),
            );
        if let Some(result) = app.content.pack_result.clone() {
            let files = num_of(&result, "files");
            let mc = text_of(&result, "mc");
            let loader = text_of(&result, "loader");
            banner = banner.child(
                div()
                    .text_size(px(9.5))
                    .font_family(MONO)
                    .text_color(theme.ok)
                    .child(format!(
                        "{files} tệp{}",
                        if mc.is_empty() {
                            String::new()
                        } else {
                            format!(" · {mc}{}", if loader.is_empty() { String::new() } else { format!(" · {loader}") })
                        }
                    )),
            );
        }
        panel = panel.child(banner);
    }
    panel.into_any_element()
}

pub fn modpack_page(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) -> AnyElement {
    if app.content.view == "detail" {
        pack_detail(app, cx)
    } else {
        pack_list(app, cx)
    }
}

fn pack_list(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let source = app.content.source.clone();
    let view_source = view.clone();
    let view_reload = view.clone();
    let view_import = view.clone();
    let subtitle = format!(
        "{} gói · {}",
        if app.content.total > 0 {
            app.content.total.to_string()
        } else {
            "—".into()
        },
        PACK_SOURCES
            .iter()
            .map(|(_, name)| *name)
            .collect::<Vec<_>>()
            .join(" · ")
    );
    let header = div()
        .w_full()
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .flex()
                .flex_col()
                .child(
                    div()
                        .text_size(px(18.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.text)
                        .child("Modpack"),
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.faint)
                        .truncate()
                        .child(subtitle),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(2.0))
                .p(px(2.0))
                .rounded(px(8.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border)
                .children(PACK_SOURCES.into_iter().map(|(id, name)| {
                    let view = view_source.clone();
                    let active = source == id;
                    div()
                        .id(SharedString::from(format!("pack-source-{id}")))
                        .h(px(28.0))
                        .px(px(10.0))
                        .rounded(px(6.0))
                        .flex()
                        .items_center()
                        .text_size(px(10.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(if active { theme.accent_soft } else { theme.muted })
                        .when(active, |el| {
                            el.bg(theme.surface).border_1().border_color(theme.border)
                        })
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let id = id.to_string();
                            let _ = view.update(cx, |this, cx| pick_pack_source(this, id, cx));
                        })
                        .child(name)
                })),
        )
        .child(
            div()
                .id("pack-reload")
                .size(px(30.0))
                .rounded(px(7.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border)
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view_reload.update(cx, |this, cx| run_search(this, cx, true));
                })
                .child(widgets::icon(
                    if app.content.loading { "spinner" } else { "arrow-clockwise" },
                    13.0,
                    theme.muted,
                )),
        )
        .child(
            div()
                .id("pack-import-open")
                .h(px(32.0))
                .px(px(11.0))
                .rounded(px(8.0))
                .bg(theme.accent)
                .flex()
                .items_center()
                .gap(px(5.0))
                .text_size(px(10.5))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.on_accent)
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view_import.update(cx, |this, cx| {
                        this.content.pack_import_error.clear();
                        this.modal = crate::ui::app::Modal::PackImport;
                        cx.notify();
                    });
                })
                .child(widgets::icon("file-arrow-up", 12.0, theme.on_accent))
                .child("Nhập tệp"),
        );

    let mut game_values: Vec<String> = Vec::new();
    for hit in app.content.hits.iter() {
        for version in list_of(hit, "gameVersions") {
            if !version.is_empty() && !game_values.contains(&version) {
                game_values.push(version);
            }
        }
    }
    game_values.sort_by(|a, b| b.cmp(a));
    let mut game_choices = vec![Choice {
        value: String::new(),
        label: "Mọi phiên bản game".into(),
    }];
    game_choices.extend(game_values.into_iter().map(|value| Choice {
        label: value.clone(),
        value,
    }));
    let mut loader_choices = vec![Choice {
        value: String::new(),
        label: "Mọi loader".into(),
    }];
    loader_choices.extend(PACK_OUTER_LOADERS.iter().map(|(value, label)| Choice {
        value: value.to_string(),
        label: label.to_string(),
    }));
    let mut tag_choices = vec![Choice {
        value: String::new(),
        label: "Mọi thẻ".into(),
    }];
    for row in app.content.tags.iter() {
        let value = text_of(row, "value");
        if !value.is_empty() {
            tag_choices.push(Choice {
                value,
                label: text_of(row, "label"),
            });
        }
    }
    let env_choices = choices(&[
        ("", "Mọi môi trường"),
        ("client", "Máy khách"),
        ("server", "Máy chủ"),
        ("both", "Cả hai"),
    ]);
    let menu = app.content.menu.clone();
    let has_filter = !app.content.game.is_empty()
        || !app.content.loader.is_empty()
        || !app.content.category.is_empty()
        || !app.content.environment.is_empty();
    let view_clear = view.clone();
    let mut filters = div().flex().flex_wrap().items_center().gap(px(8.0)).w_full();
    filters = filters
        .child(div().w(px(170.0)).child(dropdown(
            &theme,
            "game",
            &app.content.game,
            "Mọi phiên bản game",
            game_choices,
            false,
            menu.as_deref() == Some("game"),
            view.clone(),
            170.0,
        )))
        .child(div().w(px(140.0)).child(dropdown(
            &theme,
            "loader",
            &app.content.loader,
            "Mọi loader",
            loader_choices,
            false,
            menu.as_deref() == Some("loader"),
            view.clone(),
            140.0,
        )))
        .child(div().w(px(150.0)).child(dropdown(
            &theme,
            "tag",
            &app.content.category,
            "Mọi thẻ",
            tag_choices,
            false,
            menu.as_deref() == Some("tag"),
            view.clone(),
            150.0,
        )))
        .child(div().w(px(160.0)).child(dropdown(
            &theme,
            "environment",
            &app.content.environment,
            "Mọi môi trường",
            env_choices,
            !app.content.env_supported,
            menu.as_deref() == Some("environment"),
            view.clone(),
            160.0,
        )));
    if has_filter {
        filters = filters.child(
            div()
                .id("pack-clear-filter")
                .h(px(34.0))
                .px(px(10.0))
                .rounded(px(8.0))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border)
                .flex()
                .items_center()
                .text_size(px(10.5))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.muted)
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let _ = view_clear.update(cx, |this, cx| {
                        this.content.game.clear();
                        this.content.loader.clear();
                        this.content.category.clear();
                        this.content.environment.clear();
                        run_search(this, cx, true);
                        cx.notify();
                    });
                })
                .child("Xoá lọc"),
        );
    }
    let env_note = (app.content.source == "curseforge" && !app.content.env_supported).then(|| {
        div()
            .w_full()
            .text_size(px(9.5))
            .text_color(theme.faint)
            .child("CurseForge không trả dữ liệu máy khách/máy chủ qua API, nên bộ lọc môi trường chỉ dùng được với Modrinth.")
    });
    let search_row = div()
        .w_full()
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .flex()
                .items_center()
                .gap(px(4.0))
                .child(
                    div()
                        .flex_1()
                        .min_w(px(0.0))
                        .child(widgets::text_input_box(&theme).child(app.content_search.clone())),
                )
                .child(
                    div()
                        .id("pack-search")
                        .size(px(34.0))
                        .rounded(px(8.0))
                        .bg(theme.accent)
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor_pointer()
                        .on_click({
                            let view = view.clone();
                            move |_, _, cx| {
                                let _ = view.update(cx, |this, cx| run_search(this, cx, true));
                            }
                        })
                        .child(widgets::icon("magnifying-glass", 14.0, theme.on_accent)),
                ),
        )
        .child(div().w(px(168.0)).child(dropdown(
            &theme,
            "sort",
            &app.content.sort,
            "Liên quan",
            pack_sort_choices(&app.content.source),
            false,
            menu.as_deref() == Some("sort"),
            view.clone(),
            168.0,
        )))
        .child(
            div()
                .text_size(px(10.0))
                .font_family(MONO)
                .text_color(theme.faint)
                .child(if app.content.loading && app.content.hits.is_empty() {
                    "· · ·".to_string()
                } else {
                    format!("{}/{}", app.content.hits.len(), app.content.total)
                }),
        );

    let mut grid = div().flex().flex_wrap().gap(px(12.0)).w_full();
    if app.content.loading && app.content.hits.is_empty() {
        for index in 0..6 {
            grid = grid.child(
                div()
                    .id(SharedString::from(format!("pack-skeleton-{index}")))
                    .w(px(290.0))
                    .flex_grow()
                    .h(px(118.0))
                    .rounded(px(12.0))
                    .bg(theme.surface)
                    .border_1()
                    .border_color(theme.border_soft)
                    .p(px(12.0))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(10.0))
                            .child(div().size(px(44.0)).rounded(px(8.0)).bg(theme.elevated))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(6.0))
                                    .flex_1()
                                    .child(div().h(px(9.0)).w(px(120.0)).rounded_full().bg(theme.elevated))
                                    .child(div().h(px(8.0)).w(px(70.0)).rounded_full().bg(theme.elevated)),
                            ),
                    ),
            );
        }
    } else if app.content.hits.is_empty() {
        grid = grid.child(
            div()
                .w_full()
                .py(px(48.0))
                .flex()
                .flex_col()
                .items_center()
                .gap(px(8.0))
                .child(widgets::icon("stack", 26.0, theme.faint))
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.muted)
                        .child(if app.content.error.is_empty() {
                            "Không tìm thấy modpack nào".to_string()
                        } else {
                            app.content.error.clone()
                        }),
                ),
        );
    } else {
        for hit in app.content.hits.iter().cloned().collect::<Vec<_>>() {
            let id = text_of(&hit, "id");
            let icon = text_of(&hit, "icon");
            let name = text_of(&hit, "name");
            let author = text_of(&hit, "author");
            let summary = text_of(&hit, "summary");
            let downloads = num_of(&hit, "downloads");
            let loaders = list_of(&hit, "loaders");
            let games = list_of(&hit, "gameVersions");
            let updated = text_of(&hit, "updated");
            let thumb = icon_thumb(app, &icon, 44.0, &theme);
            let view_open = view.clone();
            let hit_open = hit.clone();
            let card = div()
                .id(SharedString::from(format!("pack-card-{id}")))
                .w(px(290.0))
                .flex_grow()
                .p(px(12.0))
                .rounded(px(12.0))
                .bg(theme.surface)
                .border_1()
                .border_color(theme.border_soft)
                .flex()
                .flex_col()
                .gap(px(8.0))
                .cursor_pointer()
                .hover(|style| style.bg(theme.surface_hover).border_color(theme.border))
                .on_click(move |_, _, cx| {
                    let hit = hit_open.clone();
                    let _ = view_open.update(cx, |this, cx| pack_open_hit(this, hit, cx));
                })
                .child(
                    div()
                        .flex()
                        .items_start()
                        .gap(px(10.0))
                        .child(thumb)
                        .child(
                            div()
                                .flex_1()
                                .min_w(px(0.0))
                                .flex()
                                .flex_col()
                                .gap(px(2.0))
                                .child(
                                    div()
                                        .text_size(px(11.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(theme.text)
                                        .truncate()
                                        .child(name),
                                )
                                .child(
                                    div()
                                        .text_size(px(9.5))
                                        .text_color(theme.faint)
                                        .truncate()
                                        .child(if author.is_empty() {
                                            "—".to_string()
                                        } else {
                                            author
                                        }),
                                ),
                        )
                        .child(
                            div()
                                .flex_shrink_0()
                                .flex()
                                .items_center()
                                .gap(px(3.0))
                                .text_size(px(9.0))
                                .font_family(MONO)
                                .text_color(theme.faint)
                                .child(widgets::icon("download", 10.0, theme.faint))
                                .child(compact(downloads)),
                        ),
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .line_height(px(15.0))
                        .max_h(px(30.0))
                        .text_color(theme.muted)
                        .child(if summary.is_empty() {
                            "—".to_string()
                        } else {
                            summary
                        }),
                )
                .child(
                    div()
                        .w_full()
                        .flex()
                        .items_center()
                        .gap(px(6.0))
                        .pt(px(7.0))
                        .border_t_1()
                        .border_color(theme.border_soft)
                        .children(if loaders.is_empty() {
                            None
                        } else {
                            Some(loader_dots(&theme, &loaders, 12.0))
                        })
                        .child(
                            div()
                                .flex_1()
                                .min_w(px(0.0))
                                .text_size(px(9.0))
                                .font_family(MONO)
                                .text_color(theme.muted)
                                .truncate()
                                .child(format!(
                                    "{}{}",
                                    games.iter().take(3).cloned().collect::<Vec<_>>().join(" · "),
                                    if games.len() > 3 {
                                        format!(" +{}", games.len() - 3)
                                    } else {
                                        String::new()
                                    }
                                )),
                        )
                        .child(
                            div()
                                .text_size(px(9.0))
                                .font_family(MONO)
                                .text_color(theme.faint)
                                .child(time_ago(&updated)),
                        ),
                );
            grid = grid.child(card);
        }
    }
    let view_more = view.clone();
    let more = if !app.content.loading && (app.content.total as usize) > app.content.hits.len() {
        Some(
            div()
                .w_full()
                .flex()
                .justify_center()
                .child(widgets::ghost_button(
                    "pack-more",
                    format!(
                        "Tải thêm ({} / {})",
                        app.content.hits.len(),
                        app.content.total
                    ),
                    &theme,
                    move |_, _, cx| {
                        let _ = view_more.update(cx, |this, cx| run_search(this, cx, false));
                    },
                )),
        )
    } else {
        None
    };
    let mut scroll = div()
        .id("pack-list-scroll")
        .flex_1()
        .min_h(px(0.0))
        .w_full()
        .overflow_y_scroll()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .pr(px(4.0))
        .child(filters);
    if let Some(note) = env_note {
        scroll = scroll.child(note);
    }
    scroll = scroll.child(search_row).child(grid);
    if let Some(more) = more {
        scroll = scroll.child(more);
    }
    let mut page = div()
        .relative()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .w_full()
        .h_full()
        .min_h(px(0.0))
        .p(px(22.0))
        .child(header)
        .child(scroll);
    if app.content.menu.is_some() {
        page = page.child(menu_backdrop(&view));
    }
    page.into_any_element()
}

fn pack_detail(app: &mut LauncherApp, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let imported = app.content.pack_import.clone();
    let hit = app.content.selected.clone().unwrap_or(Value::Null);
    let detail = app.content.detail.clone().unwrap_or(Value::Null);
    let versions = app.content.selected_versions.clone();
    let latest = versions.first().cloned().unwrap_or(Value::Null);
    let name = if let Some(import) = imported.as_ref() {
        text_of(import, "name")
    } else {
        text_of(&hit, "name")
    };
    let author = text_of(&hit, "author");
    let source = {
        let source = text_of(&hit, "source");
        if source.is_empty() {
            app.content.source.clone()
        } else {
            source
        }
    };
    let summary = if !text_of(&detail, "summary").is_empty() {
        text_of(&detail, "summary")
    } else {
        text_of(&hit, "summary")
    };
    let icon = {
        let icon = text_of(&detail, "icon");
        if icon.is_empty() {
            text_of(&hit, "icon")
        } else {
            icon
        }
    };
    let downloads = {
        let value = num_of(&detail, "downloads");
        if value > 0 {
            value
        } else {
            num_of(&hit, "downloads")
        }
    };
    let updated = {
        let value = text_of(&detail, "updated");
        if value.is_empty() {
            text_of(&hit, "updated")
        } else {
            value
        }
    };
    let view_back = view.clone();
    let busy = !app.content.pack_stage.is_empty();
    let latest_version = text_of(&latest, "versionNumber");
    let latest_id = text_of(&latest, "id");
    let view_install_latest = view.clone();
    let trailing = if imported.is_some() {
        div().into_any_element()
    } else {
        div()
            .flex_shrink_0()
            .flex()
            .flex_col()
            .items_end()
            .gap(px(3.0))
            .child(
                div()
                    .id("pack-install-latest")
                    .h(px(32.0))
                    .px(px(12.0))
                    .rounded(px(8.0))
                    .bg(theme.accent)
                    .flex()
                    .items_center()
                    .gap(px(5.0))
                    .text_size(px(10.5))
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.on_accent)
                    .cursor_pointer()
                    .when(busy || latest_id.is_empty(), |el| el.opacity(0.65))
                    .on_click(move |_, _, cx| {
                        if latest_id.is_empty() {
                            return;
                        }
                        let id = latest_id.clone();
                        let _ = view_install_latest
                            .update(cx, |this, cx| pack_install(this, Some(id), cx));
                    })
                    .child(widgets::icon("sparkle", 13.0, theme.on_accent))
                    .child("Cài bản mới nhất"),
            )
            .child(
                div()
                    .text_size(px(9.0))
                    .font_family(MONO)
                    .text_color(theme.faint)
                    .truncate()
                    .child(latest_version),
            )
            .into_any_element()
    };
    let subtitle = if imported.is_some() {
        "Modpack từ tệp".to_string()
    } else {
        format!(
            "{} · {}",
            if author.is_empty() { "—" } else { &author },
            pack_source_name(&source)
        )
    };
    let header = header_bar(
        &theme,
        name.clone(),
        subtitle,
        move |_, _, cx| {
            let _ = view_back.update(cx, |this, cx| {
                this.content.view = "list".into();
                this.content.menu = None;
                cx.notify();
            });
        },
        trailing,
    );
    let thumb = if imported.is_some() {
        div()
            .size(px(56.0))
            .rounded(px(10.0))
            .bg(theme.elevated)
            .border_1()
            .border_color(theme.border_soft)
            .flex()
            .items_center()
            .justify_center()
            .child(widgets::icon("file-arrow-up", 22.0, theme.accent_soft))
            .into_any_element()
    } else {
        icon_thumb(app, &icon, 56.0, &theme)
    };
    let hero = div()
        .w_full()
        .flex()
        .items_start()
        .gap(px(14.0))
        .p(px(14.0))
        .rounded(px(12.0))
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft)
        .child(thumb)
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .flex()
                .flex_col()
                .gap(px(4.0))
                .child(
                    div()
                        .text_size(px(15.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.text)
                        .truncate()
                        .child(name.clone()),
                )
                .child(
                    div()
                        .text_size(px(10.5))
                        .text_color(theme.faint)
                        .child(if let Some(import) = imported.as_ref() {
                            text_of(import, "path")
                        } else {
                            format!(
                                "{} · {} · {} lượt tải{}",
                                if author.is_empty() { "—" } else { &author },
                                pack_source_name(&source),
                                compact(downloads),
                                if updated.is_empty() {
                                    String::new()
                                } else {
                                    format!(" · {}", time_ago(&updated))
                                }
                            )
                        }),
                )
                .when(!summary.is_empty() && imported.is_none(), |el| {
                    el.child(
                        div()
                            .mt(px(4.0))
                            .text_size(px(10.5))
                            .line_height(px(16.0))
                            .text_color(theme.muted)
                            .child(summary.clone()),
                    )
                })
                .when(imported.is_some(), |el| {
                    el.child(
                        div()
                            .mt(px(4.0))
                            .text_size(px(10.5))
                            .line_height(px(16.0))
                            .text_color(theme.muted)
                            .child(".mrpack, .zip CurseForge, hoặc bản xuất profile của LunarSpace — mod, config và overrides được đưa vào phiên bản mới."),
                    )
                }),
        );

    let active_tab = app.content.detail_tab.clone();
    let tabs = [
        ("about", "Tổng quan", "info"),
        ("versions", "Bản phát hành", "list"),
        ("changelog", "Nhật ký thay đổi", "clock"),
        ("gallery", "Thư viện ảnh", "image"),
    ];
    let view_tab = view.clone();
    let mut tab_row = div().flex().items_center().gap(px(2.0)).w_full();
    if imported.is_none() {
        for (key, label, icon) in tabs {
            let view = view_tab.clone();
            let active = active_tab == key;
            let count = match key {
                "versions" | "changelog" => Some(versions.len()),
                "gallery" => Some(
                    detail
                        .get("gallery")
                        .and_then(Value::as_array)
                        .map(Vec::len)
                        .unwrap_or(0),
                ),
                _ => None,
            };
            let key_owned = key.to_string();
            tab_row = tab_row.child(
                div()
                    .id(SharedString::from(format!("pack-tab-{key}")))
                    .h(px(30.0))
                    .px(px(9.0))
                    .rounded(px(6.0))
                    .flex()
                    .items_center()
                    .gap(px(5.0))
                    .text_size(px(10.5))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(if active { theme.accent_soft } else { theme.muted })
                    .when(active, |el| el.bg(theme.elevated))
                    .cursor_pointer()
                    .hover(|style| style.text_color(theme.text))
                    .on_click(move |_, _, cx| {
                        let key = key_owned.clone();
                        let _ = view.update(cx, |this, cx| {
                            this.content.detail_tab = key;
                            cx.notify();
                        });
                    })
                    .child(widgets::icon(
                        icon,
                        12.0,
                        if active { theme.accent } else { theme.faint },
                    ))
                    .child(label)
                    .when(count.is_some(), |el| {
                        el.child(
                            div()
                                .text_size(px(8.5))
                                .font_family(MONO)
                                .text_color(theme.faint)
                                .child(count.unwrap_or(0).to_string()),
                        )
                    }),
            );
        }
        let link = detail
            .get("links")
            .and_then(Value::as_array)
            .and_then(|rows| rows.first())
            .cloned()
            .map(|link| {
                let url = text_of(&link, "url");
                let label = {
                    let label = text_of(&link, "label");
                    if label.is_empty() {
                        "Mở trang".to_string()
                    } else {
                        label
                    }
                };
                div()
                    .id("pack-open-link")
                    .flex_shrink_0()
                    .h(px(28.0))
                    .px(px(8.0))
                    .rounded(px(6.0))
                    .bg(theme.elevated)
                    .border_1()
                    .border_color(theme.border)
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .text_size(px(9.5))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.muted)
                    .cursor_pointer()
                    .on_click(move |_, _, _| {
                        let _ = open::that(&url);
                    })
                    .child(label)
                    .child(widgets::icon("arrow-square-out", 10.0, theme.faint))
            });
        tab_row = tab_row.child(div().flex_1()).children(link);
    }

    let mut body = div().flex().flex_col().gap(px(10.0)).w_full();
    if imported.is_some() {
        let memory = app.memory_input.read(cx).text().to_string();
        body = body.child(pack_import_body(app, &theme, memory));
    } else {
        match active_tab.as_str() {
            "versions" => body = body.child(pack_versions_tab(app, &theme, &versions, &view)),
            "changelog" => body = body.child(changelog_tab(app, &theme, &versions, &view)),
            "gallery" => body = body.child(gallery_tab(app, &theme, &detail)),
            _ => body = body.child(pack_about_tab(app, &theme, &detail, &hit, &versions)),
        }
    }
    let footer = pack_import_footer(app, &theme, &view);
    let mut fixed = div()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .w_full()
        .child(header)
        .child(hero);
    if imported.is_none() {
        fixed = fixed.child(tab_row);
    }
    let scroll = div()
        .id("pack-detail-scroll")
        .flex_1()
        .min_h(px(0.0))
        .w_full()
        .overflow_y_scroll()
        .pr(px(4.0))
        .child(body);
    let mut page = div()
        .relative()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .w_full()
        .h_full()
        .min_h(px(0.0))
        .p(px(22.0))
        .child(fixed)
        .child(scroll)
        .child(footer);
    if app.content.menu.is_some() {
        page = page.child(menu_backdrop(&view));
    }
    page.into_any_element()
}

fn pack_import_body(app: &LauncherApp, theme: &Theme, memory: String) -> AnyElement {
    let Some(import) = app.content.pack_import.clone() else {
        return div().into_any_element();
    };
    let name = text_of(&import, "name");
    let plan = import.get("plan").cloned().unwrap_or(Value::Null);
    let lower = name.to_lowercase();
    let format = if lower.ends_with(".mrpack") { "mrpack" } else { "zip" };
    let kind = if lower.ends_with(".mrpack") {
        "Modrinth".to_string()
    } else {
        let source = text_of(&plan, "source");
        if source == "profile" {
            "Profile LunarSpace".to_string()
        } else {
            "CurseForge".to_string()
        }
    };
    let stats = div()
        .w_full()
        .flex()
        .flex_wrap()
        .gap(px(8.0))
        .child(stat_box(theme, "Nguồn", "Tệp".into()))
        .child(stat_box(theme, "Định dạng", format.into()))
        .child(stat_box(theme, "Kiểu", kind))
        .child(stat_box(theme, "Tên", if name.is_empty() { "—".into() } else { name.clone() }))
        .child(stat_box(
            theme,
            "RAM",
            format!(
                "{} MB",
                memory.trim().parse::<u32>().unwrap_or(4096)
            ),
        ));
    let path = text_of(&import, "path");
    let mut info = format!("Đường dẫn: {path}");
    if !plan.is_null() {
        info.push_str(&format!(
            "\nMinecraft {} · {}{}{}",
            text_of(&plan, "mc"),
            text_of(&plan, "loader"),
            {
                let count = num_of(&plan, "files");
                if count > 0 {
                    format!(" · {count} tệp")
                } else {
                    String::new()
                }
            },
            {
                let overrides = num_of(&plan, "overrides");
                if overrides > 0 {
                    format!(" · {overrides} overrides")
                } else {
                    String::new()
                }
            }
        ));
    }
    info.push_str("\nBấm “Cài đặt modpack” ở dưới để tạo phiên bản từ tệp này.");
    div()
        .w_full()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .child(stats)
        .child(info_box(
            theme,
            "Tệp đã chọn",
            "file-arrow-up",
            div()
                .text_size(px(10.5))
                .line_height(px(16.0))
                .text_color(theme.muted)
                .child(info),
        ))
        .into_any_element()
}

fn pack_about_tab(
    app: &mut LauncherApp,
    theme: &Theme,
    detail: &Value,
    hit: &Value,
    versions: &[Value],
) -> AnyElement {
    let source = {
        let source = text_of(hit, "source");
        if source.is_empty() {
            app.content.source.clone()
        } else {
            source
        }
    };
    let selected_version = versions
        .iter()
        .find(|row| app.content.selected_version.as_deref() == Some(text_of(row, "id").as_str()))
        .cloned()
        .or_else(|| versions.first().cloned())
        .unwrap_or(Value::Null);
    let downloads = {
        let value = num_of(detail, "downloads");
        if value > 0 {
            value
        } else {
            num_of(hit, "downloads")
        }
    };
    let followers = if num_of(detail, "followers") > 0 {
        num_of(detail, "followers")
    } else {
        num_of(hit, "follows")
    };
    let created = text_of(detail, "created");
    let updated = {
        let value = text_of(detail, "updated");
        if value.is_empty() {
            text_of(hit, "updated")
        } else {
            value
        }
    };
    let stats = div()
        .w_full()
        .flex()
        .flex_wrap()
        .gap(px(8.0))
        .child(stat_box(theme, "Nguồn", pack_source_name(&source).into()))
        .child(stat_box(
            theme,
            "Phiên bản",
            {
                let value = text_of(detail, "version");
                if !value.is_empty() {
                    value
                } else {
                    let value = text_of(hit, "version");
                    if !value.is_empty() {
                        value
                    } else if !selected_version.is_null() {
                        text_of(&selected_version, "versionNumber")
                    } else {
                        "—".into()
                    }
                }
            },
        ))
        .child(stat_box(
            theme,
            "Tác giả",
            {
                let value = text_of(detail, "author");
                if value.is_empty() {
                    let value = text_of(hit, "author");
                    if value.is_empty() {
                        "—".into()
                    } else {
                        value
                    }
                } else {
                    value
                }
            },
        ))
        .child(stat_box(theme, "Lượt tải", compact(downloads)))
        .child(stat_box(
            theme,
            "Theo dõi",
            if followers > 0 {
                compact(followers)
            } else {
                "—".into()
            },
        ))
        .child(stat_box(
            theme,
            "Phát hành",
            if created.is_empty() {
                "—".into()
            } else {
                date_of(&created)
            },
        ))
        .child(stat_box(
            theme,
            "Cập nhật",
            if updated.is_empty() {
                "—".into()
            } else {
                time_ago(&updated)
            },
        ));
    let description = if !text_of(detail, "description").is_empty() {
        clean_text(&text_of(detail, "description"))
    } else if !text_of(detail, "summary").is_empty() {
        text_of(detail, "summary")
    } else if !text_of(hit, "summary").is_empty() {
        text_of(hit, "summary")
    } else {
        "Gói này không kèm mô tả.".to_string()
    };
    let desc_box = info_box(
        theme,
        "Mô tả",
        "file",
        div()
            .text_size(px(10.5))
            .line_height(px(16.0))
            .text_color(theme.muted)
            .child(description),
    );
    let mut game_versions = list_of(detail, "gameVersions");
    if game_versions.is_empty() {
        game_versions = list_of(hit, "gameVersions");
    }
    let mut pack_loaders = list_of(detail, "loaders");
    if pack_loaders.is_empty() {
        pack_loaders = list_of(hit, "loaders");
    }
    let mut categories = list_of(detail, "categories");
    if categories.is_empty() {
        categories = list_of(hit, "tags");
    }
    let mut chips = div().flex().flex_wrap().gap(px(4.0));
    for version in game_versions.iter().take(8) {
        chips = chips.child(tag_chip(theme, version));
    }
    if game_versions.is_empty() {
        chips = chips.child(div().text_size(px(10.0)).text_color(theme.faint).child("—"));
    }
    let mut compat = div()
        .flex()
        .flex_col()
        .gap(px(6.0))
        .child(
            div()
                .text_size(px(10.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text)
                .child("Minecraft: Java Edition"),
        )
        .child(chips);
    if !pack_loaders.is_empty() {
        let mut row = div().flex().flex_wrap().items_center().gap(px(4.0));
        for loader in pack_loaders.iter() {
            row = row.child(
                div()
                    .h(px(22.0))
                    .px(px(6.0))
                    .rounded(px(5.0))
                    .bg(theme.elevated)
                    .border_1()
                    .border_color(theme.border_soft)
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .text_size(px(9.0))
                    .text_color(theme.muted)
                    .child(gpui::img(loader_image(loader)).size(px(11.0)))
                    .child(loader_name(loader)),
            );
        }
        compat = compat
            .child(
                div()
                    .mt(px(2.0))
                    .text_size(px(8.5))
                    .font_weight(FontWeight::BOLD)
                    .text_color(theme.faint)
                    .child("BẢN MODPACK"),
            )
            .child(row);
    }
    if !selected_version.is_null() {
        compat = compat
            .child(leader(
                theme,
                "Bản đang chọn",
                text_of(&selected_version, "versionNumber"),
            ))
            .child(leader(
                theme,
                "Minecraft",
                list_of(&selected_version, "gameVersions")
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "—".into()),
            ));
    }
    let compat_box = info_box(theme, "Tương thích", "cube", compat);
    let mut tag_body = div().flex().flex_wrap().gap(px(4.0));
    for tag in categories.iter().take(20) {
        tag_body = tag_body.child(tag_chip(theme, tag));
    }
    if categories.is_empty() {
        tag_body = tag_body.child(div().text_size(px(10.0)).text_color(theme.faint).child("—"));
    }
    let tags_box = info_box(theme, "Thẻ", "list", tag_body);
    let creators = detail
        .get("creators")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut creator_body = div().flex().flex_col().gap(px(6.0));
    for person in creators.iter() {
        creator_body = creator_body.child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                .child(
                    div()
                        .size(px(20.0))
                        .rounded(px(5.0))
                        .bg(theme.elevated)
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(widgets::icon("user", 10.0, theme.faint)),
                )
                .child(
                    div()
                        .flex_1()
                        .text_size(px(10.0))
                        .text_color(theme.text)
                        .truncate()
                        .child(text_of(person, "name")),
                )
                .child(
                    div()
                        .text_size(px(8.5))
                        .font_family(MONO)
                        .text_color(theme.faint)
                        .child(text_of(person, "role")),
                ),
        );
    }
    let creators_box = (!creators.is_empty())
        .then(|| info_box(theme, "Tác giả", "users", creator_body));
    let links = detail
        .get("links")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut link_body = div().flex().flex_col().gap(px(2.0));
    for link in links.iter() {
        let url = text_of(link, "url");
        let label = text_of(link, "label");
        link_body = link_body.child(
            div()
                .id(SharedString::from(format!("pack-link-{label}")))
                .h(px(24.0))
                .flex()
                .items_center()
                .gap(px(6.0))
                .text_size(px(10.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text)
                .cursor_pointer()
                .hover(|style| style.text_color(theme.accent_soft))
                .on_click(move |_, _, _| {
                    let _ = open::that(&url);
                })
                .child(div().flex_1().truncate().child(label))
                .child(widgets::icon("arrow-square-out", 10.0, theme.faint)),
        );
    }
    let links_box = (!links.is_empty()).then(|| info_box(theme, "Liên kết", "link-simple", link_body));
    let loader_text = {
        let list = list_of(&selected_version, "loaders");
        let list = if list.is_empty() {
            pack_loaders.clone()
        } else {
            list
        };
        if list.is_empty() {
            "—".to_string()
        } else {
            list.iter()
                .map(|loader| loader_name(loader))
                .collect::<Vec<_>>()
                .join(", ")
        }
    };
    let detail_body = div()
        .w_full()
        .flex()
        .flex_col()
        .gap(px(2.0))
        .when(!text_of(detail, "slug").is_empty(), |el| {
            el.child(leader(theme, "Slug", text_of(detail, "slug")))
        })
        .child(leader(theme, "Trình tải", loader_text))
        .child(leader(
            theme,
            "Hỗ trợ",
            game_versions
                .first()
                .map(|value| format!("tới {value}"))
                .unwrap_or_else(|| "—".into()),
        ))
        .child(leader(theme, "Lượt tải", compact(downloads)))
        .when(!created.is_empty(), |el| {
            el.child(leader(theme, "Phát hành", date_of(&created)))
        })
        .when(!updated.is_empty(), |el| {
            el.child(leader(theme, "Cập nhật", date_of(&updated)))
        })
        .child(leader(theme, "Mã gói", text_of(hit, "id")));
    let details_box = info_box(theme, "Chi tiết", "info", detail_body);
    let mut side = div().flex().flex_col().gap(px(8.0)).w(px(280.0)).flex_shrink_0();
    side = side.child(compat_box).child(tags_box);
    if let Some(creators_box) = creators_box {
        side = side.child(creators_box);
    }
    if let Some(links_box) = links_box {
        side = side.child(links_box);
    }
    side = side.child(details_box);
    div()
        .w_full()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .child(stats)
        .child(
            div()
                .w_full()
                .flex()
                .items_start()
                .gap(px(10.0))
                .child(div().flex_1().min_w(px(0.0)).child(desc_box))
                .child(side),
        )
        .into_any_element()
}

fn pack_versions_tab(
    app: &mut LauncherApp,
    theme: &Theme,
    versions: &[Value],
    view: &gpui::WeakEntity<LauncherApp>,
) -> AnyElement {
    if versions.is_empty() {
        return div()
            .py(px(20.0))
            .text_size(px(10.0))
            .text_color(theme.faint)
            .child("Không có bản nào cho modpack này.")
            .into_any_element();
    }
    let mut game_values: Vec<String> = Vec::new();
    let mut loader_values: Vec<String> = Vec::new();
    for version in versions.iter() {
        for game in list_of(version, "gameVersions") {
            if !game_values.contains(&game) {
                game_values.push(game);
            }
        }
        for loader in list_of(version, "loaders") {
            if !loader_values.contains(&loader) {
                loader_values.push(loader);
            }
        }
    }
    game_values.sort_by(|a, b| b.cmp(a));
    let mut game_choices = vec![Choice {
        value: String::new(),
        label: "Mọi phiên bản game".into(),
    }];
    game_choices.extend(game_values.into_iter().map(|value| Choice {
        label: value.clone(),
        value,
    }));
    let mut loader_choices = vec![Choice {
        value: String::new(),
        label: "Mọi loader".into(),
    }];
    loader_choices.extend(loader_values.into_iter().map(|value| Choice {
        label: loader_name(&value).to_string(),
        value,
    }));
    let shown: Vec<Value> = versions
        .iter()
        .filter(|version| {
            (app.content.version_game.is_empty()
                || list_of(version, "gameVersions").contains(&app.content.version_game))
                && (app.content.version_loader.is_empty()
                    || list_of(version, "loaders").contains(&app.content.version_loader))
        })
        .cloned()
        .collect();
    let menu = app.content.menu.clone();
    let busy = !app.content.pack_stage.is_empty();
    let view_clear = view.clone();
    let mut header = div()
        .w_full()
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(
            div()
                .text_size(px(9.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.muted)
                .child(format!("BẢN MODPACK · {}", versions.len())),
        )
        .child(div().w(px(160.0)).child(dropdown(
            theme,
            "version_game",
            &app.content.version_game,
            "Mọi phiên bản game",
            game_choices,
            false,
            menu.as_deref() == Some("version_game"),
            view.clone(),
            160.0,
        )))
        .child(div().w(px(150.0)).child(dropdown(
            theme,
            "version_loader",
            &app.content.version_loader,
            "Mọi loader",
            loader_choices,
            false,
            menu.as_deref() == Some("version_loader"),
            view.clone(),
            150.0,
        )));
    if !app.content.version_game.is_empty() || !app.content.version_loader.is_empty() {
        header = header.child(
            div()
                .id("pack-version-clear")
                .h(px(30.0))
                .px(px(8.0))
                .rounded(px(6.0))
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
                    let _ = view_clear.update(cx, |this, cx| {
                        this.content.version_game.clear();
                        this.content.version_loader.clear();
                        cx.notify();
                    });
                })
                .child("Xoá lọc"),
        );
    }
    header = header
        .child(div().flex_1())
        .child(
            div()
                .text_size(px(9.5))
                .font_family(MONO)
                .text_color(theme.faint)
                .child(format!("{}/{}", shown.len(), versions.len())),
        );
    let mut list = div()
        .w_full()
        .flex()
        .flex_col()
        .rounded(px(10.0))
        .border_1()
        .border_color(theme.border_soft)
        .overflow_hidden();
    for (index, version) in shown.iter().enumerate() {
        let id = text_of(version, "id");
        let version_number = text_of(version, "versionNumber");
        let games = list_of(version, "gameVersions");
        let loaders = list_of(version, "loaders");
        let size = num_of(version, "fileSize");
        let date = text_of(version, "datePublished");
        let first = index == 0;
        let selected = app.content.selected_version.as_deref() == Some(id.as_str());
        let view_pick = view.clone();
        let id_pick = id.clone();
        let view_install = view.clone();
        let id_install = id.clone();
        let meta = format!(
            "{}{}{}",
            games.iter().take(2).cloned().collect::<Vec<_>>().join(" · "),
            if size > 0 {
                format!(" · {}", bytes_label(size))
            } else {
                String::new()
            },
            if date.is_empty() {
                String::new()
            } else {
                format!(" · {}", time_ago(&date))
            }
        );
        list = list.child(
            div()
                .id(SharedString::from(format!("pack-version-{id}")))
                .w_full()
                .flex()
                .items_center()
                .gap(px(8.0))
                .px(px(10.0))
                .py(px(7.0))
                .when(index > 0, |el| {
                    el.border_t_1().border_color(theme.border_soft)
                })
                .when(selected, |el| el.bg(theme.accent_dim))
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let id = id_pick.clone();
                    let _ = view_pick.update(cx, |this, cx| {
                        this.content.selected_version = Some(id);
                        cx.notify();
                    });
                })
                .child(
                    div()
                        .w(px(3.0))
                        .h(px(26.0))
                        .rounded_full()
                        .bg(if selected { theme.accent } else { theme.border }),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w(px(0.0))
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(6.0))
                                .child(
                                    div()
                                        .text_size(px(10.5))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(theme.text)
                                        .truncate()
                                        .child(version_number),
                                )
                                .when(first, |el| {
                                    el.child(
                                        div()
                                            .h(px(16.0))
                                            .px(px(5.0))
                                            .rounded(px(4.0))
                                            .bg(theme.accent_dim)
                                            .flex()
                                            .items_center()
                                            .text_size(px(8.0))
                                            .font_weight(FontWeight::BOLD)
                                            .text_color(theme.accent_soft)
                                            .child("MỚI NHẤT"),
                                    )
                                }),
                        )
                        .child(
                            div()
                                .text_size(px(9.0))
                                .font_family(MONO)
                                .text_color(theme.faint)
                                .truncate()
                                .child(meta),
                        ),
                )
                .children(if loaders.is_empty() {
                    None
                } else {
                    Some(loader_dots(theme, &loaders, 11.0))
                })
                .child(
                    div()
                        .id(SharedString::from(format!("pack-install-{id}")))
                        .h(px(26.0))
                        .px(px(9.0))
                        .rounded(px(6.0))
                        .bg(if selected { theme.accent } else { theme.elevated })
                        .border_1()
                        .border_color(if selected { theme.accent } else { theme.border })
                        .flex()
                        .items_center()
                        .gap(px(4.0))
                        .text_size(px(9.5))
                        .font_weight(FontWeight::BOLD)
                        .text_color(if selected { theme.on_accent } else { theme.muted })
                        .cursor_pointer()
                        .when(busy, |el| el.opacity(0.6))
                        .on_click(move |_, _, cx| {
                            let id = id_install.clone();
                            let _ = view_install.update(cx, |this, cx| {
                                this.content.selected_version = Some(id.clone());
                                pack_install(this, Some(id), cx);
                            });
                        })
                        .child(widgets::icon(
                            "download-simple",
                            11.0,
                            if selected { theme.on_accent } else { theme.muted },
                        ))
                        .child(if busy && selected { "Đang cài…" } else { "Cài" }),
                ),
        );
    }
    div()
        .w_full()
        .flex()
        .flex_col()
        .gap(px(6.0))
        .child(header)
        .child(list)
        .into_any_element()
}

pub fn pack_import_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let close_view = cx.entity().downgrade();
    let close_backdrop = cx.entity().downgrade();
    let view_pick = cx.entity().downgrade();
    let content = div()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                .child(widgets::icon("file-arrow-up", 15.0, theme.accent_soft))
                .child(
                    div()
                        .flex_1()
                        .text_size(px(13.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.text)
                        .child("Nhập modpack từ tệp"),
                )
                .child(
                    div()
                        .id("pack-import-close")
                        .size(px(24.0))
                        .rounded(px(6.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor_pointer()
                        .on_click(move |_, _, cx| {
                            let _ = close_view.update(cx, |this, cx| {
                                this.modal = crate::ui::app::Modal::None;
                                cx.notify();
                            });
                        })
                        .child(widgets::icon("x", 12.0, theme.faint)),
                ),
        )
        .child(
            div()
                .id("pack-import-drop")
                .w_full()
                .py(px(28.0))
                .flex()
                .flex_col()
                .items_center()
                .gap(px(6.0))
                .rounded(px(12.0))
                .bg(theme.elevated)
                .border_2()
                .border_color(theme.border)
                .cursor_pointer()
                .hover(|style| style.border_color(theme.accent))
                .on_click(move |_, _, cx| {
                    let view = view_pick.clone();
                    cx.spawn(async move |cx| {
                        let picked = rfd::AsyncFileDialog::new()
                            .add_filter("Modpack", &["mrpack", "zip"])
                            .pick_file()
                            .await;
                        if let Some(file) = picked {
                            let path = file.path().to_string_lossy().into_owned();
                            let _ = view.update(cx, |this, cx| {
                                pack_accept_import(this, path, cx);
                            });
                        }
                    })
                    .detach();
                })
                .child(
                    div()
                        .size(px(44.0))
                        .rounded(px(10.0))
                        .bg(theme.surface)
                        .border_1()
                        .border_color(theme.border)
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(widgets::icon("file-arrow-up", 20.0, theme.accent_soft)),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.text)
                        .child("Bấm để chọn tệp"),
                )
                .child(
                    div()
                        .text_size(px(10.0))
                        .text_color(theme.faint)
                        .child(".mrpack, .zip (CurseForge) hoặc bản xuất profile LunarSpace"),
                ),
        )
        .when(!app.content.pack_import_error.is_empty(), |el| {
            el.child(
                div()
                    .w_full()
                    .flex()
                    .items_start()
                    .gap(px(6.0))
                    .p(px(9.0))
                    .rounded(px(8.0))
                    .bg(gpui::rgba(0xf871711a))
                    .border_1()
                    .border_color(gpui::rgba(0xf8717155))
                    .text_size(px(10.0))
                    .text_color(theme.bad)
                    .child(widgets::icon("warning-circle", 12.0, theme.bad))
                    .child(app.content.pack_import_error.clone()),
            )
        })
        .child(
            div()
                .text_size(px(9.5))
                .line_height(px(14.0))
                .text_color(theme.faint)
                .child("Sau khi nhận tệp, bạn đặt tên phiên bản / RAM / thư mục rồi bấm “Cài đặt modpack”."),
        );
    let _ = view;
    crate::ui::pages::modal_overlay(theme, 520.0, content, move |_, _, cx| {
        let _ = close_backdrop.update(cx, |this, cx| {
            this.modal = crate::ui::app::Modal::None;
            cx.notify();
        });
    })
    .into_any_element()
}
