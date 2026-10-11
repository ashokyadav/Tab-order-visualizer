#!/usr/bin/env bash
# One-time publish to GitHub, using the GitHub CLI (https://cli.github.com).
#   1. gh auth login            (once)
#   2. ./publish.sh your-github-username
set -euo pipefail
USER_NAME="${1:?Usage: ./publish.sh <github-username>}"
REPO=tab-order-visualizer

# Put your username into the README, package.json, Pages links and store listing
grep -rl 'YOUR-USERNAME' --exclude=publish.sh --exclude-dir=node_modules . | xargs sed -i.bak "s/YOUR-USERNAME/${USER_NAME}/g"
find . -name '*.bak' -not -path './node_modules/*' -delete

npm install
npm run build

git init -b main
git add .
git commit -m "Tab Order Visualizer v1.0.0"
gh repo create "${REPO}" --public --source . --push \
  --description "See the keyboard tab order on any page and spot focus-order, focus-visibility and keyboard-reachability problems."

# Serve /docs on GitHub Pages: install page and demo stores
gh api -X POST "repos/${USER_NAME}/${REPO}/pages" -f "source[branch]=main" -f "source[path]=/docs" >/dev/null || \
  echo "Pages may already be on. Check Settings → Pages."
gh repo edit "${USER_NAME}/${REPO}" --homepage "https://${USER_NAME}.github.io/${REPO}/" \
  --add-topic accessibility --add-topic a11y --add-topic wcag --add-topic keyboard-navigation --add-topic chrome-extension

# Tagged release with the Web Store zip, bookmarklet and demo video attached
ASSETS=(dist/tab-order-visualizer-extension.zip dist/bookmarklet.txt)
[ -f video/tab-order-visualizer-demo.mp4 ] && ASSETS+=(video/tab-order-visualizer-demo.mp4)
gh release create v1.0.0 "${ASSETS[@]}" --title "v1.0.0" \
  --notes "First release. Bookmarklet, Chrome extension and demo pages. See the README for install steps."

echo
echo "Repo:     https://github.com/${USER_NAME}/${REPO}"
echo "Install:  https://${USER_NAME}.github.io/${REPO}/  (Pages can take a minute or two)"
