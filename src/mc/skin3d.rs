use image::RgbaImage;

pub const HEAD: u8 = 0;
pub const BODY: u8 = 1;
pub const RIGHT_ARM: u8 = 2;
pub const LEFT_ARM: u8 = 3;
pub const RIGHT_LEG: u8 = 4;
pub const LEFT_LEG: u8 = 5;
pub const CAPE: u8 = 6;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Layer {
    Inner,
    Outer,
    Cape,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PickMode {
    Skin,
    Cape,
}

#[derive(Clone, Copy)]
pub struct Camera {
    pub yaw: f32,
    pub pitch: f32,
    pub distance: f32,
    pub focal: f32,
    pub cx: f32,
    pub cy: f32,
}

impl Camera {
    pub fn new(yaw: f32, pitch: f32, width: u32, height: u32) -> Self {
        Self {
            yaw,
            pitch,
            distance: 82.0 / 1.05,
            focal: (height as f32 * 0.5) / (35.0f32.to_radians() * 0.5).tan(),
            cx: width as f32 * 0.5,
            cy: height as f32 * 0.5,
        }
    }

    pub fn zoomed(mut self, zoom: f32) -> Self {
        self.distance = 82.0 / zoom.clamp(0.2, 8.0);
        self
    }

    pub fn panned(mut self, x: f32, y: f32) -> Self {
        self.cx += x;
        self.cy += y;
        self
    }

    pub fn project(&self, point: (f32, f32, f32)) -> (f32, f32, f32) {
        let (sin_y, cos_y) = self.yaw.sin_cos();
        let (sin_p, cos_p) = self.pitch.sin_cos();
        let y1 = point.1 * cos_p - point.2 * sin_p;
        let z1 = point.1 * sin_p + point.2 * cos_p;
        let x2 = point.0 * cos_y + z1 * sin_y;
        let z2 = -point.0 * sin_y + z1 * cos_y;
        let depth = (self.distance - z2).max(0.1);
        let scale = self.focal / depth;
        (self.cx + x2 * scale, self.cy - y1 * scale, 1.0 / depth)
    }
}

#[derive(Clone)]
struct Face {
    points: [(f32, f32, f32); 4],
    uv: [(f32, f32); 4],
    rect: (u32, u32, u32, u32),
    layer: Layer,
    part: u8,
    cape: bool,
}

struct BoxSpec {
    width: f32,
    height: f32,
    depth: f32,
    uv_width: f32,
    uv_height: f32,
    uv_depth: f32,
    u: f32,
    v: f32,
    x: f32,
    y: f32,
    z: f32,
    layer: Layer,
    part: u8,
    cape: bool,
}

fn push_box(faces: &mut Vec<Face>, spec: &BoxSpec) {
    let hw = spec.width * 0.5;
    let hh = spec.height * 0.5;
    let hd = spec.depth * 0.5;
    let (x, y, z) = (spec.x, spec.y, spec.z);
    let (u, v) = (spec.u, spec.v);
    let (uw, uh, ud) = (spec.uv_width, spec.uv_height, spec.uv_depth);
    let rects = [
        (u + uw + ud, v + ud, u + uw + 2.0 * ud, v + ud + uh),
        (u, v + ud, u + ud, v + ud + uh),
        (u + ud, v, u + uw + ud, v + ud),
        (u + uw + ud, v, u + 2.0 * uw + ud, v + ud),
        (u + ud, v + ud, u + uw + ud, v + ud + uh),
        (u + uw + 2.0 * ud, v + ud, u + 2.0 * uw + 2.0 * ud, v + ud + uh),
    ];
    let quads: [[(f32, f32, f32); 4]; 6] = [
        [
            (x + hw, y + hh, z + hd),
            (x + hw, y + hh, z - hd),
            (x + hw, y - hh, z - hd),
            (x + hw, y - hh, z + hd),
        ],
        [
            (x - hw, y + hh, z - hd),
            (x - hw, y + hh, z + hd),
            (x - hw, y - hh, z + hd),
            (x - hw, y - hh, z - hd),
        ],
        [
            (x - hw, y + hh, z - hd),
            (x + hw, y + hh, z - hd),
            (x + hw, y + hh, z + hd),
            (x - hw, y + hh, z + hd),
        ],
        [
            (x - hw, y - hh, z + hd),
            (x + hw, y - hh, z + hd),
            (x + hw, y - hh, z - hd),
            (x - hw, y - hh, z - hd),
        ],
        [
            (x - hw, y + hh, z + hd),
            (x + hw, y + hh, z + hd),
            (x + hw, y - hh, z + hd),
            (x - hw, y - hh, z + hd),
        ],
        [
            (x + hw, y + hh, z - hd),
            (x - hw, y + hh, z - hd),
            (x - hw, y - hh, z - hd),
            (x + hw, y - hh, z - hd),
        ],
    ];
    for (index, quad) in quads.into_iter().enumerate() {
        let (x1, y1, x2, y2) = rects[index];
        faces.push(Face {
            points: quad,
            uv: [(x1, y1), (x2, y1), (x2, y2), (x1, y2)],
            rect: (
                x1.round() as u32,
                y1.round() as u32,
                (x2 - x1).round() as u32,
                (y2 - y1).round() as u32,
            ),
            layer: spec.layer,
            part: spec.part,
            cape: spec.cape,
        });
    }
}

pub struct Model {
    faces: Vec<Face>,
    cape_solo: bool,
}

fn cape_transform(point: (f32, f32, f32)) -> (f32, f32, f32) {
    let (sin_y, cos_y) = std::f32::consts::PI.sin_cos();
    let x1 = point.0 * cos_y + point.2 * sin_y;
    let z1 = -point.0 * sin_y + point.2 * cos_y;
    let (sin_p, cos_p) = 10.8f32.to_radians().sin_cos();
    let y2 = point.1 * cos_p - z1 * sin_p;
    let z2 = point.1 * sin_p + z1 * cos_p;
    (x1, y2 + 8.0, z2 - 2.0)
}

pub fn build_model(slim: bool, cape: bool, outer: bool, hidden: &[u8]) -> Model {
    build_model_ex(slim, cape, outer, hidden, false)
}

pub fn build_model_ex(slim: bool, cape: bool, outer: bool, hidden: &[u8], cape_only: bool) -> Model {
    let mut faces = Vec::new();
    let show = |part: u8| !hidden.contains(&part);
    let arm_width = if slim { 3.0 } else { 4.0 };
    let arm_x = if slim { 5.65 } else { 6.15 };
    if cape_only {
        if show(CAPE) {
            push_box(
                &mut faces,
                &BoxSpec {
                    width: 21.0,
                    height: 33.6,
                    depth: 2.1,
                    uv_width: 10.0,
                    uv_height: 16.0,
                    uv_depth: 1.0,
                    u: 0.0,
                    v: 0.0,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                    layer: Layer::Cape,
                    part: CAPE,
                    cape: true,
                },
            );
        }
        return Model {
            faces,
            cape_solo: true,
        };
    }
    let inner = [
        (8.0, 8.0, 8.0, 8.0, 8.0, 8.0, 0.0, 0.0, 0.0, 12.0, 0.0, HEAD),
        (8.0, 12.0, 4.0, 8.0, 12.0, 4.0, 16.0, 16.0, 0.0, 2.0, 0.0, BODY),
        (
            arm_width, 12.0, 4.0, arm_width, 12.0, 4.0, 40.0, 16.0, -arm_x, 2.0, 0.0, RIGHT_ARM,
        ),
        (
            arm_width, 12.0, 4.0, arm_width, 12.0, 4.0, 32.0, 48.0, arm_x, 2.0, 0.0, LEFT_ARM,
        ),
        (4.0, 12.0, 4.0, 4.0, 12.0, 4.0, 0.0, 16.0, -2.075, -10.0, -0.1, RIGHT_LEG),
        (4.0, 12.0, 4.0, 4.0, 12.0, 4.0, 16.0, 48.0, 2.075, -10.0, -0.1, LEFT_LEG),
    ];
    for (w, h, d, uw, uh, ud, u, v, x, y, z, part) in inner {
        if !show(part) {
            continue;
        }
        push_box(
            &mut faces,
            &BoxSpec {
                width: w,
                height: h,
                depth: d,
                uv_width: uw,
                uv_height: uh,
                uv_depth: ud,
                u,
                v,
                x,
                y,
                z,
                layer: Layer::Inner,
                part,
                cape: false,
            },
        );
    }
    if outer {
        let shell = [
            (9.0, 9.0, 9.0, 8.0, 8.0, 8.0, 32.0, 0.0, 0.0, 12.0, 0.0, HEAD),
            (8.5, 12.5, 4.5, 8.0, 12.0, 4.0, 16.0, 32.0, 0.0, 2.0, 0.0, BODY),
            (
                arm_width + 0.5,
                12.5,
                4.5,
                arm_width,
                12.0,
                4.0,
                40.0,
                32.0,
                -arm_x,
                2.0,
                0.0,
                RIGHT_ARM,
            ),
            (
                arm_width + 0.5,
                12.5,
                4.5,
                arm_width,
                12.0,
                4.0,
                48.0,
                48.0,
                arm_x,
                2.0,
                0.0,
                LEFT_ARM,
            ),
            (4.5, 12.5, 4.5, 4.0, 12.0, 4.0, 0.0, 32.0, -2.075, -10.0, -0.1, RIGHT_LEG),
            (4.5, 12.5, 4.5, 4.0, 12.0, 4.0, 0.0, 48.0, 2.075, -10.0, -0.1, LEFT_LEG),
        ];
        for (w, h, d, uw, uh, ud, u, v, x, y, z, part) in shell {
            if !show(part) {
                continue;
            }
            push_box(
                &mut faces,
                &BoxSpec {
                    width: w,
                    height: h,
                    depth: d,
                    uv_width: uw,
                    uv_height: uh,
                    uv_depth: ud,
                    u,
                    v,
                    x,
                    y,
                    z,
                    layer: Layer::Outer,
                    part,
                    cape: false,
                },
            );
        }
    }
    if cape && show(CAPE) {
        let mut cape_faces = Vec::new();
        push_box(
            &mut cape_faces,
            &BoxSpec {
                width: 10.0,
                height: 16.0,
                depth: 1.0,
                uv_width: 10.0,
                uv_height: 16.0,
                uv_depth: 1.0,
                u: 0.0,
                v: 0.0,
                x: 0.0,
                y: -8.0,
                z: 0.5,
                layer: Layer::Cape,
                part: CAPE,
                cape: true,
            },
        );
        for face in cape_faces.iter_mut() {
            for point in face.points.iter_mut() {
                *point = cape_transform(*point);
            }
        }
        faces.extend(cape_faces);
    }
    Model {
        faces,
        cape_solo: false,
    }
}

pub fn build_model_mirrored(
    slim: bool,
    cape: bool,
    outer: bool,
    hidden: &[u8],
    cape_only: bool,
    axis: u8,
) -> Model {
    let mut model = build_model_ex(slim, cape, outer, hidden, cape_only);
    for face in model.faces.iter_mut() {
        for point in face.points.iter_mut() {
            match axis {
                0 => point.0 = -point.0,
                1 => point.1 = -point.1,
                _ => point.2 = -point.2,
            }
        }
    }
    model
}

fn sample(image: &RgbaImage, x: f32, y: f32) -> [f32; 4] {
    let px = x.floor() as i64;
    let py = y.floor() as i64;
    if px < 0 || py < 0 || px >= image.width() as i64 || py >= image.height() as i64 {
        return [0.0, 0.0, 0.0, 0.0];
    }
    let pixel = image.get_pixel(px as u32, py as u32);
    [
        pixel[0] as f32 / 255.0,
        pixel[1] as f32 / 255.0,
        pixel[2] as f32 / 255.0,
        pixel[3] as f32 / 255.0,
    ]
}

fn blend(target: &mut [f32; 4], source: [f32; 4]) {
    let alpha = source[3];
    if alpha <= 0.004 {
        return;
    }
    let out_alpha = alpha + target[3] * (1.0 - alpha);
    if out_alpha <= 0.001 {
        return;
    }
    for channel in 0..3 {
        let src = source[channel];
        let dst = target[channel];
        target[channel] = (src * alpha + dst * target[3] * (1.0 - alpha)) / out_alpha;
    }
    target[3] = out_alpha;
}

fn edge(ax: f32, ay: f32, bx: f32, by: f32, px: f32, py: f32) -> f32 {
    (bx - ax) * (py - ay) - (by - ay) * (px - ax)
}

fn raster_bounds(
    screen: &[(f32, f32, f32); 4],
    width: u32,
    height: u32,
) -> Option<(i32, i32, i32, i32)> {
    let mut min_x = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    for point in screen {
        min_x = min_x.min(point.0);
        max_x = max_x.max(point.0);
        min_y = min_y.min(point.1);
        max_y = max_y.max(point.1);
    }
    let min_x = (min_x.floor().max(0.0) as i32).min(width as i32 - 1);
    let max_x = (max_x.ceil().min(width as f32 - 1.0) as i32).max(0);
    let min_y = (min_y.floor().max(0.0) as i32).min(height as i32 - 1);
    let max_y = (max_y.ceil().min(height as f32 - 1.0) as i32).max(0);
    if min_x > max_x || min_y > max_y {
        return None;
    }
    Some((min_x, max_x, min_y, max_y))
}

const TRIANGLES: [(usize, usize, usize); 2] = [(0, 1, 2), (0, 2, 3)];

fn base_mask(model: &Model, camera: &Camera, width: u32, height: u32) -> Vec<bool> {
    let mut mask = vec![false; (width * height) as usize];
    for face in &model.faces {
        let is_base = face.layer == Layer::Inner || (model.cape_solo && face.cape);
        if !is_base {
            continue;
        }
        let screen = [
            camera.project(face.points[0]),
            camera.project(face.points[1]),
            camera.project(face.points[2]),
            camera.project(face.points[3]),
        ];
        let Some((min_x, max_x, min_y, max_y)) = raster_bounds(&screen, width, height) else {
            continue;
        };
        for (a, b, c) in TRIANGLES {
            let (ax, ay, _) = screen[a];
            let (bx, by, _) = screen[b];
            let (cx, cy, _) = screen[c];
            let area = edge(ax, ay, bx, by, cx, cy);
            if area.abs() < 0.0001 {
                continue;
            }
            for py in min_y..=max_y {
                for px in min_x..=max_x {
                    let sx = px as f32 + 0.5;
                    let sy = py as f32 + 0.5;
                    let w0 = edge(bx, by, cx, cy, sx, sy) / area;
                    let w1 = edge(cx, cy, ax, ay, sx, sy) / area;
                    let w2 = 1.0 - w0 - w1;
                    if w0 < -0.01 || w1 < -0.01 || w2 < -0.01 {
                        continue;
                    }
                    mask[(py * width as i32 + px) as usize] = true;
                }
            }
        }
    }
    mask
}

pub fn render_model(
    model: &Model,
    skin: &RgbaImage,
    cape_image: Option<&RgbaImage>,
    camera: Camera,
    width: u32,
    height: u32,
    grid: bool,
) -> RgbaImage {
    let mut image = RgbaImage::new(width, height);
    let mask = base_mask(model, &camera, width, height);
    for (index, covered) in mask.iter().enumerate() {
        if *covered {
            image.put_pixel(
                (index as u32) % width,
                (index as u32) / width,
                image::Rgba([59, 65, 75, 89]),
            );
        }
    }
    let mut depth = vec![f32::NEG_INFINITY; (width * height) as usize];
    for face in &model.faces {
        let source = if face.cape {
            match cape_image {
                Some(cape) => cape,
                None => continue,
            }
        } else {
            skin
        };
        let screen = [
            camera.project(face.points[0]),
            camera.project(face.points[1]),
            camera.project(face.points[2]),
            camera.project(face.points[3]),
        ];
        let Some((min_x, max_x, min_y, max_y)) = raster_bounds(&screen, width, height) else {
            continue;
        };
        for (a, b, c) in TRIANGLES {
            let (ax, ay, az) = screen[a];
            let (bx, by, bz) = screen[b];
            let (cx, cy, cz) = screen[c];
            let area = edge(ax, ay, bx, by, cx, cy);
            if area.abs() < 0.0001 {
                continue;
            }
            for py in min_y..=max_y {
                for px in min_x..=max_x {
                    let sx = px as f32 + 0.5;
                    let sy = py as f32 + 0.5;
                    let w0 = edge(bx, by, cx, cy, sx, sy) / area;
                    let w1 = edge(cx, cy, ax, ay, sx, sy) / area;
                    let w2 = 1.0 - w0 - w1;
                    if w0 < -0.002 || w1 < -0.002 || w2 < -0.002 {
                        continue;
                    }
                    let z = w0 * az + w1 * bz + w2 * cz;
                    let index = (py * width as i32 + px) as usize;
                    if z <= depth[index] {
                        continue;
                    }
                    let u = w0 * face.uv[a].0 + w1 * face.uv[b].0 + w2 * face.uv[c].0;
                    let v = w0 * face.uv[a].1 + w1 * face.uv[b].1 + w2 * face.uv[c].1;
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
                    blend(&mut final_color, texel);
                    target[0] = (final_color[0].clamp(0.0, 1.0) * 255.0) as u8;
                    target[1] = (final_color[1].clamp(0.0, 1.0) * 255.0) as u8;
                    target[2] = (final_color[2].clamp(0.0, 1.0) * 255.0) as u8;
                    target[3] = (final_color[3].clamp(0.0, 1.0) * 255.0) as u8;
                }
            }
        }
    }
    if grid {
        draw_grid(model, &camera, &mut image, &depth);
    }
    image
}

fn draw_grid(model: &Model, camera: &Camera, image: &mut RgbaImage, depth: &[f32]) {
    let (width, height) = image.dimensions();
    for face in &model.faces {
        let screen = [
            camera.project(face.points[0]),
            camera.project(face.points[1]),
            camera.project(face.points[2]),
            camera.project(face.points[3]),
        ];
        let area = edge(screen[0].0, screen[0].1, screen[1].0, screen[1].1, screen[2].0, screen[2].1)
            + edge(screen[0].0, screen[0].1, screen[2].0, screen[2].1, screen[3].0, screen[3].1);
        if area <= 0.0 {
            continue;
        }
        let (uw, uh, _, _) = face.rect;
        if uw == 0 || uh == 0 {
            continue;
        }
        let point = |u: f32, v: f32| -> (f32, f32) {
            let top_x = screen[0].0 + (screen[1].0 - screen[0].0) * u;
            let top_y = screen[0].1 + (screen[1].1 - screen[0].1) * u;
            let bottom_x = screen[3].0 + (screen[2].0 - screen[3].0) * u;
            let bottom_y = screen[3].1 + (screen[2].1 - screen[3].1) * u;
            (top_x + (bottom_x - top_x) * v, top_y + (bottom_y - top_y) * v)
        };
        let dx1 = screen[1].0 - screen[0].0;
        let dy1 = screen[1].1 - screen[0].1;
        let dz1 = screen[1].2 - screen[0].2;
        let dx2 = screen[3].0 - screen[0].0;
        let dy2 = screen[3].1 - screen[0].1;
        let dz2 = screen[3].2 - screen[0].2;
        let det = dx1 * dy2 - dx2 * dy1;
        if det.abs() < 1e-5 {
            continue;
        }
        let za = (dz1 * dy2 - dz2 * dy1) / det;
        let zb = (dz2 * dx1 - dz1 * dx2) / det;
        let z_at = |x: f32, y: f32| screen[0].2 + za * (x - screen[0].0) + zb * (y - screen[0].1);
        for i in 0..=uw {
            let u = i as f32 / uw as f32;
            let (x1, y1) = point(u, 0.0);
            let (x2, y2) = point(u, 1.0);
            draw_line(image, width, height, x1, y1, x2, y2, &z_at, depth);
        }
        for j in 0..=uh {
            let v = j as f32 / uh as f32;
            let (x1, y1) = point(0.0, v);
            let (x2, y2) = point(1.0, v);
            draw_line(image, width, height, x1, y1, x2, y2, &z_at, depth);
        }
    }
}

fn draw_line(
    image: &mut RgbaImage,
    width: u32,
    height: u32,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    z_at: &impl Fn(f32, f32) -> f32,
    depth: &[f32],
) {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let steps = dx.abs().max(dy.abs()).ceil() as u32;
    if steps == 0 {
        return;
    }
    for step in 0..=steps {
        let t = step as f32 / steps as f32;
        let x = x1 + dx * t;
        let y = y1 + dy * t;
        if x < 0.0 || y < 0.0 || x >= width as f32 || y >= height as f32 {
            continue;
        }
        let index = (y as u32 * width + x as u32) as usize;
        if z_at(x, y) + 0.0005 < depth[index] {
            continue;
        }
        let pixel = image.get_pixel_mut(x as u32, y as u32);
        let alpha = 0.75f32;
        pixel[0] = (34.0 * alpha + pixel[0] as f32 * (1.0 - alpha)) as u8;
        pixel[1] = (211.0 * alpha + pixel[1] as f32 * (1.0 - alpha)) as u8;
        pixel[2] = (238.0 * alpha + pixel[2] as f32 * (1.0 - alpha)) as u8;
        pixel[3] = 255;
    }
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
    render_model(&scene, skin, cape, camera, width, height, false)
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

pub fn pick(
    model: &Model,
    skin: &RgbaImage,
    cape_image: Option<&RgbaImage>,
    camera: &Camera,
    point_x: f32,
    point_y: f32,
    mode: PickMode,
    layer: Layer,
) -> Option<Hit> {
    let _ = skin;
    let mut candidates: Vec<(f32, Hit)> = Vec::new();
    for (index, face) in model.faces.iter().enumerate() {
        let screen = [
            camera.project(face.points[0]),
            camera.project(face.points[1]),
            camera.project(face.points[2]),
            camera.project(face.points[3]),
        ];
        for (a, b, c) in TRIANGLES {
            let (ax, ay, az) = screen[a];
            let (bx, by, bz) = screen[b];
            let (cx, cy, cz) = screen[c];
            let area = edge(ax, ay, bx, by, cx, cy);
            if area.abs() < 0.0001 {
                continue;
            }
            let w0 = edge(bx, by, cx, cy, point_x, point_y) / area;
            let w1 = edge(cx, cy, ax, ay, point_x, point_y) / area;
            let w2 = 1.0 - w0 - w1;
            if w0 < -0.01 || w1 < -0.01 || w2 < -0.01 {
                continue;
            }
            let z = w0 * az + w1 * bz + w2 * cz;
            let u = w0 * face.uv[a].0 + w1 * face.uv[b].0 + w2 * face.uv[c].0;
            let v = w0 * face.uv[a].1 + w1 * face.uv[b].1 + w2 * face.uv[c].1;
            candidates.push((
                z,
                Hit {
                    face: index,
                    u,
                    v,
                    layer: face.layer,
                    part: face.part,
                    cape: face.cape,
                    region: face.rect,
                },
            ));
        }
    }
    candidates.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    for (_, hit) in candidates {
        if mode == PickMode::Cape {
            if hit.cape {
                return Some(hit);
            }
            continue;
        }
        if hit.cape {
            if let Some(cape_image) = cape_image {
                let texel = sample(cape_image, hit.u, hit.v);
                if texel[3] > 0.05 {
                    return None;
                }
            }
            continue;
        }
        if hit.layer == layer {
            return Some(hit);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn front_pick_hits_body_front_rect() {
        let model = build_model(false, false, true, &[]);
        let camera = Camera::new(0.0, 0.0, 400, 500);
        let skin = RgbaImage::new(64, 64);
        let hit = pick(
            &model,
            &skin,
            None,
            &camera,
            200.0,
            250.0,
            PickMode::Skin,
            Layer::Inner,
        )
        .expect("hit");
        assert_eq!(hit.part, BODY);
        assert_eq!(hit.layer, Layer::Inner);
        assert_eq!(hit.region, (20, 20, 8, 12));
        let outer = pick(
            &model,
            &skin,
            None,
            &camera,
            200.0,
            250.0,
            PickMode::Skin,
            Layer::Outer,
        )
        .expect("outer hit");
        assert_eq!(outer.layer, Layer::Outer);
    }

    #[test]
    fn cape_only_model_picks_cape() {
        let model = build_model_ex(false, true, true, &[], true);
        let camera = Camera::new(0.0, 0.0, 400, 500);
        let skin = RgbaImage::new(64, 64);
        let cape = RgbaImage::from_pixel(64, 32, image::Rgba([200, 30, 40, 255]));
        let hit = pick(
            &model,
            &skin,
            Some(&cape),
            &camera,
            200.0,
            250.0,
            PickMode::Cape,
            Layer::Inner,
        )
        .expect("cape hit");
        assert!(hit.cape);
        assert_eq!(hit.region, (1, 1, 10, 16));
    }

    #[test]
    fn rotation_changes_silhouette() {
        let model = build_model(false, false, true, &[]);
        let skin = RgbaImage::from_pixel(64, 64, image::Rgba([200, 30, 40, 255]));
        let front = render_model(&model, &skin, None, Camera::new(0.0, 0.0, 200, 300), 200, 300, false);
        let side = render_model(&model, &skin, None, Camera::new(1.4, 0.0, 200, 300), 200, 300, false);
        let mut different = 0;
        for (a, b) in front.pixels().zip(side.pixels()) {
            if a.0 != b.0 {
                different += 1;
            }
        }
        assert!(different > 1000, "rotation must change the render");
    }
}
