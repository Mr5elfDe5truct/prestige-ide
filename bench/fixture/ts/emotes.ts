// Emote reactions, from Prestige's src/emotes.ts: the model can react to the user's message by starting its reply with
// a tag like [react: 😂], which is taken out of the streamed text and shown as a reaction instead.

export const EMOTES = ["👍", "❤️", "😂", "😮", "🔥", "🎩"];

/** A line for the system prompt when the user reacted to the previous reply. */
export const reactedNote = (emoji: string) => `The user reacted ${emoji} to your previous reply.`;

const TAG = /^\s*\[react:\s*([^\]\s][^\]]{0,15}?)\s*\]\s*/i;
const TAG_ANYWHERE = /\[react:\s*[^\]]{1,16}\]\s*/gi;

/** Holds back the start of a streamed reply until it's clear whether it opens with a [react: …] tag, then passes
 *  the text on without the tag. */
export function reactFilter(emit: (text: string) => void, onReact: (emoji: string) => void) {
  let held = "";
  let decided = false;
  const decide = (final: boolean) => {
    const m = TAG.exec(held);
    if (m) {
      decided = true;
      onReact(m[1].trim());
      const rest = held.slice(m[0].length);
      held = "";
      if (rest) emit(rest);
      return;
    }
    const t = held.trimStart();
    // Still possibly a tag: "[", "[re", "[react: 😂" with no "]" yet (and not too long to be one).
    const maybe = t === "" || ("[react:".startsWith(t.toLowerCase().slice(0, 7)) && t.length < 26 && !t.includes("]"));
    if (maybe && !final) return;
    decided = true;
    const out = held;
    held = "";
    if (out) emit(out);
  };
  return {
    push(text: string) {
      if (decided) return emit(text);
      held += text;
      decide(false);
    },
    /** The reply ended: let go of anything still held. */
    flush() {
      if (!decided) decide(true);
    },
  };
}

/** Removes a tag that turned up somewhere other than the start. */
export const stripTags = (text: string) => (text.includes("[react:") || text.includes("[React:") ? text.replace(TAG_ANYWHERE, "") : text);
