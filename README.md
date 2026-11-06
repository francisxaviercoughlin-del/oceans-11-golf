# Ocean's 11 Golf

Open `index.html` to use the scorer. Netlify hosts the app and course lookup function.

Run automated regression tests with Node.js 24 or later:

```sh
npm test
```

No test dependencies or API keys are required. Tests execute the application script
and event handlers with DOM and local-storage doubles. Coverage includes the
11-hole limit, mandatory selections, all 31,824 valid selection paths, all 324
hole/ranking swaps, full handicaps, saved rounds, JSON import, and mocked AI lookup.
These checks do not replace a live browser or device test.

Stroke-index edits swap the selected ranking with its current holder. Existing
saved-round storage uses the same key and format. Invalid older rounds with fewer
or more than 11 counted holes cannot finish; historical selections and scores are
retained rather than silently choosing which past holes should count.
