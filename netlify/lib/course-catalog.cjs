const { getStore } = require('@netlify/blobs');
const { createHash } = require('node:crypto');
const { scorecard } = require('./scorecard.cjs');
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const normalize = text => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function createHandler({ storeForEvent = event => {
  return getStore({ name: 'oceans11-courses-v1', consistency: 'strong' });
}, now = () => new Date().toISOString() } = {}) {
  return async event => {
    if (!['GET','POST'].includes(event.httpMethod)) return reply(405, { error: 'Use GET or POST.' });
    try {
      if (event.httpMethod === 'POST') {
        if (typeof event.body !== 'string' || Buffer.byteLength(event.body) > 12000) return reply(413, { error: 'Only course details and the 18 hole values can be saved.' });
        let input, card;
        try {
          input = JSON.parse(event.body);
          if (input?.reviewed !== true) throw Error('Review and confirm all 18 holes before sharing this course.');
          card = scorecard(input);
        } catch (error) { return reply(400, { error: error.message }); }
        const identity = { ...card, courseName: normalize(card.courseName), location: normalize(card.location), tee: normalize(card.tee) };
        const id = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
        const key = 'cards/' + [identity.courseName,identity.location,identity.tee,card.ranking,id].join('~');
        const store = storeForEvent(event);
        const record = { ...card, id, createdAt: now(), source: 'community-reviewed' };
        const { modified } = await store.setJSON(key, record, { onlyIfNew: true });
        const saved = modified ? record : await store.get(key, { type: 'json' });
        if (!saved) throw Error('Saved course unavailable.');
        return reply(modified ? 201 : 200, { course: saved, duplicate: !modified });
      }
      const params = event.queryStringParameters || {}, q = params.q || '';
      const cursor = params.cursor || '0';
      if (typeof q !== 'string' || q.length > 120 || !/^\d{1,8}$/.test(cursor)) return reply(400, { error: 'Enter a shorter search or refresh the course list.' });
      const store = storeForEvent(event);
      const { blobs } = await store.list({ prefix: 'cards/' });
      const words = normalize(q).split('-').filter(Boolean);
      const matches = blobs.map(blob => blob.key).filter(key => words.every(word => key.slice(6, -65).includes(word))).sort();
      const offset = Number(cursor), batch = matches.slice(offset, offset + 30);
      const courses = (await Promise.all(batch.map(key => store.get(key, { type: 'json' })))).filter(Boolean);
      return reply(200, { courses, nextCursor: offset + 30 < matches.length ? String(offset + 30) : null });
    } catch {
      return reply(503, { error: 'The shared course library is unavailable. Your current round is safe. Try again shortly; photo reading and manual setup can still be used.' });
    }
  };
}
exports.createHandler = createHandler;
