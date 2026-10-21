#!/bin/sh
set -eu

command=/usr/bin/deepseek-harness
target=/opt/deepseek-harness/bin/deepseek-harness
legacy_target=/opt/deepseek-harness/deepseek-harness

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
