import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findTitleAutoTemplate, TITLE_AUTO_TEMPLATE_KEYWORD } from '../src/js/utils.js';

const templates = [
  { id: 'a', label: '一般飲品', productName: '飲品券' },
  { id: 'b', label: '85度C飲品', productName: '85度C 35元飲品券' },
  { id: 'c', label: '預設範本', productName: '其他票券' },
];

test('關鍵字固定為 85度C', () => {
  assert.equal(TITLE_AUTO_TEMPLATE_KEYWORD, '85度C');
});

test('有設預設範本時優先用預設', () => {
  assert.equal(findTitleAutoTemplate(templates, 'c')?.id, 'c');
});

test('預設 id 失效時退回名稱含關鍵字的範本', () => {
  assert.equal(findTitleAutoTemplate(templates, 'missing')?.id, 'b');
});

test('沒設預設時用名稱含關鍵字的範本', () => {
  assert.equal(findTitleAutoTemplate(templates, '')?.id, 'b');
});

test('都沒有時回傳 null', () => {
  assert.equal(findTitleAutoTemplate([{ id: 'x', label: '無關', productName: '無關' }], ''), null);
  assert.equal(findTitleAutoTemplate([], ''), null);
  assert.equal(findTitleAutoTemplate(undefined, ''), null);
});

import { backfillTitleTemplateImages } from '../src/js/utils.js';

test('回填：範本無原圖時先從既有票券adopt，再補給缺原圖的同名票券', () => {
  const tasks = [
    { id: '1', productName: '85度C 35元飲品', originalImage: 'data:orig', image: 'data:thumb' },
    { id: '2', productName: '85度C 35元飲品', originalImage: '', image: '' },
    { id: '3', productName: '天仁茗茶', originalImage: '', image: '' },
  ];
  const tpls = [{ id: 'd', label: '預設', productName: '85度C 35元飲品' }];
  const r = backfillTitleTemplateImages(tasks, tpls, 'd');
  assert.equal(r.templateChanged, true);
  assert.equal(tpls[0].originalImage, 'data:orig');
  assert.equal(r.tasksChanged, 1);
  assert.equal(tasks[1].originalImage, 'data:orig');
  assert.equal(tasks[1].image, 'data:thumb');
  assert.equal(tasks[2].originalImage, '');
});

test('回填：範本已有原圖時直接補票券，範本不變', () => {
  const tasks = [{ id: '1', productName: '【85度C】飲品', originalImage: '', image: 'x' }];
  const tpls = [{ id: 'd', label: '預設', productName: '85度C', originalImage: 'data:tpl' }];
  const r = backfillTitleTemplateImages(tasks, tpls, 'd');
  assert.equal(r.templateChanged, false);
  assert.equal(r.tasksChanged, 1);
  assert.equal(tasks[0].originalImage, 'data:tpl');
  assert.equal(tasks[0].image, 'x');
});

test('回填：無來源原圖時不更動', () => {
  const tasks = [{ id: '1', productName: '85度C 飲品', originalImage: '', image: '' }];
  const tpls = [{ id: 'd', label: '預設', productName: '85度C' }];
  const r = backfillTitleTemplateImages(tasks, tpls, 'd');
  assert.deepEqual(r, { templateChanged: false, tasksChanged: 0 });
});
