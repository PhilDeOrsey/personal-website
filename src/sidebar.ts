import { nav, type NavItem } from './nav';

const BASE = import.meta.env.BASE_URL;

const isExternal = (href: string): boolean => /^(https?:)?\/\//.test(href);

const resolveUrl = (href: string): string => (isExternal(href) ? href : BASE + href);

const escape = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

const normalizePath = (p: string): string => (p.endsWith('/') ? p : `${p}/`);

const isCurrent = (item: NavItem, here: string): boolean => {
  if (item.href === undefined || isExternal(item.href)) return false;
  return normalizePath(resolveUrl(item.href)) === here;
};

const containsCurrent = (item: NavItem, here: string): boolean =>
  isCurrent(item, here) || (item.children?.some((c) => containsCurrent(c, here)) ?? false);

const renderLeaf = (item: NavItem, here: string): string => {
  const href = item.href ?? '';
  const external = isExternal(href);
  const attrs = external
    ? ' target="_blank" rel="noopener noreferrer"'
    : isCurrent(item, here)
      ? ' aria-current="page"'
      : '';
  const indicator = external ? '<span class="ext" aria-hidden="true">↗</span>' : '';
  return `<li><a href="${resolveUrl(href)}"${attrs}>${escape(item.label)}${indicator}</a></li>`;
};

const renderItem = (item: NavItem, here: string): string => {
  if (item.children) {
    const open = item.children.some((c) => containsCurrent(c, here)) ? ' open' : '';
    const kids = item.children.map((c) => renderItem(c, here)).join('');
    return `<li class="nav-group"><details${open}><summary>${escape(item.label)}</summary><ul class="nav-sublist">${kids}</ul></details></li>`;
  }
  return renderLeaf(item, here);
};

export const renderSidebar = (target: HTMLElement): void => {
  const here = normalizePath(window.location.pathname);
  target.innerHTML = `<nav aria-label="Primary"><ul class="nav-list">${nav.map((i) => renderItem(i, here)).join('')}</ul></nav>`;
};
