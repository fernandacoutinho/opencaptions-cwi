#!/bin/bash
# Publish all @opencaptions packages in dependency order.
# Each package will open a browser URL for passkey auth.
set -e

cd "$(dirname "$0")/.."

echo "Publishing OpenCaptions packages in dependency order..."
echo "Each package will require browser passkey authentication."
echo ""

# Layer 1: types (zero deps)
echo "=== [1/8] @opencaptions/types ==="
cd packages/types && bun publish --access public && cd ../..
echo ""

# Layer 2: spec, layout, pipeline, tracing (depend on types)
echo "=== [2/8] @opencaptions/spec ==="
cd packages/spec && bun publish --access public && cd ../..
echo ""

echo "=== [3/8] @opencaptions/layout ==="
cd packages/layout && bun publish --access public && cd ../..
echo ""

echo "=== [4/8] @opencaptions/pipeline ==="
cd packages/pipeline && bun publish --access public && cd ../..
echo ""

echo "=== [5/8] @opencaptions/tracing ==="
cd packages/tracing && bun publish --access public && cd ../..
echo ""

# Layer 3: backend-av, renderer (depend on pipeline/layout)
echo "=== [6/8] @opencaptions/backend-av ==="
cd packages/backend-av && bun publish --access public && cd ../..
echo ""

echo "=== [7/8] @opencaptions/renderer ==="
cd packages/renderer && bun publish --access public && cd ../..
echo ""

# Layer 4: CLI (depends on everything)
echo "=== [8/8] opencaptions (cli) ==="
cd packages/cli && bun publish --access public && cd ../..
echo ""

echo "✅ All packages published!"
echo ""
echo "Verify: https://www.npmjs.com/org/opencaptions"
