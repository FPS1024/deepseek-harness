#!/bin/sh
set -eu

if [ "${1:-}" = upgrade ]; then
  exit 0
fi

command=/usr/bin/deepseek-harness
target=/opt/deepseek-harness/bin/deepseek-harness
profile_target=/etc/apparmor.d/deepseek-harness

# Unload before deleting so the policy does not stay enforced until the next reboot.
if [ -f "$profile_target" ]; then
  if command -v apparmor_status >/dev/null 2>&1 && apparmor_status --enabled >/dev/null 2>&1; then
    if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; } && command -v apparmor_parser >/dev/null 2>&1; then
      apparmor_parser --remove "$profile_target" || true
    fi
  fi
  rm -f "$profile_target"
fi

if [ -L "$command" ] && [ "$(readlink "$command")" = "$target" ]; then
  rm -f "$command"
fi
