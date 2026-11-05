use image::RgbaImage;

struct Face {
    points: [(f32, f32, f32); 4],
    uv: [(f32, f32, f32, f32); 4],
    shade: f32,
}

struct Part {
    faces: Vec<Face>,
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

fn face(
    points: [(f32, f32, f32); 4],
    uv: Uv,
    shade: f32,
    flip_u: bool,
    flip_v: bool,
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
) -> Part {
    let faces = vec![
        face(
            [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
            Uv::new(uv[0].x, uv[0].y, uv[0].w, uv[0].h),
            1.0,
            false,
            false,
        ),
        face(
            [(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)],
            Uv::new(uv[1].x, uv[1].y, uv[1].w, uv[1].h),
            0.72,
            true,
            false,
        ),
        face(
            [(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)],
            Uv::new(uv[2].x, uv[2].y, uv[2].w, uv[2].h),
            0.85,
            false,
            false,
        ),
        face(
            [(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)],
            Uv::new(uv[3].x, uv[3].y, uv[3].w, uv[3].h),
            0.7,
            true,
            false,
        ),
        face(
            [(x0, y0, z1), (x1, y0, z1), (x1, y0, z0), (x0, y0, z0)],
            Uv::new(uv[4].x, uv[4].y, uv[4].w, uv[4].h),
            0.95,
            false,
            false,
        ),
        face(
            [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)],
            Uv::new(uv[5].x, uv[5].y, uv[5].w, uv[5].h),
            0.6,
            false,
            true,
        ),
    ];
    Part { faces }
}

fn head() -> Part {
    cuboid(
        -4.0, 4.0, 0.0, 8.0, -4.0, 4.0,
        [
            Uv::new(8, 8, 8, 8),
            Uv::new(24, 8, 8, 8),
            Uv::new(0, 8, 8, 8),
            Uv::new(16, 8, 8, 8),
            Uv::new(8, 0, 8, 8),
            Uv::new(16, 0, 8, 8),
        ],
    )
}

fn body() -> Part {
    cuboid(
        -4.0, 4.0, 8.0, 20.0, -2.0, 2.0,
        [
            Uv::new(20, 20, 8, 12),
            Uv::new(32, 20, 8, 12),
            Uv::new(16, 20, 4, 12),
            Uv::new(28, 20, 4, 12),
            Uv::new(20, 16, 8, 4),
            Uv::new(28, 16, 8, 4),
        ],
    )
}

fn arm(right: bool, slim: bool) -> Part {
    let width = if slim { 3.0 } else { 4.0 };
    let (x0, x1) = if right {
        (-4.0 - width, -4.0)
    } else {
        (4.0, 4.0 + width)
    };
    let (front, back, side, top) = if right {
        (44, 52, 40, 44)
    } else {
        (36, 44, 32, 36)
    };
    let side_y = if right { 20 } else { 52 };
    let top_y = if right { 16 } else { 48 };
    cuboid(
        x0, x1, 8.0, 20.0, -2.0, 2.0,
        [
            Uv::new(front, side_y, width as u32, 12),
            Uv::new(back, side_y, width as u32, 12),
            Uv::new(side, side_y, 4, 12),
            Uv::new(side + 4 + width as u32, side_y, 4, 12),
            Uv::new(top, top_y, width as u32, 4),
            Uv::new(top + width as u32, top_y, width as u32, 4),
        ],
    )
}

fn leg(right: bool) -> Part {
    let (x0, x1) = if right { (-4.0, 0.0) } else { (0.0, 4.0) };
    let (base, top) = if right { (0, 4) } else { (16, 20) };
    cuboid(
        x0, x1, 20.0, 32.0, -2.0, 2.0,
        [
            Uv::new(base + 4, 20, 4, 12),
            Uv::new(base + 12, 20, 4, 12),
            Uv::new(base, 20, 4, 12),
            Uv::new(base + 8, 20, 4, 12),
            Uv::new(top, 16, 4, 4),
            Uv::new(top + 4, 16, 4, 4),
        ],
    )
}

fn cape_part() -> Part {
    cuboid(
        -5.0, 5.0, 8.0, 24.0, -3.0, -2.4,
        [
            Uv::new(1, 1, 10, 16),
            Uv::new(1, 1, 10, 16),
            Uv::new(0, 1, 1, 16),
            Uv::new(11, 1, 1, 16),
            Uv::new(1, 0, 10, 1),
            Uv::new(1, 17, 10, 1),
        ],
    )
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

pub fn render(
    skin: &RgbaImage,
    cape: Option<&RgbaImage>,
    model: &str,
    angle: f32,
    width: u32,
    height: u32,
) -> RgbaImage {
    let slim = model == "slim";
    let mut parts = vec![
        head(),
        body(),
        arm(true, slim),
        arm(false, slim),
        leg(true),
        leg(false),
    ];
    if cape.is_some() {
        parts.push(cape_part());
    }

    let mut image = RgbaImage::new(width, height);
    let mut depth = vec![f32::NEG_INFINITY; (width * height) as usize];
    let scale = height as f32 / 39.0;
    let cx = width as f32 / 2.0;
    let cy = height as f32 * 0.53;
    let yaw = angle.sin_cos();
    let pitch = 0.12f32;
    let pitch_cos = pitch.cos();
    let pitch_sin = pitch.sin();

    for part in &parts {
        for face in &part.faces {
            let mut screen = [(0.0f32, 0.0f32, 0.0f32); 4];
            for (index, point) in face.points.iter().enumerate() {
                let x = point.0;
                let y = point.1 - 16.0;
                let z = point.2;
                let xr = x * yaw.1 + z * yaw.0;
                let zr = -x * yaw.0 + z * yaw.1;
                let yr = y * pitch_cos - zr * pitch_sin;
                let zr2 = y * pitch_sin + zr * pitch_cos;
                screen[index] = (cx + xr * scale, cy + yr * scale, zr2);
            }
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
            let source = if cape.is_some() && std::ptr::eq(part, parts.last().unwrap()) {
                cape.unwrap_or(skin)
            } else {
                skin
            };
            let triangles = [(0usize, 1usize, 2usize), (0, 2, 3)];
            for (a, b, c) in triangles {
                let (ax, ay, az) = screen[a];
                let (bx, by, bz) = screen[b];
                let (cx3, cy3, cz) = screen[c];
                let area = (bx - ax) * (cy3 - ay) - (by - ay) * (cx3 - ax);
                if area.abs() < 0.0001 {
                    continue;
                }
                for py in min_y..=max_y {
                    for px in min_x..=max_x {
                        let sx = px as f32 + 0.5;
                        let sy = py as f32 + 0.5;
                        let w0 = ((bx - sx) * (cy3 - sy) - (by - sy) * (cx3 - sx)) / area;
                        let w1 = ((cx3 - sx) * (ay - sy) - (cy3 - sy) * (ax - sx)) / area;
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
    }
    image
}

