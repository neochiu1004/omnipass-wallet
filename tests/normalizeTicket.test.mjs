import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTicket } from '../src/js/utils.js';

const base = { id: 't1', productName: '測試票券' };

test('未使用票券可以保留置頂', () => {
  const ticket = normalizeTicket({ ...base, pinned: true });
  assert.equal(ticket.pinned, true);
  assert.equal(ticket.completed, false);
  assert.equal(ticket.isDeleted, false);
});

test('已使用票券的置頂會被清除', () => {
  const ticket = normalizeTicket({ ...base, pinned: true, completed: true });
  assert.equal(ticket.completed, true);
  assert.equal(ticket.pinned, false);
});

test('回收桶票券的置頂會被清除', () => {
  const ticket = normalizeTicket({ ...base, pinned: true, isDeleted: true });
  assert.equal(ticket.isDeleted, true);
  assert.equal(ticket.pinned, false);
});

test('同時已使用又在回收桶的票券不會保留置頂', () => {
  const ticket = normalizeTicket({ ...base, pinned: true, completed: true, isDeleted: true });
  assert.equal(ticket.pinned, false);
});

test('未標記置頂的未使用票券維持未置頂', () => {
  const ticket = normalizeTicket({ ...base });
  assert.equal(ticket.pinned, false);
});
