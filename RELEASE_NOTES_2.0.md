# XyoLauncher 2.0

Bản cập nhật lớn: đổi tên, đổi giao diện, đổi cách khởi động và toàn bộ hiệu ứng mới.

## Khởi động
- Logo Xyo mới, titlebar tự vẽ (logo + tên + thu nhỏ/phóng to/đóng).
- Splash 156 khung hình 30fps, chuyển sang màn hình loading bằng hiệu ứng tách đôi.
- Màn loading mới: đếm % + thanh tiến trình + **hiệu ứng hạt tạo chữ** (XyoLauncher / Almost ready / Minecraft), tự chuyển chữ mỗi 5.2 giây.
- Cửa sổ khởi tạo 1180×760 (tối thiểu 980×640), cho phép thu nhỏ/phóng to.

## Tham số đã loại bỏ
- Bỏ hoàn toàn cờ `-XX:MaxGCPauseMillis` khỏi JVM mặc định.
- JVM mặc định rút gọn còn `-XX:+UseG1GC -XX:+DisableExplicitGC`.
- Launcher tự lọc các cờ cũ (`MaxGCPauseMillis`, `AlwaysPreTouch`) nếu còn trong cấu hình cũ.
- Xoá mục "Tối ưu" (boost) trong cài đặt instance.

## Ảnh nền
- Thêm mục **Ảnh nền** trong Cài đặt hệ thống.
- Mặc định dùng sẵn ảnh `1123121` (đóng gói trong app).
- 5 ảnh còn lại (984658, 1224149, 1265740, 1373816, 1402908) hiển thị dạng "Chưa tải", chỉ áp dụng được sau khi bấm **Tải về** (tải từ GitHub, lưu vào userData).
- Chế độ "Theo giao diện": tắt ảnh nền, quay về nền đặc theo sáng/tối.

## Hiệu ứng mới
- **Pixel dissolve khối cỏ** (xanh lá + nâu đất) khi **vào/ra instance**; chuyển qua lại giữa 4 trang chính thì không có hiệu ứng.
- Công tắc **Hiệu ứng chuyển cảnh** trong Cài đặt để bật/tắt.
- **Toast xếp chồng**: toast mới nổi lên trước, toast cũ lùi sau và thu nhỏ; rê chuột để bung thành danh sách; vuốt ngang để xoá; toast "đang tải" xoay rồi chuyển thành "xong".
- Chế độ nền ảnh: panel/sidebar/card là **kính mờ**, ảnh nền **nét**, modal/tooltip/toast/menu **đục hoàn toàn**, không phụ thuộc sáng/tối.
- Console khi chưa có log: hiệu ứng hạt tạo chữ (XyoLauncher / Almost ready / No log yet) thay cho chữ tĩnh.

## Giao diện mới
- Sidebar kiểu Rust: rail 200 ↔ 76px, pill trượt, nút thu gọn, thẻ tài khoản.
- Gộp Cài đặt + Tài khoản vào menu thả xuống của thẻ tài khoản (bám đúng vị trí nút, không bị cắt).
- Titlebar/PageHeader tối giản, font nhỏ hơn mặc định.
- Công tắc **sáng/tối** kiểu trời/đêm (ThemeSwitch).
- Toàn bộ icon, logo, favicon, ảnh nền installer được thay bằng bộ nhận diện XyoLauncher.

## Loại bỏ kiểu cũ
- Bỏ giao diện pixel (khung viền pixel, font pixel).
- Bỏ hiệu ứng wipe toàn màn hình cũ (`themeWipe.js`).
- Bỏ mục "Tối ưu"/boost và file `boost.cjs`.
- Bỏ cờ JVM `-XX:MaxGCPauseMillis`, `-XX:+AlwaysPreTouch`.
- Bỏ toast kiểu cũ (thanh ngắn ở góc màn hình) — thay bằng toast xếp chồng.
