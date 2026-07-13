import { describe, expect, it } from 'vitest';
import {
  applyH264HardLimit,
  selectLatestCompleteH264Gop,
  updateH264ConfigPackets,
} from './h264Queue';

const sps = new Uint8Array([0, 0, 1, 0x67, 0x42, 0, 0x1e]);
const pps = new Uint8Array([0, 0, 1, 0x68, 0xce, 0x3c]);
const idr = new Uint8Array([0, 0, 1, 0x65, 1]);
const delta = new Uint8Array([0, 0, 1, 0x41, 2]);

type Frame = { id: string; data: Uint8Array };

function frame(id: string, data: Uint8Array): Frame {
  return { id, data };
}

describe('H.264 GOP queue selection', () => {
  it('retains split SPS and PPS packets separately and in order while waiting for IDR', () => {
    let config: Frame[] = [];
    config = updateH264ConfigPackets(config, frame('sps', sps));
    config = updateH264ConfigPackets(config, frame('delta', delta));
    config = updateH264ConfigPackets(config, frame('pps', pps));

    expect(config.map(({ id }) => id)).toEqual(['sps', 'pps']);
  });

  it('tracks the latest split SPS/PPS generation for future GOP resets', () => {
    let config = [frame('old-sps', sps), frame('old-pps', pps)];
    config = updateH264ConfigPackets(config, frame('new-sps', sps));
    config = updateH264ConfigPackets(config, frame('new-pps', pps));

    expect(config.map(({ id }) => id)).toEqual(['new-sps', 'new-pps']);
  });

  it('jumps over whole old GOPs to the latest IDR and keeps every new-GOP delta', () => {
    const frames = [
      frame('sps', sps),
      frame('pps', pps),
      frame('idr-1', idr),
      frame('delta-1a', delta),
      frame('delta-1b', delta),
      frame('idr-2', idr),
      frame('delta-2a', delta),
      frame('delta-2b', delta),
    ];

    const selected = selectLatestCompleteH264Gop(frames);

    expect(selected.resync).toBe(true);
    expect(selected.droppedFrames).toBe(3);
    expect(selected.frames.map(({ id }) => id)).toEqual([
      'sps',
      'pps',
      'idr-2',
      'delta-2a',
      'delta-2b',
    ]);
    expect(selected.frames.length).toBeLessThan(frames.length);
  });

  it('does not truncate the sole complete GOP during soft pressure', () => {
    const frames = [
      frame('idr', idr),
      ...Array.from({ length: 80 }, (_, index) => frame(`delta-${index}`, delta)),
    ];

    const selected = selectLatestCompleteH264Gop(frames);

    expect(selected.resync).toBe(false);
    expect(selected.droppedFrames).toBe(0);
    expect(selected.frames.map(({ id }) => id)).toEqual(frames.map(({ id }) => id));
  });

  it('drops an entire hard-overflow backlog and waits instead of returning truncated deltas', () => {
    const frames = [
      frame('idr', idr),
      ...Array.from({ length: 200 }, (_, index) => frame(`delta-${index}`, delta)),
    ];

    const plan = applyH264HardLimit(frames, true);

    expect(plan.waitForIdr).toBe(true);
    expect(plan.droppedFrames).toBe(frames.length);
    expect(plan.frames).toEqual([]);
  });

  it('can safely reset at the sole IDR by prepending previously consumed config', () => {
    const frames = [frame('idr', idr), frame('delta', delta)];
    const config = [frame('sps', sps), frame('pps', pps)];

    const selected = selectLatestCompleteH264Gop(frames, config, true);

    expect(selected.resync).toBe(true);
    expect(selected.droppedFrames).toBe(0);
    expect(selected.frames.map(({ id }) => id)).toEqual(['sps', 'pps', 'idr', 'delta']);
  });

  it('prepends previously consumed split config when jumping to a queued IDR', () => {
    const recentConfig = [frame('sps', sps), frame('pps', pps)];
    const frames = [
      frame('old-delta-1', delta),
      frame('old-delta-2', delta),
      frame('new-idr', idr),
      frame('new-delta', delta),
    ];

    const selected = selectLatestCompleteH264Gop(frames, recentConfig);

    expect(selected.resync).toBe(true);
    expect(selected.droppedFrames).toBe(2);
    expect(selected.frames.map(({ id }) => id)).toEqual([
      'sps',
      'pps',
      'new-idr',
      'new-delta',
    ]);
  });

  it('does not drop delta-only backlog from a GOP whose decoder state is still valid', () => {
    const frames = [frame('delta-1', delta), frame('delta-2', delta)];
    const selected = selectLatestCompleteH264Gop(frames);

    expect(selected.resync).toBe(false);
    expect(selected.frames).toEqual(frames);
  });
});
