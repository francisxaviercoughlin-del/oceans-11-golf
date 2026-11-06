const { test } = require('node:test');
const assert = require('node:assert/strict');
const { app, player, round, prior } = require('./helpers/app.cjs');
const card = () => ({ courseName:'Shared Course',location:'Auburn, AL',tee:'White',ranking:'men',
  pars:Array(18).fill(5),strokeIndexes:Array.from({length:18},(_,i)=>18-i) });
const confirm = a => { a.element('reviewconfirmed').checked=true;a.element('reviewconfirmed').onchange(); };
const review = a => a.run(`reviewCard(${JSON.stringify(card())})`);
const response = data => ({ok:true,json:async()=>data});

test('photo results require review and explicit confirmation before changing the round', async () => {
  let request;
  const a=app(undefined,{fetch:async(path,options)=>{request={path,body:JSON.parse(options.body)};return response(card());}});
  const before=a.state();
  a.run("preparedPhoto='data:image/jpeg;base64,test'");a.element('lookuptees').value='White';
  await a.element('readphoto').onclick();
  assert.equal(request.path,'/.netlify/functions/scorecard-read');
  assert.deepEqual(a.state(),before);
  assert.equal(a.element('reviewcard').hidden,false);
  assert.equal(a.element('usecourse').disabled,true);
  a.element('usecourse').onclick();assert.deepEqual(a.state(),before);
  confirm(a);a.element('usecourse').onclick();
  assert.equal(a.state().course,'Shared Course');assert.deepEqual(a.state().pars,card().pars);
  assert.deepEqual(a.state().courseInfo,{location:'Auburn, AL',tee:'White',ranking:'men',id:null});
});

test('saving a reviewed course shares only course fields, then uses the saved record', async () => {
  const writes=[];
  const a=app(undefined,{fetch:async(path,options)=>{
    if(options.method==='POST'){writes.push(JSON.parse(options.body));return response({course:{...card(),id:'saved-course'}});}
    return response({courses:[card()],nextCursor:null});
  }});
  review(a);confirm(a);await a.element('savecourse').onclick();
  assert.equal(writes.length,1);assert.equal(writes[0].reviewed,true);
  assert.equal(writes[0].image,undefined);assert.equal(writes[0].players,undefined);
  assert.equal(a.saved().courseInfo.id,'saved-course');
  assert.match(a.element('lookupstatus').textContent,/saved for everyone/);
});

test('a second golfer can load and use a shared course without a photo or AI call', async () => {
  const paths=[],a=app(undefined,{fetch:async path=>{paths.push(path);return response({courses:[card()],nextCursor:null});}});
  await a.element('loadcourses').onclick();
  a.element('courselist').onclick({target:{dataset:{course:'0'}}});
  confirm(a);a.element('usecourse').onclick();
  assert.equal(a.state().course,'Shared Course');assert.equal(paths.length,1);assert.match(paths[0],/courses\?/);
});

test('review ranking edits swap values and require confirmation again', () => {
  const a=app();review(a);confirm(a);
  a.change('reviewholes',{reviewIndex:'0'},1);
  assert.equal(a.run('pendingCard.strokeIndexes[0]'),1);
  assert.equal(a.run('pendingCard.strokeIndexes[17]'),18);
  assert.equal(a.run('new Set(pendingCard.strokeIndexes).size'),18);
  assert.equal(a.element('reviewconfirmed').checked,false);assert.equal(a.element('savecourse').disabled,true);
  confirm(a);a.element('reviewtee').value='Blue';a.element('reviewtee').oninput();
  assert.equal(a.element('usecourse').disabled,true);
});

test('saved-round scores and choices prevent course replacement from review or import', () => {
  const a=app();review(a);confirm(a);
  a.run('s.players.push('+JSON.stringify(prior(player(),1,1))+')');
  const before=a.state();a.element('usecourse').onclick();
  a.element('scorejson').value=JSON.stringify(card());a.element('importscore').onclick();
  assert.deepEqual(a.state(),before);assert.match(a.element('lookupstatus').textContent,/round has started/);
});

test('late photo responses cannot replace a different round after reset', async () => {
  let resolve;
  const a=app(undefined,{fetch:()=>new Promise(r=>{resolve=r;})});
  a.run("preparedPhoto='photo'");a.element('lookuptees').value='White';
  const reading=a.element('readphoto').onclick();a.element('reset').onclick();
  resolve(response(card()));await reading;
  assert.equal(a.state().course,'');assert.equal(a.element('reviewcard').hidden,true);
});

test('late saves can share a course but cannot overwrite a round that started while saving', async () => {
  let resolve;
  const a=app(undefined,{fetch:()=>new Promise(r=>{resolve=r;})});review(a);confirm(a);
  const saving=a.element('savecourse').onclick();
  a.run('s.players.push('+JSON.stringify(prior(player(),1,1))+');save()');
  const before=a.state();resolve(response({course:card()}));await saving;
  assert.deepEqual(a.state(),before);assert.match(a.element('lookupstatus').textContent,/left unchanged/);
});

test('service failures keep current scores and offer use without sharing', async () => {
  const a=app();review(a);confirm(a);const before=a.state();
  await a.element('savecourse').onclick();assert.deepEqual(a.state(),before);
  assert.match(a.element('lookupstatus').textContent,/still use/);
  a.element('usecourse').onclick();assert.equal(a.state().course,'Shared Course');
});

test('manual JSON import opens review, rejects duplicate indexes and never silently replaces a course', () => {
  const a=app();a.element('scorejson').value=JSON.stringify(card());a.element('importscore').onclick();
  assert.equal(a.state().course,'');assert.equal(a.element('reviewcard').hidden,false);
  confirm(a);a.element('usecourse').onclick();assert.equal(a.state().course,'Shared Course');
  const before=a.state();a.element('scorejson').value=JSON.stringify({...card(),strokeIndexes:Array(18).fill(1)});
  a.element('importscore').onclick();assert.deepEqual(a.state(),before);assert.match(a.element('lookupstatus').textContent,/Import failed/);
});

test('manual setup can enter, review and share a card without photo extraction', () => {
  const a=app();a.element('lookupname').value='Manual Club';a.element('lookuplocation').value='Opelika, AL';a.element('lookuptees').value='Blue';
  a.element('manualreview').onclick();confirm(a);a.element('usecourse').onclick();
  assert.equal(a.state().course,'Manual Club');assert.equal(a.state().courseInfo.tee,'Blue');
});

test('shared course names are HTML escaped and empty catalogs give a clear upload path', async () => {
  const a=app(undefined,{fetch:async()=>response({courses:[{...card(),courseName:'<img src=x onerror=alert(1)>'}],nextCursor:null})});
  await a.element('loadcourses').onclick();assert.ok(!a.element('courselist').innerHTML.includes('<img'));
  assert.match(a.element('courselist').innerHTML,/&lt;img/);
  const b=app(undefined,{fetch:async()=>response({courses:[],nextCursor:null})});
  await b.element('loadcourses').onclick();assert.match(b.element('catalogstatus').textContent,/first scorecard/);
});

test('client metadata validation rejects incomplete courses before sharing or applying', () => {
  const a=app();review(a);a.element('reviewlocation').value='';confirm(a);
  a.element('usecourse').onclick();assert.equal(a.state().course,'');assert.match(a.element('lookupstatus').textContent,/Complete the course/);
});
