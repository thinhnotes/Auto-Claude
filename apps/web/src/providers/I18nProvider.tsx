"use client";

import { useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";
import { useSettingsStore } from "@/stores/settings-store";

export const APERANT_I18N_VERSION = "2026-11-05-v5";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const language = useSettingsStore((s) => s.settings?.language);

  useEffect(() => {
    const targetLang = language || "en";
    if (i18n.language !== targetLang) {
      void i18n.changeLanguage(targetLang);
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = targetLang;
    }
  }, [language]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
