# Ocean's 11 Golf

Netlify hosts the scorer, photo reader and shared course library. Existing rounds
still save on the golfer's device using the same `oceans11-v1` storage format.

## Course scorecards

- Browse or search courses already shared by other golfers.
- Upload a photo containing all 18 holes, including the par and handicap rows.
  Select the tee name/color and men's or women's handicap row before reading it.
- Review and correct the extracted values; changing a stroke index swaps rankings.
- Confirm all 18 holes, then choose **Save for everyone & play** or **Use for this
  round only**. Manual entry and JSON import use the same review step.
- A course cannot replace a round after any score or hole decision is entered.

The `scorecard-read` function sends the resized image to the OpenAI Responses API.
It uses the site's existing `OPENAI_API_KEY` and optional `OPENAI_MODEL` (default
`gpt-4.1`). The image is not kept in local storage or the course library. Responses
use `store: false`. Unreadable or ambiguous hole values produce an error rather
than guessed values. Normal provider data-handling policies still apply.

The `courses` function stores reviewed public course records in the site-wide
Netlify Blobs store `oceans11-courses-v1`. This persists across deploys and is shared
across devices. Netlify supplies store credentials to Functions; no additional
database key or browser credential is needed. Records include course name,
location, tees, handicap row and 18 pars/indexes; images and personal scores are
not retained. Identical submissions are deduplicated with an atomic create-only
write. Corrections, different tees and men's/women's rows get separate records.
The public catalog is community reviewed, not independently verified by the app.

Deploy Previews use the same site-wide store. Do not seed fake/test courses in the
hosted preview. Automated storage tests use an isolated in-memory adapter.

Netlify Blobs must be enabled/available for the site. A storage outage produces a
clear error, while the user can still apply a reviewed card without sharing it.
Local file/static hosting supports scoring/manual entry, but the photo and shared
catalog endpoints require Netlify Functions. No Supabase project is required.

## Development

Run automated regression tests with Node.js 24 or later:

```sh
npm ci
npm test
```

Tests use Node's built-in runner with mocked provider/storage adapters; they do
not need API keys or write to the hosted catalog. Coverage includes the 11-hole
limit, mandatory selections, all 31,824 valid selection paths, all 324 hole/ranking
swaps, full handicaps, saved rounds, photo extraction failures, review confirmation,
cross-client course reuse, deduplication, pagination and in-flight request safety.
DOM/storage doubles do not replace a live browser/device test.

Stroke-index edits swap the selected ranking with its current holder. Existing
saved-round storage uses the same key and format. Invalid older rounds with fewer
or more than 11 counted holes cannot finish; historical selections and scores are
retained rather than silently choosing which past holes should count.
