import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import Navbar from './components/Navbar';
import Landing from './components/Landing';
import Dashboard from './components/Dashboard';
import Auth from './components/Auth';
import Profile from './components/Profile';

// Initialize axios default headers immediately to prevent race conditions on first render
const initialToken = localStorage.getItem('token');
if (initialToken) {
    axios.defaults.headers.common['Authorization'] = `Bearer ${initialToken}`;
}

export default function App() {
    const [token, setToken] = useState(initialToken);

    useEffect(() => {
        if (token) {
            axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
            localStorage.setItem('token', token);
        } else {
            delete axios.defaults.headers.common['Authorization'];
            localStorage.removeItem('token');
        }
    }, [token]);

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
    }, []);

    const handleLogin = (newToken) => {
        setToken(newToken);
    };

    const handleLogout = () => {
        setToken(null);
    };

    return (
        <BrowserRouter>
            <div className="min-h-screen bg-slate-50">
                <Navbar isAuthenticated={!!token} onLogout={handleLogout} />
                <Routes>
                    <Route
                        path="/"
                        element={token ? <Dashboard /> : <Landing />}
                    />
                    <Route
                        path="/login"
                        element={!token ? <Auth onLogin={handleLogin} /> : <Navigate to="/" />}
                    />
                    <Route
                        path="/profile"
                        element={token ? <Profile /> : <Navigate to="/login" />}
                    />
                </Routes>
            </div>
        </BrowserRouter>
    );
}