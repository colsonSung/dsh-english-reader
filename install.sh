#!/usr/bin/env bash
#
# Install the DeepSeek Harness "English Reader" plugin into a profile.
#
#   ./install.sh            # the profile the running Harness uses
#   ./install.sh web        # a named profile
#
# It installs the package into the profile and adds the bundle row to the
# profile's patch layer. Both steps are idempotent. Restart the Harness
# afterwards: the host half of a plugin is loaded at start-up.
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PACKAGE="dsh-english-reader"
ROW_ID="english-reader"

PROFILE="${1:-${DSH_PROFILE:-}}"
if [ -z "$PROFILE" ]; then
  echo "error: pass a profile name (for example: ./install.sh web)" >&2
  echo "       or set DSH_PROFILE" >&2
  exit 1
fi

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"

if ! command -v dsh >/dev/null 2>&1; then
  echo "error: the 'dsh' command is not on PATH — install the DeepSeek Harness CLI first" >&2
  exit 1
fi

echo "==> installing $PACKAGE into the '$PROFILE' profile"
dsh plugin --profile "$PROFILE" add "$HERE/plugin"

if [ ! -d "$PROFILE_DIR" ]; then
  mkdir -p "$PROFILE_DIR"
fi

if [ ! -f "$PATCH_FILE" ]; then
  cat > "$PATCH_FILE" <<'YAML'
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
YAML
fi

if grep -q "id: $ROW_ID" "$PATCH_FILE"; then
  echo "==> the bundle row is already in $PATCH_FILE"
else
  echo "==> adding the bundle row to $PATCH_FILE"
  # An empty list ("[]") cannot be followed by list items: the profile template
  # starts with one, so the entry replaces it instead of being appended.
  awk -v id="$ROW_ID" -v pkg="$PACKAGE" '
    /^[[:space:]]*\[\][[:space:]]*$/ && !replaced {
      print "- insert:"
      print "    - id: " id
      print "      name: '\''" pkg "'\''"
      replaced = 1
      next
    }
    { print }
  ' "$PATCH_FILE" > "$PATCH_FILE.tmp"
  if grep -q "id: $ROW_ID" "$PATCH_FILE.tmp"; then
    mv "$PATCH_FILE.tmp" "$PATCH_FILE"
  else
    rm -f "$PATCH_FILE.tmp"
    cat >> "$PATCH_FILE" <<YAML
- insert:
    - id: $ROW_ID
      name: '$PACKAGE'
YAML
  fi
fi

cat <<DONE

installed

  profile  $PROFILE
  package  $PACKAGE
  patch    $PATCH_FILE

Next: restart the DeepSeek Harness, then open the "English Reader" icon in
the left sidebar's Global panels.
DONE
