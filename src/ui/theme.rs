use gpui::{FontWeight, Rgba, px};

#[derive(Clone, Debug)]
pub struct Theme {
    pub dark: bool,
    pub bg: Rgba,
    pub sidebar: Rgba,
    pub surface: Rgba,
    pub surface_hover: Rgba,
    pub surface_active: Rgba,
    pub elevated: Rgba,
    pub border: Rgba,
    pub border_soft: Rgba,
    pub text: Rgba,
    pub muted: Rgba,
    pub faint: Rgba,
    pub accent: Rgba,
    pub accent_hover: Rgba,
    pub accent_soft: Rgba,
    pub accent_dim: Rgba,
    pub on_accent: Rgba,
    pub ok: Rgba,
    pub warn: Rgba,
    pub bad: Rgba,
    pub info: Rgba,
    pub overlay: Rgba,
}

impl Theme {
    pub fn dark() -> Self {
        Self {
            dark: true,
            bg: gpui::rgb(0x0c0e12),
            sidebar: gpui::rgb(0x080a0d),
            surface: gpui::rgb(0x14171d),
            surface_hover: gpui::rgb(0x1a1e25),
            surface_active: gpui::rgb(0x212630),
            elevated: gpui::rgb(0x181c23),
            border: gpui::rgb(0x242a33),
            border_soft: gpui::rgb(0x1b2027),
            text: gpui::rgb(0xe8ebf1),
            muted: gpui::rgb(0x99a2b1),
            faint: gpui::rgb(0x656d7b),
            accent: gpui::rgb(0xe9b872),
            accent_hover: gpui::rgb(0xf3c98a),
            accent_soft: gpui::rgb(0xf0c991),
            accent_dim: gpui::rgb(0x2b2419),
            on_accent: gpui::rgb(0x1b1409),
            ok: gpui::rgb(0x22c55e),
            warn: gpui::rgb(0xf5b84b),
            bad: gpui::rgb(0xf87171),
            info: gpui::rgb(0x60a5fa),
            overlay: gpui::rgba(0x05070acc),
        }
    }

    pub fn light() -> Self {
        Self {
            dark: false,
            bg: gpui::rgb(0xf4f5f8),
            sidebar: gpui::rgb(0xffffff),
            surface: gpui::rgb(0xffffff),
            surface_hover: gpui::rgb(0xf1f2f6),
            surface_active: gpui::rgb(0xe9ebf1),
            elevated: gpui::rgb(0xfafbfd),
            border: gpui::rgb(0xdfe3ea),
            border_soft: gpui::rgb(0xe9ecf1),
            text: gpui::rgb(0x171a20),
            muted: gpui::rgb(0x5c6472),
            faint: gpui::rgb(0x8b93a2),
            accent: gpui::rgb(0xc07a2c),
            accent_hover: gpui::rgb(0xa9661f),
            accent_soft: gpui::rgb(0xb7791f),
            accent_dim: gpui::rgb(0xf7ebdd),
            on_accent: gpui::rgb(0xffffff),
            ok: gpui::rgb(0x16a34a),
            warn: gpui::rgb(0xb77908),
            bad: gpui::rgb(0xdc2626),
            info: gpui::rgb(0x2563eb),
            overlay: gpui::rgba(0x0a0d12aa),
        }
    }

    pub fn from_settings(theme: &str) -> Self {
        if theme == "light" {
            Self::light()
        } else {
            Self::dark()
        }
    }
}

pub const FONT: &str = "Be Vietnam Pro";
pub const MONO: &str = "JetBrains Mono";

pub const TEXT_XS: f32 = 11.0;
pub const TEXT_SM: f32 = 12.0;
pub const TEXT_BASE: f32 = 13.0;
pub const TEXT_MD: f32 = 14.0;
pub const TEXT_LG: f32 = 17.0;
pub const TEXT_XL: f32 = 22.0;
pub const TEXT_2XL: f32 = 28.0;
pub const TEXT_3XL: f32 = 34.0;

pub fn bold() -> FontWeight {
    FontWeight::BOLD
}

pub fn semibold() -> FontWeight {
    FontWeight::SEMIBOLD
}

pub fn medium() -> FontWeight {
    FontWeight::MEDIUM
}

pub fn regular() -> FontWeight {
    FontWeight::NORMAL
}

pub const RADIUS_SM: f32 = 8.0;
pub const RADIUS: f32 = 12.0;
pub const RADIUS_LG: f32 = 16.0;

pub fn sidebar_width(collapsed: bool) -> gpui::Pixels {
    px(if collapsed { 64.0 } else { 180.0 })
}
