import { useEffect, useRef, useState } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { isNative } from './platform';

const TRIGGER_PX = 72;
/** Beyond this the indicator stops following the finger, so the gesture has a felt ceiling. */
const MAX_PULL_PX = 110;

export default function usePullToRefresh(onRefresh, enabled = true) {
    const [pull, setPull] = useState(0);
    const [refreshing, setRefreshing] = useState(false);

    // Read inside listeners that are registered once, so they never see a stale closure.
    const state = useRef({ startY: null, armed: false, refreshing: false });
    const handler = useRef(onRefresh);
    handler.current = onRefresh;

    useEffect(() => {
        if (!isNative() || !enabled) return undefined;

        const buzz = () => { Haptics.impact({ style: ImpactStyle.Light }).catch(() => { }); };

        const onTouchStart = (event) => {
            // Only from a genuine top-of-page rest position, and only for a single finger:
            // starting mid-scroll or mid-pinch would steal the gesture.
            if (window.scrollY > 0 || event.touches.length !== 1 || state.current.refreshing) return;
            state.current.startY = event.touches[0].clientY;
            state.current.armed = false;
        };

        const onTouchMove = (event) => {
            const { startY } = state.current;
            if (startY === null || state.current.refreshing) return;

            const delta = event.touches[0].clientY - startY;

            // An upward move means the user is scrolling the page after all. Yield.
            if (delta <= 0) {
                state.current.startY = null;
                setPull(0);
                return;
            }

            // Resistance: the indicator travels at a third of the finger, which is what makes
            // the gesture feel attached to something rather than free-running.
            const distance = Math.min(delta / 3, MAX_PULL_PX);
            setPull(distance);

            if (distance >= TRIGGER_PX && !state.current.armed) {
                state.current.armed = true;
                buzz();
            } else if (distance < TRIGGER_PX) {
                state.current.armed = false;
            }
        };

        const onTouchEnd = async () => {
            const { startY, armed } = state.current;
            state.current.startY = null;

            if (startY === null || !armed || state.current.refreshing) {
                setPull(0);
                return;
            }

            state.current.refreshing = true;
            setRefreshing(true);
            setPull(TRIGGER_PX);
            try {
                await handler.current?.();
            } finally {
                state.current.refreshing = false;
                state.current.armed = false;
                setRefreshing(false);
                setPull(0);
            }
        };

        const options = { passive: true };
        window.addEventListener('touchstart', onTouchStart, options);
        window.addEventListener('touchmove', onTouchMove, options);
        window.addEventListener('touchend', onTouchEnd, options);
        window.addEventListener('touchcancel', onTouchEnd, options);

        return () => {
            window.removeEventListener('touchstart', onTouchStart);
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', onTouchEnd);
            window.removeEventListener('touchcancel', onTouchEnd);
        };
    }, [enabled]);

    return { pull, refreshing, armed: pull >= TRIGGER_PX };
}
