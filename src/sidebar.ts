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
    const isOpen = item.children.some((c) => containsCurrent(c, here));
    const detailsAttrs = isOpen ? ' open class="expanded"' : '';
    const kids = item.children.map((c) => renderItem(c, here)).join('');
    return `<li class="nav-group"><details${detailsAttrs}><summary>${escape(item.label)}</summary><ul class="nav-sublist">${kids}</ul></details></li>`;
  }
  return renderLeaf(item, here);
};

const attachAccordion = (root: HTMLElement): void => {
  const groups = root.querySelectorAll<HTMLDetailsElement>('.nav-group details');
  groups.forEach((details) => {
    const summary = details.querySelector<HTMLElement>('summary');
    const sublist = details.querySelector<HTMLElement>('.nav-sublist');
    if (!summary || !sublist) return;

    summary.addEventListener('click', (event) => {
      event.preventDefault();
      const isOpen = details.hasAttribute('open');

      if (isOpen) {
        details.classList.remove('expanded');
        sublist.style.height = `${sublist.scrollHeight}px`;
        void sublist.offsetHeight;
        sublist.style.height = '0px';

        const onEnd = (e: TransitionEvent): void => {
          if (e.propertyName !== 'height') return;
          sublist.removeEventListener('transitionend', onEnd);
          details.removeAttribute('open');
          sublist.style.height = '';
        };
        sublist.addEventListener('transitionend', onEnd);
      } else {
        details.setAttribute('open', '');
        const target = sublist.scrollHeight;
        sublist.style.height = '0px';
        void sublist.offsetHeight;
        details.classList.add('expanded');
        sublist.style.height = `${target}px`;

        const onEnd = (e: TransitionEvent): void => {
          if (e.propertyName !== 'height') return;
          sublist.removeEventListener('transitionend', onEnd);
          sublist.style.height = '';
        };
        sublist.addEventListener('transitionend', onEnd);
      }
    });
  });
};

export const renderSidebar = (target: HTMLElement): void => {
  const here = normalizePath(window.location.pathname);
  target.innerHTML = `<nav aria-label="Primary"><ul class="nav-list">${nav.map((i) => renderItem(i, here)).join('')}</ul></nav>`;
  attachAccordion(target);
};
