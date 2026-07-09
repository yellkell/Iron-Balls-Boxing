/**
 * EMBER's tutorial script — the single source of truth for every voiced line.
 * Each entry's `id` is the audio asset filename (src/assets/tutor/<id>.mp3,
 * recorded per docs/tutorial-ember.md) and `text` is the subtitle caption the
 * plate under the orb mirrors, so the tutorial reads correctly even before
 * (or without) the voice clips being present.
 */

export interface TutorLine {
  /** Asset stem — `src/assets/tutor/<id>.mp3`. */
  id: string;
  /** Caption text, shown on the subtitle plate while the line plays. */
  text: string;
}

export const LINES = {
  // Beat 0 — attention & setup
  overHere: { id: 'e010-over-here', text: 'Over here.' },
  hello: {
    id: 'e011-hello',
    text: "There you are. Hello, I'm Ember. Your guide, and statistically, your biggest fan.",
  },
  begin: {
    id: 'e012-begin',
    text: "Clear yourself a little room, Clanker. Then press the button here, and we'll begin.",
  },

  // Beat 1 — ignite
  ignite: { id: 'e020-ignite', text: "Hold the trigger. Keep holding. You're spinning up a fireball." },
  igniteDone: { id: 'e021-ignite-done', text: 'There it is. Well done.' },
  igniteRetry: { id: 'e022-ignite-retry', text: "Hold, don't tap. It needs a moment to catch." },

  // Beat 2 — throw
  throwIt: {
    id: 'e030-throw',
    text: "See this rust bucket? Punch towards him, and release the trigger at the end of the swing. I'll mark the spot.",
  },
  throwDone: { id: 'e031-throw-done', text: 'Good job. He felt that.' },
  throwSoft: { id: 'e032-throw-soft', text: 'Almost. Commit to the punch.' },

  // Beat 3 — recall
  recall: {
    id: 'e040-recall',
    text: 'Pull the trigger again to call it home. Littering is a crime in Gasket.',
  },
  recallDone: {
    id: 'e041-recall-done',
    text: "Caught. Throw, recall, catch. That's the heartbeat of everything. Well done.",
  },

  // Beat 4 — block
  block: {
    id: 'e050-block',
    text: "This one keeps you alive. A spinning ball is a shield. Spin one up, hold it close. He's going to throw at you.",
  },
  blockIncoming: { id: 'e051-block-incoming', text: 'Incoming.' },
  blockDone: { id: 'e052-block-done', text: 'Blocked. Well done. Again, a little faster this time.' },
  blockRetry: {
    id: 'e053-block-retry',
    text: "You're fine. Get your fireball spinning around your hand, and punch the oncoming ball to block. Again.",
  },
  blockTwo: { id: 'e054-block-two', text: "Two for two. You're a natural, Clanker." },

  // Beat 5 — move
  move: {
    id: 'e060-move',
    text: 'Blocking is good. Not being there is better. Movement is everything, Clanker. When I call a side, move. Whole body.',
  },
  moveLeft: { id: 'e061-move-left', text: 'Left.' },
  moveRight: { id: 'e062-move-right', text: 'Right.' },
  moveRetry: { id: 'e063-move-retry', text: 'Bigger steps. Off the line. Again.' },
  moveDone: {
    id: 'e064-move-done',
    text: "Lovely footwork. The Sheriff says Clankers can't dance. The Sheriff is wrong.",
  },

  // Beat 6 — attachments
  attach: { id: 'e070-attach', text: 'Now, my favourite part. Come look. This is your ball loadout.' },
  attachList: {
    id: 'e071-attach-list',
    text: 'Split breaks it into three on the way home. Grow makes it big and mean. Shrink makes it small and spiteful. Curve bends around their guard. Pick one.',
  },
  attachTest: { id: 'e072-attach-test', text: "Good choice. Now throw at him, and recall while it's still flying." },
  attachDone: { id: 'e073-attach-done', text: 'Did you see that? I never tire of that one. Well done.' },
  attachFree: { id: 'e074-attach-free', text: "Try the others if you like. Press the button when you're ready." },
  attachLate: { id: 'e075-attach-retry', text: "Recall while it's still in the air. Timing is everything." },

  // Beat 7 — graduation
  grad: {
    id: 'e080-grad',
    text: "That's everything I've got, and look at you now. Knock him down, and you're done. Make me proud, Rookie.",
  },
  fightHit: { id: 'e081-fight-hit', text: 'There it is.' },
  fightTaken: { id: 'e082-fight-taken', text: "Shake it off. You're iron, remember?" },
  fightLow: { id: 'e083-fight-low', text: "He's wobbling. Finish it." },
  win: {
    id: 'e084-win',
    text: "Down goes the rust bucket. Well done, well done, well done. Go check out the locker and the store, get yourself some drip. Gasket's waiting for you, Clanker.",
  },
  lose: {
    id: 'e085-lose',
    text: "Up you get. He's been at this for years. You, about ten minutes. Come back swinging. I'll be here.",
  },

  // Praise pool — repeat successes; rotate, never repeating the last pick.
  praiseGoodJob: { id: 'e100-good-job', text: 'Good job.' },
  praiseWellDone: { id: 'e101-well-done', text: 'Well done.' },
  praiseNice: { id: 'e102-nice', text: 'Nice.' },
  praiseThatsIt: { id: 'e103-thats-it', text: "That's it." },
  praisePerfect: { id: 'e104-perfect', text: 'Perfect.' },

  // Long-idle nudge, any beat.
  noRush: { id: 'e110-no-rush', text: "No rush. Whenever you're ready." },
} as const satisfies Record<string, TutorLine>;

export type LineKey = keyof typeof LINES;

/** Small wins that already had their scripted moment draw from this pool. */
export const PRAISE_POOL: LineKey[] = [
  'praiseGoodJob',
  'praiseWellDone',
  'praiseNice',
  'praiseThatsIt',
  'praisePerfect',
];

/**
 * Estimated spoken duration when the clip hasn't decoded (or was never
 * shipped) — the caption plate and line sequencing run off this instead, so
 * the tutorial is fully playable silent.
 */
export function estimateLineSeconds(text: string): number {
  return 0.7 + text.split(/\s+/).length * 0.34;
}
