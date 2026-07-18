import { create } from "zustand";

type AppState = {
  selectedJobId: number | null;
  setSelectedJobId: (jobId: number | null) => void;
};

export const useVideoLocalizationStore = create<AppState>((set) => ({
  selectedJobId: null,
  setSelectedJobId: (selectedJobId) => set({ selectedJobId })
}));

