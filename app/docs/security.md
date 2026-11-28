# Security and privacy

## Mods have your access

A mod is trusted JavaScript running inside SWARMUX. It can run programs with your environment, fetch URLs and read files.
The built-in file API limits writes to the app home, but a mod can run a program to write elsewhere. That is not a security boundary.
Mods can also run programs on connected machines.

There is no permission prompt for each program or network request. Read a mod before installing it, and treat it like a shell script you would run yourself.
Layouts can load mods. Check those references too.

## What stays on disk

The default app home is `~/.config/swarmux`, including on macOS and Windows (under your user home).
`XDG_CONFIG_HOME` changes the config root. `SWARMUX_HOME` selects an app home directly and takes precedence.

This folder holds your settings, keys, layouts, mods, generated agent guide and API types.
It also holds mod data, shared state, window positions, this screen's focus and zoom, update notes and cached media.
Mods may store sensitive data here. SWARMUX does not encrypt this folder.
The [installed guide's file map](../defaults/AGENTS.md#the-files) explains the files.

Spaces, tabs and splits are stored in each machine's core document, not in the app home.
Terminals and their output belong to [swarmux-core](https://github.com/chsxthwik/SWARMUX).
Removing the app home does not stop the core or erase its data.

The app exposes a local control socket in its home so agents can inspect and drive the window.
Treat access to that home as access to the window and its commands.
Remote connections use SSH through the core.

## Updates and signing

Installed releases check the SWARMUX release service, download an update, and check its SHA-256 checksum against the release manifest before unpacking it.
The app switches to the downloaded version on quit. Source builds do not update themselves.
Core updates are handled separately by the core's updater.

A checksum from the same service detects a damaged download; it is not an independent signature on the manifest.
The app does not verify a separate cryptographic signature on update manifests.

SWARMUX releases are built by GitHub Actions from this repository's tagged source and are not code-signed yet, so Windows SmartScreen may warn on first run.

## No telemetry

SWARMUX collects and sends **no usage data**: no reports, no install ID, no crash uploads.
The app goes online only to check for and download updates from this project's GitHub (`chsxthwik.github.io/SWARMUX` and its GitHub Releases), and when a mod you installed makes a request.

**Send feedback** drafts a message for you to review. Sending opens a prefilled GitHub issue in your browser; nothing is posted until you submit it there.

[Back to SWARMUX](../README.md)
