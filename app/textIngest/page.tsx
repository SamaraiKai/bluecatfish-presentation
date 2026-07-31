'use client';

import { useState } from 'react';

export default function AdminPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('');

  function handleFile(f: File) {
    setFile(f);
    setStatus(`Selected: ${f.name}`);
  }

  async function upload() {
    if (!file) return;

    setStatus('Uploading...');

    const base64 = await fileToBase64(file);

    const res = await fetch('/api/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file: base64,
        fileType: file.name.split('.').pop(),
        fileName: file.name,
      }),
    });

    const data = await res.json();
    setStatus(`Done! Embedded ${data.chunks} chunks`);
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
    });
  }

  return (
  <div style={{ display: 'flex', justifyContent: 'center', marginTop: 100 }}>
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);

        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
      }}
      style={{
        width: 420,
        minHeight: 280,
        border: '2px dashed gray',
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        background: dragging ? '#f0f0f0' : 'white',
        textAlign: 'center',
        padding: 20,
      }}
    >
      <p style={{ fontSize: 16 }}>
        Drag & drop file here
      </p>

      {file && (
        <p style={{ fontSize: 13, marginTop: 10 }}>
          📄 {file.name}
        </p>
      )}

      {/* UPLOAD BUTTON ALWAYS VISIBLE BUT DISABLED WHEN NO FILE */}
      <button
        onClick={upload}
        disabled={!file}
        style={{
          marginTop: 20,
          padding: '10px 18px',
          cursor: file ? 'pointer' : 'not-allowed',
          background: file ? '#000' : '#ccc',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          opacity: file ? 1 : 0.6,
        }}
      >
        Upload & Embed
      </button>

      <p style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
        {status}
      </p>
    </div>
  </div>
);
}
