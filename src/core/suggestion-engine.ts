/**
 * Analyzes tracked stats to suggest field-trimming rules.
 * Identifies high-savings opportunities and proposes keep lists.
 */

import type { StatsData, ToolProfile } from './stats-tracker.js';
import type { TrimConfig, TrimRule, KeepShape } from '../types.js';

/** A suggested rule with savings estimates */
export interface SuggestedRule {
  /** Proposed rule ID */
  id: string;
  /** Tool name this suggestion is based on */
  toolName: string;
  /** Number of invocations observed */
  invocations: number;
  /** Proposed keep shape */
  keep: KeepShape;
  /** Proposed match criteria */
  match: { toolName?: string };
  /** Estimated savings per invocation (chars) */
  estimatedSavingsChars: number;
  /** Estimated savings percentage */
  estimatedSavingsPercent: number;
  /** Confidence score 0-1 based on number of observations */
  confidence: number;
}

export interface SuggestionOptions {
  /** Minimum invocations before suggesting (default: 5) */
  minInvocations?: number;
  /** Minimum feedback entries before suggesting a rule (default: 3) */
  minFeedback?: number;
}

const DEFAULT_OPTIONS: Required<SuggestionOptions> = {
  minInvocations: 5,
  minFeedback: 3,
};

/**
 * Analyzes tracked tool profiles and suggests rules for unruled tools.
 * Only suggests for tools that don't already have a matching rule.
 */
export function suggestRules(
  stats: StatsData,
  config: TrimConfig,
  options?: SuggestionOptions,
): SuggestedRule[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const suggestions: SuggestedRule[] = [];

  for (const [toolName, profile] of Object.entries(stats.toolProfiles)) {
    // Skip if already has an active rule
    if (profile.ruleId && config.rules.some((r) => r.id === profile.ruleId && r.enabled !== false)) {
      continue;
    }

    // Skip if too few observations
    if (profile.invocations < opts.minInvocations) continue;

    const suggestion = analyzeProfile(toolName, profile, opts);
    if (suggestion) {
      suggestions.push(suggestion);
    }
  }

  // Sort by estimated total savings (most impactful first)
  suggestions.sort((a, b) =>
    (b.estimatedSavingsChars * b.invocations) - (a.estimatedSavingsChars * a.invocations),
  );

  return suggestions;
}

/**
 * Filters a list of dot-notation paths to only include "root" paths —
 * paths whose ancestor is NOT also in the list.
 * Prevents double-counting when parent charContribution already includes children.
 */
function topLevelPaths(paths: string[]): string[] {
  return paths.filter(path => {
    const parts = path.split('.');
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('.');
      if (paths.includes(ancestor)) return false;
    }
    return true;
  });
}

function analyzeProfile(
  toolName: string,
  profile: ToolProfile,
  opts: Required<SuggestionOptions>,
): SuggestedRule | null {
  const fieldEntries = Object.entries(profile.fields);
  if (fieldEntries.length === 0) return null;

  const totalFieldChars = fieldEntries.reduce((sum, [, f]) => sum + f.charContribution, 0);
  if (totalFieldChars === 0) return null;

  // Require feedback — auto-learn only works with actual usage data
  if ((profile.feedbackCount ?? 0) < opts.minFeedback) return null;

  // Keep fields the agent has used at least once
  const keepPaths: string[] = [];
  const dropPaths: string[] = [];
  for (const [path, stat] of fieldEntries) {
    if ((stat.usedCount ?? 0) >= 1) {
      keepPaths.push(path);
    } else {
      dropPaths.push(path);
    }
  }

  // Safety: always keep at least one field
  if (keepPaths.length === 0 && fieldEntries.length > 0) {
    keepPaths.push(fieldEntries[0][0]);
    const idx = dropPaths.indexOf(fieldEntries[0][0]);
    if (idx >= 0) dropPaths.splice(idx, 1);
  }

  // Calculate savings from dropping fields.
  // Only count top-level drops — parent charContribution already includes children,
  // so counting both parent and child would double-count.
  const rootDrops = topLevelPaths(dropPaths);
  const droppedChars = rootDrops.reduce((sum, path) => {
    const f = profile.fields[path];
    return sum + (f?.charContribution ?? 0);
  }, 0);

  const avgOriginalChars = profile.totalOriginalChars / profile.invocations;
  const estimatedSavingsChars = Math.round(droppedChars / profile.invocations);
  const estimatedSavingsPercent = avgOriginalChars > 0
    ? Math.min(99, Math.round((estimatedSavingsChars / avgOriginalChars) * 100))
    : 0;

  const keepShape = buildKeepShape(keepPaths);
  const confidence = Math.min(1, profile.invocations / 10);
  const id = `auto-${toolName.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}`;

  return {
    id,
    toolName,
    invocations: profile.invocations,
    keep: keepShape,
    match: { toolName },
    estimatedSavingsChars,
    estimatedSavingsPercent,
    confidence,
  };
}

/**
 * Builds a KeepShape from a list of dot-notation field paths.
 * e.g., ["id", "name", "owner.login", "owner.id"] →
 *   { id: true, name: true, owner: { login: true, id: true } }
 */
function buildKeepShape(paths: string[]): KeepShape {
  const shape: KeepShape = {};

  for (const path of paths) {
    const parts = path.split('.');
    let current = shape;

    for (let i = 0; i < parts.length; i++) {
      const key = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        // Only set to true if not already an object (don't overwrite nested shapes)
        if (!(key in current) || current[key] === true) {
          current[key] = true;
        }
      } else {
        // Ensure intermediate nodes are objects
        if (!(key in current) || current[key] === true) {
          current[key] = {};
        }
        current = current[key] as KeepShape;
      }
    }
  }

  return shape;
}

/**
 * Converts a suggestion to a TrimRule ready to be inserted into config.
 */
export function suggestionToRule(suggestion: SuggestedRule): TrimRule {
  return {
    id: suggestion.id,
    description: `Auto-suggested: ~${suggestion.estimatedSavingsPercent}% savings (${suggestion.invocations} observations)`,
    match: suggestion.match,
    keep: Object.keys(suggestion.keep).length > 0 ? suggestion.keep : undefined,
    enabled: true,
  };
}
