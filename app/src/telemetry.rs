//! SWARMUX collects and sends no usage data. This module keeps the calls the
//! window makes (`observe`, `command`, `count`...) so they compile to nothing.

use serde_json::{Value, json};

/// What the window could report; ignored.
#[derive(Default)]
#[allow(dead_code)]
pub struct Observation {
    pub foreground: bool,
    pub agents: Vec<Option<String>>,
    pub agents_working: usize,
    pub spaces: usize,
    pub tabs: usize,
    pub terminals: usize,
    pub layout: String,
    pub mods: Vec<String>,
    pub theme: String,
    pub welcome: Option<String>,
}

pub fn collecting() -> bool { false }
pub fn observe(_: Observation) {}
pub fn command(_: &'static str) {}
pub fn count(_: &'static str) {}
pub fn window_open() {}
pub fn set_setting(_: bool) {}
pub fn quit() {}
pub fn clock() {}
pub fn start(_: bool) {}

/// What the settings screen shows: nothing is collected.
pub fn status() -> Value {
    json!({ "enabled": false, "setting": false, "sends": false, "off_because": null, "endpoint": null, "draft": null, "queued": [], "last_sent": null })
}

/// A release version (`0.2.0`, `0.2.0-rc.1`), else `other`: never a free string.
pub(crate) fn version(v: &str) -> String {
    let v = v.trim().trim_start_matches("hc ").trim_start_matches('v');
    let number = |s: &str| !s.is_empty() && s.len() <= 4 && s.bytes().all(|b| b.is_ascii_digit());
    let (core, pre) = v.split_once('-').map_or((v, None), |(c, p)| (c, Some(p)));
    let parts: Vec<&str> = core.split('.').collect();
    let pre_ok = pre.is_none_or(|p| {
        let (label, n) = p.split_once('.').map_or((p, None), |(l, n)| (l, Some(n)));
        matches!(label, "alpha" | "beta" | "rc" | "preview") && n.is_none_or(number)
    });
    if parts.len() == 3 && parts.iter().all(|p| number(p)) && pre_ok { v.to_owned() } else { "other".into() }
}

#[cfg(test)]
mod tests {
    #[test]
    fn nothing_is_collected() {
        assert!(!super::collecting());
        assert_eq!(super::status()["sends"], false);
    }

    #[test]
    fn versions_are_never_free_text() {
        assert_eq!(super::version("hc 0.2.0"), "0.2.0");
        assert_eq!(super::version("0.2.0-rc.1"), "0.2.0-rc.1");
        assert_eq!(super::version("my build"), "other");
    }
}
