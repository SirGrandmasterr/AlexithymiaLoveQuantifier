import React, { useState, useEffect, useRef } from 'react';
import { User, Mail, Shield, Save, Upload, Loader2, Info, Bell, NotebookPen } from 'lucide-react';
import axios from 'axios';
import { resolveAssetUrl } from '../mobile/serverUrl';
import { remindersAvailable, remindersEnabled, setRemindersEnabled } from '../mobile/cadenceReminders';
import {
    DEFAULT_RITUAL_TIME,
    JOURNAL_COPY,
    MAX_OPTIONAL_QUESTIONS,
    fillCopy,
    optionalQuestions
} from '../constants/journal';
import {
    readAskWho,
    readOptionalQuestions,
    readRitualSetting,
    writeAskWho,
    writeOptionalQuestions,
    writeRitualSetting
} from '../constants/journalSettings';

// This screen used to call through its own `axios.create()` instance, which carried the
// token but not App.jsx's response interceptor — interceptors on the global default do not
// apply to instances. A dead session therefore ended here as a permanent "Failed to load
// profile data." banner instead of a logout, because nothing was watching for the 401.
// The global default already carries the Authorization header (App.jsx sets it
// synchronously at import time and on every token transition), so using it directly loses
// nothing and gains the 401 handling. See docs/10-agent-guide.md Recipe 6.

/**
 * The journal's per-device settings (§9.7), beside *Check-in reminders* and in the same
 * shape, because they are the same kind of thing: a preference this device holds and nothing
 * else ever sees.
 *
 * **Three of the eight, deliberately.** Voice, suggestions, embeddings, transcripts and
 * language are described in `JOURNAL_COPY.settings` and are *not* rendered here — those
 * features arrive in 6-C, 6-D and 6-G, and a toggle for something the app cannot do would
 * make the Vault's claims false (invariant 2e). A description is not permission to render a
 * control.
 *
 * Unlike the reminders block above it there is no `available()` gate: the ritual is a screen,
 * not a notification, so it works everywhere. What is native-only is the *reminder* for it,
 * and that is F2's.
 */
const JournalSettings = () => {
    const [ritual, setRitual] = useState(readRitualSetting);
    const [questions, setQuestions] = useState(readOptionalQuestions);
    const [askWho, setAskWho] = useState(readAskWho);

    // Written on change rather than on a Save button, like the reminders toggle: these are
    // device preferences, not profile fields, and the form's Save posts to the server.
    const saveRitual = (next) => {
        setRitual(next);
        writeRitualSetting(next);
    };

    // Read through a ref rather than through the render's copy. Two chips toggled inside one
    // task — which a thumb cannot do and a script can — would otherwise both compute their
    // "next" from the same stale list and the first one would be lost. The ref costs three
    // lines and removes the whole class; the write stays here rather than in an effect,
    // because an effect firing on mount would write the key before the user touched it.
    const questionsRef = useRef(questions);

    const toggleQuestion = (id) => {
        const current = questionsRef.current;
        const next = current.includes(id)
            ? current.filter(other => other !== id)
            : [...current, id];

        questionsRef.current = next;
        setQuestions(next);
        writeOptionalQuestions(next);
    };

    const toggleAskWho = () => {
        const next = !askWho;
        setAskWho(next);
        writeAskWho(next);
    };

    const atLimit = questions.length >= MAX_OPTIONAL_QUESTIONS;

    return (
        <div className="pt-8 border-t border-slate-50" data-journal-settings>
            <div className="flex items-center gap-2 text-slate-800 font-medium mb-1">
                <NotebookPen size={18} />
                <h3>{JOURNAL_COPY.settings.heading}</h3>
            </div>
            <p className="text-xs text-slate-400 font-light mb-4">{JOURNAL_COPY.settings.subheading}</p>

            <button
                type="button"
                data-setting="ritual"
                onClick={() => saveRitual({ ...ritual, on: !ritual.on })}
                aria-pressed={ritual.on}
                className={`w-full sm:w-auto flex items-center justify-between gap-4 px-5 py-3 min-h-[48px] border rounded-xl font-medium transition-all text-sm ${ritual.on
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
            >
                <span>{JOURNAL_COPY.settings.ritual.label}</span>
                <span className={`text-xs ${ritual.on ? 'text-slate-300' : 'text-slate-400'}`}>
                    {ritual.on ? ritual.time : JOURNAL_COPY.settings.off}
                </span>
            </button>

            {ritual.on && (
                <label className="mt-3 flex items-center gap-3 text-sm text-slate-600">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        {JOURNAL_COPY.settings.ritual.time}
                    </span>
                    <input
                        type="time"
                        data-setting="ritual-time"
                        value={ritual.time}
                        onChange={(event) => saveRitual({ ...ritual, time: event.target.value })}
                        className="p-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                </label>
            )}

            <p className="mt-3 text-xs text-slate-400 font-light leading-relaxed max-w-md">
                {fillCopy(JOURNAL_COPY.settings.ritual.description, { time: DEFAULT_RITUAL_TIME })}
            </p>

            <div className="mt-6">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    {JOURNAL_COPY.settings.questions.label}
                </h4>
                <p className="text-xs text-slate-400 font-light leading-relaxed max-w-md mb-3">
                    {fillCopy(JOURNAL_COPY.settings.questions.description, { max: MAX_OPTIONAL_QUESTIONS })}
                </p>

                <div className="space-y-2 max-w-md">
                    {optionalQuestions().map(question => {
                        const chosen = questions.includes(question.id);
                        return (
                            <button
                                key={question.id}
                                type="button"
                                data-question={question.id}
                                aria-pressed={chosen}
                                // Stated, then enforced: the cap sentence is on screen before
                                // the ninth card is reachable, so nothing is refused silently.
                                disabled={!chosen && atLimit}
                                onClick={() => toggleQuestion(question.id)}
                                className={`w-full text-left px-4 py-3 min-h-[48px] border rounded-xl transition-all ${chosen
                                    ? 'bg-slate-800 text-white border-slate-800'
                                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 disabled:opacity-40 disabled:hover:border-slate-200'
                                    }`}
                            >
                                <span className="text-sm font-medium">{question.text}</span>
                                <span className={`block mt-1 text-xs font-light leading-relaxed ${chosen ? 'text-slate-300' : 'text-slate-400'}`}>
                                    {question.note}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {atLimit && (
                    <p className="mt-3 text-xs text-slate-400 font-light">
                        {fillCopy(JOURNAL_COPY.settings.questions.atLimit, { max: MAX_OPTIONAL_QUESTIONS })}
                    </p>
                )}
            </div>

            <div className="mt-6">
                <button
                    type="button"
                    data-setting="ask-who"
                    onClick={toggleAskWho}
                    aria-pressed={askWho}
                    className={`w-full sm:w-auto flex items-center justify-between gap-4 px-5 py-3 min-h-[48px] border rounded-xl font-medium transition-all text-sm ${askWho
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                >
                    <span>{JOURNAL_COPY.settings.askWho.label}</span>
                    <span className={`text-xs ${askWho ? 'text-slate-300' : 'text-slate-400'}`}>
                        {askWho ? JOURNAL_COPY.settings.on : JOURNAL_COPY.settings.off}
                    </span>
                </button>
                <p className="mt-3 text-xs text-slate-400 font-light leading-relaxed max-w-md">
                    {JOURNAL_COPY.settings.askWho.description}
                </p>
            </div>
        </div>
    );
};

export default function Profile() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    const fileInputRef = useRef(null);

    const [formData, setFormData] = useState({
        name: '',
        age: '',
        mbti_type: '',
        profile_picture: '',
        email: ''
    });

    const [reminders, setReminders] = useState(remindersEnabled);
    const [reminderError, setReminderError] = useState(null);

    useEffect(() => {
        fetchProfile();
    }, []);

    /**
     * The OS is the authority on whether reminders are on, not this component: the user can
     * revoke POST_NOTIFICATIONS in Settings at any time. `setRemindersEnabled` returns the
     * state that actually holds afterwards, and that is what is rendered — so a denied prompt
     * leaves the control off rather than showing a toggle that lies.
     */
    const toggleReminders = async () => {
        setReminderError(null);
        const next = await setRemindersEnabled(!reminders);
        setReminders(next);

        if (!reminders && !next) {
            setReminderError(
                'Android did not grant notification permission. You can enable it for this app in Settings › Notifications.'
            );
        }
    };

    const fetchProfile = async () => {
        try {
            const res = await axios.get('/api/me');
            setFormData({
                name: res.data.name || '',
                age: res.data.age || '',
                mbti_type: res.data.mbti_type || '',
                profile_picture: res.data.profile_picture || '',
                email: res.data.email || ''
            });
        } catch (error) {
            console.error('Failed to fetch profile', error);
            setMessage({ type: 'error', text: 'Failed to load profile data.' });
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: name === 'age' ? parseInt(value) || '' : value }));
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage({ type: '', text: '' });
        try {
            await axios.put('/api/me', formData);
            setMessage({ type: 'success', text: 'Profile updated successfully!' });
        } catch (error) {
            console.error('Failed to update profile', error);
            setMessage({ type: 'error', text: 'Failed to update profile.' });
        } finally {
            setSaving(false);
        }
    };

    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploading(true);
        const uploadData = new FormData();
        uploadData.append('image', file);

        try {
            const res = await axios.post('/api/upload', uploadData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            // Update the profile picture URL in form data
            const fullUrl = res.data.url;
            setFormData(prev => ({ ...prev, profile_picture: fullUrl }));
            setMessage({ type: 'success', text: 'Image uploaded successfully. Remember to save changes.' });
        } catch (error) {
            console.error('Upload failed', error);
            setMessage({ type: 'error', text: 'Image upload failed.' });
        } finally {
            setUploading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-full min-h-[500px]">
                <Loader2 className="animate-spin text-slate-400" size={32} />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-6 py-12">
            <h1 className="text-3xl font-light text-slate-900 mb-8">Account Settings</h1>

            {message.text && (
                <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                    <Info size={18} />
                    <span>{message.text}</span>
                </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-8 border-b border-slate-50 relative">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-6">
                        <div className="relative group">
                            <div className="w-24 h-24 rounded-full overflow-hidden bg-slate-100 border-4 border-white shadow-md flex items-center justify-center">
                                {formData.profile_picture ? (
                                    // Stored server-relative (`/uploads/profile_<nanos>.jpg`).
                                    // In a browser that resolves against the page origin and is
                                    // correct; in the WebView it would resolve against
                                    // `https://localhost` and 404, so it is rebased onto the
                                    // configured server. Returns the path untouched on web.
                                    <img src={resolveAssetUrl(formData.profile_picture)} alt="Profile" className="w-full h-full object-cover" />
                                ) : (
                                    <User size={40} className="text-slate-400" />
                                )}
                            </div>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                className="absolute bottom-0 right-0 p-2 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                                title="Upload new picture"
                            >
                                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                            </button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleImageUpload}
                            />
                        </div>
                        <div className="flex-1">
                            <h2 className="text-xl font-medium text-slate-900">{formData.name || 'Set your name'}</h2>
                            <p className="text-slate-500">Manage your profile and personal information</p>
                        </div>
                        <div className="flex-shrink-0 mt-4 sm:mt-0">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-70"
                            >
                                {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>

                <div className="p-8 space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Name Field */}
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                                Full Name
                            </label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                placeholder="e.g. Jane Doe"
                                className="w-full p-3 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                            />
                        </div>

                        {/* Email Field */}
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                                Email Address
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Mail size={18} className="text-slate-400" />
                                </div>
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    className="w-full pl-10 p-3 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                                />
                            </div>
                        </div>

                        {/* Age Field */}
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                                Age
                            </label>
                            <input
                                type="number"
                                name="age"
                                value={formData.age}
                                onChange={handleChange}
                                placeholder="e.g. 25"
                                className="w-full p-3 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                            />
                        </div>

                        {/* MBTI Type Field */}
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                                MBTI Type
                            </label>
                            <select
                                name="mbti_type"
                                value={formData.mbti_type}
                                onChange={handleChange}
                                className="w-full p-3 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors appearance-none"
                            >
                                <option value="">Select a type...</option>
                                <option value="INTJ">INTJ</option>
                                <option value="INTP">INTP</option>
                                <option value="ENTJ">ENTJ</option>
                                <option value="ENTP">ENTP</option>
                                <option value="INFJ">INFJ</option>
                                <option value="INFP">INFP</option>
                                <option value="ENFJ">ENFJ</option>
                                <option value="ENFP">ENFP</option>
                                <option value="ISTJ">ISTJ</option>
                                <option value="ISFJ">ISFJ</option>
                                <option value="ESTJ">ESTJ</option>
                                <option value="ESFJ">ESFJ</option>
                                <option value="ISTP">ISTP</option>
                                <option value="ISFP">ISFP</option>
                                <option value="ESTP">ESTP</option>
                                <option value="ESFP">ESFP</option>
                            </select>
                        </div>
                    </div>

                    {/* Native only: there is no equivalent on the web, where the in-app
                        nudge already appears whenever the dashboard is open. */}
                    {remindersAvailable() && (
                        <div className="pt-8 border-t border-slate-50">
                            <div className="flex items-center gap-2 text-slate-800 font-medium mb-4">
                                <Bell size={18} />
                                <h3>Check-in reminders</h3>
                            </div>
                            <button
                                type="button"
                                onClick={toggleReminders}
                                aria-pressed={reminders}
                                className={`w-full sm:w-auto flex items-center justify-between gap-4 px-5 py-3 min-h-[48px] border rounded-xl font-medium transition-all text-sm ${reminders
                                    ? 'bg-slate-800 text-white border-slate-800'
                                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                                    }`}
                            >
                                <span>{reminders ? 'Reminders are on' : 'Turn on reminders'}</span>
                                <span className={`text-xs ${reminders ? 'text-slate-300' : 'text-slate-400'}`}>
                                    {reminders ? '10:00' : 'off'}
                                </span>
                            </button>
                            <p className="mt-3 text-xs text-slate-400 font-light leading-relaxed max-w-md">
                                One notification at 10:00 for each relationship whose rhythm has come
                                round, carrying the same sentence the app shows — no counts, no
                                streaks, nothing to clear. Scheduled on this device from snapshots
                                you already have; nothing is sent to the server.
                            </p>
                            {reminderError && (
                                <p role="alert" className="mt-3 text-xs text-amber-600 font-light max-w-md">
                                    {reminderError}
                                </p>
                            )}
                        </div>
                    )}

                    <JournalSettings />

                    <div className="pt-8 border-t border-slate-50">
                        <div className="flex items-center gap-2 text-slate-800 font-medium mb-4">
                            <Shield size={18} />
                            <h3>Security</h3>
                        </div>
                        <button className="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 hover:border-slate-300 hover:text-slate-800 transition-all text-sm">
                            Change Password
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
