I'll start by reading the project's documentation to ground the product evaluation in what the app actually does today.

The concepts doc gives me the core thesis. Let me read the frontend walkthrough and known issues to understand current UX friction points.

I've read the documentation (concepts, frontend walkthrough, and known issues). I now have a clear picture of the product's thesis, its current experience, and where it leaks motivation. Here is the full product evaluation and roadmap.

---

# Product Evaluation — Alexithymia Love Quantifier

## Where the product stands

The core thesis is genuinely strong and differentiated: **"If you can't name what you feel, you can still record what you do."** No competitor in the quantified-self space treats emotional estimation as a behavioral observation problem, and the refusal to compute or infer scores is a feature, not a limitation — it keeps the user the author of their own emotional record. The longitudinal snapshot/version model is exactly right: the signal is drift, not any single reading.

But the current product is an instrument without a payoff loop. Evaluating it against the question *"why would someone use this consistently?"*:

**Gaps in user motivation**
- **Scoring has no immediate reward.** After moving seven sliders, the user sees… the same card they started with. The insight (the timeline) is buried behind a separate action, and it only becomes interesting after months of unrewarded effort. The habit dies in the gap between first snapshot and first "aha."
- **Nothing ever invites the user back.** The docs explicitly state: no notifications, no reminders, no scheduling. A longitudinal product with no cadence mechanism is asking users to remember to remember — precisely the population least likely to have a felt urge ("I miss reflecting on this") pulling them back.
- **The dashboard shows data, not meaning.** Seven thin bars per card require interpretation work on every glance. There is no summary, no "what changed," no shape.

**Friction points in self-reflection**
- **The 0–100 slider demands the exact introspective act the app exists to avoid.** The behavioral metrics — the app's best asset — live in a separate modal (the Category Explorer), disconnected from the moment of scoring. The user must hold "You experience genuine distress if they don't reply…" in memory while staring at an unanchored number line. That's a calibration tool kept in a different room from the instrument.
- **Snapshots are context-free.** A `description` field exists in the data model but has no UI (and is currently silently erased on edit). Six months later, a Mania spike in March is an uninterpretable squiggle: was that the fight? The trip? The silence? Numbers without context don't compound into insight — they decay.
- **False precision and no way to express uncertainty.** Is 62 different from 65? The app can't distinguish "scored zero" from "never scored," and a user who genuinely doesn't know has no honest option. For alexithymic users, "I'm not sure" is the most common true answer, and the UI forbids it.
- **Onboarding drops users onto an empty grid.** The Landing page's "Learn the Theory" button does nothing; the teaching surface is an optional ⓘ modal. The user's first snapshot — the moment that decides adoption — is unguided.

**Untapped potential in visualization**
- The timeline treats time categorically: two snapshots a day apart and two a year apart are rendered identically, which quietly falsifies the one thing the app is about — change *over time*.
- Seven dimensions per subject is a *shape*, and shapes are what humans remember. There's no radar/profile view, no overlay comparison, no cross-relationship perspective — even though the deepest promise of the data is the pattern *across* relationships: "my Mania is high with everyone; that's about me."

---

# Product Vision

> **A private observatory for your relational life.** You can't always name what you feel — but you can always record what you do, and over months and years, the record becomes the feeling made visible. The app should close a loop it currently leaves open: **Observe → Score with confidence → See what changed, immediately → Anchor it in context → Be gently invited back.**

Every feature below preserves the two founding constraints: **the user authors every number** (no inference, no AI, no hidden math), and **nothing is clinical** (a mirror, not a diagnosis).

---

## 1. Onboarding, Calibration & Introspection (Making Scored Value Clear)

### 1.1 Guided First Constellation
**Vision:** Replace the empty-grid first run with a walkthrough that teaches the taxonomy *by using it* — one category per step, full description and behavioral indicators inline, ending with the user's first complete profile.

**Problem addressed:** The current teaching surface is an optional modal, and the first snapshot is unguided. New users face seven abstract Greek words and seven naked sliders; most will score arbitrarily, distrust the result, and never return. Also — a first snapshot of a *current* relationship has no comparison point, so it feels inert.

**How it works:** On first login, the app offers: "Let's map your first relationship — it can even be a past one." Each step shows one category's full description, core motivation, and its behavioral indicators as the scoring surface (see 1.2), with a progress dot rail. A closing screen renders the finished profile as a shape (see 2.1) with a one-line orientation: "This is your starting point. The interesting part is what this looks like in three months." Suggesting a *past* relationship as the first subject is deliberate: it's emotionally safer, the user already knows the ending, and it instantly seeds the account with a baseline to compare against.

**Value proposition:** The first ten minutes convert the taxonomy from jargon into a personal vocabulary. A user who *understands* their first profile has a reason to make a second one — and the past-relationship trick means the app demonstrates comparison value on day one instead of month three.

### 1.2 Metric-First Guided Scoring
**Vision:** Promote the behavioral indicators from educational sidebar copy to the primary scoring instrument, with the final number always human-chosen.

**Problem addressed:** Jumping straight to "rate your Eros 0–100" is a huge introspective leap — the exact act alexithymia makes hard. The metrics ("You experience genuine distress if they do not reply within a specific timeframe") are observable and answerable, but they currently live in a separate modal the user must consult from memory.

**How it works:** In the snapshot form, each category offers an optional "Guide me" expansion: its 2–4 behavioral indicators appear as individual frequency ratings (Never / Sometimes / Often / Constantly). As the user answers, a **transparent suggestion band** appears on the category slider — visibly plain arithmetic ("your three answers average to the 55–70 range"), never hidden inference. The user then sets the final value themselves, inside or outside the band. Fast users can skip guides entirely and slide directly.

**Value proposition:** This is the app's thesis made tactile: behavior in, estimate out, human in charge. Users stop guessing and start *observing*, scores become defensible ("I put 68 because these three things are true"), and session-to-session consistency improves — which is what makes the longitudinal data trustworthy enough to act on.

### 1.3 Anchored Sliders
**Vision:** Give every slider position a behavioral meaning, so a number is never just a number.

**Problem addressed:** 0–100 implies false precision and produces scoring anxiety ("is it 62 or 65?"). Without anchors, a user's "70" in January and "70" in June may mean different things, silently corrupting the timeline.

**How it works:** Each category defines short anchor phrases for score bands (e.g., Eros 0–20: "You notice them the way you notice anyone"; 40–60: "Attraction is present but doesn't occupy your thoughts"; 80–100: "Their presence physically changes your state"). As the slider moves, the current band's phrase updates live beneath it. Band boundaries are subtly ticked on the track.

**Value proposition:** Anchors convert the slider from an introspection test into a recognition task — "which sentence is true of me?" — which is dramatically easier for the target user. They also stabilize the scale across months, protecting the integrity of the app's core asset: comparable longitudinal data.

### 1.4 Context Capsules (Snapshot Tagging & Notes)
**Vision:** Every snapshot can carry a small capsule of life context — event chips and a free-text note — so future-you can interpret past-you.

**Problem addressed:** Numbers without context decay into noise. The data model already anticipates this (a description field exists) but the UI never exposed it — and currently *erases* it on edit. A Mania spike in March is meaningless without "that was the month of the long-distance move."

**How it works:** After the sliders, an optional final step asks "What's been happening?" — quick chips (conflict · distance · trip together · milestone · reconciliation · routine period · big life change) plus a short note field. Chips and notes surface as markers on the timeline (see 2.3) and on the card's history scrub.

**Value proposition:** This is the cheapest feature with the highest compounding return: it converts each snapshot from a data point into a diary entry, and the archive from a spreadsheet into a story. It also fixes a silent data-loss trap before any user is hurt by it.

### 1.5 Honest Uncertainty ("I'm not sure" is a valid answer)
**Vision:** Let users skip a category or flag a score as uncertain, and render that honestly everywhere.

**Problem addressed:** The system currently cannot distinguish "scored zero" from "never scored," and a user who genuinely can't estimate a dimension must either fabricate a number or abandon the snapshot. For this audience, forced certainty is a design insult.

**How it works:** Each category slider gains two affordances: **Skip** (renders as an absent/hatched segment, not a zero bar) and **Unsure** (score is kept but displayed with a softer, dashed treatment on cards and timeline). The timeline legend explains both. A later snapshot resolving an unsure score is a quiet moment of progress the recap (3.3) can celebrate.

**Value proposition:** Permission to be uncertain lowers the barrier to snapshotting at all — the single biggest retention lever. And it makes the dataset *more* truthful, not less: an honest gap beats a fabricated 50.

---

## 2. Emotional Intelligence & Pattern Discovery (The "Aha!" Insights)

### 2.1 Love Shapes (Radar Profile Identity)
**Vision:** Every snapshot renders as a seven-axis shape — giving each relationship a visual identity you recognize at a glance, the way you recognize a face.

**Problem addressed:** Seven horizontal bars require serial reading; nothing on the dashboard produces gestalt. Users can't answer "what kind of love is this?" without mentally aggregating seven numbers.

**How it works:** A toggle on each card and in the timeline switches between bars and a radar polygon in the category colors. The magic is **overlay**: current shape vs. previous snapshot (ghosted), vs. the relationship's first snapshot, or vs. another relationship entirely. Shapes animate between versions when scrubbing the card stack — the polygon visibly *breathes* across history.

**Value proposition:** Shape memory is the stickiest form of insight — users will start thinking in the app's vocabulary ("we started Eros-spiked and settled into a Storge diamond"). When a product gives you words and images for something previously unnameable, deleting it starts to feel like amnesia. That's retention.

### 2.2 "What Changed" — the Post-Snapshot Payoff
**Vision:** The moment a new version is saved, the app answers the question the user actually has: *what moved?*

**Problem addressed:** Saving a snapshot currently returns the user to the grid with zero acknowledgment. The core reward of longitudinal tracking — seeing change — is locked in a chart the user must seek out and eyeball. The habit loop has no reward step.

**How it works:** After saving any non-first version, a summary screen appears: plain-arithmetic deltas since the previous snapshot ("Storge +15 · Mania −22 · everything else steady"), the time elapsed ("11 weeks since your last check-in"), and the shape overlay (2.1). Wording is strictly descriptive — the app states subtraction, the human supplies meaning. One optional prompt: "Want to note what you think drove this?" (feeding 1.4).

**Value proposition:** This closes the loop that currently leaks every user: effort → *immediate, personal, surprising* payoff. It's the single highest-impact retention feature in this roadmap, and it requires no inference — just subtraction, framed well.

### 2.3 A Truthful Timeline (Real Time-Axis + Milestone Markers)
**Vision:** Make the timeline honest about time, and annotate it with the life events that explain it.

**Problem addressed:** The current chart spaces snapshots evenly regardless of real intervals — a day's gap and a year's gap look identical, which misrepresents the one thing the product measures. And events (from 1.4) are invisible, so correlation can never be *seen*.

**How it works:** The x-axis becomes proportional to real time. Context capsules render as slim vertical markers with their chip icon; hovering reveals the note. Long gaps between snapshots render as visibly long — itself a gentle, wordless nudge about cadence. Line-toggling stays (isolating Mania vs. Storge is already the app's best interaction — keep it).

**Value proposition:** The moment a user *sees* "Mania spiked right at the 'long-distance' marker, then decayed over six months" — without the app claiming causation — is the product's signature aha. It converts skeptics of self-quantification because the insight is visibly *theirs*, drawn from their own annotations.

### 2.4 Relationship Summary Line (Glanceable Meaning on Cards)
**Vision:** Each card carries one line of derived-but-transparent description: dominant styles and the most-changed dimension.

**Problem addressed:** The dashboard is where users spend their glancing time, and it currently offers only raw bars — meaning requires work on every visit.

**How it works:** Under each card's name: "**Storge · Pragma** dominant — **Mania** most volatile," computed by simple max/variance over history and visibly explained on tap ("'most volatile' = biggest range across your snapshots"). Deliberately descriptive vocabulary — never evaluative words like "healthy" or "concerning."

**Value proposition:** Glanceable meaning turns a data grid into a reflective surface. Users open the app between snapshots just to look — and an app that gets opened idly is an app that survives.

### 2.5 The Relational Fingerprint (Cross-Relationship Perspective)
**Vision:** The view the whole dataset has been quietly earning: patterns of *the user* across all their relationships.

**Problem addressed:** Every current view is single-subject. But the profoundest insight this data can offer is about the self: "My Mania runs high with everyone — that's not about them." No single-relationship view can reveal it.

**How it works:** A "Your Patterns" screen with two lenses: **per-dimension small multiples** ("your Agape, across everyone you've mapped") and **two-subject shape comparison** (radar overlays). A gentle framing header sets the interpretive posture: "These patterns describe your observations — what repeats may say more about you than about them."

**Value proposition:** This is the feature users will describe to friends in hushed tones. It fulfills the app's implicit promise — not a tool for judging others, but a mirror for a self that's hard to see directly. It's also unique leverage: the value grows superlinearly with every relationship added, deepening lock-in of the best kind (earned, not engineered).

---

## 3. Longitudinal Engagement & Retention (Building a Self-Reflection Habit)

### 3.1 Gentle Cadence (Per-Relationship Check-In Rhythm)
**Vision:** The user chooses a reflection rhythm per relationship; the app holds the calendar so the user doesn't have to.

**Problem addressed:** The product's value is longitudinal, yet nothing invites the user back — the docs list "no notifications, reminders, or scheduling" as deliberate negative space. That's fatal for a habit product: the target user, by definition, won't get a felt urge pulling them back.

**How it works:** Per stack, an optional cadence: monthly / quarterly / "just remind me if it's been a while." Nudges are calm and in-product first — a soft dashboard banner ("It's been 9 weeks since your last snapshot of Alex") — with opt-in email digest for self-hosters. Crucially: **no streaks, no badges, no guilt mechanics.** A missed check-in is met with "welcome back," never a broken chain. Gamifying intimate reflection would poison the product's trust.

**Value proposition:** Cadence is the difference between a tool used twice and an archive spanning years. Respecting the user's autonomy in *how* they're nudged is itself the retention strategy for this audience.

### 3.2 Quick Pulse (The 60-Second Check-In)
**Vision:** A lightweight snapshot mode for busy months: confirm or nudge, don't re-derive.

**Problem addressed:** A full snapshot — seven dimensions, careful calibration — is heavy, and heavy rituals get deferred, then abandoned. The current form offers no middle ground between "full assessment" and "nothing."

**How it works:** "Quick pulse" pre-fills all values from the last snapshot. The user swipes through categories confirming "unchanged" or nudging the slider; a full pass takes under a minute. Pulses are visually distinguished from full snapshots on the timeline (smaller markers), preserving data honesty.

**Value proposition:** Lowering the floor keeps the cadence alive through the exact periods — stress, busyness, ambivalence — when reflection lapses and when the data is most interesting. More points on the timeline also make every visualization in Section 2 better.

### 3.3 The Annual Constellation (Recaps)
**Vision:** A yearly (and optionally seasonal) generated retrospective: how every shape evolved, the biggest shifts, the milestones logged, the uncertainties resolved.

**Problem addressed:** Longitudinal effort needs a compounding-interest moment — a scheduled payoff that makes months of small entries feel like an achievement. Nothing currently ever *sums up*.

**How it works:** Each January (and optionally per season), a "Your Year" view assembles: animated shape evolution per relationship, the year's largest single delta ("your biggest shift: Storge with Sam, +31"), the milestone markers as a life-events strip, and simple counts ("14 snapshots · 3 relationships · 9 notes"). Everything is arithmetic over the user's own entries — assembled, never interpreted. Exportable as a keepsake PDF (see 4.2).

**Value proposition:** Recaps are the moment users feel the archive's weight — and the moment they resolve to keep going. It's also the natural annual re-activation event for users who drifted away.

### 3.4 The Story View (Reflection Journal Thread)
**Vision:** Read a relationship as a narrative — notes, milestones, and shape-changes interleaved chronologically — and write into it anytime, without scoring.

**Problem addressed:** Some days the user has words but no appetite for sliders; currently there is nothing to do in the app between snapshots, so between-snapshot engagement is zero. And notes attached only to snapshots (1.4) can't capture what happens *between* them.

**How it works:** Each stack gains a "Story" tab: a vertical thread where every snapshot (with its mini-shape and deltas), context capsule, and standalone dated journal entry appears in order. A "Write" button adds an entry to any relationship at any moment — no score required. Entries appear as markers on the timeline like milestones.

**Value proposition:** Journaling is the bridge habit — it keeps users touching the app weekly even when snapshots are monthly, and each entry enriches the interpretive context that makes the quantitative views meaningful. Numbers make the words legible; words make the numbers matter.

---

## 4. Privacy, Portability & Ownership (Building Trust)

### 4.1 The Vault (Complete Export & Import)
**Vision:** One click produces everything the user has ever entered — structured data plus a human-readable archive — and the app can fully restore from it.

**Problem addressed:** Self-hosters adopt tools they can leave. Today there is no export at all: years of intimate reflection would live in an opaque database, which sophisticated users correctly read as a reason not to invest in the first place.

**How it works:** Settings → "Your Vault": export all subjects, versions, notes, milestones, and profile as JSON (canonical, re-importable), CSV (per-relationship spreadsheets), and a rendered archive document. Import restores or merges. A visible "last export" date doubles as a backup nudge.

**Value proposition:** Paradoxically, a flawless exit door is what makes people move in. For a product asking users to deposit years of emotional history, demonstrable ownership is the adoption argument.

### 4.2 The Relationship Dossier (Printable Summaries)
**Vision:** A beautifully typeset, self-contained document for one relationship: current shape, full timeline, milestones, and selected notes.

**Problem addressed:** Insight trapped on a screen can't travel to where it's needed — a conversation with a partner, a session with a therapist, or simply an armchair away from the computer. (Framed strictly as *the user's personal document to bring along* — never as a clinical report.)

**How it works:** From any stack: "Create dossier," with checkboxes for what to include (notes can be excluded wholesale), rendered as a clean PDF with the shape chart, time-proportional timeline with markers, and the delta summary. The annual recap (3.3) exports the same way.

**Value proposition:** A tangible artifact is proof of value users can hold — and the moment someone brings a dossier to a real conversation, the app has graduated from curiosity to instrument. Physical artifacts also survive app abandonment and often *cause* re-adoption.

### 4.3 The Trust Page (Local-First Posture, Made Visible)
**Vision:** A dedicated in-app page that states, plainly and verifiably, where the data lives and what leaves the machine (nothing).

**Problem addressed:** The app's privacy architecture is genuinely excellent — self-hosted, single-user, no third-party calls — but architecture users can't *see* earns no trust. Privacy is currently an implementation detail rather than a felt feature.

**How it works:** "Your data" page: storage location, database size, snapshot count, no-telemetry statement, last-export date with a one-click export shortcut, and plain-language answers ("Who can see this? Only you. What does the app send anywhere? Nothing."). 

**Value proposition:** For a tool holding scored assessments of the people in your life, trust is the entire purchase decision. Converting the privacy posture from README trivia into a first-class surface is cheap and decisively differentiating against every cloud-based feelings app.

### 4.4 Discretion Mode (Shoulder-Surfing Protection)
**Vision:** Make the app safe to have open on a shared desk or a living-room screen.

**Problem addressed:** This data is uniquely radioactive at a glance — a visible screen scoring "Mania: 84" next to a partner's name can do real interpersonal damage. Fear of exactly that scenario silently suppresses usage frequency, and no amount of server-side privacy addresses it.

**How it works:** A quick-toggle discretion mode: names collapse to initials, notes blur until hovered, and an optional app-level passphrase gates entry independent of login session. One keystroke restores full view.

**Value proposition:** Removing the ambient anxiety of being *seen using it* is an invisible but real retention lever — people use reflective tools more when using them feels safe. This is the privacy feature no competitor thinks to build because it only matters for data this intimate.

### 4.5 Deliberate Share (Anonymized Single-Snapshot Export)
**Vision:** Sharing stays outside the app — but when a user *chooses* to open up, the app helps them do it safely.

**Problem addressed:** The app is rightly single-user with no social graph. But the healthiest outcome of self-reflection is often a conversation — "here's the shape of how I love you" — and today the only way to share is a raw screenshot with full names and every dimension exposed.

**How it works:** From any snapshot or timeline: "Create shareable image/PDF" with granular stripping — pseudonymize or remove names, exclude chosen dimensions (a user may share their Storge and hold their Mania private), exclude all notes by default. Output is a static file the user sends however they like; nothing ever transmits from the app itself.

**Value proposition:** This honors the no-inter-user-features principle while serving the moment the product has been building toward: turning private understanding into a real, vulnerable, chosen conversation. Users who have that conversation credit the app for it — and that's the loyalty no engagement mechanic can buy.

---

## Sequencing recommendation

If forced to order the roadmap by retention impact per unit of effort: **2.2 (What Changed)** first — it installs the missing reward into the existing loop; then **1.4 (Context Capsules)**, which rescues the dead notes field and starts compounding context immediately; then **1.2/1.3 (guided, anchored scoring)** to make the data trustworthy; then **3.1 (Gentle Cadence)** to make it continuous; then the identity-forming visualizations (**2.1, 2.3, 2.5**) and the trust suite (**4.x**), which convert committed users into permanent ones.

The through-line for every decision above: this app wins not by telling users how they feel — its founding refusal — but by making their own record so legible, so contextualized, and so safely theirs that *the record itself* becomes the feeling made visible.