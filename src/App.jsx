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
import JournalSearch from './components/JournalSearch';
import RitualCards from './components/RitualCards';
import Vault from './components/Vault';
import AppLock from './components/AppLock';
import MobileBottomNav from './components/MobileBottomNav';
import ServerSettingsModal from './components/ServerSettingsModal';
import { SubjectsProvider } from './context/SubjectsContext';
import { JournalProvider } from './context/JournalContext';
import { DiscretionProvider, useDiscretion } from './context/DiscretionContext';
import { EmbeddingProvider } from './journal/embeddings/EmbeddingContext';
import { isNative } from './mobile/platform';
import { hasConfiguredServer } from './mobile/serverUrl';
import useNativeShell from './mobile/useNativeShell';
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
                    <SubjectsProvider enabled={!!token}>
                        <JournalProvider enabled={!!token}>
                            <EmbeddingProvider>
                                <Shell token={token} onLogout={handleLogout} onLogin={handleLogin} />
                            </EmbeddingProvider>
                        </JournalProvider>
                    </SubjectsProvider>
                </DiscretionProvider>
            </AppLock>
        </BrowserRouter>
    );
}

function Shell({ token, onLogin, onLogout }) {
    const { discreet, toggle } = useDiscretion();

    // Hardware back button, status bar, soft keyboard. No-ops on web.
    useNativeShell();

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
                    path="/journal/search"
                    element={token ? <JournalSearch /> : <Navigate to="/login" />}
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

            {token && <MobileBottomNav discreet={discreet} onToggleDiscretion={toggle} />}

            <ServerSettingsModal
                open={serverModalOpen}
                dismissible={hasConfiguredServer()}
                onClose={() => setServerModalOpen(false)}
                onSaved={() => onLogout()}
            />
        </div>
    );
}
