#!/bin/bash
# Neural Link — Install to global location
# Copies src/, bin/, config to ~/.copilot/neural-link/
# Preserves existing weights/ and logs/ directories
#
# Usage: bash install.sh

set -e

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$HOME/.copilot/neural-link"

echo "Neural Link — Install"
echo "  Source: $SOURCE_DIR"
echo "  Target: $TARGET_DIR"
echo ""

# Create target directory structure
mkdir -p "$TARGET_DIR/src" "$TARGET_DIR/bin"

# Copy source files (overwrites existing)
echo "  Copying src/ ..."
cp "$SOURCE_DIR"/src/*.js "$TARGET_DIR/src/"

echo "  Copying bin/ ..."
cp "$SOURCE_DIR"/bin/* "$TARGET_DIR/bin/"
chmod +x "$TARGET_DIR/bin/neural-link.sh"

echo "  Copying config ..."
cp "$SOURCE_DIR/neural-link.config.json" "$TARGET_DIR/"
cp "$SOURCE_DIR/package.json" "$TARGET_DIR/"

# Ensure weights/ and logs/ exist but NEVER overwrite contents
for d in weights logs; do
    if [ ! -d "$TARGET_DIR/$d" ]; then
        mkdir -p "$TARGET_DIR/$d"
        echo "  Created $d/"
    else
        echo "  Preserved existing $d/"
    fi
done

# Summary
FILE_COUNT=$(find "$TARGET_DIR" -type f | wc -l)
echo ""
echo "  Installed $FILE_COUNT files to $TARGET_DIR"
echo "  Entry points:"
echo "    SH:  $TARGET_DIR/bin/neural-link.sh"
echo "    PS1: $TARGET_DIR/bin/neural-link.ps1"
echo ""
echo "  Done."
