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
import { SubjectsProvider } from './context/SubjectsContext';
import { DiscretionProvider, useDiscretion } from './context/DiscretionContext';

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

    return (
        <div className="min-h-screen bg-slate-50">
            <Navbar
                isAuthenticated={!!token}
                onLogout={onLogout}
                discreet={discreet}
                onToggleDiscretion={toggle}
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
        </div>
    );
}