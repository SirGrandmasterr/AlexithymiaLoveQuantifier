import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscretionProvider, useDiscretion, initials } from './DiscretionContext';

const Probe = () => {
    const { discreet, toggle, maskName, blurClass } = useDiscretion();
    return (
        <div>
            <span data-testid="state">{discreet ? 'discreet' : 'open'}</span>
            <span data-testid="name">{maskName('Alex Taylor')}</span>
            <span data-testid="note" className={blurClass}>a private note</span>
            <button onClick={toggle}>toggle</button>
        </div>
    );
};

const renderProbe = () => render(<DiscretionProvider><Probe /></DiscretionProvider>);

describe('initials', () => {
    it('reduces a name to something only you can place', () => {
        expect(initials('Alex')).toBe('A.');
        expect(initials('Alex Taylor')).toBe('A. T.');
        expect(initials('  sam  ')).toBe('S.');
        // Three words stop at two — the point is a hint, not a fingerprint.
        expect(initials('Mary Jane Watson')).toBe('M. J.');
    });

    it('never returns an empty label', () => {
        expect(initials('')).toBe('—');
        expect(initials(null)).toBe('—');
    });
});

describe('DiscretionProvider', () => {
    beforeEach(() => {
        localStorage.clear();
        document.title = 'AlexithymiaLoveQuantifier';
    });

    it('is off until asked for', () => {
        renderProbe();

        expect(screen.getByTestId('state')).toHaveTextContent('open');
        expect(screen.getByTestId('name')).toHaveTextContent('Alex Taylor');
        expect(screen.getByTestId('note').className).toBe('');
    });

    it('collapses names to initials and blurs notes when on', async () => {
        renderProbe();

        await userEvent.click(screen.getByRole('button', { name: 'toggle' }));

        expect(screen.getByTestId('name')).toHaveTextContent('A. T.');
        expect(screen.getByTestId('note').className).toMatch(/blur/);
        // Hovering reveals one item at a time rather than turning the whole mode off.
        expect(screen.getByTestId('note').className).toMatch(/hover:blur-none/);
    });

    it('drops the app name from the tab title', async () => {
        renderProbe();
        expect(document.title).toBe('AlexithymiaLoveQuantifier');

        await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
        expect(document.title).toBe('Notes');

        await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
        expect(document.title).toBe('AlexithymiaLoveQuantifier');
    });

    it('toggles on Ctrl+. without moving your hand to the mouse', async () => {
        renderProbe();

        await userEvent.keyboard('{Control>}.{/Control}');
        expect(screen.getByTestId('state')).toHaveTextContent('discreet');

        await userEvent.keyboard('{Control>}.{/Control}');
        expect(screen.getByTestId('state')).toHaveTextContent('open');
    });

    it('remembers the choice across a reload', async () => {
        const first = renderProbe();
        await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
        first.unmount();

        renderProbe();
        expect(screen.getByTestId('state')).toHaveTextContent('discreet');
    });
});
