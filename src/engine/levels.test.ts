import assert from 'node:assert/strict';
import test from 'node:test';
import { LEVELS } from './levels.ts';

test('no walkable platform is embedded inside a level floor', () => {
  for (const level of LEVELS) {
    const floor = level.platforms.find((p) => p.id === 'floor-main');
    if (!floor) continue;

    for (const platform of level.platforms) {
      if (platform.id === 'floor-main') continue;

      const overlapsX: boolean = platform.x < floor.x + floor.w && platform.x + platform.w > floor.x;
      const startsInsideFloor: boolean = platform.y >= floor.y && platform.y < floor.y + floor.h;
      assert.equal(
        overlapsX && startsInsideFloor,
        false,
        `${level.id}/${platform.id} starts at y=${platform.y}, inside floor-main (${floor.y}..${floor.y + floor.h})`
      );
    }
  }
});
