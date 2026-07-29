'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';

// ===================== TYPES =====================
interface Message {
  role: 'user' | 'ai';
  text: string;
}

interface SectionWithBreakdown {
  title: string;
  icon: string;
  image: string;
  content: string;
  stats: { value: string; label: string }[];
  breakdown: {
    simple: string;
    keyTerms: { term: string; definition: string }[];
    realWorldExample: string;
  quiz: { question: string; options: string[]; correctAnswer: number; explanation: string }[];
  };
}

// ===================== STATIC INTRO/CONCLUSION SCRIPTS =====================
const LECTURE_SCRIPTS = {
  conclusion: `So to summarize what we've learned today: Blue Catfish are an invasive species that were introduced for recreational fishing but have since become a major ecological threat. They eat enormous quantities of native species, make up the majority of fish biomass in many rivers, and have no natural predators to keep their numbers in check. However, there's hope. By commercial harvesting and encouraging consumption of Blue Catfish, we can reduce their population while enjoying a sustainable and delicious food source. Thank you for joining me in this presentation about the Chesapeake Bay's Blue Catfish invasion. Remember, sometimes the solution to an ecological problem can be found on our dinner plates.`
};

// ===================== STATIC PRESENTATION SHELL =====================
// Sections are no longer hardcoded — they're fetched from /api/slides2 on load.
const PRESENTATION = {
  title: "Why Are Blue Catfish Invasive?",
  subtitle: "Understanding the Chesapeake Bay Crisis",
  professor: {
    name: "Professor Marine",
    title: "Marine Biology & Conservation"
  }
};

// ===================== AUDIO PLAYER HOOK (updated) =====================
const useAudioPlayer = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [currentText, setCurrentText] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = useCallback((url: string | undefined, key: string, text: string = '', onComplete?: () => void) => {
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
    setCurrentTime(0);
    setDuration(0);

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
      audioRef.current.play();
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

  return { play, pause, resume, stop, isSpeaking, isPaused, currentKey, currentText, currentTime, duration };
};

// ===================== MICRO-STEP (mini-slideshow) CONFIG =====================
type MicroStep = {
  label: string;
  audioKey: string | null;
};

function getMicroSteps(sectionIndex: number): MicroStep[] {
  return [
    { label: 'Overview', audioKey: `section${sectionIndex}_overview` },
    { label: 'Simple Explanation', audioKey: `section${sectionIndex}_simple` },
    { label: 'Key Terms', audioKey: null  },
    { label: 'Real World Example', audioKey: `section${sectionIndex}_example` },
  ];
}

function getMicroStepText(section: SectionWithBreakdown, stepIndex: number): string {
  switch (stepIndex) {
    case 0: {
      const statsLine = section.stats?.length === 2
        ? ` For example, ${section.stats[0].label} is ${section.stats[0].value}, and ${section.stats[1].label} is ${section.stats[1].value}.`
        : '';
      return `${section.content}${statsLine}`;
    }
    case 1: return section.breakdown.simple;
    case 2: return section.breakdown.keyTerms;
    case 3: return section.breakdown.realWorldExample;
    default: return '';
  }
}

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

function ReviewSlide({
  missedQuestions,
  section,
  onContinue,
}: {
  missedQuestions: { question: string; options: string[]; correctAnswer: number; userAnswer: number | null }[];
  section: SectionWithBreakdown;
  onContinue: () => void;
}) {
  return (
    <div className="bg-gradient-to-br from-mist-400 via-mist-300 to-mist-400 rounded-3xl border border-slate-200 shadow-2xl p-8 max-w-2xl mx-auto text-center">
      <h3 className="text-2xl font-bold text-slate-900 mb-4">Let's Review</h3>
        
        <div className="space-y-5 mb-6">
          {missedQuestions.map((q, idx) => (
            <div key={idx} className="bg-red-50 rounded-2xl p-5 border border-red-200">
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
          ))}
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

// ===================== AI CHAT HOOK =====================
const useAIChat = (currentSection: SectionWithBreakdown | undefined, missedQuestions: { question: string; options: string[]; correctAnswer: number; explanation: string }[]) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', text: `Good day! I'm ${PRESENTATION.professor.name}, and I'll be your guide through today's lecture on the Blue Catfish invasion in the Chesapeake Bay. Feel free to ask me any questions as we go through the material. What would you like to explore first?` }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState('');

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;
    const userMessage: Message = { role: 'user', text };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

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
          systemPrompt: `You are "${PRESENTATION.professor.name}", a university professor specializing in Marine Biology and Conservation. The student is currently viewing a slide titled "${currentSection.title}" which covers: ${currentSection.content} Answer questions with awareness of what they're currently looking at, and relate your answers back to this section when relevant, like a professor referencing the current lecture slide.`,
          conversation: messages.map(m => ({
            role: m.role === 'ai' ? 'assistant' : 'user',
            content: m.text,
          })),
        }),
      });

      const data = await response.json();

      if (data.reply) {
        setMessages(prev => [...prev, { role: 'ai', text: data.reply }]);
      } else {
        console.error('No reply in response:', data);
        setMessages(prev => [...prev, { role: 'ai', text: "Sorry, I couldn't generate a response. Please try again." }]);
      }
    } catch (err) {
      console.error('RAG chat failed:', err);
      setMessages(prev => [...prev, { role: 'ai', text: "Sorry, I'm having trouble responding right now. Please try again." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return { messages, isLoading, input, setInput, sendMessage };
};

// ===================== ANIMATED STAT VALUE =====================
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
        <p className="text-black text-sm mb-6">Answer both questions to continue</p>

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
                onClick={() => {
                  setSubmitted(true);
                  const missed = quiz
                    .map((q, i) => ({ ...q, userAnswer: answers[i] }))
                    .filter((q, i) => answers[i] !== q.correctAnswer);
                  onSubmitResult(score === quiz.length, missed);
                }}
                disabled={!allAnswered}
                className="ml-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-colors"
              >
                Submit
              </button>
          )}
        </div>
      </div>
    </div>,
  );
}

// ===================== TEMPLATE SELECTOR =====================
// Shown as the very first screen, before the intro.
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
                {/* Animated Background Elements */}
                <div className="absolute inset-0 overflow-hidden">
                  {/* Floating Bubbles */}
                  <div className="absolute w-4 h-4 bg-cyan-400/20 rounded-full animate-ping" style={{top: '20%', left: '10%', animationDuration: '3s'}} />
                  <div className="absolute w-6 h-6 bg-blue-400/20 rounded-full animate-ping" style={{top: '60%', left: '80%', animationDuration: '4s', animationDelay: '1s'}} />
                  <div className="absolute w-3 h-3 bg-cyan-300/30 rounded-full animate-ping" style={{top: '40%', left: '50%', animationDuration: '2.5s', animationDelay: '0.5s'}} />
                  
                  {/* Swimming Fish Animation */}
                  <div className="absolute animate-[swim_8s_ease-in-out_infinite]" style={{top: '30%', left: '-20%'}}>
                    <svg width="80" height="50" viewBox="0 0 80 50" className="drop-shadow-lg">
                      <path d="M60 25 Q70 15 80 25 Q70 35 60 25 M0 25 L45 10 L45 40 Z" fill="currentColor" className="text-cyan-300 opacity-80"/>
                      <circle cx="50" r="3" fill="white"/>
                    </svg>
                  </div>
                  
                  {/* Second Fish */}
                  <div className="absolute animate-[swim2_10s_ease-in-out_infinite]" style={{top: '65%', right: '-20%'}}>
                    <svg width="60" height="40" viewBox="0 0 80 50" className="drop-shadow-lg">
                      <path d="M60 25 Q70 15 80 25 Q70 35 60 25 M0 25 L45 10 L45 40 Z" fill="currentColor" className="text-blue-300 opacity-70"/>
                      <circle cx="50" r="2" fill="white"/>
                    </svg>
                  </div>
                </div>
                
                {/* Main Image */}
                {currentSection.image && (
                  <img 
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
                
                {/* Slide Counter Badge */}
                <div className="absolute top-4 left-4 bg-cyan-500/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg">
                  <span className="font-bold text-white">{activeSection + 1} / {totalSections}</span>
                </div>
                
                {/* Interactive Icon with Hover Effect */}
                <div className="absolute bottom-4 left-4 group cursor-pointer">
                  <div className="text-7xl drop-shadow-lg transition-transform duration-300 group-hover:scale-125 group-hover:rotate-12 animate-[float_3s_ease-in-out_infinite]">
                    {currentSection.icon}
                  </div>
                  <div className="absolute -bottom-8 left-0 bg-black/80 px-3 py-1 rounded text-sm text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    Click me!
                  </div>
                </div>
                
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
                <div className="mt-6 pt-5 border-t border-blue-700/40">
                  {/* Step content */}
                  <div key={microStep} className="min-h-[160px] animate-[fadeIn_0.8s_ease-out]">
                    {microStep === 0 && (
                      <div>
                        <HighlightedText
                          text={currentSection.content}
                          currentTime={currentTime}
                          duration={duration}
                          isSpeaking={isSpeaking}
                          isActive={currentKey === `section${0}_overview` || currentKey?.endsWith('_overview')}
                          className="text-xl text-black leading-relaxed mb-4"
                        />
                        <div className="grid grid-cols-2 gap-4">
                          {currentSection.stats.map((stat, idx) => {
                            const factKey = idx === 0 ? '_fact1' : '_fact2';
                            const isActive = currentKey?.endsWith(factKey) ?? false;

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
                    </div>
                  )}
                    
                    {microStep === 1 && (
                      <div className="bg-blue-700/20 rounded-xl p-5 border border-blue-500/40">
                        <HighlightedText
                          text={currentSection.breakdown.simple}
                          currentTime={currentTime}
                          duration={duration}
                          isSpeaking={isSpeaking}
                          isActive={currentKey === `section${0}_simple` || currentKey?.endsWith('_simple')}
                          className="text-xl text-black leading-relaxed mb-4"
                        />
                      </div>
                    )}
                
                    {microStep === 2 && (
                      <div className="space-y-3">
                        {currentSection.breakdown.keyTerms.map((kt, idx) => {
                          const isActive = currentKey?.includes(`_keyterm${idx}`) ?? false;
                          return (
                            <div
                              key={idx}
                              className={`rounded-xl p-5 border transition-all duration-300 ${
                                isActive
                                  ? 'bg-blue-300 border-cyan-400 ring-2 ring-cyan-300 scale-105 shadow-lg'
                                  : 'bg-blue-700/20 border-blue-600/40'
                              }`}
                            >
                              <div className="font-bold text-blue-800 mb-1 text-xl">{kt.term}</div>
                              <div className="text-black text-md">{kt.definition}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                
                    {microStep === 3 && (
                      <div className="bg-amber-900/30 rounded-xl p-5 border border-amber-700/40">
                        <HighlightedText
                          text={currentSection.breakdown.realWorldExample}
                          currentTime={currentTime}
                          duration={duration}
                          isSpeaking={isSpeaking}
                          isActive={currentKey === `section${0}_example` || currentKey?.endsWith('_example')}
                          className="text-xl text-black leading-relaxed mb-4"
                        />
                      </div>
                      )}
                  </div>

                  <div className="flex justify-center mb-3">
                    <button
                      onClick={() => playMicroStepAudio(activeSectionIndex, microStep, null)}
                      className="flex items-center gap-2 px-4 py-2 mt-4 rounded-full bg-blue-600/90 hover:bg-blue-400/90 text-white text-sm font-medium transition-colors"
                    >
                      🔁 Replay
                    </button>
                  </div>
                  
                  {/* Mini-slideshow navigation — always visible */}
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
                
                  <p className="text-center text-xs text-blue-700/80 mt-2">{microSteps[microStep].label}</p>
                </div>
                
            </div>
        );
      }

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
            />
          </div>
        </div>
      </div>
    );
  }
  // ===================== TEMPLATE 2: SPLIT (new layout) =====================
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

// ===================== MAIN COMPONENT =====================
export default function AIPresentation() {

  const [sections, setSections] = useState<SectionWithBreakdown[]>([]);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [isContentLoading, setIsContentLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState(0);
  const [showChat, setShowChat] = useState(false);
  const [isNarrating, setIsNarrating] = useState(false);
  const [showConclusion, setShowConclusion] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<'classic' | 'split' | null>(null);
  const [completedQuizzes, setCompletedQuizzes] = useState<Set<number>>(new Set());
  const [showReview, setShowReview] = useState(false);
  const [missedQuestions, setMissedQuestions] = useState<{ index: number; question: string; options: string[]; correctAnswer: number; userAnswer: number | null }[]>([]);
  const [loadingPhase, setLoadingPhase] = useState<'content' | 'audio'>('content');
  const [sectionScores, setSectionScores] = useState<Record<number, number>>({});
  const keyTermsTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  
  const handleRestart = () => {
    stop();
    setActiveSection(0);
    setMicroStep(0);
    setShowConclusion(false);
    setShowQuiz(false);
    setSectionScores({});
    setCompletedQuizzes(new Set());
  };

  const currentSection = sections[activeSection];

  const playMicroStepAudio = (sectionIndex: number, stepIndex: number, transitionType: 'means' | 'analogy' | null) => {
    const section = sections[sectionIndex];
    const steps = getMicroSteps(sectionIndex);
    const step = steps[stepIndex];
    const text = getMicroStepText(section, stepIndex);
  
    const playActualStep = () => {
      if (stepIndex === 0) {
        const overviewKey = `section${sectionIndex}_overview`;
        const fact1Key = `section${sectionIndex}_fact1`;
        const fact2Key = `section${sectionIndex}_fact2`;
        
        play(audioUrls[overviewKey], overviewKey, section.content, () => {
          play(audioUrls[fact1Key], fact1Key, '', () => {
            play(audioUrls[fact2Key], fact2Key, '', () => {
              autoAdvanceFrom(sectionIndex, 0);
            });
          });
        });
        return;
      }
      if (stepIndex === 2) {
        const termKey = (t: number) => `section${sectionIndex}_keyterm${t}`;
      
        play(audioUrls["keytermIntro"], "keytermIntro", "", () => {
          // ordinal audio is shared, but we pass a section-specific key so the card highlights
          play(audioUrls["ordinal0"], `${termKey(0)}_ord`, "", () => {
            play(audioUrls[termKey(0)], termKey(0), "", () => {
              play(audioUrls["ordinal1"], `${termKey(1)}_ord`, "", () => {
                play(audioUrls[termKey(1)], termKey(1), "", () => {
                  play(audioUrls["ordinal2"], `${termKey(2)}_ord`, "", () => {
                    play(audioUrls[termKey(2)], termKey(2), "", () => {
                      autoAdvanceFrom(sectionIndex, 2);
                    });
                  });
                });
              });
            });
          });
        });
        return;
      }
      if (step.audioKey) {
        play(audioUrls[step.audioKey], step.audioKey, text, () => {
          autoAdvanceFrom(sectionIndex, stepIndex);
        });
      } else {
        if (keyTermsTimerRef.current) clearTimeout(keyTermsTimerRef.current);
        keyTermsTimerRef.current = setTimeout(() => autoAdvanceFrom(sectionIndex, stepIndex), 8000);
      }
    };
  
    if (transitionType === 'means') {
      const idx = Math.floor(Math.random() * 3);
      const key = `transition${idx}`;
      play(audioUrls[key], key, '', playActualStep);
    } else if (transitionType === 'analogy') {
      const idx = Math.floor(Math.random() * 3);
      const key = `imbetween${idx}`;
      play(audioUrls[key], key, '', playActualStep);
    } else {
      playActualStep();
    }
  };
  
  const autoAdvanceFrom = (sectionIndex: number, fromStep: number) => {
    const steps = getMicroSteps(sectionIndex);
    if (fromStep < steps.length - 1) {
      const next = fromStep + 1;
      setMicroStep(next);

      if (fromStep === 0) {
        playMicroStepAudio(sectionIndex, next, 'means');
      } else if (fromStep === 2) {
        playMicroStepAudio(sectionIndex, next, 'analogy');
      } else {
        playMicroStepAudio(sectionIndex, next, null);
      }
    } else {
      play(audioUrls['wrapup'], 'wrapup', '');
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

  useEffect(() => {
    if (showReview) {
      playReviewAudio(activeSection, missedQuestions.map((q) => q.index));
    }
  }, [showReview]);
  
  const handleTemplateSelect = (template: 'classic' | 'split') => {
    setSelectedTemplate(template);
    setActiveSection(0);
    setShowConclusion(false);
    playIntroduction(template);
  };
  
  const flowSteps = sections.flatMap((_, idx) => [
    { type: 'section' as const, index: idx },
    { type: 'quiz' as const, index: idx },
  ]);

  const currentFlowIndex = flowSteps.findIndex(
    (step) => step.index === activeSection && step.type === (showQuiz ? 'quiz' : 'section')
  );

  const handleQuizReview = () => {
    setShowQuiz(false);
    setShowReview(true);
  };
  
  const handleReviewContinue = () => {
    setShowReview(false);
    handleQuizContinue();
  };
  
  const { play, pause, resume, stop, isSpeaking, isPaused, currentKey, currentText, currentTime, duration } = useAudioPlayer();
  const { messages, isLoading, input, setInput, sendMessage } = useAIChat(currentSection, missedQuestions);
  const [introText, setIntroText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ---- Fetch sections, then fetch pre-generated audio for them ----
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
            conclusion: LECTURE_SCRIPTS.conclusion,
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

  useEffect(() => {
    return () => {
      if (keyTermsTimerRef.current) clearTimeout(keyTermsTimerRef.current);
    };
  }, [activeSection]);
  
    // Scroll to bottom of chat
    useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

  // ---- Narration handlers ----
  const narrateSection = (index: number) => {
    if (index < sections.length) {
      setMicroStep(0);
      playMicroStepAudio(index, 0, null);
      setIsNarrating(true);
      setShowConclusion(false);
    } else {
      play(audioUrls['conclusion'], 'conclusion');
      setIsNarrating(true);
      setShowConclusion(true);
    }
  };

  const playIntroduction = (template: 'classic' | 'split') => {
    play(audioUrls['intro'], 'intro', introText, () => {
      const layoutKey = `layout_${template}`;
      play(audioUrls[layoutKey], layoutKey, '', () => {
        narrateSection(0);
      });
    });
    setIsNarrating(true);
  };

  const nextSection = () => {
    setMicroStep(0);
    if (currentSection.quiz && currentSection.quiz.length === 2) {
      setShowQuiz(true);
    } else {
    handleQuizContinue(); // no valid quiz for this section — just advance
    }
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

  const prevSection = () => {
    setMicroStep(0);
    if (activeSection > 0) {
      stop();
      const newIndex = activeSection - 1;
      setActiveSection(newIndex);
      setTimeout(() => narrateSection(newIndex), 300);
    }
  };

  // ===================== IN AIPresentation COMPONENT ====================
  const [microStep, setMicroStep] = useState(0);
  const microSteps = getMicroSteps(activeSection);
  
  // Reset to step 0 whenever the main section changes
  useEffect(() => {
    setMicroStep(0);
    stop();
  }, [activeSection]);
  
  function getMicroStepText(section: SectionWithBreakdown, stepIndex: number): string {
    switch (stepIndex) {
      case 0: return section.content;
      case 1: return section.breakdown.simple;
      case 2: return '';
      case 3: return section.breakdown.realWorldExample;
      default: return '';
    }
  }
  
  const goToMicroStep = (index: number) => {
    if (index < 0 || index >= microSteps.length) return;
    if (keyTermsTimerRef.current) clearTimeout(keyTermsTimerRef.current);
    setMicroStep(index);
    playMicroStepAudio(activeSection, index, null);
  };
  
  const nextMicroStep = () => goToMicroStep(microStep + 1);
  const prevMicroStep = () => goToMicroStep(microStep - 1);

  
  // ---- Loading / error states before rendering the presentation ----
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

  if (!selectedTemplate) {
    return <TemplateSelector onSelect={handleTemplateSelect} />;
  }   

  function ConclusionScreen({
    onRestart,
    sectionScores,
    totalQuestions,
  }: {
    onRestart: () => void;
    sectionScores: Record<number, number>;
    totalQuestions: number;
  }) {
    const totalScore = Object.values(sectionScores).reduce((sum, s) => sum + s, 0);
    
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-8">
        <div className="text-6xl mb-6">🎓</div>
        <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">
          Lesson Complete!
        </h2>
        <p className="text-blue-700 text-lg max-w-xl mb-8 leading-relaxed">
          You've made it through the full story of the Blue Catfish invasion in the Chesapeake Bay —
          from how they got here, to why they've thrived, to how we might turn the problem into a solution.
        </p>
        <p className="text-2xl font-bold text-cyan-500 mb-8">
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
  
  // ===================== RENDER =====================
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
          
          <div className="flex items-center gap-3">
            {/* Speaking Indicator */}
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
            
            {/* Voice Controls */}
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
            
            {/* Chat Toggle */}
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
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-8 bg-gradient-to-br from-mist-400/70 via-mist-300/70 to-mist-400/70">
        {showConclusion ? (
          <ConclusionScreen 
            onRestart={handleRestart}
            sectionScores={sectionScores}
            totalQuestions={sections.length * 2}
          />
        ) : (
        <div className="max-w-7xl w-full">
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

          {showReview ? (
            <ReviewSlide
              missedQuestions={missedQuestions}
              section={currentSection}
              onContinue={handleReviewContinue}
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
            />
          )}
          
            {/* Custom Keyframe Animations */}
            <style jsx>{`
              @keyframes swim {
                0% { transform: translateX(0); }
                50% { transform: translateX(calc(100vw + 100%)); }
                51% { transform: translateX(calc(100vw + 100%)) scaleX(-1); }
                100% { transform: translateX(0) scaleX(-1); }
              }
              @keyframes swim2 {
                0% { transform: translateX(0) scaleX(-1); }
                50% { transform: translateX(calc(-100vw - 100%)) scaleX(-1); }
                51% { transform: translateX(calc(-100vw - 100%)); }
                100% { transform: translateX(0); }
              }
              @keyframes float {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-10px); }
              }
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
                  <p className="text-sm">{msg.text}</p>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-700 rounded-2xl px-4 py-3 flex gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input */}
          <div className="p-4 border-t border-white">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isLoading && sendMessage(input)}
                placeholder="Ask about Blue Catfish..."
                className="flex-1 bg-mist-300 text-black rounded-full px-[21px] py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isLoading}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={isLoading || !input.trim()}
                className="w-10 h-10 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-full flex items-center justify-center transition-colors"
              >
                →
              </button>
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
