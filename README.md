<p align="center"><img src="app/assets/icons/swarmux-ui-icon-clean.svg" width="112" alt="SWARMUX logo"></p>

<h1 align="center">SWARMUX</h1>

<p align="center">A native, GPU-drawn home for your terminals and coding agents.<br>Spaces, tabs and splits that keep running when the window closes.</p>

---

## Install

**Windows** (PowerShell, x64, Windows 10 1803 or newer):

```powershell
irm https://chsxthwik.github.io/SWARMUX/app/install.ps1 | iex
```

**Linux** (x86_64 or ARM64, with a desktop session and Vulkan):

```sh
curl -fsSL https://chsxthwik.github.io/SWARMUX/app/install.sh | sh
```

The installer puts the app in your user folder (no admin needed), adds it to the Start menu or your apps, and installs the core (`hc`) if it is missing. Updates download in the background and apply when you restart the app; your terminals keep running.

## What you get

- **Spaces, tabs and splits.** A space per project or machine; split any tab into terminals or panels.
- **Agents at a glance.** Start Claude Code, Codex, OpenCode, pi and others from the + menu. Agents that report their status show as working, blocked, done or idle, with a sound and a notification when one needs you.
- **Terminals that outlive the window.** They run in `swarmux-core`, so closing or updating the app never ends them. After a reboot, every pane comes back in its last folder.
- **Other machines.** Add an SSH host or WSL distro and its spaces run there.
- **Make it yours.** Themes, fonts, keys, layouts and JavaScript mods, all plain files that reload live.
- **Private.** No telemetry, no account. It only goes online to check GitHub for updates.

## Repository

| Folder | What it is |
|---|---|
| [`app/`](app) | The desktop app (`swarmux`): Rust + GPUI. [README](app/README.md) |
| [`core/`](core) | The terminal runtime (`swarmux-core`, alias `hc`). [README](core/README.md) |

Build from source with Rust 1.95 and Zig 0.16:

```sh
git clone --recurse-submodules https://github.com/chsxthwik/SWARMUX.git
cd SWARMUX/core && cargo build --release
cd ../app && cargo build --release
```

Releases are built by [GitHub Actions](.github/workflows/release.yml) from tagged source.

## Credits and license

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE).

Made by **QUANTUM**.
