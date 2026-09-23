// Every canonical case, in the order the runner walks them. The order is a
// reading order only — each case gets its own module graph, so none of them can
// depend on one that ran before it.
import { cases as privacy } from './privacy.mjs';
import { cases as surface } from './surface.mjs';
import { cases as startup } from './startup.mjs';
import { cases as ads } from './ads.mjs';
import { cases as purchases } from './purchases.mjs';
import { cases as lifecycleAndLinks } from './lifecycle-and-links.mjs';

export const cases = [
  ...surface,
  ...privacy,
  ...startup,
  ...ads,
  ...purchases,
  ...lifecycleAndLinks,
];
