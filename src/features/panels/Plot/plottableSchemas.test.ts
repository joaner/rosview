import { describe, expect, it } from 'vitest';
import { filterPlottableTopics, isPlottableSchema } from './plottableSchemas';

describe('Plot plottable schema filtering', () => {
  it('allows unknown non-blocked schemas so sample discovery can run', () => {
    expect(isPlottableSchema('custom_msgs/msg/Foo')).toBe(true);
    expect(filterPlottableTopics([
      { name: '/custom', type: 'custom_msgs/msg/Foo' },
      { name: '/image', type: 'sensor_msgs/msg/Image' },
    ]).map((topic) => topic.name)).toEqual(['/custom']);
  });
});
