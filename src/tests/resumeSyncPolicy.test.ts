import assert from 'node:assert/strict';
import { RESUME_SYNC_INTERVAL_MS as threshold, shouldSyncAfterReturn as due } from '../lib/resumeSyncPolicy';
const now = Date.now();
assert.equal(due(now - threshold + 1, now - threshold * 2, now), false); // brief background
assert.equal(due(now - threshold, now - threshold, now), true); // long absence
assert.equal(due(now - threshold * 2, now - threshold + 1, now), false); // recent sync
assert.equal(due(0, 0, now), false); // continuous use
assert.equal(due(now - threshold * 2, 0, now), true); // offline cache first sync
console.log('Resume sync policy passed.');
