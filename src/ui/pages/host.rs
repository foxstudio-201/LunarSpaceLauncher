use crate::ui::app::LauncherApp;
use crate::ui::pages::{self, page_body, page_header, section_title};
use crate::ui::theme::*;
use crate::ui::widgets;
use gpui::{AnyElement, Context, IntoElement, Window, div, prelude::*, px};
use serde_json::{Value, json};

pub fn render(app: &mut LauncherApp, _window: &mut Window, cx: &mut Context<LauncherApp>) -> AnyElement {
    let theme = app.theme.clone();
    let view = cx.entity().downgrade();
    let status = app.host_status.clone();
    let running = status.get("running").and_then(Value::as_bool).unwrap_or(false);
    let address = status.get("address").and_then(Value::as_str).unwrap_or("").to_string();
    let detected = status.get("detectedPort").and_then(Value::as_u64).unwrap_or(0);
    let agent = status.get("agentInstalled").and_then(Value::as_bool).unwrap_or(false);
    let has_token = status.get("hasToken").and_then(Value::as_bool).unwrap_or(false);
    let error = status.get("error").and_then(Value::as_str).unwrap_or("").to_string();
    let logs: Vec<String> = status
        .get("log")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    let current_instance = app
        .host_instance
        .clone()
        .or_else(|| app.selected_instance.clone())
        .or_else(|| app.instances.first().map(|i| i.id.clone()))
        .unwrap_or_default();

    let mut instance_chips = div().flex().items_center().gap_2().flex_wrap();
    for instance in app.instances.iter().cloned().collect::<Vec<_>>() {
        let active = current_instance == instance.id;
        let view = view.clone();
        let id = instance.id.clone();
        let name = instance.name.clone();
        let version = instance.version.clone();
        instance_chips = instance_chips.child(
            div()
                .id(gpui::SharedString::from(format!("host-inst-{}", instance.id)))
                .flex().items_center().gap_2().h(px(32.0)).px(px(10.0)).rounded(px(6.0))
                .bg(if active { theme.accent_dim } else { theme.surface })
                .border_1().border_color(if active { theme.accent } else { theme.border_soft })
                .text_size(px(TEXT_SM)).text_color(if active { theme.text } else { theme.muted })
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    let id = id.clone();
                    let _ = view.update(cx, |this, cx| {
                        this.host_instance = Some(id);
                        this.refresh_host(cx);
                        cx.notify();
                    });
                })
                .child(widgets::icon("cube", 13.0, if active { theme.accent_soft } else { theme.faint }))
                .child(name)
                .child(div().text_size(px(TEXT_XS)).text_color(theme.faint).child(version)),
        );
    }

    let view_install = view.clone();
    let view_token = view.clone();
    let view_start = view.clone();
    let view_stop = view.clone();
    let view_copy = view.clone();
    let address_copy = address.clone();
    let view_refresh = view.clone();

    page_body()
        .child(page_header(
            &theme,
            "Host",
            "Đưa thế giới chơi đơn lên mạng để bạn bè vào cùng",
            div().flex().items_center().gap_2()
                .child(widgets::tag("Ngrok", theme.accent_soft, &theme))
                .child(widgets::ghost_button("host-refresh", "Làm mới", &theme, move |_, _, cx| {
                    let _ = view_refresh.update(cx, |this, cx| {
                        this.refresh_host(cx);
                        cx.notify();
                    });
                })),
        ))
        .child(
            div().flex().flex_col().gap_4().p(px(18.0)).rounded(px(RADIUS_LG))
                .bg(theme.surface).border_1().border_color(theme.border_soft)
                .child(section_title(&theme, "Chia sẻ thế giới chơi đơn", "Mở world ở chế độ LAN trước"))
                .child(div().flex().flex_col().gap_2()
                    .child(div().text_size(px(TEXT_SM)).font_weight(medium()).text_color(theme.muted).child("Chọn phiên bản"))
                    .when(app.instances.is_empty(), |el| {
                        el.child(div().text_size(px(TEXT_SM)).text_color(theme.faint).child("Chưa có phiên bản nào."))
                    })
                    .when(!app.instances.is_empty(), |el| el.child(instance_chips)))
                .child(
                    div().flex().gap_3()
                        .child(
                            div().flex().flex_col().gap_2().flex_1()
                                .child(div().text_size(px(TEXT_SM)).font_weight(medium()).text_color(theme.muted).child("Authtoken ngrok"))
                                .child(widgets::text_input_box(&theme).child(app.host_token.clone()))
                                .child(div().text_size(px(TEXT_XS)).text_color(theme.faint)
                                    .child(if has_token { "Đã lưu token. Lấy token tại dashboard.ngrok.com/get-started/your-authtoken." } else { "Dán token rồi bấm Lưu token." })),
                        )
                        .child(
                            div().flex().flex_col().gap_2().w(px(150.0))
                                .child(div().text_size(px(TEXT_SM)).font_weight(medium()).text_color(theme.muted).child("Cổng LAN"))
                                .child(widgets::text_input_box(&theme).child(app.host_listen.clone()))
                                .child(div().text_size(px(TEXT_XS)).text_color(theme.faint)
                                    .child(if detected > 0 { format!("Đã dò thấy cổng {detected}") } else { "Chưa dò thấy cổng LAN".into() })),
                        ),
                )
                .child(
                    div().flex().items_center().gap_2().flex_wrap()
                        .when(!agent, |el| {
                            el.child(widgets::button("host-agent", "Tải agent ngrok", &theme, true, move |_, _, cx| {
                                let _ = view_install.update(cx, |this, cx| {
                                    this.toast("info", "Đang tải ngrok", "", cx);
                                    let rx = this.backend.host_install_agent();
                                    this.on_result(cx, rx, |this, value, cx| {
                                        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                            this.toast("ok", "Đã tải ngrok", "", cx);
                                            this.refresh_host(cx);
                                        } else {
                                            this.toast("bad", "Tải ngrok thất bại", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                                        }
                                    });
                                });
                            }))
                        })
                        .child(widgets::ghost_button("host-save-token", "Lưu token", &theme, move |_, _, cx| {
                            let _ = view_token.update(cx, |this, cx| {
                                let token = this.host_token.read(cx).text().trim().to_string();
                                this.backend.host_set_token(token);
                                this.toast("ok", "Đã lưu token ngrok", "", cx);
                                this.refresh_host(cx);
                            });
                        }))
                        .when(!running, |el| {
                            el.child(widgets::button("host-start", "Bắt đầu chia sẻ", &theme, true, move |_, _, cx| {
                                let instance = current_instance.clone();
                                let _ = view_start.update(cx, |this, cx| {
                                    let listen = this.host_listen.read(cx).text().trim().parse::<u16>().unwrap_or(25565);
                                    let target = this.host_status.get("detectedPort").and_then(Value::as_u64).map(|v| v as u16);
                                    let token = this.host_token.read(cx).text().trim().to_string();
                                    let rx = this.backend.host_start(json!({
                                        "instanceId": instance,
                                        "listenPort": listen,
                                        "targetPort": target,
                                        "token": if token.is_empty() { Value::Null } else { Value::String(token) },
                                    }));
                                    this.on_result(cx, rx, |this, value, cx| {
                                        if value.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                                            let address = value.get("address").and_then(Value::as_str).unwrap_or("");
                                            this.toast("ok", "Đã mở tunnel", address.to_string(), cx);
                                        } else {
                                            this.toast("bad", "Không mở được tunnel", value.get("error").and_then(Value::as_str).unwrap_or(""), cx);
                                        }
                                        this.refresh_host(cx);
                                        cx.notify();
                                    });
                                });
                            }))
                        })
                        .when(running, |el| {
                            el.child(widgets::button("host-stop", "Dừng chia sẻ", &theme, false, move |_, _, cx| {
                                let _ = view_stop.update(cx, |this, cx| {
                                    this.backend.host_stop();
                                    this.toast("info", "Đã dừng tunnel", "", cx);
                                    this.refresh_host(cx);
                                    cx.notify();
                                });
                            }))
                        }),
                )
                .when(!error.is_empty(), |el| {
                    el.child(div().text_size(px(TEXT_SM)).text_color(theme.bad).child(error.clone()))
                }),
        )
        .child(
            div().flex().flex_col().gap_3().p(px(18.0)).rounded(px(RADIUS_LG))
                .bg(if running { theme.accent_dim } else { theme.surface })
                .border_1().border_color(if running { theme.accent } else { theme.border_soft })
                .child(
                    div().flex().items_center().justify_between()
                        .child(div().flex().items_center().gap_2()
                            .child(widgets::icon("network", 18.0, if running { theme.accent_soft } else { theme.faint }))
                            .child(div().text_size(px(TEXT_MD)).font_weight(semibold()).text_color(theme.text)
                                .child(if running { "Địa chỉ cho bạn bè" } else { "Chưa mở tunnel" })))
                        .when(running && !address.is_empty(), |el| {
                            el.child(widgets::button("host-copy", "Sao chép địa chỉ", &theme, true, move |_, _, cx| {
                                let address = address_copy.clone();
                                let _ = view_copy.update(cx, |this, cx| {
                                    cx.write_to_clipboard(gpui::ClipboardItem::new_string(address.clone()));
                                    this.toast("ok", "Đã sao chép", address.clone(), cx);
                                });
                            }))
                        }),
                )
                .child(
                    div().flex().items_center().gap_2()
                        .child(
                            div().flex_1().h(px(44.0)).px(px(12.0)).flex().items_center().rounded(px(RADIUS_SM))
                                .bg(theme.elevated).border_1().border_color(theme.border)
                                .text_size(px(TEXT_MD)).font_family(MONO).text_color(if running { theme.accent_soft } else { theme.faint })
                                .child(if address.is_empty() { "Chưa có địa chỉ".to_string() } else { address.clone() }),
                        )
                        .child(div().text_size(px(TEXT_XS)).text_color(theme.faint)
                            .child(if detected > 0 { format!("World đang ở cổng {detected}") } else { "Hãy mở LAN trong game".into() })),
                ),
        )
        .child(
            div().flex().flex_col().gap_3().p(px(18.0)).rounded(px(RADIUS_LG))
                .bg(theme.surface).border_1().border_color(theme.border_soft)
                .child(section_title(&theme, "Nhật ký ngrok", ""))
                .child(
                    div().id("host-log").h(px(160.0)).overflow_y_scroll().p(px(10.0)).rounded(px(RADIUS_SM))
                        .bg(if theme.dark { gpui::rgb(0x07090c) } else { gpui::rgb(0xf7f8fa) })
                        .border_1().border_color(theme.border_soft)
                        .children(logs.iter().rev().take(80).rev().map(|line| {
                            div().text_size(px(11.0)).font_family(MONO).text_color(theme.muted).child(line.clone()).into_any_element()
                        })),
                ),
        )
        .into_any_element()
}

impl LauncherApp {
    pub fn refresh_host(&mut self, _cx: &mut Context<Self>) {
        let instance = self
            .host_instance
            .clone()
            .or_else(|| self.selected_instance.clone())
            .or_else(|| self.instances.first().map(|i| i.id.clone()));
        self.host_status = self.backend.host_status(instance);
    }
}
