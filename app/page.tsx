'use client';

import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-mist-400 via-mist-50 to-mist-400 flex items-center justify-center p-8">
      <div className="max-w-4xl text-center">
        <div className="text-8xl mb-8">🐟</div>
        <h1 className="text-5xl md:text-7xl font-bold text-black mb-6">
          Blue Catfish Presentation
        </h1>
        <p className="text-2xl text-blue-500 mb-12">
          Interactive AI-powered presentation about the Chesapeake Bay invasion
        </p>
        <Link
          href="/presentationv2"
          className="inline-block px-12 py-6 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white text-2xl font-bold rounded-full shadow-2xl transform hover:scale-105 transition-all"
        >
          ▶ Start Presentation
        </Link>
      </div>
    </div>
  );
}
