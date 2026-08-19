"use client";
import { useRouter } from "next/navigation";
import PreferenceSelector from "@/components/PreferenceSelector";

export default function PreferencesPage() {
  const router = useRouter();
  
  return (
    <PreferenceSelector
      onComplete={() => router.push("/learning")}
    />
  );
}
