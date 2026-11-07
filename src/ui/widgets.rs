use crate::ui::assets::icon_path;
use crate::ui::theme::*;
use gpui::{
    AnyView, App, Bounds, ClipboardItem, Context, CursorStyle, Div, Element, ElementId,
    ElementInputHandler, Entity, EntityInputHandler, FocusHandle, Focusable, FontWeight,
    GlobalElementId, InspectorElementId, IntoElement, KeyBinding, LayoutId, MouseButton,
    MouseDownEvent, MouseMoveEvent, MouseUpEvent, PaintQuad, Pixels, Point, Render, ShapedLine,
    SharedString, Style, TextRun, UTF16Selection, UnderlineStyle, Window, actions, div, fill,
    point, prelude::*, px, relative, rgba, size,
};
use std::ops::Range;
use std::sync::Arc;
use unicode_segmentation::UnicodeSegmentation;

actions!(
    text_field,
    [
        Backspace,
        Delete,
        Left,
        Right,
        SelectLeft,
        SelectRight,
        SelectAll,
        Home,
        End,
        ShowCharacterPalette,
        Paste,
        Cut,
        Copy,
        Submit,
        LineUp,
        LineDown
    ]
);

fn tooltip_for_icon(name: &str) -> Option<(&'static str, &'static str)> {
    Some(match name {
        "x" => ("Đóng", "Đóng cửa sổ hoặc hộp thoại hiện tại"),
        "minus" => ("Thu nhỏ", "Thu nhỏ launcher xuống thanh tác vụ"),
        "square" => ("Phóng to", "Phóng to hoặc thu hồi cửa sổ launcher"),
        "gear" | "gear-six" => ("Cài đặt", "Mở cấu hình cho mục này"),
        "trash" => ("Xoá", "Chuyển mục vào thùng rác để có thể khôi phục"),
        "play" | "play-fill" => ("Chơi", "Khởi chạy Minecraft với phiên bản đã chọn"),
        "stop" | "stop-fill" => ("Dừng", "Dừng tiến trình Minecraft đang chạy"),
        "plus" => ("Thêm", "Tạo mới một mục"),
        "arrow-left" => ("Quay lại", "Quay về màn hình trước"),
        "arrow-right" => ("Tiếp tục", "Đi tới bước tiếp theo"),
        "folder" | "folder-open" => ("Mở thư mục", "Mở thư mục này trong File Explorer"),
        "arrows-clockwise" | "arrow-clockwise" | "arrows-clockwise-fill" => ("Làm mới", "Tải lại dữ liệu mới nhất"),
        "download" | "download-simple" => ("Tải xuống", "Tải tệp hoặc gói này về máy"),
        "copy" => ("Sao chép", "Sao chép nội dung vào clipboard"),
        "eye" => ("Xem", "Xem trước nội dung"),
        "magnifying-glass" => ("Tìm kiếm", "Tìm theo tên hoặc mã dự án"),
        "sidebar-simple" => ("Thanh bên", "Thu gọn hoặc mở rộng thanh điều hướng"),
        "terminal" => ("Console", "Xem nhật ký và gửi lệnh tới game"),
        "files" => ("Tệp tin", "Duyệt và chỉnh sửa tệp trong phiên bản"),
        "puzzle-piece" => ("Mods", "Quản lý mod và gói hỗ trợ"),
        "image" => ("Gói tài nguyên", "Quản lý resource pack"),
        "paint-brush" => ("Shader", "Quản lý shader pack"),
        "archive" => ("Bản lưu", "Quản lý thế giới và bản lưu"),
        "map-trifold" => ("Bản đồ", "Xem bản đồ địa hình của thế giới"),
        "cloud" => ("Host", "Chia sẻ server Minecraft qua đường hầm"),
        "hard-drives" => ("Server", "Quản lý server chạy trên máy"),
        "stack" => ("Modpack", "Khám phá Modrinth, CurseForge và LunarModpack"),
        "cube" => ("Phiên bản", "Tạo và quản lý phiên bản Minecraft"),
        "house" => ("Trang chủ", "Về trang tổng quan của launcher"),
        "user" | "user-circle" => ("Tài khoản", "Quản lý tài khoản đăng nhập"),
        "check-circle" => ("Đã xong", "Thao tác đã hoàn tất"),
        "warning-circle" | "warning" => ("Cảnh báo", "Cần chú ý trước khi tiếp tục"),
        "info" => ("Thông tin", "Xem thông tin chi tiết"),
        "coffee" => ("Java", "Quản lý bản Java cho Minecraft"),
        "memory" => ("RAM", "Bộ nhớ cấp cho phiên bản"),
        "package" => ("Gói", "Thông tin gói nội dung"),
        "share-network" => ("Chia sẻ", "Chia sẻ nội dung này với người khác"),
        "link-simple" => ("Liên kết", "Mở liên kết bằng trình duyệt"),
        "floppy-disk" => ("Lưu", "Lưu các thay đổi hiện tại"),
        "file-arrow-up" => ("Gửi log", "Tải nhật ký lên để được hỗ trợ"),
        "arrow-square-out" => ("Mở ra ngoài", "Mở trong cửa sổ hoặc ứng dụng khác"),
        _ => return None,
    })
}

struct TipView {
    title: String,
    hint: String,
}

impl Render for TipView {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .gap(px(2.0))
            .max_w(px(300.0))
            .px(px(10.0))
            .py(px(7.0))
            .rounded(px(8.0))
            .bg(rgba(0x1a1725f2))
            .border_1()
            .border_color(rgba(0xffffff14))
            .shadow_lg()
            .text_color(gpui::rgb(0xf5f3fa))
            .child(
                div()
                    .text_size(px(11.5))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(self.title.clone()),
            )
            .when(!self.hint.is_empty(), |el| {
                el.child(
                    div()
                        .text_size(px(10.5))
                        .line_height(px(15.0))
                        .text_color(rgba(0xffffffb0))
                        .child(self.hint.clone()),
                )
            })
    }
}

pub fn with_tooltip(
    element: gpui::Stateful<Div>,
    title: impl Into<SharedString>,
    hint: impl Into<SharedString>,
) -> gpui::Stateful<Div> {
    let title: SharedString = title.into();
    let hint: SharedString = hint.into();
    element.tooltip(move |_window, cx| {
        let title = title.to_string();
        let hint = hint.to_string();
        AnyView::from(cx.new(|_| TipView { title, hint }))
    })
}

pub fn icon_source(name: &str) -> String {
    let duotone = format!("icons/duotone/{name}.svg");
    if crate::ui::assets::exists(&duotone) {
        duotone
    } else {
        icon_path(name)
    }
}

pub fn tip_detailed(
    id: impl Into<ElementId>,
    title: impl Into<SharedString>,
    hint: impl Into<SharedString>,
    element: impl IntoElement,
) -> gpui::AnyElement {
    let title: SharedString = title.into();
    let hint: SharedString = hint.into();
    div()
        .id(id)
        .flex_shrink_0()
        .tooltip(move |_window, cx| {
            let title = title.to_string();
            let hint = hint.to_string();
            AnyView::from(cx.new(|_| TipView { title, hint }))
        })
        .child(element)
        .into_any_element()
}

pub fn bind_text_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("backspace", Backspace, None),
        KeyBinding::new("delete", Delete, None),
        KeyBinding::new("left", Left, None),
        KeyBinding::new("right", Right, None),
        KeyBinding::new("shift-left", SelectLeft, None),
        KeyBinding::new("shift-right", SelectRight, None),
        KeyBinding::new("ctrl-a", SelectAll, None),
        KeyBinding::new("ctrl-v", Paste, None),
        KeyBinding::new("ctrl-c", Copy, None),
        KeyBinding::new("ctrl-x", Cut, None),
        KeyBinding::new("home", Home, None),
        KeyBinding::new("end", End, None),
        KeyBinding::new("enter", Submit, None),
        KeyBinding::new("up", LineUp, None),
        KeyBinding::new("down", LineDown, None),
        KeyBinding::new("ctrl-shift-space", ShowCharacterPalette, None),
    ]);
}

type TextCallback = Arc<dyn Fn(&str, &mut Window, &mut App) + 'static>;

pub struct TextField {
    focus_handle: FocusHandle,
    pub content: SharedString,
    pub placeholder: SharedString,
    selected_range: Range<usize>,
    selection_reversed: bool,
    marked_range: Option<Range<usize>>,
    last_layout: Option<Vec<ShapedLine>>,
    last_bounds: Option<Bounds<Pixels>>,
    is_selecting: bool,
    multiline: bool,
    on_change: Option<TextCallback>,
    on_submit: Option<TextCallback>,
}

impl TextField {
    pub fn new(cx: &mut Context<Self>, placeholder: impl Into<SharedString>) -> Self {
        Self {
            focus_handle: cx.focus_handle(),
            content: "".into(),
            placeholder: placeholder.into(),
            selected_range: 0..0,
            selection_reversed: false,
            marked_range: None,
            last_layout: None,
            last_bounds: None,
            is_selecting: false,
            multiline: false,
            on_change: None,
            on_submit: None,
        }
    }

    pub fn multiline(mut self, value: bool) -> Self {
        self.multiline = value;
        self
    }

    pub fn on_change(mut self, callback: impl Fn(&str, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Arc::new(callback));
        self
    }

    pub fn on_submit(mut self, callback: impl Fn(&str, &mut Window, &mut App) + 'static) -> Self {
        self.on_submit = Some(Arc::new(callback));
        self
    }

    pub fn set_text(&mut self, text: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.content = text.into();
        let len = self.content.len();
        self.selected_range = len..len;
        self.marked_range = None;
        cx.notify();
    }

    pub fn text(&self) -> &str {
        &self.content
    }

    pub fn clear(&mut self, cx: &mut Context<Self>) {
        self.content = "".into();
        self.selected_range = 0..0;
        self.marked_range = None;
        cx.notify();
    }

    fn fire_change(&self, window: &mut Window, cx: &mut App) {
        if let Some(callback) = self.on_change.as_ref() {
            callback(&self.content, window, cx);
        }
    }

    fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.move_to(self.previous_boundary(self.cursor_offset()), cx);
        } else {
            self.move_to(self.selected_range.start, cx)
        }
    }

    fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.move_to(self.next_boundary(self.selected_range.end), cx);
        } else {
            self.move_to(self.selected_range.end, cx)
        }
    }

    fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.previous_boundary(self.cursor_offset()), cx);
    }

    fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.next_boundary(self.cursor_offset()), cx);
    }

    fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(0, cx);
        self.select_to(self.content.len(), cx)
    }

    fn home(&mut self, _: &Home, _: &mut Window, cx: &mut Context<Self>) {
        if self.multiline {
            let line = self.cursor_line();
            self.move_to(self.line_ranges()[line].0, cx);
        } else {
            self.move_to(0, cx);
        }
    }

    fn end(&mut self, _: &End, _: &mut Window, cx: &mut Context<Self>) {
        if self.multiline {
            let line = self.cursor_line();
            self.move_to(self.line_ranges()[line].1, cx);
        } else {
            self.move_to(self.content.len(), cx);
        }
    }

    fn line_up(&mut self, _: &LineUp, _: &mut Window, cx: &mut Context<Self>) {
        if !self.multiline {
            return;
        }
        let ranges = self.line_ranges();
        let line = self.cursor_line();
        if line == 0 {
            return;
        }
        let col = self.cursor_offset() - ranges[line].0;
        let target = (ranges[line - 1].0 + col).min(ranges[line - 1].1);
        self.move_to(target, cx);
    }

    fn line_down(&mut self, _: &LineDown, _: &mut Window, cx: &mut Context<Self>) {
        if !self.multiline {
            return;
        }
        let ranges = self.line_ranges();
        let line = self.cursor_line();
        if line + 1 >= ranges.len() {
            return;
        }
        let col = self.cursor_offset() - ranges[line].0;
        let target = (ranges[line + 1].0 + col).min(ranges[line + 1].1);
        self.move_to(target, cx);
    }

    fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.select_to(self.previous_boundary(self.cursor_offset()), cx)
        }
        self.replace_text_in_range(None, "", window, cx)
    }

    fn delete(&mut self, _: &Delete, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.select_to(self.next_boundary(self.selected_range.end), cx)
        }
        self.replace_text_in_range(None, "", window, cx)
    }

    fn submit(&mut self, _: &Submit, window: &mut Window, cx: &mut Context<Self>) {
        if self.multiline {
            self.replace_text_in_range(None, "\n", window, cx);
        } else if let Some(callback) = self.on_submit.as_ref() {
            callback(&self.content, window, cx);
        }
    }

    fn show_character_palette(&mut self, _: &ShowCharacterPalette, window: &mut Window, _: &mut Context<Self>) {
        window.show_character_palette();
    }

    fn paste(&mut self, _: &Paste, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
            let text = if self.multiline {
                text
            } else {
                text.replace('\n', " ")
            };
            self.replace_text_in_range(None, &text, window, cx);
        }
    }

    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if !self.selected_range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(
                self.content[self.selected_range.clone()].to_string(),
            ));
        }
    }

    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        if !self.selected_range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(
                self.content[self.selected_range.clone()].to_string(),
            ));
            self.replace_text_in_range(None, "", window, cx)
        }
    }

    fn on_mouse_down(&mut self, event: &MouseDownEvent, _window: &mut Window, cx: &mut Context<Self>) {
        self.is_selecting = true;
        if event.modifiers.shift {
            self.select_to(self.index_for_mouse_position(event.position), cx);
        } else {
            self.move_to(self.index_for_mouse_position(event.position), cx)
        }
    }

    fn on_mouse_up(&mut self, _: &MouseUpEvent, _window: &mut Window, _: &mut Context<Self>) {
        self.is_selecting = false;
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, _window: &mut Window, cx: &mut Context<Self>) {
        if self.is_selecting {
            self.select_to(self.index_for_mouse_position(event.position), cx);
        }
    }

    fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.selected_range = offset..offset;
        self.selection_reversed = false;
        self.marked_range = None;
        cx.notify()
    }

    fn cursor_offset(&self) -> usize {
        if self.selection_reversed {
            self.selected_range.start
        } else {
            self.selected_range.end
        }
    }

    fn line_ranges(&self) -> Vec<(usize, usize)> {
        let text = self.content.as_ref();
        let mut out = Vec::new();
        let mut start = 0usize;
        for (at, ch) in text.char_indices() {
            if ch == '\n' {
                out.push((start, at));
                start = at + 1;
            }
        }
        out.push((start, text.len()));
        out
    }

    fn cursor_line(&self) -> usize {
        let offset = self.cursor_offset();
        let ranges = self.line_ranges();
        for (index, (start, end)) in ranges.iter().enumerate() {
            if offset <= *end || index + 1 == ranges.len() {
                return index;
            }
            if offset == *end + 1 {
                return (index + 1).min(ranges.len() - 1);
            }
        }
        0
    }

    fn index_for_mouse_position(&self, position: Point<Pixels>) -> usize {
        let (Some(bounds), Some(lines)) = (self.last_bounds.as_ref(), self.last_layout.as_ref()) else {
            return 0;
        };
        if lines.is_empty() {
            return 0;
        }
        let line_height = window_line_height(lines.len());
        let _ = line_height;
        let ranges = self.line_ranges();
        let local_y = position.y - bounds.top();
        let approx_line = (local_y / px(20.0)) as usize;
        let line = approx_line.min(lines.len().saturating_sub(1));
        let shaped = &lines[line];
        let x = position.x - bounds.left();
        let col = shaped.closest_index_for_x(x).min(ranges[line].1 - ranges[line].0);
        ranges[line].0 + col
    }

    fn select_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        if self.selection_reversed {
            self.selected_range.start = offset
        } else {
            self.selected_range.end = offset
        };
        if self.selected_range.end < self.selected_range.start {
            self.selection_reversed = !self.selection_reversed;
            self.selected_range = self.selected_range.end..self.selected_range.start;
        }
        cx.notify()
    }

    fn offset_from_utf16(&self, offset: usize) -> usize {
        let mut utf8_offset = 0;
        let mut utf16_count = 0;
        for ch in self.content.chars() {
            if utf16_count >= offset {
                break;
            }
            utf16_count += ch.len_utf16();
            utf8_offset += ch.len_utf8();
        }
        utf8_offset
    }

    fn offset_to_utf16(&self, offset: usize) -> usize {
        let mut utf16_offset = 0;
        let mut utf8_count = 0;
        for ch in self.content.chars() {
            if utf8_count >= offset {
                break;
            }
            utf8_count += ch.len_utf8();
            utf16_offset += ch.len_utf16();
        }
        utf16_offset
    }

    fn range_to_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.offset_to_utf16(range.start)..self.offset_to_utf16(range.end)
    }

    fn range_from_utf16(&self, range_utf16: &Range<usize>) -> Range<usize> {
        self.offset_from_utf16(range_utf16.start)..self.offset_from_utf16(range_utf16.end)
    }

    fn previous_boundary(&self, offset: usize) -> usize {
        self.content
            .grapheme_indices(true)
            .rev()
            .find_map(|(idx, _)| (idx < offset).then_some(idx))
            .unwrap_or(0)
    }

    fn next_boundary(&self, offset: usize) -> usize {
        self.content
            .grapheme_indices(true)
            .find_map(|(idx, _)| (idx > offset).then_some(idx))
            .unwrap_or(self.content.len())
    }
}

fn window_line_height(_lines: usize) -> Pixels {
    px(20.0)
}

impl EntityInputHandler for TextField {
    fn text_for_range(
        &mut self,
        range_utf16: Range<usize>,
        actual_range: &mut Option<Range<usize>>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.range_from_utf16(&range_utf16);
        actual_range.replace(self.range_to_utf16(&range));
        Some(self.content[range].to_string())
    }

    fn selected_text_range(
        &mut self,
        _ignore_disabled_input: bool,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: self.range_to_utf16(&self.selected_range),
            reversed: self.selection_reversed,
        })
    }

    fn marked_text_range(&self, _window: &mut Window, _cx: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked_range.as_ref().map(|range| self.range_to_utf16(range))
    }

    fn unmark_text(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {
        self.marked_range = None;
    }

    fn replace_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range_utf16
            .as_ref()
            .map(|range_utf16| self.range_from_utf16(range_utf16))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());
        let new_text = if self.multiline {
            new_text.to_string()
        } else {
            new_text.replace('\n', " ")
        };
        self.content = (self.content[0..range.start].to_owned() + &new_text + &self.content[range.end..]).into();
        self.selected_range = range.start + new_text.len()..range.start + new_text.len();
        self.marked_range.take();
        cx.notify();
        self.fire_change(window, cx);
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        new_selected_range_utf16: Option<Range<usize>>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range_utf16
            .as_ref()
            .map(|range_utf16| self.range_from_utf16(range_utf16))
            .or(self.marked_range.clone())
            .unwrap_or(self.selected_range.clone());
        let new_text = if self.multiline {
            new_text.to_string()
        } else {
            new_text.replace('\n', " ")
        };
        self.content = (self.content[0..range.start].to_owned() + &new_text + &self.content[range.end..]).into();
        if !new_text.is_empty() {
            self.marked_range = Some(range.start..range.start + new_text.len());
        } else {
            self.marked_range = None;
        }
        self.selected_range = new_selected_range_utf16
            .as_ref()
            .map(|range_utf16| self.range_from_utf16(range_utf16))
            .map(|new_range| new_range.start + range.start..new_range.end + range.end)
            .unwrap_or_else(|| range.start + new_text.len()..range.start + new_text.len());
        cx.notify();
    }

    fn bounds_for_range(
        &mut self,
        range_utf16: Range<usize>,
        bounds: Bounds<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let range = self.range_from_utf16(&range_utf16);
        let ranges = self.line_ranges();
        let line = ranges
            .iter()
            .position(|(start, end)| range.start >= *start && range.start <= *end)
            .unwrap_or(0);
        let Some(lines) = self.last_layout.as_ref() else {
            return None;
        };
        let shaped = lines.get(line)?;
        let col = range.start.saturating_sub(ranges[line].0).min(ranges[line].1 - ranges[line].0);
        let x = shaped.x_for_index(col);
        let y = bounds.top() + px(line as f32 * 20.0);
        Some(Bounds::from_corners(
            point(bounds.left() + x, y),
            point(bounds.left() + x + px(2.0), y + px(20.0)),
        ))
    }

    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<usize> {
        Some(self.index_for_mouse_position(point))
    }
}

struct TextElement {
    input: Entity<TextField>,
}

struct PrepaintState {
    lines: Vec<ShapedLine>,
    cursor: Option<PaintQuad>,
    selection: Vec<PaintQuad>,
    line_height: Pixels,
}

impl IntoElement for TextElement {
    type Element = Self;
    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for TextElement {
    type RequestLayoutState = ();
    type PrepaintState = PrepaintState;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let input = self.input.read(cx);
        let lines = if input.content.is_empty() {
            1
        } else {
            input.line_ranges().len()
        };
        let line_height = window.line_height();
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        style.size.height = (line_height * lines as f32).into();
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _state: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let input = self.input.read(cx);
        let style = window.text_style();
        let font_size = style.font_size.to_pixels(window.rem_size());
        let line_height = window.line_height();
        let display_text = input.content.clone();
        let is_placeholder = display_text.is_empty();
        let text = if is_placeholder {
            input.placeholder.clone()
        } else {
            display_text
        };
        let ranges = if is_placeholder {
            vec![(0usize, text.len())]
        } else {
            input.line_ranges()
        };
        let mut lines = Vec::new();
        for (start, end) in &ranges {
            let segment = text.get(*start..(*end).min(text.len())).unwrap_or("");
            let run = TextRun {
                len: segment.len(),
                font: style.font(),
                color: if is_placeholder {
                    style.color.opacity(0.45)
                } else {
                    style.color
                },
                background_color: None,
                underline: None,
                strikethrough: None,
            };
            let runs = if let Some(marked) = input.marked_range.as_ref() {
                let ms = marked.start.saturating_sub(*start).min(segment.len());
                let me = marked.end.saturating_sub(*start).min(segment.len());
                if ms < me {
                    vec![
                        TextRun { len: ms, ..run.clone() },
                        TextRun {
                            len: me - ms,
                            underline: Some(UnderlineStyle {
                                color: Some(run.color),
                                thickness: px(1.0),
                                wavy: false,
                            }),
                            ..run.clone()
                        },
                        TextRun { len: segment.len() - me, ..run.clone() },
                    ]
                    .into_iter()
                    .filter(|r| r.len > 0)
                    .collect()
                } else {
                    vec![run]
                }
            } else {
                vec![run]
            };
            lines.push(window.text_system().shape_line(SharedString::from(segment.to_string()), font_size, &runs, None));
        }
        let mut selection = Vec::new();
        let mut cursor = None;
        if !is_placeholder {
            let content_ranges = input.line_ranges();
            for (index, (start, end)) in content_ranges.iter().enumerate() {
                let from = input.selected_range.start.max(*start);
                let to = input.selected_range.end.min(*end);
                if from < to {
                    let shaped = &lines[index];
                    selection.push(fill(
                        Bounds::from_corners(
                            point(bounds.left() + shaped.x_for_index(from - start), bounds.top() + line_height * index as f32),
                            point(bounds.left() + shaped.x_for_index(to - start), bounds.top() + line_height * (index + 1) as f32),
                        ),
                        rgba(0xe9b87255),
                    ));
                }
            }
            let cursor_line = input.cursor_line();
            let col = input
                .cursor_offset()
                .saturating_sub(content_ranges.get(cursor_line).map(|r| r.0).unwrap_or(0));
            if let Some(shaped) = lines.get(cursor_line) {
                let x = shaped.x_for_index(col);
                cursor = Some(fill(
                    Bounds::new(
                        point(bounds.left() + x, bounds.top() + line_height * cursor_line as f32),
                        size(px(2.0), line_height),
                    ),
                    style.color,
                ));
            }
        }
        Self::PrepaintState {
            lines,
            cursor,
            selection,
            line_height,
        }
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _state: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let focus_handle = self.input.read(cx).focus_handle.clone();
        window.handle_input(
            &focus_handle,
            ElementInputHandler::new(bounds, self.input.clone()),
            cx,
        );
        for quad in prepaint.selection.drain(..) {
            window.paint_quad(quad);
        }
        let line_height = prepaint.line_height;
        for (index, line) in prepaint.lines.iter().enumerate() {
            let origin = point(bounds.left(), bounds.top() + line_height * index as f32);
            let _ = line.paint(origin, line_height, window, cx);
        }
        if focus_handle.is_focused(window) {
            if let Some(cursor) = prepaint.cursor.take() {
                window.paint_quad(cursor);
            }
        }
        let shaped_lines = prepaint.lines.clone();
        self.input.update(cx, |input, _cx| {
            input.last_layout = Some(shaped_lines);
            input.last_bounds = Some(bounds);
        });
    }
}

impl Focusable for TextField {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for TextField {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .key_context("TextField")
            .track_focus(&self.focus_handle(cx))
            .cursor(CursorStyle::IBeam)
            .on_action(cx.listener(Self::backspace))
            .on_action(cx.listener(Self::delete))
            .on_action(cx.listener(Self::left))
            .on_action(cx.listener(Self::right))
            .on_action(cx.listener(Self::select_left))
            .on_action(cx.listener(Self::select_right))
            .on_action(cx.listener(Self::select_all))
            .on_action(cx.listener(Self::home))
            .on_action(cx.listener(Self::end))
            .on_action(cx.listener(Self::line_up))
            .on_action(cx.listener(Self::line_down))
            .on_action(cx.listener(Self::submit))
            .on_action(cx.listener(Self::show_character_palette))
            .on_action(cx.listener(Self::paste))
            .on_action(cx.listener(Self::cut))
            .on_action(cx.listener(Self::copy))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_move(cx.listener(Self::on_mouse_move))
            .size_full()
            .child(TextElement { input: cx.entity() })
    }
}

pub fn icon(name: &str, size: f32, color: gpui::Rgba) -> impl IntoElement {
    gpui::svg()
        .path(icon_source(name))
        .size(px(size))
        .text_color(color)
        .flex_shrink_0()
}

pub fn icon_button(
    id: impl Into<ElementId>,
    name: &'static str,
    theme: &Theme,
    on_click: impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static,
) -> impl IntoElement {
    let (title, hint) = tooltip_for_icon(name).unwrap_or(("", ""));
    let title: SharedString = title.into();
    let hint: SharedString = hint.into();
    div()
        .id(id)
        .tooltip(move |_window, cx| {
            let title = title.to_string();
            let hint = hint.to_string();
            AnyView::from(cx.new(|_| TipView { title, hint }))
        })
        .flex()
        .items_center()
        .justify_center()
        .size(px(32.0))
        .rounded(px(RADIUS_SM))
        .cursor_pointer()
        .hover(|s| s.bg(theme.surface_hover))
        .child(icon(name, 16.0, theme.muted))
        .on_click(on_click)
}

pub fn button(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    theme: &Theme,
    primary: bool,
    on_click: impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static,
) -> impl IntoElement {
    let label: SharedString = label.into();
    let base = div()
        .id(id)
        .flex()
        .items_center()
        .justify_center()
        .gap_2()
        .h(px(36.0))
        .px(px(16.0))
        .rounded(px(RADIUS_SM))
        .text_size(px(TEXT_BASE))
        .font_weight(FontWeight::MEDIUM)
        .cursor_pointer()
        .on_click(on_click);
    if primary {
        base.bg(theme.accent)
            .text_color(theme.on_accent)
            .hover(|s| s.bg(theme.accent_hover))
            .child(label)
    } else {
        base.bg(theme.surface)
            .border_1()
            .border_color(theme.border)
            .text_color(theme.text)
            .hover(|s| s.bg(theme.surface_hover))
            .child(label)
    }
}

pub fn ghost_button(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    theme: &Theme,
    on_click: impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static,
) -> impl IntoElement {
    let label: SharedString = label.into();
    div()
        .id(id)
        .flex()
        .items_center()
        .justify_center()
        .gap_2()
        .h(px(32.0))
        .px(px(12.0))
        .rounded(px(RADIUS_SM))
        .text_size(px(TEXT_SM))
        .font_weight(FontWeight::MEDIUM)
        .text_color(theme.muted)
        .cursor_pointer()
        .hover(|s| s.bg(theme.surface_hover).text_color(theme.text))
        .child(label)
        .on_click(on_click)
}

pub fn tag(label: impl Into<SharedString>, color: gpui::Rgba, theme: &Theme) -> impl IntoElement {
    let label: SharedString = label.into();
    div()
        .flex()
        .items_center()
        .h(px(22.0))
        .px(px(8.0))
        .rounded(px(6.0))
        .bg(if theme.dark { theme.surface_active } else { theme.surface_hover })
        .text_size(px(TEXT_XS))
        .font_weight(FontWeight::MEDIUM)
        .text_color(color)
        .child(label)
}

pub fn panel(theme: &Theme) -> Div {
    div()
        .flex()
        .flex_col()
        .bg(theme.surface)
        .border_1()
        .border_color(theme.border_soft)
        .rounded(px(RADIUS_LG))
}

pub fn progress_bar(percent: f32, theme: &Theme, indeterminate: bool) -> impl IntoElement {
    let width = percent.clamp(0.0, 100.0);
    div()
        .h(px(6.0))
        .w_full()
        .rounded_full()
        .bg(theme.surface_active)
        .truncate()
        .child(
            div()
                .h_full()
                .w(gpui::relative(if indeterminate { 0.35 } else { width / 100.0 }))
                .rounded_full()
                .bg(theme.accent),
        )
}

pub fn divider(theme: &Theme) -> impl IntoElement {
    div().h(px(1.0)).w_full().bg(theme.border_soft)
}

pub fn spinner(size: f32, color: gpui::Rgba) -> impl IntoElement {
    use gpui::AnimationExt;
    gpui::svg()
        .path(icon_path("circle-notch"))
        .size(px(size))
        .text_color(color)
        .with_animation(
            "spinner-rotate",
            gpui::Animation::new(std::time::Duration::from_millis(900)).repeat(),
            |el, t| {
                el.with_transformation(gpui::Transformation::rotate(gpui::radians(
                    t * std::f32::consts::TAU,
                )))
            },
        )
}

pub fn text_input_box(theme: &Theme) -> Div {
    div()
        .flex()
        .items_center()
        .w_full()
        .min_h(px(38.0))
        .px(px(12.0))
        .py(px(8.0))
        .rounded(px(RADIUS_SM))
        .bg(theme.elevated)
        .border_1()
        .border_color(theme.border)
        .overflow_hidden()
        .text_color(theme.text)
        .text_size(px(TEXT_BASE))
}


pub fn tip(
    id: impl Into<ElementId>,
    text: impl Into<SharedString>,
    _view: gpui::WeakEntity<crate::ui::app::LauncherApp>,
    element: impl IntoElement,
) -> gpui::AnyElement {
    tip_detailed(id, text, "", element)
}
