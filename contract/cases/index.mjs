// Every canonical case, in the order the runner walks them. The order is a
// reading order only — each case gets its own module graph, so none of them can
// depend on one that ran before it.
import { cases as surface } from './surface.mjs';

export const cases = [
  ...surface,
];
