export const games = {
  'football-legends': {
    title: 'Football Legends', genre: 'SPORT / 1V1', author: 'MADPUFFERS',
    description: 'A tiny pitch. A big difference in how people play.',
    explore: 'Watch two player profiles take on the built-in opponent. Follow their decisions, goals and concessions as they play.',
    findings: [{id: 'goal-camping', title: 'Goal camping enables long-range super shots', category: 'BALANCE',
      summary: 'Sheltering inside the raised goal lets a player defend while charging a shot that can score across the pitch.',
      evidence: 'A goal was reproduced against the native bot.', status: 'Reproduced'}],
  },
  ovo: {
    title: 'OvO', genre: 'PLATFORMER / 52 LEVELS', author: 'DEDRA GAMES',
    description: 'One course. Very different ways through it.',
    explore: 'Watch agents learn the ordinary route from level 1. Compare a first-time player with an experienced platformer player.',
    findings: [
      {id: 'left-wall-shortcut', title: 'Wall-jump shortcut bypasses level 9', category: 'LEVEL DESIGN',
        summary: 'Repeated wall jumps on the left side let a player skip the intended obstacle sequence and drop straight to the exit.',
        evidence: 'Native progression from level 9 to level 10 was reproduced.', status: 'Reproduced'},
      {id: 'credits-unlock', title: 'Credits logo unlocks all 52 levels', category: 'PROGRESSION',
        summary: 'Double-clicking the DEDRA logo in the credits reveals a built-in level unlock.',
        evidence: 'Native unlocked-level count changed from 1 to 52.', status: 'Hidden feature'},
    ],
  },
};
export const gameSlug = location.pathname.split('/')[1];
