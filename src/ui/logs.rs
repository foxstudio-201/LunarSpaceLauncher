use crate::ui::theme::{MONO, Theme};
use gpui::{AnyElement, FontWeight, HighlightStyle, IntoElement, StyledText, TextStyle, div, prelude::*, px};

pub struct Piece {
    pub text: String,
    pub color: gpui::Rgba,
    pub bold: bool,
}

pub fn logger_color(theme: &Theme) -> gpui::Rgba {
    if theme.dark {
        gpui::rgb(0x7d8796)
    } else {
        gpui::rgb(0x55606f)
    }
}

pub fn parse(clean: &str) -> Option<(String, String, String, String, String)> {
    static RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
        regex::Regex::new(r"^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]:?\s?(.*)$").unwrap()
    });
    let caps = RE.captures(clean)?;
    let stamp = caps.get(1)?.as_str().to_string();
    let thread_level = caps.get(2)?.as_str();
    let logger = caps.get(3)?.as_str().to_string();
    let message = caps.get(4).map(|m| m.as_str()).unwrap_or("").to_string();
    let (thread, level) = thread_level.rsplit_once('/').unwrap_or(("", thread_level));
    Some((stamp, thread.to_string(), level.to_string(), logger, message))
}

pub fn level_of(clean: &str) -> &'static str {
    if let Some((_, _, level, _, _)) = parse(clean) {
        let level = level.to_uppercase();
        if level.starts_with("ERROR") || level == "FATAL" {
            "ERROR"
        } else if level.starts_with("WARN") {
            "WARN"
        } else if level == "DEBUG" || level == "TRACE" {
            "DEBUG"
        } else {
            "INFO"
        }
    } else {
        let lower = clean.to_lowercase();
        if lower.contains("error") || lower.contains("exception") || lower.contains("fatal") {
            "ERROR"
        } else if lower.contains("warn") {
            "WARN"
        } else {
            "INFO"
        }
    }
}

pub fn color(clean: &str, theme: &Theme) -> gpui::Rgba {
    let text = clean.to_lowercase();
    if text.contains("error") || text.contains("exception") || text.contains("fatal") {
        theme.bad
    } else if text.contains("warn") {
        theme.warn
    } else if text.contains("[xyolauncher]") || text.contains("[lunarspace]") {
        theme.accent_soft
    } else if text.contains("done (") || text.contains("server started") {
        theme.ok
    } else if text.contains("starting") || text.contains("loading") || text.contains("connecting") {
        theme.info
    } else if text.contains("<") && text.contains(">") && text.contains("chat") {
        theme.ok
    } else {
        theme.muted
    }
}

pub fn pieces(clean: &str, theme: &Theme) -> Vec<Piece> {
    if let Some((stamp, thread, level, logger, message)) = parse(clean) {
        let upper = level.to_uppercase();
        let (level_color, bold) = match upper.as_str() {
            "ERROR" | "FATAL" => (theme.bad, true),
            "WARN" | "WARNING" => (theme.warn, true),
            "DEBUG" | "TRACE" => (theme.faint, false),
            _ => (theme.ok, false),
        };
        let message_color = if bold { level_color } else { theme.text };
        vec![
            Piece { text: format!("[{stamp}] "), color: theme.faint, bold: false },
            Piece { text: format!("{thread}/"), color: theme.faint, bold: false },
            Piece { text: level, color: level_color, bold },
            Piece { text: "] ".into(), color: theme.faint, bold: false },
            Piece { text: format!("{logger} "), color: logger_color(theme), bold: false },
            Piece { text: message, color: message_color, bold: false },
        ]
    } else {
        vec![Piece { text: clean.to_string(), color: color(clean, theme), bold: false }]
    }
}

pub fn styled(lines: &[String], search: &str, font: f32, theme: &Theme) -> Option<AnyElement> {
    if lines.is_empty() {
        return None;
    }
    let search = search.trim().to_lowercase();
    let mut text = String::new();
    let mut runs: Vec<(std::ops::Range<usize>, HighlightStyle)> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let clean = crate::util::strip_minecraft_codes(&crate::util::strip_ansi(line));
        if index > 0 {
            text.push('\n');
        }
        let base = text.len();
        let line_pieces = pieces(&clean, theme);
        let mut line_text = String::new();
        let mut spans = Vec::new();
        for piece in &line_pieces {
            let start = line_text.len();
            line_text.push_str(&piece.text);
            spans.push((start, line_text.len(), piece));
        }
        let lowered = line_text.to_lowercase();
        let matches: Vec<(usize, usize)> = if !search.is_empty() && lowered.len() == line_text.len() {
            lowered
                .match_indices(&search)
                .map(|(start, hit)| (start, start + hit.len()))
                .collect()
        } else {
            Vec::new()
        };
        for (start, end, piece) in spans {
            let mut bounds = vec![start, end];
            for (match_start, match_end) in &matches {
                if *match_end <= start || *match_start >= end {
                    continue;
                }
                bounds.push((*match_start).clamp(start, end));
                bounds.push((*match_end).clamp(start, end));
            }
            bounds.sort_unstable();
            bounds.dedup();
            for pair in bounds.windows(2) {
                let (from, to) = (pair[0], pair[1]);
                if from >= to {
                    continue;
                }
                let hit = matches
                    .iter()
                    .any(|(match_start, match_end)| from >= *match_start && to <= *match_end);
                runs.push((
                    base + from..base + to,
                    HighlightStyle {
                        color: Some(piece.color.into()),
                        font_weight: if piece.bold { Some(FontWeight::BOLD) } else { None },
                        background_color: if hit { Some(gpui::rgba(0xE9B87240).into()) } else { None },
                        ..Default::default()
                    },
                ));
            }
        }
        text.push_str(&line_text);
    }
    let mut style = TextStyle::default();
    style.color = theme.text.into();
    style.font_family = MONO.into();
    style.font_size = px(font).into();
    style.line_height = px(font * 1.45).into();
    Some(
        div()
            .w_full()
            .p(px(10.0))
            .child(StyledText::new(text).with_default_highlights(&style, runs))
            .into_any_element(),
    )
}
