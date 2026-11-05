use crate::backend::Backend;
use crate::models::{Account, Instance, LoaderRow, VersionEntry};
use crate::ui::assets::{self, FileAssets};
use crate::ui::pages;
use crate::ui::theme::*;
use crate::ui::widgets::{self, TextField};
use async_channel::Receiver;
use gpui::{
    AnimationExt, AnyElement, App, Context, ElementId, Entity, FontWeight, IntoElement,
    MouseButton, Render, SharedString, Window, div, prelude::*, px,
};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Page {
    Home,
    Versions,
    Modpacks,
    Accounts,
    Host,
    Servers,
    Settings,
    Instance,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstanceTab {
    Overview,
    Console,
    Mods,
    Resourcepacks,
    Shaderpacks,
    Files,
    Trash,
    Saves,
    Map,
    Settings,
}

impl InstanceTab {
    pub fn label(self) -> &'static str {
        match self {
            Self::Overview => "Tổng quan",
            Self::Console => "Console",
            Self::Mods => "Mods",
            Self::Resourcepacks => "Gói tài nguyên",
            Self::Shaderpacks => "Shader",
            Self::Files => "Tệp tin",
            Self::Trash => "Thùng rác",
            Self::Saves => "Bản lưu",
            Self::Map => "Bản đồ",
            Self::Settings => "Cài đặt",
        }
    }

    pub fn icon(self) -> &'static str {
        match self {
            Self::Overview => "chart-line",
            Self::Console => "terminal",
            Self::Mods => "puzzle-piece",
            Self::Resourcepacks => "image",
            Self::Shaderpacks => "paint-brush",
            Self::Files => "files",
            Self::Trash => "trash",
            Self::Saves => "archive",
            Self::Map => "map-trifold",
            Self::Settings => "gear-six",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Toast {
    pub id: u64,
    pub tone: &'static str,
    pub title: String,
    pub message: String,
}

#[derive(Clone, Debug, Default)]
pub struct CreateState {
    pub open: bool,
    pub loader: String,
    pub game: String,
    pub loader_version: String,
    pub versions: Vec<VersionEntry>,
    pub loader_versions: Vec<LoaderRow>,
    pub loader_games: Vec<Value>,
    pub show_snapshots: bool,
    pub loading_versions: bool,
    pub loading_loaders: bool,
    pub error: String,
    pub step: usize,
    pub demo: bool,
}

#[derive(Clone, Debug, Default)]
pub struct AddAccountState {
    pub open: bool,
    pub tab: String,
    pub ms_code: String,
    pub ms_uri: String,
    pub ms_waiting: bool,
    pub error: String,
}

#[derive(Clone, Debug, Default)]
pub struct SkinState {
    pub uuid: String,
    pub model: String,
    pub skin_path: Option<String>,
    pub cape_path: Option<String>,
    pub skin_data: String,
    pub cape_data: String,
    pub message: String,
    pub angle: f32,
    pub dragging: bool,
    pub auto_spin: bool,
    pub spin_gen: u64,
    pub paint_asset: String,
    pub paint_tool: String,
    pub paint_color: String,
    pub paint_skin: Vec<u8>,
    pub paint_cape: Vec<u8>,
    pub paint_undo: Vec<Vec<u8>>,
    pub paint_redo: Vec<Vec<u8>>,
    pub paint_last: Option<(i32, i32)>,
    pub paint_painting: bool,
    pub paint_grid: bool,
}

#[derive(Clone, Debug, Default)]
pub struct ContentState {
    pub open: bool,
    pub kind: String,
    pub source: String,
    pub sort: String,
    pub game: String,
    pub loader: String,
    pub category: String,
    pub hits: Vec<Value>,
    pub total: u64,
    pub loading: bool,
    pub offset: u32,
    pub selected: Option<Value>,
    pub selected_versions: Vec<Value>,
    pub selected_version: Option<String>,
    pub detail: Option<Value>,
    pub detail_loading: bool,
    pub error: String,
    pub environment: String,
    pub detail_tab: String,
    pub instance_id: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct SettingsUi {
    pub runtimes: Vec<Value>,
    pub java_all: Vec<Value>,
    pub java_current: Option<String>,
    pub zulu_major: String,
    pub installing: bool,
    pub message: String,
}

#[derive(Clone, Debug)]
pub struct InstanceUi {
    pub rel: String,
    pub entries: Vec<Value>,
    pub trash: Vec<Value>,
    pub mods: Vec<Value>,
    pub worlds: Vec<Value>,
    pub logs: Vec<String>,
    pub editor_open: bool,
    pub editor_rel: String,
    pub editor_text: String,
    pub editor_dirty: bool,
    pub world_open: Option<String>,
    pub map_image: Option<String>,
    pub map_busy: bool,
    pub map_meta: Value,
    pub new_name: String,
    pub new_dir: bool,
    pub console_level: String,
    pub console_font: f32,
    pub console_hidden: usize,
    pub console_search_open: bool,
    pub modpack_busy: bool,
    pub world_game_type: i64,
    pub world_difficulty: i64,
    pub world_hardcore: bool,
    pub world_cheats: bool,
}

impl Default for InstanceUi {
    fn default() -> Self {
        Self {
            rel: String::new(),
            entries: Vec::new(),
            trash: Vec::new(),
            mods: Vec::new(),
            worlds: Vec::new(),
            logs: Vec::new(),
            editor_open: false,
            editor_rel: String::new(),
            editor_text: String::new(),
            editor_dirty: false,
            world_open: None,
            map_image: None,
            map_busy: false,
            map_meta: Value::Null,
            new_name: String::new(),
            new_dir: false,
            console_level: String::new(),
            console_font: 11.5,
            console_hidden: 0,
            console_search_open: false,
            modpack_busy: false,
            world_game_type: 0,
            world_difficulty: 2,
            world_hardcore: false,
            world_cheats: false,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct ServerUi {
    pub tab: String,
    pub servers: Vec<Value>,
    pub selected: Option<String>,
    pub console: Vec<String>,
    pub name: String,
    pub instance_id: String,
    pub egg: String,
    pub files: Vec<Value>,
    pub rel: String,
    pub backups: Vec<Value>,
    pub busy: bool,
    pub creating: bool,
    pub editor_open: bool,
    pub editor_rel: String,
    pub game_mode: String,
    pub difficulty: String,
    pub online: bool,
    pub pvp: bool,
    pub schedules: Vec<Value>,
    pub users_whitelist: Vec<Value>,
    pub users_ops: Vec<Value>,
    pub user_add_whitelist: bool,
    pub user_add_op: bool,
    pub schedule_form: bool,
    pub schedule_edit: Option<String>,
    pub schedule_action: String,
    pub schedule_power: String,
}

#[derive(Clone, Debug)]
pub enum Modal {
    None,
    Create,
    AddAccount,
    ContentDetail,
    ContentBrowser,
    Confirm {
        title: String,
        message: String,
        action: ConfirmAction,
    },
    LogUpload {
        text: String,
        url: String,
        busy: bool,
    },
    ModpackUpdate {
        id: String,
        versions: Vec<Value>,
        selected: Option<String>,
        current: Option<String>,
    },
    WorldEdit {
        id: String,
        folder: String,
        settings: Value,
    },
    SkinPaint,
    LoaderChange {
        id: String,
        loader: String,
        game: String,
        builds: Vec<Value>,
        selected: Option<String>,
    },
}

#[derive(Clone, Debug)]
pub enum ConfirmAction {
    DeleteInstance(String),
    TrashFile(String, String),
    PurgeTrash(String, Vec<String>),
    RemoveAccount(String),
    ServerDelete(String),
    ScheduleDelete(String, String),
}

pub struct LauncherApp {
    pub backend: Arc<Backend>,
    pub root_focus: gpui::FocusHandle,
    pub theme: Theme,
    pub settings: Value,
    pub instances: Vec<Instance>,
    pub accounts: Vec<Account>,
    pub active_account: Option<String>,
    pub versions: Vec<VersionEntry>,
    pub latest: Value,
    pub versions_loading: bool,
    pub versions_error: String,
    pub snapshots: bool,
    pub system: Value,
    pub page: Page,
    pub instance_tab: InstanceTab,
    pub selected_instance: Option<String>,
    pub rail_collapsed: bool,
    pub pill_y: f32,
    pub pill_gen: u64,
    pub pill_visible: bool,
    pub boot: bool,
    pub boot_splash: bool,
    pub splash_frames: Vec<std::path::PathBuf>,
    pub splash_index: usize,
    pub splash_image: Option<Arc<gpui::RenderImage>>,
    pub splash_loading: bool,
    pub splash_loading_at: Option<std::time::Instant>,
    pub splash_fading: bool,
    pub splash_fade_at: Option<std::time::Instant>,
    pub boot_ready: bool,
    pub toasts: Vec<Toast>,
    pub toast_seq: u64,
    pub progress: HashMap<String, Value>,
    pub logs: HashMap<String, Vec<String>>,
    pub launch_errors: HashMap<String, String>,
    pub crash: Option<Value>,
    pub modal: Modal,
    pub create: CreateState,
    pub account_ui: AddAccountState,
    pub skin_ui: SkinState,
    pub skin_preview: Option<Arc<gpui::RenderImage>>,
    pub paint_preview: Option<Arc<gpui::RenderImage>>,
    pub skin_drag_x: f32,
    pub content: ContentState,
    pub settings_ui: SettingsUi,
    pub instance_ui: InstanceUi,
    pub server_ui: ServerUi,
    pub icon_cache: HashMap<String, String>,
    pub icon_pending: HashSet<String>,
    pub search: Entity<TextField>,
    pub version_search: Entity<TextField>,
    pub content_search: Entity<TextField>,
    pub name_input: Entity<TextField>,
    pub memory_input: Entity<TextField>,
    pub jvm_input: Entity<TextField>,
    pub ely_user: Entity<TextField>,
    pub ely_pass: Entity<TextField>,
    pub file_search: Entity<TextField>,
    pub console_filter: Entity<TextField>,
    pub console_search_input: Entity<TextField>,
    pub editor_input: Entity<TextField>,
    pub file_name_input: Entity<TextField>,
    pub console_scroll: gpui::ScrollHandle,
    pub page_scroll: gpui::ScrollHandle,
    pub server_cmd: Entity<TextField>,
    pub server_motd: Entity<TextField>,
    pub server_port: Entity<TextField>,
    pub sched_name: Entity<TextField>,
    pub sched_cron: Entity<TextField>,
    pub sched_command: Entity<TextField>,
    pub user_name: Entity<TextField>,
    pub host_token: Entity<TextField>,
    pub host_listen: Entity<TextField>,
    pub host_status: Value,
    pub host_instance: Option<String>,
    pub tip: Option<String>,
    pub mouse_pos: gpui::Point<gpui::Pixels>,
    pub home_tab: String,
    pub accounts_tab: String,
    pub home_loaders: Value,
    pub home_loaders_for: String,
    pub home_java_loaded: bool,
    pub console_auto: bool,
    pub select_open: Option<String>,
    pub instance_search: Entity<TextField>,
    pub uptime: u64,
}

impl LauncherApp {
    pub fn new(backend: Arc<Backend>, events: Receiver<Value>, cx: &mut Context<Self>) -> Self {
        let settings = backend.settings();
        let theme = Theme::from_settings(
            settings
                .get("theme")
                .and_then(Value::as_str)
                .unwrap_or("dark"),
        );
        let view = cx.entity().downgrade();
        let notify_change = {
            let view = view.clone();
            move |_: &str, _: &mut Window, app: &mut App| {
                let _ = view.update(app, |_, cx| cx.notify());
            }
        };
        let search = cx.new(|cx| TextField::new(cx, "Tìm phiên bản…").on_change(notify_change.clone()));
        let version_search = cx.new(|cx| TextField::new(cx, "Tìm phiên bản Minecraft…").on_change(notify_change.clone()));
        let content_search = {
            let view = view.clone();
            cx.new(|cx| {
                TextField::new(cx, "Tìm mod, modpack, shader…")
                    .on_change(notify_change.clone())
                    .on_submit(move |text, _w, app| {
                        let text = text.to_string();
                        let _ = view.update(app, |this, cx| {
                            this.search_content(text, cx);
                        });
                    })
            })
        };
        let name_input = cx.new(|cx| TextField::new(cx, "Tên phiên bản…"));
        let memory_input = cx.new(|cx| TextField::new(cx, "4096"));
        let jvm_input = cx.new(|cx| TextField::new(cx, "Ví dụ: -XX:+UseG1GC"));
        let ely_user = cx.new(|cx| TextField::new(cx, "Tên đăng nhập hoặc email ely.by"));
        let ely_pass = cx.new(|cx| TextField::new(cx, "Mật khẩu ely.by"));
        let file_search = cx.new(|cx| TextField::new(cx, "Tìm tệp…").on_change(notify_change.clone()));
        let console_filter = cx.new(|cx| TextField::new(cx, "Lọc log…").on_change(notify_change.clone()));
        let console_search_input = cx.new(|cx| TextField::new(cx, "Tìm trong console…").on_change(notify_change.clone()));
        let editor_input = cx.new(|cx| TextField::new(cx, "Nội dung tệp…").multiline(true));
        let file_name_input = cx.new(|cx| TextField::new(cx, "Tên tệp hoặc thư mục…"));
        let server_motd = cx.new(|cx| TextField::new(cx, "XyoLauncher Server"));
        let server_port = cx.new(|cx| TextField::new(cx, "25565"));
        let sched_name = cx.new(|cx| TextField::new(cx, "Tên lịch…"));
        let sched_cron = cx.new(|cx| TextField::new(cx, "0 4 * * *"));
        let sched_command = cx.new(|cx| TextField::new(cx, "say Server sẽ khởi động lại sau 5 phút"));
        let user_name = cx.new(|cx| TextField::new(cx, "Tên người chơi…"));
        let server_cmd = cx.new(|cx| TextField::new(cx, "Nhập lệnh server…").on_submit({
            let view = view.clone();
            move |text, _w, app| {
                let text = text.to_string();
                let _ = view.update(app, |this, cx| {
                    if let Some(id) = this.server_ui.selected.clone() {
                        this.backend.server_command(id, text);
                        let input = this.server_cmd.clone();
                        input.update(cx, |input, cx| input.clear(cx));
                    }
                });
            }
        }));
        let host_token = cx.new(|cx| TextField::new(cx, "ngrok authtoken…"));
        let host_listen = cx.new(|cx| TextField::new(cx, "25565"));
        let instance_search = cx.new(|cx| TextField::new(cx, "Tìm phiên bản…").on_change(notify_change));

        let splash_dir = crate::ui::assets::assets_root().join("splash");
        let mut splash_frames: Vec<std::path::PathBuf> = std::fs::read_dir(&splash_dir)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|entry| entry.path())
                    .filter(|path| {
                        path.extension()
                            .and_then(|ext| ext.to_str())
                            .map(|ext| ext.eq_ignore_ascii_case("jpg") || ext.eq_ignore_ascii_case("png"))
                            .unwrap_or(false)
                    })
                    .collect()
            })
            .unwrap_or_default();
        splash_frames.sort();
        let splash_image = None;
        let mut app = Self {
            backend,
            root_focus: cx.focus_handle(),
            theme,
            settings,
            instances: Vec::new(),
            accounts: Vec::new(),
            active_account: None,
            versions: Vec::new(),
            latest: Value::Null,
            versions_loading: true,
            versions_error: String::new(),
            snapshots: false,
            system: Value::Null,
            page: Page::Home,
            instance_tab: InstanceTab::Overview,
            selected_instance: None,
            rail_collapsed: false,
            pill_y: 40.0,
            pill_gen: 0,
            pill_visible: true,
            boot: true,
            boot_splash: true,
            splash_frames,
            splash_index: 0,
            splash_image,
            splash_loading: false,
            splash_loading_at: None,
            splash_fading: false,
            splash_fade_at: None,
            boot_ready: false,
            toasts: Vec::new(),
            toast_seq: 0,
            progress: HashMap::new(),
            logs: HashMap::new(),
            launch_errors: HashMap::new(),
            crash: None,
            modal: Modal::None,
            create: CreateState {
                loader: "vanilla".into(),
                ..Default::default()
            },
            account_ui: AddAccountState {
                tab: "offline".into(),
                ..Default::default()
            },
            skin_ui: SkinState {
                model: "classic".into(),
                ..Default::default()
            },
            skin_preview: None,
            paint_preview: None,
            skin_drag_x: 0.0,
            content: ContentState {
                detail_tab: "about".into(),
                kind: "modpacks".into(),
                source: "modrinth".into(),
                sort: "relevance".into(),
                game: String::new(),
                loader: String::new(),
                category: String::new(),
                environment: String::new(),
                ..Default::default()
            },
            settings_ui: SettingsUi::default(),
            instance_ui: InstanceUi::default(),
            server_ui: ServerUi {
                tab: "overview".into(),
                ..Default::default()
            },
            icon_cache: HashMap::new(),
            icon_pending: HashSet::new(),
            search,
            version_search,
            content_search,
            name_input,
            memory_input,
            jvm_input,
            ely_user,
            ely_pass,
            file_search,
            console_filter,
            console_search_input,
            editor_input,
            file_name_input,
            console_scroll: gpui::ScrollHandle::new(),
            page_scroll: gpui::ScrollHandle::new(),
            server_cmd,
            server_motd,
            server_port,
            sched_name,
            sched_cron,
            sched_command,
            user_name,
            host_token,
            host_listen,
            host_status: Value::Null,
            host_instance: None,
            tip: None,
            mouse_pos: gpui::point(px(0.0), px(0.0)),
            home_tab: "overview".into(),
            accounts_tab: "list".into(),
            home_loaders: Value::Null,
            home_loaders_for: String::new(),
            home_java_loaded: false,
            console_auto: true,
            select_open: None,
            instance_search,
            uptime: 0,
        };
        widgets::set_tooltip_context(cx.entity().downgrade());
        app.refresh_settings();
        app.refresh_instances();
        app.refresh_accounts();
        app.load_versions(false, true, cx);
        app.load_system(cx);
        app.listen_events(events, cx);
        app.start_splash(cx);
        app.host_timer(cx);
        app
    }

    pub fn focus_handle(&self) -> gpui::FocusHandle {
        self.root_focus.clone()
    }

    pub fn refresh_settings(&mut self) {
        self.settings = self.backend.settings();
        self.theme = Theme::from_settings(
            self.settings
                .get("theme")
                .and_then(Value::as_str)
                .unwrap_or("dark"),
        );
    }

    pub fn refresh_instances(&mut self) {
        let value = self.backend.instances();
        if let Some(list) = value.get("instances").and_then(Value::as_array) {
            self.instances = list
                .iter()
                .filter_map(|row| serde_json::from_value::<Instance>(row.clone()).ok())
                .collect();
        }
        if let Some(id) = self.selected_instance.as_ref() {
            if !self.instances.iter().any(|entry| &entry.id == id) {
                self.selected_instance = None;
                if self.page == Page::Instance {
                    self.page = Page::Versions;
                }
            }
        }
    }

    fn paint_dims(&self) -> (u32, u32) {
        if self.skin_ui.paint_asset == "cape" {
            (64, 32)
        } else {
            (64, 64)
        }
    }

    fn paint_buffer(&self) -> &Vec<u8> {
        if self.skin_ui.paint_asset == "cape" {
            &self.skin_ui.paint_cape
        } else {
            &self.skin_ui.paint_skin
        }
    }

    fn paint_buffer_mut(&mut self) -> &mut Vec<u8> {
        if self.skin_ui.paint_asset == "cape" {
            &mut self.skin_ui.paint_cape
        } else {
            &mut self.skin_ui.paint_skin
        }
    }

    fn paint_color_rgba(&self) -> [u8; 4] {
        let hex = self.skin_ui.paint_color.trim_start_matches('#');
        if hex.len() >= 6 {
            if let (Ok(r), Ok(g), Ok(b)) = (
                u8::from_str_radix(&hex[0..2], 16),
                u8::from_str_radix(&hex[2..4], 16),
                u8::from_str_radix(&hex[4..6], 16),
            ) {
                return [r, g, b, 255];
            }
        }
        [233, 184, 114, 255]
    }

    pub fn refresh_paint_preview(&mut self) {
        let (width, height) = self.paint_dims();
        let Some(buffer) = image::RgbaImage::from_raw(width, height, self.paint_buffer().clone()) else {
            return;
        };
        let zoom = 6u32;
        let mut scaled = image::imageops::resize(
            &buffer,
            width * zoom,
            height * zoom,
            image::imageops::FilterType::Nearest,
        );
        let checker = |x: u32, y: u32| {
            if ((x / 12) + (y / 12)) % 2 == 0 {
                [40u8, 43, 48, 255]
            } else {
                [30u8, 33, 37, 255]
            }
        };
        for (x, y, pixel) in scaled.enumerate_pixels_mut() {
            if pixel[3] < 255 {
                let bg = checker(x, y);
                let a = pixel[3] as f32 / 255.0;
                for channel in 0..3 {
                    pixel[channel] = (pixel[channel] as f32 * a + bg[channel] as f32 * (1.0 - a)) as u8;
                }
                pixel[3] = 255;
            }
        }
        if self.skin_ui.paint_grid {
            for step in 0..=width.max(height) {
                let pos = step * zoom;
                if pos < scaled.width() {
                    for y in 0..scaled.height() {
                        let pixel = scaled.get_pixel_mut(pos, y);
                        let blend = |c: u8| ((c as u16 * 3 + 255) / 4) as u8;
                        pixel[0] = blend(pixel[0]);
                        pixel[1] = blend(pixel[1]);
                        pixel[2] = blend(pixel[2]);
                    }
                }
                if pos < scaled.height() {
                    for x in 0..scaled.width() {
                        let pixel = scaled.get_pixel_mut(x, pos);
                        let blend = |c: u8| ((c as u16 * 3 + 255) / 4) as u8;
                        pixel[0] = blend(pixel[0]);
                        pixel[1] = blend(pixel[1]);
                        pixel[2] = blend(pixel[2]);
                    }
                }
            }
        }
        let frame = image::Frame::new(scaled);
        self.paint_preview = Some(Arc::new(gpui::RenderImage::new(vec![frame])));
    }

    pub fn open_skin_painter(&mut self, cx: &mut Context<Self>) {
        let uuid = self.skin_ui.uuid.clone();
        if uuid.is_empty() {
            return;
        }
        let skin = self.backend.skin_read(&uuid);
        let load = |key: &str, width: u32, height: u32, fallback: Option<&str>| -> Vec<u8> {
            let path = skin
                .get(key)
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .or_else(|| fallback.map(str::to_string));
            if let Some(path) = path {
                if let Ok(image) = image::open(&path) {
                    let image = image.to_rgba8();
                    if image.width() == width && image.height() == height {
                        return image.into_raw();
                    }
                }
            }
            vec![0u8; (width * height * 4) as usize]
        };
        self.skin_ui.paint_skin = load(
            "skinPath",
            64,
            64,
            self.skin_ui.skin_path.as_deref(),
        );
        self.skin_ui.paint_cape = load(
            "capePath",
            64,
            32,
            self.skin_ui.cape_path.as_deref(),
        );
        self.skin_ui.paint_asset = "skin".into();
        self.skin_ui.paint_tool = "pencil".into();
        if self.skin_ui.paint_color.is_empty() {
            self.skin_ui.paint_color = "#E9B872".into();
        }
        self.skin_ui.paint_grid = true;
        self.skin_ui.paint_undo.clear();
        self.skin_ui.paint_redo.clear();
        self.skin_ui.paint_last = None;
        self.skin_ui.paint_painting = false;
        self.refresh_paint_preview();
        self.modal = Modal::SkinPaint;
        cx.notify();
    }

    pub fn paint_begin_stroke(&mut self) {
        let buffer = self.paint_buffer().clone();
        self.skin_ui.paint_undo.push(buffer);
        if self.skin_ui.paint_undo.len() > 40 {
            self.skin_ui.paint_undo.remove(0);
        }
        self.skin_ui.paint_redo.clear();
    }

    pub fn paint_undo(&mut self) {
        if let Some(previous) = self.skin_ui.paint_undo.pop() {
            let current = self.paint_buffer().clone();
            self.skin_ui.paint_redo.push(current);
            if self.skin_ui.paint_asset == "cape" {
                self.skin_ui.paint_cape = previous;
            } else {
                self.skin_ui.paint_skin = previous;
            }
            self.refresh_paint_preview();
        }
    }

    pub fn paint_redo(&mut self) {
        if let Some(next) = self.skin_ui.paint_redo.pop() {
            let current = self.paint_buffer().clone();
            self.skin_ui.paint_undo.push(current);
            if self.skin_ui.paint_asset == "cape" {
                self.skin_ui.paint_cape = next;
            } else {
                self.skin_ui.paint_skin = next;
            }
            self.refresh_paint_preview();
        }
    }

    fn paint_pixel_now(&mut self, x: i32, y: i32) {
        let (width, height) = self.paint_dims();
        if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
            return;
        }
        let tool = self.skin_ui.paint_tool.clone();
        let index = ((y as u32 * width + x as u32) * 4) as usize;
        if tool == "picker" {
            let buffer = self.paint_buffer();
            if let Some(pixel) = buffer.get(index..index + 4) {
                self.skin_ui.paint_color = format!("#{:02X}{:02X}{:02X}", pixel[0], pixel[1], pixel[2]);
            }
            return;
        }
        let color = if tool == "eraser" {
            [0u8, 0, 0, 0]
        } else {
            self.paint_color_rgba()
        };
        let width = width as i32;
        let height = height as i32;
        if tool == "fill" {
            let buffer = self.paint_buffer().clone();
            let target = [
                buffer[index],
                buffer[index + 1],
                buffer[index + 2],
                buffer[index + 3],
            ];
            if target == color {
                return;
            }
            let mut stack = vec![(x, y)];
            let mut visited = vec![false; (width * height) as usize];
            while let Some((cx, cy)) = stack.pop() {
                if cx < 0 || cy < 0 || cx >= width || cy >= height {
                    continue;
                }
                let at = (cy * width + cx) as usize;
                if visited[at] {
                    continue;
                }
                visited[at] = true;
                let offset = at * 4;
                let current = [
                    buffer[offset],
                    buffer[offset + 1],
                    buffer[offset + 2],
                    buffer[offset + 3],
                ];
                if current != target {
                    continue;
                }
                let output = self.paint_buffer_mut();
                output[offset..offset + 4].copy_from_slice(&color);
                stack.push((cx + 1, cy));
                stack.push((cx - 1, cy));
                stack.push((cx, cy + 1));
                stack.push((cx, cy - 1));
            }
        } else {
            let output = self.paint_buffer_mut();
            output[index..index + 4].copy_from_slice(&color);
        }
        self.refresh_paint_preview();
    }

    pub fn paint_at(&mut self, x: i32, y: i32, cx: &mut Context<Self>) {
        let tool = self.skin_ui.paint_tool.clone();
        if tool == "fill" || tool == "picker" {
            self.paint_pixel_now(x, y);
            cx.notify();
            return;
        }
        if let Some((last_x, last_y)) = self.skin_ui.paint_last {
            let steps = (x - last_x).abs().max((y - last_y).abs()).max(1);
            for step in 0..=steps {
                let px = last_x + (x - last_x) * step / steps;
                let py = last_y + (y - last_y) * step / steps;
                self.paint_pixel_now(px, py);
            }
        } else {
            self.paint_pixel_now(x, y);
        }
        self.skin_ui.paint_last = Some((x, y));
        cx.notify();
    }

    pub fn paint_save(&mut self, cx: &mut Context<Self>) {
        let uuid = self.skin_ui.uuid.clone();
        if uuid.is_empty() {
            return;
        }
        let dir = self.backend.store.data_dir.join("paint-tmp");
        let _ = std::fs::create_dir_all(&dir);
        let id = crate::util::safe_id(&uuid);
        let skin_path = dir.join(format!("{id}-skin.png"));
        let cape_path = dir.join(format!("{id}-cape.png"));
        if image::save_buffer(&skin_path, &self.skin_ui.paint_skin, 64, 64, image::ColorType::Rgba8).is_err() {
            return;
        }
        if image::save_buffer(&cape_path, &self.skin_ui.paint_cape, 64, 32, image::ColorType::Rgba8).is_err() {
            return;
        }
        let name = self
            .accounts
            .iter()
            .find(|account| account.uuid == uuid)
            .map(|account| account.name.clone())
            .unwrap_or_default();
        let model = if self.skin_ui.model.is_empty() {
            "classic".to_string()
        } else {
            self.skin_ui.model.clone()
        };
        let rx = self.backend.skin_save(
            uuid.clone(),
            name,
            model,
            Some(skin_path.to_string_lossy().into_owned()),
            Some(cape_path.to_string_lossy().into_owned()),
        );
        self.on_result(cx, rx, move |this, value, cx| {
            if value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                let skin = this.backend.skin_read(&uuid);
                this.skin_ui.skin_path = skin
                    .get("skinPath")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string);
                this.skin_ui.cape_path = skin
                    .get("capePath")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string);
                this.refresh_skin_preview();
                this.modal = Modal::None;
                this.toast("ok", "Đã lưu skin", "Mở lại game để áp dụng.", cx);
            } else {
                this.toast(
                    "bad",
                    "Lưu skin thất bại",
                    value.get("error").and_then(serde_json::Value::as_str).unwrap_or(""),
                    cx,
                );
            }
        });
    }

    pub fn refresh_skin_preview(&mut self) {
        let Some(path) = self.skin_ui.skin_path.clone() else {
            self.skin_preview = None;
            return;
        };
        let Ok(skin) = image::open(&path) else {
            self.skin_preview = None;
            return;
        };
        let cape = self
            .skin_ui
            .cape_path
            .as_ref()
            .and_then(|path| image::open(path).ok())
            .map(|image| image.to_rgba8());
        let pixels = crate::mc::skin3d::render(
            &skin.to_rgba8(),
            cape.as_ref(),
            &self.skin_ui.model,
            self.skin_ui.angle,
            320,
            420,
        );
        let frame = image::Frame::new(pixels);
        self.skin_preview = Some(Arc::new(gpui::RenderImage::new(vec![frame])));
    }

    pub fn start_skin_spin(&mut self, cx: &mut Context<Self>) {
        if self.skin_ui.auto_spin {
            return;
        }
        self.skin_ui.auto_spin = true;
        self.skin_ui.spin_gen += 1;
        self.refresh_skin_preview();
        let generation = self.skin_ui.spin_gen;
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(40))
                    .await;
                let keep = this
                    .update(cx, |this, cx| {
                        if !this.skin_ui.auto_spin || this.skin_ui.spin_gen != generation {
                            return false;
                        }
                        if this.accounts_tab != "skin"
                            || this.skin_ui.dragging
                            || this.skin_ui.skin_path.is_none()
                        {
                            return true;
                        }
                        this.skin_ui.angle += 0.035;
                        this.refresh_skin_preview();
                        cx.notify();
                        true
                    })
                    .unwrap_or(false);
                if !keep {
                    break;
                }
            }
        })
        .detach();
    }

    pub fn stop_skin_spin(&mut self) {
        self.skin_ui.auto_spin = false;
        self.skin_ui.spin_gen += 1;
    }

    pub fn refresh_accounts(&mut self) {
        let value = self.backend.accounts();
        self.accounts = value
            .get("accounts")
            .and_then(Value::as_array)
            .map(|rows| {
                rows.iter()
                    .filter_map(|row| serde_json::from_value::<Account>(row.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        self.active_account = value
            .get("activeAccountId")
            .and_then(Value::as_str)
            .map(str::to_string);
    }

    pub fn selected_instance(&self) -> Option<&Instance> {
        let id = self.selected_instance.as_ref()?;
        self.instances.iter().find(|entry| &entry.id == id)
    }

    pub fn update_pill(&mut self, target: f32, visible: bool, cx: &mut Context<Self>) {
        self.pill_visible = visible;
        if !visible {
            cx.notify();
            return;
        }
        self.pill_gen += 1;
        let generation = self.pill_gen;
        let start = self.pill_y;
        if (start - target).abs() < 0.5 {
            self.pill_y = target;
            cx.notify();
            return;
        }
        cx.spawn(async move |this, cx| {
            let steps = 18u32;
            for step in 1..=steps {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(16))
                    .await;
                let t = step as f32 / steps as f32;
                let eased = 1.0 - (1.0 - t).powi(3);
                let y = start + (target - start) * eased;
                let keep = this
                    .update(cx, |this, cx| {
                        if this.pill_gen != generation {
                            return false;
                        }
                        this.pill_y = y;
                        cx.notify();
                        true
                    })
                    .unwrap_or(false);
                if !keep {
                    break;
                }
            }
        })
        .detach();
    }

    fn pill_target_for_page(&self, page: Page) -> (f32, bool) {
        match page {
            Page::Home => (40.0, true),
            Page::Host => (82.0, true),
            Page::Servers => (124.0, true),
            Page::Modpacks => (166.0, true),
            Page::Versions => (214.0, true),
            Page::Instance => (78.0 + self.instance_tab as usize as f32 * 38.0, true),
            _ => (0.0, false),
        }
    }

    pub fn open_instance(&mut self, id: String, cx: &mut Context<Self>) {
        self.selected_instance = Some(id.clone());
        self.page = Page::Instance;
        self.instance_tab = InstanceTab::Overview;
        self.instance_ui = InstanceUi::default();
        self.update_pill(78.0, true, cx);
        self.instance_ui.logs = self.logs.get(&id).cloned().unwrap_or_default();
        self.load_instance_tab(cx);
        if let Some(entry) = self.instances.iter().find(|i| i.id == id) {
            self.backend.discord_update(json!({
                "name": entry.name,
                "version": entry.version,
                "loader": entry.loader,
                "loaderVersion": entry.loader_version,
                "status": "ready",
            }));
        }
        cx.notify();
    }

    pub fn load_instance_tab(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.selected_instance.clone() else {
            return;
        };
        match self.instance_tab {
            InstanceTab::Overview => self.load_worlds(cx),
            InstanceTab::Mods => {
                let rx = self.backend.mods_inventory(id);
                self.on_result(cx, rx, |this, value, cx| {
                    this.instance_ui.mods = value
                        .get("mods")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    let urls: Vec<String> = this
                        .instance_ui
                        .mods
                        .iter()
                        .filter_map(|row| row.get("icon").and_then(Value::as_str).map(str::to_string))
                        .filter(|url| !url.is_empty())
                        .collect();
                    this.cache_icons(urls, cx);
                });
            }
            InstanceTab::Files
            | InstanceTab::Resourcepacks
            | InstanceTab::Shaderpacks => {
                let folder = match self.instance_tab {
                    InstanceTab::Resourcepacks => "resourcepacks",
                    InstanceTab::Shaderpacks => "shaderpacks",
                    _ => "",
                };
                let rel = if folder.is_empty() {
                    self.instance_ui.rel.clone()
                } else if self.instance_ui.rel.is_empty() {
                    folder.to_string()
                } else {
                    format!("{folder}/{}", self.instance_ui.rel)
                };
                let value = self.backend.list_dir(&id, &rel);
                self.instance_ui.entries = value
                    .get("entries")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
            }
            InstanceTab::Trash => {
                let value = self.backend.list_trash(&id);
                self.instance_ui.trash = value
                    .get("entries")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
            }
            InstanceTab::Saves => self.load_worlds(cx),
            InstanceTab::Console => {
                self.instance_ui.logs = self.logs.get(&id).cloned().unwrap_or_default();
            }
            InstanceTab::Settings => {
                if let Some(entry) = self.instances.iter().find(|e| e.id == id).cloned() {
                    let name = entry.name.clone();
                    let memory = entry.memory_mb.to_string();
                    let jvm = entry.jvm_args.clone().unwrap_or_default();
                    let name_input = self.name_input.clone();
                    name_input.update(cx, |input, cx| input.set_text(name, cx));
                    let memory_input = self.memory_input.clone();
                    memory_input.update(cx, |input, cx| input.set_text(memory, cx));
                    let jvm_input = self.jvm_input.clone();
                    jvm_input.update(cx, |input, cx| input.set_text(jvm, cx));
                }
            }
            _ => {}
        }
    }

    pub fn load_worlds(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.selected_instance.clone() else {
            return;
        };
        let value = self.backend.world_list(&id);
        self.instance_ui.worlds = value
            .get("worlds")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let _ = cx;
    }

    pub fn host_timer(&mut self, cx: &mut Context<Self>) {
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_secs(2))
                    .await;
                let ok = this
                    .update(cx, |this, cx| {
                        if this.page == Page::Host {
                            this.refresh_host(cx);
                            cx.notify();
                        }
                    })
                    .is_ok();
                if !ok {
                    break;
                }
            }
        })
        .detach();
    }

    pub fn start_splash(&mut self, cx: &mut Context<Self>) {
        let frames = self.splash_frames.clone();
        if frames.len() <= 1 {
            self.splash_loading = true;
            self.splash_loading_at = Some(std::time::Instant::now());
            cx.spawn(async move |this, cx| {
                let loading_start = std::time::Instant::now();
                loop {
                    cx.background_executor()
                        .timer(std::time::Duration::from_millis(100))
                        .await;
                    let ready = this
                        .update(cx, |this, cx| {
                            cx.notify();
                            this.boot_ready
                        })
                        .unwrap_or(true);
                    if (ready && loading_start.elapsed().as_millis() >= 800)
                        || loading_start.elapsed().as_secs() > 25
                    {
                        break;
                    }
                }
                let _ = this.update(cx, |this, cx| {
                    this.splash_fading = true;
                    this.splash_fade_at = Some(std::time::Instant::now());
                    this.boot = false;
                    cx.notify();
                });
                for _ in 0..27 {
                    cx.background_executor()
                        .timer(std::time::Duration::from_millis(16))
                        .await;
                    let _ = this.update(cx, |_this, cx| cx.notify());
                }
                let _ = this.update(cx, |this, cx| {
                    this.boot_splash = false;
                    cx.notify();
                });
            })
            .detach();
            return;
        }

        // Decode the splash video ahead of playback on a background thread so
        // presentation never waits on JPEG decoding.
        let (tx, rx) = std::sync::mpsc::sync_channel::<(usize, image::RgbaImage)>(14);
        let decode_frames = frames.clone();
        std::thread::spawn(move || {
            for (index, path) in decode_frames.iter().enumerate() {
                let Ok(bytes) = std::fs::read(path) else {
                    continue;
                };
                let Ok(decoded) = image::load_from_memory(&bytes) else {
                    continue;
                };
                if tx.send((index, decoded.to_rgba8())).is_err() {
                    break;
                }
            }
        });

        cx.spawn(async move |this, cx| {
            let started = std::time::Instant::now();
            let frame_count = frames.len();
            let fps = 30.0f32;
            let mut buffer: std::collections::VecDeque<(usize, image::RgbaImage)> =
                std::collections::VecDeque::new();
            let mut shown: Option<usize> = None;
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(6))
                    .await;
                while buffer.len() < 20 {
                    match rx.try_recv() {
                        Ok(item) => buffer.push_back(item),
                        Err(std::sync::mpsc::TryRecvError::Empty) => break,
                        Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
                    }
                }
                let due = (started.elapsed().as_secs_f32() * fps) as usize;
                if due >= frame_count {
                    break;
                }
                while buffer.len() > 1 && buffer[1].0 <= due {
                    buffer.pop_front();
                }
                if let Some((index, _)) = buffer.front() {
                    if *index <= due && shown != Some(*index) {
                        let (index, pixels) = buffer.pop_front().unwrap();
                        shown = Some(index);
                        let frame = image::Frame::new(pixels);
                        let image = Arc::new(gpui::RenderImage::new(vec![frame]));
                        let _ = this.update(cx, |this, cx| {
                            this.splash_index = index;
                            this.splash_image = Some(image);
                            if index + 5 >= frame_count && !this.splash_loading {
                                this.splash_loading = true;
                                this.splash_loading_at = Some(std::time::Instant::now());
                            }
                            cx.notify();
                        });
                    }
                }
            }
            let _ = this.update(cx, |this, cx| {
                if !this.splash_loading {
                    this.splash_loading = true;
                    this.splash_loading_at = Some(std::time::Instant::now());
                }
                cx.notify();
            });
            // Keep the loading screen up until the launcher data is actually ready.
            let loading_start = std::time::Instant::now();
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(100))
                    .await;
                let ready = this
                    .update(cx, |this, cx| {
                        cx.notify();
                        this.boot_ready
                    })
                    .unwrap_or(true);
                if (ready && loading_start.elapsed().as_millis() >= 750)
                    || loading_start.elapsed().as_secs() > 25
                {
                    break;
                }
            }
            let _ = this.update(cx, |this, cx| {
                this.splash_fading = true;
                this.splash_fade_at = Some(std::time::Instant::now());
                this.boot = false;
                cx.notify();
            });
            for _ in 0..27 {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(16))
                    .await;
                let _ = this.update(cx, |_this, cx| cx.notify());
            }
            let _ = this.update(cx, |this, cx| {
                this.boot_splash = false;
                cx.notify();
            });
        })
        .detach();
    }

    pub fn listen_events(&mut self, events: Receiver<Value>, cx: &mut Context<Self>) {
        cx.spawn(async move |this, cx| {
            while let Ok(event) = events.recv().await {
                let _ = this.update(cx, |this, cx| {
                    this.handle_event(event, cx);
                });
            }
        })
        .detach();
    }

    fn handle_event(&mut self, event: Value, cx: &mut Context<Self>) {
        let kind = event.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "progress" => {
                let id = event.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                let phase = event.get("phase").and_then(Value::as_str).unwrap_or("");
                self.progress.insert(id.clone(), event.clone());
                if phase == "done" || phase == "error" {
                    self.refresh_instances();
                    if phase == "error" {
                        self.toast(
                            "bad",
                            "Cài đặt thất bại",
                            event
                                .get("error")
                                .and_then(Value::as_str)
                                .unwrap_or("Không rõ lỗi")
                                .to_string(),
                            cx,
                        );
                    } else {
                        self.toast("ok", "Cài đặt hoàn tất", "Phiên bản đã sẵn sàng.", cx);
                    }
                }
            }
            "log" => {
                let id = event.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                let line = event.get("line").and_then(Value::as_str).unwrap_or("").to_string();
                let buffer = self.logs.entry(id.clone()).or_default();
                buffer.push(line.clone());
                if buffer.len() > 2000 {
                    let overflow = buffer.len() - 2000;
                    buffer.drain(0..overflow);
                }
                if self.selected_instance.as_deref() == Some(id.as_str()) {
                    self.instance_ui.logs.push(line);
                    if self.instance_ui.logs.len() > 2000 {
                        let overflow = self.instance_ui.logs.len() - 2000;
                        self.instance_ui.logs.drain(0..overflow);
                    }
                    if self.console_auto {
                        self.console_scroll.scroll_to_bottom();
                    }
                }
            }
            "state" => {
                let id = event.get("id").and_then(Value::as_str).unwrap_or("");
                let status = event.get("status").and_then(Value::as_str).unwrap_or("");
                if let Some(entry) = self.instances.iter_mut().find(|e| e.id == id) {
                    entry.status = status.to_string();
                    entry.running = status == "running" || status == "starting";
                }
            }
            "exit" => {
                self.refresh_instances();
                if let Some(id) = event.get("id").and_then(Value::as_str) {
                    if self.selected_instance.as_deref() == Some(id) {
                        self.load_worlds(cx);
                    }
                }
            }
            "created" | "instances-changed" | "content-installed" => {
                self.refresh_instances();
                if let Some(id) = self.selected_instance.clone() {
                    if kind == "content-installed" {
                        if self.instance_tab == InstanceTab::Mods {
                            self.load_instance_tab(cx);
                        }
                    } else {
                        let _ = id;
                    }
                }
            }
            "modpack" => {
                let token = event.get("token").and_then(Value::as_str).unwrap_or("").to_string();
                self.progress.insert(token.clone(), event.clone());
                let phase = event.get("phase").and_then(Value::as_str).unwrap_or("");
                if phase == "done" {
                    self.toast(
                        "ok",
                        "Cài modpack xong",
                        event
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("Modpack")
                            .to_string(),
                        cx,
                    );
                    self.refresh_instances();
                } else if phase == "error" {
                    self.toast(
                        "bad",
                        "Cài modpack thất bại",
                        event
                            .get("error")
                            .and_then(Value::as_str)
                            .unwrap_or("Không rõ lỗi")
                            .to_string(),
                        cx,
                    );
                }
            }
            "server-log" => {
                let id = event.get("serverId").and_then(Value::as_str).unwrap_or("").to_string();
                let message = event.get("message").and_then(Value::as_str).unwrap_or("").to_string();
                if self.server_ui.selected.as_deref() == Some(id.as_str()) {
                    self.server_ui.console.push(message);
                    if self.server_ui.console.len() > 2000 {
                        let overflow = self.server_ui.console.len() - 2000;
                        self.server_ui.console.drain(0..overflow);
                    }
                }
            }
            "server-state" => {
                let id = event.get("serverId").and_then(Value::as_str).unwrap_or("");
                let status = event.get("status").and_then(Value::as_str).unwrap_or("");
                for server in &mut self.server_ui.servers {
                    if server.get("id").and_then(Value::as_str) == Some(id) {
                        server["status"] = Value::String(status.to_string());
                    }
                }
            }
            "servers-changed" => {
                self.load_servers(cx);
            }
            "server-progress" => {
                if let Some(message) = event.get("message").and_then(Value::as_str) {
                    let server_id = event.get("serverId").and_then(Value::as_str).unwrap_or("");
                    if self.server_ui.selected.as_deref() == Some(server_id) {
                        self.toast("info", "ServerLocalHost", message.to_string(), cx);
                    }
                }
            }
            "crash" => {
                if self.selected_instance.as_deref() == event.get("id").and_then(Value::as_str) {
                    self.crash = event.get("crash").cloned();
                }
            }
            "ms_login" => {
                if event.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                    let session = event.pointer("/data/session").cloned().unwrap_or(Value::Null);
                    let value = self.backend.complete_ms_login(
                        serde_json::from_value(session).unwrap_or_default(),
                    );
                    if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                        self.refresh_accounts();
                        self.account_ui.open = false;
                        self.account_ui.ms_waiting = false;
                        self.toast("ok", "Đã thêm tài khoản Microsoft", "", cx);
                    }
                } else {
                    self.account_ui.ms_waiting = false;
                    self.account_ui.error = event
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("Đăng nhập Microsoft thất bại")
                        .to_string();
                }
            }
            _ => {}
        }
        cx.notify();
    }

    pub fn toast(&mut self, tone: &'static str, title: impl Into<String>, message: impl Into<String>, cx: &mut Context<Self>) {
        self.toast_seq += 1;
        let toast = Toast {
            id: self.toast_seq,
            tone,
            title: title.into(),
            message: message.into(),
        };
        self.toasts.push(toast.clone());
        let id = toast.id;
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(std::time::Duration::from_secs(5))
                .await;
            let _ = this.update(cx, |this, cx| {
                this.toasts.retain(|t| t.id != id);
                cx.notify();
            });
        })
        .detach();
    }

    pub fn on_result<F>(&mut self, cx: &mut Context<Self>, rx: Receiver<Value>, callback: F)
    where
        F: FnOnce(&mut Self, Value, &mut Context<Self>) + 'static,
    {
        let mut callback = Some(callback);
        cx.spawn(async move |this, cx| {
            if let Ok(value) = rx.recv().await {
                let _ = this.update(cx, |this, cx| {
                    if let Some(callback) = callback.take() {
                        callback(this, value, cx);
                        cx.notify();
                    }
                });
            }
        })
        .detach();
    }

    pub fn load_versions(&mut self, snapshots: bool, force: bool, cx: &mut Context<Self>) {
        self.versions_loading = true;
        self.versions_error.clear();
        let rx = self.backend.versions(snapshots, force);
        self.on_result(cx, rx, |this, value, _cx| {
            this.versions_loading = false;
            this.boot_ready = true;
            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                this.versions = value
                    .get("versions")
                    .and_then(Value::as_array)
                    .map(|rows| {
                        rows.iter()
                            .filter_map(|row| serde_json::from_value(row.clone()).ok())
                            .collect()
                    })
                    .unwrap_or_default();
                this.latest = value.get("latest").cloned().unwrap_or(Value::Null);
            } else {
                this.versions_error = value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Không tải được danh sách phiên bản")
                    .to_string();
            }
        });
    }

    pub fn load_system(&mut self, cx: &mut Context<Self>) {
        let rx = self.backend.system_info();
        self.on_result(cx, rx, |this, value, _cx| {
            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                this.system = value;
            }
        });
    }

    pub fn set_page(&mut self, page: Page, cx: &mut Context<Self>) {
        if page == Page::Instance {
            if self.selected_instance.is_none() {
                if let Some(first) = self.instances.first() {
                    let id = first.id.clone();
                    self.open_instance(id, cx);
                    return;
                }
                self.page = Page::Versions;
                cx.notify();
                return;
            }
        }
        if page == Page::Modpacks && self.content.hits.is_empty() {
            self.search_content(self.content_search.read(cx).text().to_string(), cx);
        }
        if page == Page::Settings {
            self.load_java(cx);
        }
        if page == Page::Host {
            self.refresh_host(cx);
        }
        if page == Page::Servers {
            self.load_servers(cx);
        }
        self.page = page;
        self.select_open = None;
        self.page_scroll.set_offset(gpui::point(px(0.0), px(0.0)));
        let (target, visible) = self.pill_target_for_page(page);
        self.update_pill(target, visible, cx);
        cx.notify();
    }

    pub fn instance_icon_path(&self, instance: &Instance) -> Option<String> {
        if let Some(icon) = instance.icon.as_deref() {
            if icon.starts_with("http") {
                return self.icon_cache.get(icon).cloned();
            }
            if std::path::Path::new(icon).is_file() {
                return Some(icon.to_string());
            }
        }
        let local = std::path::Path::new(&instance.dir).join("icon.png");
        local.is_file().then(|| local.to_string_lossy().into_owned())
    }

    pub fn cache_icons(&mut self, urls: Vec<String>, cx: &mut Context<Self>) {
        for url in urls {
            if url.is_empty() || self.icon_cache.contains_key(&url) || self.icon_pending.contains(&url) {
                continue;
            }
            self.icon_pending.insert(url.clone());
            let rx = self.backend.cache_instance_icon(url.clone());
            self.on_result(cx, rx, move |this, value, cx| {
                this.icon_pending.remove(&url);
                if let Some(path) = value.get("path").and_then(Value::as_str) {
                    this.icon_cache.insert(url.clone(), path.to_string());
                    cx.notify();
                }
            });
        }
    }

    pub fn instance_progress(&self, id: &str) -> Option<(String, f32, bool, String)> {
        let row = self.progress.get(id)?;
        let phase = row.get("phase").and_then(Value::as_str).unwrap_or("");
        if phase == "done" || phase == "error" || phase == "clear" {
            return None;
        }
        let bytes = row.get("bytesDone").and_then(Value::as_f64).unwrap_or(0.0);
        let total = row.get("totalBytes").and_then(Value::as_f64).unwrap_or(0.0);
        let done = row.get("done").and_then(Value::as_f64).unwrap_or(0.0);
        let count = row.get("total").and_then(Value::as_f64).unwrap_or(0.0);
        let percent = if total > 0.0 {
            (bytes / total * 100.0) as f32
        } else if count > 0.0 {
            (done / count * 100.0) as f32
        } else {
            0.0
        };
        let label = row
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let indeterminate = total <= 0.0 && count <= 0.0;
        Some((label, percent, indeterminate, phase.to_string()))
    }


    fn sidebar_item(
        &self,
        id: &'static str,
        page: Page,
        icon_name: &'static str,
        label: &'static str,
        cx: &Context<Self>,
    ) -> impl IntoElement {
        let active = self.page == page;
        let theme = self.theme.clone();
        let collapsed = self.rail_collapsed;
        let entity = cx.entity().downgrade();
        let row = div()
            .id(id)
            .flex()
            .items_center()
            .gap(px(11.0))
            .h(px(38.0))
            .px(px(if collapsed { 0.0 } else { 12.0 }))
            .when(collapsed, |el| el.justify_center())
            .rounded(px(RADIUS_SM))
            .cursor_pointer()
            .text_size(px(TEXT_BASE))
            .font_weight(if active {
                FontWeight::SEMIBOLD
            } else {
                FontWeight::MEDIUM
            })
            .text_color(if active { theme.text } else { theme.muted })
            .when(active, |el| el.bg(theme.surface_active))
            .when(!active, |el| el.hover(|s| s.bg(theme.surface_hover).text_color(theme.text)))
            .on_click(move |_, _, app| {
                let _ = entity.update(app, |this, cx| this.set_page(page, cx));
            })
            .child(widgets::icon(icon_name, 17.0, if active { theme.accent_soft } else { theme.faint }));
        if collapsed {
            row
        } else {
            row.child(label)
        }
    }

    fn sidebar(&self, cx: &Context<Self>) -> impl IntoElement {
        let theme = self.theme.clone();
        let collapsed = self.rail_collapsed;
        let width = if collapsed { 64.0 } else { 180.0 };
        let in_instance = self.page == Page::Instance;
        let account = self
            .accounts
            .iter()
            .find(|a| Some(&a.id) == self.active_account.as_ref())
            .cloned();
        let head = account.as_ref().and_then(|a| {
            if a.kind == "offline" {
                let skin = self.backend.skin_read(&a.uuid);
                skin.get("skinPath").and_then(Value::as_str).and_then(|path| {
                    crate::mc::skins::head_png(&self.backend.store, std::path::Path::new(path), &a.uuid)
                })
            } else {
                None
            }
        });
        let entity = cx.entity().downgrade();
        let has_head = head.is_some();
        let collapse_view = entity.clone();
        let nav = |id: &'static str,
                   icon_name: &'static str,
                   label: String,
                   active: bool,
                   on_click: Box<dyn Fn(&mut LauncherApp, &mut Context<LauncherApp>)>|
         -> AnyElement {
            let entity = cx.entity().downgrade();
            let label = label.clone();
            div()
                .id(id)
                .flex()
                .items_center()
                .gap(px(12.0))
                .h(px(36.0))
                .px(px(if collapsed { 0.0 } else { 10.0 }))
                .when(collapsed, |el| el.justify_center())
                .rounded(px(8.0))
                .cursor_pointer()
                .text_size(px(12.0))
                .font_weight(if active { FontWeight::SEMIBOLD } else { FontWeight::MEDIUM })
                .text_color(if active { theme.accent_soft } else { theme.muted })
                .when(!active, |el| el.hover(|st| st.text_color(theme.text).bg(theme.surface_hover)))
                .on_click(move |_, _, cx| {
                    let _ = entity.update(cx, |this, cx| on_click(this, cx));
                })
                .child(widgets::icon(icon_name, 17.0, if active { theme.accent_soft } else { theme.faint }))
                .when(!collapsed, |el| el.child(label))
                .into_any_element()
        };

        let mut rail = div()
            .flex()
            .flex_col()
            .w(px(width))
            .h_full()
            .flex_shrink_0()
            .relative()
            .bg(theme.sidebar)
            .border_r_1()
            .border_color(theme.border_soft)
            .pt(px(10.0))
            .pb(px(8.0))
            .px(px(8.0))
            .gap(px(6.0));

        rail = rail.child(
            div()
                .flex()
                .items_center()
                .justify_end()
                .h(px(24.0))
                .child(widgets::tip("tip-rail", if collapsed { "Mở rộng" } else { "Thu gọn" }, cx.entity().downgrade(), div()
                        .id("rail-toggle")
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(24.0))
                        .rounded(px(6.0))
                        .bg(theme.elevated)
                        .border_1()
                        .border_color(theme.border)
                        .cursor_pointer()
                        .hover(|st| st.bg(theme.surface_hover))
                        .on_click(move |_, _, cx| {
                            let _ = collapse_view.update(cx, |this, cx| {
                                this.rail_collapsed = !this.rail_collapsed;
                                cx.notify();
                            });
                        })
                        .child(widgets::icon("sidebar-simple", 13.0, theme.faint)))),
        );

        if self.pill_visible {
            rail = rail.child(
                div()
                    .id("nav-pill")
                    .absolute()
                    .left(px(8.0))
                    .right(px(8.0))
                    .top(px(self.pill_y))
                    .h(px(36.0))
                    .rounded(px(8.0))
                    .bg(theme.surface_active)
                    .child(
                        div()
                            .absolute()
                            .left(px(0.0))
                            .top(px(7.0))
                            .bottom(px(7.0))
                            .w(px(2.0))
                            .rounded_full()
                            .bg(theme.accent),
                    ),
            );
        }

        // Top group: instance mode shows Home/back; otherwise the main pages.
        if in_instance {
            rail = rail.child(nav(
                "nav-back",
                "arrow-left",
                "Trang chủ".into(),
                false,
                Box::new(|this, cx| {
                    this.selected_instance = None;
                    this.set_page(Page::Home, cx);
                }),
            ));
        } else {
            rail = rail
                .child(nav("nav-home", "house", "Trang chủ".into(), self.page == Page::Home, Box::new(|this, cx| this.set_page(Page::Home, cx))))
                .child(nav("nav-host", "cloud", "Host".into(), self.page == Page::Host, Box::new(|this, cx| this.set_page(Page::Host, cx))))
                .child(nav(
                    "nav-servers",
                    "hard-drives",
                    "ServerLocalHost".into(),
                    self.page == Page::Servers,
                    Box::new(|this, cx| this.set_page(Page::Servers, cx)),
                ))
                .child(nav("nav-modpacks", "stack", "Modpack".into(), self.page == Page::Modpacks, Box::new(|this, cx| this.set_page(Page::Modpacks, cx))));
        }

        // Middle group: instance tabs or instance list.
        let mut middle = div()
            .id("sidebar-middle")
            .flex()
            .flex_col()
            .gap(px(2.0))
            .flex_1()
            .min_h(px(0.0))
            .overflow_y_scroll()
            .pt(px(6.0));
        if in_instance {
            let items = [
                (InstanceTab::Overview, "chart-line", "Tổng quan"),
                (InstanceTab::Console, "terminal", "Console"),
                (InstanceTab::Mods, "puzzle-piece", "Mods"),
                (InstanceTab::Resourcepacks, "image", "Gói tài nguyên"),
                (InstanceTab::Shaderpacks, "paint-brush", "Shader"),
                (InstanceTab::Files, "files", "Tệp tin"),
                (InstanceTab::Trash, "trash", "Thùng rác"),
                (InstanceTab::Saves, "archive", "Bản lưu"),
                (InstanceTab::Map, "map-trifold", "Bản đồ"),
                (InstanceTab::Settings, "gear-six", "Cài đặt"),
            ];
            for (tab, icon_name, label) in items {
                middle = middle.child(nav(
                    match tab {
                        InstanceTab::Overview => "itab-overview",
                        InstanceTab::Console => "itab-console",
                        InstanceTab::Mods => "itab-mods",
                        InstanceTab::Resourcepacks => "itab-resourcepacks",
                        InstanceTab::Shaderpacks => "itab-shaderpacks",
                        InstanceTab::Files => "itab-files",
                        InstanceTab::Trash => "itab-trash",
                        InstanceTab::Saves => "itab-saves",
                        InstanceTab::Map => "itab-map",
                        InstanceTab::Settings => "itab-settings",
                    },
                    icon_name,
                    label.into(),
                    self.instance_tab == tab,
                    Box::new(move |this, cx| {
                        this.instance_tab = tab;
                        let target = 78.0 + tab as usize as f32 * 38.0;
                        this.update_pill(target, true, cx);
                        this.load_instance_tab(cx);
                        cx.notify();
                    }),
                ));
            }
        } else {
            let view_new = entity.clone();
            middle = middle.child(
                div()
                    .id("nav-new-instance")
                    .flex()
                    .items_center()
                    .gap(px(12.0))
                    .h(px(36.0))
                    .px(px(if collapsed { 0.0 } else { 10.0 }))
                    .when(collapsed, |el| el.justify_center())
                    .rounded(px(8.0))
                    .cursor_pointer()
                    .text_size(px(12.0))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(if self.page == Page::Versions { theme.accent_soft } else { theme.muted })
                    .when(self.page == Page::Versions, |el| el.bg(theme.surface_active))
                    .hover(|st| st.text_color(theme.text).bg(theme.surface_hover))
                    .on_click(move |_, _, cx| {
                        let _ = view_new.update(cx, |this, cx| this.set_page(Page::Versions, cx));
                    })
                    .child(widgets::icon("plus", 17.0, theme.faint))
                    .when(!collapsed, |el| el.child("Tạo phiên bản mới")),
            );
            let view_list = entity.clone();
            for instance in self.instances.iter().cloned().collect::<Vec<_>>() {
                let active = self.selected_instance.as_deref() == Some(instance.id.as_str()) && self.page == Page::Instance;
                let icon_path = self.instance_icon_path(&instance);
                let status_color = if instance.running || instance.status == "running" {
                    theme.ok
                } else if instance.status == "error" {
                    theme.bad
                } else if matches!(instance.status.as_str(), "installing" | "starting" | "stopping") {
                    theme.warn
                } else {
                    theme.faint
                };
                let has_icon = icon_path.is_some();
                let loader_png = crate::ui::assets::image_path(&format!(
                    "loader-icon/{}.png",
                    match instance.loader.as_str() {
                        "fabric" => "fabric",
                        "quilt" => "quilt",
                        "forge" => "forge",
                        "neoforge" => "neoforge",
                        "lunar" => "lunar",
                        _ => "vanilla",
                    }
                ));
                let view_row = view_list.clone();
                let id = instance.id.clone();
                let name = instance.name.clone();
                let status = instance.status.clone();
                middle = middle.child(
                    div()
                        .id(SharedString::from(format!("side-inst-{}", instance.id)))
                        .flex()
                        .items_center()
                        .gap(px(9.0))
                        .h(px(38.0))
                        .px(px(if collapsed { 0.0 } else { 6.0 }))
                        .when(collapsed, |el| el.justify_center())
                        .rounded(px(8.0))
                        .cursor_pointer()
                        .when(active, |el| el.bg(theme.surface_active))
                        .hover(|st| st.bg(theme.surface_hover))
                        .on_click(move |_, _, cx| {
                            let id = id.clone();
                            let _ = view_row.update(cx, |this, cx| this.open_instance(id, cx));
                        })
                        .when_some(icon_path, |el, path| {
                            el.child(gpui::img(path).size(px(26.0)).rounded(px(6.0)).object_fit(gpui::ObjectFit::Cover))
                        })
                        .when(!has_icon, |el| {
                            el.child(gpui::img(loader_png).size(px(26.0)).rounded(px(6.0)).object_fit(gpui::ObjectFit::Contain))
                        })
                        .when(!collapsed, |el| {
                            el.child(
                                div()
                                    .flex_1()
                                    .min_w(px(0.0))
                                    .text_size(px(11.5))
                                    .font_weight(if active { FontWeight::SEMIBOLD } else { FontWeight::MEDIUM })
                                    .text_color(if active { theme.text } else { theme.muted })
                                    .truncate()
                                    .child(name),
                            )
                            .child(div().size(px(6.0)).rounded_full().bg(status_color))
                        }),
                );
                let _ = status;
            }
        }
        rail = rail.child(middle);

        // Bottom group: account, settings, version.
        let view_acc = entity.clone();
        let mut bottom = div().flex().flex_col().gap(px(2.0)).pt(px(6.0));
        bottom = bottom.child(
            div()
                .id("side-account")
                .flex()
                .items_center()
                .gap(px(9.0))
                .h(px(38.0))
                .px(px(if collapsed { 0.0 } else { 6.0 }))
                .when(collapsed, |el| el.justify_center())
                .rounded(px(8.0))
                .cursor_pointer()
                .when(self.page == Page::Accounts, |el| el.bg(theme.surface_active))
                .hover(|st| st.bg(theme.surface_hover))
                .on_click(move |_, _, cx| {
                    let _ = view_acc.update(cx, |this, cx| this.set_page(Page::Accounts, cx));
                })
                .when_some(head, |el, path| {
                    el.child(gpui::img(path).size(px(26.0)).rounded(px(6.0)).object_fit(gpui::ObjectFit::Cover))
                })
                .when(!has_head, |el| {
                    el.child(
                        div()
                            .size(px(26.0))
                            .rounded(px(6.0))
                            .bg(theme.accent_dim)
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_size(px(11.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(theme.accent_soft)
                            .child(
                                account
                                    .as_ref()
                                    .map(|a| a.name.chars().next().unwrap_or('?').to_uppercase().to_string())
                                    .unwrap_or_else(|| "?".into()),
                            ),
                    )
                })
                .when(!collapsed, |el| {
                    el.child(
                        div()
                            .flex_1()
                            .min_w(px(0.0))
                            .text_size(px(11.5))
                            .text_color(theme.muted)
                            .truncate()
                            .child(
                                account
                                    .as_ref()
                                    .map(|a| a.name.clone())
                                    .unwrap_or_else(|| "Chưa có tài khoản".into()),
                            ),
                    )
                }),
        );
        bottom = bottom.child(nav("nav-settings", "gear", "Hệ thống".into(), self.page == Page::Settings, Box::new(|this, cx| this.set_page(Page::Settings, cx))));
        bottom = bottom.child(
            div()
                .flex()
                .justify_center()
                .pt(px(2.0))
                .text_size(px(9.0))
                .font_family(MONO)
                .text_color(theme.faint)
                .when(collapsed, |el| el.hidden())
                .child("v2.0.0"),
        );
        rail = rail.child(bottom);
        rail
    }

    fn titlebar(&self, cx: &Context<Self>) -> impl IntoElement {
        let theme = self.theme.clone();
        let view = cx.entity().downgrade();
        div()
            .flex()
            .items_center()
            .h(px(44.0))
            .flex_shrink_0()
            .bg(theme.bg)
            .border_b_1()
            .border_color(theme.border_soft)
            .child(
                div()
                    .id("titlebar-drag")
                    .flex()
                    .items_center()
                    .gap(px(10.0))
                    .pl(px(16.0))
                    .h_full()
                    .flex_1()
                    .window_control_area(gpui::WindowControlArea::Drag)
                    .child(
                        gpui::img(crate::ui::assets::image_path("xyolauncher.png"))
                            .size(px(28.0))
                            .rounded(px(7.0))
                            .object_fit(gpui::ObjectFit::Cover),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .justify_center()
                            .child(
                                div()
                                    .text_size(px(13.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(theme.text)
                                    .child("XyoLauncher"),
                            )
                            .child(
                                div()
                                    .text_size(px(8.5))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(theme.faint)
                                    .child("LAUNCHER"),
                            ),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(2.0))
                    .pr(px(8.0))
                    .child(widgets::tip("tip-win-min", "Thu nhỏ", view.clone(), div()
                        .id("win-min")
                        .flex()
                        .items_center()
                        .justify_center()
                        .w(px(38.0))
                        .h(px(28.0))
                        .rounded(px(6.0))
                        .cursor_pointer()
                        .hover(|st| st.bg(theme.surface_hover))
                        .on_click(|_, window, _| window.minimize_window())
                        .child(widgets::icon("minus", 13.0, theme.muted))))
                    .child(widgets::tip("tip-win-max", "Phóng to", view.clone(), div()
                        .id("win-max")
                        .flex()
                        .items_center()
                        .justify_center()
                        .w(px(38.0))
                        .h(px(28.0))
                        .rounded(px(6.0))
                        .cursor_pointer()
                        .hover(|st| st.bg(theme.surface_hover))
                        .on_click(|_, window, _| window.zoom_window())
                        .child(widgets::icon("square", 12.0, theme.muted))))
                    .child(widgets::tip("tip-win-close", "Đóng", view.clone(), div()
                        .id("win-close")
                        .flex()
                        .items_center()
                        .justify_center()
                        .w(px(38.0))
                        .h(px(28.0))
                        .rounded(px(6.0))
                        .cursor_pointer()
                        .hover(|st| st.bg(theme.bad).text_color(gpui::white()))
                        .on_click(|_, window, _| window.remove_window())
                        .child(widgets::icon("x", 13.0, theme.muted)))),
            )
    }

    fn tooltip_layer(&self, window: &Window) -> impl IntoElement {
        let theme = self.theme.clone();
        let viewport = window.viewport_size();
        let text = self.tip.clone().unwrap_or_default();
        let x = self.mouse_pos.x + px(14.0);
        let y = self.mouse_pos.y + px(20.0);
        let max_x = (viewport.width - px(220.0)).max(px(8.0));
        let x = x.min(max_x);
        div()
            .absolute()
            .left(x)
            .top(y)
            .px(px(8.0))
            .py(px(5.0))
            .rounded(px(6.0))
            .bg(theme.elevated)
            .border_1()
            .border_color(theme.border)
            .shadow_lg()
            .text_size(px(10.5))
            .font_weight(FontWeight::MEDIUM)
            .text_color(theme.text)
            .when(text.is_empty(), |el| el.hidden())
            .child(text)
    }

    fn toast_layer(&self) -> impl IntoElement {
        let theme = self.theme.clone();
        let mut layer = div()
            .absolute()
            .bottom(px(18.0))
            .right(px(18.0))
            .flex()
            .flex_col()
            .gap(px(10.0))
            .w(px(340.0));
        for toast in &self.toasts {
            let color = match toast.tone {
                "ok" => theme.ok,
                "bad" => theme.bad,
                "warn" => theme.warn,
                _ => theme.info,
            };
            let icon_name = match toast.tone {
                "ok" => "check-circle",
                "bad" => "warning-circle",
                "warn" => "warning",
                _ => "info",
            };
            let toast_id: SharedString = format!("toast-{}", toast.id).into();
            layer = layer.child(
                div()
                    .flex()
                    .items_start()
                    .gap_3()
                    .p(px(14.0))
                    .rounded(px(RADIUS))
                    .bg(theme.elevated)
                    .border_1()
                    .border_color(theme.border)
                    .shadow_lg()
                    .child(widgets::icon(icon_name, 18.0, color))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(2.0))
                            .child(
                                div()
                                    .text_size(px(TEXT_BASE))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(theme.text)
                                    .child(toast.title.clone()),
                            )
                            .when(!toast.message.is_empty(), |el| {
                                el.child(
                                    div()
                                        .text_size(px(TEXT_SM))
                                        .text_color(theme.muted)
                                        .child(toast.message.clone()),
                                )
                            }),
                    )
                    .with_animation(
                        ElementId::Name(toast_id),
                        gpui::Animation::new(std::time::Duration::from_millis(220)),
                        |el, t| el.opacity(t).mt(px(8.0 * (1.0 - t))),
                    ),
            );
        }
        layer
    }

    fn content(&mut self, window: &mut Window, cx: &mut Context<Self>) -> gpui::AnyElement {
        match self.page {
            Page::Home => pages::home::render(self, window, cx).into_any_element(),
            Page::Versions => pages::versions::render(self, window, cx).into_any_element(),
            Page::Modpacks => pages::modpack::render(self, window, cx).into_any_element(),
            Page::Accounts => pages::accounts::render(self, window, cx).into_any_element(),
            Page::Host => pages::host::render(self, window, cx).into_any_element(),
            Page::Servers => pages::servers::render(self, window, cx).into_any_element(),
            Page::Settings => pages::settings::render(self, window, cx).into_any_element(),
            Page::Instance => pages::instance::render(self, window, cx).into_any_element(),
        }
    }

    fn modal_layer(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<gpui::AnyElement> {
        match &self.modal {
            Modal::None => None,
            Modal::Create => Some(pages::versions::create_modal(self, window, cx).into_any_element()),
            Modal::AddAccount => Some(pages::accounts::add_account_modal(self, window, cx).into_any_element()),
            Modal::ContentDetail => Some(pages::modpack::detail_modal(self, window, cx).into_any_element()),
            Modal::ContentBrowser => Some(pages::modpack::browser_modal(self, window, cx).into_any_element()),
            Modal::Confirm { .. } => Some(pages::confirm_modal(self, window, cx).into_any_element()),
            Modal::LogUpload { .. } => None,
            Modal::ModpackUpdate { .. } => Some(pages::modpack_update_modal(self, window, cx).into_any_element()),
            Modal::WorldEdit { .. } => Some(pages::world_edit_modal(self, window, cx).into_any_element()),
            Modal::SkinPaint => Some(pages::skin_paint_modal(self, window, cx).into_any_element()),
            Modal::LoaderChange { .. } => Some(pages::loader_change_modal(self, window, cx).into_any_element()),
        }
    }
}

impl Render for LauncherApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = self.theme.clone();
        let titlebar = if !self.boot_splash || self.splash_fading {
            Some(self.titlebar(cx).into_any_element())
        } else {
            None
        };
        let mut root = div()
            .flex()
            .flex_col()
            .size_full()
            .bg(theme.bg)
            .font_family(FONT)
            .text_color(theme.text)
            .text_size(px(TEXT_BASE))
            .relative()
            .when_some(titlebar, |el, bar| el.child(bar))
            .on_action(cx.listener(|this, _: &crate::GoHome, _window, cx| this.set_page(Page::Home, cx)))
            .on_action(cx.listener(|this, _: &crate::GoVersions, _window, cx| {
                crate::ui::pages::versions::open_versions(this, cx, None, None)
            }))
            .on_action(cx.listener(|this, _: &crate::GoModpacks, _window, cx| this.set_page(Page::Modpacks, cx)))
            .on_action(cx.listener(|this, _: &crate::GoAccounts, _window, cx| this.set_page(Page::Accounts, cx)))
            .on_action(cx.listener(|this, _: &crate::GoSettings, _window, cx| this.set_page(Page::Settings, cx)))
            .on_action(cx.listener(|this, _: &crate::GoHost, _window, cx| this.set_page(Page::Host, cx)))
            .on_action(cx.listener(|this, _: &crate::GoServers, _window, cx| this.set_page(Page::Servers, cx)))
            .on_action(cx.listener(|this, _: &crate::CloseModal, _window, cx| {
                if !matches!(this.modal, Modal::None) {
                    this.modal = Modal::None;
                    this.create.open = false;
                    this.account_ui.open = false;
                } else if this.page == Page::Instance && this.instance_ui.editor_open {
                    this.instance_ui.editor_open = false;
                }
                cx.notify();
            }))
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h(px(0.0))
                    .child(self.sidebar(cx))
                    .child(
                        div()
                            .id("page-scroll")
                            .flex_1()
                            .min_w(px(0.0))
                            .h_full()
                            .min_w(px(0.0))
                            .overflow_x_hidden()
                            .overflow_y_scroll()
                            .track_scroll(&self.page_scroll)
                            .child({
                                use gpui::{AnimationExt, ElementId};
                                let page_key: SharedString = format!("page-{:?}", self.page).into();
                                div()
                                    .child(self.content(window, cx))
                                    .with_animation(
                                        ElementId::Name(page_key),
                                        gpui::Animation::new(std::time::Duration::from_millis(200)),
                                        |el, t| el.opacity(t),
                                    )
                            }),
                    ),
            )
            .child(self.toast_layer())
            .child(self.tooltip_layer(window));
        if self.boot_splash {
            root = root.child(pages::splash(self, window, cx));
        }
        let icon_urls: Vec<String> = self
            .instances
            .iter()
            .filter_map(|instance| instance.icon.clone())
            .filter(|icon| icon.starts_with("http"))
            .collect();
        if self.splash_fading || !self.boot_splash {
            self.cache_icons(icon_urls, cx);
        }
        if let Some(modal) = self.modal_layer(window, cx) {
            root = root.child(modal);
        }
        if self.crash.is_some() {
            root = root.child(pages::crash_modal(self, window, cx));
        }
        root
    }
}


fn instance_has_no_icon(instance: &Instance) -> bool {
    instance
        .icon
        .as_deref()
        .filter(|value| !value.is_empty())
        .is_none()
        && !std::path::Path::new(&instance.dir).join("icon.png").is_file()
}


