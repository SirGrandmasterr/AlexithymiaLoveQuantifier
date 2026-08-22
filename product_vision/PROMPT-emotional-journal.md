# Prompt for Fable — Plan the "Emotional Journal" feature

## Your role

You are planning a substantial new feature for an existing, heavily documented codebase.
**Do not implement anything.** The single deliverable of this task is one planning
document. No source file, test, config, or existing doc may be modified. Illustrative
snippets (a proposed JSON shape, a Go struct sketch, a component signature) belong inside
the planning document as fenced code blocks — nowhere else.

## Read first

This repository documents itself thoroughly, and the documentation is treated as source of
truth. Before writing a single line of the plan, read:

| File | Why it matters to this feature |
| :--- | :--- |
| `docs/01-concepts.md` | The premise (alexithymia → behavioural estimation), the seven love categories, the domain vocabulary you must reuse or deliberately extend, and §6 "What the application deliberately does not do". |
| `docs/02-architecture.md` | Layering, request lifecycle, where state lives, and §7 "Extension seams" — your plan should hang off those seams, not invent new ones. |
| `docs/03-data-model.md` | The three-entity schema, the JSON-column pattern (`stats`, `tags`, `uncertain`, `guide_answers`), soft deletes, and the SQLite/Postgres dual-driver constraints. |
| `docs/04-api-reference.md` | Endpoint conventions, the partial-merge `PUT` contract, date formats. |
| `docs/05-backend.md` | Go + Gin handler skeleton, validation conventions, where a new endpoint is registered. |
| `docs/06-frontend.md` | React 19 SPA structure, `SubjectsContext`, `DiscretionContext`, the Vault trust page and its claim table (§3c), styling rules. |
| `docs/08-testing.md` | What "tested" means here, in both languages. |
| `docs/10-agent-guide.md` | §2 Hard invariants and §3 silent-failure traps. Several of them directly constrain this feature. |
| `docs/11-known-issues.md` | Do not build on top of a known defect without saying so. |
| `docs/12-android-app.md` | Capacitor shell, touch-axis ownership rule, local notifications, offline cache — the bedtime ritual and the voice button both live here. |
| `docs/13-zero-knowledge-encryption.md` | The planned envelope-encryption architecture. Emotional-journal data is the most sensitive data this app would ever hold; your plan must state how it fits this scheme rather than sidestepping it. |
| `product_vision/README.md` | The five-phase roadmap, its ordering rationale, and the invariants every phase must preserve. Your feature is in effect a proposed Phase 6 — match that document's register and rigour. |
| `README.md`, `package.json`, `backend/` | The actual stack: React 19 + Vite + Tailwind + Recharts, Go + Gin + GORM, Capacitor 8 Android shell. |

## The concept to design

Today the user can save and track their feelings of love for other individuals as dated,
self-scored snapshots. The feature to plan adds an **intuitive, low-effort, comprehensive
way for the user to record their emotional states across a day, together with the reasons
those states occurred.** Two mechanisms feed it.

### 1. The nightly question ritual

Before bed, the app asks the user a small set of questions designed to put the day into
context. Answers are binary and given by **swiping**, for speed — the whole ritual should
be finishable half-asleep in under a minute.

Examples of the kind of question intended: *"Did you sleep enough and well?"*, *"Did you
drink enough water?"* — **the actual composition of the question set is yours to design and
to justify.** Consider: which questions have real explanatory power over mood; how many are
too many; whether the set is fixed, rotating, adaptive, or user-editable; what a "skip"
means versus a "no"; and how this interacts with the existing cadence-nudge rules
(invariant 2c — a missed night must never read as a failure, and the forbidden-word
discipline enforced on `nudgeSentence` applies to any copy you propose here).

### 2. Voice check-ins during the day

The user can, whenever they like, hit an easily reachable button and record a **voice
memo**. That memo is transcribed on-device (Whisper or a comparable model) and the
transcript is fed to a **small on-device Gemma-class model** (one model, or several
fine-tuned ones if the plan justifies it) which performs three tasks:

1. **Identify the feelings** expressed and their identity/labels — or, if the phrasing is
   too ambiguous to be honest about, ask the user for a less dubious phrasing rather than
   guessing.
2. **Match** each identified emotion to its cause/trigger, and each named person to an
   entry in a personal database of people who matter in the user's life.
3. **Update** that knowledge: register causes/triggers that are new, add or enrich people
   in the personal database, and extend what is known about them.

Worked example the plan must be able to trace end-to-end:

> *"I had a nice day with Lucie today and felt very connected to her, even though work was
> stressful."*

→ *Lucie* is recognised as a person and either created in the database or updated with this
experience; *pleasure* and *rapport* are attached to Lucie; *stress* is attached to *work*.

Note the collision you must resolve deliberately: the app already has a first-class
`Relationship` entity for people. Decide whether the "personal database of people" **is**
that entity, extends it, or is a separate lighter-weight register — and defend the choice
against invariants 2a and 2b (grouping by `relationship_id`; one name-resolution rule
shared by every write path) and against the rename/merge machinery that already exists.

### 3. The payoff visualisation

The collected data must be structured so that a **three-dimensional graph of a single day's
feelings** can be rendered from it: one axis is time; the other two axes plus the curve's
colour encode the feeling. The curve **splits and converges into as many branches as there
are distinct feelings present at each point in time**.

Specify what "the other two axes" actually encode — valence/arousal, intensity/confidence,
or something you argue for better — and how a discrete set of check-ins becomes a
continuous, branching curve (interpolation, decay, branch birth/merge rules, what happens
between the last afternoon check-in and the bedtime ritual). Say plainly what this costs:
Recharts is 2-D and the repo has no 3-D dependency today. Evaluate the options (three.js /
react-three-fiber, hand-written WebGL, a 2.5-D projection drawn in SVG, or deferring the
third dimension), including bundle size on the Android shell, and respect the fact that
**Recharts renders nothing under jsdom** (invariant 19) — chart logic lives in exported
pure functions, and whatever you choose must keep that property.

### 4. Built for later analysis

Further analysis will be added later. The stored shape must make additions cheap: prefer
append-only, versioned, self-describing records over schemas that need rewriting each time
a new question or a new emotion taxonomy appears. State the extension seam explicitly.

## Constraints you must engage with, not route around

These are the hard parts. A plan that ignores any of them is not usable.

1. **"There are no AI features, by design."** The Vault trust page says this in writing,
   `docs/01-concepts.md` §1 says the app contains *no inference engine, no scoring
   algorithm, and no AI*, and invariant 2e requires every Vault claim to be true of the code
   as written. This feature adds AI. Decide and argue: does the claim get rewritten ("no AI
   *leaves your device*"), scoped, or does the feature sit behind an explicit opt-in that
   keeps the default build claim-true? Propose the exact replacement copy for the Vault
   claim table.
2. **"Nothing leaves this machine."** Transcription and inference must be local for that
   sentence to survive. Assess honestly whether on-device speech-to-text and a small
   Gemma-class LLM are viable inside a Capacitor Android shell — and in a desktop browser,
   the other supported target. Name the concrete runtimes you would evaluate (e.g. MediaPipe
   LLM Inference, llama.cpp bindings, ONNX Runtime, WebGPU / transformers.js, the platform
   speech recogniser) with their model-size, memory, latency and licensing implications, and
   flag where you are uncertain rather than asserting. If the web target cannot run this, say
   so and propose the degraded path (manual text entry, feature unavailable, or an
   explicitly-consented remote fallback that changes the trust copy).
3. **"The user authors every number."** Invariant 15 and the roadmap invariant *self-scored,
   never computed* exist because the product's whole thesis is that the user, not a machine,
   decides. A model that names your feelings for you is in direct tension with that. Resolve
   it: model output as *proposal awaiting confirmation* — editable, rejectable, never
   silently written. Show this in the UX, not just in a sentence.
4. **Non-clinical posture.** Descriptive vocabulary only — never evaluative ("healthy",
   "concerning"), no diagnostic claims, no streaks, no guilt. This applies to every string
   the model can emit, which is harder than it sounds: say how you constrain a generative
   model to that register (system prompt, closed emotion vocabulary, output schema,
   post-filter) and how that constraint is tested.
5. **Schema discipline.** Additive, `AutoMigrate`-compatible changes on both SQLite and
   Postgres; new models must be added to `AutoMigrate`; a non-nullable new column needs a
   `default` tag (trap 10f); JSON-in-text columns are the established pattern for structured
   payloads. Category ids are a permanent contract — if you introduce an emotion taxonomy it
   needs the same "ids are forever" treatment, and you should say where its allowlist lives
   in each language.
6. **Encryption.** Voice transcripts and a database of named people are the most sensitive
   payload in the product. Position this data inside `docs/13`'s envelope scheme: which
   fields are encrypted, what a blind index would have to do for person-matching to still
   work, and whether raw audio is ever persisted at all (recommend a retention default and
   justify it).
7. **Touch-axis ownership** (invariant 2g). A swipe-to-answer card competes with the page's
   vertical scroll. Declare who owns which axis, per screen.
8. **Testing.** `docs/08-testing.md` and the roadmap's per-phase rule apply. The Playwright
   E2E suite is currently non-functional, so propose Vitest + Go coverage plus a manual QA
   checklist — and say how you test a non-deterministic model (golden transcripts,
   schema-validity assertions, a mocked inference boundary).

## Deliverable

Write **one Markdown document** to `product_vision/06-emotional-journal.md`. Match the
voice, density, and formatting conventions of the existing `product_vision/` and `docs/`
files: numbered top-level sections, tables where a table is clearer than prose, Mermaid
diagrams where a diagram is clearer than a table, links to the docs you rely on, and no
filler. Use LF line endings.

Cover at least:

1. **Summary and the bet** — what this adds, and why it belongs in *this* product rather
   than being a generic mood tracker.
2. **How it relates to the existing model** — how emotional check-ins, the people database,
   and love snapshots coexist. One clear picture of the entities.
3. **The nightly ritual** — the proposed question set with the reasoning behind each
   question's inclusion, the swipe interaction, timing/trigger, skip semantics, copy.
4. **The voice check-in** — capture, transcription, inference, confirmation, correction, and
   the "ask for less dubious phrasing" path. Trace the Lucie example through every stage,
   showing the actual data at each step.
5. **The model layer** — task decomposition, one model or several, prompt/output contracts
   with concrete schemas, the closed vocabularies, failure and fallback behaviour, and the
   runtime/feasibility assessment demanded above.
6. **Data model** — proposed entities, columns, JSON payload shapes, versioning of the
   record format, migration and `AutoMigrate` notes, encryption positioning, and an explicit
   statement of how a future analysis adds fields without a rewrite.
7. **API surface** — new endpoints in the existing conventions, or a defence of why some of
   this data never reaches the server.
8. **The 3-D day graph** — axis semantics, the branching-curve construction rules,
   rendering-technology options with a recommendation, and how the pure-function
   testability rule is preserved.
9. **UX and navigation** — where the button lives on mobile and on web, how the ritual is
   surfaced, what the empty state looks like, how discretion mode and the app lock treat
   this data.
10. **Trust, privacy, and the copy that must change** — the exact edits the Vault page,
    `docs/01-concepts.md` §6, and the roadmap invariants would need.
11. **Implementation phases** — sequenced, each with a shippable outcome, dependencies, and
    a verification section in the style of the existing phase specs. Rough, not line-level:
    this is a plan, not a patch.
12. **Risks, trade-offs, and open questions** — including what you would want a user test to
    answer before building, and anything you deliberately left undecided.

Where you are uncertain about an external fact (what a given on-device runtime can do, what
a specific model is called or whether it exists in the size you want), say so explicitly and
frame it as something to verify — do not present a guess as settled. Prefer one recommended
option with its reasoning over an even-handed survey; note the runner-up in a sentence.
