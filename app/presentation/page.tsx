'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ===================== TYPES =====================
interface Message {
  role: 'user' | 'ai';
  text: string;
}

// ===================== LEARNER STATE =====================
interface LearnerState {
  confusedSections: Set<number>;
  currentBreakdownLevel: number; // 0 = normal, 1 = breakdown shown
  quizScores: Map<number, 'correct' | 'incorrect' | null>;
}

// Extended section data with breakdowns
interface SectionWithBreakdown {
  title: string;
  icon: string;
  image: string;
  content: string;
  stats: { value: string; label: string }[];
  narration: string;
  breakdown: {
    simple: string; // Simple explanation for confused learners
    detailed: string; // More detailed explanation
    keyTerms: { term: string; definition: string }[];
    realWorldExample: string;
  };
}

// ===================== PROFESSOR LECTURE SCRIPTS =====================
// These are detailed, professor-style narration scripts for each slide
const LECTURE_SCRIPTS = {
  intro: `Welcome to this presentation on Blue Catfish invasion in the Chesapeake Bay. I'm your professor, and today we'll explore one of the most significant ecological challenges facing the Bay ecosystem. Blue Catfish, once introduced for recreational fishing, have become an invasive species with far-reaching consequences. Let's dive in.`,

  slides: [
    {
      title: "A New Predator Arrives",
      narration: `Let's begin with the history. Blue Catfish are not native to the Chesapeake Bay. They originated in the Mississippi, Missouri, and Ohio river basins. In the 1970s and 1980s, these fish were deliberately introduced to Virginia's James, York, and Rappahannock rivers for recreational fishing purposes. The idea was simple: provide anglers with a new species to catch. However, what happened next was completely unexpected. These catfish escaped or were released into the wild, and because they had no natural predators and ideal conditions, their population exploded. Today, scientists estimate there are over 100 million Blue Catfish living in the Chesapeake Bay watershed. That's an incredible number for an introduced species.`,
      keyPoints: [
        "Blue Catfish are NOT native to the Chesapeake Bay",
        "Introduced in the 1970s-1980s for recreational fishing",
        "Population has grown to over 100 million",
        "Originally from Mississippi River basin"
      ]
    },
    {
      title: "Explosive Growth",
      narration: `Now, here's where it gets really interesting. And by interesting, I mean alarming. Blue Catfish are what scientists call voracious predators. They consume approximately 8 to 9 percent of their body weight every single day. Let me put that in perspective. If you weigh 150 pounds, eating 8 to 9 percent of your body weight daily would mean consuming about 12 to 13 pounds of food every single day. That's extraordinary! But the numbers don't stop there. In some rivers within the Chesapeake Bay watershed, Blue Catfish have become so abundant that they now represent up to 75 percent of the total fish biomass. This means three out of every four fish in those rivers is a Blue Catfish. They've completely dominated the ecosystem.`,
      keyPoints: [
        "Blue Catfish eat 8-9% of their body weight daily",
        "They make up 75% of fish biomass in some rivers",
        "This dominance disrupts the entire ecosystem balance"
      ]
    },
    {
      title: "Eating Everything",
      narration: `So what exactly are these catfish eating that has ecologists so worried? Blue Catfish are what we call opportunistic predators. This means they'll eat just about anything they can catch. Their diet includes American Shad eggs, which is particularly devastating because it directly impacts the reproductive success of a native fish species. They feast on Blue Crabs, one of the Bay's most iconic and economically important species. They consume Menhaden and River Herring, which are critical prey species for larger fish, birds, and marine mammals. They also eat clams, mussels, and even frogs. The problem is that Blue Catfish are so efficient and so numerous that they're essentially vacuuming up the entire food web. Every native species they eat is one less prey item for our native predators, and one more disruption to the delicate balance of the Chesapeake Bay ecosystem.`,
      keyPoints: [
        "Opportunistic feeders eating native species",
        "Threatening American Shad, Blue Crabs, Menhaden",
        "Disrupting the entire Chesapeake Bay food web"
      ]
    },
    {
      title: "No Natural Enemies",
      narration: `Perhaps the most critical factor making Blue Catfish so successful is this: they have absolutely no natural predators in the Chesapeake Bay. As an introduced species, nothing in this ecosystem evolved to hunt or control Blue Catfish populations. They became, essentially, the new apex predators of the Bay. Now, you might be wondering, why doesn't something just eat them? The answer is complex. First, Blue Catfish are large and aggressive. They can grow over 100 pounds, and their spines and defensive mechanisms make them difficult prey. Second, they can tolerate a wide range of salinity, from fresh water to water with up to 15 parts per thousand salt content. This allows them to move throughout the entire Bay system, including areas where most other predators cannot go. Without natural controls, their population continues to grow unchecked, and they outcompete native species for resources.`,
      keyPoints: [
        "Zero natural predators in the Chesapeake Bay",
        "Can grow over 100 pounds",
        "Tolerate salinity up to 15 parts per thousand",
        "Moved throughout entire Bay watershed"
      ]
    },
    {
      title: "A Delicious Solution",
      narration: `Now for the twist in our story, and it's a delicious one. Despite all the ecological problems they cause, Blue Catfish are actually quite tasty! Their meat is mild, flaky, and similar in flavor to Striped Bass. And here's the important part: because they are active predators rather than bottom feeders, their meat doesn't have that muddy taste that some people associate with catfish. They're also nutritious, providing about 19 grams of protein per 4-ounce serving. Scientists and conservationists have recognized that commercial harvesting of Blue Catfish, and encouraging people to eat them, could be one of the most effective ways to control their population. In 2017 alone, over 5 million pounds were harvested commercially. The logic is simple: every Blue Catfish that ends up on someone's dinner plate is one less predator in the Bay, eating our native species. It's a win-win situation for ecology and cuisine!`,
      keyPoints: [
        "Blue Catfish are mild, flaky, and delicious",
        "19 grams of protein per 4-ounce serving",
        "Commercial harvesting helps control population",
        "Over 5 million pounds harvested in 2017"
      ]
    }
  ],

  conclusion: `So to summarize what we've learned today: Blue Catfish are an invasive species that were introduced for recreational fishing but have since become a major ecological threat. They eat enormous quantities of native species, make up the majority of fish biomass in many rivers, and have no natural predators to keep their numbers in check. However, there's hope. By commercial harvesting and encouraging consumption of Blue Catfish, we can reduce their population while enjoying a sustainable and delicious food source. Thank you for joining me in this presentation about the Chesapeake Bay's Blue Catfish invasion. Remember, sometimes the solution to an ecological problem can be found on our dinner plates.`

};

// ===================== PRESENTATION CONTENT =====================
const PRESENTATION = {
  title: "Why Are Blue Catfish Invasive?",
  subtitle: "Understanding the Chesapeake Bay Crisis",
  professor: {
    name: "Professor Marine",
    title: "Marine Biology & Conservation"
  },
  sections: [
    {
      title: "A New Predator Arrives",
      icon: "🐟",
      image: "/images/bay.svg",
      content: "Blue Catfish were introduced to Virginia's James, York, and Rappahannock rivers in the 1970s and 1980s for recreational fishing. Since then, they've spread throughout the Chesapeake Bay watershed.",
      stats: [
        { value: "100+ million", label: "Estimated population in Bay" },
        { value: "1970s-80s", label: "When they were introduced" }
      ],
      narration: LECTURE_SCRIPTS.slides[0].narration,
      breakdown: {
        simple: "People brought Blue Catfish from another place (Mississippi River) to Virginia rivers for fishing fun in the 1970s-80s. They escaped and now there are over 100 MILLION of them in the Chesapeake Bay!",
        detailed: "Blue Catfish (Ictalurus furcatus) are native to major US river systems like the Mississippi, Missouri, and Ohio. They were introduced to Virginia waterways between 1970-1984 by state wildlife agencies for recreational angling. Unlike accidental introductions, these were deliberate stockings. However, some catfish escaped into the wild through flooding or deliberate release, establishing breeding populations in the James, York, and Rappahannock rivers before spreading throughout the entire Chesapeake Bay watershed.",
        keyTerms: [
          { term: "Introduced Species", definition: "A plant or animal moved by humans to a new location where it doesn't naturally live" },
          { term: "Watershed", definition: "An area of land where all water drains to a common outlet (like the Chesapeake Bay)" },
          { term: "Recreational Fishing", definition: "Fishing for pleasure or sport, not for food to sell" }
        ],
        realWorldExample: "Think of it like releasing goldfish from a fishbowl into a lake. At first there are just a few, but without natural controls, they multiply rapidly and can overwhelm the ecosystem."
      }
    },
    {
      title: "Explosive Growth",
      icon: "📈",
      image: "/images/bluecatfish2.svg",
      content: "These voracious predators consume 8-9% of their body weight EVERY DAY. In some rivers, they've become up to 75% of the total fish biomass, completely dominating the ecosystem.",
      stats: [
        { value: "8-9%", label: "Body weight consumed daily" },
        { value: "75%", label: "Biomass in some rivers" }
      ],
      narration: LECTURE_SCRIPTS.slides[1].narration,
      breakdown: {
        simple: "These catfish are SUPER hungry! A 50-pound catfish eats 4-5 pounds of food every single day. That's like you eating 30+ hamburgers daily! In some rivers, 3 out of 4 fish is now a Blue Catfish.",
        detailed: "Blue Catfish are obligate carnivores with extremely high metabolic rates. An 8-9% daily consumption rate is extraordinarily high compared to most fish (typically 1-3%). Research from VIMS (Virginia Institute of Marine Science) shows Blue Catfish comprise 65-75% of fish biomass in the James River alone. This biomass dominance means they're consuming vast quantities of native prey species, creating trophic cascades throughout the food web.",
        keyTerms: [
          { term: "Biomass", definition: "The total weight of all living organisms in an area" },
          { term: "Voracious", definition: "Extremely hungry; eating large amounts eagerly" },
          { term: "Trophic Cascade", definition: "When changes at the top of a food chain affect organisms throughout" }
        ],
        realWorldExample: "Imagine if 75% of all birds in your neighborhood were one species - like if 75% of birds were pigeons. They'd eat all the seeds, insects, and food that other birds need to survive."
      }
    },
    {
      title: "Eating Everything",
      icon: "🦐",
      image: "/images/bluecrab.svg",
      content: "Blue Catfish are opportunistic predators that feast on: American Shad eggs, Blue Crabs, Menhaden, River Herring, Clams, Mussels, and even frogs. They're disrupting the entire food web.",
      stats: [
        { value: "Multiple", label: "Native species threatened" },
        { value: "Crabs, Fish", label: "Primary prey" }
      ],
      narration: LECTURE_SCRIPTS.slides[2].narration,
      breakdown: {
        simple: "Blue Catfish eat LOTS of different animals: fish eggs, crabs, small fish, clams, and even frogs. They're like the kids who take all the cookies from the cookie jar AND the milk AND the napkins!",
        detailed: "Blue Catfish employ both ambush and active hunting strategies. Stomach content analysis reveals they consume over 75 different prey species. Critically, they target spawning fish (American Shad, River Herring) during egg periods, consuming up to 90% of annual egg production in some tributaries. Blue Crabs (Callinectes sapidus) - economically vital at $80M+ annually - comprise 15-30% of their diet in brackish areas. This broad dietary flexibility allows them to switch prey based on availability, making them extraordinarily adaptable.",
        keyTerms: [
          { term: "Opportunistic Predator", definition: "An animal that eats whatever prey is available rather than hunting specific species" },
          { term: "Food Web", definition: "The interconnected feeding relationships between organisms in an ecosystem" },
          { term: "Spawning", definition: "When fish release eggs and sperm to reproduce" }
        ],
        realWorldExample: "It's like having one student in class who takes the basketball, the kickball, the jump ropes, AND the hula hoops during recess. The other kids (species) have nothing left to play with!"
      }
    },
    {
      title: "No Natural Enemies",
      icon: "⚠️",
      image: "/images/warning.svg",
      content: "As an introduced species, Blue Catfish have no natural predators in the Bay to keep their population in check. They've become apex predators in an ecosystem that never evolved to deal with them.",
      stats: [
        { value: "0", label: "Natural predators" },
        { value: "15 ppt", label: "Salinity tolerance" }
      ],
      narration: LECTURE_SCRIPTS.slides[3].narration,
      breakdown: {
        simple: "Nothing in the Chesapeake Bay eats Blue Catfish! They're too big, spiny, and tough. Even the biggest fish like Striped Bass won't mess with them. Also, they can live in salty AND fresh water (up to 15 parts salt per thousand).",
        detailed: "As an introduced species, Blue Catfish evolved alongside different predator-prey relationships in the Mississippi basin. In the Chesapeake, their spiny dorsal and pectoral fins, large size (up to 115 lbs), and cryptic coloration provide defense. Native predators (Striped Bass, Osprey, Bald Eagles) rarely target catfish >20 lbs. Their euryhaline tolerance (0-15+ ppt salinity) allows them to exploit estuarine nursery habitats unreachable by most freshwater predators, and migrate to marine environments beyond brackish specialist reach.",
        keyTerms: [
          { term: "Apex Predator", definition: "A predator at the top of the food chain with no natural predators of its own" },
          { term: "Euryhaline", definition: "Able to tolerate a wide range of water salinity" },
          { term: "Estuarine", definition: " relating to or occurring in an estuary (where river meets sea)" }
        ],
        realWorldExample: "Imagine a lion being let loose in Australia. Nothing there evolved to hunt lions, so the lion population would explode because nothing can stop them!"
      }
    },
    {
      title: "A Delicious Solution",
      icon: "🍽️",
      image: "/images/fishmarket.svg",
      content: "Here's the twist: Blue Catfish are delicious and nutritious! Commercial harvesting and eating them is one of the best ways to reduce their numbers and protect native species.",
      stats: [
        { value: "5M+ lbs", label: "Harvested in 2017" },
        { value: "19g", label: "Protein per 4oz serving" }
      ],
      narration: LECTURE_SCRIPTS.slides[4].narration,
      breakdown: {
        simple: "Here's the GOOD news: Blue Catfish are yummy AND good for you! They have 19g of protein in just one serving. Restaurants are starting to serve them, which means fishermen get paid to catch them, which means fewer catfish eating our native species. It's a win-win!",
        detailed: "Blue Catfish represent a rare 'invasion with benefits' opportunity. Their white, flaky meat is mild without the muddy flavor common to bottom-feeding catfish (because they're active predators). At 19g protein per 4oz serving with low mercury levels, they're both nutritious and sustainable. The 2017 commercial harvest of 5.4 million lbs generated ~$4.5M in dock value. Chesapeake Bay chefs are increasingly featuring local Blue Catfish, creating market demand that incentivizes removal while supporting local fisheries.",
        keyTerms: [
          { term: "Commercial Harvest", definition: "Catching fish in large quantities to sell for food" },
          { term: "Sustainable", definition: "Able to be maintained at a certain rate without depleting resources" },
          { term: "Dock Value", definition: "The money fishermen earn when they first sell their catch" }
        ],
        realWorldExample: "Think of it like turning lemons into lemonade. The 'problem' (too many catfish) becomes the 'product' (delicious catfish dinners), and everyone benefits!"
      }
    }
  ]
};

// ===================== VOICEBOX INTEGRATION =====================
// Voicebox API integration for enhanced voice output
const useVoicebox = () => {
  const [voiceboxAvailable, setVoiceboxAvailable] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Check if Voicebox is running locally
    const checkVoicebox = async () => {
      try {
        const response = await fetch('http://127.0.0.1:17493/profiles', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        if (response.ok) {
          setVoiceboxAvailable(true);
        }
      } catch {
        setVoiceboxAvailable(false);
      }
    };
    checkVoicebox();
  }, []);

  const speakWithVoicebox = async (text: string, voiceName: string = 'sarah') => {
    if (!voiceboxAvailable) return false;
    
    try {
      setIsGenerating(true);
      const response = await fetch('http://127.0.0.1:17493/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Voicebox-Client-Id': 'bluecatfish-presentation'
        },
        body: JSON.stringify({
          text,
          profile: voiceName,
          language: 'en'
        })
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        
        if (audioRef.current) {
          audioRef.current.src = audioUrl;
          audioRef.current.play();
        }
        setIsGenerating(false);
        return true;
      }
    } catch (error) {
      console.error('Voicebox generation failed:', error);
      setIsGenerating(false);
    }
    return false;
  };

  const stopVoicebox = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  return {
    voiceboxAvailable,
    isGenerating,
    speakWithVoicebox,
    stopVoicebox,
    audioRef
  };
};

// ===================== ENHANCED SPEECH SYNTHESIS HOOK =====================
const useSpeechSynthesis = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speechRate, setSpeechRate] = useState(0.85); // Slightly slower for professor style
  const [currentSectionIndex, setCurrentSectionIndex] = useState(-1);
  const [voiceType, setVoiceType] = useState<'google' | 'voicebox'>('google');
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const voicebox = useVoicebox();

  const initSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  const speak = useCallback((text: string, sectionIndex: number = -1) => {
    // Try Voicebox first if available
    if (voicebox.voiceboxAvailable && voiceType === 'voicebox') {
      const voiceName = 'sarah'; // Use a natural female voice
      voicebox.speakWithVoicebox(text, voiceName);
      setCurrentSectionIndex(sectionIndex);
      setIsSpeaking(true);
      return;
    }

    // Fall back to Web Speech API
    if (!synthRef.current) {
      synthRef.current = window.speechSynthesis;
    }

    // Cancel any ongoing speech
    synthRef.current.cancel();
    
    setCurrentSectionIndex(sectionIndex);
    setIsSpeaking(true);
    setIsPaused(false);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speechRate;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    // Try to get a good English voice - prefer Google voices for natural sound
    const voices = synthRef.current.getVoices();
    const googleVoice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google'));
    const englishVoice = googleVoice 
      || voices.find(v => v.lang.startsWith('en-GB') && v.name.includes('Google'))
      || voices.find(v => v.lang.startsWith('en') && !v.name.includes('Google'))
      || voices.find(v => v.lang.startsWith('en'))
      || null;
    
    if (englishVoice) {
      utterance.voice = englishVoice;
    }

    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setIsPaused(false);
    };

    utteranceRef.current = utterance;
    synthRef.current.speak(utterance);
  }, [speechRate, voiceType, voicebox]);

  const narrateSection = useCallback((index: number) => {
    const section = PRESENTATION.sections[index];
    if (section?.narration) {
      speak(section.narration, index);
    }
  }, [speak]);

  const pause = useCallback(() => {
    if (voicebox.voiceboxAvailable && voiceType === 'voicebox') {
      voicebox.stopVoicebox();
      setIsSpeaking(false);
      return;
    }
    
    if (synthRef.current && isSpeaking && !isPaused) {
      synthRef.current.pause();
      setIsPaused(true);
    }
  }, [isSpeaking, isPaused, voiceType, voicebox]);

  const resume = useCallback(() => {
    if (synthRef.current && isSpeaking && isPaused) {
      synthRef.current.resume();
      setIsPaused(false);
    }
  }, [isSpeaking, isPaused]);

  const stop = useCallback(() => {
    if (voicebox.voiceboxAvailable) {
      voicebox.stopVoicebox();
    }
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentSectionIndex(-1);
  }, [voicebox]);

  const changeRate = useCallback((rate: number) => {
    setSpeechRate(rate);
    if (isSpeaking) {
      stop();
    }
  }, [isSpeaking, stop]);

  const changeVoiceType = useCallback((type: 'google' | 'voicebox') => {
    setVoiceType(type);
    stop();
  }, [stop]);

  // Load voices
  useEffect(() => {
    initSpeech();
    if (synthRef.current) {
      const loadVoices = () => {
        // Voices are loaded
      };
      synthRef.current.onvoiceschanged = loadVoices;
      loadVoices();
    }
  }, [initSpeech]);

  return {
    speak,
    narrateSection,
    pause,
    resume,
    stop,
    isSpeaking,
    isPaused,
    speechRate,
    changeRate,
    currentSectionIndex,
    voiceType,
    changeVoiceType,
    voiceboxAvailable: voicebox.voiceboxAvailable,
    audioRef: voicebox.audioRef
  };
};

// ===================== AI CHAT HOOK =====================
const useAIChat = () => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', text: `Good day! I'm ${PRESENTATION.professor.name}, and I'll be your guide through today's lecture on the Blue Catfish invasion in the Chesapeake Bay. Feel free to ask me any questions as we go through the material. What would you like to explore first?` }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState('');
  // Per-tab session id so the OpenClaw bluecatfish agent keeps a separate
  // learner memory per student (the longitudinal learner model from the
  // Baradziej and Pal 2026 adaptive-tutoring module).
  const sessionIdRef = useRef<string>('');
  if (!sessionIdRef.current && typeof window !== 'undefined') {
    sessionIdRef.current = 'bc-web-' + Math.random().toString(36).slice(2, 10);
  }

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMessage: Message = { role: 'user', text };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: sessionIdRef.current }),
      });
      const data = await response.json();
      const reply =
        data && data.ok && typeof data.reply === 'string' && data.reply.trim()
          ? data.reply
          : (data && typeof data.fallback === 'string' && data.fallback.trim()
              ? data.fallback
              : getRuleBasedResponse(text));
      if (data && typeof data.sessionId === 'string' && data.sessionId) {
        sessionIdRef.current = data.sessionId;
      }
      setMessages(prev => [...prev, { role: 'ai', text: reply }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'ai',
        text: getRuleBasedResponse(text)
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    messages,
    isLoading,
    input,
    setInput,
    sendMessage
  };
};

// Rule-based fallback responses
function getRuleBasedResponse(question: string): string {
  const q = question.toLowerCase();
  
  if (q.includes('eat') || q.includes('diet') || q.includes('food')) {
    return "Blue Catfish are voracious predators! They eat about 8-9% of their body weight every single day. That's like a 150-pound person eating 12-13 pounds of food daily! They feast on native fish, crabs, clams, and even frogs.";
  }
  if (q.includes('introduced') || q.includes('origin') || q.includes('come from')) {
    return "Blue Catfish were originally from the Mississippi, Missouri, and Ohio river basins. They were introduced to Virginia's rivers in the 1970s and 80s for recreational fishing. Unfortunately, they escaped into the wild and started multiplying rapidly!";
  }
  if (q.includes('number') || q.includes('population') || q.includes('how many')) {
    return "Scientists estimate there are over 100 million Blue Catfish in the Chesapeake Bay! In some rivers, they make up to 75% of the total fish biomass. That's incredible dominance by a single species!";
  }
  if (q.includes('native') || q.includes('endangered') || q.includes('threat')) {
    return "Blue Catfish threaten many native species including American Shad, Blue Crabs, Menhaden, River Herring, and even freshwater mussels. They're eating the eggs of spawning fish and competing with native predators for food.";
  }
  if (q.includes('predator') || q.includes('enemy') || q.includes('natural')) {
    return "That's the problem! Blue Catfish have NO natural predators in the Chesapeake Bay. As an introduced species, nothing evolved here to hunt them. They became the new apex predator of the ecosystem.";
  }
  if (q.includes('solution') || q.includes('fix') || q.includes('help')) {
    return "Great question! The delicious solution is to EAT them! Blue Catfish are mild, flaky, and nutritious. Commercial harvesting creates economic incentives to remove them. Plus, one catfish eaten is one less eating our native species!";
  }
  if (q.includes('taste') || q.includes('delicious') || q.includes('eat')) {
    return "Ironically, Blue Catfish are delicious! They're mild and flaky with a taste similar to striped bass. Since they're active predators (not bottom feeders), their meat is clean without a muddy taste. Plus, they're high in protein and omega-3s!";
  }
  if (q.includes('hello') || q.includes('hi') || q.includes('hey')) {
    return "Hey there! Great to meet you! I'm Finley, your Blue Catfish expert. What would you like to know about these fascinating but problematic invaders?";
  }
  
  return "That's a great question! Blue Catfish are fascinating creatures. They can grow over 100 pounds, tolerate brackish water, and have spread throughout the Chesapeake Bay. Would you like to know more about their impact or what we can do about them?";
}

// ===================== MAIN COMPONENT =====================
export default function AIPresentation() {
  const [activeSection, setActiveSection] = useState(0);
  const [showChat, setShowChat] = useState(false);
  const [isNarrating, setIsNarrating] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [showConclusion, setShowConclusion] = useState(false);
  
  // Learner State - Confusion Tracking
  const [confusedSections, setConfusedSections] = useState<Set<number>>(new Set());
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [breakdownLevel, setBreakdownLevel] = useState<'simple' | 'detailed'>('simple');
  const [confusionClicked, setConfusionClicked] = useState(false);
  
  const {
    speak,
    narrateSection: narrate,
    pause,
    resume,
    stop,
    isSpeaking,
    isPaused,
    speechRate,
    changeRate,
    currentSectionIndex,
    voiceType,
    changeVoiceType,
    voiceboxAvailable
  } = useSpeechSynthesis();
  
  const {
    messages,
    isLoading,
    input,
    setInput,
    sendMessage
  } = useAIChat();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Narrate current section with full professor script
  const narrateSection = (index: number) => {
    if (index < PRESENTATION.sections.length) {
      const section = PRESENTATION.sections[index];
      // Use the full professor narration script
      speak(section.narration, index);
      setIsNarrating(true);
      setShowConclusion(false);
    } else {
      // Conclusion narration
      speak(LECTURE_SCRIPTS.conclusion, -1);
      setIsNarrating(true);
      setShowConclusion(true);
    }
  };

  // Handle confusion click
  const handleConfused = () => {
    // Mark this section as confused
    setConfusedSections(prev => new Set([...prev, activeSection]));
    setConfusionClicked(true);
    setShowBreakdown(true);
    setBreakdownLevel('simple');
    
    // Narrate the simple breakdown
    const section = PRESENTATION.sections[activeSection];
    if (section.breakdown) {
      speak(section.breakdown.simple, activeSection);
    }
  };

  // Show more detailed breakdown
  const handleShowMore = () => {
    setBreakdownLevel('detailed');
    const section = PRESENTATION.sections[activeSection];
    if (section.breakdown) {
      speak(section.breakdown.detailed, activeSection);
    }
  };

  // Close breakdown modal
  const handleCloseBreakdown = () => {
    setShowBreakdown(false);
    setBreakdownLevel('simple');
    setConfusionClicked(false);
    stop();
  };

  // Play introduction
  const playIntroduction = () => {
    speak(LECTURE_SCRIPTS.intro, -1);
    setIsNarrating(true);
  };

  // Stop narration when section changes
  useEffect(() => {
    if (currentSectionIndex !== activeSection && isSpeaking) {
      stop();
      setIsNarrating(false);
    }
  }, [activeSection, currentSectionIndex, isSpeaking, stop]);

  // Start presentation
  const startPresentation = () => {
    setShowIntro(false);
    setActiveSection(0);
    setShowConclusion(false);
    // First play the introduction
    setTimeout(() => {
      playIntroduction();
      // Then start the first section after intro
      setTimeout(() => narrateSection(0), 5000);
    }, 500);
  };

  // Navigate sections
  const nextSection = () => {
    setShowBreakdown(false);
    if (activeSection < PRESENTATION.sections.length - 1) {
      stop();
      const newIndex = activeSection + 1;
      setActiveSection(newIndex);
      setShowConclusion(false);
      setTimeout(() => narrateSection(newIndex), 300);
    } else if (activeSection === PRESENTATION.sections.length - 1) {
      // At last slide, offer to play conclusion
      stop();
      setShowConclusion(true);
      setTimeout(() => narrateSection(PRESENTATION.sections.length), 500);
    }
  };

  const prevSection = () => {
    setShowBreakdown(false);
    if (activeSection > 0) {
      stop();
      const newIndex = activeSection - 1;
      setActiveSection(newIndex);
      setTimeout(() => narrateSection(newIndex), 300);
    }
  };

  const currentSection = PRESENTATION.sections[activeSection];

  // ===================== RENDER =====================
  if (showIntro) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-8">
        <div className="max-w-4xl text-center">
          {/* Professor Info */}
          <div className="mb-8 flex flex-col items-center">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center mb-4 shadow-lg">
              <span className="text-5xl">👨‍🏫</span>
            </div>
            <h2 className="text-xl text-cyan-400 font-semibold">
              {PRESENTATION.professor.name}
            </h2>
            <p className="text-blue-300 text-sm">
              {PRESENTATION.professor.title}
            </p>
          </div>
          
          <div className="text-8xl mb-8 animate-bounce">🐟</div>
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6">
            {PRESENTATION.title}
          </h1>
          <p className="text-2xl text-blue-200 mb-12">
            {PRESENTATION.subtitle}
          </p>
          <button
            onClick={startPresentation}
            className="px-12 py-6 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white text-2xl font-bold rounded-full shadow-2xl transform hover:scale-105 transition-all"
          >
            ▶ Start Class
          </button>
          <div className="mt-8 text-blue-300 text-sm space-y-2">
            <p>🎙️ Professor-style voice narration</p>
            <p>💬 Interactive AI Q&A session</p>
            {voiceboxAvailable && (
              <p className="text-cyan-400">✨ Voicebox enhanced voice detected</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex flex-col">
      {/* Header */}
      <header className="bg-black/30 backdrop-blur-sm border-b border-blue-500/30 p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Professor Badge */}
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center">
              <span className="text-xl">👨‍🏫</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">
                {PRESENTATION.professor.name}
              </h1>
              <p className="text-xs text-cyan-400">
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
                <span className="text-cyan-400 text-sm font-medium">
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
              <select
                value={speechRate}
                onChange={(e) => changeRate(parseFloat(e.target.value))}
                className="bg-slate-700 text-white text-sm rounded px-2 py-1"
                title="Speech Speed"
              >
                <option value="0.7">0.7x</option>
                <option value="0.85">0.85x</option>
                <option value="1.0">1.0x</option>
              </select>
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
      <main className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-6xl w-full">
          {/* Progress Bar */}
          <div className="mb-8">
            <div className="flex justify-between text-blue-200 text-sm mb-2">
              <span>Section {activeSection + 1} of {PRESENTATION.sections.length}</span>
              <span>{Math.round(((activeSection + 1) / PRESENTATION.sections.length) * 100)}%</span>
            </div>
            <div className="h-2 bg-blue-900/50 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500"
                style={{ width: `${((activeSection + 1) / PRESENTATION.sections.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Two Column Layout - Image Left, Content Right */}
          <div className="bg-white/5 backdrop-blur-md rounded-3xl border border-blue-500/30 shadow-2xl overflow-hidden">
            <div className="grid md:grid-cols-2 gap-0">
              {/* Left: Interactive Animated Graphics */}
              <div className="relative h-72 md:h-auto min-h-[500px] bg-gradient-to-br from-blue-800 to-cyan-900 overflow-hidden">
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
                    className="absolute inset-0 w-full h-full object-cover opacity-80"
                    onError={(e) => {
                      e.currentTarget.style.display='none';
                    }}
                  />
                )}
                
                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
                
                {/* Slide Counter Badge */}
                <div className="absolute top-4 left-4 bg-cyan-500/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg">
                  <span className="font-bold text-white">{activeSection + 1} / {PRESENTATION.sections.length}</span>
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
              </div>
              
              {/* Right: Content with Animations */}
              <div className="p-8 md:p-12 flex flex-col justify-center bg-gradient-to-br from-blue-900/80 to-slate-900/80">
                {/* Animated Title */}
                <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 animate-[slideInRight_0.6s_ease-out]">
                  {currentSection.title}
                </h2>
                
                {/* Animated Underline */}
                <div className="h-1 w-0 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full mb-6 animate-[expandWidth_0.8s_ease-out_0.3s_forwards]" />
                
                {/* Content with stagger animation */}
                <div className="relative mb-8 overflow-hidden">
                  <p className="text-lg md:text-xl text-blue-100 leading-relaxed animate-[fadeIn_0.5s_ease-out_0.5s_forwards] opacity-0">
                    {currentSection.content}
                  </p>
                </div>
                
                {/* Interactive Stats Grid */}
                <div className="grid grid-cols-2 gap-4">
                  {currentSection.stats.map((stat, idx) => (
                    <div
                      key={idx}
                      className="group bg-blue-800/50 backdrop-blur-sm rounded-xl p-4 text-center border border-cyan-500/30 cursor-pointer transition-all duration-300 hover:bg-blue-700/60 hover:scale-105 hover:shadow-lg hover:shadow-cyan-500/20 animate-[fadeInUp_0.5s_ease-out_forwards]"
                      style={{ animationDelay: `${0.6 + idx * 0.1}s` }}
                    >
                      <div className="text-2xl md:text-3xl font-bold text-cyan-400 mb-1 transition-colors group-hover:text-white">
                        {stat.value}
                      </div>
                      <div className="text-sm text-blue-200 group-hover:text-blue-100 transition-colors">
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Confusion Button - Learner Support */}
                <div className="mt-6 pt-4 border-t border-blue-700/30">
                  <button
                    onClick={handleConfused}
                    className={`w-full py-3 px-4 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 font-medium ${
                      confusedSections.has(activeSection)
                        ? 'bg-green-600/80 text-white hover:bg-green-600'
                        : 'bg-amber-600/80 text-white hover:bg-amber-600'
                    }`}
                  >
                    {confusedSections.has(activeSection) ? (
                      <>
                        <span className="text-xl">✓</span>
                        <span>Breakdown Mode Active</span>
                      </>
                    ) : (
                      <>
                        <span className="text-xl">🤔</span>
                        <span>I'm Confused - Explain This</span>
                      </>
                    )}
                  </button>
                </div>
                
                {/* Progress Indicator */}
                <div className="mt-4 flex items-center gap-2">
                  <span className="text-sm text-blue-300">Progress:</span>
                  <div className="flex-1 h-2 bg-blue-900/50 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-500"
                      style={{ width: `${((activeSection + 1) / PRESENTATION.sections.length) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm text-cyan-400 font-medium">
                    {Math.round(((activeSection + 1) / PRESENTATION.sections.length) * 100)}%
                  </span>
                </div>
              </div>
            </div>
            
            {/* Breakdown Modal - Shows when learner is confused */}
            {showBreakdown && currentSection.breakdown && (
              <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-[fadeIn_0.3s_ease-out]">
                <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl max-w-3xl w-full max-h-[85vh] overflow-hidden border border-cyan-500/30 shadow-2xl animate-[slideUp_0.4s_ease-out]">
                  {/* Modal Header */}
                  <div className="bg-gradient-to-r from-amber-600 to-orange-600 p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-4xl animate-bounce">🤔</span>
                        <div>
                          <h3 className="text-2xl font-bold text-white">Let's Break This Down</h3>
                          <p className="text-amber-100 text-sm">Topic: {currentSection.title}</p>
                        </div>
                      </div>
                      <button
                        onClick={handleCloseBreakdown}
                        className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white text-xl transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  
                  {/* Modal Content */}
                  <div className="p-6 overflow-y-auto max-h-[calc(85vh-180px)]">
                    {/* Simple Explanation */}
                    <div className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-2xl">📚</span>
                        <h4 className="text-lg font-bold text-cyan-400">Simple Explanation</h4>
                      </div>
                      <div className="bg-blue-900/30 rounded-xl p-4 border border-blue-500/20">
                        <p className="text-blue-100 leading-relaxed">
                          {currentSection.breakdown.simple}
                        </p>
                      </div>
                    </div>
                    
                    {/* Detailed Explanation (if expanded) */}
                    {breakdownLevel === 'detailed' && (
                      <div className="mb-6 animate-[fadeIn_0.5s_ease-out]">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-2xl">🔬</span>
                          <h4 className="text-lg font-bold text-purple-400">Scientific Details</h4>
                        </div>
                        <div className="bg-purple-900/30 rounded-xl p-4 border border-purple-500/20">
                          <p className="text-purple-100 leading-relaxed">
                            {currentSection.breakdown.detailed}
                          </p>
                        </div>
                      </div>
                    )}
                    
                    {/* Key Terms */}
                    <div className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-2xl">📖</span>
                        <h4 className="text-lg font-bold text-green-400">Key Terms</h4>
                      </div>
                      <div className="grid gap-3">
                        {currentSection.breakdown.keyTerms.map((term, idx) => (
                          <div key={idx} className="bg-green-900/30 rounded-xl p-4 border border-green-500/20">
                            <div className="font-bold text-green-400 mb-1">{term.term}</div>
                            <p className="text-green-100 text-sm">{term.definition}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* Real World Example */}
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-2xl">🌍</span>
                        <h4 className="text-lg font-bold text-yellow-400">Real World Example</h4>
                      </div>
                      <div className="bg-yellow-900/30 rounded-xl p-4 border border-yellow-500/20">
                        <p className="text-yellow-100 leading-relaxed">
                          {currentSection.breakdown.realWorldExample}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Modal Footer */}
                  <div className="p-4 bg-slate-800/50 border-t border-slate-700 flex justify-between items-center">
                    <button
                      onClick={handleCloseBreakdown}
                      className="px-6 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors"
                    >
                      Got It! Continue
                    </button>
                    {breakdownLevel === 'simple' && (
                      <button
                        onClick={handleShowMore}
                        className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors flex items-center gap-2"
                      >
                        <span>Show More Details</span>
                        <span>→</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
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
          </div>

          {/* Navigation */}
          <div className="flex justify-between items-center mt-8">
            <button
              onClick={prevSection}
              disabled={activeSection === 0}
              className="px-8 py-4 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed text-white font-semibold rounded-full transition-colors flex items-center gap-2"
            >
              ← Previous
            </button>
            
            <div className="flex gap-2">
              {PRESENTATION.sections.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    stop();
                    setActiveSection(idx);
                    setTimeout(() => narrateSection(idx), 300);
                  }}
                  className={`w-3 h-3 rounded-full transition-colors ${
                    idx === activeSection 
                      ? 'bg-cyan-400' 
                      : 'bg-blue-700 hover:bg-blue-600'
                  }`}
                />
              ))}
            </div>

            <button
              onClick={nextSection}
              disabled={activeSection === PRESENTATION.sections.length - 1}
              className="px-8 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 disabled:opacity-30 disabled:cursor-not-allowed text-white font-semibold rounded-full transition-colors flex items-center gap-2"
            >
              Next →
            </button>
          </div>
        </div>
      </main>

      {/* AI Chat Panel */}
      {showChat && (
        <div className="fixed right-6 bottom-6 w-96 max-h-[70vh] bg-slate-900/95 backdrop-blur-lg rounded-2xl shadow-2xl border border-blue-500/30 flex flex-col overflow-hidden z-50">
          {/* Chat Header */}
          <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
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
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : 'bg-slate-700 text-gray-100 rounded-bl-none'
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
          <div className="p-4 border-t border-slate-700">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isLoading && sendMessage(input)}
                placeholder="Ask about Blue Catfish..."
                className="flex-1 bg-slate-700 text-white rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
      <footer className="text-center py-4 text-blue-300 text-sm">
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
