import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import Navbar from './components/Navbar';
import Landing from './components/Landing';
import Dashboard from './components/Dashboard';
import Auth from './components/Auth';
import Profile from './components/Profile';
import TimelineRoute, { LegacyTimelineRedirect } from './components/TimelineRoute';
import Journal from './components/Journal';
import JournalPeople, { JournalPerson } from './components/JournalPeople';
import JournalTriggers from './components/JournalTriggers';
import RitualCards from './components/RitualCards';
import Vault from './components/Vault';
import AppLock from './components/AppLock';
import MobileBottomNav from './components/MobileBottomNav';
import ServerSettingsModal from './components/ServerSettingsModal';
import { SubjectsProvider } from './context/SubjectsContext';
import { JournalProvider } from './context/JournalContext';
import { DiscretionProvider, useDiscretion } from './context/DiscretionContext';
import { isNative } from './mobile/platform';
// Imported for its side effect as much as its exports: the module sets
// `axios.defaults.baseURL` at evaluation time, which must happen before any component can
// issue a request — the same ordering constraint, and the same reason, as `applyToken`.
import { hasConfiguredServer } from './mobile/serverUrl';
import useNativeShell from './mobile/useNativeShell';
// The session's storage, renewal and 401 handling. Imported for its side effects as much as
// its exports: reading the stored token applies the auth header at module scope, and the
// module installs both axios interceptors on import. Neither can wait for an effect — child
// effects commit before their parent's, so the dashboard's first fetch would already have
// gone out. See the header comment there.
import {
    readAccessToken,
    applyToken,
    saveSession,
    clearSession,
    endSession,
    subscribeSessionLost
} from './auth/session';
import useSessionRenewal from './auth/useSessionRenewal';

// Applied at import time so a reload with a stored token is authenticated from the first
// render, before any component mounts.
const initialToken = readAccessToken();
applyToken(initialToken);

export default function App() {
    const [token, setTokenState] = useState(initialToken);

    // A 401 no longer means the session is over: the interceptors in `auth/session.js` renew
    // and replay the request. This runs only when renewal has become impossible — the
    // refresh token expired after two months away, or the server revoked it.
    //
    // What it does then is drop the token, and that is the whole behaviour. There is no
    // overlay and no error: every route below already sends a tokenless visitor to Landing
    // or `/login`, so the app lands in exactly the state of someone who never signed in.
    // It used to hold the token and put a prompt on top, which left a signed-out user
    // looking at a signed-in app that answered 401 to everything behind the dialog.
    useEffect(() => subscribeSessionLost(() => {
        clearSession();
        setTokenState(null);
    }), []);

    // Renew on resume, ahead of expiry — the path that means the above is rare.
    useSessionRenewal(Boolean(token));

    const handleLogin = (session) => {
        setTokenState(saveSession(session));
    };

    const handleLogout = () => {
        setTokenState(null);
        // Revokes the refresh token server-side, then forgets it here. Fire and forget:
        // pressing "log out" on a train has still logged the user out.
        endSession();
    };

    return (
        <BrowserRouter>
            {/* The lock is outermost: when it is engaged nothing behind it renders at all. */}
            <AppLock>
                <DiscretionProvider>
                    {/* One subject list for every screen: the dashboard and the timeline route
                        read the same state, so an edit in one is never stale in the other. */}
                    {/* `enabled` is the reload key as well as the switch: a lost session sets
                        the token to null and signing back in sets it again, so the fetch
                        effect re-runs on its own. The explicit `reloadKey` this used to pass
                        existed for re-authenticating *in place*, behind an overlay, and there
                        is no longer such a path. */}
                    <SubjectsProvider enabled={!!token}>
                        {/* Inside the subject list, not beside it: the journal names people
                            and reads them from `useSubjects()` rather than fetching a second
                            copy of the list (invariant 17). */}
                        <JournalProvider enabled={!!token}>
                            <Shell token={token} onLogout={handleLogout} onLogin={handleLogin} />
                        </JournalProvider>
                    </SubjectsProvider>
                </DiscretionProvider>
            </AppLock>
        </BrowserRouter>
    );
}

/**
 * Split out so the navbar can read discretion state — a hook cannot be called in the same
 * component that renders its provider.
 */
function Shell({ token, onLogin, onLogout }) {
    const { discreet, toggle } = useDiscretion();

    // Hardware back button, status bar, soft keyboard. No-ops on web.
    useNativeShell();

    // A packaged app has no origin to infer the API from, so a fresh install opens on this
    // instead of on a screen whose every request is going to fail. It is not dismissible
    // until a server is chosen: there is nothing behind it that would work.
    const [serverModalOpen, setServerModalOpen] = useState(() => isNative() && !hasConfiguredServer());

    return (
        <div className="min-h-screen bg-slate-50 pb-nav">
            <Navbar
                isAuthenticated={!!token}
                onLogout={onLogout}
                discreet={discreet}
                onToggleDiscretion={toggle}
                onOpenServerSettings={isNative() ? () => setServerModalOpen(true) : undefined}
            />
            <Routes>
                <Route
                    path="/"
                    element={token ? <Dashboard /> : <Landing />}
                />
                <Route
                    path="/login"
                    element={!token ? <Auth onLogin={onLogin} /> : <Navigate to="/" />}
                />
                <Route
                    path="/profile"
                    element={token ? <Profile /> : <Navigate to="/login" />}
                />
                <Route
                    path="/vault"
                    element={token ? <Vault /> : <Navigate to="/login" />}
                />
                {/* The journal. `/journal/:day` is last only for reading order — a static
                    segment outranks a dynamic one, so `/journal/ritual` is the ritual and
                    never a day called "ritual". */}
                <Route
                    path="/journal"
                    element={token ? <Journal /> : <Navigate to="/login" />}
                />
                <Route
                    path="/journal/ritual"
                    element={token ? <RitualCards /> : <Navigate to="/login" />}
                />
                <Route
                    path="/journal/people"
                    element={token ? <JournalPeople /> : <Navigate to="/login" />}
                />
                <Route
                    path="/journal/people/:id"
                    element={token ? <JournalPerson /> : <Navigate to="/login" />}
                />
                <Route
                    path="/journal/triggers"
                    element={token ? <JournalTriggers /> : <Navigate to="/login" />}
                />
                <Route
                    path="/journal/:day"
                    element={token ? <Journal /> : <Navigate to="/login" />}
                />
                <Route
                    path="/relationships/:id/timeline"
                    element={token ? <TimelineRoute /> : <Navigate to="/login" />}
                />
                {/* Links made before Phase 4 point at a name; resolve them to an id. */}
                <Route
                    path="/timeline/:name"
                    element={token ? <LegacyTimelineRedirect /> : <Navigate to="/login" />}
                />
            </Routes>

            {/* Signed out there is nowhere to navigate to, so the bar would be three dead
                targets. It appears with the session, as the desktop header's links do. */}
            {token && <MobileBottomNav discreet={discreet} onToggleDiscretion={toggle} />}

            <ServerSettingsModal
                open={serverModalOpen}
                dismissible={hasConfiguredServer()}
                onClose={() => setServerModalOpen(false)}
                // The old token was signed by a different server's `JWT_SECRET`; keeping it
                // would mean a 401 on the first request and a confusing bounce to Landing.
                // Ending the session here makes the cause legible.
                onSaved={() => onLogout()}
            />
        </div>
    );
}