'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useFacePresence } from "@/components/hooks/useFacePresence";
import { useVoiceInput } from '@/components/hooks/useVoiceInput';
import { useSpeechQueue } from '@/components/hooks/useSpeechQueue';
import { useHandRaise } from '@/components/hooks/useHandRaise';

/* ============================================================================
 * TYPES
 * ========================================================================== */
interface Message {
  role: 'user' | 'ai';
  text: string;
}

interface SectionWithBreakdown {
  title: string;
  icon: string;
  image: string;
  steps: Step[];
  quiz: { question: string; options: string[]; correctAnswer: number; explanation: string }[];
  recap: string,
}

type MicroStep = {
  label: string;
  audioKey: string | null;
};

type Step =
  | { type: 'overview'; text: string; stats?: { value: string; label: string }[] }
  | { type: 'simple'; text: string }
  | { type: 'example'; text: string }
  | { type: 'imageFocus'; text: string }
  | { type: 'keyTerms'; terms: { term: string; definition: string }[] }
  | { type: 'numberSpotlight'; value: string; label: string; context: string }
  | { type: 'predictThen'; question: string; answer: string; reveal: string }
  | { type: 'checkYourself'; statement: string; isTrue: boolean; feedback: string };

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

// Sections are no longer hardcoded — they're fetched from /api/slides2 on load.
const PRESENTATION = {
  title: "Why Are Blue Catfish Invasive?",
  subtitle: "Understanding the Chesapeake Bay Crisis",
  professor: {
    name: "Professor Marine",
    title: "Marine Biology & Conservation"
  }
};

const STEP_LABELS: Record<Step['type'], string> = {
  overview: 'Overview',
  simple: 'Simple Explanation',
  example: 'Real World Example',
  imageFocus: 'Look at This',
  keyTerms: 'Key Terms',
  numberSpotlight: 'By the Numbers',
  predictThen: 'Take a Guess',
  checkYourself: 'Quick Check',
};

/* ============================================================================
 * MICRO-STEP CONFIG
 * ========================================================================== */
function getMicroSteps(section: SectionWithBreakdown, sectionIndex: number): MicroStep[] {
  if (!section) return [];
  return section.steps.map((step, s) => ({
    label: STEP_LABELS[step.type],
    audioKey: `section${sectionIndex}_step${s}`,
  }));
}

function getMicroStepText(section: SectionWithBreakdown, stepIndex: number): string {
    const step = section.steps[stepIndex];
    if (!step || step.type === 'keyTerms') return '';
    if (step.type === 'numberSpotlight') return step.context;
    if (step.type === 'predictThen') return '';
    if (step.type === 'checkYourself') return '';
    return step.text;
  }

/* ============================================================================
 * HOOKS
 * ========================================================================== */
const useAudioPlayer = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [currentText, setCurrentText] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback((url: string | undefined, key: string, text: string = '', onComplete?: () => void, startAt: number = 0) => {
    if (!url) {
      console.warn(`No audio URL found for "${key}"`);
      if (onComplete) onComplete();
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(url);
    audioRef.current = audio;
    setCurrentKey(key);
    setCurrentText(text);
    setIsSpeaking(true);
    setIsPaused(false);
    setCurrentTime(startAt);
    setDuration(0);

    if (startAt > 0) {
      audio.currentTime = startAt;
    }
    
    audio.ontimeupdate = () => setCurrentTime(audio.currentTime);
    audio.onloadedmetadata = () => setDuration(audio.duration);
    
    audio.onended = () => {
      setIsSpeaking(false);
      setIsPaused(false);
      setCurrentKey(null);
      if (onComplete) onComplete();
    };

    audio.onerror = () => {
      console.warn(`Audio playback failed for "${key}"`);
      setIsSpeaking(false);
      setIsPaused(false);
      setCurrentKey(null);
      if (onComplete) onComplete();
    };

    audio.play().catch((err) => {
      console.warn('Audio playback failed:', err);
      setIsSpeaking(false);
      if (onComplete) onComplete();
    });
  }, []);

  const pause = useCallback(() => {
    if (audioRef.current && isSpeaking && !isPaused) {
      audioRef.current.pause();
      setIsPaused(true);
    }
  }, [isSpeaking, isPaused]);

  const resume = useCallback(() => {
    if (audioRef.current && isPaused) {
      audioRef.current.play().catch((e) => {
        if (e.name !== "AbortError") console.warn("Audio playback failed:", e);
      });
      setIsPaused(false);
    }
  }, [isPaused]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentKey(null);
  }, []);

  return { 
    play, 
    pause, 
    resume, 
    stop, 
    isSpeaking, 
    isPaused, 
    currentKey, 
    currentText, 
    currentTime, 
    duration, 
  };
};

const useAIChat = (currentSection: SectionWithBreakdown | undefined, 
                   missedQuestions: { question: string; options: string[]; correctAnswer: number; explanation: string }[], 
                   onSentence?: (sentence: string) => void,
                   beginStream?: () => void,
                   endStream?: () => void
                  ) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', text: `Good day! I'm ${PRESENTATION.professor.name}, and I'll be your guide through today's lecture on the Blue Catfish invasion in the Chesapeake Bay. Feel free to ask me any questions as we go through the material. What would you like to explore first?` }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState('');

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;
    
    const userMessage: Message = { role: 'user', text };

    const history = messages.map((m) => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: m.text,
    }));
    
    setInput('');
    setIsLoading(true);

    // Placeholder bubble that fills in as tokens arrive
    setMessages((prev) => {
      const next = [...prev, userMessage, { role: 'ai', text: '' }]
      return next;
    });
    
    const missedContext = missedQuestions.length > 0
      ? ` The student just missed these quiz questions: ${missedQuestions.map(q => `"${q.question}" (they need to understand: ${q.explanation})`).join(' ')} If they ask for help or clarification, prioritize addressing these specific gaps.`
      : '';
    
    try {
      const response = await fetch('/api/conversational/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userText: text,
          topic: 'Blue Catfish invasion in the Chesapeake Bay',
          stream: true,
          systemPrompt: `You are "${PRESENTATION.professor.name}", a university professor specializing in Marine Biology and Conservation. The student is currently viewing a slide titled "${currentSection?.title}" which covers: ${currentSection?.steps?.[0]?.text ?? ''}${missedContext} Answer questions with awareness of what they're currently looking at, and relate your answers back to this section when relevant, like a professor referencing the current lecture slide.`,
          conversation: history
        }),
      });
      
      if (!response.ok || !response.body) {
        throw new Error(`Chat request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      beginStream?.();

      let full = '';        // everything received so far
      let pending = '';     // text not yet sent to TTS

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const token = decoder.decode(value, { stream: true });
        full += token;
        pending += token;

        // Update the last bubble as text arrives
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: 'ai', text: full };
          return next;
        });

        // Cut off any complete sentences and speak them right away
        let match;
        while ((match = pending.match(/^([\s\S]*?[.!?])(\s+)([\s\S]*)$/))) {
          const sentence = match[1].trim();
          pending = match[3];
          if (sentence && onSentence) onSentence(sentence);
        }
      }

      // Whatever's left over after the stream ends
      const tail = pending.trim();
      if (tail && onSentence) onSentence(tail);

      endStream?.();
      
      if (!full.trim()) {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: 'ai',
            text: "Sorry, I couldn't generate a response. Please try again.",
          };
          return next;
        });
      }
    } catch (err) {
      endStream?.();
      console.error('RAG chat failed:', err);
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: 'ai',
          text: "Sorry, I'm having trouble responding right now. Please try again.",
        };
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  };

  return { messages, isLoading, input, setInput, sendMessage };
};

/* ============================================================================
 * SMALL PRESENTATIONAL HELPERS
 * ========================================================================== */
function HighlightedText({
  text,
  currentTime,
  duration,
  isSpeaking,
  isActive, // true only if THIS text is what's currently playing
  className,
}: {
  text: string;
  currentTime: number;
  duration: number;
  isSpeaking: boolean;
  isActive: boolean;
  className?: string;
}) {
  const words = text ? text.split(/\s+/) : [];
  const activeIndex =
    isActive && isSpeaking && duration > 0
      ? (() => {
          const totalChars = words.reduce((sum, w) => sum + w.length, 0);
          const targetChars = (currentTime / duration) * totalChars;
          let cumulative = 0;
          for (let i = 0; i < words.length; i++) {
            cumulative += words[i].length;
            if (cumulative >= targetChars) return i;
          }
          return words.length - 1;
        })()
      : -1;

  return (
    <p className={className}>
      {words.map((word, i) => (
        <span
          key={i}
          className={i === activeIndex ? 'bg-cyan-400/40 rounded px-1 transition-colors' : 'transition-colors'}
        >
          {word}{' '}
        </span>
      ))}
    </p>
  );
}

function AnimatedStatValue({ value }: { value: string }) {
  const match = value.match(/^(\d+(?:\.\d+)?)/);
  const targetNum = match ? parseFloat(match[1]) : null;
  const suffix = match ? value.slice(match[1].length) : '';
  const [display, setDisplay] = useState(targetNum !== null ? 0 : null);
  const hasAnimated = useRef(false);
    
  useEffect(() => {
    if (targetNum === null || hasAnimated.current) return;
    hasAnimated.current = true;
  
    let startTime: number | null = null;
    const duration = 900; // ms
    let frameId: number;
  
    const step = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); 
      setDisplay(Math.round(eased * targetNum));
      if (progress < 1) {
          frameId = requestAnimationFrame(step);
      }
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [targetNum]);
  
  if (targetNum === null) {
    return <>{value}</>;
  }
  
  return <>{display}{suffix}</>;
}

/* ============================================================================
 * SCREEN COMPONENTS
 * ========================================================================== */
function CameraSelector({ onSelect }: { onSelect: (useCamera: boolean) => void }) {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-gradient-to-br from-mist-50 to-mist-400 p-8">
      <h1 className="text-3xl md:text-4xl font-bold text-black mb-2 text-center">
        Use Your Camera?
      </h1>
      <p className="text-blue-500 mb-10 text-center">
        The camera stays on your device — nothing is recorded or uploaded
      </p>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Camera on */}
        <button
          onClick={() => onSelect(true)}
          className="group bg-mist-400/60 hover:bg-mist-200 border border-grey/50 hover:border-white rounded-3xl p-6 w-72 transition-colors text-left"
        >
          <div className="flex items-center justify-center h-32 mb-4 bg-blue-700/50 rounded-lg">
            <span className="text-6xl">📷</span>
          </div>
          <h3 className="text-black font-bold text-lg mb-1">Use Camera</h3>
          <p className="text-blue-500 text-sm">
            The lesson pauses when you look away, and you can raise your hand anytime to ask a question
          </p>
        </button>

        {/* Camera off */}
        <button
          onClick={() => onSelect(false)}
          className="group bg-mist-400/60 hover:bg-mist-200 border border-grey/50 hover:border-white rounded-3xl p-6 w-72 transition-colors text-left"
        >
          <div className="flex items-center justify-center h-32 mb-4 bg-blue-600/50 rounded-lg">
            <span className="text-6xl">🚫</span>
          </div>
          <h3 className="text-black font-bold text-lg mb-1">No Camera</h3>
          <p className="text-blue-500 text-sm">
            Continue without the camera — everything else works the same
          </p>
        </button>
      </div>
    </div>
  );
}

function TemplateSelector({ onSelect }: { onSelect: (template: 'classic' | 'split') => void }) {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-gradient-to-br from-mist-50 to-mist-400 p-8">
      <h1 className="text-3xl md:text-4xl font-bold text-black mb-2 text-center">Choose Your Lesson Style</h1>
      <p className="text-blue-500 mb-10 text-center">Same lesson, two different layouts — pick whichever you prefer</p>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Classic template preview card */}
        <button
          onClick={() => onSelect('classic')}
          className="group bg-mist-400/60 hover:bg-mist-200 border border-grey/50 hover:border-white rounded-3xl p-6 w-72 transition-colors text-left"
        >
          <div className="grid grid-cols-2 gap-2 h-32 mb-4">
            <div className="bg-blue-700/50 rounded-lg" /> {/* image */}
            <div className="bg-blue-600/50 rounded-lg" /> {/* content/mini-slideshow */}
          </div>
          <h3 className="text-black font-bold text-lg mb-1">Classic</h3>
          <p className="text-blue-500 text-sm">Image on left and content on right</p>
        </button>

        {/* Split template preview card */}
        <button
          onClick={() => onSelect('split')}
          className="group bg-mist-400/60 hover:bg-mist-200 border border-grey/50 hover:border-white rounded-3xl p-6 w-72 transition-colors text-left"
        >
          <div className="grid grid-cols-2 gap-2 h-32 mb-4">
            <div className="bg-blue-600/50 rounded-lg" /> {/* mini-slideshow, full height */}
            <div className="bg-blue-700/50 rounded-lg flex-1" /> {/* image, top */}
          </div>
          <h3 className="text-black font-bold text-lg mb-1">Split View</h3>
          <p className="text-blue-500 text-sm">Content on the left, image on the right</p>
        </button>
      </div>
    </div>
  );
}

interface SectionWithBreakdown {
  title: string;
  icon: string;
  image: string;
  recap: string;
  steps: Step[];
  quiz: { question: string; options: string[]; correctAnswer: number; explanation: string }[];
}

const NODE_W = 260;
const NODE_H = 90;
const COL_X = [40, 400];
const ROW_Y = [20, 180, 340];

// Snaking order: L→R, down, R→L, down, L→R
function nodePos(i: number) {
  const row = Math.floor(i / 2);
  const leftFirst = row % 2 === 0;
  const col = leftFirst ? i % 2 : 1 - (i % 2);
  return { x: COL_X[col], y: ROW_Y[row], col, row };
}

function SummaryFlowchart({
  sections,
  currentKey,
  sectionScores,
}: {
  sections: SectionWithBreakdown[];
  currentKey: string | null;
  sectionScores: Record<number, number>;
}) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!currentKey) return;
    const m = currentKey.match(/^section(\d+)_recap$/);
    if (m) {
      const idx = parseInt(m[1], 10);
      setRevealed((prev) => (prev.has(idx) ? prev : new Set([...prev, idx])));
    }
  }, [currentKey]);

  const connectors = sections.slice(0, -1).map((_, i) => {
    const a = nodePos(i);
    const b = nodePos(i + 1);
    if (a.row === b.row) {
      // horizontal
      const goingRight = b.x > a.x;
      const x1 = goingRight ? a.x + NODE_W : a.x;
      const x2 = goingRight ? b.x : b.x + NODE_W;
      const y = a.y + NODE_H / 2;
      return { d: `M ${x1} ${y} L ${x2} ${y}`, from: i };
    }
    // vertical, down the side the node sits on
    const x = a.x + NODE_W / 2;
    return { d: `M ${x} ${a.y + NODE_H} L ${x} ${b.y}`, from: i };
  });

  return (
    <svg viewBox="0 0 700 460" className="w-full max-w-3xl mx-auto">
      {connectors.map((c, i) => {
        const on = revealed.has(c.from + 1);
        return (
          <path
            key={i}
            d={c.d}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="3"
            strokeLinecap="round"
            style={{
              strokeDasharray: 200,
              strokeDashoffset: on ? 0 : 200,
              transition: 'stroke-dashoffset 0.6s ease-out',
            }}
          />
        );
      })}

      {sections.map((sec, i) => {
        const { x, y } = nodePos(i);
        const on = revealed.has(i);
        const active = currentKey === `section${i}_recap`;
        const score = sectionScores[i];
        const perfect = score !== undefined && score === (sec.quiz?.length ?? 2);

        return (
          <g
            key={i}
            style={{
              opacity: on ? 1 : 0,
              transform: on ? 'translateY(0)' : 'translateY(12px)',
              transformOrigin: `${x + NODE_W / 2}px ${y + NODE_H / 2}px`,
              transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
            }}
          >
            <rect
              x={x}
              y={y}
              width={NODE_W}
              height={NODE_H}
              rx="18"
              fill="#ffffff"
              stroke={active ? '#06b6d4' : perfect ? '#22c55e' : '#93c5fd'}
              strokeWidth={active ? 4 : 2}
              style={{ transition: 'stroke 0.3s, stroke-width 0.3s' }}
            />
            <text
              x={x + 24}
              y={y + 50}
              fontSize="15"
              fontWeight="700"
              fill="#1e3a5f"
            >
              {sec.title.length > 26 ? sec.title.slice(0, 24) + '…' : sec.title}
            </text>
            <text x={x + 24} y={y + 70} fontSize="12" fill="#64748b">
              Section {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ConclusionScreen({
    onRestart,
    sectionScores,
    totalQuestions,
    sections,
    currentKey,
  }: {
    onRestart: () => void;
    sectionScores: Record<number, number>;
    totalQuestions: number;
    sections: SectionWithBreakdown[];
    currentKey: string | null;
  }) {
    const totalScore = Object.values(sectionScores).reduce((sum, s) => sum + s, 0);
    
    return (
      <div className="flex flex-col items-center justify-center text-center py-10 px-8 w-full">
        <div className="text-5xl mb-4">🎓</div>
        <h2 className="text-3xl md:text-4xl font-bold text-black mb-2">Lesson Complete!</h2>
        <p className="text-blue-700 mb-8">Here's everything we covered</p>
      
        <SummaryFlowchart
          sections={sections}
          currentKey={currentKey}
          sectionScores={sectionScores}
        />
      
        <p className="text-2xl font-bold text-cyan-500 mt-8 mb-6">
          Final Score: {totalScore} / {totalQuestions}
        </p>
      
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={onRestart}
            className="px-6 py-3 bg-blue-800/60 hover:bg-blue-700/70 text-white rounded-xl font-semibold transition-colors border border-blue-500/30"
          >
            ↺ Restart Lesson
          </button>
        </div>
      
        <p className="text-blue-700/70 text-sm mt-8">
          Still curious about something? Use <span className="text-cyan-500 font-medium">Ask AI</span> up top —
          Professor Marine is happy to go deeper on anything from the lesson.
        </p>
      </div>
    );
  }

function Notice({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="absolute top-0 left-1/2 -translate-x-1/2 mb-5 z-40 bg-slate-900 text-white text-sm font-medium px-5 py-2.5 rounded-full shadow-lg animate-[fadeIn_0.2s_ease-out]">
      {text}
    </div>
  );
}
/* ============================================================================
 * SLIDE BLOCKS
 * ========================================================================== */
function SectionImageBlock({
    currentSection,
    activeSection,
    totalSections,
  }: {
    currentSection: SectionWithBreakdown;
    activeSection: number;
    totalSections: number;
  }) {
    return (
              <div className="relative h-72 md:h-auto min-h-[500px] bg-gradient-to-br overflow-hidden">
                
                {/* Main Image */}
                {currentSection.image && (
                  <img 
                    key={currentSection.image}
                    src={currentSection.image} 
                    alt={currentSection.title}
                    className="absolute inset-0 w-full h-full object-contain opacity-80"
                    onError={(e) => {
                      e.currentTarget.style.display='none';
                    }}
                  />
                )}
                
                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-mist-400/50 via-transparent to-mist-500/50" />
                
                
                
                {/* Stats Overlay */}
                {/*
                <div className="absolute top-4 right-4 flex flex-col gap-2">
                  {currentSection.stats.slice(0, 2).map((stat, idx) => (
                    <div 
                      key={idx}
                      className="bg-cyan-500/80 backdrop-blur-sm px-3 py-2 rounded-lg animate-[fadeInUp_0.5s_ease-out_forwards] shadow-lg"
                      style={{ animationDelay: `${idx * 0.2}s` }}
                    >
                      <div className="text-lg font-bold text-white">{stat.value}</div>
                      <div className="text-xs text-cyan-100">{stat.label}</div>
                    </div>
                  ))}
                </div>
                */}
              </div>
          );
        }

function MiniSlideshowBlock({
  currentSection,
  activeSectionIndex,
  microStep,
  microSteps,
  goToMicroStep,
  nextMicroStep,
  prevMicroStep,
  showQuiz,
  handleQuizContinue,
  currentTime,
  duration,
  isSpeaking,
  currentKey,
  playMicroStepAudio,
  autoAdvanceFrom,
  audioUrls,
  play,
  devMode
}: {
  currentSection: SectionWithBreakdown;
  activeSectionIndex: number;
  microStep: number;
  microSteps: MicroStep[];
  goToMicroStep: (i: number) => void;
  nextMicroStep: () => void;
  prevMicroStep: () => void;
  showQuiz: boolean;
  handleQuizContinue: () => void;
  currentTime: number;
  duration: number;
  isSpeaking: boolean;
  currentKey: string | null;
  playMicroStepAudio: (sectionIndex: number, stepIndex: number, transitionType: 'means' | 'analogy' | null) => void;
  autoAdvanceFrom: (sectionIndex: number, fromStep: number) => void;
  audioUrls: Record<string, string>;
  play: (url: string | undefined, key: string, text?: string, onComplete?: () => void) => void;
  devMode: boolean;
}) {
  return (
    <div className="p-8 md:p-12 flex flex-col justify-center bg-gradient-to-br from-mauve-200/70 to-mauve-300/70 rounded-3xl border border-white-500/30">
      {/* Animated Title */}
      <h2 className="text-3xl md:text-4xl font-bold text-black mb-4 animate-[slideInRight_0.6s_ease-out]">
        {currentSection.title}
      </h2>
      
      {/* Animated Underline */}
      <div className="h-1 w-0 bg-gradient-to-r from-cyan-700 to-blue-700 rounded-full mb-6 animate-[expandWidth_0.8s_ease-out_0.3s_forwards]" />
      
      {/* ===================== MINI-SLIDESHOW (replaces old Confused button + modal) ===================== */}

      {(() => {
        const step = currentSection.steps[microStep];
        if (!step) return null; // step index out of range mid-transition — render nothing this frame
        const baseKey = `section${activeSectionIndex}_step${microStep}`;
        const [revealed, setRevealed] = useState(false);
        const [checkAnswer, setCheckAnswer] = useState<boolean | null>(null);
        const [scaled, setScaled] = useState(false);

        useEffect(() => {
          setRevealed(false);
          setCheckAnswer(null);
        }, [microStep, activeSectionIndex]);

        useEffect(() => {
          if (currentKey === `${baseKey}_value`) {
            // next frame, so the browser paints the un-scaled state first and can animate from it
            const id = requestAnimationFrame(() => setScaled(true));
            return () => cancelAnimationFrame(id);
          } else {
            setScaled(false);
          }
        }, [currentKey, baseKey]);
      
        if (step.type === 'keyTerms') {
          return (
            <div className="space-y-3">
              {step.terms.map((kt, idx) => {
                const termKey = `section${activeSectionIndex}_keyterm${idx}`;
                const isActive = currentKey === termKey;
                return (
                  <div 
                    key={idx} 
                    className={`rounded-xl p-4 border transition-all duration-300 ${
                      isActive
                        ? 'bg-blue-950 border-cyan-400 ring-2 ring-cyan-300 scale-[1.02] shadow-lg'
                        : 'bg-blue-900/50 border-blue-500/40'
                    }`}
                  >
                    <div className={`font-bold mb-1 text-xl ${isActive ? 'text-cyan-300' : 'text-cyan-400'}`}>
                      {kt.term}
                    </div>
                    <div className={isActive ? 'text-white' : 'text-blue-100 text-md'}>
                      {kt.definition}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        }

        if (step.type === 'numberSpotlight') {
          const valueActive = currentKey === `${baseKey}_value`;
          return (
            <div className="text-center py-6 animate-[fadeInUp_0.7s_ease-out]">
              <div 
                className={`text-4xl md:text-5xl font-black text-blue-700 mb-3 inline-block transition-all duration-700 ease-out ${
                  valueActive ? 'scale-125 drop-shadow-[0_0_25px_rgba(34,211,238,0.6)]' : 'scale-100 drop-shadow-none'
                }`}
              >
                <AnimatedStatValue value={step.value} start={scaled}/>
              </div>
              <div className="text-lg font-semibold text-blue-900 mb-4">{step.label}</div>
              <HighlightedText
                text={step.context}
                currentTime={currentTime}
                duration={duration}
                isSpeaking={isSpeaking}
                isActive={currentKey === baseKey}
                className="text-lg text-black leading-relaxed max-w-xl mx-auto"
              />
            </div>
          );
        }
        
        if (step.type === 'predictThen') {
          return (
            <div className="text-center py-4">
              <HighlightedText
                text={step.question}
                currentTime={currentTime}
                duration={duration}
                isSpeaking={isSpeaking}
                isActive={currentKey === `${baseKey}_question`}
                className="text-xl font-semibold text-black mb-6"
              />
              {!revealed ? (
                <button
                  onClick={() => {
                    setRevealed(true);
                    const aKey = `${baseKey}_answer`;
                    const rKey = `${baseKey}_reveal`;
                    play(audioUrls[aKey], aKey, '', () => {
                      play(audioUrls[rKey], rKey, step.reveal, () => autoAdvanceFrom(activeSectionIndex, microStep));
                    });
                  }}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors"
                >
                  Reveal the answer →
                </button>
              ) : (
                <div className="animate-[fadeIn_0.4s_ease-out]">
                  <div className="text-4xl font-black text-blue-700 mb-3">{step.answer}</div>
                  <HighlightedText
                    text={step.reveal}
                    currentTime={currentTime}
                    duration={duration}
                    isSpeaking={isSpeaking}
                    isActive={currentKey === `${baseKey}_reveal`}
                    className="text-lg text-black leading-relaxed max-w-xl mx-auto"
                  />
                </div>
              )}
            </div>
          );
        }

        if (step.type === 'imageFocus') {
          return (
            <div className="animate-[fadeInUp_0.7s_ease-out]">
              <div className="text-sm font-semibold text-cyan-700 mb-2">👀 Look at the image</div>
              <HighlightedText
                text={step.text}
                currentTime={currentTime}
                duration={duration}
                isSpeaking={isSpeaking}
                isActive={currentKey === baseKey}
                className="text-xl text-black leading-relaxed"
              />
            </div>
          );
        }
      
        if (step.type === 'checkYourself') {
          const isCorrect = checkAnswer === step.isTrue;
          return (
            <div className="text-center py-4">
              <p className="text-xl font-semibold text-black mb-6">{step.statement}</p>
              {checkAnswer === null ? (
                <div className="flex gap-4 justify-center">
                  {[true, false].map((val) => (
                    <button
                      key={String(val)}
                      onClick={() => {
                        setCheckAnswer(val);
                        const fKey = `${baseKey}_feedback`;
                        play(audioUrls[fKey], fKey, '', () => autoAdvanceFrom(activeSectionIndex, microStep));
                      }}
                      className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors"
                    >
                      {val ? 'True' : 'False'}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="animate-[fadeIn_0.4s_ease-out]">
                  <div className={`text-2xl font-bold mb-3 ${isCorrect ? 'text-green-600' : 'text-red-600'}`}>
                    {isCorrect ? '✓ Correct' : '✗ Not quite'}
                  </div>
                  <p className="text-lg text-black leading-relaxed max-w-xl mx-auto">{step.feedback}</p>
                </div>
              )}
            </div>
          );
        }
          
        const isExample = step.type === 'example';
    
        return (
            <div className={isExample ? 'bg-amber-900/40 rounded-xl p-5 border border-amber-500/40' : undefined}>
              <HighlightedText
                text={step.text}
                currentTime={currentTime}
                duration={duration}
                isSpeaking={isSpeaking}
                isActive={currentKey === baseKey}
                className={`text-xl leading-relaxed mb-4 ${isExample ? 'text-amber-100' : 'text-black'}`}
              />
              {step.type === 'overview' && step.stats?.length? (
                <div className={`grid gap-4 ${step.stats.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {step.stats.map((stat, idx) => {
                const isActive = currentKey === `${baseKey}_fact${idx}`;
                return (
                  <div 
                    key={idx} 
                    className={`rounded-xl p-5 text-center border transition-all duration-300 ${
                      isActive
                        ? 'bg-blue-300 border-cyan-400 ring-2 ring-cyan-300 scale-105 shadow-lg'
                        : 'bg-blue-600/50 border-cyan-500/30'
                    }`}
                  >
                    <div className="text-2xl font-bold text-blue-800 mb-1"><AnimatedStatValue value={stat.value}/></div>
                    <div className="text-base text-black">{stat.label}</div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      );
    })()}
      {devMode && (
        <>
          <div className="flex justify-center mb-3">
            <button
              onClick={() => playMicroStepAudio(activeSectionIndex, microStep, null)}
              className="flex items-center gap-2 px-4 py-2 mt-4 rounded-full bg-blue-600/90 hover:bg-blue-400/90 text-white text-sm font-medium transition-colors"
            >
              🔁 Replay
            </button>
          </div>
      
          {/* Mini-slideshow navigation — dev mode only */}
          <div className="flex items-center justify-between mt-5">
            <button
              onClick={prevMicroStep}
              disabled={microStep === 0}
              className="px-3 py-2 rounded-lg bg-blue-800/70 hover:bg-blue-700/80 disabled:opacity-30 text-white text-sm transition-colors"
            >
              ←
            </button>
    
            <div className="flex gap-2">
              {microSteps.map((step, idx) => (
                <button
                  key={idx}
                  onClick={() => goToMicroStep(idx)}
                  title={step.label}
                  className={`w-2.5 h-2.5 rounded-full transition-colors ${
                    idx === microStep ? 'bg-cyan-500' : 'bg-blue-700/60 hover:bg-blue-500/70'
                  }`}
                />
              ))}
            </div>
        
            <button
              onClick={nextMicroStep}
              disabled={microStep === microSteps.length - 1}
              className="px-3 py-2 rounded-lg bg-blue-800/50 hover:bg-blue-700/60 disabled:opacity-30 text-white text-sm transition-colors"
            >
              →
            </button>
          </div>
        
          <p className="text-center text-xs text-blue-700/80 mt-2">{microSteps[microStep]?.label}</p>
        </>
      )}
    </div>
  );
}

/* ============================================================================
 * LAYOUT TEMPLATES
 * ========================================================================== */
function ClassicLayout(props: {
  currentSection: SectionWithBreakdown;
  activeSection: number;
  totalSections: number;
  activeSectionIndex: number;
  microStep: number;
  microSteps: MicroStep[];
  goToMicroStep: (i: number) => void;
  nextMicroStep: () => void;
  prevMicroStep: () => void;
  currentTime: number;
  duration: number;
  isSpeaking: boolean;
  showQuiz: boolean;
  handleQuizContinue: () => void;
  currentKey: string | null;
  playMicroStepAudio: (sectionIndex: number, stepIndex: number, transitionType: 'means' | 'analogy' | null) => void;
  autoAdvanceFrom: (sectionIndex: number, fromStep: number) => void;
  audioUrls: Record<string, string>;
  play: (url: string | undefined, key: string, text?: string, onComplete?: () => void) => void;
  devMode: boolean;
}) {
  return (
    <div className="bg-white/5 backdrop-blur-md rounded-3xl border border-white-500/30 shadow-2xl overflow-hidden">
      <div className="grid md:grid-cols-2 gap-0">
        <SectionImageBlock
          currentSection={props.currentSection}
          activeSection={props.activeSection}
          totalSections={props.totalSections}
        />
        <div className="p-8 md:p-12 flex flex-col justify-center bg-gradient-to-br from-mist-400/50 to-mist-500/50">
          <MiniSlideshowBlock
            currentSection={props.currentSection}
            activeSectionIndex={props.activeSectionIndex}
            microStep={props.microStep}
            microSteps={props.microSteps}
            goToMicroStep={props.goToMicroStep}
            nextMicroStep={props.nextMicroStep}
            prevMicroStep={props.prevMicroStep}
            showQuiz={props.showQuiz}
            handleQuizContinue={props.handleQuizContinue}
            currentKey={props.currentKey}
            currentTime={props.currentTime}
            duration={props.duration}
            isSpeaking={props.isSpeaking}
            playMicroStepAudio={props.playMicroStepAudio}
            autoAdvanceFrom={props.autoAdvanceFrom}
            audioUrls={props.audioUrls}
            play={props.play}
            devMode={props.devMode}
          />
        </div>
      </div>
    </div>
  );
}

function SplitLayout(props: {
  currentSection: SectionWithBreakdown;
  activeSection: number;
  totalSections: number;
  activeSectionIndex: number;
  microStep: number;
  microSteps: MicroStep[];
  goToMicroStep: (i: number) => void;
  nextMicroStep: () => void;
  prevMicroStep: () => void;
  currentKey: string | null;
  currentTime: number;
  duration: number;
  isSpeaking: boolean;
  showQuiz: boolean;
  handleQuizContinue: () => void;
  playMicroStepAudio: (sectionIndex: number, stepIndex: number, transitionType: 'means' | 'analogy' | null) => void;
  autoAdvanceFrom: (sectionIndex: number, fromStep: number) => void;
  audioUrls: Record<string, string>;
  play: (url: string | undefined, key: string, text?: string, onComplete?: () => void) => void;
  devMode: boolean;
}) {
  return (
    <div className="bg-white/5 backdrop-blur-md rounded-3xl border border-white-500/30 shadow-2xl overflow-hidden">
      <div className="grid md:grid-cols-2 gap-0 min-h-[600px]">
        {/* Left: mini-slideshow, full height */}
        <div className="p-8 md:p-12 flex flex-col justify-center bg-gradient-to-br from-mist-400/50 to-mist-500/50">
          <MiniSlideshowBlock
            currentSection={props.currentSection}
            activeSectionIndex={props.activeSectionIndex}
            microStep={props.microStep}
            microSteps={props.microSteps}
            goToMicroStep={props.goToMicroStep}
            nextMicroStep={props.nextMicroStep}
            prevMicroStep={props.prevMicroStep}
            showQuiz={props.showQuiz}
            handleQuizContinue={props.handleQuizContinue}
            currentKey={props.currentKey}
            currentTime={props.currentTime}
            duration={props.duration}
            isSpeaking={props.isSpeaking}
            playMicroStepAudio={props.playMicroStepAudio}
            autoAdvanceFrom={props.autoAdvanceFrom}
            audioUrls={props.audioUrls}
            play={props.play}
            devMode={props.devMode}
          />
        </div>

        {/* Right: image on top, transcript below, stacked */}
        <div className="grid md:grid-cols-1 gap-0 min-h-[600px]">
          <SectionImageBlock
            currentSection={props.currentSection}
            activeSection={props.activeSection}
            totalSections={props.totalSections}
          />
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * QUIZ + REVIEW
 * ========================================================================== */
function QuizSlide({
  quiz,
  onContinue,
  onReview,
  onSubmitResult,
}: {
  quiz: { question: string; options: string[]; correctAnswer: number }[];
  onContinue: () => void;
  onReview: () => void;
  onSubmitResult: ( passed: boolean, missed: { index: number; question: string; options: string[]; correctAnswer: number; userAnswer: number | null; explanation: string }[]) => void;
}) {
  const [answers, setAnswers] = useState<(number | null)[]>(quiz.map(() => null));
  const [submitted, setSubmitted] = useState(false);

  const selectAnswer = (qIdx: number, optIdx: number) => {
    if (submitted) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[qIdx] = optIdx;
      return next;
    });
  };

  const allAnswered = answers.every((a) => a !== null);
  const score = quiz.reduce((total, q, i) => (answers[i] === q.correctAnswer ? total + 1 : total), 0);

  const handleSubmit = () => {
    setSubmitted(true);
    const passed = score === quiz.length;
    const missed = quiz
      .map((q, i) => ({ ...q, index: i, userAnswer: answers[i] }))
      .filter((q, i) => answers[i] !== q.correctAnswer);
    onSubmitResult(passed, missed);
  };
  
  return (
    <div className="backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-mist-400/70 via-mist-300/70 to-mist-400/70 rounded-3xl max-w-2xl w-full max-h-[85vh] overflow-y-auto border border-white/30 shadow-2xl p-8">
        <h3 className="text-2xl font-bold text-black mb-1">Quick Check</h3>
        <p className="text-black text-sm mb-6">Answer to continue</p>

        <div className="space-y-6">
          {quiz.map((q, qIdx) => (
            <div key={qIdx} className="bg-gradient-to-br from-mauve-300/30 to-mauve-500/30 rounded-2xl p-5 border border-white/20">
              <p className="text-black font-semibold mb-4">
                {qIdx + 1}. {q.question}
              </p>
              <div className="space-y-2">
                {q.options.map((opt, optIdx) => {
                  const isSelected = answers[qIdx] === optIdx;
                  const isCorrect = optIdx === q.correctAnswer;
                  const showResult = submitted;

                  let stateClasses = 'border-white/30 bg-mist-200/30 hover:border-black/20 hover:bg-mist-400/40';
                  if (showResult && isCorrect) {
                    stateClasses = 'border-green-500 bg-green-900/30';
                  } else if (showResult && isSelected && !isCorrect) {
                    stateClasses = 'border-red-500 bg-red-900/30';
                  } else if (isSelected) {
                    stateClasses = 'border-white/70 bg-mist-500/50';
                  }

                  return (
                    <button
                      key={optIdx}
                      onClick={() => selectAnswer(qIdx, optIdx)}
                      disabled={submitted}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition-colors text-black ${stateClasses}`}
                    >
                      {opt}
                      {showResult && isCorrect && <span className="ml-2">✓</span>}
                      {showResult && isSelected && !isCorrect && <span className="ml-2">✗</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between">
          {submitted ? (
            <>
              <p className="text-cyan-400 font-semibold">
                Score: {score} / {quiz.length}
              </p>
              {score === quiz.length ? (
                <button
                  onClick={onContinue}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors"
                >
                  Continue →
                </button>
              ) : (
                <button
                  onClick={onReview}
                  className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold transition-colors"
                >
                  Review →
                </button>
              )}
            </>
          ) : (
              <button
                onClick={handleSubmit}
                disabled={!allAnswered}
                className="ml-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-colors"
              >
                Submit
              </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewSlide({
  missedQuestions,
  section,
  onContinue,
  currentKey,
}: {
  missedQuestions: { index: number; question: string; options: string[]; correctAnswer: number; userAnswer: number | null; explanation: string }[];
  section: SectionWithBreakdown;
  onContinue: () => void;
  currentKey: string | null;
}) {
  return (
    <div className="bg-gradient-to-br from-mist-400 via-mist-300 to-mist-400 rounded-3xl border border-slate-200 shadow-2xl p-8 max-w-2xl mx-auto text-center">
      <h3 className="text-2xl font-bold text-slate-900 mb-4">Let's Review</h3>
        
        <div className="space-y-5 mb-6">
          {missedQuestions.map((q, idx) => {
            const isActive = currentKey?.endsWith(`_review_q${q.index}`) ?? false;
            return (
            <div key={idx} 
              className={`rounded-2xl p-5 border transition-all duration-300 ${
                isActive
                  ? 'bg-blue-300 border-cyan-400 ring-2 ring-cyan-300 scale-105 shadow-lg'
                  : 'bg-red-50 border-red-200'
              }`}
            >
              <p className="text-slate-900 font-semibold mb-2">{q.question}</p>
              <p className="text-red-600 text-sm mb-1">
                You answered: {q.userAnswer !== null ? q.options[q.userAnswer] : '(no answer)'}
              </p>
              <p className="text-green-700 text-sm font-medium">
                Correct answer: {q.options[q.correctAnswer]}
              </p>
              <div className="bg-blue-50 rounded-xl p-3 border border-blue-200">
                <p className="text-blue-900 text-sm">{q.explanation}</p>
              </div>
            </div>
          );
        })}
        </div>
      
      <div className="flex justify-end">
        <button
          onClick={onContinue}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

/* ============================================================================
 * MAIN COMPONENT
 * ========================================================================== */
export default function AIPresentation() {
  /* ---------------------------------------------------------------- state */

  // Content loading
  const [sections, setSections] = useState<SectionWithBreakdown[]>([]);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [isContentLoading, setIsContentLoading] = useState(true);
  const [loadingPhase, setLoadingPhase] = useState<'content' | 'audio'>('content');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [introText, setIntroText] = useState('');
  const [inIntro, setInIntro] = useState(false);

  // Navigation
  const [selectedTemplate, setSelectedTemplate] = useState<'classic' | 'split' | null>('classic');
  const [activeSection, setActiveSection] = useState(0);
  const [microStep, setMicroStep] = useState(0);
  const [showConclusion, setShowConclusion] = useState(false);

  // Quiz / review
  const [showQuiz, setShowQuiz] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [completedQuizzes, setCompletedQuizzes] = useState<Set<number>>(new Set());
  const [sectionScores, setSectionScores] = useState<Record<number, number>>({});
  const [missedQuestions, setMissedQuestions] = useState<{ index: number; question: string; options: string[]; correctAnswer: number; userAnswer: number | null; explanation: string; }[]>([]);

  // UI
  const [showChat, setShowChat] = useState(false);
  const [isNarrating, setIsNarrating] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraChoiceMade, setCameraChoiceMade] = useState(true);
  const [inConversation, setInConversation] = useState(false);
  const [started, setStarted] = useState(false);
  const [devMode, setDevMode] = useState(false);
  
  // Refs
  const keyTermsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const presenceAudioRef = useRef<HTMLAudioElement | null>(null);
  const firstRunRef = useRef(true);
  const resumeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const interruptedRef = useRef<{ type: 'intro'; time: number } | { type: 'section'; section: number; step: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevPresentRef = useRef(true);
  
  /* ---------------------------------------------------------- hook calls */
  const currentSection = sections[activeSection];

  const { play, pause, resume, stop, isSpeaking, isPaused, currentKey, currentText, currentTime, duration } = useAudioPlayer();

  const { enqueue, stopSpeaking, isSpeaking: isChatSpeaking, beginStream, endStream } = useSpeechQueue();
  
  const { messages, isLoading, input, setInput, sendMessage } = useAIChat(currentSection, missedQuestions, enqueue, beginStream, endStream);

  const presentationStarted = !!selectedTemplate && !showConclusion;
  const bargeInActive = isChatSpeaking || inConversation;
  
  const { status: micStatus, toggleMic } = useVoiceInput(
    (text) => {
      setShowChat(true);
      handleSendMessage(text);
    },
    () => {
      if (isChatSpeaking) {
        interruptedRef.current = null;
      } else if (isSpeaking && !inIntro && !showQuiz && !showReview && !showConclusion) {
        interruptedRef.current = { section: activeSection, step: microStep };
      }
      stop();
      stopSpeaking();
    },
    bargeInActive
  );

  const { present, error } = useFacePresence(cameraEnabled);

  const handleHandRaised = () => {
     console.log('handleHandRaised called, inIntro:', inIntro);
     if (inIntro) {
      console.log('blocked: in intro, showing notice');
      showNotice("Can't raise your hand during the introduction");
      return;
    }
    if (isChatSpeaking || showQuiz || showReview || showConclusion) {
      console.log('blocked by state guard', { isChatSpeaking, showQuiz, showReview, showConclusion });
      return;
    }
    if (isSpeaking && !inIntro) {
      interruptedRef.current = { section: activeSection, step: microStep };
    }
    stop();
    play(audioUrls['handRaiseCue'], 'handRaiseCue', '', () => {
      if (micStatus === 'idle') toggleMic();
    });
  };
  
  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 2500);
  };

  const { ready: handRaiseReady, error: handRaiseError } = useHandRaise(cameraEnabled, handleHandRaised);
  
  /* ----------------------------------------------------- audio handlers */
  const playMicroStepAudio = (sectionIndex: number, stepIndex: number, transitionType: 'means' | 'analogy' | null) => {
    const section = sections[sectionIndex];
    const step = section.steps[stepIndex];
    const text = getMicroStepText(section, stepIndex);
  
    const playActualStep = () => {
      const step = section.steps[stepIndex];
      if (!step) return;
      const baseKey = `section${sectionIndex}_step${stepIndex}`;
      console.log('PLAYING STEP:', { sectionIndex, stepIndex, type: step.type, baseKey, urlExists: !!audioUrls[baseKey] });
      // Overview with fun facts — content, then each fact clip in sequence
      if (step.type === 'overview' && step.stats?.length) {
        const factKeys = step.stats.map((_, f) => `${baseKey}_fact${f}`);
        const chain = (idx: number): (() => void) => () => {
          if (idx >= factKeys.length) { 
            autoAdvanceFrom(sectionIndex, stepIndex); 
            return; }
          play(audioUrls[factKeys[idx]], factKeys[idx], '', chain(idx + 1));
        };
        play(audioUrls[baseKey], baseKey, step.text, chain(0));
        return;
      }

      // Key terms — shared intro, then ordinal + per-term audio for each term
      if (step.type === 'keyTerms') {
        const terms = step.terms;
        const chainTerm = (t: number): (() => void) => () => {
          if (t >= terms.length) {
            autoAdvanceFrom(sectionIndex, stepIndex);
            return;
          }
          const ordinalKey = `ordinal${t}`;
          const termKey = `section${sectionIndex}_keyterm${t}`;
          play(audioUrls[ordinalKey], termKey, '', () => {
            play(audioUrls[termKey], termKey, '', chainTerm(t + 1));
          });
        };
        play(audioUrls['keytermIntro'], 'keytermIntro', '', chainTerm(0));
        return;
      }

      if (step.type === 'predictThen') {
        const qKey = `${baseKey}_question`;
        play(audioUrls[qKey], qKey, ''); // no onComplete — waits for user to reveal
        return;
      }

      if (step.type === 'checkYourself') {
        const sKey = `${baseKey}_statement`;
        play(audioUrls[sKey], sKey, ''); // no onComplete — waits for user to answer
        return;
      }

      if (step.type === 'numberSpotlight') {
        const valueKey = `${baseKey}_value`;
        play(audioUrls[valueKey], valueKey, '', () => {
          play(audioUrls[baseKey], baseKey, step.context, () => {
            autoAdvanceFrom(sectionIndex, stepIndex);
          });
        });
        return;
      }
      
      // Simple / example / anything else with plain text
      if (step.text) {
        play(audioUrls[baseKey], baseKey, getMicroStepText(section, stepIndex), () => {
          autoAdvanceFrom(sectionIndex, stepIndex);
        });
      } else {
        autoAdvanceFrom(sectionIndex, stepIndex);
      }
    };
    
    if (transitionType === 'means') {
      const idx = Math.floor(Math.random() * 3);
      const key = `imbetween${idx}`;
      play(audioUrls[key], key, '', playActualStep);
    } else if (transitionType === 'analogy') {
      const idx = Math.floor(Math.random() * 3);
      const key = `transition${idx}`;
      play(audioUrls[key], key, '', playActualStep);
    } else {
      playActualStep();
    }
  };

  const playReviewAudio = (sectionIndex: number, wrongIndices: number[]) => {
    if (wrongIndices.length === 0) return;
  
    const introKey =
      wrongIndices.length === 1 ? "review_intro_one" : "review_intro_some";
  
    const chain = (i: number) => {
      if (i >= wrongIndices.length) {
        play(audioUrls["review_outro"], "review_outro", "", () => {});
        return;
      }
      const key = `section${sectionIndex}_review_q${wrongIndices[i]}`;
      play(audioUrls[key], key, "", () => chain(i + 1));
    };
  
    play(audioUrls[introKey], introKey, "", () => chain(0));
  };

  const playPresenceCue = (
    key: 'presence_away' | 'presence_back',
    onDone?: () => void
  ) => {
    const url = audioUrls[key];
    if (!url) {
      onDone?.();
      return;
    }
    presenceAudioRef.current?.pause();
    const a = new Audio(url);
    presenceAudioRef.current = a;
    a.onended = () => onDone?.();
    a.onerror = () => onDone?.();
    a.play().catch(() => {});
  };
  
  const narrateSection = (index: number) => {
    setInIntro(false); // <-- add this — ensures inIntro can never get stuck true once a real section starts
    if (index < sections.length) {
      setMicroStep(0);
      playMicroStepAudio(index, 0, null);
      setIsNarrating(true);
      setShowConclusion(false);
    } else {
      setShowConclusion(true);
      setIsNarrating(true);
      playConclusion();
    }
  };

  const playIntroduction = (template: 'classic' | 'split') => {
    setInIntro(true);
    play(audioUrls['intro'], 'intro', introText, () => {
      const layoutKey = `layout_${template}`;
      play(audioUrls[layoutKey], layoutKey, '', () => {
        setInIntro(false);
        narrateSection(0);
      });
    });
    setIsNarrating(true);
  };

  const resumeIntro = (time: number) => {
    setInIntro(true);
    play(audioUrls['intro'], 'intro', introText, () => {
      const layoutKey = `layout_${selectedTemplate}`;
      play(audioUrls[layoutKey], layoutKey, '', () => {
        setInIntro(false);
        narrateSection(0);
      });
    }, time);
  };

  const handleStart = () => {
    setStarted(true);
    setActiveSection(0);
    setShowConclusion(false);
    playIntroduction('classic');
  };
  
  /* ------------------------------------------- micro-step nav handlers */
  const goToMicroStep = (index: number) => {
    console.log('goToMicroStep called with:', index, 'microSteps.length:', microSteps.length, 'activeSection:', activeSection);
    if (index < 0 || index >= microSteps.length) {
      console.log('REJECTED — out of bounds');
      return;
    }
    if (keyTermsTimerRef.current) clearTimeout(keyTermsTimerRef.current);
    setMicroStep(index);
    playMicroStepAudio(activeSection, index, null);
  };
  
  const nextMicroStep = () => goToMicroStep(microStep + 1);
  const prevMicroStep = () => goToMicroStep(microStep - 1);
  
  const autoAdvanceFrom = (sectionIndex: number, fromStep: number) => {
    const section = sections[sectionIndex]
    const steps = getMicroSteps(section, sectionIndex);
    if (fromStep < steps.length - 1) {
      const next = fromStep + 1;
      setMicroStep(next);

      const nextType = section.steps[next].type;
      const transition = nextType === 'simple' ? 'means' : nextType === 'example' ? 'analogy' : null;
      playMicroStepAudio(sectionIndex, next, transition);
    } else {
      play(audioUrls['wrapup'], 'wrapup', '');
    }
  };

  /* --------------------------------------------- section nav handlers */
  const handleCameraSelect = (useCamera: boolean) => {
    setCameraEnabled(useCamera);
    setCameraChoiceMade(true);
  };
  
  const handleTemplateSelect = (template: 'classic' | 'split') => {
    setSelectedTemplate(template);
    setActiveSection(0);
    setShowConclusion(false);
    playIntroduction(template);
  };

  const handleQuizContinue = () => {
    setCompletedQuizzes((prev) => new Set([...prev, activeSection]));
    setShowQuiz(false);
    
    if (activeSection < sections.length - 1) {
      stop();
      const newIndex = activeSection + 1;
      setActiveSection(newIndex);
      setShowConclusion(false);
      setTimeout(() => narrateSection(newIndex), 300);
    } else {
      stop();
      setShowConclusion(true);
      setTimeout(() => narrateSection(sections.length), 500);
    }
  };

  const handleSendMessage = (text: string) => {
    if (!text.trim()) return;
    setInConversation(true);
    if (isSpeaking && !inIntro && !showQuiz && !showReview && !showConclusion) {
      interruptedRef.current = { section: activeSection, step: microStep };
    }
    stop();
    sendMessage(text);
  };
  
  const handleQuizReview = () => {
    setShowQuiz(false);
    setShowReview(true);
  };
  
  const handleReviewContinue = () => {
    setShowReview(false);
    handleQuizContinue();
  };

  const nextSection = () => {
    setMicroStep(0);
    if (currentSection.quiz && currentSection.quiz.length === 1) {
      setShowQuiz(true);
    } else {
    handleQuizContinue(); // no valid quiz for this section — just advance
    }
  };

  const prevSection = () => {
    setMicroStep(0);
    if (activeSection > 0) {
      stop();
      const newIndex = activeSection - 1;
      setActiveSection(newIndex);
      setTimeout(() => narrateSection(newIndex), 300);
    }
  };
  
  const handleRestart = () => {
    stop();
    setActiveSection(0);
    setMicroStep(0);
    setShowConclusion(false);
    setShowQuiz(false);
    setSectionScores({});
    setCompletedQuizzes(new Set());
  };

  const playConclusion = () => {
    const chain = (i: number): (() => void) => () => {
      if (i >= sections.length) {
        play(audioUrls['conclusion_outro'], 'conclusion_outro', '');
        return;
      }
      const key = `section${i}_recap`;
      play(audioUrls[key], key, '', chain(i + 1));
    };
    play(audioUrls['conclusion_intro'], 'conclusion_intro', '', chain(0));
  };
  /* -------------------------------------------------------------- effects */
  // Fetch sections, then fetch pre-generated audio for them
  useEffect(() => {
    async function loadPresentation() {
      try {
        setLoadingPhase('content');
        const sectionsRes = await fetch('/api/slidesv2', { method: 'POST' });
        const sectionsData = await sectionsRes.json();

        if (sectionsData.error || !sectionsData.sections) {
          throw new Error(sectionsData.error || 'No sections returned');
        }

        setSections(sectionsData.sections);

        console.log('SECTIONS STRUCTURE:', sectionsData.sections.map((sec: any, i: number) => ({
          section: i,
          title: sec.title,
          steps: sec.steps.map((st: any, s: number) => ({ index: s, type: st.type })),
        })));
        
        const firstTopic = sectionsData.sections[0]?.title || 'the Blue Catfish invasion';
        const builtIntro = `Hello everyone, and welcome! I'm Professor Marine, and today we're diving into the story of the Blue Catfish invasion in the Chesapeake Bay. By the time we're done, you'll all be experts on the subject. Let's get right into the material — starting with our first topic: ${firstTopic}.`;
        setIntroText(builtIntro);

        setLoadingPhase('audio');
        const audioRes = await fetch('/api/slidesv2/audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sections: sectionsData.sections,
            intro: builtIntro,
          }),
        });
        const audioData = await audioRes.json();

        if (audioData.audioUrls) {
          setAudioUrls(audioData.audioUrls);
        }
      } catch (err: any) {
        console.error('Failed to load presentation:', err);
        setLoadError(err.message || 'Failed to load presentation content');
      } finally {
        setIsContentLoading(false);
      }
    }

    loadPresentation();
  }, []);

  // Reset to step 0 whenever the main section changes
  useEffect(() => {
    setMicroStep(0);
    stop();
  }, [activeSection]);

  // Clear the key-terms timer when leaving a section
  useEffect(() => {
    return () => {
      if (keyTermsTimerRef.current) clearTimeout(keyTermsTimerRef.current);
    };
  }, [activeSection]);
  
  // Scroll to bottom of chat
  useEffect(() => {
    if (!showChat) return;
    const el = messagesEndRef.current;
    if (!el || !el.isConnected) return;
    el.scrollIntoView({ behavior: 'smooth' });
  }, [messages, showChat]);

  // Narrate the review slide when it opens
  useEffect(() => {
    if (showReview) {
      playReviewAudio(activeSection, missedQuestions.map((q) => q.index));
    }
  }, [showReview]);

  // Pause narration when the viewer looks away
  useEffect(() => {
    if (!cameraEnabled) return;
    if (micStatus !== 'idle' || isChatSpeaking) return;
    if (firstRunRef.current) { firstRunRef.current = false; prevPresentRef.current = present; return; }

    if (present === prevPresentRef.current) return;
    prevPresentRef.current = present;
    
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
  
    if (!present) {
      pause(); 
      playPresenceCue('presence_away');
    } else {
      playPresenceCue('presence_back', () => { 
        if (!isChatSpeaking) resume();
      });
    }
  }, [present, cameraEnabled, isChatSpeaking]);

  useEffect(() => {
    if (isChatSpeaking) return;           // still answering
    if (micStatus !== 'idle') return;      // still listening/processing
    if (cameraEnabled && !present) return;  // user still away from camera         
    if (!interruptedRef.current) return;  // nothing was interrupted
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);  
    resumeTimerRef.current = setTimeout(() => {
      console.log('7s timer fired, resuming now');
      const pending = interruptedRef.current;
      if (!pending) {
        setInConversation(false);
        return;
      }
      interruptedRef.current = null;
      setInConversation(false);
      
      play(audioUrls['presence_back'], 'presence_back', '', () => {
        if (pending.type === 'intro') {
            resumeIntro(pending.time);
        } else {
          playMicroStepAudio(pending.section, pending.step, null);
        }  
      });
    }, 7000);
    
  return () => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
  };
}, [isChatSpeaking, cameraEnabled, present, micStatus]);
  
  /* -------------------------------------------------------- early returns */
  // Loading / error states before rendering the presentation
  if (isContentLoading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center text-black bg-mist-300 gap-4">
      <div className="text-2xl font-semibold">
        {loadingPhase === 'content' ? 'Writing your lecture...' : 'Recording narration...'}
      </div>
      <div className="text-sm text-slate-600">
        {loadingPhase === 'content'
          ? 'Generating lesson content for all sections'
          : 'Generating audio narration — this takes a moment'}
      </div>
    </div>
    );
  }

  if (loadError || sections.length === 0) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-xl text-white bg-slate-900 text-center p-8">
        Something went wrong loading this lesson: {loadError || 'No sections available'}. Please try refreshing.
      </div>
    );
  }

  if (!started) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-gradient-to-br from-mist-50 to-mist-400 p-8">
        <h1 className="text-4xl md:text-5xl font-bold text-black mb-4 text-center">{PRESENTATION.title}</h1>
        <p className="text-xl text-blue-600 mb-10 text-center">{PRESENTATION.subtitle}</p>
        <button
          onClick={handleStart}
          className="px-12 py-6 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white text-2xl font-bold rounded-full shadow-2xl transition-all"
        >
          ▶ Start Lesson
        </button>
      </div>
    );
  }
  /*
  if (!cameraChoiceMade) {
    return <CameraSelector onSelect={handleCameraSelect} />;
  }
  
  if (!selectedTemplate) {
    return <TemplateSelector onSelect={handleTemplateSelect} />;
  }   
  */

  /* ------------------------------------------------------ derived values */
  const microSteps = getMicroSteps(currentSection, activeSection);

  const flowSteps = sections.flatMap((_, idx) => [
    { type: 'section' as const, index: idx },
    { type: 'quiz' as const, index: idx },
  ]);

  const currentFlowIndex = flowSteps.findIndex(
    (step) => step.index === activeSection && step.type === (showQuiz ? 'quiz' : 'section')
  );

  /* ---------------------------------------------------------------- render */
  return (
    <div className="min-h-screen bg-gradient-to-br from-mist-400 via-mist-50 to-mist-400 flex flex-col">
      {/* Header */}
      <header className="bg-white/30 backdrop-blur-sm border-b border-grey-500/30 p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Professor Badge */}
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center">
              <span className="text-xl">👨‍🏫</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-black">
                {PRESENTATION.professor.name}
              </h1>
              <p className="text-xs text-cyan-600">
                {PRESENTATION.title}
              </p>
            </div>
          </div>

          {/*
          <div className="flex flex-col items-center gap-2 h-20 mt-[5px]">
            <button
              onClick={() => setCameraEnabled((v) => !v)}
              className="px-4 py-2 rounded-full bg-blue-600 text-white text-sm"
            >
              {cameraEnabled ? "Camera on" : "Enable camera"}
            </button>
            {cameraEnabled && (
              <div className="px-3 py-1 rounded-full text-xs font-semibold bg-white shadow">
                {error ? `⚠️ ${error}` : present ? "👤 Face detected" : "🚫 No face"}
              </div>
            )}
          </div>
          */}

          {devMode && (
            <div className="flex items-center gap-3">
              
              {isSpeaking && (
                <div className="flex items-center gap-2 bg-cyan-500/20 px-4 py-2 rounded-full">
                  <div className="flex gap-1">
                    {[...Array(3)].map((_, i) => (
                      <div 
                        key={i}
                        className="w-1 h-4 bg-cyan-400 rounded-full animate-pulse"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                  <span className="text-blue-700 text-sm font-medium">
                    {isPaused ? 'Paused' : 'Teaching...'}
                  </span>
                </div>
              )}
              
              
              <div className="flex items-center gap-2 bg-black/30 rounded-full px-4 py-2">
                <button
                  onClick={() => isSpeaking ? (isPaused ? resume() : pause()) : narrateSection(activeSection)}
                  className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition-colors shadow-lg"
                  title={isSpeaking ? (isPaused ? 'Resume' : 'Pause') : 'Play Narration'}
                >
                  {isSpeaking && !isPaused ? '⏸️' : '▶️'}
                </button>
                <button
                  onClick={stop}
                  disabled={!isSpeaking}
                  className="w-10 h-10 rounded-full bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white flex items-center justify-center transition-colors shadow-lg"
                  title="Stop"
                >
                  ⏹️
                </button>
              </div>
  
              
              <button
                onClick={() => setShowChat(!showChat)}
                className={`px-4 py-2 rounded-full font-semibold transition-colors ${
                  showChat 
                    ? 'bg-cyan-500 text-white' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                💬 Ask AI
              </button>

              
            </div>
          )}
          <button
            onClick={() => setDevMode((v) => !v)}
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              devMode ? 'bg-amber-500 text-white' : 'bg-slate-300 text-slate-700 hover:bg-slate-400'
            }`}
            title="Toggle navigation controls"
          >
            ⚙
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-8 bg-gradient-to-br from-mist-400/70 via-mist-300/70 to-mist-400/70">
        {showConclusion ? (
          <ConclusionScreen 
            onRestart={handleRestart}
            sectionScores={sectionScores}
            totalQuestions={sections.length * 1}
            sections={sections}
            currentKey={currentKey}
          />
        ) : (
        <div className="max-w-7xl w-full relative">
          {/* Progress Bar */}
          <div className="mb-8">
            <div className="flex justify-between text-black text-sm mb-2">
              <span>Section {activeSection + 1} of {sections.length}</span>
              <span>{Math.round(((activeSection + 1) / sections.length) * 100)}%</span>
            </div>
            <div className="h-2 bg-blue-900/50 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500"
                style={{ width: `${((activeSection + 1) / sections.length) * 100}%` }}
              />
            </div>
          </div>

          <Notice text={notice} />
          
          {showReview ? (
            <ReviewSlide
              missedQuestions={missedQuestions}
              section={currentSection}
              onContinue={handleReviewContinue}
              currentKey={currentKey}
            />
          ) : showQuiz ? (
            <QuizSlide 
              quiz={currentSection.quiz} 
              onContinue={handleQuizContinue} 
              onReview={handleQuizReview} 
              onSubmitResult={(passed, missed) => {
                const score = currentSection.quiz.length - missed.length;
                setSectionScores((prev) => ({ ...prev, [activeSection]: score }));
                setMissedQuestions(missed);
                if (passed) {
                  const key = `section${activeSection}_quizsuccess`;
                  play(audioUrls[key], key, '');
                } else {
                  play(audioUrls['quizFail'], 'quizFail', '');
                }
              }}
            /> 
          ) : selectedTemplate === 'classic' ? (
            <ClassicLayout
              currentSection={currentSection}
              activeSection={activeSection}
              totalSections={sections.length}
              activeSectionIndex={activeSection}
              microStep={microStep}
              microSteps={microSteps}
              goToMicroStep={goToMicroStep}
              nextMicroStep={nextMicroStep}
              prevMicroStep={prevMicroStep}
              currentKey={currentKey}
              currentTime={currentTime}
              duration={duration}
              isSpeaking={isSpeaking}
              showQuiz={showQuiz}
              handleQuizContinue={handleQuizContinue}
              playMicroStepAudio={playMicroStepAudio}
              autoAdvanceFrom={autoAdvanceFrom}
              audioUrls={audioUrls}
              play={play}
              devMode={devMode}
            />
          ) : (
            <SplitLayout
              currentSection={currentSection}
              activeSection={activeSection}
              totalSections={sections.length}
              activeSectionIndex={activeSection}
              microStep={microStep}
              microSteps={microSteps}
              goToMicroStep={goToMicroStep}
              nextMicroStep={nextMicroStep}
              prevMicroStep={prevMicroStep}
              currentKey={currentKey}
              currentTime={currentTime}
              duration={duration}
              isSpeaking={isSpeaking}
              showQuiz={showQuiz}
              handleQuizContinue={handleQuizContinue}
              playMicroStepAudio={playMicroStepAudio}
              autoAdvanceFrom={autoAdvanceFrom}
              audioUrls={audioUrls}
              play={play}
              devMode={devMode}
            />
          )}
          
            {/* Custom Keyframe Animations */}
            <style jsx>{`
              @keyframes slideInRight {
                from { opacity: 0; transform: translateX(30px); }
                to { opacity: 1; transform: translateX(0); }
              }
              @keyframes expandWidth {
                from { width: 0; }
                to { width: 4rem; }
              }
              @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
              }
              @keyframes fadeInUp {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
              }
              @keyframes slideUp {
                from { opacity: 0; transform: translateY(50px); }
                to { opacity: 1; transform: translateY(0); }
              }
            `}</style>
        
          {/* Navigation */}
          <div className="flex justify-between items-center mt-8">
            <button
              onClick={prevSection}
              disabled={activeSection === 0}
              className="px-8 py-4 bg-black/50 hover:bg-black/80 disabled:opacity-30 disabled:cursor-not-allowed text-white font-semibold rounded-full transition-colors flex items-center gap-2"
            >
              ← Previous
            </button>

            {devMode && (
              <div className="flex gap-2 flex-wrap justify-center max-w-md">
                {flowSteps.map((step, i) => {
                  const isActive = i === currentFlowIndex;
                  const isQuizDone = step.type === 'quiz' ? completedQuizzes.has(step.index) : true;
  
                  let dotClasses = 'transition-colors ';
  
                  if (step.type === 'section') {
                    dotClasses += `w-3 h-3 rounded-full ${isActive ? 'bg-cyan-500' : 'bg-blue-600 hover:bg-blue-400'}`;
                  } else {
                    dotClasses += `w-3 h-3 rotate-45 ${
                      !isQuizDone
                        ? 'bg-black/30 hover:bg-black/60'
                        : isActive
                        ? 'bg-cyan-500'
                        : 'bg-green-500 hover:bg-green-400'
                    }`;
                  }
                  
                  return (
                    <button
                      key={i}
                      title={step.type === 'quiz' ? `Quiz ${step.index + 1}` : `Section ${step.index + 1}`}
                      onClick={() => {
                        stop();
                        setActiveSection(step.index);
                        if (step.type === 'quiz') {
                          setShowQuiz(true);
                        } else {
                          setShowQuiz(false);
                          setTimeout(() => narrateSection(step.index), 300);
                        }
                      }}
                      className={dotClasses}
                    />
                  );
                })}
              </div>
            )}

            <button
              onClick={nextSection}
              className="px-8 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold rounded-full transition-colors flex items-center gap-2"
            >
              {activeSection < sections.length - 1 ? 'Next →' : 'Finish Lesson →'}
            </button>
          </div>
        </div>
      )}
      </main>

      {/* AI Chat Panel */}
      {showChat && (
        <div className="fixed right-6 bottom-6 w-[26rem] max-h-[70vh] bg-mist-500/95 backdrop-blur-lg rounded-2xl shadow-2xl border border-blue-500/30 flex flex-col overflow-hidden z-50">
          {/* Chat Header */}
          <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="text-3xl">🦀</div>
              <div>
                <h3 className="font-bold text-white">Ask Finley</h3>
                <p className="text-xs text-blue-200">Your AI Blue Catfish Expert</p>
              </div>
            </div>
            <button
              onClick={() => setShowChat(false)}
              className="text-white hover:bg-white/20 rounded-full w-8 h-8 flex items-center justify-center"
            >
              ✕
            </button>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto py-4 px-6 space-y-3">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : 'bg-mist-300 text-black rounded-bl-none'
                  }`}
                >
                  {msg.text ? (
                    <p className="text-sm">{msg.text}</p>
                  ) : (
                    <span className="flex gap-1 py-1">
                      <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" />
                      <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-100" />
                      <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-200" />
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          
          {/* Chat Input */}
          <div className="p-4 border-t border-white">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSendMessage(input)}
                placeholder="Ask about Blue Catfish..."
                className="flex-1 bg-mist-300 text-black rounded-full px-[21px] py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isLoading}
              />
              <button
                onClick={() => handleSendMessage(input)}
                disabled={isLoading || !input.trim()}
                className="w-10 h-10 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-full flex items-center justify-center transition-colors"
              >
                →
              </button>

              {!cameraEnabled && (
                <button
                  onClick={toggleMic}
                  disabled={isLoading}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    micStatus === "listening"
                      ? "bg-red-600 animate-pulse text-white"
                      : micStatus === "processing"
                      ? "bg-gray-500 text-white"
                      : "bg-blue-600 hover:bg-blue-700 text-white"
                  }`}
                  title={micStatus === "listening" ? "Stop recording" : "Speak"}
                >
                  {micStatus === "processing" ? "…" : "🎤"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Source Attribution */}
      <footer className="text-center py-4 text-blue-700 text-sm">
        <p>
          Source: University of Maryland Extension - 
          <a 
            href="https://extension.umd.edu/resource/chesapeake-bay-blue-catfish-invasive-delicious-and-nutritious/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="underline hover:text-cyan-300"
          >
            Chesapeake Bay Blue Catfish Factsheet
          </a>
        </p>
      </footer>
    </div>
  );
}
