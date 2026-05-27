export type NavItem = {
  label: string;
  href?: string;
  children?: NavItem[];
};

export const nav: NavItem[] = [
  { label: 'Home', href: '' },
  {
    label: 'Academic Work',
    children: [
      { label: 'Publications', href: 'publications/' },
      { label: 'Math Circles', href: 'https://sites.google.com/site/westernmassachusettsmathcircle' },
    ],
  },
  {
    label: 'Projects',
    children: [
      { label: 'Project 1', href: 'projects/project1/' },
      { label: 'Project 2', href: 'projects/project2/' },
    ],
  },
];
