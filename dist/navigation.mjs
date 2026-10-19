// Pages keep their parent and view state; short actions sit above that page.
export const overlayRoutes = new Set(['confirm', 'message-actions', 'respond', 'record', 'chat-create']);
const identity = route => [route.name, route.key || '', route.id || '', route.kind || '', route.replyTo || '', route.owner || ''].join(':');

export class PhoneNavigation {
  constructor() { this.reset(); }
  get current() { return this.entries.at(-1); }
  get page() { return this.entries.findLast(entry => !overlayRoutes.has(entry.name)); }
  get canBack() { return this.entries.length > 1; }
  go(next) {
    const index = this.entries.findLastIndex(entry => identity(entry) === identity(next));
    if (index >= 0) {
      this.entries.splice(index + 1);
      Object.assign(this.current, next);
    } else {
      if (overlayRoutes.has(this.current.name) && next.name !== 'confirm') this.entries.pop();
      if (next.name === 'conversation' && ['new-chat', 'new-group'].includes(this.current.name)) this.entries.pop();
      this.entries.push({ ...next });
    }
    return this.current;
  }
  back() { if (!this.canBack) return false; this.entries.pop(); return true; }
  reset(pages = []) { this.entries = [{ name: 'home' }, ...pages.map(page => ({ ...page }))]; }
}
