pid_file := "tmp/preview.pid"
port_file := "tmp/preview.port"
log_file := "tmp/preview.log"

# Run the dev server in this terminal (Ctrl-C to stop).
dev: deps
    npx vite

# Start the dev server in the background. Open the printed URL.
start port="8765": deps
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{quote(justfile_directory())}}
    mkdir -p tmp
    port={{quote(port)}}
    if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
      echo "Port must be a number from 1 to 65535" >&2
      exit 1
    fi
    if [[ -f {{pid_file}} ]]; then
      pid=$(<{{pid_file}})
      if kill -0 "$pid" 2>/dev/null; then
        running={{quote(port)}}
        if [[ -f {{port_file}} ]]; then
          running=$(<{{port_file}})
        fi
        echo "Already running at http://127.0.0.1:${running}"
        exit 0
      fi
      rm -f {{pid_file}} {{port_file}}
    fi
    setsid npx vite --host 127.0.0.1 --port "$port" --strictPort > {{log_file}} 2>&1 < /dev/null &
    pid=$!
    echo "$pid" > {{pid_file}}
    echo "$port" > {{port_file}}
    for _ in $(seq 1 100); do
      if curl -fs "http://127.0.0.1:${port}/" >/dev/null 2>&1; then
        echo "Preview at http://127.0.0.1:${port}"
        exit 0
      fi
      if ! kill -0 "$pid" 2>/dev/null; then
        echo "Dev server exited. See {{log_file}}" >&2
        rm -f {{pid_file}} {{port_file}}
        exit 1
      fi
      sleep 0.1
    done
    echo "Dev server did not respond. See {{log_file}}" >&2
    exit 1

# Stop the background dev server.
stop:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{quote(justfile_directory())}}
    if [[ ! -f {{pid_file}} ]]; then
      echo "Preview server is not running"
      exit 0
    fi
    pid=$(<{{pid_file}})
    if kill -0 "$pid" 2>/dev/null; then
      # setsid made the server its own process group; stop npx and vite together.
      kill -- -"$pid" 2>/dev/null || kill "$pid"
      for _ in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 -- -"$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
      fi
      echo "Stopped"
    else
      echo "Preview server is not running"
    fi
    rm -f {{pid_file}} {{port_file}}

# Build a static site into dist/.
build: deps
    npm run build

# Run the unit tests.
test: deps
    npm test

# Run every check CI would: formatting, lint, types, tests.
check: deps
    npm run format:check
    npm run lint
    npm run typecheck
    npm test

# Rewrite files with the project formatter.
format: deps
    npm run format

[private]
deps:
    #!/usr/bin/env bash
    cd {{quote(justfile_directory())}}
    [[ -d node_modules ]] || npm install
