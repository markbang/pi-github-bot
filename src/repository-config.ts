import YAML from "yaml";
import { defaultRepositoryConfig } from "./defaults.js";
import type { RepositoryConfig } from "./types.js";

export function mergeRepositoryConfig(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base, ...override };
  for (const key of Object.keys(base)) {
    const baseValue = base[key];
    const overrideValue = override[key];
    if (baseValue && typeof baseValue === "object" && !Array.isArray(baseValue) && overrideValue && typeof overrideValue === "object" && !Array.isArray(overrideValue)) {
      result[key] = mergeRepositoryConfig(baseValue as Record<string, unknown>, overrideValue as Record<string, unknown>);
    }
  }
  return result;
}

function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key.replace(/_([a-z])/g, (_, character: string) => character.toUpperCase()), camelizeKeys(entry)]));
}

export function parseRepositoryConfig(raw: string | null): RepositoryConfig {
  if (!raw) return structuredClone(defaultRepositoryConfig);
  const parsed = camelizeKeys(YAML.parse(raw));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(".github/pi-bot.yml must contain a YAML object");
  }
  return mergeRepositoryConfig(defaultRepositoryConfig as unknown as Record<string, unknown>, parsed as Record<string, unknown>) as unknown as RepositoryConfig;
}

export function extractMentionCommand(body: string, appSlug: string): string | null {
  const mention = new RegExp(`(^|\\s)@${appSlug}(?:\\[bot\\])?(?=\\s|$)`, "i");
  if (!mention.test(body)) return null;
  return body.replace(mention, " ").trim() || "Please inspect the current issue or pull request and explain what you find.";
}
