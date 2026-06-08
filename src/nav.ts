export type NavItem = {
  label: string;
  href?: string;
  children?: NavItem[];
};

export const nav: NavItem[] = [
  { label: 'Home', href: '' },
  { label: 'About', href: 'about/' },
  {
    label: 'Academic Work',
    children: [
      { label: 'Publications', href: 'publications/' },
      { label: 'CV', href: 'cv/' },
      { label: 'Math Circles', href: 'math-circles/' },
    ],
  },
  { label: 'Projects', href: 'projects/' },
];
