import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ticketUsesTemplateImage } from '../src/js/utils.js';

const TPL_IMG = 'data:image/png;base64,TEMPLATE';

test('借用範本原圖且有序號 → true', () => {
  assert.equal(ticketUsesTemplateImage({ serial: 'E123', originalImage: TPL_IMG }, TPL_IMG), true);
});

test('自己的上傳圖片 → false', () => {
  assert.equal(ticketUsesTemplateImage({ serial: 'E123', originalImage: 'data:image/png;base64,OWN' }, TPL_IMG), false);
});

test('已個人化的圖片（與範本不同）→ false', () => {
  assert.equal(ticketUsesTemplateImage({ serial: 'E123', originalImage: 'data:image/webp;base64,RENDERED' }, TPL_IMG), false);
});

test('沒有序號 → false（無法重繪）', () => {
  assert.equal(ticketUsesTemplateImage({ serial: '', originalImage: TPL_IMG }, TPL_IMG), false);
  assert.equal(ticketUsesTemplateImage({ originalImage: TPL_IMG }, TPL_IMG), false);
});

test('回收桶與批量生成票券 → false', () => {
  assert.equal(ticketUsesTemplateImage({ serial: 'E1', originalImage: TPL_IMG, isDeleted: true }, TPL_IMG), false);
  assert.equal(ticketUsesTemplateImage({ serial: 'E1', originalImage: TPL_IMG, tags: ['批量生成'] }, TPL_IMG), false);
});

test('範本沒有原圖或票券為空 → false', () => {
  assert.equal(ticketUsesTemplateImage({ serial: 'E1', originalImage: TPL_IMG }, ''), false);
  assert.equal(ticketUsesTemplateImage(null, TPL_IMG), false);
  assert.equal(ticketUsesTemplateImage(undefined, TPL_IMG), false);
});
