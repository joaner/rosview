#!/usr/bin/env python3
"""Generate a minimal ROS1 .bag fixture for mcap+bag mixed-format multi-source tests.

Uses the `rosbags` package (`pip install rosbags`) since there is no
maintained JS/TS ROS1 bag *writer* (only readers). Skips gracefully (exit 0,
no output file) when `rosbags` isn't installed, matching how
gen-test-mcap-filtered.mjs handles the optional `mcap` CLI dependency:
contributors without it still get every other fixture, and Playwright specs
that depend on this file self-skip when it's absent. CI installs the package
so it always runs there (see .github/workflows/ci.yml).
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    import numpy as np
    from rosbags.rosbag1 import Writer
    from rosbags.typesys import Stores, get_typestore
except ImportError:
    np = None  # type: ignore[assignment]
    Writer = None  # type: ignore[assignment]
    get_typestore = None  # type: ignore[assignment]

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'examples' / 'test_multi.bag'


def generate() -> None:
    assert np is not None and Writer is not None and get_typestore is not None
    typestore = get_typestore(Stores.ROS1_NOETIC)
    joint_state_type = typestore.types['sensor_msgs/msg/JointState']
    header_type = typestore.types['std_msgs/msg/Header']
    time_type = typestore.types['builtin_interfaces/msg/Time']

    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.exists():
        OUT.unlink()

    with Writer(OUT) as writer:
        connection = writer.add_connection(
            '/bag/joint_states',
            joint_state_type.__msgtype__,
            typestore=typestore,
        )
        for sec in range(5):
            message = joint_state_type(
                header_type(seq=sec, stamp=time_type(sec=sec, nanosec=0), frame_id=''),
                name=['bag_joint1', 'bag_joint2'],
                position=np.array([sec * 0.05, -sec * 0.05], dtype=np.float64),
                velocity=np.array([], dtype=np.float64),
                effort=np.array([], dtype=np.float64),
            )
            writer.write(
                connection,
                sec * 1_000_000_000,
                typestore.serialize_ros1(message, joint_state_type.__msgtype__),
            )
    print(f'Wrote {OUT} ({OUT.stat().st_size} bytes)')


def main() -> int:
    if Writer is None:
        print(
            '[gen-test-bag] `rosbags` package not installed; skipping test_multi.bag.\n'
            '  Install it with `pip install rosbags` to exercise mcap+bag mixed-format tests.\n'
            '  Tests that depend on it self-skip when the file is absent.',
            file=sys.stderr,
        )
        if OUT.exists():
            OUT.unlink()
        return 0
    generate()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
