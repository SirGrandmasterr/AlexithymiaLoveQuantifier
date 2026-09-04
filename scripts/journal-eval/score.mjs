const uniq = (values) => [...new Set(values)];

/** The feeling ids in a proposal. */
export const feelingIds = (proposal) => uniq((proposal?.feelings || []).map(feeling => feeling.id));

/** The trigger labels a proposal attached to any feeling. */
export const triggerLabels = (proposal) => uniq((proposal?.feelings || []).flatMap(feeling => (
    (feeling.about || []).filter(about => about.kind === 'trigger').map(about => about.label)
)));

/** The people a proposal named. */
export const peopleNames = (proposal) => uniq((proposal?.people || []).map(person => person.name));

export const satisfies = (proposal, expected = {}, contextTriggers = []) => {
    const ids = feelingIds(proposal);
    const names = peopleNames(proposal);
    const labels = triggerLabels(proposal);
    const failures = [];

    if ('ambiguity' in expected && proposal.ambiguity !== expected.ambiguity) {
        failures.push(`ambiguity ${proposal.ambiguity}`);
    }
    (expected.must_include || []).forEach(id => { if (!ids.includes(id)) failures.push(`missing ${id}`); });
    (expected.must_not_include || []).forEach(id => { if (ids.includes(id)) failures.push(`has ${id}`); });
    if ('people' in expected) {
        if (expected.people.length === 0 && names.length) failures.push(`people ${names}`);
        expected.people.forEach(name => { if (!names.includes(name)) failures.push(`missing person ${name}`); });
    }
    if ('trigger_labels' in expected) {
        if (expected.trigger_labels.length === 0 && labels.length) failures.push(`labels ${labels}`);
        expected.trigger_labels.forEach(label => { if (!labels.includes(label)) failures.push(`missing label ${label}`); });
    }
    if (expected.new_trigger && !labels.some(label => !contextTriggers.includes(label))) failures.push('no new trigger');
    if ('facts' in expected) {
        if (expected.facts.length === 0 && (proposal.facts || []).length) failures.push('has facts');
        expected.facts.forEach(name => {
            if (!(proposal.facts || []).some(fact => fact.person === name)) failures.push(`no fact about ${name}`);
        });
    }
    return failures;
};

export const scoreCase = ({ entry, proposal, contextTriggers = [] }) => {
    const expected = entry.expect || {};
    const ids = feelingIds(proposal);
    const referenceIds = feelingIds(entry.reference);

    const mustInclude = expected.must_include || [];
    const mustNotInclude = expected.must_not_include || [];

    // One evaluation, read twice. `ok` is *"this row has no failures"* by definition, and a
    // second call to `satisfies` is a second chance for the two to disagree.
    const failures = satisfies(proposal, expected, contextTriggers);

    return {
        id: entry.id,
        pair: entry.pair,
        language: entry.language,
        failures,
        ok: failures.length === 0,

        // The gate's two feeling numbers, as counts so they can be summed across clips.
        mustIncludeTotal: mustInclude.length,
        mustIncludeHit: mustInclude.filter(id => ids.includes(id)).length,
        mustNotIncludeTotal: mustNotInclude.length,
        mustNotIncludeViolations: mustNotInclude.filter(id => ids.includes(id)).length,

        ambiguityExpected: expected.ambiguity,
        ambiguityActual: proposal?.ambiguity,
        ambiguityCorrect: proposal?.ambiguity === expected.ambiguity,
        ambiguityIsCase: expected.ambiguity !== undefined && expected.ambiguity !== 'none',

        // Per-id, against the full reference. `predicted` and `expectedIds` feed the
        // confusion counts in `aggregate`.
        predictedIds: ids,
        expectedIds: referenceIds,

        newTriggerWanted: Boolean(expected.new_trigger),
        newTriggerFound: triggerLabels(proposal).some(label => !contextTriggers.includes(label)),
        knownTriggerWanted: (expected.trigger_labels || []).filter(label => contextTriggers.includes(label)),
        knownTriggerFound: triggerLabels(proposal).filter(label => contextTriggers.includes(label))
    };
};

const ratio = (numerator, denominator) => (denominator === 0 ? null : numerator / denominator);

export const perIdMetrics = (scores) => {
    const ids = uniq(scores.flatMap(score => [...score.predictedIds, ...score.expectedIds])).sort();
    return ids.map((id) => {
        const truePositive = scores.filter(s => s.predictedIds.includes(id) && s.expectedIds.includes(id)).length;
        const falsePositive = scores.filter(s => s.predictedIds.includes(id) && !s.expectedIds.includes(id)).length;
        const falseNegative = scores.filter(s => !s.predictedIds.includes(id) && s.expectedIds.includes(id)).length;
        const precision = ratio(truePositive, truePositive + falsePositive);
        const recall = ratio(truePositive, truePositive + falseNegative);
        const f1 = precision === null || recall === null || precision + recall === 0
            ? null
            : (2 * precision * recall) / (precision + recall);
        return {
            id, truePositive, falsePositive, falseNegative, precision, recall, f1,
            support: truePositive + falseNegative
        };
    });
};

/** The confusion the ambiguity criterion is really about: what was answered when what was expected. */
export const ambiguityConfusion = (scores) => {
    const table = {};
    scores.forEach(({ ambiguityExpected, ambiguityActual }) => {
        const row = ambiguityExpected ?? '—';
        const column = ambiguityActual ?? '—';
        table[row] = table[row] || {};
        table[row][column] = (table[row][column] || 0) + 1;
    });
    return table;
};

export const aggregate = (scores) => {
    const mustIncludeTotal = scores.reduce((sum, s) => sum + s.mustIncludeTotal, 0);
    const mustIncludeHit = scores.reduce((sum, s) => sum + s.mustIncludeHit, 0);
    const mustNotIncludeTotal = scores.reduce((sum, s) => sum + s.mustNotIncludeTotal, 0);
    const mustNotViolations = scores.reduce((sum, s) => sum + s.mustNotIncludeViolations, 0);
    const ambiguityCases = scores.filter(s => s.ambiguityIsCase);
    const newTriggerCases = scores.filter(s => s.newTriggerWanted);
    const knownTriggerCases = scores.filter(s => s.knownTriggerWanted.length > 0);

    return {
        clips: scores.length,
        casesFullyOk: scores.filter(s => s.ok).length,

        mustIncludeTotal,
        mustIncludeHit,
        mustIncludeRecall: ratio(mustIncludeHit, mustIncludeTotal),

        mustNotIncludeTotal,
        mustNotViolations,
        mustNotViolationRate: ratio(mustNotViolations, mustNotIncludeTotal),

        ambiguityCases: ambiguityCases.length,
        ambiguityCorrect: ambiguityCases.filter(s => s.ambiguityCorrect).length,
        ambiguityAccuracy: ratio(ambiguityCases.filter(s => s.ambiguityCorrect).length, ambiguityCases.length),

        // Reported beside the gate figure because a model that answers "none" everywhere gets
        // a high number here and a zero above; seeing both together is what makes that visible.
        ambiguityAccuracyAllCases: ratio(scores.filter(s => s.ambiguityCorrect).length, scores.length),

        newTriggerCases: newTriggerCases.length,
        newTriggerHit: newTriggerCases.filter(s => s.newTriggerFound).length,
        knownTriggerCases: knownTriggerCases.length,
        knownTriggerHit: knownTriggerCases.filter(s => (
            s.knownTriggerWanted.every(label => s.knownTriggerFound.includes(label))
        )).length
    };
};
