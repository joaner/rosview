import { describe, expect, it } from 'vitest';
import { getAddablePanelDefinitions, getPanelDefinitions } from './index';

describe('getAddablePanelDefinitions', () => {
  it('excludes Unavailable and hideFromPanelPicker panels', () => {
    const addable = getAddablePanelDefinitions();
    const all = getPanelDefinitions();

    expect(addable.length).toBeLessThan(all.length);
    expect(addable.some((definition) => definition.type === 'Unavailable')).toBe(false);
    expect(addable.some((definition) => definition.type === 'JointStatePlot')).toBe(false);
    expect(addable.some((definition) => definition.type === 'Plot')).toBe(true);
  });
});
