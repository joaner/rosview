#!/usr/bin/env python3
"""Generate or copy minimal ALOHA-schema HDF5 fixture into public/examples/."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

try:
    import h5py
    import numpy as np
except ImportError:
    h5py = None  # type: ignore
    np = None  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
FIXTURE_SRC = ROOT / 'test-fixtures' / 'media' / 'minimal-aloha.h5'
OUT = ROOT / 'public' / 'examples' / 'test_minimal.hdf5'


def generate() -> None:
    assert h5py is not None and np is not None
    n, k, h, w, c = 4, 3, 2, 2, 3
    FIXTURE_SRC.parent.mkdir(parents=True, exist_ok=True)
    with h5py.File(FIXTURE_SRC, 'w') as h5:
        h5.create_dataset('/action', data=np.arange(n * k, dtype=np.float32).reshape(n, k))
        h5.create_dataset('/observations/qpos', data=(np.arange(n * k, dtype=np.float32).reshape(n, k) * 2))
        h5.create_dataset('/observations/qvel', data=np.zeros((n, k), dtype=np.float32))
        h5.create_dataset('/observations/tau_J', data=np.zeros((n, k), dtype=np.float32))
        h5.create_dataset('/observations/ee_pos_t', data=np.zeros((n, 3), dtype=np.float32))
        h5.create_dataset(
            '/observations/ee_pos_q',
            data=np.tile([0, 0, 0, 1], (n, 1)).astype(np.float32),
        )
        h5.create_dataset(
            '/observations/images/ext1',
            data=np.arange(n * h * w * c, dtype=np.uint8).reshape(n, h, w, c),
        )
        h5.create_dataset('/tm', data=np.full((n, 1), 0.125, dtype=np.float32))
    print(f'Generated {FIXTURE_SRC} ({FIXTURE_SRC.stat().st_size} bytes)')


def main() -> int:
    if not FIXTURE_SRC.exists():
        if h5py is None:
            print('h5py not installed and committed fixture missing', file=sys.stderr)
            return 1
        generate()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(FIXTURE_SRC, OUT)
    print(f'Wrote {OUT} ({OUT.stat().st_size} bytes)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
