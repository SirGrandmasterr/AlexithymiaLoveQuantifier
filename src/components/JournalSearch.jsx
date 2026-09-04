import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useJournal } from '../context/JournalContext';
import { useDiscretion } from '../context/DiscretionContext';
import { useEmbeddings } from '../journal/embeddings/EmbeddingContext';
import { embeddingsAvailable } from '../journal/embeddings/availability';
import { timelinePath } from './TimelineRoute';
import { Frame, LoadFailed, Loading } from './Journal';
import {
    JOURNAL_COPY,
    feelingById,
    fillCopy,
    journalDayPath,
    timeOfDay
} from '../constants/journal';

/**
 * `/journal/search` — *"When did I last feel like this about work?"* (§5.8's third use).
 *
 * **Results are entries, and the app never summarises them.** There is no paragraph here
 * saying what the results have in common, no count, no trend and no score: every row is one
 * day the user wrote, with the words they wrote on it, and a link to that day. §5.8's rule 2
 * and the roadmap's no-hidden-math invariant both forbid the other thing, and the way this
 * screen keeps to it is by having nowhere to put a number — `recall` returns documents with
 * the ordering already thrown away.
 *
 * **Two lists, not one.** *Entries with these words* is a fact the reader can check by
 * looking at the row. *Entries with similar words* is this device's guess, and it is under
 * its own heading with its own sentence saying what was compared. A guess presented in the
 * same list as a find would be similarity making a claim.
 *
 * **Why the screen is behind the index toggle even though half of it needs no model.** The
 * lexical half would work with the feature off, and offering it would be the better product
 * in isolation. It is not offered, because §9.7 gives this one control — *"similar-entry
 * suggestions **and search**"* — and a search that quietly worked while the toggle said off
 * would make the settings row and the Vault's *"none are being made"* both untrue. G1
 * narrowed that label because it had built only the first half; this screen is what restores
 * it, and the two arrive together or not at all.
 *
 * **Discretion blurs the words and masks the names** (§9.6), exactly as the day view does: a
 * search result is a transcript excerpt, which is the most private thing this app renders.
 */

/* ------------------------------------------------------------------------------------ */
/* The pieces                                                                             */
/* ------------------------------------------------------------------------------------ */

/** Long enough to recognise the day by, short enough that the list stays a list. */
const EXCERPT = 160;

const excerpt = (text) => {
    const value = String(text ?? '').replace(/\s+/g, ' ').trim();
    return value.length > EXCERPT ? `${value.slice(0, EXCERPT).trimEnd()}…` : value;
};

const Note = ({ children }) => (
    <p className="text-xs text-slate-400 font-light leading-relaxed max-w-md">{children}</p>
);

/**
 * One result: the day it is on, when in the day, its words, and the feelings it was filed
 * under. Nothing about *why* it is here — the heading above it already said that.
 */
const Result = ({ doc }) => {
    const { blurClass } = useDiscretion();

    const isSnapshot = doc.kind === 'snapshot';
    const to = isSnapshot ? timelinePath(doc.relationshipId) : journalDayPath(doc.day);
    const label = isSnapshot
        ? JOURNAL_COPY.similar.search.openSnapshot
        : fillCopy(JOURNAL_COPY.similar.search.open, { day: doc.day });

    return (
        <li data-search-result={doc.id} data-search-kind={doc.kind}>
            <Link
                to={to}
                aria-label={label}
                className="block bg-white rounded-2xl shadow-sm border border-slate-100 p-4 hover:border-slate-300 transition-colors space-y-2"
            >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-sm font-medium text-slate-700">{doc.day}</span>
                    {isSnapshot ? (
                        <span className="text-[11px] text-slate-400 font-light">
                            {JOURNAL_COPY.similar.search.snapshot}
                        </span>
                    ) : doc.at && (
                        <span className="text-[11px] text-slate-400 font-light">{timeOfDay(doc.at)}</span>
                    )}
                </div>

                <p className={`text-sm text-slate-600 font-light leading-relaxed ${blurClass}`}>
                    {excerpt(doc.text)}
                </p>

                {doc.feelings.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {[...new Set(doc.feelings)].map(id => {
                            const known = feelingById(id);
                            return (
                                <span
                                    key={id}
                                    data-search-feeling={id}
                                    className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800/5 text-slate-500"
                                >
                                    {known?.label ?? id}
                                </span>
                            );
                        })}
                    </div>
                )}
            </Link>
        </li>
    );
};

const Results = ({ heading, note, docs, group }) => {
    if (docs.length === 0) return null;

    return (
        <section data-search-group={group} className="space-y-3">
            <div className="space-y-1">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{heading}</h2>
                {note && <Note>{note}</Note>}
            </div>
            <ul className="space-y-2">
                {docs.map(doc => <Result key={doc.id} doc={doc} />)}
            </ul>
        </section>
    );
};

/* ------------------------------------------------------------------------------------ */
/* The screen                                                                             */
/* ------------------------------------------------------------------------------------ */

export default function JournalSearch() {
    const { loading, loadError, dismissLoadError, loadAll } = useJournal();
    const { enabled, search } = useEmbeddings();
    const copy = JOURNAL_COPY.similar.search;

    // The whole record, not whichever month the day view left loaded: a search that could
    // only answer about August would be answering a question nobody asked.
    useEffect(() => { loadAll(); }, [loadAll]);

    const [query, setQuery] = useState('');
    const [results, setResults] = useState({ matched: [], similar: [] });

    // Every keystroke starts a search and the embedding half of one is asynchronous, so two
    // can land out of order. `live` is the whole guard: React runs the previous effect's
    // cleanup before the next effect body, so exactly one closure has `live === true` at any
    // moment and an older answer cannot be drawn over a newer one. (A run counter beside it
    // said the same thing twice and could not disagree with it.)
    useEffect(() => {
        if (!enabled || !query.trim()) {
            setResults({ matched: [], similar: [] });
            return undefined;
        }

        let live = true;

        search(query).then(found => {
            if (live) setResults(found);
        }).catch(() => {
            // A model that failed costs the semantic half of one query. There is no sentence
            // for it: the words the user typed are still searched, and still answered.
        });

        return () => { live = false; };
    }, [enabled, query, search]);

    const nothing = useMemo(
        () => query.trim().length > 0 && results.matched.length === 0 && results.similar.length === 0,
        [query, results]
    );

    // The same heading in both states, written once: the screen is the same place whether or
    // not the switch is on, and the off state is a sentence inside it rather than a different
    // page.
    const header = (
        <header className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-light text-slate-800">{copy.heading}</h1>
            <p className="text-sm text-slate-400 font-light">{copy.subheading}</p>
        </header>
    );

    if (!enabled) {
        return (
            <Frame>
                {header}
                <div data-search-off className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 sm:p-12 text-center">
                    <p className="text-sm text-slate-500 font-light">
                        {embeddingsAvailable() ? copy.off : copy.unavailable}
                    </p>
                </div>
            </Frame>
        );
    }

    return (
        <Frame>
            {header}

            {loadError && <LoadFailed message={loadError} onDismiss={dismissLoadError} />}

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sm:p-5 space-y-2">
                <label htmlFor="journal-search" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    {copy.label}
                </label>
                <div className="flex items-center gap-2">
                    <Search size={16} className="text-slate-300 shrink-0" />
                    <input
                        id="journal-search"
                        data-search-input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={copy.placeholder}
                        className="w-full text-sm bg-transparent text-slate-700 placeholder:text-slate-300 focus:outline-none"
                    />
                </div>
            </div>

            {loading && <Loading />}

            {!query.trim() ? (
                <p data-search-prompt className="text-sm text-slate-400 font-light">{copy.prompt}</p>
            ) : nothing && !loading ? (
                <p data-search-empty className="text-sm text-slate-400 font-light">{copy.empty}</p>
            ) : (
                <>
                    <Results group="words" heading={copy.words} docs={results.matched} />
                    <Results group="alike" heading={copy.alike} note={copy.alikeNote} docs={results.similar} />
                </>
            )}
        </Frame>
    );
}
