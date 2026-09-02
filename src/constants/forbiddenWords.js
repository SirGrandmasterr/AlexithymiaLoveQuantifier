/**
 * The words this feature may not say to the user. One list, two readers.
 *
 * The copy walk in `journal.test.js` runs it over every string the journal can render, and
 * `journal/inference/validate.js` runs it over every free-text slot a model can author
 * (§5.4). Both used to be able to hold their own copy of this list; now neither can, and a
 * word added here is refused by the test and dropped by the filter in the same commit.
 *
 * It extends `cadence.test.js`'s six with §3.6's eleven and the preamble's *forgot*. The
 * match is a plain case-insensitive **substring** — `diagnos` is a stem on purpose, and so,
 * less deliberately, is everything else: *badge* contains *bad*. The copy walk has always
 * matched that way, and the filter matches the same way so that "forbidden-word-free" means
 * one thing in both places. The cost is that a model's label for a swimming pool
 * (*Schwimmbad*) is dropped and the user types it; the alternative is a filter the copy test
 * cannot vouch for.
 *
 * **The transcript is not read against this list, anywhere.** It is the user's own speech.
 */
export const FORBIDDEN_WORDS = Object.freeze([
    'overdue', 'missed', 'streak', 'forgot', 'should', 'behind', '!',
    'healthy', 'unhealthy', 'concerning', 'symptom', 'disorder', 'diagnos',
    'fail', 'guilt', 'lazy', 'bad', 'good job'
]);
