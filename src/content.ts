export type Objective = 'rescue' | 'relay' | 'escape' | 'boss';
export type Feature = 'roots' | 'reeds' | 'ice' | 'rails' | 'vents' | 'shutters';
export type Gadget = 'standard' | 'long' | 'directional' | 'shield';
export type Critter = 'hare' | 'fox' | 'frog' | 'mole' | 'owl' | 'cat';
export type Mode = 'adventure' | 'arena' | 'challenge' | 'expedition';

export const WIDTH = 15;
export const HEIGHT = 11;
export const TICK_RATE = 30;
export const BASE_BOMB_RANGE = 1;
export const ROOT_LANCE_BONUS = 2;
export const ARENA_TEAMS = [
  { name: 'Gold', color: '#ffda7d', shape: 'diamond' },
  { name: 'Lavender', color: '#d9beff', shape: 'circle' }
] as const;

export const CRITTERS: Record<Critter, { name: string; species: string; color: string; unlock: number }> = {
  hare: { name: 'Pip', species: 'Hare', color: '#f5ca6d', unlock: 1 },
  fox: { name: 'Bramble', species: 'Fox', color: '#ef9472', unlock: 1 },
  frog: { name: 'Moss', species: 'Frog', color: '#a4ca85', unlock: 1 },
  mole: { name: 'Button', species: 'Mole', color: '#cbb2df', unlock: 1 },
  owl: { name: 'Juniper', species: 'Owl', color: '#a2c5e0', unlock: 4 },
  cat: { name: 'Clover', species: 'Cat', color: '#e8b0a7', unlock: 7 }
};

export const GADGETS: Record<Gadget, { name: string; detail: string; unlock: number; fuse: number }> = {
  standard: { name: 'Acorn bomb', detail: 'Blast in all four directions.', unlock: 1, fuse: 72 },
  long: { name: 'Slowburn', detail: 'Four-way blast with more time to escape.', unlock: 2, fuse: 108 },
  directional: { name: 'Root lance', detail: 'Blast only the way you face.', unlock: 3, fuse: 72 },
  shield: { name: 'Bark shield', detail: 'Block one hit per chamber or round.', unlock: 5, fuse: 72 }
};
export const bombFuseFor = (gadget: Gadget, quick: boolean) => GADGETS[gadget].fuse - (quick ? 20 : 0);

export interface Mission {
  id: string;
  name: string;
  briefing: string;
  objective: Objective;
  chambers: number;
}

interface Region {
  id: Feature;
  name: string;
  area: string;
  mechanic: string;
  boss: string;
  palette: [string, string, string, string];
  discoveries: [string, string];
  missions: Mission[];
}

function missions(id: Feature, items: [string, string][], order: [Objective, Objective, Objective]): Mission[] {
  return items.map(([name, briefing], i) => ({
    id: id + '-' + (i + 1), name, briefing, objective: order[i] ?? 'boss', chambers: [3, 3, 4, 3][i]
  }));
}

export const REGIONS: Region[] = [
  {
    id: 'roots', name: 'Rootwarren', area: 'The Woodland Burrows', mechanic: 'A chain reaction near a root gate opens it.',
    boss: 'The Briarback', palette: ['#536341', '#485b3c', '#6e7c51', '#b8834d'],
    discoveries: ['Amber acorn', 'Fern fossil'],
    missions: missions('roots', [
      ['Beneath the Bramble', 'Learn to dodge a blast, lure a moth, and open a root gate.'],
      ['Root Signal', 'Blast each relay. Chain bombs to open the root gates.'],
      ['The Long Way Round', 'Find the exit before the tunnels close.'],
      ['The Briarback', 'Dodge the charge. Strike while the Briarback is stunned.']
    ], ['rescue', 'relay', 'escape'])
  },
  {
    id: 'reeds', name: 'Reedwater', area: 'The Rushlight Marsh', mechanic: 'Tall reeds block fire but let critters pass.',
    boss: 'The Reed King', palette: ['#486259', '#3e564e', '#688b78', '#bd925c'],
    discoveries: ['Glass snail', 'Rushlight flute'],
    missions: missions('reeds', [
      ['Lanterns in the Rushes', 'Send a signal from each lantern before crossing the marsh.'],
      ['Low Tide', 'Race through the channels while the crossings are clear.'],
      ['Reed Rescue', 'Search the pockets behind tall reeds for the missing kits.'],
      ['The Reed King', 'The king tears through reeds. Catch him after the charge.']
    ], ['relay', 'escape', 'rescue'])
  },
  {
    id: 'ice', name: 'Frosthollow', area: 'The Blueglass Caverns', mechanic: 'Bombs slide on ice in the direction you face.',
    boss: 'The Glacier Snout', palette: ['#506776', '#435c70', '#83a5b7', '#b78375'],
    discoveries: ['Snow quartz', 'Bluebell in ice'],
    missions: missions('ice', [
      ['First Thaw', 'Slide bombs into the ice corridors and find a route out.'],
      ['Lost Mitten', 'Free the kits sheltering on both sides of the cave.'],
      ['Blueglass Beacon', 'Slide charges toward the distant signal relays.'],
      ['The Glacier Snout', 'The Snout freezes its trail. Slide a bomb into its path.']
    ], ['escape', 'rescue', 'relay'])
  },
  {
    id: 'rails', name: 'Copperdeep', area: 'The Old Mine', mechanic: 'Rail lamps flash before a minecart sweeps its lane.',
    boss: 'The Copper Claw', palette: ['#675847', '#5b4b3f', '#8f7356', '#c88656'],
    discoveries: ['Miner’s badge', 'Copper cicada'],
    missions: missions('rails', [
      ['Crossing Bell', 'Trigger the switches between passing minecarts.'],
      ['End of the Line', 'Find the exit by switching between the two rail lanes.'],
      ['Shift Change', 'Get the missing kits clear of the active tracks.'],
      ['The Copper Claw', 'The claw shoves bombs down the rails. Watch where they land.']
    ], ['relay', 'escape', 'rescue'])
  },
  {
    id: 'vents', name: 'Sporelight', area: 'The Mushroom Vault', mechanic: 'Fungal vents warn before releasing a cross of spores.',
    boss: 'The Puffcap', palette: ['#5d5273', '#514669', '#8773a0', '#b7766c'],
    discoveries: ['Mooncap print', 'Glow beetle shell'],
    missions: missions('vents', [
      ['Glowcap Nursery', 'Pick a gap between spore bursts and get the kits home.'],
      ['Spore Circuit', 'Ignite relays while the vents cycle.'],
      ['The Breathing Tunnel', 'Watch the warning rings and move between bursts.'],
      ['The Puffcap', 'Dodge the Puffcap’s spore cross, then strike while it’s stunned.']
    ], ['rescue', 'relay', 'escape'])
  },
  {
    id: 'shutters', name: 'Emberforge', area: 'The Warmstone Works', mechanic: 'Timed shutters block movement and blasts while closed.',
    boss: 'The Kilnkeeper', palette: ['#765753', '#644743', '#a47361', '#cc9561'],
    discoveries: ['Kiln token', 'Obsidian button'],
    missions: missions('shutters', [
      ['The Second Bell', 'Time the shutters and reach the far exit.'],
      ['Keepers of the Kiln', 'Reach trapped kits through the shutter galleries.'],
      ['The Last Signal', 'Set every relay off before the forge resets.'],
      ['The Kilnkeeper', 'The Kilnkeeper charges twice. Wait for the second strike.']
    ], ['escape', 'rescue', 'relay'])
  }
];

export const CAMPAIGN = REGIONS.flatMap(region => region.missions);
export const levelFor = (xp: number) => Math.min(20, 1 + Math.floor(xp / 100));
export const regionFor = (missionId: string) => REGIONS.find(region => region.missions.some(mission => mission.id === missionId)) ?? REGIONS[0];
export const missionFor = (id: string) => CAMPAIGN.find(mission => mission.id === id) ?? CAMPAIGN[0];
export function campaignEntry(id: string, offset = 0) {
  const index = CAMPAIGN.findIndex(mission => mission.id === id);
  const mission = index < 0 ? undefined : CAMPAIGN[index + offset];
  return mission && { missionId: mission.id, seed: (index + offset) * 109 + 117 };
}
export const arenaOptions = REGIONS.map(region => ({ id: region.id, name: region.name + ' Arena' }));

export function expeditionFor(now: number) {
  const week = Math.floor((now - Date.UTC(2026, 0, 5)) / (7 * 86400000));
  const offset = ((week % REGIONS.length) + REGIONS.length) % REGIONS.length;
  return { seed: (week + 87329) >>> 0, missionId: REGIONS[offset].missions[week % 2 === 0 ? 1 : 2].id, week };
}

export function validDiscovery(id: string) {
  return REGIONS.some(region => id === region.id + ':0' || id === region.id + ':1');
}
