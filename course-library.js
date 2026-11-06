// Scorecard photos remain in memory. Only reviewed course data enters the shared catalog.
let preparedPhoto = null, pendingCard = null, reviewRound = null;
let readVersion = 0, searchVersion = 0, nextCursor = null, catalog = [];
const validHoles = card => Array.isArray(card.pars) && card.pars.length === 18 && card.pars.every(n => Number.isInteger(n) && n >= 3 && n <= 6) &&
  Array.isArray(card.strokeIndexes) && card.strokeIndexes.length === 18 && card.strokeIndexes.every(n => Number.isInteger(n) && n >= 1 && n <= 18) && new Set(card.strokeIndexes).size === 18;
const setupOpen = () => s.hole === 1 && !s.players.some(p => p.choices.some(c => c !== null) || p.scores.some(score => score !== null));
function requireSetup() {
  if (setupOpen()) return true;
  $('lookupstatus').textContent = 'This round has started. Start a new round before changing its course.';
  return false;
}
async function courseRequest(path, options = {}) {
  const response = await fetch('/.netlify/functions/' + path, { ...options, signal: AbortSignal.timeout(60000) });
  let data;
  try { data = await response.json(); } catch { throw Error('The course service is unavailable. Please try again.'); }
  if (!response.ok) throw Error(data.error || 'The course service is unavailable.');
  return data;
}
function reviewCard(card) {
  if (!validHoles(card)) throw Error('The scorecard needs 18 readable pars and unique handicap rankings.');
  pendingCard = { ...card, pars: [...card.pars], strokeIndexes: [...card.strokeIndexes] };
  reviewRound = s;
  for (const [id, key] of [['reviewname','courseName'],['reviewlocation','location'],['reviewtee','tee'],['reviewranking','ranking']]) $(id).value = card[key] || '';
  $('reviewnotes').textContent = card.notes || 'Community scorecard. Check the tees and handicap row against your card.';
  $('reviewconfirmed').checked = false;
  $('reviewcard').hidden = false;
  renderReviewHoles();
  updateReviewButtons();
}
function renderReviewHoles() {
  $('reviewholes').innerHTML = pendingCard.pars.map((par, i) => '<div class="hole"><b>Hole ' + (i+1) + '</b>' +
    '<label for="rp' + i + '">Par</label><select id="rp' + i + '" data-review-par="' + i + '">' + [3,4,5,6].map(n => '<option ' + (n === par ? 'selected' : '') + '>' + n + '</option>').join('') + '</select>' +
    '<label for="ri' + i + '">Stroke index</label><select id="ri' + i + '" data-review-index="' + i + '">' + Array.from({length:18}, (_,j) => '<option ' + (pendingCard.strokeIndexes[i] === j+1 ? 'selected' : '') + '>' + (j+1) + '</option>').join('') + '</select></div>').join('');
}
function updateReviewButtons() {
  $('usecourse').disabled = !pendingCard || !$('reviewconfirmed').checked;
  $('savecourse').disabled = !pendingCard || !$('reviewconfirmed').checked;
}
function reviewedCard() {
  if (!pendingCard || !$('reviewconfirmed').checked) throw Error('Check all 18 holes, then confirm the scorecard below.');
  const card = { pars: [...pendingCard.pars], strokeIndexes: [...pendingCard.strokeIndexes], ranking: $('reviewranking').value };
  for (const [key, id, max] of [['courseName','reviewname',120],['location','reviewlocation',120],['tee','reviewtee',60]]) {
    card[key] = $(id).value.trim();
    if (!card[key] || card[key].length > max) throw Error('Complete the course name, location and tees before using or sharing this card.');
  }
  if (!validHoles(card) || !['men','women'].includes(card.ranking)) throw Error('Check the 18 hole values and handicap row.');
  return card;
}
function applyCard(card) {
  if (s !== reviewRound || !requireSetup()) return false;
  s.course = card.courseName;
  s.pars = [...card.pars]; s.indexes = [...card.strokeIndexes];
  s.courseInfo = { location: card.location, tee: card.tee, ranking: card.ranking, id: card.id || null };
  save(); render();
  $('lookupstatus').textContent = card.courseName + ' · ' + card.tee + ' tees loaded. Add golfers and play.';
  return true;
}

async function preparePhoto(file) {
  if (!file || !file.type.startsWith('image/')) throw Error('Choose a scorecard photo from your camera or photo library.');
  if (file.size > 25 * 1024 * 1024) throw Error('Choose a photo smaller than 25 MB.');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(Error('This image could not be opened. Try a JPEG photo or screenshot.')); image.src = url; });
    let scale = Math.min(1, 2600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    let data;
    // JPEG conversion also strips camera metadata and keeps the function request below its size limit.
    for (let tries = 0; tries < 6; tries++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff'; context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,0,0,canvas.width,canvas.height);
      data = canvas.toDataURL('image/jpeg', .9);
      if (data.length <= 4 * 1024 * 1024) return data;
      scale *= .8;
    }
    throw Error('This photo is still too large. Try a cropped photo of just the scorecard.');
  } finally { URL.revokeObjectURL(url); }
}
$('scorephoto').onchange = async e => {
  const version = ++readVersion;
  preparedPhoto = null; pendingCard = null;
  $('reviewcard').hidden = true; $('photopreview').hidden = true; $('readphoto').disabled = true;
  const file = e.target.files?.[0];
  if (!file) { $('lookupstatus').textContent = 'Choose a photo showing all 18 holes, including the par and handicap rows.'; return; }
  $('lookupstatus').textContent = 'Preparing your photo…';
  try {
    const photo = await preparePhoto(file);
    if (version !== readVersion) return;
    preparedPhoto = photo; $('photopreview').src = photo; $('photopreview').hidden = false;
    $('readphoto').disabled = false;
    $('lookupstatus').textContent = 'Photo ready. Choose your tees and handicap row, then tap Read scorecard photo.';
  } catch (error) { if (version === readVersion) $('lookupstatus').textContent = error.message; }
};
$('readphoto').onclick = async () => {
  if (!requireSetup()) return;
  if (!preparedPhoto) { $('lookupstatus').textContent = 'Choose a scorecard photo first.'; return; }
  if (!$('lookuptees').value.trim()) { $('lookupstatus').textContent = 'Enter your tee color or name so the correct row is read.'; return; }
  const version = ++readVersion, round = s;
  pendingCard = null; $('reviewcard').hidden = true; $('readphoto').disabled = true;
  $('lookupstatus').textContent = 'Reading the 18 holes from your photo…';
  try {
    const card = await courseRequest('scorecard-read', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
      image: preparedPhoto, courseName:$('lookupname').value.trim(), location:$('lookuplocation').value.trim(), tee:$('lookuptees').value.trim(), ranking:$('lookupranking').value,
    }) });
    if (version !== readVersion || s !== round) return;
    if (!requireSetup()) return;
    reviewCard(card);
    $('lookupstatus').textContent = 'Photo read. Review all 18 holes below before using or sharing this course.';
  } catch (error) { if (version === readVersion) $('lookupstatus').textContent = error.message; }
  finally { if (version === readVersion) $('readphoto').disabled = !preparedPhoto; }
};
$('reviewholes').onchange = e => {
  if (!pendingCard) return;
  const i = Number(e.target.dataset.reviewPar ?? e.target.dataset.reviewIndex), value = Number(e.target.value);
  if (!Number.isInteger(i) || i < 0 || i >= 18) return;
  if (e.target.dataset.reviewPar !== undefined && [3,4,5,6].includes(value)) pendingCard.pars[i] = value;
  else if (e.target.dataset.reviewIndex !== undefined && Number.isInteger(value) && value >= 1 && value <= 18) {
    const other = pendingCard.strokeIndexes.indexOf(value);
    [pendingCard.strokeIndexes[i], pendingCard.strokeIndexes[other]] = [pendingCard.strokeIndexes[other], pendingCard.strokeIndexes[i]];
  }
  $('reviewconfirmed').checked = false; renderReviewHoles(); updateReviewButtons();
};
for (const id of ['reviewname','reviewlocation','reviewtee','reviewranking']) $(id).oninput = () => {
  $('reviewconfirmed').checked = false; updateReviewButtons();
};
$('reviewconfirmed').onchange = updateReviewButtons;
$('usecourse').onclick = () => {
  try { if (applyCard(reviewedCard())) $('reviewcard').hidden = true; }
  catch (error) { $('lookupstatus').textContent = error.message; }
};
$('savecourse').onclick = async () => {
  if (s !== reviewRound || !requireSetup()) return;
  let card;
  try { card = reviewedCard(); } catch (error) { $('lookupstatus').textContent = error.message; return; }
  const round = s;
  $('savecourse').disabled = true; $('usecourse').disabled = true;
  $('lookupstatus').textContent = 'Saving this course for everyone…';
  try {
    const data = await courseRequest('courses', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...card, reviewed:true }) });
    if (s !== round || !setupOpen()) { $('lookupstatus').textContent = 'Course saved to the shared library. Your round was left unchanged.'; return; }
    // Apply the submitted snapshot, even if the user changed review fields while saving.
    if (applyCard(data.course)) {
      $('reviewcard').hidden = true;
      $('lookupstatus').textContent = (data.duplicate ? 'This course is already in the shared library.' : 'Course saved for everyone.') + ' Your round is ready.';
    }
    await loadCourses(false);
  } catch (error) { $('lookupstatus').textContent = error.message + ' You can still use this scorecard for your round.'; }
  finally { updateReviewButtons(); }
};
function renderCatalog() {
  $('courselist').innerHTML = catalog.map((card, i) => '<div class="leader"><span><b>' + esc(card.courseName) + '</b><br><span class="muted">' + esc(card.location) + ' · ' + esc(card.tee) + ' tees · ' + (card.ranking === 'women' ? 'Women’s' : 'Men’s') + ' handicap<br>18 holes · Par ' + card.pars.reduce((a,b)=>a+b,0) + ' · Community reviewed</span></span><button class="secondary" data-course="' + i + '">Review &amp; play</button></div>').join('');
  $('morecourses').hidden = !nextCursor;
}
async function loadCourses(more = false) {
  const version = ++searchVersion, q = $('coursesearch').value.trim();
  $('searchcourses').disabled = true; $('morecourses').disabled = true;
  $('catalogstatus').textContent = 'Loading shared courses…';
  try {
    const data = await courseRequest('courses?q=' + encodeURIComponent(q) + (more && nextCursor ? '&cursor=' + encodeURIComponent(nextCursor) : ''));
    if (version !== searchVersion) return;
    if (!Array.isArray(data.courses) || !data.courses.every(validHoles)) throw Error('The course list could not be read. Try again.');
    catalog = more ? [...catalog, ...data.courses] : data.courses;
    nextCursor = data.nextCursor || null;
    renderCatalog();
    $('catalogstatus').textContent = catalog.length ? catalog.length + ' course scorecard' + (catalog.length === 1 ? '' : 's') + ' shown. Check the tee set before playing.' : (q ? 'No matching courses yet. Upload a scorecard to add one.' : 'No courses have been shared yet. Add the first scorecard below.');
  } catch (error) { if (version === searchVersion) $('catalogstatus').textContent = error.message; }
  finally { if (version === searchVersion) { $('searchcourses').disabled = false; $('morecourses').disabled = false; } }
}
$('searchcourses').onclick = () => loadCourses(false);
$('morecourses').onclick = () => loadCourses(true);
$('coursesearch').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); loadCourses(false); } };
$('courselist').onclick = e => {
  const index = e.target.dataset.course;
  if (index === undefined || !requireSetup()) return;
  try {
    reviewCard(catalog[Number(index)]);
    $('lookupstatus').textContent = 'Review this saved course below, then tap Use for this round. No photo upload needed.';
    $('reviewcard').scrollIntoView?.({ behavior:'smooth', block:'start' });
  } catch (error) { $('lookupstatus').textContent = error.message; }
};
$('manualreview').onclick = () => {
  if (!requireSetup()) return;
  reviewCard({ courseName:$('lookupname').value.trim() || s.course, location:$('lookuplocation').value.trim(), tee:$('lookuptees').value.trim(), ranking:$('lookupranking').value,
    pars:s.pars, strokeIndexes:s.indexes, notes:'Enter the values from your scorecard. Changing a stroke index swaps it with the hole that currently holds that ranking.' });
  $('lookupstatus').textContent = 'Enter and check all 18 holes below. You can save this course for everyone too.';
};
$('importscore').onclick = () => {
  if (!requireSetup()) return;
  try {
    const data = JSON.parse($('scorejson').value);
    const card = { ...data, strokeIndexes:data.strokeIndexes || data.indexes };
    if (!validHoles(card)) throw Error('Expected 18 pars (3–6) and 18 unique stroke indexes (1–18).');
    reviewCard({ ...card, courseName:data.courseName || $('lookupname').value.trim() || s.course, location:data.location || $('lookuplocation').value.trim(), tee:data.tee || $('lookuptees').value.trim(), ranking:data.ranking || $('lookupranking').value || 'men' });
    $('lookupstatus').textContent = 'Imported for review. Confirm the course details and all 18 holes below.';
  } catch (error) { $('lookupstatus').textContent = 'Import failed: ' + error.message; }
};
const resetRound = $('reset').onclick;
$('reset').onclick = () => {
  const before = s; resetRound();
  if (s !== before) { readVersion++; pendingCard = null; reviewRound = null; $('reviewcard').hidden = true; $('readphoto').disabled = !preparedPhoto; }
};
// Load shared data only on request; the scoring app continues to work when offline.
$('loadcourses').onclick = () => loadCourses(false);
