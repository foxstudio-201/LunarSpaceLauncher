pub mod accounts;
pub mod home;
pub mod host;
pub mod instance;
pub mod modpack;
pub mod servers;
pub mod settings;
pub mod versions;

use crate::models::Instance;
use crate::ui::app::{ConfirmAction, LauncherApp, Modal, Toast};
use crate::ui::theme::*;
use crate::ui::widgets::{self, TextField};
use gpui::{
    AnyElement, AnimationExt, Context, Div, Entity, FontWeight, IntoElement, SharedString, Window,
    div, prelude::*, px,
};
use serde_json::json;

pub fn page_header(
    theme: &Theme,
    title: impl Into<SharedString>,
    subtitle: impl Into<SharedString>,
    actions: impl IntoElement,
) -> impl IntoElement {
    div()
        .flex()
        .items_end()
        .justify_between()
        .gap_4()
        .w_full()
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
                        .child(title.into()),
                )
                .child(
                    div()
                        .text_size(px(TEXT_BASE))
                        .text_color(theme.muted)
                        .child(subtitle.into()),
                ),
        )
        .child(div().flex().items_center().gap_2().child(actions))
}

pub fn page_body() -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(18.0))
        .p(px(26.0))
        .w_full()
        .min_w(px(0.0))
        .max_w(px(1360.0))
        .mx_auto()
}

pub fn section_title(theme: &Theme, title: impl Into<SharedString>, hint: impl Into<SharedString>) -> impl IntoElement {
    div()
        .flex()
        .items_end()
        .justify_between()
        .w_full()
        .child(
            div()
                .text_size(px(TEXT_LG))
                .font_weight(semibold())
                .text_color(theme.text)
                .child(title.into()),
        )
        .child(
            div()
                .text_size(px(TEXT_SM))
                .text_color(theme.faint)
                .child(hint.into()),
        )
}

pub fn field(theme: &Theme, label: &str, input: Entity<TextField>, hint: &str) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(px(6.0))
        .w_full()
        .child(
            div()
                .text_size(px(TEXT_SM))
                .font_weight(medium())
                .text_color(theme.muted)
                .child(label.to_string()),
        )
        .child(widgets::text_input_box(theme).child(input))
        .when(!hint.is_empty(), |el| {
            el.child(
                div()
                    .text_size(px(TEXT_XS))
                    .text_color(theme.faint)
                    .child(hint.to_string()),
            )
        })
}

pub fn empty_state(theme: &Theme, icon_name: &'static str, title: &str, hint: &str) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap_3()
        .py(px(56.0))
        .w_full()
        .child(
            div()
                .size(px(56.0))
                .rounded(px(RADIUS_LG))
                .bg(theme.surface)
                .border_1()
                .border_color(theme.border_soft)
                .flex()
                .items_center()
                .justify_center()
                .child(widgets::icon(icon_name, 24.0, theme.faint)),
        )
        .child(
            div()
                .text_size(px(TEXT_LG))
                .font_weight(semibold())
                .text_color(theme.text)
                .child(title.to_string()),
        )
        .child(
            div()
                .text_size(px(TEXT_BASE))
                .text_color(theme.muted)
                .child(hint.to_string()),
        )
}

pub fn splash(app: &LauncherApp, _window: &mut Window, _cx: &mut Context<LauncherApp>) -> impl IntoElement {
    let loading_progress = app
        .splash_loading_at
        .map(|at| (at.elapsed().as_secs_f32() / 0.28).clamp(0.0, 1.0))
        .unwrap_or(0.0);
    let fade = app
        .splash_fade_at
        .map(|at| (1.0 - at.elapsed().as_secs_f32() / 0.42).clamp(0.0, 1.0))
        .unwrap_or(1.0);
    let alpha = (loading_progress * fade * 255.0) as u32;
    let base_alpha = (fade * 255.0) as u32;
    let video_opacity = (1.0 - loading_progress) * fade;
    let loading_opacity = alpha as f32 / 255.0;
    div()
        .absolute()
        .inset_0()
        .truncate()
        .child(
            div()
                .absolute()
                .inset_0()
                .bg(gpui::rgba((0x0c0e12 << 8) | base_alpha)),
        )
        .when_some(app.splash_image.clone(), |el, frame| {
            el.child(
                gpui::img(frame)
                    .absolute()
                    .inset_0()
                    .size_full()
                    .object_fit(gpui::ObjectFit::Cover)
                    .opacity(video_opacity),
            )
        })
        .child(
            div()
                .absolute()
                .inset_0()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(18.0))
                .opacity(loading_opacity)
                .child(
                    gpui::img(crate::ui::assets::image_path("xyolauncher.png"))
                        .size(px(88.0))
                        .rounded(px(22.0))
                        .object_fit(gpui::ObjectFit::Cover),
                )
                .child(
                    div()
                        .text_size(px(24.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(gpui::rgb(0xe8ebf1))
                        .child("XyoLauncher"),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(gpui::rgb(0x656d7b))
                        .child("Đang tải dữ liệu…"),
                )
                .child(widgets::spinner(20.0, gpui::rgb(0xe9b872))),
        )
}

pub fn modal_overlay(
    theme: Theme,
    width: f32,
    content: impl IntoElement,
    close: impl Fn(&gpui::ClickEvent, &mut Window, &mut gpui::App) + 'static,
) -> impl IntoElement {
    div()
        .id("modal-backdrop")
        .absolute()
        .inset_0()
        .flex()
        .items_center()
        .justify_center()
        .bg(theme.overlay)
        .on_click(close)
        .child(
            div()
                .id("modal-content")
                .w(px(width))
                .max_h(px(760.0))
                .overflow_y_scroll()
                .rounded(px(RADIUS_LG))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border)
                .shadow_lg()
                .p(px(22.0))
                .on_click(|_, _, cx| cx.stop_propagation())
                .child(content)
                .with_animation(
                    "modal-content-in",
                    gpui::Animation::new(std::time::Duration::from_millis(240)),
                    |el, t| el.opacity(t).mt(px(16.0 * (1.0 - t))),
                ),
        )
}

pub fn confirm_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> impl IntoElement {
    let theme = app.theme.clone();
    let (title, message) = match &app.modal {
        Modal::Confirm { title, message, .. } => (title.clone(), message.clone()),
        _ => (String::new(), String::new()),
    };
    let view = cx.entity().downgrade();
    let close_view = view.clone();
    let backdrop_view = view.clone();
    let content = div()
        .flex()
        .flex_col()
        .gap_4()
        .child(
            div()
                .text_size(px(TEXT_XL))
                .font_weight(semibold())
                .text_color(theme.text)
                .child(title),
        )
        .child(
            div()
                .text_size(px(TEXT_BASE))
                .text_color(theme.muted)
                .child(message),
        )
        .child(
            div()
                .flex()
                .justify_end()
                .gap_2()
                .child(widgets::ghost_button("confirm-cancel", "Huỷ", &theme, move |_, _, cx| {
                    let _ = close_view.update(cx, |this, cx| {
                        this.modal = Modal::None;
                        cx.notify();
                    });
                }))
                .child(widgets::button("confirm-ok", "Đồng ý", &theme, true, move |_, _, cx| {
                    let _ = view.update(cx, |this, cx| this.run_confirm(cx));
                })),
        );
    modal_overlay(theme.clone(), 440.0, content, move |_, _, cx| {
        let _ = backdrop_view.update(cx, |this, cx| {
            this.modal = Modal::None;
            cx.notify();
        });
    })
}

impl LauncherApp {
    pub fn run_confirm(&mut self, cx: &mut Context<Self>) {
        let action = match &self.modal {
            Modal::Confirm { action, .. } => action.clone(),
            _ => return,
        };
        match action {
            ConfirmAction::DeleteInstance(id) => {
                let value = self.backend.remove_instance(&id, false);
                if value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                    self.refresh_instances();
                    self.toast("ok", "Đã xoá phiên bản", "Tệp game vẫn được giữ trong thư mục.", cx);
                }
            }
            ConfirmAction::TrashFile(id, rel) => {
                let value = self.backend.trash_files(&id, vec![rel]);
                if value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                    self.load_instance_tab(cx);
                    self.toast("ok", "Đã chuyển vào thùng rác", "", cx);
                }
            }
            ConfirmAction::PurgeTrash(id, ids) => {
                self.backend.purge_trash(&id, ids);
                self.load_instance_tab(cx);
                self.toast("ok", "Đã dọn thùng rác", "", cx);
            }
            ConfirmAction::ServerDelete(id) => {
                let value = self.backend.server_remove(&id, true);
                if value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                    self.load_servers(cx);
                    self.server_ui.selected = None;
                    self.toast("ok", "Đã xoá server", "Thư mục server được chuyển vào thùng rác.", cx);
                }
            }
            ConfirmAction::RemoveAccount(id) => {
                let value = self.backend.account_remove(&id);
                if value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                    self.refresh_accounts();
                    self.toast("ok", "Đã xoá tài khoản", "", cx);
                }
            }
        }
        self.modal = Modal::None;
        cx.notify();
    }

    pub fn play_instance(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some(instance) = self.instances.iter().find(|i| i.id == id) else {
            return;
        };
        let busy = instance.running || matches!(instance.status.as_str(), "running" | "starting" | "stopping");
        let installing = instance.status == "installing";
        if busy {
            self.backend.stop_instance(id.to_string());
            self.toast("info", "Đang dừng game", "", cx);
            return;
        }
        if installing {
            self.toast("warn", "Đang cài đặt", "Chờ cài xong rồi chơi.", cx);
            return;
        }
        let rx = self.backend.launch(json!({"id": id}));
        self.toast("info", "Đang khởi chạy", "Chuẩn bị Java và kiểm tra tệp game…", cx);
        self.on_result(cx, rx, |this, value, cx| {
            if !value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                let error = value
                    .get("error")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("Không khởi chạy được");
                this.toast("bad", "Khởi chạy thất bại", error.to_string(), cx);
            }
        });
    }

    pub fn instance_card(&self, instance: &Instance, cx: &Context<Self>, compact: bool) -> AnyElement {
        let theme = self.theme.clone();
        let view = cx.entity().downgrade();
        let view_play = view.clone();
        let view_settings = view.clone();
        let icon_path = self.instance_icon_path(instance);
        let has_icon = icon_path.is_some();
        let running = instance.running
            || matches!(instance.status.as_str(), "running" | "starting" | "stopping");
        let installing = instance.status == "installing";
        let progress = self.instance_progress(&instance.id);
        let id = instance.id.clone();
        let open_id = id.clone();
        let play_id = id.clone();
        let settings_id = id.clone();
        let loader_label = match instance.loader.as_str() {
            "vanilla" => "Vanilla".to_string(),
            "fabric" => "Fabric".into(),
            "quilt" => "Quilt".into(),
            "forge" => "Forge".into(),
            "neoforge" => "NeoForge".into(),
            "lunar" => "LunarLoader".into(),
            other => other.to_string(),
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
        let status_label = match instance.status.as_str() {
            "running" => "Đang chơi",
            "starting" => "Đang khởi động",
            "stopping" => "Đang dừng",
            "installing" => "Đang cài",
            "error" => "Lỗi",
            _ => "Sẵn sàng",
        };

        let mut card = div()
            .id(SharedString::from(format!("inst-{}", instance.id)))
            .flex()
            .flex_col()
            .gap(px(12.0))
            .p(px(16.0))
            .w_full()
            .rounded(px(RADIUS_LG))
            .bg(theme.surface)
            .border_1()
            .border_color(theme.border_soft)
            .cursor_pointer()
            .hover(|s| s.bg(theme.surface_hover).border_color(theme.border))
            .on_click(move |_, _, cx| {
                let _ = view.update(cx, |this, cx| this.open_instance(open_id.clone(), cx));
            });

        let head = div()
            .flex()
            .items_center()
            .gap_3()
            .child(
                div()
                    .size(px(if compact { 40.0 } else { 48.0 }))
                    .rounded(px(11.0))
                    .bg(theme.surface_active)
                    .flex()
                    .items_center()
                    .justify_center()
                    .truncate()
                    .when_some(icon_path, |el, path| {
                        el.child(
                            gpui::img(path)
                                .size(px(if compact { 40.0 } else { 48.0 }))
                                .object_fit(gpui::ObjectFit::Cover),
                        )
                    })
                    .when(!has_icon, |el| {
                        el.child(widgets::icon("cube", 22.0, theme.accent_soft))
                    }),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(3.0))
                    .flex_1()
                    .truncate()
                    .child(
                        div()
                            .text_size(px(TEXT_MD))
                            .font_weight(semibold())
                            .text_color(theme.text)
                            .truncate()
                            .child(instance.name.clone()),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .text_size(px(TEXT_SM))
                            .text_color(theme.muted)
                            .child(format!("Minecraft {}", instance.version))
                            .child(
                                div()
                                    .h(px(3.0))
                                    .w(px(3.0))
                                    .rounded_full()
                                    .bg(theme.faint),
                            )
                            .child(loader_label),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .child(
                        div()
                            .size(px(7.0))
                            .rounded_full()
                            .bg(status_color),
                    )
                    .child(
                        div()
                            .text_size(px(TEXT_XS))
                            .font_weight(medium())
                            .text_color(status_color)
                            .child(status_label),
                    ),
            );

        card = card.child(head);

        if let Some((label, percent, indeterminate, _phase)) = progress {
            card = card.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div()
                            .flex()
                            .justify_between()
                            .text_size(px(TEXT_XS))
                            .text_color(theme.muted)
                            .child(if label.is_empty() {
                                "Đang tải…".to_string()
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

        card = card.child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_2()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .text_size(px(TEXT_XS))
                        .text_color(theme.faint)
                        .child(format!("{} MB RAM", instance.memory_mb))
                        .child(if let Some(played) = instance.last_played.as_deref() {
                            format!("Chơi lần cuối {}", short_time(played))
                        } else {
                            "Chưa chơi".to_string()
                        }),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.0))
                        .child(
                            div()
                                .id(SharedString::from(format!("inst-play-{}", instance.id)))
                                .flex()
                                .items_center()
                                .gap_2()
                                .h(px(30.0))
                                .px(px(12.0))
                                .rounded(px(RADIUS_SM))
                                .bg(if running { theme.surface_active } else { theme.accent })
                                .text_color(if running { theme.text } else { gpui::white().into() })
                                .text_size(px(TEXT_SM))
                                .font_weight(semibold())
                                .cursor_pointer()
                                .hover(|s| s.opacity(0.9))
                                .on_click(move |_, _, cx| {
                                    let _ = view_play.update(cx, |this, cx| this.play_instance(&play_id, cx));
                                })
                                .child(widgets::icon(
                                    if running { "stop-fill" } else { "play-fill" },
                                    13.0,
                                    if running { theme.text } else { gpui::white().into() },
                                ))
                                .child(if running { "Dừng" } else { "Chơi" }),
                        )
                        .child(
                            div()
                                .id(SharedString::from(format!("inst-settings-{}", instance.id)))
                                .flex()
                                .items_center()
                                .justify_center()
                                .size(px(30.0))
                                .rounded(px(RADIUS_SM))
                                .cursor_pointer()
                                .hover(|s| s.bg(theme.surface_active))
                                .on_click(move |_, _, cx| {
                                    let id = settings_id.clone();
                                    let _ = view_settings.update(cx, |this, cx| {
                                        this.open_instance(id.clone(), cx);
                                        this.instance_tab = crate::ui::app::InstanceTab::Settings;
                                        this.load_instance_tab(cx);
                                        cx.notify();
                                    });
                                })
                                .child(widgets::icon("gear-six", 15.0, theme.muted)),
                        ),
                ),
        );
        card.into_any_element()
    }
}

pub fn short_time(iso: &str) -> String {
    let Ok(date) = chrono::DateTime::parse_from_rfc3339(iso) else {
        return iso.to_string();
    };
    let now = chrono::Utc::now();
    let delta = now.signed_duration_since(date.with_timezone(&chrono::Utc));
    if delta.num_minutes() < 1 {
        "vừa xong".into()
    } else if delta.num_minutes() < 60 {
        format!("{} phút trước", delta.num_minutes())
    } else if delta.num_hours() < 24 {
        format!("{} giờ trước", delta.num_hours())
    } else if delta.num_days() < 30 {
        format!("{} ngày trước", delta.num_days())
    } else {
        date.format("%d/%m/%Y").to_string()
    }
}

pub fn toast_local(app: &mut LauncherApp, tone: &'static str, title: &str, message: &str, cx: &mut Context<LauncherApp>) {
    app.toast_seq += 1;
    app.toasts.push(Toast {
        id: app.toast_seq,
        tone,
        title: title.to_string(),
        message: message.to_string(),
    });
    let id = app.toast_seq;
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

pub fn crash_modal(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> impl IntoElement {
    let theme = app.theme.clone();
    let crash = app.crash.clone().unwrap_or(serde_json::Value::Null);
    let title = crash
        .get("title")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("Game gặp lỗi")
        .to_string();
    let hint = crash
        .get("hint")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let cause = crash
        .get("cause")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let close_view = cx.entity().downgrade();
    let close_view2 = close_view.clone();
    let upload_view = cx.entity().downgrade();
    let content = div()
        .flex()
        .flex_col()
        .gap_4()
        .child(
            div()
                .flex()
                .items_center()
                .gap_3()
                .child(
                    div()
                        .size(px(40.0))
                        .rounded(px(11.0))
                        .bg(theme.surface_active)
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(widgets::icon("warning-octagon", 20.0, theme.bad)),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .text_size(px(TEXT_XL))
                                .font_weight(semibold())
                                .text_color(theme.text)
                                .child(title),
                        )
                        .child(
                            div()
                                .text_size(px(TEXT_SM))
                                .text_color(theme.muted)
                                .child("Minecraft vừa thoát với lỗi."),
                        ),
                ),
        )
        .when(!hint.is_empty(), |el| {
            el.child(
                div()
                    .p(px(12.0))
                    .rounded(px(RADIUS_SM))
                    .bg(theme.surface)
                    .border_1()
                    .border_color(theme.border_soft)
                    .text_size(px(TEXT_SM))
                    .text_color(theme.muted)
                    .child(hint),
            )
        })
        .when(!cause.is_empty(), |el| {
            el.child(
                div()
                    .id("crash-cause")
                    .max_h(px(160.0))
                    .overflow_y_scroll()
                    .p(px(10.0))
                    .rounded(px(RADIUS_SM))
                    .bg(if theme.dark { gpui::rgb(0x07090c) } else { gpui::rgb(0xf7f8fa) })
                    .border_1()
                    .border_color(theme.border_soft)
                    .text_size(px(11.0))
                    .font_family(MONO)
                    .text_color(theme.bad)
                    .child(cause),
            )
        })
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(widgets::ghost_button("crash-upload", "Gửi log cho XyoLauncher", &theme, move |_, _, cx| {
                    let _ = upload_view.update(cx, |this, cx| {
                        let text = this
                            .selected_instance
                            .as_ref()
                            .map(|id| this.logs.get(id).cloned().unwrap_or_default().join("\n"))
                            .unwrap_or_default();
                        if text.is_empty() {
                            this.toast("warn", "Chưa có log", "Chạy lại game để có log rồi thử lại.", cx);
                            return;
                        }
                        let rx = this.backend.upload_log_req(text);
                        this.on_result(cx, rx, |this, value, cx| {
                            if let Some(url) = value.get("url").and_then(serde_json::Value::as_str) {
                                let _ = open::that(url);
                                this.toast("ok", "Đã gửi log", url.to_string(), cx);
                            } else {
                                this.toast(
                                    "bad",
                                    "Gửi log thất bại",
                                    value.get("error").and_then(serde_json::Value::as_str).unwrap_or(""),
                                    cx,
                                );
                            }
                        });
                    });
                }))
                .child(widgets::button("crash-close", "Đóng", &theme, true, move |_, _, cx| {
                    let _ = close_view.update(cx, |this, cx| {
                        this.crash = None;
                        cx.notify();
                    });
                })),
        );
    modal_overlay(theme, 560.0, content, move |_, _, cx| {
        let _ = close_view2.update(cx, |this, cx| {
            this.crash = None;
            cx.notify();
        });
    })
}
