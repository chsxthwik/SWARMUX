#!/bin/sh
# Builds a release binary into ~/.local/bin (replacing any older one), then
# restarts the core the planned way so running terminals pick up the new build
# (never handing this shell's environment to a core it has to start).
set -eu
cd "$(dirname "$0")/.."
nice -n 10 cargo build --release
bin="${HC_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$bin"
if [ "$(uname -s)" = Darwin ]; then
  app="target/release/SWARMUX Core.app"
  rm -rf "$app"
  sh scripts/mac-bundle target/release/swarmux-core "$app"
  bash scripts/mac-sign "$app"
  "$app/Contents/MacOS/swarmux-core" --hc-install-bundle "$app/Contents/MacOS/swarmux-core" "$bin/swarmux-core"
else
  install -m 755 target/release/swarmux-core "$bin/swarmux-core.new"
  mv -f "$bin/swarmux-core.new" "$bin/swarmux-core"
fi
[ -e "$bin/hc" ] || [ -L "$bin/hc" ] || ln -s swarmux-core "$bin/hc"
sh scripts/restart-core.sh "$bin/swarmux-core"
