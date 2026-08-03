"use client";

import { useState } from "react";

export default function UploadImagePage() {
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    if (selected) setPreview(URL.createObjectURL(selected));
  };

  const handleSubmit = async () => {
    if (!file || !description.trim()) {
      setStatus("Please select a file and enter a description.");
      return;
    }

    setUploading(true);
    setStatus(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("description", description.trim());

      const res = await fetch("/ingest-image", {
        method: "POST",
        body: formData,
      });
      
      const raw = await res.text();
      console.log("status:", res.status, "body:", raw);

      const result = await res.json();
      try {
        result = JSON.parse(raw);
      } catch {
        setStatus(`Server returned non-JSON: ${raw.slice(0, 200)}`);
        return;
      }
      
      if (result.error) {
        setStatus(`Error: ${result.error}`);
      } else {
        setStatus("Uploaded successfully.");
        setFile(null);
        setDescription("");
        setPreview(null);
      }
    } catch (err: any) {
      setStatus(`Failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl bg-white p-8 shadow-sm border border-gray-200">
        <h1 className="mb-1 text-xl font-semibold text-gray-900">
          Upload Slide Image
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          The description is what gets embedded and matched against slide topics.
        </p>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Image file
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700"
          />
        </div>

        {preview && (
          <div className="mb-4 rounded-lg overflow-hidden border border-gray-200">
            <img src={preview} alt="Preview" className="w-full h-48 object-cover" />
          </div>
        )}

        <div className="mb-6">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Blue catfish preying on juvenile blue crabs in Chesapeake Bay shallows — predation, native species impact"
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <p className="mt-1 text-xs text-gray-400">
            Describe what it shows and what it's about — include the distinguishing context.
          </p>
        </div>

        {status && (
          <p className={`mb-4 text-sm font-medium ${status.startsWith("Uploaded") ? "text-green-600" : "text-red-600"}`}>
            {status}
          </p>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={uploading || !file || !description.trim()}
          className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? "Uploading..." : "Upload Image"}
        </button>
      </div>
    </div>
  );
}
