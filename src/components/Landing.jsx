import React from 'react';
import { Link } from 'react-router-dom';
import { Activity, Heart, ArrowRight } from 'lucide-react';

export default function Landing() {
    return (
        <div className="min-h-[calc(100vh-64px)] bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
            <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="flex justify-center mb-6">
                    <div className="p-4 bg-rose-50 rounded-full">
                        <Heart className="text-rose-500 w-16 h-16" strokeWidth={1.5} />
                    </div>
                </div>

                <h1 className="text-5xl md:text-6xl font-light tracking-tight text-slate-900">
                    Quantify Your <span className="font-semibold text-rose-500">Love</span>
                </h1>

                <p className="text-xl text-slate-500 font-light leading-relaxed max-w-lg mx-auto">
                    Understand your emotional landscape using the Color Wheel Theory of Love. Track, analyze, and reflect on your connections.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center pt-8">
                    <Link
                        to="/login"
                        className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-slate-900 text-white rounded-2xl hover:bg-slate-800 transition-all text-lg font-medium shadow-xl shadow-slate-200 hover:shadow-2xl hover:-translate-y-1"
                    >
                        <span>Start Analyzing</span>
                        <ArrowRight size={20} />
                    </Link>
                    <button className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-slate-600 border border-slate-200 rounded-2xl hover:border-slate-300 hover:bg-slate-50 transition-all text-lg font-medium">
                        Learn the Theory
                    </button>
                </div>

                <div className="pt-16 grid grid-cols-2 md:grid-cols-4 gap-8 opacity-60">
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-rose-400" />
                        <span className="text-sm font-medium text-slate-400 uppercase tracking-widest">Eros</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-orange-400" />
                        <span className="text-sm font-medium text-slate-400 uppercase tracking-widest">Ludus</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-amber-400" />
                        <span className="text-sm font-medium text-slate-400 uppercase tracking-widest">Storge</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-sm font-medium text-slate-400 uppercase tracking-widest">Pragma</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
