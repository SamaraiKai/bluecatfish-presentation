'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { findCrossSectionRepeats, type Repeat } from '@/lib/lessonOverlap';
import { CACHE_VERSION } from '@/src/cacheVersion';

/*
 * Readable copy of the current lesson, for checking facts, tone and length
 * without clicking through the presentation. Shows what's on screen AND what's
 * spoken for every slide, flags facts repeated across topics, and prints
 * cleanly (Print / Save as PDF).
 */

type AnyStep = Record<string, any> & { type: string };
type Section = {
  title: string;
  steps: AnyStep[];
  recap?: string;
  remediation?: string;
  imageDescription?: string;
};

const TYPE_LABEL: Record<string, string> = {
  overview: 'Overview',
  detail: 'Going deeper',
  example: 'Analogy',
  numberSpotlight: 'By the numbers',
  imageFocus: 'Look at this (image)',
  askAloud: 'Your turn (spoken question)',
  predictThen: 'Take a guess',
  checkYourself: 'True / false',
  compare: 'Side by side',
};

const WORDS_PER_MINUTE = 150;   // text-to-speech pace, roughly

function spokenText(st: AnyStep): string {
  if (st.type === 'askAloud') return `${st.question} ${st.answer}`;
  if (st.type === 'predictThen') return `${st.question} ${st.answer}`;
  if (st.type === 'checkYourself') return `${st.statement} ${st.feedback}`;
  return st.narration ?? st.text ?? st.context ?? '';
}

const countWords = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

function minutes(words: number) {
  const m = words / WORDS_PER_MINUTE;
  return m < 1 ? `${Math.round(m * 60)} sec` : `${m.toFixed(1)} min`;
}

export default function LessonReview() {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [source, setSource] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/slidesv2', { method: 'POST' })
      .then((r) => r.json())
      .then((d) => {
        if (d.error || !d.sections) throw new Error(d.error || 'No lesson returned');
        setSections(d.sections);
        setSource(d.source ?? '');
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="p-10 text-red-700">Could not load the lesson: {error}</div>;
  if (!sections) {
    return (
      <div className="p-10 text-slate-700">
        Loading the lesson… (if this version hasn&apos;t been generated yet, this can take a few minutes)
      </div>
    );
  }

  const repeats: Repeat[] = findCrossSectionRepeats(sections);
  const perTopicWords = sections.map((s) => s.steps.reduce((n, st) => n + countWords(spokenText(st)), 0));
  const totalWords = perTopicWords.reduce((a, b) => a + b, 0);
  const totalSlides = sections.reduce((n, s) => n + s.steps.length, 0);
  const slideName = (r: Repeat['a']) => `Topic ${r.section + 1} · slide ${r.step + 1}`;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <style>{`@media print { .no-print { display: none !important; } section { break-inside: avoid-page; } }`}</style>
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Lesson review</h1>
            <p className="text-slate-600 mt-1">
              Version {CACHE_VERSION} · {sections.length} topics · {totalSlides} slides · about {minutes(totalWords)} of narration
              {source === 'generated' ? ' · just generated' : ''}
            </p>
          </div>
          <div className="no-print flex gap-2 shrink-0">
            <Link href="/presentationv2" className="px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-sm">Open presentation</Link>
            <button onClick={() => window.print()} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm">Print / Save as PDF</button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-8 text-sm text-slate-700">
          <b>How to read this:</b> <span className="text-blue-800">On screen</span> is what the learner sees;{' '}
          <span className="text-emerald-800">Spoken</span> is what the professor says; <span className="text-amber-800">Plain version</span>{' '}plays
          when a learner says &quot;simpler please&quot;. Minutes are estimated at {WORDS_PER_MINUTE} spoken words per minute (not counting animations or pauses).
        </div>

        <section className="mb-10">
          <h2 className="text-xl font-bold mb-2">
            Repeated across topics {repeats.length ? <span className="text-red-600">({repeats.length})</span> : <span className="text-green-700">(none found)</span>}
          </h2>
          {repeats.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {repeats.map((r, k) => (
                <li key={k} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <b>{slideName(r.a)}</b> “{r.a.text}” ↔ <b>{slideName(r.b)}</b> “{r.b.text}”
                  <span className="text-slate-500"> — {r.why}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">No on-screen fact appears in two topics (checked: same numbers, or mostly the same words).</p>
          )}
        </section>

        {sections.map((sec, i) => (
          <section key={i} className="mb-12">
            <h2 className="text-2xl font-bold border-b-2 border-slate-200 pb-2 mb-4">
              Topic {i + 1}: {sec.title}
              <span className="ml-3 text-sm font-normal text-slate-500">{sec.steps.length} slides · ~{minutes(perTopicWords[i])}</span>
            </h2>

            <ol className="space-y-5">
              {sec.steps.map((st, s) => (
                <li key={s} className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    Slide {s + 1} · {TYPE_LABEL[st.type] ?? st.type}
                    {st.heading ? ` · “${st.heading}”` : ''}
                  </div>

                  <div className="mb-2">
                    <div className="text-xs font-semibold text-blue-800">On screen</div>
                    {st.type === 'numberSpotlight' ? (
                      <p><b>{st.value}</b> — {st.label}. <i>{st.context}</i></p>
                    ) : st.type === 'askAloud' ? (
                      <div>
                        <p className="font-medium">{st.question}</p>
                        <p className="text-sm text-slate-600">A good answer mentions: {(st.lookFor ?? []).join('; ')}</p>
                      </div>
                    ) : st.type === 'imageFocus' ? (
                      <p className="text-slate-600">[the topic&apos;s image, full width]{sec.imageDescription ? ` — ${sec.imageDescription}` : ''}</p>
                    ) : st.type === 'compare' ? (
                      <p><b>{st.leftTitle}:</b> {(st.left ?? []).join('; ')} &nbsp;|&nbsp; <b>{st.rightTitle}:</b> {(st.right ?? []).join('; ')}</p>
                    ) : st.bullets?.length ? (
                      <ul className="list-disc pl-5">{st.bullets.map((b: string, k: number) => <li key={k}>{b}</li>)}</ul>
                    ) : (
                      <p>{st.text ?? st.question ?? st.statement ?? ''}</p>
                    )}
                    {st.stats?.length ? (
                      <p className="text-sm mt-1">Stats: {st.stats.map((x: any) => `${x.value} (${x.label})`).join(' · ')}</p>
                    ) : null}
                  </div>

                  <div className="mb-2">
                    <div className="text-xs font-semibold text-emerald-800">
                      Spoken <span className="font-normal text-slate-500">({countWords(spokenText(st))} words)</span>
                    </div>
                    {st.type === 'askAloud' ? (
                      <p>
                        Asks the question, listens for the answer and responds to it. If nobody answers:{' '}
                        <span className="italic">“{st.answer}”</span>
                      </p>
                    ) : (
                      <p className="leading-relaxed">{spokenText(st)}</p>
                    )}
                  </div>

                  {st.simple && (
                    <div>
                      <div className="text-xs font-semibold text-amber-800">Plain version</div>
                      <p className="text-slate-700">{st.simple}</p>
                    </div>
                  )}
                </li>
              ))}
            </ol>

            <div className="mt-4 grid gap-2 text-sm">
              {sec.recap && <p><b>End-of-lesson recap line:</b> {sec.recap}</p>}
              {sec.remediation && <p><b>&quot;Lost me&quot; re-explanation:</b> {sec.remediation}</p>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
