/**
 * The context vocabulary shared by the snapshot form and the journal.
 *
 * Context capsules: the preset chips offered at snapshot time. Free text is allowed too —
 * these are the common cases, not a closed vocabulary, which is the difference between this
 * list and `FEELINGS`. The limits mirror the server-side rules in `validateTags`
 * (backend/internal/handlers/subjects.go), and the journal's own tag validation reuses them
 * rather than choosing a second number.
 *
 * **These live here rather than in `ContextCapsule.jsx` because both halves of the app need
 * them and only one half is a component.** `src/constants/journal.js` states in its own
 * header that it renders nothing and imports no React; while it reached into a component
 * module for `MAX_TAG_LENGTH`, that was not true, and every importer of `journal.js` —
 * including `MobileBottomNav`, which wants one route constant — pulled React and
 * `lucide-react` into its graph. `ContextCapsule.jsx` re-exports all three so its existing
 * importers are unaffected.
 */

export const CONTEXT_TAGS = [
    'conflict', 'distance', 'trip together', 'milestone', 'reconciliation',
    'routine period', 'life change'
];
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 40;
