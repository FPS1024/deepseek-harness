#!/bin/sh
set -eu

if [ "${1:-}" = upgrade ]; then
  exit 0
fi

command=/usr/bin/deepseek-harness
target=/opt/deepseek-harness/bin/deepseek-harness
if [ -L "$command" ] && [ "$(readlink "$command")" = "$target" ]; then
  rm -f "$command"
fi
