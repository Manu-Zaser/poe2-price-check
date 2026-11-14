import { describe, expect, it } from 'vitest';
import { compareVersions } from '../src/shared/version';

describe('compareVersions', () => {
  it('compares major, minor and patch numerically', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0);
  });

  it('accepts GitHub tags with a leading v', () => {
    expect(compareVersions('v0.2.1', '0.2.0')).toBeGreaterThan(0);
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0);
  });
});
