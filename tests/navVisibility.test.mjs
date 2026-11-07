import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getNavVisibility, GLASS_CARD_OPACITY, LEGACY_DEFAULT_CARD_OPACITY, defaultViewConfig } from '../src/js/utils.js';
import { DataService } from '../src/js/services/dataService.js';

const active = { id: 'a', completed: false, isDeleted: false };
const used = { id: 'u', completed: true, isDeleted: false };
const trashed = { id: 't', completed: false, isDeleted: true };
const usedAndTrashed = { id: 'ut', completed: true, isDeleted: true };

test('沒有票券時已使用與回收桶入口都隱藏', () => {
  const v = getNavVisibility([]);
  assert.equal(v.showCompleted, false);
  assert.equal(v.showDeleted, false);
  assert.equal(v.completedCount, 0);
  assert.equal(v.deletedCount, 0);
});

test('只有未使用票券時兩個入口都隱藏', () => {
  const v = getNavVisibility([active, active]);
  assert.equal(v.showCompleted, false);
  assert.equal(v.showDeleted, false);
});

test('有已使用票券時已使用入口出現', () => {
  const v = getNavVisibility([active, used]);
  assert.equal(v.showCompleted, true);
  assert.equal(v.completedCount, 1);
  assert.equal(v.showDeleted, false);
});

test('有回收桶票券時回收桶入口出現', () => {
  const v = getNavVisibility([active, trashed]);
  assert.equal(v.showDeleted, true);
  assert.equal(v.deletedCount, 1);
  assert.equal(v.showCompleted, false);
});

test('已使用又進回收桶的票券只算回收桶', () => {
  const v = getNavVisibility([usedAndTrashed]);
  assert.equal(v.completedCount, 0);
  assert.equal(v.deletedCount, 1);
  assert.equal(v.showCompleted, false);
  assert.equal(v.showDeleted, true);
});

test('玻璃預設值落在 0.68–0.78 區間且成為 viewConfig 預設', () => {
  assert.ok(GLASS_CARD_OPACITY >= 0.68 && GLASS_CARD_OPACITY <= 0.78);
  assert.equal(defaultViewConfig.cardOpacity, GLASS_CARD_OPACITY);
});

test('舊預設 0.95 會一次性遷移到玻璃預設並立標記', () => {
  const svc = new DataService();
  const migrated = svc.compactViewConfig({ cardOpacity: LEGACY_DEFAULT_CARD_OPACITY }, {});
  assert.equal(migrated.cardOpacity, GLASS_CARD_OPACITY);
  assert.equal(migrated.cardOpacityGlassMigrated, true);
});

test('遷移後使用者刻意設回舊預設值會被保留', () => {
  const svc = new DataService();
  const kept = svc.compactViewConfig(
    { cardOpacity: LEGACY_DEFAULT_CARD_OPACITY, cardOpacityGlassMigrated: true },
    {},
  );
  assert.equal(kept.cardOpacity, LEGACY_DEFAULT_CARD_OPACITY);
});

test('自訂透明度不被遷移影響', () => {
  const svc = new DataService();
  assert.equal(svc.compactViewConfig({ cardOpacity: 0.5 }, {}).cardOpacity, 0.5);
  assert.equal(svc.compactViewConfig({}, {}).cardOpacity, GLASS_CARD_OPACITY);
});
