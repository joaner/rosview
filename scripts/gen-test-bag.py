#!/usr/bin/env python3
"""Generate or copy a minimal ROS1 .bag fixture into public/examples/.

Mirrors gen-test-hdf5.py's pattern: the source fixture is committed to
test-fixtures/media/ so CI and most contributors never need the `rosbags`
package (`pip install rosbags`) at all; it is only required to *regenerate*
the source fixture (e.g. after changing the schema below). There is no
maintained JS/TS ROS1 bag *writer*, which is why this one script is Python
rather than joining the .mjs generators.
"""
from __future__ import annotations

import shutil
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
FIXTURE_SRC = ROOT / 'test-fixtures' / 'media' / 'minimal-multi.bag'
OUT = ROOT / 'public' / 'examples' / 'test_multi.bag'


def generate() -> None:
    assert np is not None and Writer is not None and get_typestore is not None
    typestore = get_typestore(Stores.ROS1_NOETIC)
    joint_state_type = typestore.types['sensor_msgs/msg/JointState']
    header_type = typestore.types['std_msgs/msg/Header']
    time_type = typestore.types['builtin_interfaces/msg/Time']

    FIXTURE_SRC.parent.mkdir(parents=True, exist_ok=True)
    if FIXTURE_SRC.exists():
        FIXTURE_SRC.unlink()

    with Writer(FIXTURE_SRC) as writer:
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
    print(f'Generated {FIXTURE_SRC} ({FIXTURE_SRC.stat().st_size} bytes)')


def main() -> int:
    if not FIXTURE_SRC.exists():
        if Writer is None:
            print(
                '[gen-test-bag] rosbags not installed and committed fixture missing; '
                'skipping test_multi.bag.\n'
                '  Install it with `pip install rosbags` to (re)generate '
                f'{FIXTURE_SRC.relative_to(ROOT)}.\n'
                '  Tests that depend on test_multi.bag self-skip when the file is absent.',
                file=sys.stderr,
            )
            return 0
        generate()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(FIXTURE_SRC, OUT)
    print(f'Wrote {OUT} ({OUT.stat().st_size} bytes)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
