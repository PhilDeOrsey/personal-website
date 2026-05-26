import { nav, type NavItem } from './nav';

const BASE = import.meta.env.BASE_URL;

const url = (path: string): string => BASE + path;

const escape = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

const normalizePath = (p: string): string => (p.endsWith('/') ? p : `${p}/`);

const isCurrent = (item: NavItem, here: string): boolean =>
  item.href !== undefined && normalizePath(url(item.href)) === here;

const containsCurrent = (item: NavItem, here: string): boolean =>
  isCurrent(item, here) || (item.children?.some((c) => containsCurrent(c, here)) ?? false);

const renderItem = (item: NavItem, here: string): string => {
  if (item.children) {
    const open = item.children.some((c) => containsCurrent(c, here)) ? ' open' : '';
    const kids = item.children.map((c) => renderItem(c, here)).join('');
    return `<li class="nav-group"><details${open}><summary>${escape(item.label)}</summary><ul class="nav-sublist">${kids}</ul></details></li>`;
  }
  const current = isCurrent(item, here) ? ' aria-current="page"' : '';
  return `<li><a href="${url(item.href ?? '')}"${current}>${escape(item.label)}</a></li>`;
};

export const renderSidebar = (target: HTMLElement): void => {
  const here = normalizePath(window.location.pathname);
  target.innerHTML = `<nav aria-label="Primary"><ul class="nav-list">${nav.map((i) => renderItem(i, here)).join('')}</ul></nav>`;
};
