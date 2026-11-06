const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler: createCourses } = require('../netlify/lib/course-catalog.cjs');
const { createHandler: createReader } = require('../netlify/functions/scorecard-read.js');
const card = (overrides = {}) => ({ courseName:'Auburn Test Club', location:'Auburn, AL', tee:'White', ranking:'men',
  pars:Array(18).fill(4), strokeIndexes:Array.from({length:18}, (_,i)=>i+1), ...overrides });
const parse = r => JSON.parse(r.body);
const event = (body, method = 'POST') => ({ httpMethod:method, body:JSON.stringify(body) });
function database() {
  const records = new Map();
  const store = {
    async setJSON(key, value, { onlyIfNew }) {
      if (onlyIfNew && records.has(key)) return { modified:false };
      records.set(key, structuredClone(value)); return { modified:true };
    },
    async get(key) { return records.has(key) ? structuredClone(records.get(key)) : null; },
    async list() { return { blobs:[...records.keys()].map(key=>({key})) }; },
  };
  return { records, client:() => createCourses({ storeForEvent:()=>store, now:()=> '2026-11-06T00:00:00Z' }) };
}
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const photo = (overrides={}) => ({image,ranking:'men',tee:'White',...overrides});
const provider = value => async () => ({ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]})});
const reader = request => createReader({ fetch:request || provider(card()),env:{OPENAI_API_KEY:'test-key'} });

test('reviewed course survives separate client instances and is available to another golfer', async () => {
  const db = database(), saved = await db.client()(event({...card(),reviewed:true}));
  assert.equal(saved.statusCode,201);
  const loaded = parse(await db.client()({httpMethod:'GET',queryStringParameters:{q:'Auburn'}}));
  assert.equal(loaded.courses.length,1);
  assert.deepEqual(loaded.courses[0],parse(saved).course);
});

test('identical concurrent submissions create one durable record and preserve the first metadata', async () => {
  const db=database(), a=db.client(), b=db.client();
  const results=await Promise.all([a(event({...card(),reviewed:true})),b(event({...card({courseName:'AUBURN TEST CLUB',tee:'white'}),reviewed:true}))]);
  assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,201]);
  assert.equal(db.records.size,1);
  assert.deepEqual(parse(results[0]).course,parse(results[1]).course);
});

test('tee sets, men/women rows and corrected hole values remain separate records', async () => {
  const db=database(), handle=db.client();
  for (const c of [card(),card({tee:'Blue'}),card({ranking:'women'}),card({pars:Array(18).fill(5)})]) {
    assert.equal((await handle(event({...c,reviewed:true}))).statusCode,201);
  }
  assert.equal(db.records.size,4);
});

test('public records omit photo bytes, personal golfer data and arbitrary extra fields', async () => {
  const db=database(), response=await db.client()(event({...card(),reviewed:true,image,players:[{name:'Private',scores:[5]}],notes:'private'}));
  const saved=parse(response).course;
  assert.deepEqual(Object.keys(saved).sort(),['courseName','createdAt','id','location','pars','ranking','source','strokeIndexes','tee'].sort());
  assert.equal(JSON.stringify([...db.records.values()]).includes('Private'),false);
});

test('catalog rejects unreviewed cards, missing metadata, duplicate indexes, nonintegers and incomplete cards', async () => {
  const db=database(), handle=db.client();
  for (const invalid of [null,card(),{...card(),reviewed:false},...[
    {courseName:''},{location:''},{tee:''},{ranking:'mixed'},{pars:Array(18).fill(4.5)},
    {pars:[4]},{strokeIndexes:Array(18).fill(1)},{strokeIndexes:Array.from({length:18},(_,i)=>i+2)},
  ].map(overrides=>({...card(overrides),reviewed:true}))]) {
    assert.equal((await handle(event(invalid))).statusCode,400);
  }
  assert.equal(db.records.size,0);
});

test('catalog search and pagination do not omit a second page of matching courses', async () => {
  const db=database(), handle=db.client();
  for (let i=0;i<35;i++) await handle(event({...card({courseName:'Club '+String(i).padStart(2,'0')}),reviewed:true}));
  const first=parse(await handle({httpMethod:'GET',queryStringParameters:{q:'Auburn White'}}));
  const second=parse(await handle({httpMethod:'GET',queryStringParameters:{q:'Auburn White',cursor:first.nextCursor}}));
  assert.equal(first.courses.length,30);assert.equal(second.courses.length,5);assert.equal(second.nextCursor,null);
  assert.equal(new Set([...first.courses,...second.courses].map(c=>c.id)).size,35);
  assert.equal(parse(await handle({httpMethod:'GET',queryStringParameters:{q:'No match'}})).courses.length,0);
});

test('catalog handles invalid queries, malformed/oversized bodies, unsupported methods and storage outages', async () => {
  const handle=database().client();
  assert.equal((await handle({httpMethod:'POST',body:'{'})).statusCode,400);
  assert.equal((await handle({httpMethod:'POST',body:'x'.repeat(12001)})).statusCode,413);
  assert.equal((await handle({httpMethod:'GET',queryStringParameters:{cursor:'-1'}})).statusCode,400);
  assert.equal((await handle({httpMethod:'GET',queryStringParameters:{q:'a'.repeat(121)}})).statusCode,400);
  assert.equal((await handle({httpMethod:'DELETE'})).statusCode,405);
  const offline=createCourses({storeForEvent:()=>{throw Error('secret credentials');}});
  const failure=await offline({httpMethod:'GET'});
  assert.equal(failure.statusCode,503);assert.ok(!failure.body.includes('secret credentials'));
});

test('photo reader sends image inputs with chosen tees/ranking and never enables web search or stores the response', async () => {
  let sent;
  const handle=reader(async (url,options)=>{sent=JSON.parse(options.body);return provider(card())();});
  const result=await handle(event(photo()));
  assert.equal(result.statusCode,200);
  assert.equal(sent.input[0].content[1].image_url,image);
  assert.equal(sent.input[0].content[1].type,'input_image');
  assert.equal(JSON.parse(sent.input[0].content[0].text).tee,'White');
  assert.equal(sent.store,false);assert.equal(sent.tools,undefined);
  assert.deepEqual(parse(result).pars,Array(18).fill(4));
});

test('photo reader rejects unreadable, ambiguous or incomplete cards and the wrong handicap row', async () => {
  for (const result of [{error:'Which white tee row?'},card({pars:[4]}),card({strokeIndexes:Array(18).fill(1)}),card({ranking:'women'}),null]) {
    assert.equal((await reader(provider(result))(event(photo()))).statusCode,422);
  }
});

test('photo reader allows missing course metadata to be completed in review but never missing holes', async () => {
  const result=await reader(provider(card({courseName:'',location:'',tee:''})))(event(photo()));
  assert.equal(result.statusCode,200);
  assert.equal(parse(result).courseName,'');assert.equal(parse(result).location,'');
});

test('photo reader validates images, payload size, ranking and hints before calling the provider', async () => {
  let called=false; const handle=reader(async()=>{called=true;throw Error('should not run');});
  for (const body of [null,{},photo({image:'https://example.com/card.jpg'}),photo({image:'data:image/png;base64,YWJjZA=='}),photo({ranking:'other'}),photo({tee:'a'.repeat(61)})]) {
    assert.equal((await handle(event(body))).statusCode,400);
  }
  assert.equal((await handle({httpMethod:'POST',body:'x'.repeat(4*1024*1024+2001)})).statusCode,413);
  assert.equal((await handle({httpMethod:'POST',body:'{'})).statusCode,400);
  assert.equal((await handle({httpMethod:'GET'})).statusCode,405);
  assert.equal(called,false);
});

test('photo reader reports unavailable keys, provider failures, invalid JSON and timeouts without exposing credentials', async () => {
  assert.equal((await createReader({env:{}})(event(photo()))).statusCode,503);
  const bad=await reader(async()=>({ok:false,json:async()=>({error:'secret'})}))(event(photo()));
  assert.equal(bad.statusCode,502);assert.ok(!bad.body.includes('secret'));
  assert.equal((await reader(async()=>({ok:true,json:async()=>({output_text:'not json'})}))(event(photo()))).statusCode,422);
  const timeout=await reader(async()=>{const e=Error();e.name='TimeoutError';throw e;})(event(photo()));
  assert.equal(timeout.statusCode,502);assert.match(parse(timeout).error,/too long/);
});
