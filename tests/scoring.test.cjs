const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const html = readFileSync(process.env.APP_HTML || require('node:path').join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Execute the shipped script and its actual event handlers, with small DOM/storage doubles.
function app(saved) {
  const elements = new Map(), alerts = [], storage = new Map();
  if (saved) storage.set('oceans11-v1', JSON.stringify(saved));
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', disabled: false });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element },
    localStorage: { getItem: key => storage.get(key), setItem: (key, val) => storage.set(key, val) },
    alert: msg => alerts.push(msg), confirm: () => true, window: {},
  });
  vm.runInContext(script, context);
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

test('a twelfth selection is disabled, automatically skipped, and rejected by the handler', () => {
  const a = app(round(12, [prior(player(), 11, 11)]));
  assert.equal(a.state().players[0].choices[11], false);
  assert.match(a.element('entry').innerHTML, /value="yes" disabled/);
  a.change('entry', { choice: '1' }, 'yes');
  assert.equal(a.state().players[0].choices.filter(Boolean).length, 11);
  assert.equal(a.state().players[0].choices[11], false);
  assert.match(a.alerts.at(-1), /already selected 11/);
});

test('the selection handler refuses a twelfth count even when invoked directly', () => {
  const a = app(round(12, [prior(player(), 11, 11)]));
  a.change('entry', { choice: '1' }, 'yes');
  assert.equal(a.state().players[0].choices.filter(Boolean).length, 11);
});

test('a counted mandatory hole cannot be changed to skipped', () => {
  const p = prior(player(), 0, 7); p.choices[7] = true;
  const a = app(round(8, [p]));
  a.change('entry', { choice: '1' }, 'no');
  assert.equal(a.state().players[0].choices[7], true);
});

test('the eleventh current selection can be changed before advancing', () => {
  const a = app(round(11, [prior(player(), 10, 10)]));
  a.change('entry', { choice: '1' }, 'yes');
  assert.equal(a.state().players[0].choices.filter(Boolean).length, 11);
  a.change('entry', { choice: '1' }, 'no');
  assert.equal(a.state().players[0].choices.filter(Boolean).length, 10);
  a.change('entry', { choice: '1' }, 'yes');
  a.change('entry', { score: '1' }, 4);
  a.element('next').onclick();
  assert.equal(a.state().hole, 12);
  assert.equal(a.state().players[0].choices[11], false);
});

test('seven opening skips force hole 8 and prevent skipping or clearing it', () => {
  const a = app(round(8, [prior(player(), 0, 7)]));
  assert.equal(a.state().players[0].choices[7], true);
  assert.match(a.element('entry').innerHTML, /value="no"\s+disabled/);
  for (const choice of ['no', '']) {
    a.change('entry', { choice: '1' }, choice);
    assert.equal(a.state().players[0].choices[7], true);
  }
});

test('advancing into mandatory holes automatically counts each remaining hole', () => {
  const a = app(round(7, [prior(player(), 0, 6)]));
  a.change('entry', { score: '1' }, 4);
  a.change('entry', { choice: '1' }, 'no');
  a.element('next').onclick();
  for (let hole = 8; hole <= 18; hole++) {
    assert.equal(a.state().players[0].choices[hole - 1], true);
    a.change('entry', { score: '1' }, 4);
    assert.equal(a.element('next').disabled, false);
    a.element('next').onclick();
  }
  assert.equal(a.state().players[0].choices.filter(Boolean).length, 11);
  assert.match(a.alerts.at(-1), /Round complete/);
});

test('golfer choices remain independent when one is capped and another is forced', () => {
  const a = app(round(12, [prior(player(1), 11, 11), prior(player(2), 4, 11)]));
  assert.equal(a.state().players[0].choices[11], false);
  assert.equal(a.state().players[1].choices[11], true);
  a.change('entry', { choice: '1' }, 'yes');
  a.change('entry', { choice: '2' }, 'no');
  assert.equal(a.state().players[0].choices[11], false);
  assert.equal(a.state().players[1].choices[11], true);
});

test('next cannot bypass incomplete or invalid scores and decisions', () => {
  const a = app(round(1));
  for (const score of ['', 0, -1, 31, 4.5, 'abc']) {
    a.change('entry', { score: '1' }, score);
    a.change('entry', { choice: '1' }, 'yes');
    assert.equal(a.element('next').disabled, true);
    a.element('next').onclick();
    assert.equal(a.state().hole, 1);
  }
  a.change('entry', { score: '1' }, 30);
  a.change('entry', { choice: '1' }, '');
  assert.equal(a.element('next').disabled, true);
  a.change('entry', { choice: '1' }, 'no');
  a.element('next').onclick();
  assert.equal(a.state().hole, 2);
});

test('next rejects an empty roster', () => {
  const a = app(round(1, []));
  a.element('next').onclick();
  assert.equal(a.state().hole, 1);
});

test('finishing rejects previously saved totals above or below eleven without deleting scores', () => {
  for (const count of [9, 12]) {
    const r = round(18, [prior(player(), count, 18)]), a = app(r);
    assert.equal(a.element('next').disabled, true);
    a.element('next').onclick();
    assert.ok(!a.alerts.some(msg => msg.includes('Round complete')));
    assert.deepEqual(a.state().players[0], r.players[0]);
  }
});

test('finishing accepts eleven with either a counted or skipped final hole', () => {
  for (const count of [10, 11]) {
    const a = app(round(18, [prior(player(), count, 17)]));
    a.change('entry', { score: '1' }, 4);
    assert.equal(a.element('next').disabled, false);
    a.element('next').onclick();
    assert.match(a.alerts.at(-1), /Round complete/);
    assert.equal(a.state().players[0].choices.filter(Boolean).length, 11);
  }
});

test('manual index edits atomically swap rankings, persist, and preserve other round data', () => {
  const r = round(5, [prior(player(1, 19), 3, 4)]), a = app(r);
  a.change('courseholes', { index: '0' }, 18);
  const changed = a.state();
  assert.equal(changed.indexes[0], 18);
  assert.equal(changed.indexes[17], 1);
  assert.equal(new Set(changed.indexes).size, 18);
  assert.deepEqual({ ...changed, indexes: r.indexes }, r);
  assert.deepEqual(a.saved(), changed);
  assert.deepEqual(app(a.saved()).state(), changed);
});

test('all 324 individual hole/ranking swaps keep a permutation of 1–18', () => {
  const a = app(round(1));
  a.run(`for(let i=0;i<18;i++)for(let value=1;value<=18;value++){
    let before=s.indexes.slice(),other=before.indexOf(value);
    if(!swapIndex(i,value)||s.indexes[i]!==value||s.indexes[other]!==before[i]||new Set(s.indexes).size!==18)throw Error('Invalid swap');
    for(let j=0;j<18;j++)if(j!==i&&j!==other&&s.indexes[j]!==before[j])throw Error('Unrelated ranking changed');
  }`);
});

test('invalid ranking values and hole numbers cannot corrupt the scorecard', () => {
  const a = app(round(1)), before = a.state();
  for (const val of [0, 19, 1.5, 'abc']) a.change('courseholes', { index: '0' }, val);
  assert.equal(a.run('swapIndex(-1,1)'), false);
  assert.equal(a.run('swapIndex(18,1)'), false);
  assert.deepEqual(a.state(), before);
});

test('full course handicaps allocate exactly their total strokes from -18 through 54', () => {
  const a = app();
  for (let hcp = -18; hcp <= 54; hcp++) {
    assert.equal(a.run(`Array.from({length:18},(_,i)=>strokes(${hcp},i+1)).reduce((a,b)=>a+b,0)`), hcp);
  }
  for (const [hcp, index, expected] of [[0,1,0],[18,18,1],[19,1,2],[19,2,1],[36,18,2],[54,18,3],[-1,18,-1],[-1,1,0],[-18,1,-1]]) {
    assert.equal(a.run(`strokes(${hcp},${index})`), expected);
  }
});

test('index swaps update handicap allocation and selected net versus par without changing gross scores', () => {
  const p = player(1, 19); p.scores[0] = 5; p.choices[0] = true;
  p.scores[1] = 10; p.choices[1] = false;
  const a = app(round(2, [p]));
  assert.equal(a.run('total(s.players[0])'), -1);
  a.change('courseholes', { index: '0' }, 18);
  assert.equal(a.run('total(s.players[0])'), 0);
  assert.deepEqual(a.state().players[0], p);
});

test('valid saved rounds reopen unchanged, including all prior scores and choices', () => {
  const r = round(9, [prior(player(1, -1), 5, 8), prior(player(2, 54), 7, 8)]);
  const a = app(r);
  assert.deepEqual(a.state(), r);
  assert.deepEqual(a.saved(), r);
});

test('verified JSON import remains available and rejects duplicate rankings', () => {
  const a = app(), indexes = Array.from({ length: 18 }, (_, i) => 18 - i);
  a.element('scorejson').value = JSON.stringify({ pars: Array(18).fill(5), strokeIndexes: indexes });
  a.element('importscore').onclick();
  assert.deepEqual(a.state().indexes, indexes);
  assert.deepEqual(a.state().pars, Array(18).fill(5));
  const before = a.state();
  a.element('scorejson').value = JSON.stringify({ pars: Array(18).fill(4), strokeIndexes: Array(18).fill(1) });
  a.element('importscore').onclick();
  assert.deepEqual(a.state(), before);
  assert.match(a.element('lookupstatus').textContent, /Import failed/);
});

test('AI course lookup still previews and applies a verified scorecard', async () => {
  const a = app();
  a.run(`fetch=async()=>({ok:true,text:async()=>JSON.stringify({courseName:'Verified course',tee:'White',ranking:'men',sourceUrl:'https://example.com/card',pars:Array(18).fill(5),strokeIndexes:Array.from({length:18},(_,i)=>18-i)})})`);
  for (const [id, val] of [['lookupname','Test'],['lookuplocation','Auburn, AL'],['lookuptees','White'],['lookupranking','men']]) a.element(id).value = val;
  await a.element('lookup').onclick();
  assert.match(a.element('lookupstatus').textContent, /Review the source/);
  a.element('applylookup').onclick();
  assert.equal(a.state().course, 'Verified course');
  assert.deepEqual(a.state().indexes, Array.from({ length: 18 }, (_, i) => 18 - i));
  assert.equal(a.element('lookup').disabled, false);
});

test('every reachable 18-hole decision path ends at exactly eleven selections', () => {
  const a = app();
  const paths = a.run(`(()=>{
    let completed=0,p={choices:Array(18).fill(null)};
    function visit(i){
      if(i===18){if(selected(p)!==11)throw Error('Wrong final count');completed++;return}
      for(const value of [true,false]){
        p.choices[i]=null;
        if(setChoice(p,i,value)){
          if(selected(p)>11||selected(p)+17-i<11)throw Error('Invalid selection path');
          visit(i+1);
        }
        p.choices[i]=null;
      }
    }
    visit(0);return completed;
  })()`);
  assert.equal(paths, 31824); // 18 choose 11
});
