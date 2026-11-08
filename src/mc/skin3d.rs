use image::RgbaImage;

pub const HEAD: u8 = 0;
pub const BODY: u8 = 1;
pub const RIGHT_ARM: u8 = 2;
pub const LEFT_ARM: u8 = 3;
pub const RIGHT_LEG: u8 = 4;
pub const LEFT_LEG: u8 = 5;
pub const CAPE: u8 = 6;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Layer {
    Inner,
    Outer,
}

#[derive(Clone, Copy)]
pub struct Camera {
    pub yaw: f32,
    pub pitch: f32,
    pub scale: f32,
    pub cx: f32,
    pub cy: f32,
}

impl Camera {
    pub fn new(yaw: f32, pitch: f32, width: u32, height: u32) -> Self {
        Self {
            yaw,
            pitch,
            scale: height as f32 / 39.0,
            cx: width as f32 / 2.0,
            cy: height as f32 * 0.53,
        }
    }

    fn project(&self, point: (f32, f32, f32)) -> (f32, f32, f32) {
        let (sin_y, cos_y) = self.yaw.sin_cos();
        let (sin_p, cos_p) = self.pitch.sin_cos();
        let x = point.0;
        let y = point.1 - 16.0;
        let z = point.2;
        let xr = x * cos_y + z * sin_y;
        let zr = -x * sin_y + z * cos_y;
        let yr = y * cos_p - zr * sin_p;
        let zr2 = y * sin_p + zr * cos_p;
        (self.cx + xr * self.scale, self.cy + yr * self.scale, zr2)
    }
}

#[derive(Clone)]
struct Face {
    points: [(f32, f32, f32); 4],
    uv: [(f32, f32, f32, f32); 4],
    shade: f32,
    layer: Layer,
    part: u8,
    cape: bool,
}

struct Uv {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

impl Uv {
    fn new(x: u32, y: u32, w: u32, h: u32) -> Self {
        Self { x, y, w, h }
    }
}

fn make_face(
    points: [(f32, f32, f32); 4],
    uv: Uv,
    shade: f32,
    flip_u: bool,
    flip_v: bool,
    layer: Layer,
    part: u8,
) -> Face {
    let mut corners = [(0.0, 0.0, 0.0, 0.0); 4];
    let positions = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
    for (index, (u, v)) in positions.iter().enumerate() {
        corners[index] = (
            uv.x as f32,
            uv.y as f32,
            uv.x as f32 + if flip_u { 1.0 - u } else { *u } * uv.w as f32,
            uv.y as f32 + if flip_v { 1.0 - v } else { *v } * uv.h as f32,
        );
    }
    Face {
        points,
        uv: corners,
        shade,
        layer,
        part,
        cape: false,
    }
}

fn cuboid(
    x0: f32,
    x1: f32,
    y0: f32,
    y1: f32,
    z0: f32,
    z1: f32,
    uv: [Uv; 6],
    layer: Layer,
    part: u8,
) -> Vec<Face> {
    vec![
        make_face(
            [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
            Uv::new(uv[0].x, uv[0].y, uv[0].w, uv[0].h),
            1.0,
            false,
            false,
            layer,
            part,
        ),
        make_face(
            [(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)],
            Uv::new(uv[1].x, uv[1].y, uv[1].w, uv[1].h),
            0.72,
            true,
            false,
            layer,
            part,
        ),
        make_face(
            [(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)],
            Uv::new(uv[2].x, uv[2].y, uv[2].w, uv[2].h),
            0.85,
            false,
            false,
            layer,
            part,
        ),
        make_face(
            [(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)],
            Uv::new(uv[3].x, uv[3].y, uv[3].w, uv[3].h),
            0.7,
            true,
            false,
            layer,
            part,
        ),
        make_face(
            [(x0, y0, z1), (x1, y0, z1), (x1, y0, z0), (x0, y0, z0)],
            Uv::new(uv[5].x, uv[5].y, uv[5].w, uv[5].h),
            0.95,
            false,
            false,
            layer,
            part,
        ),
        make_face(
            [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)],
            Uv::new(uv[4].x, uv[4].y, uv[4].w, uv[4].h),
            0.6,
            false,
            true,
            layer,
            part,
        ),
    ]
}

fn head(layer: Layer) -> Vec<Face> {
    let inflate = if layer == Layer::Outer { 0.5 } else { 0.0 };
    let base = if layer == Layer::Outer { 32 } else { 0 };
    cuboid(
        -4.0 - inflate,
        4.0 + inflate,
        -inflate,
        8.0 + inflate,
        -4.0 - inflate,
        4.0 + inflate,
        [
            Uv::new(base + 8, 8, 8, 8),
            Uv::new(base + 24, 8, 8, 8),
            Uv::new(base, 8, 8, 8),
            Uv::new(base + 16, 8, 8, 8),
            Uv::new(base + 8, 0, 8, 8),
            Uv::new(base + 16, 0, 8, 8),
        ],
        layer,
        HEAD,
    )
}

fn body(layer: Layer) -> Vec<Face> {
    let inflate = if layer == Layer::Outer { 0.5 } else { 0.0 };
    let y = if layer == Layer::Outer { 32 } else { 20 };
    let top_y = if layer == Layer::Outer { 28 } else { 16 };
    cuboid(
        -4.0 - inflate,
        4.0 + inflate,
        8.0 - inflate,
        20.0 + inflate,
        -2.0 - inflate,
        2.0 + inflate,
        [
            Uv::new(20, y, 8, 12),
            Uv::new(32, y, 8, 12),
            Uv::new(16, y, 4, 12),
            Uv::new(28, y, 4, 12),
            Uv::new(20, top_y, 8, 4),
            Uv::new(28, top_y, 8, 4),
        ],
        layer,
        BODY,
    )
}

fn arm(right: bool, slim: bool, layer: Layer) -> Vec<Face> {
    let width = if slim { 3.0 } else { 4.0 };
    let inflate = if layer == Layer::Outer { 0.5 } else { 0.0 };
    let (x0, x1) = if right {
        (-4.0 - width - inflate, -4.0 + inflate)
    } else {
        (4.0 - inflate, 4.0 + width + inflate)
    };
    let part = if right { RIGHT_ARM } else { LEFT_ARM };
    let (front, back, side, other, top, y, top_y) = match (right, layer) {
        (true, Layer::Outer) => (44, 52, 40, 48, 44, 32, 28),
        (false, Layer::Outer) => (52, 60, 48, 56, 52, 48, 44),
        (true, Layer::Inner) => (44, 52, 40, 48, 44, 20, 16),
        (false, Layer::Inner) => (36, 44, 32, 40, 36, 52, 48),
    };
    cuboid(
        x0,
        x1,
        8.0 - inflate,
        20.0 + inflate,
        -2.0 - inflate,
        2.0 + inflate,
        [
            Uv::new(front, y, width as u32, 12),
            Uv::new(back, y, width as u32, 12),
            Uv::new(side, y, 4, 12),
            Uv::new(other, y, 4, 12),
            Uv::new(top, top_y, width as u32, 4),
            Uv::new(top + width as u32, top_y, width as u32, 4),
        ],
        layer,
        part,
    )
}

fn leg(right: bool, layer: Layer) -> Vec<Face> {
    let inflate = if layer == Layer::Outer { 0.5 } else { 0.0 };
    let (x0, x1) = if right {
        (-4.0 - inflate, inflate)
    } else {
        (-inflate, 4.0 + inflate)
    };
    let part = if right { RIGHT_LEG } else { LEFT_LEG };
    let (x, y, top, top_y) = match (right, layer) {
        (true, Layer::Inner) => (0, 20, 4, 16),
        (false, Layer::Inner) => (16, 20, 20, 16),
        (true, Layer::Outer) => (0, 32, 4, 28),
        (false, Layer::Outer) => (0, 48, 4, 44),
    };
    cuboid(
        x0,
        x1,
        20.0 - inflate,
        32.0,
        -2.0 - inflate,
        2.0 + inflate,
        [
            Uv::new(x + 4, y, 4, 12),
            Uv::new(x + 12, y, 4, 12),
            Uv::new(x, y, 4, 12),
            Uv::new(x + 8, y, 4, 12),
            Uv::new(top, top_y, 4, 4),
            Uv::new(top + 4, top_y, 4, 4),
        ],
        layer,
        part,
    )
}

fn cape_part() -> Vec<Face> {
    let mut faces = cuboid(
        -5.0,
        5.0,
        8.0,
        24.0,
        -3.0,
        -2.4,
        [
            Uv::new(1, 1, 10, 16),
            Uv::new(1, 1, 10, 16),
            Uv::new(0, 1, 1, 16),
            Uv::new(11, 1, 1, 16),
            Uv::new(1, 0, 10, 1),
            Uv::new(1, 17, 10, 1),
        ],
        Layer::Inner,
        CAPE,
    );
    for item in faces.iter_mut() {
        item.cape = true;
    }
    faces
}

pub struct Model {
    faces: Vec<Face>,
}

pub fn build_model(slim: bool, cape: bool, outer: bool, hidden: &[u8]) -> Model {
    let mut faces = Vec::new();
    let show = |part: u8| !hidden.contains(&part);
    if show(HEAD) {
        faces.extend(head(Layer::Inner));
        if outer {
            faces.extend(head(Layer::Outer));
        }
    }
    if show(BODY) {
        faces.extend(body(Layer::Inner));
        if outer {
            faces.extend(body(Layer::Outer));
        }
    }
    if show(RIGHT_ARM) {
        faces.extend(arm(true, slim, Layer::Inner));
        if outer {
            faces.extend(arm(true, slim, Layer::Outer));
        }
    }
    if show(LEFT_ARM) {
        faces.extend(arm(false, slim, Layer::Inner));
        if outer {
            faces.extend(arm(false, slim, Layer::Outer));
        }
    }
    if show(RIGHT_LEG) {
        faces.extend(leg(true, Layer::Inner));
        if outer {
            faces.extend(leg(true, Layer::Outer));
        }
    }
    if show(LEFT_LEG) {
        faces.extend(leg(false, Layer::Inner));
        if outer {
            faces.extend(leg(false, Layer::Outer));
        }
    }
    if cape && show(CAPE) {
        faces.extend(cape_part());
    }
    Model { faces }
}

fn sample(skin: &RgbaImage, x: f32, y: f32) -> [f32; 4] {
    let width = skin.width() as i64;
    let height = skin.height() as i64;
    let px = x.floor() as i64;
    let py = y.floor() as i64;
    if px < 0 || py < 0 || px >= width || py >= height {
        return [0.0, 0.0, 0.0, 0.0];
    }
    let pixel = skin.get_pixel(px as u32, py as u32);
    [
        pixel[0] as f32 / 255.0,
        pixel[1] as f32 / 255.0,
        pixel[2] as f32 / 255.0,
        pixel[3] as f32 / 255.0,
    ]
}

fn blend(target: &mut [f32; 4], source: [f32; 4], shade: f32) {
    let alpha = source[3];
    if alpha <= 0.01 {
        return;
    }
    let out_alpha = alpha + target[3] * (1.0 - alpha);
    if out_alpha <= 0.001 {
        return;
    }
    for channel in 0..3 {
        let src = source[channel] * shade;
        let dst = target[channel];
        target[channel] = (src * alpha + dst * target[3] * (1.0 - alpha)) / out_alpha;
    }
    target[3] = out_alpha;
}

pub fn render_model(
    model: &Model,
    skin: &RgbaImage,
    cape_image: Option<&RgbaImage>,
    camera: Camera,
    width: u32,
    height: u32,
) -> RgbaImage {
    let mut image = RgbaImage::new(width, height);
    let mut depth = vec![f32::NEG_INFINITY; (width * height) as usize];
    for face in &model.faces {
        let screen: Vec<(f32, f32, f32)> = face
            .points
            .iter()
            .map(|point| camera.project(*point))
            .collect();
        let min_x = screen
            .iter()
            .map(|p| p.0)
            .fold(f32::INFINITY, f32::min)
            .floor()
            .max(0.0) as i32;
        let max_x = screen
            .iter()
            .map(|p| p.0)
            .fold(f32::NEG_INFINITY, f32::max)
            .ceil()
            .min(width as f32 - 1.0) as i32;
        let min_y = screen
            .iter()
            .map(|p| p.1)
            .fold(f32::INFINITY, f32::min)
            .floor()
            .max(0.0) as i32;
        let max_y = screen
            .iter()
            .map(|p| p.1)
            .fold(f32::NEG_INFINITY, f32::max)
            .ceil()
            .min(height as f32 - 1.0) as i32;
        if min_x > max_x || min_y > max_y {
            continue;
        }
        let source = if face.cape {
            cape_image.unwrap_or(skin)
        } else {
            skin
        };
        let triangles = [(0usize, 1usize, 2usize), (0, 2, 3)];
        for (a, b, c) in triangles {
            let (ax, ay, az) = screen[a];
            let (bx, by, bz) = screen[b];
            let (cx, cy, cz) = screen[c];
            let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
            if area.abs() < 0.0001 {
                continue;
            }
            for py in min_y..=max_y {
                for px in min_x..=max_x {
                    let sx = px as f32 + 0.5;
                    let sy = py as f32 + 0.5;
                    let w0 = ((bx - sx) * (cy - sy) - (by - sy) * (cx - sx)) / area;
                    let w1 = ((cx - sx) * (ay - sy) - (cy - sy) * (ax - sx)) / area;
                    let w2 = 1.0 - w0 - w1;
                    if w0 < -0.002 || w1 < -0.002 || w2 < -0.002 {
                        continue;
                    }
                    let z = w0 * az + w1 * bz + w2 * cz;
                    let index = (py * width as i32 + px) as usize;
                    if z <= depth[index] {
                        continue;
                    }
                    let u = w0 * face.uv[a].2 + w1 * face.uv[b].2 + w2 * face.uv[c].2;
                    let v = w0 * face.uv[a].3 + w1 * face.uv[b].3 + w2 * face.uv[c].3;
                    let texel = sample(source, u, v);
                    if texel[3] <= 0.01 {
                        continue;
                    }
                    depth[index] = z;
                    let target = image.get_pixel_mut(px as u32, py as u32);
                    let mut final_color = [
                        target[0] as f32 / 255.0,
                        target[1] as f32 / 255.0,
                        target[2] as f32 / 255.0,
                        target[3] as f32 / 255.0,
                    ];
                    blend(&mut final_color, texel, face.shade);
                    target[0] = (final_color[0].clamp(0.0, 1.0) * 255.0) as u8;
                    target[1] = (final_color[1].clamp(0.0, 1.0) * 255.0) as u8;
                    target[2] = (final_color[2].clamp(0.0, 1.0) * 255.0) as u8;
                    target[3] = (final_color[3].clamp(0.0, 1.0) * 255.0) as u8;
                }
            }
        }
    }
    image
}

pub fn render(
    skin: &RgbaImage,
    cape: Option<&RgbaImage>,
    model: &str,
    angle: f32,
    width: u32,
    height: u32,
) -> RgbaImage {
    let scene = build_model(model == "slim", cape.is_some(), true, &[]);
    let camera = Camera::new(angle, 0.12, width, height);
    render_model(&scene, skin, cape, camera, width, height)
}

#[derive(Clone)]
pub struct Hit {
    pub face: usize,
    pub u: f32,
    pub v: f32,
    pub layer: Layer,
    pub part: u8,
    pub cape: bool,
    pub region: (u32, u32, u32, u32),
}

pub fn pick(model: &Model, camera: Camera, point_x: f32, point_y: f32) -> Option<Hit> {
    let mut best: Option<(f32, Hit)> = None;
    for (index, face) in model.faces.iter().enumerate() {
        let screen: Vec<(f32, f32, f32)> = face
            .points
            .iter()
            .map(|point| camera.project(*point))
            .collect();
        let triangles = [(0usize, 1usize, 2usize), (0, 2, 3)];
        for (a, b, c) in triangles {
            let (ax, ay, az) = screen[a];
            let (bx, by, bz) = screen[b];
            let (cx, cy, cz) = screen[c];
            let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
            if area.abs() < 0.0001 {
                continue;
            }
            let w0 = ((bx - point_x) * (cy - point_y) - (by - point_y) * (cx - point_x)) / area;
            let w1 = ((cx - point_x) * (ay - point_y) - (cy - point_y) * (ax - point_x)) / area;
            let w2 = 1.0 - w0 - w1;
            if w0 < -0.01 || w1 < -0.01 || w2 < -0.01 {
                continue;
            }
            let z = w0 * az + w1 * bz + w2 * cz;
            if best.as_ref().map(|(depth, _)| z > *depth).unwrap_or(true) {
                let u = w0 * face.uv[a].2 + w1 * face.uv[b].2 + w2 * face.uv[c].2;
                let v = w0 * face.uv[a].3 + w1 * face.uv[b].3 + w2 * face.uv[c].3;
                let mut min_u = f32::MAX;
                let mut max_u = f32::MIN;
                let mut min_v = f32::MAX;
                let mut max_v = f32::MIN;
                for corner in face.uv {
                    min_u = min_u.min(corner.2);
                    max_u = max_u.max(corner.2);
                    min_v = min_v.min(corner.3);
                    max_v = max_v.max(corner.3);
                }
                best = Some((
                    z,
                    Hit {
                        face: index,
                        u,
                        v,
                        layer: face.layer,
                        part: face.part,
                        cape: face.cape,
                        region: (
                            min_u.round() as u32,
                            min_v.round() as u32,
                            (max_u - min_u).round() as u32,
                            (max_v - min_v).round() as u32,
                        ),
                    },
                ));
            }
        }
    }
    best.map(|(_, hit)| hit)
}
