import React, { useState } from 'react';
import { X } from 'lucide-react';

// The tag vocabulary and its limits moved to src/constants/contextTags.js when the journal
// began sharing them: a pure constants module cannot import from a component. Re-exported
// here so every existing importer of this file keeps working and there is still one name to
// look for.
import { CONTEXT_TAGS, MAX_TAGS, MAX_TAG_LENGTH } from '../constants/contextTags';

export { CONTEXT_TAGS, MAX_TAGS, MAX_TAG_LENGTH };

/**
 * The notes + tags editor. Used by PersonForm at snapshot time and by WhatChanged
 * afterwards, so both write the same shape with the same limits.
 */
export default function ContextCapsuleFields({
    description,
    tags,
    onDescriptionChange,
    onTagsChange,
    heading = "What's been happening?",
    hint = 'Optional. Context is what makes a spike readable six months from now.',
    textareaId = 'snapshot-note'
}) {
    const [customTag, setCustomTag] = useState('');

    const toggleTag = (tag) => {
        if (tags.includes(tag)) {
            onTagsChange(tags.filter(t => t !== tag));
        } else if (tags.length < MAX_TAGS) {
            onTagsChange([...tags, tag]);
        }
    };

    const addCustomTag = () => {
        const trimmed = customTag.trim();
        if (!trimmed) return;
        if (!tags.includes(trimmed) && tags.length < MAX_TAGS) {
            onTagsChange([...tags, trimmed]);
        }
        setCustomTag('');
    };

    const handleCustomTagKeyDown = (e) => {
        // Enter adds the tag rather than submitting the surrounding form.
        if (e.key === 'Enter') {
            e.preventDefault();
            addCustomTag();
        }
    };

    const customTags = tags.filter(t => !CONTEXT_TAGS.includes(t));
    const tagLimitReached = tags.length >= MAX_TAGS;

    return (
        <div className="space-y-4">
            {heading && (
                <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">{heading}</label>
                    {hint && <p className="text-[11px] text-slate-400 font-light mt-1">{hint}</p>}
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                {CONTEXT_TAGS.map((tag) => {
                    const selected = tags.includes(tag);
                    return (
                        <button
                            key={tag}
                            type="button"
                            onClick={() => toggleTag(tag)}
                            aria-pressed={selected}
                            disabled={!selected && tagLimitReached}
                            className={`px-3 py-1 rounded-full text-xs border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${selected
                                ? 'bg-slate-800 text-white border-slate-800'
                                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                                }`}
                        >
                            {tag}
                        </button>
                    );
                })}
            </div>

            {customTags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {customTags.map((tag) => (
                        <span key={tag} className="flex items-center gap-1 px-3 py-1 rounded-full text-xs bg-slate-800 text-white">
                            {tag}
                            <button
                                type="button"
                                onClick={() => toggleTag(tag)}
                                aria-label={`Remove ${tag}`}
                                className="text-white/60 hover:text-white transition-colors"
                            >
                                <X size={12} />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <div className="flex gap-2">
                <input
                    type="text"
                    value={customTag}
                    onChange={(e) => setCustomTag(e.target.value)}
                    onKeyDown={handleCustomTagKeyDown}
                    maxLength={MAX_TAG_LENGTH}
                    disabled={tagLimitReached}
                    aria-label="Add a custom tag"
                    placeholder={tagLimitReached ? `Tag limit reached (${MAX_TAGS})` : 'Add your own tag...'}
                    className="flex-1 text-sm border-b-2 border-slate-200 py-1.5 focus:border-slate-800 focus:outline-none bg-transparent transition-colors placeholder:text-slate-300 text-slate-700 disabled:cursor-not-allowed"
                />
                <button
                    type="button"
                    onClick={addCustomTag}
                    disabled={!customTag.trim() || tagLimitReached}
                    className="px-3 py-1 text-xs font-medium text-slate-500 border border-slate-200 rounded-lg hover:border-slate-400 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    Add
                </button>
            </div>

            <div>
                <label htmlFor={textareaId} className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Notes</label>
                <textarea
                    id={textareaId}
                    rows={3}
                    value={description}
                    onChange={(e) => onDescriptionChange(e.target.value)}
                    placeholder="Anything future-you should know about this period?"
                    className="w-full text-sm p-3 bg-white border border-slate-200 rounded-lg text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-slate-800 transition-colors resize-y"
                />
            </div>
        </div>
    );
}
