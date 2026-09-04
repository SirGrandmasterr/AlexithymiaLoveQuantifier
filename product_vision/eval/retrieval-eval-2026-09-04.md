# Retrieval evaluation — 2026-09-04

The retrieval golden set of §5.8, scored by the application's own `recall`.
*given these entries, query x returns y in the top three — in German and in English*

## What was run

|  |  |
| :-- | :-- |
| Suite | `src/journal/embeddings/golden/retrieval.json` |
| Documents | 26 (journal entries and snapshot notes) |
| Top-N rule | 3 |
| Embedder | **none** — lexical half only |
| Lexical floors | `LEXICAL_FLOOR` 0.25, `RELATIVE_FLOOR` 0.3 |
| Similarity floor | `SIMILARITY_FLOOR` 0.65 |

## Result

| Group | Total | Pass | Fail | Skipped |
| :-- | --: | --: | --: | --: |
| Lexical | 18 | 18 | 0 | 0 |
| Semantic | 8 | 0 | 0 | 8 |
| German | 13 | 9 | 0 | — |
| English | 13 | 9 | 0 | — |
| **All** | 26 | 18 | 0 | 8 |

## Every case

| Case | Lang | Mode | Query | Wanted | Top three | Result |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `de.buero` | de | lexical | *Buro* | de-1 | de-1 | pass |
| `de.fussball` | de | lexical | *Fussball* | de-6 | de-6 | pass |
| `de.nebenkosten` | de | lexical | *Nebenkosten* | de-5 | de-5 | pass |
| `de.kartons` | de | lexical | *Kartons* | de-4, de-10 | de-10, de-4 | pass |
| `de.spaziergang` | de | lexical | *Spaziergang mit Lucie* | de-3 | de-3, de-9 | pass |
| `de.kletterwand` | de | lexical | *Kletterwand* | de-9 | de-9 | pass |
| `de.rechnung` | de | lexical | *Rechnung bezahlt* | de-12 | de-12, de-5 | pass |
| `de.snapshot` | de | lexical | *gemeinsam gekocht* | snapshot:1 | snapshot:1 | pass |
| `de.trigger.label` | de | lexical | *Umzug* | de-4, de-10 | de-10, de-4 | pass |
| `en.office` | en | lexical | *office* | en-1 | en-1 | pass |
| `en.boxes` | en | lexical | *boxes* | en-4, en-10 | en-10, en-4 | pass |
| `en.utility` | en | lexical | *utility bill* | en-5 | en-5, en-12 | pass |
| `en.river` | en | lexical | *walk along the river* | en-3 | en-3 | pass |
| `en.climbing` | en | lexical | *climbing wall* | en-9 | en-9 | pass |
| `en.report` | en | lexical | *rewrote the report* | en-8 | en-8 | pass |
| `en.snapshot` | en | lexical | *cooked together* | snapshot:2 | snapshot:2 | pass |
| `en.quiet` | en | lexical | *nobody I wanted to call* | en-11 | en-11 | pass |
| `en.trigger.label` | en | lexical | *the move* | en-4, en-10 | en-10, en-4 | pass |
| `de.sem.job` | de | semantic | *Wann war ich zuletzt so ausgelaugt von meinem Job?* | de-1 | — | skipped |
| `de.sem.einsam` | de | semantic | *Wann habe ich mich zuletzt einsam gefühlt?* | de-11 | — | skipped |
| `de.sem.sorgen` | de | semantic | *Sorgen wegen der Miete* | de-5 | — | skipped |
| `en.sem.wornout` | en | semantic | *When did I last feel worn out by my job?* | en-1 | — | skipped |
| `en.sem.lonely` | en | semantic | *When did I last feel lonely?* | en-11 | — | skipped |
| `en.sem.moneyworry` | en | semantic | *worrying about the rent* | en-5 | — | skipped |
| `xl.de.query.en.entry` | de | semantic | *Umzugskisten schleppen* | en-10 | — | skipped |
| `xl.en.query.de.entry` | en | semantic | *worries about money* | de-5 | — | skipped |

## What this run does not say

**8 semantic cases were not run**, because no embedder was
supplied and their queries share no content word with their answers. They are the half
of §5.8's third use that needs EmbeddingGemma, and until a machine with the weights runs
them, nothing here is evidence about the model — only about the words.

The same limit applies to `SIMILARITY_FLOOR`: it is still G1's starting value, chosen
without a measurement, and this suite is the instrument that would move it.

It also applies to §5.8's fourth use, *context for the proposal model*.
`src/journal/embeddings/retrievalPrompt.test.js` proves structurally that a
retrieval-influenced prompt cannot lose a word a clear case needs, cannot add a word the
user never confirmed, cannot name a feeling, and changes no rule — over all 120 proposal
golden cases in both languages. What it cannot prove is that no model is ever swayed by
an **ordering**, which needs weights and a differential run of the proposal suite.
