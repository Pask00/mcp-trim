/**
 * Tracks invocation statistics and field profiles for auto-learning.
 * Stats are stored per-session via session-store.ts.
 */

/** Per-field tracking data */
export interface FieldStat {
  seen: number;
  charContribution: number;
  /** Number of times the agent marked this field as "used" via feedback */
  usedCount: number;
}

/** Per-tool profile tracking data */
export interface ToolProfile {
  invocations: number;
  firstSeen: string;
  lastSeen: string;
  fields: Record<string, FieldStat>;
  totalOriginalChars: number;
  totalTrimmedChars: number;
  ruleId?: string;
  /** Number of feedback entries received for this profile */
  feedbackCount: number;
}

/** Cumulative session stats */
export interface SessionStats {
  totalInvocations: number;
  totalOriginalChars: number;
  totalTrimmedChars: number;
  totalSavedChars: number;
  estimatedTokensSaved: number;
}

/** Root stats schema */
export interface StatsData {
  version: number;
  toolProfiles: Record<string, ToolProfile>;
  sessionStats: SessionStats;
}

const CHARS_PER_TOKEN = 4;

/**
 * Records a single tool invocation with its field analysis and trimming results.
 */
export function recordInvocation(
  stats: StatsData,
  toolName: string,
  fields: Map<string, { count: number; totalChars: number }>,
  originalChars: number,
  trimmedChars: number,
  ruleId?: string,
): StatsData {
  const now = new Date().toISOString();

  // Update or create tool profile
  const existing = stats.toolProfiles[toolName];
  const profile: ToolProfile = existing
    ? { ...existing }
    : {
        invocations: 0,
        firstSeen: now,
        lastSeen: now,
        fields: {},
        totalOriginalChars: 0,
        totalTrimmedChars: 0,
        feedbackCount: 0,
      };

  profile.invocations += 1;
  profile.lastSeen = now;
  profile.totalOriginalChars += originalChars;
  profile.totalTrimmedChars += trimmedChars;
  if (ruleId) profile.ruleId = ruleId;

  // Merge field stats
  for (const [path, info] of fields) {
    const existing = profile.fields[path];
    if (existing) {
      existing.seen += info.count;
      existing.charContribution += info.totalChars;
    } else {
      profile.fields[path] = { seen: info.count, charContribution: info.totalChars, usedCount: 0 };
    }
  }

  const savedChars = originalChars - trimmedChars;

  // Update session stats
  const session: SessionStats = {
    totalInvocations: stats.sessionStats.totalInvocations + 1,
    totalOriginalChars: stats.sessionStats.totalOriginalChars + originalChars,
    totalTrimmedChars: stats.sessionStats.totalTrimmedChars + trimmedChars,
    totalSavedChars: stats.sessionStats.totalSavedChars + savedChars,
    estimatedTokensSaved: Math.round(
      (stats.sessionStats.totalSavedChars + savedChars) / CHARS_PER_TOKEN,
    ),
  };

  return {
    ...stats,
    toolProfiles: { ...stats.toolProfiles, [toolName]: profile },
    sessionStats: session,
  };
}

/**
 * Records agent feedback — which fields were actually used from a tool response.
 * Increments usedCount on each listed field (by its per-field count) and feedbackCount on the profile.
 */
export function recordFeedback(
  stats: StatsData,
  toolName: string,
  usedFields: Record<string, number>,
  feedbacks: number = 1,
): StatsData {
  const existing = stats.toolProfiles[toolName];
  if (!existing) {
    // No profile for this key yet — nothing to record against
    return stats;
  }

  const profile: ToolProfile = { ...existing };
  profile.feedbackCount = (profile.feedbackCount ?? 0) + feedbacks;

  for (const [rawPath, count] of Object.entries(usedFields)) {
    // Normalize: strip array brackets (e.g., "items[].login" → "items.login")
    // because the field analyzer stores paths without brackets.
    const fieldPath = rawPath.replace(/\[\]/g, '');
    const field = profile.fields[fieldPath];
    if (field) {
      field.usedCount = (field.usedCount ?? 0) + count;
    }
    // If the field doesn't exist in the profile, ignore it —
    // the agent may have referenced a field we haven't tracked yet
  }

  return {
    ...stats,
    toolProfiles: { ...stats.toolProfiles, [toolName]: profile },
  };
}

/**
 * Resets all stats to defaults.
 */
export function resetStats(): StatsData {
  return {
    version: 1,
    toolProfiles: {},
    sessionStats: {
      totalInvocations: 0,
      totalOriginalChars: 0,
      totalTrimmedChars: 0,
      totalSavedChars: 0,
      estimatedTokensSaved: 0,
    },
  };
}
