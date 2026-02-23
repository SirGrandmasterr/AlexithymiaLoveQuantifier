import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { Plus, X, Trash2, Edit2, Info, Activity, Layers, Calendar } from 'lucide-react';

const CATEGORIES = [
    { id: 'eros', label: 'Eros', description: 'Romantic, passionate love', color: 'bg-rose-400' },
    { id: 'ludus', label: 'Ludus', description: 'Playful, flirtatious love', color: 'bg-orange-400' },
    { id: 'storge', label: 'Storge', description: 'Unconditional, familial love', color: 'bg-amber-400' },
    { id: 'pragma', label: 'Pragma', description: 'Enduring, logical love', color: 'bg-emerald-400' },
    { id: 'mania', label: 'Mania', description: 'Obsessive, intense love', color: 'bg-violet-400' },
    { id: 'agape', label: 'Agape', description: 'Selfless, universal love', color: 'bg-blue-400' },
    { id: 'selflessness', label: 'Selflessness', description: 'Complete lack of ego', color: 'bg-slate-400' }
];

const Card = ({ children, className = '', style = {} }) => (
    <div className={`bg-white rounded-2xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 ${className}`} style={style}>
        {children}
    </div>
);

const LoveChart = ({ stats }) => {
    if (!stats) return null;
    return (
        <div className="space-y-3 mt-4">
            {CATEGORIES.map((cat) => (
                <div key={cat.id} className="group">
                    <div className="flex justify-between items-end mb-1">
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{cat.label}</span>
                        <span className="text-xs font-semibold text-slate-700">{stats[cat.id] || 0}%</span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-1000 ease-out ${cat.color} opacity-80`}
                            style={{ width: `${stats[cat.id] || 0}%` }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
};

const CardStack = ({ versions, onEdit, onDelete, onAddVersion }) => {
    // Sort versions by date DESC (newest first)
    const sortedVersions = useMemo(() => {
        return [...versions].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    }, [versions]);

    const [activeIndex, setActiveIndex] = useState(0);
    const containerRef = useRef(null);

    // Reset active index when versions change (e.g. new version added)
    useEffect(() => {
        setActiveIndex(0);
    }, [versions.length]);

    // Handle scroll with non-passive listener to prevent page scroll
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (e) => {
            // Prevent page scroll
            e.preventDefault();
            e.stopPropagation();

            if (e.deltaY > 0) {
                // Scroll Down -> Reveal older version (increment index)
                setActiveIndex(prev => {
                    if (prev < sortedVersions.length - 1) return prev + 1;
                    return prev;
                });
            } else {
                // Scroll Up -> Return to newer version (decrement index)
                setActiveIndex(prev => {
                    if (prev > 0) return prev - 1;
                    return prev;
                });
            }
        };

        // { passive: false } is crucial for preventDefault to work
        container.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            container.removeEventListener('wheel', handleWheel);
        };
    }, [sortedVersions.length]);

    return (
        <div
            ref={containerRef}
            className="relative h-[500px]"
        >
            {sortedVersions.map((person, index) => {
                const offset = index - activeIndex;

                // Determine style based on position relative to active card
                let style = {};
                let extraClasses = "";

                if (offset < 0) {
                    // Cards that have been "scrolled past" (newer versions being discarded)
                    // "moves it downwards where it fades away" & "rotates ... to the left"
                    style = {
                        transform: 'translateY(120%) rotate(-15deg)',
                        opacity: 0,
                        zIndex: 60, // Start high then drop or disappear
                        pointerEvents: 'none'
                    };
                } else if (offset === 0) {
                    // Active Card
                    style = {
                        transform: 'translateY(0) rotate(0deg) scale(1)',
                        opacity: 1,
                        zIndex: 50
                    };
                    extraClasses = "group hover:shadow-xl";
                } else {
                    // Cards in the stack (older versions)
                    // Visual stack effect: adjust scale and y-offset
                    if (offset > 2) {
                        style = { opacity: 0, pointerEvents: 'none', zIndex: 0 };
                    } else {
                        style = {
                            transform: `translateY(${offset * 12}px) scale(${1 - offset * 0.04})`,
                            opacity: 1 - (offset * 0.1), // Fade out slightly
                            zIndex: 50 - offset
                        };
                    }
                }

                return (
                    <Card
                        key={person.ID}
                        className={`absolute top-0 left-0 w-full h-full transition-all duration-700 ease-in-out origin-bottom-left flex flex-col justify-between p-6 ${extraClasses}`}
                        style={style}
                    >
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-xl font-light text-slate-900">{person.name}</h3>
                                <div className="flex items-center gap-2 mt-1">
                                    <Calendar size={12} className="text-slate-400" />
                                    <span className="text-xs text-slate-500 font-mono">
                                        {person.date ? new Date(person.date).toLocaleDateString() : 'No Date'}
                                    </span>
                                    {sortedVersions.length > 1 && (
                                        <span className="text-xs text-slate-300 ml-2 bg-slate-100 px-2 py-0.5 rounded-full">
                                            v{sortedVersions.length - index}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Actions only visible if it's the active card */}
                            {offset === 0 && (
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 bg-white/80 backdrop-blur-sm rounded-lg">
                                    <button onClick={() => onAddVersion(person)} className="p-2 text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Add New Version">
                                        <Plus size={16} />
                                    </button>
                                    <button onClick={() => onEdit(person)} className="p-2 text-slate-300 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors" title="Edit">
                                        <Edit2 size={16} />
                                    </button>
                                    <button onClick={() => onDelete(person.ID)} className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors" title="Delete">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="border-t border-slate-50 pt-4 flex-grow">
                            <LoveChart stats={person.stats} />
                        </div>

                        <div className="absolute inset-x-0 bottom-4 px-6 text-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                            {sortedVersions.length > 1 && (
                                <p className="text-[10px] text-slate-400 uppercase tracking-widest">
                                    {activeIndex < sortedVersions.length - 1 ? "Scroll ↓ for history" : "End of history"}
                                </p>
                            )}
                        </div>
                    </Card>
                );
            })}
        </div>
    );
};


const AboutModal = ({ onClose }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm transition-all">
        <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
                <div className="flex justify-between items-center mb-6 border-b border-slate-50 pb-4">
                    <div>
                        <h2 className="text-xl font-light text-slate-800">Love Categories</h2>
                        <p className="text-xs text-slate-400 mt-1">Based on the Color Wheel Theory of Love</p>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-50 transition-colors">
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

const PersonForm = ({ onClose, onSave, initialData, isNewVersion }) => {
    const [name, setName] = useState(initialData?.name || '');

    // If it's a new version, default to today. If editing existing, use its date.
    // If creating brand new subject, use today.
    const [date, setDate] = useState(() => {
        if (isNewVersion || !initialData) {
            return new Date().toISOString().split('T')[0];
        }
        return initialData.date ? new Date(initialData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    });

    const [stats, setStats] = useState(
        initialData?.stats || CATEGORIES.reduce((acc, cat) => ({ ...acc, [cat.id]: 0 }), {})
    );

    const handleSliderChange = (id, value) => {
        setStats(prev => ({ ...prev, [id]: parseInt(value) }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({ name, date, stats });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm transition-all">
            <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
                <form onSubmit={handleSubmit} className="p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-light text-slate-800">
                            {initialData && !isNewVersion ? 'Edit Analysis' : isNewVersion ? 'New Version' : 'New Subject'}
                        </h2>
                        <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-50 transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-8">
                        <div>
                            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Identity</label>
                            <input
                                type="text"
                                placeholder="Enter name..."
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className={`w-full text-lg border-b-2 border-slate-200 py-2 focus:border-slate-800 focus:outline-none bg-transparent transition-colors placeholder:text-slate-300 text-slate-700 ${isNewVersion ? 'opacity-50 cursor-not-allowed' : ''}`}
                                autoFocus={!initialData}
                                disabled={isNewVersion}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Date of State</label>
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="w-full text-lg border-b-2 border-slate-200 py-2 focus:border-slate-800 focus:outline-none bg-transparent transition-colors text-slate-700"
                            />
                        </div>
                    </div>

                    <div className="space-y-6">
                        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Metrics</label>
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
                            {initialData && !isNewVersion ? 'Update Analysis' : 'Analyze & Save'}
                        </button>
                    </div>
                </form>
            </Card>
        </div>
    );
};

export default function Dashboard() {
    const [people, setPeople] = useState([]);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingPerson, setEditingPerson] = useState(null);
    const [isNewVersionMode, setIsNewVersionMode] = useState(false);
    const [isAboutOpen, setIsAboutOpen] = useState(false);

    useEffect(() => {
        fetchSubjects();
    }, []);

    const fetchSubjects = async () => {
        try {
            const response = await axios.get('/api/subjects');
            setPeople(response.data);
        } catch (error) {
            console.error("Failed to fetch subjects", error);
        }
    };

    // Group people by name for the stacks
    const groupedPeople = useMemo(() => {
        const groups = {};
        people.forEach(person => {
            if (!groups[person.name]) {
                groups[person.name] = [];
            }
            groups[person.name].push(person);
        });
        return Object.values(groups);
    }, [people]);

    const handleSavePerson = async (personData) => {
        try {
            if (editingPerson && !isNewVersionMode) {
                // Update existing
                const response = await axios.put(`/api/subjects/${editingPerson.ID}`, personData);
                setPeople(people.map(p => p.ID === editingPerson.ID ? response.data : p));
            } else {
                // Create new (or new version)
                const response = await axios.post('/api/subjects', personData);
                setPeople([...people, response.data]);
            }
            handleCloseForm();
        } catch (error) {
            console.error("Failed to save subject", error);
        }
    };

    const deletePerson = async (id) => {
        if (!window.confirm("Are you sure you want to delete this specific version?")) return;
        try {
            await axios.delete(`/api/subjects/${id}`);
            setPeople(people.filter(p => p.ID !== id));
        } catch (error) {
            console.error("Failed to delete subject", error);
        }
    };

    const handleCloseForm = () => {
        setIsFormOpen(false);
        setEditingPerson(null);
        setIsNewVersionMode(false);
    };

    const startEdit = (person) => {
        setEditingPerson(person);
        setIsNewVersionMode(false);
        setIsFormOpen(true);
    };

    const startNewVersion = (person) => {
        setEditingPerson(person); // Pass current data as template
        setIsNewVersionMode(true);
        setIsFormOpen(true);
    };

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-slate-200">
            <div className="max-w-6xl mx-auto px-6 py-12">
                <header className="flex flex-col md:flex-row md:items-end justify-between mb-12 space-y-4 md:space-y-0">
                    <div>
                        <h1 className="text-4xl font-light tracking-tight text-slate-900 mb-2">
                            My <span className="font-semibold">Analysis</span>
                        </h1>
                        <p className="text-slate-500 font-light max-w-md">
                            Overview of your emotional metrics.
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => setIsAboutOpen(true)} className="flex items-center justify-center p-3 bg-white border border-slate-200 text-slate-500 rounded-xl hover:border-slate-400 hover:text-slate-700 transition-all shadow-sm">
                            <Info size={18} />
                        </button>
                        <button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2 px-5 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl hover:border-slate-400 hover:shadow-md transition-all group">
                            <Plus size={18} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
                            <span className="font-medium">New Analysis</span>
                        </button>
                    </div>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {people.length === 0 && (
                        <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-400">
                            <Activity size={48} className="mb-4 opacity-20" />
                            <p className="text-lg font-light">No subjects analyzed yet.</p>
                            <div className="flex gap-4 mt-6">
                                <button onClick={() => setIsFormOpen(true)} className="text-sm font-medium text-slate-600 hover:text-slate-900 underline underline-offset-4">
                                    Begin first analysis
                                </button>
                            </div>
                        </div>
                    )}

                    {groupedPeople.map((versions) => (
                        <div key={versions[0].name}> {/* Key by name since it's the stable identifier for the stack */}
                            <CardStack
                                versions={versions}
                                onEdit={startEdit}
                                onDelete={deletePerson}
                                onAddVersion={startNewVersion}
                            />
                        </div>
                    ))}
                </div>
            </div >

            {isFormOpen && (
                <PersonForm
                    onClose={handleCloseForm}
                    onSave={handleSavePerson}
                    initialData={editingPerson}
                    isNewVersion={isNewVersionMode}
                />
            )
            }

            {
                isAboutOpen && (
                    <AboutModal onClose={() => setIsAboutOpen(false)} />
                )
            }
        </div >
    );
}
