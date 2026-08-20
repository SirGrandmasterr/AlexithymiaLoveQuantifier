import React, { useState } from 'react';
import axios from 'axios';
import { Server, X, Check, Loader2, AlertTriangle } from 'lucide-react';
import {
    getServerUrl,
    setServerUrl,
    normalizeServerUrl,
    validateServerUrl
} from '../mobile/serverUrl';

/**
 * Where is your server?
 *
 * A question the web app never has to ask — it is served *by* the thing it talks to. A
 * packaged APK is not, and this is self-hosted software, so there is no address to bake in.
 * This is the first screen a fresh install shows.
 *
 * The presets are the three addresses that actually come up, in the order they come up:
 * an emulator talking to the host, a phone talking to a box on the LAN, and a real
 * deployment behind a name.
 */

const PRESETS = [
    {
        label: 'Android emulator',
        url: 'http://10.0.2.2:8080',
        hint: '10.0.2.2 is the emulator’s alias for your computer. Use :8082 if the backend is under Docker Compose — the direct backend port is not reachable from the emulator.'
    },
    {
        label: 'Phone on the same Wi-Fi',
        url: 'http://192.168.1.10:8082',
        hint: 'Replace with your computer’s LAN address — ipconfig on Windows, ip addr on Linux. Port 8082 under Docker Compose, 8080 for a bare `go run`.'
    }
];

export default function ServerSettingsModal({ open, onClose, onSaved, dismissible = true }) {
    const [value, setValue] = useState(() => getServerUrl());
    const [probe, setProbe] = useState(null);
    const [busy, setBusy] = useState(false);

    if (!open) return null;

    const validationError = validateServerUrl(value);

    /**
     * Reachability check against an endpoint that exists and needs no token.
     *
     * `POST /api/login` with an empty body answers `400` from a live server. That is the
     * point: any structured HTTP reply proves the address resolves, the port is open, and a
     * Gin router is behind it. Only a transport failure means "wrong address" — a `4xx` here
     * is a *success*, which reads oddly and is exactly right.
     */
    const testConnection = async () => {
        const target = normalizeServerUrl(value);
        setBusy(true);
        setProbe(null);
        try {
            await axios.post(`${target}/api/login`, {}, { timeout: 6000 });
            setProbe({ ok: true, text: 'Server responded.' });
        } catch (error) {
            if (error.response) {
                setProbe({ ok: true, text: `Server responded (HTTP ${error.response.status}).` });
            } else {
                setProbe({
                    ok: false,
                    text: 'No response. Check the address, that the server is running, and that both devices are on the same network.'
                });
            }
        } finally {
            setBusy(false);
        }
    };

    const save = () => {
        if (validationError) return;
        const saved = setServerUrl(value);
        onSaved?.(saved);
        onClose?.();
    };

    return (
        <div className="fixed inset-0 z-[90] bg-slate-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-6">
            <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl border border-slate-100 max-h-[90vh] overflow-y-auto pb-safe">
                <div className="flex items-center justify-between p-6 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-slate-100 rounded-full">
                            <Server size={18} className="text-slate-600" />
                        </div>
                        <h2 className="text-lg font-light text-slate-900">Server address</h2>
                    </div>
                    {dismissible && (
                        <button
                            onClick={onClose}
                            aria-label="Close"
                            className="p-3 -m-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                            <X size={18} />
                        </button>
                    )}
                </div>

                <div className="px-6 pb-6 space-y-5">
                    <p className="text-sm text-slate-500 font-light leading-relaxed">
                        This app talks to your own server. Enter the address it is reachable at from
                        this device.
                    </p>

                    <div>
                        <label htmlFor="alq-server-url" className="block text-sm font-medium text-slate-700 mb-2">
                            Address
                        </label>
                        <input
                            id="alq-server-url"
                            value={value}
                            onChange={(event) => { setValue(event.target.value); setProbe(null); }}
                            // A URL field with autocorrect on will capitalise the scheme and
                            // "helpfully" rewrite the host. All three are off for that reason.
                            type="url"
                            inputMode="url"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck="false"
                            enterKeyHint="done"
                            placeholder="http://10.0.2.2:8080"
                            className="w-full px-4 py-3 min-h-[48px] bg-white border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-300 focus:border-slate-400 focus:outline-none"
                        />
                        {validationError && value.trim() !== '' && (
                            <p className="mt-2 text-xs text-amber-600 font-light">{validationError}</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        {PRESETS.map((preset) => (
                            <button
                                key={preset.url}
                                type="button"
                                onClick={() => { setValue(preset.url); setProbe(null); }}
                                className="w-full text-left p-3 min-h-[48px] rounded-xl border border-slate-200 hover:border-slate-400 transition-colors"
                            >
                                <span className="block text-sm font-medium text-slate-700">{preset.label}</span>
                                <span className="block text-xs text-slate-400 font-mono mt-0.5">{preset.url}</span>
                                <span className="block text-[11px] text-slate-400 font-light mt-1 leading-relaxed">
                                    {preset.hint}
                                </span>
                            </button>
                        ))}
                    </div>

                    {probe && (
                        <div
                            role="status"
                            className={`flex items-start gap-2 p-3 rounded-lg text-sm ${probe.ok
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                                }`}
                        >
                            {probe.ok
                                ? <Check size={16} className="flex-shrink-0 mt-0.5" />
                                : <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />}
                            <span className="font-light leading-relaxed">{probe.text}</span>
                        </div>
                    )}

                    <div className="flex gap-3 pt-1">
                        <button
                            type="button"
                            onClick={testConnection}
                            disabled={Boolean(validationError) || busy}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 min-h-[48px] border border-slate-200 text-slate-700 rounded-xl font-medium hover:border-slate-400 transition-colors disabled:opacity-40"
                        >
                            {busy && <Loader2 size={16} className="animate-spin" />}
                            Test
                        </button>
                        <button
                            type="button"
                            onClick={save}
                            disabled={Boolean(validationError)}
                            className="flex-1 px-4 py-3 min-h-[48px] bg-slate-800 text-white rounded-xl font-medium hover:bg-slate-900 transition-colors disabled:opacity-40"
                        >
                            Save
                        </button>
                    </div>

                    <p className="text-[11px] text-slate-400 font-light leading-relaxed">
                        Changing this signs you out on this device: your token was issued by the old
                        server and means nothing to the new one.
                    </p>
                </div>
            </div>
        </div>
    );
}
