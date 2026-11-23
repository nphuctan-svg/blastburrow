import { HEIGHT, WIDTH, type Mode } from './content.js';
import type { Point } from './engine.js';

type LessonKind = 'corner' | 'lure' | 'chain';
export type MarkKind = 'bomb' | 'cover' | 'first' | 'second';

export interface RootwarrenLesson {
  kind: LessonKind;
  title: string;
  briefing: string;
  hint: string;
  cells: string[];
  marks: { point: Point; kind: MarkKind }[];
  gate?: Point;
}

const markKinds: Record<string, MarkKind> = { B: 'bomb', H: 'cover', '1': 'first', '2': 'second' };

function lesson(kind: LessonKind, title: string, briefing: string, hint: string, rows: string[]): RootwarrenLesson {
  if (rows.length !== HEIGHT || rows.some(row => row.length !== WIDTH)) {
    throw new Error('Invalid Rootwarren chamber dimensions for ' + title);
  }
  const cells = rows.join('').split('');
  const marks = cells.flatMap((symbol, index) => Object.hasOwn(markKinds, symbol)
    ? [{ point: { x: index % WIDTH, y: Math.floor(index / WIDTH) }, kind: markKinds[symbol] }] : []);
  const gate = cells.indexOf('G');
  return { kind, title, briefing, hint, cells, marks,
    gate: gate < 0 ? undefined : { x: gate % WIDTH, y: Math.floor(gate / WIDTH) } };
}

const openingLessons = [
  lesson('corner', 'Around the Hedge', 'Blast the kit’s crate and turn into the leaf-marked nook.', 'Plant on the gold mark. Back up, then turn up into cover.', [
    '###############',
    '#a.c....#######',
    '#.#.#.#.#######',
    '#b.d+.C.#######',
    '#F#.#.#.#######',
    '#.....C.#######',
    '#####H#########',
    '#####.BK......#',
    '#########.#.#.#',
    '#########....E#',
    '###############'
  ]),
  lesson('lure', 'Moth and Fuse', 'Draw the moth down the lane and leave a bomb in its path.', 'Get its attention at the gold mark, plant a bomb, then duck around the corner.', [
    '###############',
    '###############',
    '#.E..##########',
    '#abcd.#########',
    '#....H#########',
    '#.....B..M#####',
    '#.#.###########',
    '#.#RC##########',
    '#....##########',
    '###############',
    '###############'
  ]),
  lesson('chain', 'The Second Spark', 'Break the crate to find an extra bomb, then chain two bombs to open the root gate.', 'Plant on 1 and 2, then back up and turn into the nook.', [
    '###############',
    '###############',
    '#abcd##########',
    '#.....#########',
    '#.#H###########',
    '#..+.21G......#',
    '#########.#.#.#',
    '#########.....#',
    '#########.#.E.#',
    '###############',
    '###############'
  ])
];

export function rootwarrenLesson(mode: Mode, missionId: string, chamber: number): RootwarrenLesson | undefined {
  if ((mode === 'adventure' || mode === 'challenge') && missionId === 'roots-1') return openingLessons[chamber];
}
