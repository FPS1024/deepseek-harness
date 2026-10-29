#!/bin/sh
set -eu

command=/usr/bin/deepseek-harness
target=/opt/deepseek-harness/bin/deepseek-harness
legacy_target=/opt/deepseek-harness/deepseek-harness
sandbox=/opt/deepseek-harness/chrome-sandbox
profile_source=/opt/deepseek-harness/resources/apparmor-profile
profile_target=/etc/apparmor.d/deepseek-harness

# Electron's default post-install uses the setuid sandbox only where the kernel cannot provide user namespaces.
if [ -f "$sandbox" ]; then
  if [ -L /proc/self/ns/user ] && unshare --user true >/dev/null 2>&1; then
    chmod 0755 "$sandbox"
  else
    chmod 4755 "$sandbox"
  fi
fi

# Install the AppArmor profile on distributions whose AppArmor supports abi/4.0; others run without it.
if [ -f "$profile_source" ] && command -v apparmor_status >/dev/null 2>&1 \
  && apparmor_status --enabled >/dev/null 2>&1 \
  && apparmor_parser --skip-kernel-load --debug "$profile_source" >/dev/null 2>&1; then
  cp -f "$profile_source" "$profile_target"
  if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; } && command -v apparmor_parser >/dev/null 2>&1; then
    apparmor_parser --replace --write-cache --skip-read-cache "$profile_target"
  fi
fi

if command -v update-mime-database >/dev/null 2>&1; then
  update-mime-database /usr/share/mime || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi

if [ -L "$command" ] && [ "$(readlink "$command")" = "$target" ]; then
  exit 0
fi
if [ -L "$command" ] && [ "$(readlink "$command")" = "$legacy_target" ]; then
  ln -sfn "$target" "$command"
  exit 0
fi
if [ -e "$command" ] || [ -L "$command" ]; then
  printf '%s\n' "deepseek-harness: refusing to replace existing $command" >&2
  exit 1
fi
ln -s "$target" "$command"
