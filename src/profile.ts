import { CAMPAIGN, levelFor, regionFor, validDiscovery, type Mode } from './content.js';

export interface Profile {
  xp: number;
  cleared: string[];
  discoveries: string[];
  scores: Record<string, number>;
}
export interface Reward {
  id: string;
  missionId: string;
  mode: Exclude<Mode, 'arena'>;
  discoveries: string[];
  score: number;
  seed: number;
}
export const blankProfile = (): Profile => ({ xp: 0, cleared: [], discoveries: [], scores: {} });

export function parseReward(value: unknown): Reward | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Partial<Reward>;
  const missionId = CAMPAIGN.find(mission => mission.id === item.missionId)?.id;
  if (!missionId || typeof item.id !== 'string' || !/^(?:local|online)-[\w-]{16,80}$/.test(item.id)) return null;
  const mode = (['adventure', 'challenge', 'expedition'] as const).find(mode => mode === item.mode);
  if (!mode || !Number.isInteger(item.seed) || (item.seed as number) < 0 || (item.seed as number) > 4294967295
   || !Number.isInteger(item.score) || (item.score as number) < 0 || (item.score as number) > 100000 || !Array.isArray(item.discoveries)) return null;
  const discoveries = [...new Set(item.discoveries.filter(id => typeof id === 'string' && validDiscovery(id) && id.startsWith(regionFor(missionId).id + ':')))];
  return { id: item.id, missionId, mode, score: item.score as number, seed: item.seed as number, discoveries };
}

export function applyReward(profile: Profile, reward: Reward): Profile {
  const cleared = profile.cleared.includes(reward.missionId);
  const discoveries = reward.discoveries.filter(id => !profile.discoveries.includes(id));
  const boss = CAMPAIGN.some(mission => mission.id === reward.missionId && mission.objective === 'boss');
  const xp = (reward.mode === 'adventure' ? cleared ? 35 : boss ? 160 : 100 : reward.mode === 'expedition' ? 90 : 55) + 45 * discoveries.length;
  const key = reward.mode === 'expedition' ? 'expedition:' + reward.seed : reward.mode + ':' + reward.missionId;
  return {
    xp: Math.min(999999, profile.xp + xp),
    cleared: reward.mode === 'adventure' && !cleared ? [...profile.cleared, reward.missionId] : [...profile.cleared],
    discoveries: [...profile.discoveries, ...discoveries],
    scores: { ...profile.scores, [key]: Math.max(reward.score, profile.scores[key] ?? 0) }
  };
}

export const unlockLevel = (profile: Profile) => levelFor(profile.xp);
