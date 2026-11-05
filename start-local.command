#!/bin/zsh
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null; then
  echo 'Please install Node.js 24 or later.'
  read '?Press Enter to exit...'
  exit 1
fi
if (( $(node -p 'Number(process.versions.node.split(".")[0])') < 24 )); then
  echo 'The standalone local app requires Node.js 24 or later.'
  read '?Press Enter to exit...'
  exit 1
fi
if [[ ! -d node_modules && -f .local/dist/index.html ]]; then
  node local/server.mjs
elif [[ -d node_modules ]]; then
  npm run local
else
  echo 'For the first source-based startup, run npm ci in this directory, then npm run local.'
  read '?Press Enter to exit...'
  exit 1
fi
