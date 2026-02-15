import React, { useState, useEffect } from 'react';
import { Plus, X, Trash2, BarChart2, Heart, Activity, Edit2, Info } from 'lucide-react';

const CATEGORIES = [
    { id: 'eros', label: 'Eros', description: 'Romantic, passionate love', color: 'bg-rose-400' },
    { id: 'ludus', label: 'Ludus', description: 'Playful, flirtatious love', color: 'bg-orange-400' },
    { id: 'storge', label: 'Storge', description: 'Unconditional, familial love', color: 'bg-amber-400' },
    { id: 'pragma', label: 'Pragma', description: 'Enduring, logical love', color: 'bg-emerald-400' },
    { id: 'mania', label: 'Mania', description: 'Obsessive, intense love', color: 'bg-violet-400' },
    { id: 'agape', label: 'Agape', description: 'Selfless, universal love', color: 'bg-blue-400' },
    { id: 'selflessness', label: 'Selflessness', description: 'Complete lack of ego', color: 'bg-slate-400' }
];

// Reusable Card Component
const Card = ({ children, className = '' }) => (
    <div className={`bg-white rounded-2xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 ${className}`}>
        {children}
    </div>
);

// The Bar Chart Component
const LoveChart = ({ stats }) => {
    return (
        <div className="space-y-3 mt-4">
            {CATEGORIES.map((cat) => (
                <div key={cat.id} className="group">
                    <div className="flex justify-between items-end mb-1">
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{cat.label}</span>
                        <span className="text-xs font-semibold text-slate-700">{stats[cat.id]}%</span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-1000 ease-out ${cat.color} opacity-80`}
                            style={{ width: `${stats[cat.id]}%` }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
};

// About Modal Component
const AboutModal = ({ onClose }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm transition-all">
        <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
                <div className="flex justify-between items-center mb-6 border-b border-slate-50 pb-4">
                    <div>
                        <h2 className="text-xl font-light text-slate-800">Love Categories</h2>
                        <p className="text-xs text-slate-400 mt-1">Based on the Color Wheel Theory of Love</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-50 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {CATEGORIES.map((cat) => (
                        <div key={cat.id} className="p-4 rounded-xl border border-slate-50 bg-slate-50/50 hover:bg-white hover:shadow-sm transition-all">
                            <div className="flex items-center gap-3 mb-2">
                                <div className={`w-3 h-3 rounded-full ${cat.color}`} />
                                <h3 className="font-medium text-slate-900">{cat.label}</h3>
                            </div>
                            <p className="text-sm text-slate-500 leading-relaxed font-light">{cat.description}</p>
                        </div>
                    ))}
                </div>
            </div>
        </Card>
    </div>
);

// Form to Add/Edit Person
const PersonForm = ({ onClose, onSave, initialData }) => {
    const [name, setName] = useState(initialData?.name || '');
    const [stats, setStats] = useState(
        initialData?.stats || CATEGORIES.reduce((acc, cat) => ({ ...acc, [cat.id]: 0 }), {})
    );

    const handleSliderChange = (id, value) => {
        setStats(prev => ({ ...prev, [id]: parseInt(value) }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({ name, stats });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm transition-all">
            <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
                <form onSubmit={handleSubmit} className="p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-light text-slate-800">
                            {initialData ? 'Edit Analysis' : 'New Subject'}
                        </h2>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-50 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <div className="mb-8">
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                            Identity
                        </label>
                        <input
                            type="text"
                            placeholder="Enter name..."
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full text-lg border-b-2 border-slate-200 py-2 focus:border-slate-800 focus:outline-none bg-transparent transition-colors placeholder:text-slate-300 text-slate-700"
                            autoFocus={!initialData}
                        />
                    </div>

                    <div className="space-y-6">
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            Metrics
                        </label>
                        {CATEGORIES.map((cat) => (
                            <div key={cat.id}>
                                <div className="flex justify-between items-center mb-2">
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium text-slate-700">{cat.label}</span>
                                        <span className="text-[10px] text-slate-400">{cat.description}</span>
                                    </div>
                                    <span className="text-sm font-mono text-slate-500 w-8 text-right">{stats[cat.id]}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={stats[cat.id]}
                                    onChange={(e) => handleSliderChange(cat.id, e.target.value)}
                                    className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-600"
                                />
                            </div>
                        ))}
                    </div>

                    <div className="mt-8 pt-4 border-t border-slate-100 flex justify-end">
                        <button
                            type="submit"
                            disabled={!name.trim()}
                            className="px-6 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-slate-200"
                        >
                            {initialData ? 'Update Analysis' : 'Analyze & Save'}
                        </button>
                    </div>
                </form>
            </Card>
        </div>
    );
};

export default function App() {
    const [people, setPeople] = useState([]);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingPerson, setEditingPerson] = useState(null);
    const [isAboutOpen, setIsAboutOpen] = useState(false);

    // Load from local storage initially (simulated persistence)
    useEffect(() => {
        const saved = localStorage.getItem('alexithymia-love-data');
        if (saved) {
            try {
                setPeople(JSON.parse(saved));
            } catch (e) {
                console.error("Failed to load data");
            }
        }
    }, []);

    useEffect(() => {
        localStorage.setItem('alexithymia-love-data', JSON.stringify(people));
    }, [people]);

    const handleSavePerson = (personData) => {
        if (editingPerson) {
            // Update existing person
            setPeople(people.map(p =>
                p.id === editingPerson.id
                    ? { ...p, ...personData }
                    : p
            ));
        } else {
            // Create new person
            const newPerson = {
                id: Date.now().toString(),
                ...personData,
                createdAt: new Date().toLocaleDateString()
            };
            setPeople([newPerson, ...people]);
        }
        handleCloseForm();
    };

    const handleCloseForm = () => {
        setIsFormOpen(false);
        setEditingPerson(null);
    };

    const startEdit = (person) => {
        setEditingPerson(person);
        setIsFormOpen(true);
    };

    const deletePerson = (id) => {
        setPeople(people.filter(p => p.id !== id));
    };

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-slate-200">
            <div className="max-w-6xl mx-auto px-6 py-12">

                {/* Header */}
                <header className="flex flex-col md:flex-row md:items-end justify-between mb-12 space-y-4 md:space-y-0">
                    <div>
                        <h1 className="text-4xl font-light tracking-tight text-slate-900 mb-2">
                            Love<span className="font-semibold">Metrics</span>
                        </h1>
                        <p className="text-slate-500 font-light max-w-md">
                            Quantifying emotional resonance. An analytical tool for defining the undefinable.
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsAboutOpen(true)}
                            className="flex items-center justify-center p-3 bg-white border border-slate-200 text-slate-500 rounded-xl hover:border-slate-400 hover:text-slate-700 transition-all shadow-sm"
                            title="About Categories"
                        >
                            <Info size={18} />
                        </button>
                        <button
                            onClick={() => setIsFormOpen(true)}
                            className="flex items-center gap-2 px-5 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl hover:border-slate-400 hover:shadow-md transition-all group"
                        >
                            <Plus size={18} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
                            <span className="font-medium">New Analysis</span>
                        </button>
                    </div>
                </header>

                {/* Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {people.length === 0 && (
                        <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-400">
                            <Activity size={48} className="mb-4 opacity-20" />
                            <p className="text-lg font-light">No subjects analyzed yet.</p>
                            <div className="flex gap-4 mt-6">
                                <button
                                    onClick={() => setIsAboutOpen(true)}
                                    className="text-sm font-medium text-slate-500 hover:text-slate-800"
                                >
                                    Read definitions
                                </button>
                                <span className="text-slate-300">|</span>
                                <button
                                    onClick={() => setIsFormOpen(true)}
                                    className="text-sm font-medium text-slate-600 hover:text-slate-900 underline underline-offset-4"
                                >
                                    Begin first analysis
                                </button>
                            </div>
                        </div>
                    )}

                    {people.map((person) => (
                        <Card key={person.id} className="p-6 relative group hover:shadow-lg transition-shadow duration-300">
                            <div className="flex justify-between items-start mb-6">
                                <div>
                                    <h3 className="text-xl font-light text-slate-900">{person.name}</h3>
                                    <span className="text-xs text-slate-400 font-mono">ID: {person.id.slice(-4)}</span>
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => startEdit(person)}
                                        className="p-2 text-slate-300 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                        title="Edit Analysis"
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                    <button
                                        onClick={() => deletePerson(person.id)}
                                        className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                                        title="Delete Record"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>

                            <div className="border-t border-slate-50 pt-4">
                                <LoveChart stats={person.stats} />
                            </div>
                        </Card>
                    ))}
                </div>
            </div>

            {isFormOpen && (
                <PersonForm
                    onClose={handleCloseForm}
                    onSave={handleSavePerson}
                    initialData={editingPerson}
                />
            )}

            {isAboutOpen && (
                <AboutModal onClose={() => setIsAboutOpen(false)} />
            )}
        </div>
    );
}