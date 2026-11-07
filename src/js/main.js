import { DataService } from './services/dataService.js';
import { refreshBatchTicketImages, personalizeBorrowedTemplateImages, refreshGeneratedTicketImages } from './services/batchImportService.js';
import {
  detectInAppBrowser,
  isInAppBrowserBannerDismissed,
  dismissInAppBrowserBanner,
} from './services/omniCoreService.js';
import { Router } from './router.js';
import {
  checkIsExpiringSoon,
  DB_KEYS,
  defaultSettings,
  formatDateTime,
  getClientSourceLabel,
  sendTelegramMessage,
  showToast,
  todayISO,
  backfillTitleTemplateImages,
  getNavVisibility,
} from './utils.js';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '2.0.0-omnitrunk';
const APP_UPDATED_AT = typeof __APP_UPDATED_AT__ !== 'undefined' ? __APP_UPDATED_AT__ : '2026-11-07';

const pageLoaders = {
  active: async (app) => {
    const { TicketsPage } = await import('./pages/ticketsPage.js');
    return new TicketsPage(app, 'active');
  },
  completed: async (app) => {
    const { TicketsPage } = await import('./pages/ticketsPage.js');
    return new TicketsPage(app, 'completed');
  },
  deleted: async (app) => {
    const { TicketsPage } = await import('./pages/ticketsPage.js');
    return new TicketsPage(app, 'deleted');
  },
  checkout: async (app) => {
    const { CheckoutPage } = await import('./pages/checkoutPage.js');
    return new CheckoutPage(app);
  },
  summary: async (app) => {
    const { SummaryPage } = await import('./pages/summaryPage.js');
    return new SummaryPage(app);
  },
  add: async (app) => {
    const { AddPage } = await import('./pages/addPage.js');
    return new AddPage(app);
  },
  settings: async (app) => {
    const { SettingsPage } = await import('./pages/settingsPage.js');
    return new SettingsPage(app);
  },
};

class OmniTrunkApp {
  constructor() {
    this.dataService = new DataService();
    this.root = document.getElementById('app-container');

    this.state = {
      tasks: [],
      settings: { ...defaultSettings },
      templates: [],
      expiryNotified: {},
      ui: {
        search: '',
        sort: 'expiring',
        activeTags: [],
        selectedTags: [],
        quickFilter: 'all',
        selectionMode: false,
        keepSelectionMode: false,
        selectedIds: new Set(),
        editingTicketId: null,
        editingFromRoute: null,
      },
    };

    this.router = new Router(this);
    this.mobileViewportBound = false;
    this.startupCleanupReport = null;
  }

  async init() {
    this.setupInAppBrowserBanner();
    await this.dataService.init();
    const state = await this.dataService.loadState();
    const sanitized = this.dataService.sanitizeLoadedState(state);
    this.state = {
      ...this.state,
      ...sanitized.state,
      settings: {
        ...defaultSettings,
        ...(sanitized.state.settings || {}),
      },
    };
    this.startupCleanupReport = sanitized.report;

    if (sanitized.changed) {
      await this.dataService.saveState({
        tasks: this.state.tasks,
        expiryNotified: this.state.expiryNotified,
      });
    }

    try {
      const backfill = backfillTitleTemplateImages(
        this.state.tasks,
        this.state.templates,
        this.state.settings.defaultTemplateId,
      );
      if (backfill.templateChanged) await this.persistTemplates();
      if (backfill.tasksChanged > 0) {
        await this.persistTasks();
      }
    } catch (error) {
      console.warn('[OmniTrunk] title template backfill failed:', error);
    }

    try {
      const personalized = await personalizeBorrowedTemplateImages(
        this.state.tasks,
        this.state.templates,
        this.state.settings.defaultTemplateId,
      );
      if (personalized.changed > 0) {
        this.state.tasks = personalized.tasks;
        await this.persistTasks();
      }
    } catch (error) {
      console.warn('[OmniTrunk] personalize borrowed template images failed:', error);
    }

    try {
      const refreshedGenerated = await refreshGeneratedTicketImages(this.state.tasks);
      if (refreshedGenerated.changed > 0) {
        this.state.tasks = refreshedGenerated.tasks;
        await this.persistTasks();
      }
    } catch (error) {
      console.warn('[OmniTrunk] refresh generated ticket images failed:', error);
    }

    const refreshedBatchImages = await refreshBatchTicketImages(this.state.tasks);
    if (refreshedBatchImages.changed) {
      this.state.tasks = refreshedBatchImages.tasks;
      await this.dataService.saveState({
        tasks: this.state.tasks,
        expiryNotified: this.state.expiryNotified,
      });
      showToast('已更新批量票券圖片與期限', 'success', 2600);
    }

    await this.ensureRequiredKeys();
    await this.sendExpiryReminderIfNeeded();

    this.router.register('active', () => pageLoaders.active(this));
    this.router.register('completed', () => pageLoaders.completed(this));
    this.router.register('deleted', () => pageLoaders.deleted(this));
    this.router.register('checkout', () => pageLoaders.checkout(this));
    this.router.register('summary', () => pageLoaders.summary(this));
    this.router.register('add', () => pageLoaders.add(this));
    this.router.register('settings', () => pageLoaders.settings(this));

    this.router.start();
    this.bindGlobalNavEvents();
    this.bindMobileViewportHandlers();
    if (this.startupCleanupReport && (
      this.startupCleanupReport.removedInvalidTasks > 0
      || this.startupCleanupReport.removedDuplicateIds > 0
      || this.startupCleanupReport.removedOrphanExpiryNotified > 0
    )) {
      const hints = [];
      if (this.startupCleanupReport.removedInvalidTasks > 0) hints.push(`異常票券 ${this.startupCleanupReport.removedInvalidTasks} 張`);
      if (this.startupCleanupReport.removedDuplicateIds > 0) hints.push(`重複 ID ${this.startupCleanupReport.removedDuplicateIds} 筆`);
      if (this.startupCleanupReport.removedOrphanExpiryNotified > 0) hints.push(`殘留提醒 ${this.startupCleanupReport.removedOrphanExpiryNotified} 筆`);
      showToast(`已清理：${hints.join('、')}`, 'success', 2600);
    }
    showToast('歐米票夾 OmniTrunk 已就緒', 'success');
  }

  setupInAppBrowserBanner() {
    const banner = document.getElementById('inAppBrowserBanner');
    if (!banner) return;
    const browserName = detectInAppBrowser();
    if (!browserName || isInAppBrowserBannerDismissed()) {
      banner.classList.add('hidden');
      return;
    }
    const nameNode = document.getElementById('inAppBrowserName');
    if (nameNode) nameNode.textContent = browserName;
    banner.classList.remove('hidden');

    document.getElementById('inAppCopyUrlBtn')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        showToast('已複製網址，請以 Safari 或 Chrome 開啟', 'success');
      } catch {
        showToast(window.location.href, 'info');
      }
    });
    document.getElementById('inAppDismissBtn')?.addEventListener('click', () => {
      dismissInAppBrowserBanner();
      banner.classList.add('hidden');
    });
  }

  getRoot() {
    return this.root;
  }

  mount(html) {
    this.root.innerHTML = html;
  }

  updateNavVisibility() {
    this.syncNavVisibility();
  }

  syncNavVisibility() {
    const visibility = getNavVisibility(this.state.tasks);
    document.querySelector('.nav-item[data-page="completed"]')
      ?.classList.toggle('nav-item--hidden', !visibility.showCompleted);
    document.querySelector('.nav-item[data-page="deleted"]')
      ?.classList.toggle('nav-item--hidden', !visibility.showDeleted);
  }

  setActiveNav(route) {
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.page === route);
    });
    this.syncNavVisibility();
    const versionInfo = document.getElementById('sidebar-version-info');
    if (versionInfo) {
      versionInfo.textContent = `歐米票夾 OmniTrunk v${APP_VERSION} · ${APP_UPDATED_AT}`;
    }
  }

  bindGlobalNavEvents() {
    const addNav = document.querySelector('.nav-item[data-page="add"]');
    addNav?.addEventListener('click', () => {
      this.state.ui.editingTicketId = null;
      this.state.ui.editingFromRoute = null;
    });
  }

  bindMobileViewportHandlers() {
    if (this.mobileViewportBound) return;
    this.mobileViewportBound = true;

    const updateKeyboardInset = () => {
      if (typeof window === 'undefined') return;
      const viewport = window.visualViewport;
      if (!viewport) {
        document.documentElement.style.setProperty('--keyboard-inset-height', '0px');
        document.body.classList.remove('keyboard-open');
        return;
      }
      const inset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      document.documentElement.style.setProperty('--keyboard-inset-height', '0px');
      document.body.classList.toggle('keyboard-open', inset > 80);
    };

    document.addEventListener('focusin', () => updateKeyboardInset(), true);
    document.addEventListener('focusout', () => window.setTimeout(updateKeyboardInset, 120), true);
    window.visualViewport?.addEventListener('resize', updateKeyboardInset);
    window.visualViewport?.addEventListener('scroll', updateKeyboardInset);
    window.addEventListener('orientationchange', () => window.setTimeout(updateKeyboardInset, 200));
    updateKeyboardInset();
  }

  async ensureRequiredKeys() {
    const keys = await this.dataService.getAllKeys();
    const jobs = [];
    if (!keys.includes(DB_KEYS.TASKS)) jobs.push(this.dataService.setItem(DB_KEYS.TASKS, []));
    if (!keys.includes(DB_KEYS.SETTINGS)) jobs.push(this.dataService.setItem(DB_KEYS.SETTINGS, this.state.settings));
    if (!keys.includes(DB_KEYS.TEMPLATES)) jobs.push(this.dataService.setItem(DB_KEYS.TEMPLATES, this.state.templates));
    if (!keys.includes(DB_KEYS.EXPIRY_NOTIFIED)) jobs.push(this.dataService.setItem(DB_KEYS.EXPIRY_NOTIFIED, this.state.expiryNotified));
    await Promise.all(jobs);
  }

  async persistState(partialState) {
    await this.dataService.saveState(partialState);
  }

  async persistTasks() {
    await this.dataService.saveState({ tasks: this.state.tasks });
  }

  async persistSettings() {
    await this.dataService.saveState({ settings: this.state.settings });
  }

  async persistTemplates() {
    await this.dataService.saveState({ templates: this.state.templates });
  }

  async sendRedeemNotification(ticket) {
    const { tgToken, tgChatId } = this.state.settings;
    if (!tgToken || !tgChatId) return;
    if (!ticket?.completed) return;

    const text = `✅ *[已核銷]* ${ticket.productName}\n🔢 序號: ${ticket.serial || '無'}\n⏰ 時間: ${formatDateTime(ticket.completedAt || Date.now())}`;
    await sendTelegramMessage(tgToken, tgChatId, text);
  }

  async sendBatchRedeemNotification(tickets) {
    const { tgToken, tgChatId } = this.state.settings;
    if (!tgToken || !tgChatId) return;
    if (!Array.isArray(tickets) || tickets.length === 0) return;

    if (tickets.length === 1) {
      await this.sendRedeemNotification(tickets[0]);
      return;
    }

    const lines = tickets
      .slice(0, 8)
      .map((ticket) => `• ${ticket.productName} (${ticket.serial || '無序號'})`)
      .join('\n');
    const tail = tickets.length > 8 ? `\n…其餘 ${tickets.length - 8} 張略` : '';
    const text = `✅ *[批次核銷]* 共 ${tickets.length} 張票券\n${lines}${tail}`;
    await sendTelegramMessage(tgToken, tgChatId, text);
  }

  async sendExpiryReminderIfNeeded() {
    const { tgToken, tgChatId, notifyDays } = this.state.settings;
    if (!tgToken || !tgChatId) return;

    const today = todayISO();
    const expiring = this.state.tasks.filter(
      (t) => !t.completed && !t.isDeleted && t.expiry && checkIsExpiringSoon(t.expiry, notifyDays) && this.state.expiryNotified[t.id] !== today
    );

    if (!expiring.length) return;

    const lines = expiring
      .sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1))
      .map((t) => `• ${t.pinned ? '📌 ' : ''}${t.productName}（${t.expiry}）${t.serial ? `｜${t.serial}` : ''}`)
      .join('\n');

    const pinnedCount = expiring.filter((x) => x.pinned).length;
    const sourceLabel = getClientSourceLabel();
    const text = `⏰ *[到期提醒]* 共 ${expiring.length} 張快到期${pinnedCount ? `（含 ${pinnedCount} 張優先）` : ''}：\n${lines}\n\n來源：${sourceLabel}`;

    const result = await sendTelegramMessage(tgToken, tgChatId, text);
    if (!result.success) return;

    expiring.forEach((ticket) => {
      this.state.expiryNotified[ticket.id] = today;
    });

    const validIds = new Set(this.state.tasks.map((t) => t.id));
    Object.keys(this.state.expiryNotified).forEach((id) => {
      if (!validIds.has(id)) delete this.state.expiryNotified[id];
    });

    await this.dataService.saveState({ expiryNotified: this.state.expiryNotified });
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const app = new OmniTrunkApp();
  window.app = app;
  try {
    await app.init();
  } catch (error) {
    console.error(error);
    showToast(`啟動失敗：${error.message}`, 'error');
    document.getElementById('app-container').innerHTML = `
      <div class="p-6 text-center">
        <h1 class="text-xl font-bold text-red-700 mb-2">啟動失敗</h1>
        <p class="text-sm text-slate-600">${error.message}</p>
      </div>
    `;
  }
});

