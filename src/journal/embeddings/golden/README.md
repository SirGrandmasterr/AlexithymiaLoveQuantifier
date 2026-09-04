# The retrieval golden set

*given these entries, query x returns y in the top three — in German and in English*

§5.8 asks for this and G1 did not build it, for a stated reason: G1 offers **labels** and this
is about **entries**. It is what keeps `SIMILARITY_FLOOR` honest, and it is the instrument a
later session moves that constant against.

| File | What | Read by |
| :--- | :--- | :------ |
| `retrieval.json` | The suite: a fixture user's journal in two languages, two snapshot notes, and 26 cases. | `../retrievalGolden.test.js` (npm test), `scripts/journal-eval/retrieval.mjs` |

Beside it, and read from `../../inference/golden/` rather than duplicated here:
`contexts.json` and `transcripts.json` are what `../retrievalPrompt.test.js` runs the item-3
guard over — the 120 proposal cases, in both languages, with a retrieval-influenced context.

## The two modes, which is the whole design of this file

**`lexical`** — the query shares words with its answer. *Fussball* finds *Fußball*;
*Nebenkosten* finds *Nebenkostenabrechnung* with no compound splitter anywhere; *Umzug* finds a
day that never says the word, because it is filed under a trigger whose label does;
*gemeinsam gekocht* finds a love snapshot's note. **These need no model**, so they run inside
`npm test` against the search the application actually ships. Their numbers are real evidence
about a real feature.

**`semantic`** — the query shares no content word with its answer. *"Wann war ich zuletzt so
ausgelaugt von meinem Job?"* has to reach an entry about coming home *erschöpft* from the
*Büro*. Nothing but EmbeddingGemma can bridge that, so `npm test` records these as
**skipped, by name, with the reason** — never as passes — and `make journal-eval` scores them
on a machine that has an embedder.

Reporting a skip as a skip is the point. A suite that quietly graded the semantic half against
a hashed-n-gram stand-in would produce a number about the stand-in and put it in a report
beside numbers that are about a model.

Two of the semantic cases are **cross-language** (`xl.*`): a German query reaching an English
entry and the reverse. EmbeddingGemma is multilingual and §12.1 says this feature matters most
for the users whose notes mix languages; those two cases are what would say whether that
survives the Matryoshka truncation to 256 dimensions.

## A case

```json
{
  "id": "de.nebenkosten", "language": "de", "mode": "lexical",
  "query": "Nebenkosten", "expect": ["de-5"], "must_not": [],
  "note": "A German compound found by its first half, with no compound splitter anywhere."
}
```

`expect` is every id that must be in the **top three**; `must_not` is every id that must not
be. Both halves matter: a search that answers a question about loneliness with the walk by the
river has not half-succeeded.

## Running it

```bash
npm test -- src/journal/embeddings/retrievalGolden.test.js
make journal-eval RETRIEVAL_ONLY=1
```

The second writes `product_vision/eval/retrieval-eval-<date>.{md,json}`, beside the model eval
report. `--embedder <module>` supplies an embedder — a module default-exporting
`async (texts, kind) => number[][]` — and is what turns the eight skips into measurements. The
harness applies the two mandatory prompt prefixes and the truncation itself, so a module only
has to turn strings into numbers.

## Adding a case

Add the entry (if it needs one) to `entries`, then the case to `cases`. The suite goes through
the application's own readers — `indexTriggers`, `readTrigger`, `buildDocuments` — so a fixture
cannot drift from what a real row means. `retrievalGolden.test.js` refuses a case naming an id
the suite does not hold, which is the mistake this is most likely to be made with.
