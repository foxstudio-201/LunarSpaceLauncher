# XyoLauncher 2.0

Ban cap nhat lon: doi ten, doi giao dien, doi cach khoi dong va toan bo hieu ung moi.

## Khoi dong (launcher startup)
- Logo Xyo moi, titlebar tu ve (logo + ten + thu nho/phong to/dong).
- Splash 156 khung hinh 30fps, chuyen sang man loading bang hieu ung tach doi.
- Man loading moi: dem % + thanh tien trinh + **hieu ung hat tao chu** (XyoLauncher / Almost ready / Minecraft), tu chuyen chu moi 5.2s.
- Cua so khoi tao 1180x760 (toi thieu 980x640), cho phep thu nho/phong to.

## Tham so khoi dong da loai bo
- Bo hoan toan co `-XX:MaxGCPauseMillis` khoi JVM mac dinh.
- JVM mac dinh rut gon con `-XX:+UseG1GC -XX:+DisableExplicitGC`.
- Launcher tu loc cac co cu (`MaxGCPauseMillis`, `AlwaysPreTouch`) neu con trong cau hinh cu.
- Xoa muc "Toi uu" (boost) trong cai dat instance.

## Anh nen
- Them muc **Anh nen** trong Cai dat he thong.
- Mac dinh dung san anh `1123121` (dong goi trong app).
- Cac anh khac (984658, 1224149, 1265740, 1373816, 1402908) hien thi dang "Chua tai", chi ap dung duoc sau khi bam **Tai ve** (tai tu GitHub, luu vao userData).
- Che do "Theo giao dien": tat anh nen, quay ve nen dac theo sang/toi.

## Hieu ung moi
- Hieu ung **pixel dissolve hinh khoi co** (xanh la + nâu dat) khi **vao/ra instance**; chuyen qua lai giua 4 trang chinh thi khong co hieu ung.
- Cong tac **Hieu ung chuyen canh** trong Cai dat de bat/tat.
- **Toast xep chong** moi: toast moi noi len truoc, toast cu lui sau va thu nho, re chuot vao de bang ra, vuot ngang de xoa, toast "dang tai" xoay roi chuyen thanh "xong".
- Che do nen anh: panel/sidebar/card la **kinh mo** (blur), anh nen **net**, modal/tooltip/toast/menu **duc hoan toan**, khong phu thuoc sang/toi.

## Giao dien moi
- Sidebar kieu Rust: rail 200 <-> 76px, pill truot, nut thu gon, the tai khoan.
- Gop Cai dat + Tai khoan vao menu tha xuong cua the tai khoan (dung vi tri nut, khong bi cat).
- Titlebar/PageHeader toi gian, font nho hon mac dinh.
- Cong tac **sang/toi** kieu troi/dem (ThemeSwitch).
- Toan bo icon/logo, favicon, anh nen installer duoc thay bang bo nhan XyoLauncher.

## Loai bo kieu cu
- Bo giao dien pixel (khung vien pixel, font pixel).
- Bo hieu ung wipe toan man hinh cu (`themeWipe.js`).
- Bo muc "Toi uu"/boost va cac file `boost.cjs`.
- Bo co JVM `-XX:MaxGCPauseMillis`, `-XX:+AlwaysPreTouch`.
- Bo toast kieu cu (thanh ngan o goc man hinh) - thay bang toast xep chong.
