function scorecard(input) {
  if (!input || typeof input !== 'object') throw Error('No scorecard was supplied.');
  const text = (key, max) => {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > max) {
      throw Error('Enter the course name, location, tees and handicap row.');
    }
    return input[key].trim().replace(/\s+/g, ' ');
  };
  const courseName = text('courseName', 120), location = text('location', 120), tee = text('tee', 60);
  if (!['men', 'women'].includes(input.ranking)) throw Error('Choose the men’s or women’s handicap row.');
  if (!Array.isArray(input.pars) || input.pars.length !== 18 || !input.pars.every(n => Number.isInteger(n) && n >= 3 && n <= 6)) {
    throw Error('The scorecard must have 18 pars, each between 3 and 6.');
  }
  if (!Array.isArray(input.strokeIndexes) || input.strokeIndexes.length !== 18 ||
      !input.strokeIndexes.every(n => Number.isInteger(n) && n >= 1 && n <= 18) || new Set(input.strokeIndexes).size !== 18) {
    throw Error('The scorecard must have all 18 unique stroke indexes, from 1 to 18.');
  }
  // Allowlist public course fields: never retain the image, personal scores or AI instructions.
  return { courseName, location, tee, ranking: input.ranking, pars: [...input.pars], strokeIndexes: [...input.strokeIndexes] };
}
module.exports = { scorecard };
