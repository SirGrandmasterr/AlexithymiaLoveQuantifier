import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import CheckinComposer, { CheckinFab, CheckinButton, buildCheckinRequest } from './CheckinComposer';
import VoiceCapture, { createVoiceKit } from './VoiceCheckin';
import { createFakeJournalPlugin } from '../mobile/journalPlugin.fake';
import { DiscretionProvider } from '../context/DiscretionContext';
import { SubjectsProvider } from '../context/SubjectsContext';
import { JournalProvider } from '../context/JournalContext';
import { JOURNAL_COPY, fillCopy } from '../constants/journal';
import { createFakeRuntime, proposalFixture } from '../journal/inference/fake';
import { buildContext } from '../journal/inference';
import { WHISPER_TINY, modelSize } from '../journal/inference/models';

vi.mock('axios');

/* ------------------------------------------------------------------------------------ */
/* Fakes for the three things the kit holds                                               */
/* ------------------------------------------------------------------------------------ */

/** A recorder store with the same surface as the real one, driven by hand. */
const fakeRecorder = () => {
    const listeners = new Set();
    let snapshot = {
        state: 'idle', takeId: null, clips: [], level: 0, noisy: false,
        elapsedMs: 0, remainingMs: 30_000, stopReason: null, discardReason: null, error: null
    };
    const emit = () => { const frozen = snapshot; listeners.forEach(l => l(frozen)); };

    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        tap: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        addMore: vi.fn(),
        discard: vi.fn(),
        destroy: vi.fn(),
        /** Put a finished take in the recorder's hand, as the real one does after a stop. */
        landTake: (clips) => {
            snapshot = { ...snapshot, state: 'ready', takeId: 'take-1', clips };
            emit();
        },
        setState: (patch) => { snapshot = { ...snapshot, ...patch }; emit(); }
    };
};

const clip = (id, { noisy = false } = {}) => ({
    id, takeId: 'take-1', index: 0, audio: Float32Array.from([0.2, -0.2]),
    sampleRate: 16_000, durationMs: 1_500, stopReason: 'tap', noisy, floor: noisy ? 0.05 : 0.01
});

const fakeDownloader = (downloaded = true) => {
    const listeners = new Set();
    let snapshot = { state: 'idle', file: null, filesDone: 0, filesTotal: 13, loaded: 0, total: 45_245_009, error: null };
    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        start: vi.fn(async () => true),
        cancel: vi.fn(),
        remove: vi.fn(async () => true),
        isDownloaded: vi.fn(async () => downloaded),
        setState: (patch) => {
            snapshot = { ...snapshot, ...patch };
            const frozen = snapshot;
            listeners.forEach(l => l(frozen));
        }
    };
};

const kitWith = ({ runtime, downloaded = true } = {}) => ({
    model: WHISPER_TINY,
    recorder: fakeRecorder(),
    downloader: fakeDownloader(downloaded),
    runtime: runtime || createFakeRuntime(proposalFixture({
        transcript: 'Lucie called and I felt lighter afterwards.',
        language: 'en',
        feelings: [],
        ambiguity: 'feeling'
    }))
});

const renderCapture = (kit, props = {}) => render(
    <DiscretionProvider>
        <VoiceCapture
            kit={kit}
            context={buildContext({ relationships: [], triggers: [] })}
            transcript={null}
            onTranscript={() => { }}
            {...props}
        />
    </DiscretionProvider>
);

/* ------------------------------------------------------------------------------------ */
/* 1. The words                                                                           */
/* ------------------------------------------------------------------------------------ */

describe('the transcript', () => {
    it('writes down what was said, once a take lands', async () => {
        const kit = kitWith();
        const onTranscript = vi.fn();
        renderCapture(kit, { onTranscript });

        kit.recorder.landTake([clip('clip-1')]);

        await waitFor(() => expect(onTranscript).toHaveBeenCalled());
        expect(onTranscript).toHaveBeenCalledWith('Lucie called and I felt lighter afterwards.', 'en');
        expect(kit.runtime.calls).toHaveLength(1);
        expect(kit.runtime.calls[0].kind).toBe('audio');
    });

    it('throws the audio away as soon as the words exist', async () => {
        // §4.2: the audio lives in memory until the transcript does, and not one moment
        // longer. Nothing downstream needs it.
        const kit = kitWith();
        renderCapture(kit, { onTranscript: vi.fn() });

        kit.recorder.landTake([clip('clip-1')]);
        await waitFor(() => expect(kit.recorder.discard).toHaveBeenCalled());
    });

    it('renders the words as an editable box, and the edit is what the caller is given', async () => {
        // §4.3, and the reason it is a textarea rather than a quote: a model mishears names
        // most of all, and Lucy/Lucie is exactly the error that would create a second
        // relationship if it reached find-or-create unseen.
        // Held in state by a wrapper, because the contract under test is the round trip:
        // what the user leaves in the box is what the caller ends up holding. A component
        // rendered with a frozen prop would only prove that keystrokes fire a callback.
        const kit = kitWith();
        let latest = 'Lucy called';
        const Wrapper = () => {
            const [text, setText] = React.useState('Lucy called');
            latest = text;
            return (
                <DiscretionProvider>
                    <VoiceCapture
                        kit={kit}
                        context={buildContext({})}
                        transcript={text}
                        onTranscript={setText}
                    />
                </DiscretionProvider>
            );
        };
        render(<Wrapper />);

        const box = screen.getByLabelText(JOURNAL_COPY.voice.transcriptLabel);
        expect(box).toHaveValue('Lucy called');

        await userEvent.clear(box);
        await userEvent.type(box, 'Lucie called');

        expect(box).toHaveValue('Lucie called');
        expect(latest).toBe('Lucie called');
    });

    it('says so when the words could not be written down, and keeps the chips reachable', async () => {
        const kit = kitWith({
            runtime: createFakeRuntime([{ match: () => true, error: new Error('out of memory') }])
        });
        renderCapture(kit, { onTranscript: vi.fn() });

        kit.recorder.landTake([clip('clip-1')]);
        await screen.findByText(JOURNAL_COPY.voice.notWritten);
    });

    it('says so when the microphone was refused, without calling it an error', async () => {
        const kit = kitWith();
        renderCapture(kit);
        kit.recorder.setState({ state: 'error', error: { kind: 'permission' } });

        expect(await screen.findByText(JOURNAL_COPY.voice.denied)).toBeInTheDocument();
    });
});

/* ------------------------------------------------------------------------------------ */
/* 2. The noisy-take flag                                                                 */
/* ------------------------------------------------------------------------------------ */

describe('the noisy-take hint', () => {
    it('renders when the meter flagged the take, beside the words', async () => {
        const kit = kitWith();
        const { rerender } = renderCapture(kit, { onTranscript: vi.fn() });

        kit.recorder.landTake([clip('clip-1', { noisy: true })]);
        await waitFor(() => expect(kit.recorder.discard).toHaveBeenCalled());

        rerender(
            <DiscretionProvider>
                <VoiceCapture
                    kit={kit}
                    context={buildContext({})}
                    transcript="Lucie called"
                    onTranscript={vi.fn()}
                />
            </DiscretionProvider>
        );
        expect(screen.getByText(JOURNAL_COPY.voice.noisy)).toBeInTheDocument();
    });

    it('does not render for a quiet take, however the words came out', async () => {
        const kit = kitWith();
        renderCapture(kit, { transcript: 'Lucie called', onTranscript: vi.fn() });

        kit.recorder.landTake([clip('clip-1', { noisy: false })]);
        await waitFor(() => expect(kit.recorder.discard).toHaveBeenCalled());

        expect(screen.queryByText(JOURNAL_COPY.voice.noisy)).not.toBeInTheDocument();
    });
});

/* ------------------------------------------------------------------------------------ */
/* 3. The download manager                                                                */
/* ------------------------------------------------------------------------------------ */

describe('the download manager', () => {
    it('shows the size before anything downloads, and downloads nothing on its own', async () => {
        const kit = kitWith({ downloaded: false });
        renderCapture(kit);

        await screen.findByText(fillCopy(JOURNAL_COPY.settings.voice.size, { label: kit.label, size: kit.size }));
        expect(kit.downloader.start).not.toHaveBeenCalled();
        // And the typed path is one tap away meanwhile (§9.4).
        expect(screen.getByText(JOURNAL_COPY.voice.keyboard)).toBeInTheDocument();
    });

    it('starts only when asked, and can be cancelled', async () => {
        const kit = kitWith({ downloaded: false });
        // A download that never finishes, which is the only state cancel exists for.
        kit.downloader.start.mockImplementation(() => new Promise(() => { }));
        renderCapture(kit);

        await userEvent.click(await screen.findByText(new RegExp(`Download ${kit.label}`)));
        expect(kit.downloader.start).toHaveBeenCalledTimes(1);

        kit.downloader.setState({ state: 'downloading', loaded: 10_000_000 });
        await userEvent.click(await screen.findByText(JOURNAL_COPY.empty.modelDownloadCancel));
        expect(kit.downloader.cancel).toHaveBeenCalledTimes(1);
    });

    it('says a checksum failure is the server operator problem, and offers no way past it', async () => {
        const kit = kitWith({ downloaded: false });
        renderCapture(kit);
        await screen.findByText(new RegExp(`Download ${kit.label}`));

        kit.downloader.setState({ state: 'error', error: { kind: 'checksum', message: 'no' } });

        expect(await screen.findByText(JOURNAL_COPY.settings.voice.checksumError)).toBeInTheDocument();
        // No retry, no "use it anyway": every one of those turns a tampering signal into a
        // warning nobody reads.
        expect(screen.queryByText(new RegExp(`Download ${kit.label}`))).not.toBeInTheDocument();
    });
});

/* ------------------------------------------------------------------------------------ */
/* 4. Which button the journal offers                                                     */
/* ------------------------------------------------------------------------------------ */

describe('the way in', () => {
    it('is a microphone where voice is on, and a keyboard where it is not', async () => {
        const { rerender } = render(<CheckinFab onOpen={vi.fn()} voice />);
        expect(screen.getByRole('button')).toHaveAttribute('data-checkin-mode', 'voice');
        expect(screen.getByRole('button')).toHaveAccessibleName(JOURNAL_COPY.voice.open);

        rerender(<CheckinFab onOpen={vi.fn()} voice={false} />);
        expect(screen.getByRole('button')).toHaveAttribute('data-checkin-mode', 'chips');
        expect(screen.getByRole('button')).toHaveAccessibleName(JOURNAL_COPY.checkin.open);
    });

    it('tells the composer which way in was taken', async () => {
        const onOpen = vi.fn();
        render(<CheckinButton onOpen={onOpen} voice />);
        await userEvent.click(screen.getByRole('button'));
        expect(onOpen).toHaveBeenCalledWith('voice');
    });
});

/* ------------------------------------------------------------------------------------ */
/* 5. The payload                                                                         */
/* ------------------------------------------------------------------------------------ */

describe('what a spoken check-in saves', () => {
    const picked = [{ id: 'rapport', intensity: 2, uncertain: false, about: [] }];

    it('is source voice, with the words the user left in the box', () => {
        const request = buildCheckinRequest({
            picked, tags: [], note: '', transcript: '  Lucie called  ', language: 'en'
        });

        expect(request.payload.source).toBe('voice');
        expect(request.payload.transcript).toBe('Lucie called');
        expect(request.payload.transcript_kept).toBe(true);
        expect(request.payload.language).toBe('en');
    });

    it('keeps the structure and drops the words when Keep transcripts is off', () => {
        const request = buildCheckinRequest({
            picked, tags: [], note: '', transcript: 'Lucie called', language: 'en', keepTranscript: false
        });

        // `false` is written, unlike an absent key: here it is a statement the user made in
        // settings, and it is the difference between "nothing was said" and "what was said
        // was not kept" (invariant 14).
        expect(request.payload.transcript_kept).toBe(false);
        expect(request.payload).not.toHaveProperty('transcript');
        expect(request.payload.source).toBe('voice');
        expect(request.payload.feelings).toHaveLength(1);
    });

    it('leaves the chips and typed paths exactly as they were', () => {
        expect(buildCheckinRequest({ picked, tags: [], note: '' }).payload.source).toBe('chips');
        expect(buildCheckinRequest({ picked, tags: [], note: 'a sentence' }).payload.source).toBe('typed');
        expect(buildCheckinRequest({ picked, tags: [], note: '' }).payload).not.toHaveProperty('transcript_kept');
        // A transcript that came back empty is not a spoken entry with no words in it; it is
        // an entry nobody managed to speak.
        expect(buildCheckinRequest({ picked, tags: [], note: '', transcript: '   ' }).payload.source).toBe('chips');
    });
});

/* ------------------------------------------------------------------------------------ */
/* 6. Discretion                                                                          */
/* ------------------------------------------------------------------------------------ */

describe('discretion mode', () => {
    const renderJournalFab = () => {
        axios.get.mockImplementation((url) => {
            if (url === '/api/relationships') return Promise.resolve({ data: [] });
            if (url.startsWith('/api/journal')) return Promise.resolve({ data: [] });
            return Promise.resolve({ data: [] });
        });
        return render(
            <MemoryRouter initialEntries={['/journal']}>
                <DiscretionProvider>
                    <SubjectsProvider>
                        <JournalProvider>
                            <CheckinComposer onClose={vi.fn()} onSaved={vi.fn()} mode="chips" />
                        </JournalProvider>
                    </SubjectsProvider>
                </DiscretionProvider>
            </MemoryRouter>
        );
    };

    it('blurs the transcript like every other transcript in the app', () => {
        window.localStorage.setItem('alq:discreet', 'true');
        renderCapture(kitWith(), { transcript: 'Lucie called', onTranscript: vi.fn() });

        expect(screen.getByLabelText(JOURNAL_COPY.voice.transcriptLabel).className).toMatch(/blur/);
        window.localStorage.removeItem('alq:discreet');
    });

    it('opens a chips composer with no recorder at all', () => {
        // The composer only builds a kit for a composer that was opened by the microphone,
        // so the chips path never asks for a device.
        renderJournalFab();
        expect(screen.queryByTitle(JOURNAL_COPY.voice.openHint)).not.toBeInTheDocument();
    });
});

/* ------------------------------------------------------------------------------------ */
/* 7. The copy rail                                                                       */
/* ------------------------------------------------------------------------------------ */

describe('no bare strings (Appendix B item 3)', () => {
    it('says nothing the forbidden-word walk cannot reach', async () => {
        const kit = kitWith();
        const { container } = renderCapture(kit, { transcript: 'Lucie called', onTranscript: vi.fn() });

        const allowed = new Set([
            ...Object.values(JOURNAL_COPY.voice).filter(value => typeof value === 'string'),
            ...Object.values(JOURNAL_COPY.voice.clips),
            fillCopy(JOURNAL_COPY.voice.limit, { seconds: 30 }),
            JOURNAL_COPY.empty.modelDownloadCancel
        ]);

        const words = [...container.querySelectorAll('*')]
            // The transcript box is excluded, and that is the point rather than an
            // exception: what is inside it is the **user's own speech**, which no copy
            // rail may govern. It is the same carve-out D1's filter has to make.
            .filter(element => element.tagName !== 'TEXTAREA')
            .flatMap(element => [...element.childNodes])
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent.trim())
            .filter(text => /[A-Za-z]{3,}/.test(text));

        expect(words.length).toBeGreaterThan(2);
        expect(words.filter(text => !allowed.has(text))).toEqual([]);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 8. The Android kit (C4)                                                               */
/* ------------------------------------------------------------------------------------ */

describe('the Android kit', () => {
    const nativeKit = (options = {}) => {
        const plugin = createFakeJournalPlugin({ downloaded: true, permission: 'prompt', ...options });
        return { plugin, kit: createVoiceKit({ native: true, plugin, tier: 'light', ...options.kit }) };
    };

    it('asks the plugin for nothing but whether the model is here when the composer opens', async () => {
        const { plugin, kit } = nativeKit();
        renderCapture(kit);
        await screen.findByTitle(JOURNAL_COPY.voice.openHint);

        expect(plugin.names()).toEqual(['modelStatus', 'modelStatus']);
        expect(plugin.permissionState()).toBe('prompt');
    });

    // The button leaves the screen while the permission is pending (`busy`) and comes back
    // as a new element, so it is queried again after every tap rather than held.
    const recordButton = () => screen.getByTitle(JOURNAL_COPY.voice.openHint);

    it('asks for the microphone on the first tap — check, request, open — and lights the button', async () => {
        const { plugin, kit } = nativeKit();
        renderCapture(kit);
        await screen.findByTitle(JOURNAL_COPY.voice.openHint);

        await userEvent.click(recordButton());

        await waitFor(() => expect(plugin.names().filter(name => name !== 'modelStatus'))
            .toEqual(['checkPermissions', 'requestPermissions', 'startCapture']));
        await waitFor(() => expect(recordButton()).toHaveAttribute('aria-pressed', 'true'));
    });

    it('falls through to the typed path with no error dialog when the permission is refused', async () => {
        const alert = vi.spyOn(window, 'alert').mockImplementation(() => { });
        const { plugin, kit } = nativeKit({ grant: false });
        renderCapture(kit);
        await screen.findByTitle(JOURNAL_COPY.voice.openHint);

        await userEvent.click(recordButton());

        expect(await screen.findByText(JOURNAL_COPY.voice.denied)).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(alert).not.toHaveBeenCalled();
        expect(plugin.names()).not.toContain('startCapture');
        // The microphone stays to try again; the chip grid below is the composer's and untouched.
        expect(recordButton()).toHaveAttribute('aria-pressed', 'false');
        alert.mockRestore();
    });

    it('transcribes through the plugin with handles, and releases the audio once the words exist', async () => {
        const { plugin, kit } = nativeKit({ permission: 'granted', transcript: 'Lucie called.' });
        const onTranscript = vi.fn();
        renderCapture(kit, { onTranscript });
        await screen.findByTitle(JOURNAL_COPY.voice.openHint);

        await userEvent.click(recordButton());
        await waitFor(() => expect(recordButton()).toHaveAttribute('aria-pressed', 'true'));
        await userEvent.click(recordButton());

        await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('Lucie called.', 'en'));
        const call = plugin.calls.find(entry => entry.name === 'transcribe');
        expect(call.args.handles).toEqual(['clip-1']);
        expect(call.args).not.toHaveProperty('audio');
        await waitFor(() => expect(plugin.names()).toContain('releaseClip'));
        expect(plugin.clips.size).toBe(0);
    });
});
