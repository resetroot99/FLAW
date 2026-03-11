#!/usr/bin/env bash
set -euo pipefail

# Build FLAW for PyPI distribution
# Bundles the compiled JS into the Python package

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PYTHON_DIR="$ROOT_DIR/python"
DIST_TARGET="$PYTHON_DIR/flaw_audit/dist"

echo "Building TypeScript..."
cd "$ROOT_DIR"
npm run build

echo "Bundling dist/ into Python package..."
rm -rf "$DIST_TARGET"
cp -r "$ROOT_DIR/dist" "$DIST_TARGET"

# Also copy rulepacks and schemas needed at runtime
cp -r "$ROOT_DIR/rulepacks" "$DIST_TARGET/"
cp -r "$ROOT_DIR/schemas" "$DIST_TARGET/"

echo "Building Python package..."
cd "$PYTHON_DIR"
python -m build 2>/dev/null || pip install build && python -m build

echo ""
echo "Done. Package built in $PYTHON_DIR/dist/"
echo "To publish: cd $PYTHON_DIR && twine upload dist/*"
