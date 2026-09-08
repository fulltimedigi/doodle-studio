// Extract Open Doodles (CC0) SVGs from the react-open-doodles package into assets/illustrations/open-doodles
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Doodles from 'react-open-doodles';
import { writeFileSync } from 'node:fs';
let n = 0;
for (const [name, Comp] of Object.entries(Doodles)) {
  if (typeof Comp !== 'function' && typeof Comp !== 'object') continue;
  try {
    const svg = renderToStaticMarkup(React.createElement(Comp, { ink: '#1a1a1a', accent: '#f4a261' }));
    if (!svg.startsWith('<svg')) continue;
    const file = name.replace(/Doodle$/, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    writeFileSync(`assets/illustrations/open-doodles/${file}.svg`, svg); n++;
  } catch (e) { console.error(name, e.message); }
}
console.log('open-doodles exported', n);
