import { narrowImports } from './scripts/fix-imports.mjs';
const cases = {
  'alias: a as b used, c unused': ["import { a as b, c } from './lib/x.js';", 'export default b();', ''].join('\n'),
  'shared line: dropped import + export on one line': ["import { gone } from './lib/g.js'; export const k = 1;", 'export default k;', ''].join('\n'),
  'comment inside braces': ['import {', '  a, // keep me', '  c, /* drop me */', "} from './lib/x.js';", 'export default a();', ''].join('\n'),
  'template literal that looks like imports + blank runs': ["import { z } from './core/z.js';", "import { a } from './lib/x.js';", '', '', '', 'const t = `', "import { z } from './core/z.js';", '', '', '', '`;', 'export default a(t);', ''].join('\n'),
  'multi-line import dropped whole': ["import { keep } from './lib/k.js';", 'import {', '  gone1,', '  gone2,', "} from './domain/g.js';", "import { keep2 } from './lib/k2.js';", 'export default keep() + keep2();', ''].join('\n'),
};
for (const [name, src] of Object.entries(cases)) {
  const r = narrowImports(src);
  console.log(`--- ${name}: dropped=${r.dropped} changed=${r.src !== src}`);
  if (r.src !== src) console.log(r.src.split('\n').map((l) => '    | ' + l).join('\n'));
}
