"use client";

import { useState } from "react";
import { Monitor, Moon, Sun, ZoomIn, ZoomOut, RotateCcw, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@auto-claude/ui";
import { useSettingsStore, saveSettings } from "@/stores/settings-store";
import type { ColorTheme } from "@auto-claude/types";

const UI_SCALE_MIN = 75;
const UI_SCALE_MAX = 200;
const UI_SCALE_DEFAULT = 100;
const UI_SCALE_STEP = 5;

const SCALE_PRESETS = [
  { value: UI_SCALE_DEFAULT, label: "100%", descriptionKey: "scale.default" },
  { value: 125, label: "125%", descriptionKey: "scale.comfortable" },
  { value: 150, label: "150%", descriptionKey: "scale.large" },
] as const;

const COLOR_THEMES: { id: ColorTheme; label: string; preview: { light: string; dark: string } }[] = [
  { id: "default", label: "Default", preview: { light: "#6366f1", dark: "#818cf8" } },
  { id: "dusk", label: "Dusk", preview: { light: "#8b5cf6", dark: "#a78bfa" } },
  { id: "lime", label: "Lime", preview: { light: "#84cc16", dark: "#a3e635" } },
  { id: "ocean", label: "Ocean", preview: { light: "#0ea5e9", dark: "#38bdf8" } },
  { id: "retro", label: "Retro", preview: { light: "#f59e0b", dark: "#fbbf24" } },
  { id: "neo", label: "Neo", preview: { light: "#ec4899", dark: "#f472b6" } },
  { id: "forest", label: "Forest", preview: { light: "#22c55e", dark: "#4ade80" } },
];

/**
 * Display settings — theme selector with 7 color themes, light/dark mode, UI scale
 */
export function DisplaySettings() {
  const settings = useSettingsStore((s) => s.settings);
  const { t } = useTranslation("settings");

  const rawCurrentScale = settings.uiScale ?? UI_SCALE_DEFAULT;
  const currentScale =
    rawCurrentScale > 0 && rawCurrentScale <= 2
      ? Math.round(rawCurrentScale * 100)
      : rawCurrentScale;

  const [pendingScale, setPendingScale] = useState<number | null>(null);
  const [committedScale, setCommittedScale] = useState<number>(currentScale);
  const displayScale = pendingScale ?? currentScale;
  const hasPendingChanges = pendingScale !== null && pendingScale !== committedScale;

  const handleScaleChange = (value: number) => {
    if (Number.isNaN(value)) return;
    const clamped = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, value));
    setPendingScale(clamped);
    saveSettings({ uiScale: clamped });
  };

  const handlePresetChange = (value: number) => {
    const clamped = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, value));
    saveSettings({ uiScale: clamped });
    setCommittedScale(clamped);
    setPendingScale(null);
  };

  const applyScale = () => {
    if (pendingScale !== null) {
      saveSettings({ uiScale: pendingScale });
      setCommittedScale(pendingScale);
      setPendingScale(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1 text-balance">{t("sections.appearance.title")}</h2>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("sections.appearance.description")}
        </p>
      </div>

      <div className="space-y-4">
        {/* Light / Dark / System */}
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium mb-3">{t("fields.theme")}</h3>
          <div className="grid grid-cols-3 gap-3">
            {(["light", "dark", "system"] as const).map((theme) => {
              const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
              return (
                <button
                  key={theme}
                  type="button"
                  data-testid={`settings-theme-${theme}`}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                    settings.theme === theme
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-border/80"
                  )}
                  onClick={() => saveSettings({ theme })}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-xs font-medium capitalize">
                    {t(`themes.${theme}`)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Color Theme */}
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium mb-3">{t("fields.colorTheme")}</h3>
          <div className="grid grid-cols-4 gap-3">
            {COLOR_THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border p-3 transition-colors",
                  settings.colorTheme === theme.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-border/80"
                )}
                onClick={() => saveSettings({ colorTheme: theme.id })}
              >
                <div
                  className="h-6 w-6 rounded-full"
                  style={{ backgroundColor: theme.preview.light }}
                />
                <span className="text-xs font-medium">{theme.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* UI Scale */}
        <div className="rounded-lg border border-border p-4 space-y-4" data-testid="settings-ui-scale-section">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">{t("fields.uiScale")}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("scale.fineTuneDescription")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                data-testid="settings-ui-scale-value"
                className="text-sm font-mono text-muted-foreground"
              >
                {displayScale}%
              </span>
              {displayScale !== UI_SCALE_DEFAULT && (
                <button
                  type="button"
                  data-testid="settings-ui-scale-reset"
                  title="Reset to default (100%)"
                  aria-label="Reset to default (100%)"
                  onClick={() => handlePresetChange(UI_SCALE_DEFAULT)}
                  className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Preset Buttons */}
          <div className="grid grid-cols-3 gap-3">
            {SCALE_PRESETS.map((preset) => {
              const isSelected = displayScale === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  data-testid={`settings-ui-scale-preset-${preset.value}`}
                  onClick={() => handlePresetChange(preset.value)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-colors",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-border/80"
                  )}
                >
                  <span className="text-sm font-mono font-medium">{preset.label}</span>
                  <span className="text-xs text-muted-foreground">{t(preset.descriptionKey)}</span>
                </button>
              );
            })}
          </div>

          {/* Fine-tune Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="settings-ui-scale-zoom-out"
                title={`Decrease scale by ${UI_SCALE_STEP}%`}
                aria-label={`Decrease scale by ${UI_SCALE_STEP}%`}
                onClick={() => handleScaleChange(displayScale - UI_SCALE_STEP)}
                disabled={displayScale <= UI_SCALE_MIN}
                className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <input
                type="range"
                data-testid="settings-ui-scale-slider"
                min={UI_SCALE_MIN}
                max={UI_SCALE_MAX}
                step={UI_SCALE_STEP}
                value={displayScale}
                onChange={(e) => handleScaleChange(Number.parseInt(e.target.value, 10))}
                className={cn(
                  "flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer",
                  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer",
                  "[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
                )}
              />
              <button
                type="button"
                data-testid="settings-ui-scale-zoom-in"
                title={`Increase scale by ${UI_SCALE_STEP}%`}
                aria-label={`Increase scale by ${UI_SCALE_STEP}%`}
                onClick={() => handleScaleChange(displayScale + UI_SCALE_STEP)}
                disabled={displayScale >= UI_SCALE_MAX}
                className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
            <div className="flex justify-between text-xs font-mono text-muted-foreground px-1">
              <span>{UI_SCALE_MIN}%</span>
              <span>{UI_SCALE_MAX}%</span>
            </div>
          </div>

          {hasPendingChanges && (
            <div className="flex justify-end">
              <button
                type="button"
                data-testid="settings-ui-scale-apply"
                onClick={applyScale}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
                {t("actions.apply")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
