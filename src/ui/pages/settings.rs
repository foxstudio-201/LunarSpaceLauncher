use crate::ui::app::LauncherApp;
use crate::ui::pages::{self, page_body, page_header, section_title};
use crate::ui::theme::*;
use crate::ui::widgets;
use gpui::{AnyElement, Context, IntoElement, SharedString, Window, div, prelude::*, px};
use serde_json::{Value, json};

pub fn render(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let view_lang = view.clone();
    let view_theme = view.clone();
    let view_hide = view.clone();
    let view_auto = view.clone();
    let view_rpc = view.clone();
    let view_choose_java = view.clone();
    let view_choose_java2 = view.clone();
    let view_java_refresh2 = view.clone();
    let view_zulu = view.clone();
    let view_open_shared = view.clone();
    let view_open_doc = view.clone();
    let view_java_refresh = view.clone();
    let view_save = view.clone();

    let lang = app
        .settings
        .get("language")
        .and_then(Value::as_str)
        .unwrap_or("vi")
        .to_string();
    let theme_key = app
        .settings
        .get("theme")
        .and_then(Value::as_str)
        .unwrap_or("dark")
        .to_string();
    let hide_on_launch = app
        .settings
        .get("hideOnLaunch")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let auto_update = app
        .settings
        .get("autoUpdate")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let discord_rpc = app
        .settings
        .get("discordRpc")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let java_path = app
        .settings
        .get("javaPath")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let shared = app.backend.store.shared_dir().to_string_lossy().into_owned();
    let default_instances = app.backend.store.default_instance_dir().to_string_lossy().into_owned();
    let default_memory = app
        .settings
        .get("defaultMemory")
        .and_then(Value::as_u64)
        .unwrap_or(4096);

    let lang_row = div()
        .flex()
        .items_center()
        .gap_2()
        .child(setting_chip(&theme, "vi", "Tiếng Việt", &lang, view_lang.clone()))
        .child(setting_chip(&theme, "en", "English", &lang, view_lang.clone()));

    let theme_row = div()
        .flex()
        .items_center()
        .gap_2()
        .child(setting_chip(&theme, "dark", "Tối", &theme_key, view_theme.clone()))
        .child(setting_chip(&theme, "light", "Sáng", &theme_key, view_theme.clone()));

    let mut runtimes = div().flex().flex_col().gap_2();
    if app.settings_ui.runtimes.is_empty() {
        runtimes = runtimes.child(
            div()
                .text_size(px(TEXT_SM))
                .text_color(theme.faint)
                .child("Đang quét Java trên máy…"),
        );
    }
    for runtime in app.settings_ui.runtimes.iter().take(24).cloned().collect::<Vec<_>>() {
        let installed = runtime.get("installed").and_then(Value::as_bool).unwrap_or(false);
        let component = runtime
            .get("component")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let name = runtime
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Java")
            .to_string();
        let major = runtime.get("major").and_then(Value::as_u64).unwrap_or(0);
        let kind = runtime
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let dir = runtime
            .get("dir")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let bytes = runtime.get("bytes").and_then(Value::as_u64).unwrap_or(0);
        let view_install = view.clone();
        let view_remove = view.clone();
        let component_install = component.clone();
        let component_remove = component.clone();
        let kind_remove = kind.clone();
        let dir_remove = dir.clone();
        runtimes = runtimes.child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_3()
                .p(px(10.0))
                .rounded(px(RADIUS_SM))
                .bg(theme.elevated)
                .border_1()
                .border_color(theme.border_soft)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .child(
                            div()
                                .size(px(32.0))
                                .rounded(px(8.0))
                                .bg(theme.surface_active)
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(widgets::icon("coffee", 16.0, theme.accent_soft)),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .child(
                                    div()
                                        .text_size(px(TEXT_SM))
                                        .font_weight(semibold())
                                        .text_color(theme.text)
                                        .child(format!("Java {major} · {name}")),
                                )
                                .child(
                                    div()
                                        .text_size(px(TEXT_XS))
                                        .text_color(theme.faint)
                                        .child(if installed {
                                            format!("Đã cài · {}", crate::util::format_bytes(bytes))
                                        } else {
                                            "Chưa tải".to_string()
                                        }),
                                ),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .when(!installed, |el| {
                            el.child(widgets::button(
                                gpui::SharedString::from(format!("java-install-{component}")),
                                "Tải",
                                &theme,
                                false,
                                move |_, _, cx| {
                                    let component = component_install.clone();
                                    let _ = view_install.update(cx, |this, cx| {
                                        this.settings_ui.message = format!("Đang tải {component}…");
                                        let rx = this.backend.install_runtime(component.clone());
                                        this.on_result(cx, rx, |this, value, cx| {
                                            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                this.settings_ui.message = "Đã tải Java.".into();
                                                this.load_java(cx);
                                            } else {
                                                this.settings_ui.message = value
                                                    .get("error")
                                                    .and_then(Value::as_str)
                                                    .unwrap_or("Tải Java thất bại")
                                                    .to_string();
                                            }
                                        });
                                    });
                                },
                            ))
                        })
                        .when(installed, |el| {
                            el.child(widgets::ghost_button(
                                gpui::SharedString::from(format!("java-remove-{component}")),
                                "Xoá",
                                &theme,
                                move |_, _, cx| {
                                    let component = component_remove.clone();
                                    let kind = kind_remove.clone();
                                    let dir = dir_remove.clone();
                                    let _ = view_remove.update(cx, |this, cx| {
                                        let rx = this.backend.remove_runtime(component.clone(), kind.clone(), dir.clone());
                                        this.on_result(cx, rx, |this, _value, cx| {
                                            this.settings_ui.message = "Đã xoá Java.".into();
                                            this.load_java(cx);
                                        });
                                    });
                                },
                            ))
                        }),
                ),
        );
    }

    let mut page = page_body()
        .child(page_header(
            &theme,
            "Hệ thống",
            "Tuỳ chỉnh launcher, Java và thư mục dữ liệu",
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(widgets::ghost_button("settings-refresh", "Quét lại Java", &theme, move |_, _, cx| {
                    let _ = view_java_refresh.update(cx, |this, cx| this.load_java(cx));
                }))
                .child(widgets::button("settings-save", "Lưu", &theme, true, move |_, _, cx| {
                    let _ = view_save.update(cx, |this, cx| {
                        let memory = this
                            .memory_input
                            .read(cx)
                            .text()
                            .parse::<u32>()
                            .unwrap_or(4096);
                        this.backend.settings_set(json!({"defaultMemory": memory}));
                        this.refresh_settings();
                        this.toast("ok", "Đã lưu cài đặt", "", cx);
                    });
                })),
        ))
        .child(
            div()
                .flex()
                .gap_3()
                .items_start()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .flex_1()
                        .min_w(px(0.0))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap_4()
                                .p(px(18.0))
                                .rounded(px(RADIUS_LG))
                                .bg(theme.surface)
                                .border_1()
                                .border_color(theme.border_soft)
                                .child(section_title(&theme, "Giao diện", "Áp dụng ngay"))
                                .child(setting_row(&theme, "Ngôn ngữ", "Chữ trong launcher", lang_row))
                                .child(setting_row(&theme, "Chủ đề", "Tối hoặc sáng", theme_row))
                                .child(setting_row(
                                    &theme,
                                    "Thu nhỏ khi vào game",
                                    "Tự ẩn launcher khi Minecraft đang chạy",
                                    toggle(&theme, "hide", hide_on_launch, move |_, _, cx| {
                                        let _ = view_hide.update(cx, |this, cx| {
                                            let next = !this.settings.get("hideOnLaunch").and_then(Value::as_bool).unwrap_or(false);
                                            this.backend.settings_set(json!({"hideOnLaunch": next}));
                                            this.refresh_settings();
                                            cx.notify();
                                        });
                                    }),
                                ))
                                .child(setting_row(
                                    &theme,
                                    "Discord Rich Presence",
                                    "Hiển thị phiên bản đang chơi trên Discord",
                                    toggle(&theme, "rpc", discord_rpc, move |_, _, cx| {
                                        let _ = view_rpc.update(cx, |this, cx| {
                                            let next = !this.settings.get("discordRpc").and_then(Value::as_bool).unwrap_or(true);
                                            this.backend.settings_set(json!({"discordRpc": next}));
                                            this.refresh_settings();
                                            cx.notify();
                                        });
                                    }),
                                )),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap_4()
                                .p(px(18.0))
                                .rounded(px(RADIUS_LG))
                                .bg(theme.surface)
                                .border_1()
                                .border_color(theme.border_soft)
                                .child(section_title(&theme, "Minecraft", "Thư mục và bộ nhớ mặc định"))
                                .child(
                                    div()
                                        .flex()
                                        .gap_3()
                                        .child(
                                            div()
                                                .flex_1()
                                                .child(pages::field(
                                                    &theme,
                                                    "RAM mặc định (MB)",
                                                    app.memory_input.clone(),
                                                    "Áp dụng cho phiên bản tạo mới.",
                                                )),
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .items_end()
                                                .child(
                                                    div()
                                                        .text_size(px(TEXT_XS))
                                                        .text_color(theme.faint)
                                                        .child(format!("Hiện tại: {default_memory} MB")),
                                                ),
                                        ),
                                )
                                .child(setting_row(
                                    &theme,
                                    "Thư mục dùng chung",
                                    shared.clone(),
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .child(widgets::ghost_button("open-shared", "Mở thư mục", &theme, move |_, _, _cx| {
                                            let _ = open::that(&shared);
                                        }))
                                        .child(widgets::ghost_button("open-doc", "Thư mục phiên bản", &theme, move |_, _, _cx| {
                                            let _ = open::that(&default_instances);
                                        })),
                                )),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap_3()
                                .p(px(18.0))
                                .rounded(px(RADIUS_LG))
                                .bg(theme.surface)
                                .border_1()
                                .border_color(theme.border_soft)
                                .child(section_title(
                                    &theme,
                                    "Java",
                                    "Tự tải runtime phù hợp với từng phiên bản",
                                ))
                                .child(setting_row(
                                    &theme,
                                    "Java ưu tiên",
                                    if java_path.is_empty() {
                                        "Tự động chọn Java tải kèm".to_string()
                                    } else {
                                        java_path.clone()
                                    },
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .child(widgets::ghost_button("choose-java", "Chọn java.exe", &theme, move |_, _, cx| {
                                            let view = view_choose_java.clone();
                                            cx.spawn(async move |cx| {
                                                let picked = rfd::AsyncFileDialog::new()
                                                    .add_filter("Java", &["exe"])
                                                    .set_title("Chọn java.exe")
                                                    .pick_file()
                                                    .await;
                                                if let Some(file) = picked {
                                                    let path = file.path().to_string_lossy().into_owned();
                                                    let _ = view.update(cx, |this, cx| {
                                                        this.backend.settings_set(json!({"javaPath": path}));
                                                        this.refresh_settings();
                                                        this.toast("ok", "Đã cập nhật Java", "", cx);
                                                    });
                                                }
                                            })
                                            .detach();
                                        }))
                                        .child(widgets::ghost_button("clear-java", "Tự động", &theme, move |_, _, cx| {
                                            let _ = view_choose_java2.update(cx, |this, cx| {
                                                this.backend.settings_set(json!({"javaPath": Value::Null}));
                                                this.refresh_settings();
                                                cx.notify();
                                            });
                                        })),
                                ))
                                .child(runtimes)
                                .child(
                                    div()
                                        .flex()
                                        .items_end()
                                        .gap_2()
                                        .child(
                                            div()
                                                .w(px(160.0))
                                                .child(pages::field(
                                                    &theme,
                                                    "Tải Zulu JRE",
                                                    app.jvm_input.clone(),
                                                    "Nhập số phiên bản Java, ví dụ 17 hoặc 21.",
                                                )),
                                        )
                                        .child(widgets::button("zulu-install", "Tải Java", &theme, false, move |_, _, cx| {
                                            let _ = view_zulu.update(cx, |this, cx| {
                                                let major = this
                                                    .jvm_input
                                                    .read(cx)
                                                    .text()
                                                    .trim()
                                                    .parse::<u32>()
                                                    .unwrap_or(21);
                                                this.settings_ui.message = format!("Đang tải Zulu {major}…");
                                                let rx = this.backend.install_zulu(major, "jre".into());
                                                this.on_result(cx, rx, |this, value, cx| {
                                                    if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                        this.settings_ui.message = "Đã tải Zulu.".into();
                                                        this.load_java(cx);
                                                    } else {
                                                        this.settings_ui.message = value
                                                            .get("error")
                                                            .and_then(Value::as_str)
                                                            .unwrap_or("Tải Zulu thất bại")
                                                            .to_string();
                                                    }
                                                    cx.notify();
                                                });
                                            });
                                        })),
                                )
                                .when(!app.settings_ui.message.is_empty(), |el| {
                                    el.child(
                                        div()
                                            .text_size(px(TEXT_SM))
                                            .text_color(theme.muted)
                                            .child(app.settings_ui.message.clone()),
                                    )
                                }),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .w(px(320.0))
                        .flex_shrink_0()
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap_4()
                                .p(px(18.0))
                                .rounded(px(RADIUS_LG))
                                .bg(theme.surface)
                                .border_1()
                                .border_color(theme.border_soft)
                                .child(section_title(&theme, "Cập nhật", ""))
                                .child(setting_row(
                                    &theme,
                                    "Tự động kiểm tra",
                                    "Kiểm tra bản mới khi mở launcher",
                                    toggle(&theme, "auto", auto_update, move |_, _, cx| {
                                        let _ = view_auto.update(cx, |this, cx| {
                                            let next = !this.settings.get("autoUpdate").and_then(Value::as_bool).unwrap_or(true);
                                            this.backend.settings_set(json!({"autoUpdate": next}));
                                            this.refresh_settings();
                                            cx.notify();
                                        });
                                    }),
                                ))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .child(widgets::ghost_button("check-update", "Kiểm tra cập nhật", &theme, {
                                            let view = cx.entity().downgrade();
                                            move |_, _, cx| {
                                                let _ = view.update(cx, |this, cx| {
                                                    let rx = this.backend.update_check();
                                                    this.on_result(cx, rx, |this, value, cx| {
                                                        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                                            if value.get("newer").and_then(Value::as_bool).unwrap_or(false) {
                                                                let latest = value.get("latest").and_then(Value::as_str).unwrap_or("");
                                                                let url = value.get("url").and_then(Value::as_str).unwrap_or("");
                                                                let _ = open::that(url);
                                                                this.toast("ok", format!("Có bản mới {latest}"), "Đã mở trang tải xuống.", cx);
                                                            } else {
                                                                this.toast("ok", "Bạn đang dùng bản mới nhất", "2.0.0", cx);
                                                            }
                                                        } else {
                                                            this.toast("bad", "Không kiểm tra được cập nhật", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                                                        }
                                                    });
                                                });
                                            }
                                        }))
                                        .child(widgets::ghost_button("open-releases", "Trang phát hành", &theme, move |_, _, _cx| {
                                            let _ = open::that("https://github.com/foxstudio-201/LunarSpaceLauncher/releases");
                                        })),
                                ),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap_3()
                                .p(px(18.0))
                                .rounded(px(RADIUS_LG))
                                .bg(theme.surface)
                                .border_1()
                                .border_color(theme.border_soft)
                                .child(section_title(&theme, "Giới thiệu", ""))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_3()
                                        .child(
                                            div()
                                                .size(px(42.0))
                                                .rounded(px(11.0))
                                                .overflow_hidden()
                                                .child(
                                                    gpui::img(crate::ui::assets::image_path("xyolauncher.png"))
                                                        .size(px(42.0))
                                                        .object_fit(gpui::ObjectFit::Cover),
                                                ),
                                        )
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .child(
                                                    div()
                                                        .text_size(px(TEXT_MD))
                                                        .font_weight(semibold())
                                                        .text_color(theme.text)
                                                        .child("XyoLauncher 2.0"),
                                                )
                                                .child(
                                                    div()
                                                        .text_size(px(TEXT_XS))
                                                        .text_color(theme.faint)
                                                        .child("Rust · GPUI · GPU accelerated"),
                                                ),
                                        ),
                                )
                                .child(
                                    div()
                                        .text_size(px(TEXT_XS))
                                        .text_color(theme.faint)
                                        .child("Dữ liệu, skin và instance được giữ trong %APPDATA%\\lunaspace-launcher."),
                                ),
                        ),
                ),
        );
    page = page.child(
        div()
            .flex()
            .items_center()
            .justify_center()
            .pb(px(10.0))
            .text_size(px(TEXT_XS))
            .text_color(theme.faint)
            .child("XyoLauncher · được viết lại hoàn toàn bằng Rust + GPUI"),
    );
    page.into_any_element()
}

fn setting_chip(
    theme: &Theme,
    value: &str,
    label: &str,
    current: &str,
    view: gpui::WeakEntity<LauncherApp>,
) -> impl IntoElement {
    let active = current == value;
    let value = value.to_string();
    div()
        .id(gpui::SharedString::from(format!("chip-{value}")))
        .h(px(30.0))
        .px(px(12.0))
        .flex()
        .items_center()
        .rounded(px(6.0))
        .bg(if active { theme.accent_dim } else { theme.elevated })
        .border_1()
        .border_color(if active { theme.accent } else { theme.border_soft })
        .text_size(px(TEXT_SM))
        .font_weight(if active { semibold() } else { medium() })
        .text_color(if active { theme.accent_soft } else { theme.muted })
        .cursor_pointer()
        .on_click(move |_, _, cx| {
            let value = value.clone();
            let _ = view.update(cx, |this, cx| {
                let key = if value == "dark" || value == "light" {
                    "theme"
                } else {
                    "language"
                };
                this.backend.settings_set(json!({key: value}));
                this.refresh_settings();
                cx.notify();
            });
        })
        .child(label.to_string())
}

fn setting_row(theme: &Theme, title: &str, hint: impl Into<SharedString>, control: impl IntoElement) -> impl IntoElement {
    let hint: SharedString = hint.into();
    div()
        .flex()
        .items_center()
        .justify_between()
        .gap_4()
        .w_full()
        .min_w(px(0.0))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(2.0))
                .flex_1()
                .min_w(px(0.0))
                .child(
                    div()
                        .text_size(px(TEXT_BASE))
                        .font_weight(medium())
                        .text_color(theme.text)
                        .child(title.to_string()),
                )
                .child(
                    div()
                        .text_size(px(TEXT_XS))
                        .text_color(theme.faint)
                        .overflow_hidden()
                        .child(hint),
                ),
        )
        .child(control)
}

fn toggle(
    theme: &Theme,
    id: &'static str,
    on: bool,
    on_click: impl Fn(&gpui::ClickEvent, &mut Window, &mut gpui::App) + 'static,
) -> impl IntoElement {
    let theme = theme.clone();
    div()
        .id(gpui::SharedString::from(format!("toggle-{id}")))
        .w(px(42.0))
        .h(px(24.0))
        .rounded_full()
        .bg(if on { theme.accent } else { theme.surface_active })
        .p(px(3.0))
        .flex()
        .items_center()
        .when(on, |el| el.justify_end())
        .cursor_pointer()
        .on_click(on_click)
        .child(
            div()
                .size(px(18.0))
                .rounded_full()
                .bg(gpui::white()),
        )
}

impl LauncherApp {
    pub fn load_java(&mut self, cx: &mut Context<Self>) {
        let rx = self.backend.java_catalog();
        self.on_result(cx, rx, |this, value, _cx| {
            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                this.settings_ui.runtimes = value
                    .get("runtimes")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
            }
        });
        let rx = self.backend.java_options();
        self.on_result(cx, rx, |this, value, _cx| {
            if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                this.settings_ui.java_current = value
                    .pointer("/java/path")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                this.settings_ui.java_all = value
                    .get("all")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
            }
        });
    }
}
