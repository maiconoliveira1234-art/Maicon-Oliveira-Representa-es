import assert from 'node:assert/strict';
import { saveDraftLocally, readDraftLocally, clearLocalDraft } from '../lib/draftStorage';

Object.defineProperty(globalThis, 'localStorage', { value: {
  setItem() { throw new DOMException('Storage full', 'QuotaExceededError'); },
  getItem() { return null; },
  removeItem() {},
} });
const warn = console.warn;
console.warn = () => {};
const draft = JSON.stringify({ items: [{ produto_id: 'hug-item', quantidade: 1 }], updatedAt: new Date().toISOString() });
assert.doesNotThrow(() => saveDraftLocally('pedido_hug', draft));
assert.equal(await readDraftLocally('pedido_hug'), draft);
clearLocalDraft('pedido_hug');
assert.equal(await readDraftLocally('pedido_hug'), null);
await new Promise(resolve => setTimeout(resolve, 10));
console.warn = warn;
console.log('Draft storage: full quota does not crash, draft retained, cleared draft stays cleared.');
