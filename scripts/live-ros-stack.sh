#!/usr/bin/env bash
# Start stock foxglove_bridge + demo publishers for ROSView live testing.
# Usage:
#   ./scripts/live-ros-stack.sh start   # background (default)
#   ./scripts/live-ros-stack.sh stop
#   ./scripts/live-ros-stack.sh status
#   ./scripts/live-ros-stack.sh preflight  # print topic list; exit 0 if ready
#
# Env:
#   ROSVIEW_LIVE_PORT   WebSocket port (default 8765)
#   ROSVIEW_LIVE_DIR    Runtime dir for pids/logs (default /tmp/rosview-live-stack)

set -eo pipefail

PORT="${ROSVIEW_LIVE_PORT:-8765}"
RUN_DIR="${ROSVIEW_LIVE_DIR:-/tmp/rosview-live-stack}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLISHERS_PY="${SCRIPT_DIR}/live_ros_publishers.py"

export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1,::1}"
export no_proxy="${no_proxy:-localhost,127.0.0.1,::1}"

mkdir -p "$RUN_DIR"

source_ros() {
  # ROS setup.bash assumes optional vars; disable nounset while sourcing.
  set +u
  if [[ -f /opt/ros/humble/setup.bash ]]; then
    # shellcheck disable=SC1091
    source /opt/ros/humble/setup.bash
  elif [[ -f /opt/ros/jazzy/setup.bash ]]; then
    # shellcheck disable=SC1091
    source /opt/ros/jazzy/setup.bash
  else
    set -u 2>/dev/null || true
    echo "ROS 2 not found under /opt/ros/{humble,jazzy}" >&2
    return 1
  fi
  set +u
}

is_listening() {
  ss -ltn 2>/dev/null | grep -qE ":${PORT}\\s" || \
    (command -v lsof >/dev/null && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1)
}

cmd_start() {
  source_ros
  if is_listening; then
    echo "Port $PORT already listening (reusing existing bridge)"
  else
    echo "Starting foxglove_bridge on port $PORT..."
    nohup ros2 launch foxglove_bridge foxglove_bridge_launch.xml \
      port:="$PORT" address:=0.0.0.0 \
      >"$RUN_DIR/bridge.log" 2>&1 &
    echo $! >"$RUN_DIR/bridge.pid"
    for _ in $(seq 1 40); do
      if is_listening; then break; fi
      sleep 0.25
    done
    if ! is_listening; then
      echo "foxglove_bridge failed to listen on $PORT" >&2
      tail -50 "$RUN_DIR/bridge.log" >&2 || true
      return 1
    fi
  fi

  # Publishers (idempotent: start if not already our process)
  if [[ -f "$RUN_DIR/publishers.pid" ]] && kill -0 "$(cat "$RUN_DIR/publishers.pid")" 2>/dev/null; then
    echo "Publishers already running pid=$(cat "$RUN_DIR/publishers.pid")"
  else
    echo "Starting live demo publishers..."
    nohup python3 "$PUBLISHERS_PY" >"$RUN_DIR/publishers.log" 2>&1 &
    echo $! >"$RUN_DIR/publishers.pid"
    sleep 1
  fi

  cmd_status
}

cmd_stop() {
  for name in publishers bridge; do
    if [[ -f "$RUN_DIR/${name}.pid" ]]; then
      pid="$(cat "$RUN_DIR/${name}.pid")"
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
      fi
      rm -f "$RUN_DIR/${name}.pid"
    fi
  done
  # Best-effort cleanup of launch children
  pkill -f "foxglove_bridge_launch.xml.*port:=${PORT}" 2>/dev/null || true
  pkill -f "rosview_live_demo_publishers" 2>/dev/null || true
  echo "Stopped (best-effort)"
}

cmd_status() {
  source_ros || true
  echo "port=$PORT listening=$(is_listening && echo yes || echo no)"
  if command -v ros2 >/dev/null 2>&1; then
    echo "--- ros2 topic list ---"
    ros2 topic list 2>/dev/null || true
  fi
}

cmd_preflight() {
  source_ros
  if ! is_listening; then
    echo "FAIL: nothing listening on port $PORT" >&2
    return 1
  fi
  local topics
  topics="$(ros2 topic list 2>/dev/null || true)"
  echo "$topics"
  local missing=0
  for t in /chatter /camera/image_raw /joint_states; do
    if ! grep -qxF "$t" <<<"$topics"; then
      echo "FAIL: missing topic $t" >&2
      missing=1
    fi
  done
  if [[ "$missing" -ne 0 ]]; then
    return 1
  fi
  echo "PREFLIGHT_OK port=$PORT"
  return 0
}

case "${1:-start}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  preflight) cmd_preflight ;;
  *)
    echo "Usage: $0 {start|stop|status|preflight}" >&2
    exit 2
    ;;
esac
