import { DB_KEYS, defaultSettings, normalizeTicket, GLASS_CARD_OPACITY, LEGACY_DEFAULT_CARD_OPACITY } from '../utils.js';
import { encryptOmniPassBackup, decryptOmniPassBackup, SCAN_SUCCESS_SOUNDS } from './omniCoreService.js';

export class DataService {
  constructor() {
    this.dbName = 'WalletFreshDB';
    this.storeName = 'kv_store';
    this.db = null;
  }

  compactViewConfig(input = {}, fallback = {}) {
    const normalizedInput = input && typeof input === 'object' ? input : {};
    const normalizedFallback = fallback && typeof fallback === 'object' ? fallback : {};
    const backgroundImages = Array.isArray(normalizedInput.backgroundImages)
      ? normalizedInput.backgroundImages.filter(Boolean)
      : [];
    const legacyBackgroundImage = typeof normalizedInput.backgroundImage === 'string'
      ? normalizedInput.backgroundImage.trim()
      : '';
    if (!backgroundImages.length && legacyBackgroundImage) {
      backgroundImages.push(legacyBackgroundImage);
    }

    const rawCardOpacity = Number.isFinite(Number(normalizedInput.cardOpacity))
      ? Math.max(0, Math.min(1, Number(normalizedInput.cardOpacity)))
      : Number.isFinite(Number(normalizedFallback.cardOpacity))
        ? Number(normalizedFallback.cardOpacity)
        : GLASS_CARD_OPACITY;
    // One-time migration (v1.6.1): a stored opacity equal to the old
    // default means the user never customized it, so move it to the
    // glass default once. The marker keeps a later deliberate choice
    // of the same value intact.
    const cardOpacity = rawCardOpacity === LEGACY_DEFAULT_CARD_OPACITY
      && normalizedInput.cardOpacityGlassMigrated !== true
      ? GLASS_CARD_OPACITY
      : rawCardOpacity;

    return {
      ...normalizedFallback,
      cardOpacityGlassMigrated: true,
      showBackground: normalizedInput.showBackground !== false,
      bgOpacity: Number.isFinite(Number(normalizedInput.bgOpacity))
        ? Math.max(0, Math.min(1, Number(normalizedInput.bgOpacity)))
        : Number.isFinite(Number(normalizedFallback.bgOpacity))
          ? Number(normalizedFallback.bgOpacity)
          : 1,
      cardOpacity,
      cardBgColor: normalizedInput.cardBgColor || normalizedFallback.cardBgColor || '#ffffff',
      cardBorderColor: normalizedInput.cardBorderColor || normalizedFallback.cardBorderColor || '#d7e3f0',
      cardHeight: Number.isFinite(Number(normalizedInput.cardHeight))
        ? Math.max(0, Math.min(360, Number(normalizedInput.cardHeight)))
        : Number.isFinite(Number(normalizedFallback.cardHeight))
          ? Number(normalizedFallback.cardHeight)
          : 0,
      gridImageHeight: Number.isFinite(Number(normalizedInput.gridImageHeight))
        ? Math.max(44, Math.min(220, Number(normalizedInput.gridImageHeight)))
        : Number.isFinite(Number(normalizedFallback.gridImageHeight))
          ? Number(normalizedFallback.gridImageHeight)
          : 84,
      thumbnailScale: Number.isFinite(Number(normalizedInput.thumbnailScale))
        ? Math.max(10, Math.min(100, Number(normalizedInput.thumbnailScale)))
        : Number.isFinite(Number(normalizedInput.gridImageHeight))
          ? Math.max(10, Math.min(100, Math.round((Number(normalizedInput.gridImageHeight) / 84) * 100)))
          : Number.isFinite(Number(normalizedFallback.thumbnailScale))
            ? Number(normalizedFallback.thumbnailScale)
            : 100,
      gridColumns: [1, 2, 3].includes(Number(normalizedInput.gridColumns))
        ? Number(normalizedInput.gridColumns)
        : [1, 2, 3].includes(Number(normalizedFallback.gridColumns))
          ? Number(normalizedFallback.gridColumns)
          : 2,
      showThumbnail: normalizedInput.showThumbnail !== false,
      ultraCompactCard: normalizedInput.ultraCompactCard === true,
      backgroundImage: '',
      backgroundImages: [...new Set(backgroundImages)],
    };
  }

  compactSettings(inputSettings = {}) {
    const source = inputSettings && typeof inputSettings === 'object'
      ? inputSettings
      : {};
    const base = defaultSettings;
    const sourceViewConfigs = source.viewConfigs && typeof source.viewConfigs === 'object'
      ? source.viewConfigs
      : {};
    const baseViewConfigs = base.viewConfigs || {};
    const shouldUseNewDefaultTitle = !source.appTitle || source.appTitle === '輕鬆票券' || source.appTitle === 'Vouchy';
    const soundKey = typeof source.scanSuccessSound === 'string' && SCAN_SUCCESS_SOUNDS[source.scanSuccessSound]
      ? source.scanSuccessSound
      : 'market';
    const quickPasses = Array.isArray(source.quickPasses) && source.quickPasses.length
      ? source.quickPasses.map((item, idx) => ({
          id: item?.id || `qp_${idx}`,
          label: String(item?.label || '常用條碼').trim(),
          code: String(item?.code || '').trim(),
          format: String(item?.format || 'CODE_128'),
          enabled: Boolean(item?.enabled && item?.code),
        }))
      : base.quickPasses;

    return {
      tgToken: source.tgToken || '',
      tgChatId: source.tgChatId || '',
      notifyDays: Math.max(1, Number(source.notifyDays || base.notifyDays || 7)),
      appTitle: shouldUseNewDefaultTitle ? (base.appTitle || '歐米票夾 OmniTrunk') : source.appTitle,
      swipeGesturesEnabled: source.swipeGesturesEnabled !== false,
      swipeTriggerDistance: Number.isFinite(Number(source.swipeTriggerDistance))
        ? Math.max(40, Math.min(120, Number(source.swipeTriggerDistance)))
        : base.swipeTriggerDistance,
      specificViewKeywords: Array.isArray(source.specificViewKeywords) && source.specificViewKeywords.length
        ? source.specificViewKeywords.filter(Boolean).map((item) => String(item))
        : [...(base.specificViewKeywords || [])],
      scanSuccessSound: soundKey,
      quickPasses,
      redeemUrlPresets: Array.isArray(source.redeemUrlPresets)
        ? source.redeemUrlPresets
        : [],
      defaultTemplateId: typeof source.defaultTemplateId === 'string'
        ? source.defaultTemplateId
        : '',
      quickTags: Array.isArray(source.quickTags)
        ? source.quickTags.filter(Boolean).map((item) => String(item))
        : [],
      localBackupFileName: source.localBackupFileName || base.localBackupFileName || 'omnitrunk_backup',
      viewConfigs: {
        active: this.compactViewConfig(sourceViewConfigs.active || {}, baseViewConfigs.active || {}),
        completed: this.compactViewConfig(sourceViewConfigs.completed || {}, baseViewConfigs.completed || {}),
        deleted: this.compactViewConfig(sourceViewConfigs.deleted || {}, baseViewConfigs.deleted || {}),
      },
    };
  }

  async init() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = () => reject(request.error);
    });
    await this.migrateFromLegacyLocalStorage();
    await this.removeItem(DB_KEYS.BG_HISTORY);
    return this.db;
  }

  convertLegacyDataFormat(oldData) {
    const records = [];
    if (!oldData || typeof oldData !== 'object') return records;

    for (const year of Object.keys(oldData)) {
      const months = oldData[year];
      if (!months || typeof months !== 'object') continue;
      for (const month of Object.keys(months)) {
        const days = months[month];
        if (!days || typeof days !== 'object') continue;
        for (const day of Object.keys(days)) {
          const dayData = days[day] || {};

          if (dayData.OutType && typeof dayData.OutType === 'object') {
            for (const category of Object.keys(dayData.OutType)) {
              const categoryData = dayData.OutType[category];
              if (!Array.isArray(categoryData?.money)) continue;
              for (let i = 1; i < categoryData.money.length; i += 1) {
                records.push(normalizeTicket({
                  productName: `[支出] ${category}`,
                  serial: '',
                  expiry: '',
                  note: categoryData.description?.[i] || '',
                  tags: [category],
                  completed: false,
                  isDeleted: false,
                  createdAt: new Date(`${year}-${month}-${day}`).getTime() + i,
                }));
              }
            }
          }

          if (dayData.InType && typeof dayData.InType === 'object') {
            for (const category of Object.keys(dayData.InType)) {
              const categoryData = dayData.InType[category];
              if (!Array.isArray(categoryData?.money)) continue;
              for (let i = 1; i < categoryData.money.length; i += 1) {
                records.push(normalizeTicket({
                  productName: `[收入] ${category}`,
                  serial: '',
                  expiry: '',
                  note: categoryData.description?.[i] || '',
                  tags: [category],
                  completed: false,
                  isDeleted: false,
                  createdAt: new Date(`${year}-${month}-${day}`).getTime() + i,
                }));
              }
            }
          }
        }
      }
    }

    return records;
  }

  async migrateFromLegacyLocalStorage() {
    const existingTasks = await this.getItem(DB_KEYS.TASKS);
    if (Array.isArray(existingTasks) && existingTasks.length > 0) return;

    const oldPayload = localStorage.getItem('AllTheData');
    if (!oldPayload) return;

    try {
      const parsed = JSON.parse(oldPayload);
      const migratedTasks = this.convertLegacyDataFormat(parsed);
      if (migratedTasks.length > 0) {
        await this.setItem(DB_KEYS.TASKS, migratedTasks);
        localStorage.setItem('AllTheData_backup', oldPayload);
        localStorage.removeItem('AllTheData');
      }
    } catch (_error) {
      // Ignore malformed legacy payloads
    }
  }

  async getItem(key) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async setItem(key, value) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async removeItem(key) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllKeys() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async loadState() {
    const [tasks, settings, templates, expiryNotified] = await Promise.all([
      this.getItem(DB_KEYS.TASKS),
      this.getItem(DB_KEYS.SETTINGS),
      this.getItem(DB_KEYS.TEMPLATES),
      this.getItem(DB_KEYS.EXPIRY_NOTIFIED),
    ]);

    const normalizedTasks = Array.isArray(tasks) ? tasks.map(normalizeTicket) : [];
    const mergedSettings = this.compactSettings(settings || defaultSettings);

    return {
      tasks: normalizedTasks,
      settings: mergedSettings,
      templates: Array.isArray(templates) ? templates : [],
      expiryNotified: expiryNotified && typeof expiryNotified === 'object' ? expiryNotified : {},
    };
  }

  sanitizeLoadedState(state) {
    const rawTasks = Array.isArray(state?.tasks) ? state.tasks : [];
    const sanitizedTasks = [];
    const seenIds = new Set();
    let removedInvalidTasks = 0;
    let removedDuplicateIds = 0;

    [...rawTasks]
      .sort((a, b) => (Number(b?.createdAt) || 0) - (Number(a?.createdAt) || 0))
      .forEach((ticket) => {
        const normalized = normalizeTicket(ticket);
        if (!normalized.id || !normalized.productName?.trim()) {
          removedInvalidTasks += 1;
          return;
        }
        if (seenIds.has(normalized.id)) {
          removedDuplicateIds += 1;
          return;
        }
        seenIds.add(normalized.id);
        sanitizedTasks.push(normalized);
      });

    const sanitizedExpiryNotified = {};
    let removedOrphanExpiryNotified = 0;
    Object.entries(state?.expiryNotified && typeof state.expiryNotified === 'object' ? state.expiryNotified : {}).forEach(([ticketId, value]) => {
      if (!seenIds.has(ticketId)) {
        removedOrphanExpiryNotified += 1;
        return;
      }
      sanitizedExpiryNotified[ticketId] = value;
    });

    const changed = removedInvalidTasks > 0
      || removedDuplicateIds > 0
      || removedOrphanExpiryNotified > 0
      || sanitizedTasks.length !== rawTasks.length
      || JSON.stringify(sanitizedExpiryNotified) !== JSON.stringify(state?.expiryNotified || {});

    return {
      changed,
      state: {
        ...state,
        tasks: sanitizedTasks,
        expiryNotified: sanitizedExpiryNotified,
      },
      report: {
        removedInvalidTasks,
        removedDuplicateIds,
        removedOrphanExpiryNotified,
      },
    };
  }

  async saveState(partialState) {
    const jobs = [];
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(partialState, key);

    if (hasOwn('tasks')) {
      jobs.push(this.setItem(DB_KEYS.TASKS, (partialState.tasks || []).map(normalizeTicket)));
    }
    if (hasOwn('settings')) {
      jobs.push(this.setItem(DB_KEYS.SETTINGS, this.compactSettings(partialState.settings || defaultSettings)));
    }
    if (hasOwn('templates')) {
      jobs.push(this.setItem(DB_KEYS.TEMPLATES, partialState.templates || []));
    }
    if (hasOwn('expiryNotified')) {
      jobs.push(this.setItem(DB_KEYS.EXPIRY_NOTIFIED, partialState.expiryNotified || {}));
    }
    if (hasOwn('bgHistory')) {
      jobs.push(this.removeItem(DB_KEYS.BG_HISTORY));
    }
    await Promise.all(jobs);
  }

  async exportAllData() {
    const [tasks, settings, templates, expiryNotified] = await Promise.all([
      this.getItem(DB_KEYS.TASKS),
      this.getItem(DB_KEYS.SETTINGS),
      this.getItem(DB_KEYS.TEMPLATES),
      this.getItem(DB_KEYS.EXPIRY_NOTIFIED),
    ]);

    return {
      version: 3,
      timestamp: Date.now(),
      tasks: Array.isArray(tasks) ? tasks : [],
      settings: this.compactSettings(settings || defaultSettings),
      templates: Array.isArray(templates) ? templates : [],
      expiryNotified: expiryNotified || {},
    };
  }

  async exportEncryptedBackup(password) {
    const payload = await this.exportAllData();
    const envelope = await encryptOmniPassBackup(payload, password);
    await this.recordBackup();
    return { envelope, count: payload.tasks.length };
  }

  async importEncryptedBackup(envelopeOrJson, password, mode = 'append', restoreSettings = true) {
    const decrypted = await decryptOmniPassBackup(envelopeOrJson, password);
    // Also support native OmniPass stores.cards format if user imports an original OmniPass .opbackup
    if (!Array.isArray(decrypted.tasks) && Array.isArray(decrypted?.stores?.cards)) {
      decrypted.tasks = decrypted.stores.cards.map((card) => normalizeTicket({
        id: `omni_${card.id || Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        productName: `${card.store ? `[${card.store}] ` : ''}${card.name || card.customType || '歐米通卡券'}`,
        serial: card.barcode || card.number || '',
        expiry: card.expiryDate || '',
        barcodeFormat: card.barcodeType === 'code39' ? 'CODE_39' : 'CODE_128',
        tags: [card.store, card.type].filter(Boolean),
        note: card.note || (card.balance != null ? `餘額: $${card.balance}` : ''),
        completed: card.usageStatus === 'archived',
        createdAt: card.createdAt ? new Date(card.createdAt).getTime() : Date.now(),
      }));
    }
    return this.importData(decrypted, mode, restoreSettings);
  }

  async importData(rawData, mode = 'append', restoreSettings = true) {
    const current = await this.loadState();

    const incomingTasks = Array.isArray(rawData)
      ? rawData
      : Array.isArray(rawData.tasks)
        ? rawData.tasks
        : [];

    const normalizedIncoming = incomingTasks.map(normalizeTicket);
    let nextTasks;
    if (mode === 'overwrite') {
      nextTasks = normalizedIncoming;
    } else {
      const buildSignature = (ticket) => JSON.stringify({
        productName: (ticket.productName || '').trim(),
        serial: (ticket.serial || '').trim(),
        expiry: (ticket.expiry || '').trim(),
        note: (ticket.note || '').trim(),
        redeemUrl: (ticket.redeemUrl || '').trim(),
        barcodeFormat: ticket.barcodeFormat || '',
        tags: Array.isArray(ticket.tags) ? [...ticket.tags].sort() : [],
        completed: !!ticket.completed,
        completedAt: ticket.completedAt || 0,
        isDeleted: !!ticket.isDeleted,
        deletedAt: ticket.deletedAt || 0,
        pinned: !!ticket.pinned,
        createdAt: ticket.createdAt || 0,
      });

      const map = new Map(current.tasks.map((t) => [t.id, t]));
      const signatureSet = new Set(current.tasks.map((ticket) => buildSignature(ticket)));

      for (const item of normalizedIncoming) {
        if (map.has(item.id)) {
          map.set(item.id, item);
          signatureSet.add(buildSignature(item));
          continue;
        }

        const signature = buildSignature(item);
        if (signatureSet.has(signature)) {
          continue;
        }

        map.set(item.id, item);
        signatureSet.add(signature);
      }
      nextTasks = [...map.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    const nextState = {
      tasks: nextTasks,
      templates: Array.isArray(rawData.templates)
        ? rawData.templates
        : current.templates,
      expiryNotified: rawData.expiryNotified && typeof rawData.expiryNotified === 'object'
        ? rawData.expiryNotified
        : current.expiryNotified,
    };

    if (restoreSettings && rawData.settings && typeof rawData.settings === 'object') {
      nextState.settings = this.compactSettings({
        ...current.settings,
        ...rawData.settings,
        viewConfigs: {
          ...current.settings.viewConfigs,
          ...(rawData.settings.viewConfigs || {}),
        },
      });
    } else {
      nextState.settings = this.compactSettings(current.settings);
    }

    await this.saveState(nextState);
    return nextState;
  }

  async checkDataHealth() {
    const issues = [];
    const recommendations = [];
    const keys = await this.getAllKeys();
    const [tasks, settings, lastBackup] = await Promise.all([
      this.getItem(DB_KEYS.TASKS),
      this.getItem(DB_KEYS.SETTINGS),
      this.getItem(DB_KEYS.LAST_BACKUP),
    ]);

    if (!keys.includes(DB_KEYS.TASKS)) {
      issues.push('缺少票券資料索引');
    }

    if (!keys.includes(DB_KEYS.SETTINGS)) {
      recommendations.push('建議初始化設定資料');
    }

    if (settings != null && typeof settings !== 'object') {
      issues.push('設定資料格式異常');
    }

    if (tasks && !Array.isArray(tasks)) {
      issues.push('票券資料格式異常');
    }

    if (Array.isArray(tasks)) {
      const invalid = tasks.filter((t) => !t.id || !t.productName);
      if (invalid.length > 0) {
        issues.push(`${invalid.length} 張票券資料不完整`);
      }

      const idMap = new Map();
      for (const ticket of tasks) {
        if (!ticket?.id) continue;
        idMap.set(ticket.id, (idMap.get(ticket.id) || 0) + 1);
      }
      const duplicateIds = [...idMap.values()].filter((count) => count > 1).length;
      if (duplicateIds > 0) {
        issues.push(`偵測到 ${duplicateIds} 組重複票券 ID`);
      }

      const serialMap = new Map();
      tasks.forEach((ticket) => {
        if (ticket?.isDeleted || !ticket?.serial) return;
        serialMap.set(ticket.serial, (serialMap.get(ticket.serial) || 0) + 1);
      });
      const duplicateSerialGroups = [...serialMap.values()].filter((count) => count > 1).length;
      if (duplicateSerialGroups > 0) {
        recommendations.push(`有 ${duplicateSerialGroups} 組序號重複，建議人工確認`);
      }
    }

    const storage = await navigator.storage?.estimate?.();
    const totalSize = storage?.usage || 0;
    const storageQuota = storage?.quota || 0;
    if (storageQuota > 0) {
      const usagePercent = (totalSize / storageQuota) * 100;
      if (usagePercent > 80) {
        recommendations.push(`儲存空間使用率偏高 (${usagePercent.toFixed(1)}%)，建議先匯出備份`);
      }
    }

    const now = Date.now();
    if (!lastBackup) {
      recommendations.push('尚未建立本機備份，建議先匯出 .opbackup 加密備份或 JSON');
    } else if (now - Number(lastBackup) > 7 * 24 * 60 * 60 * 1000) {
      recommendations.push('距離上次備份已超過 7 天，建議重新備份');
    }

    let isPersisted;
    if (navigator.storage?.persisted) {
      isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        recommendations.push('建議啟用持久化儲存，降低瀏覽器清理導致資料遺失風險');
      }
    }

    return {
      isHealthy: issues.length === 0,
      totalKeys: keys.length,
      totalSize,
      storageQuota,
      lastBackup: lastBackup || undefined,
      isPersisted,
      issues,
      recommendations,
    };
  }

  async cleanupResidualData() {
    await this.init();
    const beforeEstimate = await navigator.storage?.estimate?.();
    const beforeUsage = Number(beforeEstimate?.usage || 0);
    const beforeKeys = await this.getAllKeys();

    const removedKeys = [];
    if (beforeKeys.includes(DB_KEYS.BG_HISTORY)) {
      await this.removeItem(DB_KEYS.BG_HISTORY);
      removedKeys.push(DB_KEYS.BG_HISTORY);
    }

    const [tasksRaw, settingsRaw, templatesRaw, expiryRaw] = await Promise.all([
      this.getItem(DB_KEYS.TASKS),
      this.getItem(DB_KEYS.SETTINGS),
      this.getItem(DB_KEYS.TEMPLATES),
      this.getItem(DB_KEYS.EXPIRY_NOTIFIED),
    ]);

    const tasks = Array.isArray(tasksRaw) ? tasksRaw.map(normalizeTicket) : [];
    const validTaskIds = new Set(tasks.map((ticket) => ticket.id).filter(Boolean));
    const expiryNotified = expiryRaw && typeof expiryRaw === 'object' ? expiryRaw : {};
    const compactedExpiryNotified = {};
    let removedExpiryNotifiedCount = 0;
    Object.entries(expiryNotified).forEach(([ticketId, value]) => {
      if (!validTaskIds.has(ticketId)) {
        removedExpiryNotifiedCount += 1;
        return;
      }
      compactedExpiryNotified[ticketId] = value;
    });

    const compactedSettings = this.compactSettings(settingsRaw || defaultSettings);
    const settingsCompacted = JSON.stringify(settingsRaw || {}) !== JSON.stringify(compactedSettings);
    const expiryCompacted = JSON.stringify(expiryNotified) !== JSON.stringify(compactedExpiryNotified);

    const writeJobs = [];
    if (settingsCompacted) {
      writeJobs.push(this.setItem(DB_KEYS.SETTINGS, compactedSettings));
    }
    if (expiryCompacted) {
      writeJobs.push(this.setItem(DB_KEYS.EXPIRY_NOTIFIED, compactedExpiryNotified));
    }
    await Promise.all(writeJobs);

    const afterEstimate = await navigator.storage?.estimate?.();
    const afterUsage = Number(afterEstimate?.usage || 0);

    return {
      removedKeys,
      removedExpiryNotifiedCount,
      settingsCompacted,
      templateCount: Array.isArray(templatesRaw) ? templatesRaw.length : 0,
      beforeUsage,
      afterUsage,
      reclaimedBytes: Math.max(0, beforeUsage - afterUsage),
    };
  }

  async requestPersistentStorage() {
    if (!navigator.storage?.persist) return false;
    return navigator.storage.persist();
  }

  async recordBackup() {
    await this.setItem(DB_KEYS.LAST_BACKUP, Date.now());
  }
}

