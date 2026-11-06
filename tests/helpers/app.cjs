const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const html = readFileSync(process.env.APP_HTML || require('node:path').join(__dirname, '../../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Execute the shipped script and its actual event handlers, with small DOM/storage doubles.
function app(saved, options = {}) {
  const elements = new Map(), alerts = [], storage = new Map();
  if (saved) storage.set('oceans11-v1', JSON.stringify(saved));
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', disabled: false, hidden: false, checked: false });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element },
    localStorage: { getItem: key => storage.get(key), setItem: (key, val) => storage.set(key, val) },
    alert: msg => alerts.push(msg), confirm: () => true, window: {}, AbortSignal,
    fetch: options.fetch || (async () => { throw Error('Offline'); }), ...options.globals,
  });
  vm.runInContext(script, context);
  element('lookupranking').value = 'men';
  if (html.includes('src="course-library.js"')) vm.runInContext(readFileSync(require('node:path').join(__dirname, '../../course-library.js'), 'utf8'), context);
  return {
    run: code => vm.runInContext(code, context), element, alerts,
    saved: () => JSON.parse(storage.get('oceans11-v1')),
    state: () => JSON.parse(vm.runInContext('JSON.stringify(s)', context)),
    load: state => vm.runInContext(`s=${JSON.stringify(state)};render()`, context),
    change: (id, dataset, value) => element(id).onchange({ target: { dataset, value: String(value) } }),
  };
}
function player(id = 1, hcp = 0) {
  return { id, name: `Golfer ${id}`, hcp, scores: Array(18).fill(null), choices: Array(18).fill(null) };
}
function round(hole, players = [player()]) {
  return { course: 'Test course', date: '2026-11-05', hole, pars: Array(18).fill(4), indexes: Array.from({ length: 18 }, (_, i) => i + 1), players };
}
function prior(p, count, through) {
  for (let i = 0; i < through; i++) { p.choices[i] = i < count; p.scores[i] = 4; }
  return p;
}


module.exports = { app, player, round, prior };
