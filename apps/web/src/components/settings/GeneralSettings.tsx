"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@auto-claude/ui";
import { useSettingsStore, saveSettings } from "@/stores/settings-store";

const MODELS = [
  { value: "gemma-4", label: "Local MI50 GPU — Gemma 4 (26B MoE)" },
  { value: "qwen3.8-moe", label: "Local MI50 GPU — Qwen 3.8 MoE" },
  { value: "qwen2.5-coder:14b", label: "Local Ollama — Qwen 2.5 Coder 14B" },
  { value: "gpt-6-luna", label: "Local CLIProxy — GPT-6 Luna" },
  { value: "gpt-5.6-luna", label: "Local CLIProxy — GPT-5.6 Luna" },
  { value: "sonnet", label: "Claude Sonnet (Bridged to Local AI)" },
  { value: "opus", label: "Claude Opus (Bridged to Local AI)" },
  { value: "haiku", label: "Claude Haiku (Bridged to Local AI)" },
] as const;

/**
 * General settings section — language, default model, auto-continue
 */
export function GeneralSettings() {
  const settings = useSettingsStore((s) => s.settings);
  const { t, i18n } = useTranslation("settings");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">{t("sections.general.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("sections.general.description")}
        </p>
      </div>

      <div className="space-y-4">
        {/* Language */}
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium">{t("fields.language")}</p>
            <p className="text-xs text-muted-foreground">
              {t("fields.languageDescription")}
            </p>
          </div>
          <select
            data-testid="settings-language-select"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            value={settings.language ?? "en"}
            onChange={(e) => {
              const lang = e.target.value;
              void i18n.changeLanguage(lang);
              void saveSettings({ language: lang });
            }}
          >
            <option value="en">{t("languages.en")}</option>
            <option value="fr">{t("languages.fr")}</option>
          </select>
        </div>

        {/* Default Model */}
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium">{t("fields.defaultModel")}</p>
            <p className="text-xs text-muted-foreground">
              {t("fields.defaultModelDescription")}
            </p>
          </div>
          <select
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            value={settings.defaultModel ?? "sonnet"}
            onChange={(e) => saveSettings({ defaultModel: e.target.value })}
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
