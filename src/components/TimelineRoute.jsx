import React from 'react';
import { useParams, useNavigate, useLocation, Link, Navigate } from 'react-router-dom';
import { Loader2, Activity } from 'lucide-react';
import AnalysisTimeline from './AnalysisTimeline';
import { useSubjects, findStack } from '../context/SubjectsContext';
import { useDiscretion } from '../context/DiscretionContext';

/**
 * Where a stack's timeline lives. Keyed by relationship id rather than name since Phase 4,
 * so the link survives a rename — the old /timeline/:name form still resolves, see
 * LegacyTimelineRedirect below.
 */
export const timelinePath = (relationshipId) => `/relationships/${relationshipId}/timeline`;

const Frame = ({ children }) => (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-12">{children}</div>
    </div>
);

const Loading = () => (
    <div className="flex justify-center items-center py-32">
        <Loader2 className="animate-spin text-slate-400" size={32} />
    </div>
);

const LoadFailed = ({ message }) => (
    <div role="alert" className="p-4 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm">
        {message}
    </div>
);

const NotFound = ({ heading, detail }) => (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-12 flex flex-col items-center text-center">
        <Activity size={40} className="mb-4 opacity-20 text-slate-400" />
        <h2 className="text-xl font-light text-slate-700">{heading}</h2>
        <p className="text-sm text-slate-400 font-light mt-2 max-w-sm">{detail}</p>
        <Link to="/" className="mt-6 text-sm font-medium text-slate-600 hover:text-slate-900 underline underline-offset-4">
            Back to your analyses
        </Link>
    </div>
);

export default function TimelineRoute() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { people, loading, loadError } = useSubjects();
    const { maskName } = useDiscretion();

    // 'default' is the key React Router gives an entry the user landed on directly,
    // where there is no history to go back to.
    const goBack = () => {
        if (location.key === 'default') navigate('/');
        else navigate(-1);
    };

    // Path params are strings; relationship_id is a number on every snapshot.
    const versions = findStack(people, Number(id));

    if (loading) return <Frame><Loading /></Frame>;
    if (loadError) return <Frame><LoadFailed message={loadError} /></Frame>;
    if (versions.length === 0) {
        return (
            <Frame>
                <NotFound
                    heading="No analysis here"
                    detail="This relationship has no snapshots — it may have been deleted or merged into another one."
                />
            </Frame>
        );
    }

    return <Frame><AnalysisTimeline versions={versions} onBack={goBack} maskName={maskName} /></Frame>;
}

/**
 * The pre-Phase-4 /timeline/:name form, kept working for links people already have.
 *
 * Resolution is best-effort by name: a stack that has since been renamed cannot be found
 * this way, which is exactly the fragility the id-based route exists to end.
 */
export function LegacyTimelineRedirect() {
    // useParams decodes for us — decoding again would corrupt a name containing '%'.
    const { name } = useParams();
    const { people, loading, loadError } = useSubjects();

    if (loading) return <Frame><Loading /></Frame>;
    if (loadError) return <Frame><LoadFailed message={loadError} /></Frame>;

    const match = people.find(person => person.name === name);
    if (match) return <Navigate to={timelinePath(match.relationship_id)} replace />;

    return (
        <Frame>
            <NotFound
                heading={`No analysis for “${name}”`}
                detail="This is an older link, which finds a stack by its name. The name may have changed since — open the stack from your analyses instead."
            />
        </Frame>
    );
}
