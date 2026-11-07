export class Router {
  constructor(app) {
    this.app = app;
    this.routes = new Map();
    this.routeCache = new Map();
    this.currentHash = null;
  }

  register(hash, loader) {
    this.routes.set(hash, loader);
  }

  start() {
    window.addEventListener('hashchange', () => this.renderRoute());
    this.renderRoute();
  }

  getCurrentHash() {
    const hash = (window.location.hash || '#active').replace(/^#/, '');
    if (hash === 'home' || hash === 'wallet') return 'active';
    return hash;
  }

  async renderRoute() {
    const route = this.getCurrentHash();
    if (!this.routes.has(route)) {
      window.location.hash = 'active';
      return;
    }

    const previousHash = this.currentHash;
    if (this.currentHash === 'add' && route !== 'add' && this.app?.state?.ui) {
      this.app.state.ui.editingTicketId = null;
      this.app.state.ui.editingFromRoute = null;
    }

    this.currentHash = route;
    this.app.setActiveNav(route);

    const page = await this.resolveRoute(route);
    await page.render();
    if (previousHash !== route) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.getElementById('app-container')?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    }
  }

  async resolveRoute(route) {
    if (this.routeCache.has(route)) {
      return this.routeCache.get(route);
    }

    const loader = this.routes.get(route);
    const page = typeof loader === 'function' ? await loader() : loader;
    this.routeCache.set(route, page);
    return page;
  }
}

