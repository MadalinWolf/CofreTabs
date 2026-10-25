/**
 * Message names shared by the service worker, content panel and library page.
 * The content script cannot import ES modules, so it repeats these strings;
 * keep both sides in sync when changing them.
 */
export const MSG = Object.freeze({
  PANEL_INIT: 'cofre:panel-init',
  PANEL_PING: 'cofre:panel-ping',
  PANEL_CLOSE: 'cofre:panel-close',
  SAVE_TAB: 'cofre:save-tab',
  PANEL_SNAPSHOT: 'cofre:panel-snapshot',
  SEARCH: 'cofre:search',
  TRASH_TAB: 'cofre:trash-tab',
  RESTORE_TAB: 'cofre:restore-tab',
  TOGGLE_FAVORITE: 'cofre:toggle-favorite',
  OPEN_URL: 'cofre:open-url',
  OPEN_LIBRARY: 'cofre:open-library',
  REFRESH_BADGE: 'cofre:refresh-badge',
});
