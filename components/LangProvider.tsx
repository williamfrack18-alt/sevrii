"use client";

import { createContext, useContext } from "react";
import { getDict, type Dict, type Lang } from "@/lib/i18n";

const LangContext = createContext<Lang>("es");

export default function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

export function useT(): Dict {
  return getDict(useContext(LangContext));
}
