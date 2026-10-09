// Streams a reply into a message, taking a leading [react: …] tag out of it (a small piece of Prestige's chat).
import { reactFilter, stripTags } from "./emotes.ts";

export interface Message {
  text: string;
  reaction?: string;
}

/** Feeds streamed chunks through the reaction filter and returns the finished message. */
export function collectReply(chunks: string[]): Message {
  const msg: Message = { text: "" };
  const filter = reactFilter(
    (t) => (msg.text += t),
    (emoji) => (msg.reaction = emoji),
  );
  for (const c of chunks) filter.push(c);
  filter.flush();
  msg.text = stripTags(msg.text);
  return msg;
}

/** A second filter for the "read aloud" path, which only needs the text. */
export function spokenText(chunks: string[]): string {
  let out = "";
  const f = reactFilter((t) => (out += t), () => {});
  chunks.forEach((c) => f.push(c));
  f.flush();
  return out;
}
