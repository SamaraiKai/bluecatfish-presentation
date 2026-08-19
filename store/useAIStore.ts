import { create } from "zustand";

interface AIStore {
  cached_text: string;
  cached_response: string;
  setAIData: (text: string, response: string) => void;
}

export const useAIStore = create<AIStore>((set) => ({
  cached_text: "",
  cached_response: "",
  setAIData: (text, response) =>
    set({
      cached_text: text,
      cached_response: response,
    }),
}));
