import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  SCAN_SUCCESS_SOUNDS,
  detectInAppBrowser,
  validateBackupPassword,
  encryptOmniPassBackup,
  decryptOmniPassBackup,
  generateCode128Bars,
  generateCode39Bars,
} from '../src/js/services/omniCoreService.js';
import { DataService } from '../src/js/services/dataService.js';

test('OmniPass In-App Browser 偵測規則支援 LINE / FB / IG / Threads / WeChat / TikTok / X', () => {
  assert.equal(detectInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Line/14.5.0'), 'LINE');
  assert.equal(detectInAppBrowser('Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/450.0]'), 'Facebook');
  assert.equal(detectInAppBrowser('Mozilla/5.0 (iPhone) Instagram 320.0'), 'Instagram');
  assert.equal(detectInAppBrowser('Mozilla/5.0 (iPhone) Barcelona 310.0'), 'Threads');
  assert.equal(detectInAppBrowser('Mozilla/5.0 MicroMessenger/8.0.47'), 'WeChat');
  assert.equal(detectInAppBrowser('Mozilla/5.0 musical_ly_33.0'), 'TikTok');
  assert.equal(detectInAppBrowser('Mozilla/5.0 Twitter for iPhone'), 'X');
  assert.equal(detectInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1'), null);
});

test('OmniPass 掃描音效包含 5 種 Web Audio 預設合成音色', () => {
  assert.deepEqual(Object.keys(SCAN_SUCCESS_SOUNDS), ['market', 'register', 'digital', 'chime', 'classic']);
});

test('OmniPass 加密備份密碼驗證規則（至少 8 碼且兩次一致）', () => {
  assert.equal(validateBackupPassword('1234567').valid, false);
  assert.equal(validateBackupPassword('12345678', '87654321').valid, false);
  assert.equal(validateBackupPassword('omnipass2026', 'omnipass2026').valid, true);
});

test('OmniPass PBKDF2-SHA256 + AES-256-GCM (.opbackup) 加解密與防竄改驗證', async () => {
  const samplePayload = {
    version: 3,
    tasks: [
      { id: 't_1', productName: '85度C 55元飲品券', serial: 'E8500012345', expiry: '2027/12/31', pinned: true },
    ],
    settings: { scanSuccessSound: 'register' },
  };
  // Use 10,000 iterations in unit test for fast execution while verifying full PBKDF2 + AES-GCM pipeline
  const envelope = await encryptOmniPassBackup(samplePayload, 'omnitrunk-secret-99', { iterations: 10000 });
  assert.equal(envelope.format, BACKUP_FORMAT);
  assert.equal(envelope.version, BACKUP_VERSION);
  assert.equal(envelope.kdf.name, 'PBKDF2');
  assert.equal(envelope.kdf.hash, 'SHA-256');
  assert.equal(envelope.cipher.name, 'AES-GCM');

  const decrypted = await decryptOmniPassBackup(envelope, 'omnitrunk-secret-99');
  assert.equal(decrypted.tasks.length, 1);
  assert.equal(decrypted.tasks[0].productName, '85度C 55元飲品券');
  assert.equal(decrypted.tasks[0].serial, 'E8500012345');

  await assert.rejects(
    () => decryptOmniPassBackup(envelope, 'wrong-password-99'),
    /密碼錯誤或備份檔已損毀/,
  );
});

test('Pure-JS CODE128 與 CODE39 條碼寬度序列產生器', () => {
  const c128 = generateCode128Bars('E8500012345');
  assert.ok(c128.length > 20);
  const c39 = generateCode39Bars('/ABC1234');
  assert.ok(c39.length > 20);
});

test('DataService.compactSettings 保留 OmniPass 音效與結帳前置條碼設定', () => {
  const svc = new DataService();
  const compacted = svc.compactSettings({
    scanSuccessSound: 'register',
    quickPasses: [
      { id: 'qp_carrier', label: '手機條碼載具', code: '/NEO1234', format: 'CODE_39', enabled: true },
    ],
  });
  assert.equal(compacted.scanSuccessSound, 'register');
  assert.equal(compacted.quickPasses[0].code, '/NEO1234');
  assert.equal(compacted.quickPasses[0].enabled, true);
});

