const cov = require('../coverage/coverage-final.json');
const target = process.argv[2] || 'block-kit.ts';
const key = Object.keys(cov).find(k => k.includes(target));
if (!key) { console.log('not found'); process.exit(); }
const d = cov[key];
const sm = d.statementMap;
const sc = d.s;
const uncov = [];
for (const id of Object.keys(sc)) {
  if (sc[id] === 0) uncov.push({ id, line: sm[id].start.line });
}
console.log('Uncovered statements:', uncov.length);
const lines = [...new Set(uncov.map(u => u.line))].sort((a,b)=>a-b);
console.log('Lines:', lines.join(', '));
