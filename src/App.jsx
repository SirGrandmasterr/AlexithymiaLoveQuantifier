import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import Navbar from './components/Navbar';
import Landing from './components/Landing';
import Dashboard from './components/Dashboard';
import Auth from './components/Auth';
import Profile from './components/Profile';
import TimelineRoute, { LegacyTimelineRedirect } from './components/TimelineRoute';
import Vault from './components/Vault';
import AppLock from './components/AppLock';
import MobileBottomNav from './components/MobileBottomNav';
import ServerSettingsModal from './components/ServerSettingsModal';
import { SubjectsProvider } from './context/SubjectsContext';
import { DiscretionProvider, useDiscretion } from './context/DiscretionContext';
import { isNative } from './mobile/platform';
// Imported for its side effect as much as its exports: the module sets
// `axios.defaults.baseURL` at evaluation time, which must happen before any component can
// issue a request — the same ordering constraint, and the same reason, as `applyToken`.
import { hasConfiguredServer } from './mobile/serverUrl';
import useNativeShell from './mobile/useNativeShell';

/**
 * The single writer for the auth header and its localStorage copy.
 *
 * This must run **synchronously**, never from an effect. Child effects commit before their
 * parent's, so the subjects fetch fires before an effect in this component could set the
 * header — the first request after logging in would go out anonymous, the server would 401,
 * and the interceptor below would sign the user straight back out.
 */
const applyToken = (token) => {
    if (token) {
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        localStorage.setItem('token', token);
    } else {
        delete axios.defaults.headers.common['Authorization'];
        localStorage.removeItem('token');
    }
};

// Applied at import time so a reload with a stored token is authenticated from the first
// render, before any component mounts.
const initialToken = localStorage.getItem('token');
applyToken(initialToken);

export default function App() {
    const [token, setTokenState] = useState(initialToken);

    // Header, storage and state move together, in that order, on every transition.
    const setToken = useCallback((next) => {
        applyToken(next);
        setTokenState(next);
    }, []);

    // An expired token used to surface as an empty dashboard with no explanation.
    // Clearing it here drops the user back to Landing, which is at least legible.
    useEffect(() => {
        const interceptorId = axios.interceptors.response.use(
            (response) => response,
            (error) => {
                if (error?.response?.status === 401) {
                    setToken(null);
                }
                return Promise.reject(error);
            }
        );
        return () => axios.interceptors.response.eject(interceptorId);
    }, [setToken]);

    const handleLogin = (newToken) => {
        setToken(newToken);
    };

    const handleLogout = () => {
        setToken(null);
    };

    return (
        <BrowserRouter>
            {/* The lock is outermost: when it is engaged nothing behind it renders at all. */}
            <AppLock>
                <DiscretionProvider>
                    {/* One subject list for every screen: the dashboard and the timeline route
                        read the same state, so an edit in one is never stale in the other. */}
                    <SubjectsProvider enabled={!!token}>
                        <Shell token={token} onLogout={handleLogout} onLogin={handleLogin} />
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