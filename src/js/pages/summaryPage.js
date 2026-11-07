import { escapeHtml, checkIsExpiringSoon } from '../utils.js';

export class SummaryPage {
  constructor(app) {
    this.app = app;
  }

  async render() {
    const container = document.getElementById('app-container');
    if (!container) return;

    const tasks = Array.isArray(this.app.state.tasks) ? this.app.state.tasks : [];
    const notifyDays = Number(this.app.state.settings?.notifyDays || 7);

    const active = tasks.filter((t) => !t.completed && !t.isDeleted);
    const completed = tasks.filter((t) => t.completed && !t.isDeleted);
    const deleted = tasks.filter((t) => t.isDeleted);
    const pinned = active.filter((t) => t.pinned);
    const withOriginal = active.filter((t) => Boolean(t.originalImage));
    const expiringSoon = active.filter((t) => checkIsExpiringSoon(t.expiry, notifyDays));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expired = active.filter((t) => {
      if (!t.expiry) return false;
      const d = new Date(t.expiry.replace(/[.\-]/g, '/'));
      return !Number.isNaN(d.getTime()) && d.getTime() < today.getTime();
    });

    const tagCounts = new Map();
    for (const t of active) {
      for (const tag of t.tags || []) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);

    const serialCounts = new Map();
    for (const t of active) {
      if (!t.serial) continue;
      serialCounts.set(t.serial, (serialCounts.get(t.serial) || 0) + 1);
    }
    const duplicateGroups = [...serialCounts.values()].filter((c) => c > 1).length;

    container.innerHTML = `
      <div class="page max-w-2xl mx-auto px-4 pt-3 pb-28 space-y-4">
        <div class="omni-hero-card rounded-2xl p-5 text-white shadow-xl">
          <div class="text-xs font-bold uppercase tracking-wider text-indigo-200">OmniPass × TaskTrunk 資產總覽</div>
          <div class="mt-2 flex items-baseline justify-between">
            <div>
              <span class="text-4xl font-black tabular-nums">${active.length}</span>
              <span class="text-sm text-indigo-100 ml-1.5 font-semibold">張待使用票券</span>
            </div>
            <a href="#checkout" class="px-3.5 py-2 rounded-xl bg-white text-indigo-900 font-extrabold text-xs shadow hover:bg-indigo-50 transition">
              <i class="fa-solid fa-bolt mr-1"></i>進入結帳連刷
            </a>
          </div>

          <div class="grid grid-cols-3 gap-2.5 mt-4">
            <div class="rounded-xl bg-white/12 border border-white/15 p-3">
              <div class="text-[11px] text-indigo-200 font-semibold">${notifyDays}天內到期</div>
              <div class="text-xl font-black tabular-nums text-amber-300 mt-0.5">${expiringSoon.length}</div>
            </div>
            <div class="rounded-xl bg-white/12 border border-white/15 p-3">
              <div class="text-[11px] text-indigo-200 font-semibold">已逾期未用</div>
              <div class="text-xl font-black tabular-nums text-rose-300 mt-0.5">${expired.length}</div>
            </div>
            <div class="rounded-xl bg-white/12 border border-white/15 p-3">
              <div class="text-[11px] text-indigo-200 font-semibold">已核銷封存</div>
              <div class="text-xl font-black tabular-nums text-emerald-300 mt-0.5">${completed.length}</div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="bg-white/95 rounded-2xl p-4 border border-slate-200 shadow">
            <div class="text-xs font-bold text-slate-500">📌 置頂優先票券</div>
            <div class="text-2xl font-black text-slate-900 mt-1 tabular-nums">${pinned.length}</div>
            <div class="text-[11px] text-slate-400 mt-0.5">僅未使用票券保留置頂</div>
          </div>
          <div class="bg-white/95 rounded-2xl p-4 border border-slate-200 shadow">
            <div class="text-xs font-bold text-slate-500">🖼️ 含原圖截圖票券</div>
            <div class="text-2xl font-black text-slate-900 mt-1 tabular-nums">${withOriginal.length}</div>
            <div class="text-[11px] text-slate-400 mt-0.5">支援原圖/標準/MOMO三視圖</div>
          </div>
          <div class="bg-white/95 rounded-2xl p-4 border border-slate-200 shadow">
            <div class="text-xs font-bold text-slate-500">⚠️ 序號重複組數</div>
            <div class="text-2xl font-black ${duplicateGroups > 0 ? 'text-amber-600' : 'text-slate-900'} mt-1 tabular-nums">${duplicateGroups}</div>
            <div class="text-[11px] text-slate-400 mt-0.5">自動偵測有效票券重複序號</div>
          </div>
          <div class="bg-white/95 rounded-2xl p-4 border border-slate-200 shadow">
            <div class="text-xs font-bold text-slate-500">🗑️ 回收桶暫存</div>
            <div class="text-2xl font-black text-slate-900 mt-1 tabular-nums">${deleted.length}</div>
            <div class="text-[11px] text-slate-400 mt-0.5">可隨時還原或永久清除</div>
          </div>
        </div>

        <div class="bg-white/95 rounded-2xl p-4 border border-slate-200 shadow space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-extrabold text-slate-900">標籤分類統計 (#Tags)</h2>
            <span class="text-xs text-slate-500">${sortedTags.length} 個分類</span>
          </div>
          ${sortedTags.length ? `
            <div class="flex flex-wrap gap-2">
              ${sortedTags.map(([tag, count]) => `
                <button type="button" data-summary-tag="${escapeHtml(tag)}" class="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-800 text-xs font-bold flex items-center gap-1.5 transition">
                  <span>#${escapeHtml(tag)}</span>
                  <span class="px-1.5 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] tabular-nums">${count}</span>
                </button>
              `).join('')}
            </div>
          ` : `
            <p class="text-xs text-slate-400 py-2">尚未為待使用票券加上標籤，可於新增/編輯或批次工具列中加入 #標籤。</p>
          `}
        </div>
      </div>
    `;

    container.querySelectorAll('[data-summary-tag]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tag = btn.getAttribute('data-summary-tag');
        if (!tag) return;
        this.app.state.ui.selectedTags = [tag];
        this.app.state.ui.quickFilter = 'all';
        window.location.hash = 'active';
      });
    });
  }
}

