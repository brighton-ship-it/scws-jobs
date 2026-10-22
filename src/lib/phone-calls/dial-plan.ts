import { forwardTargets, lineFor, shopNumbers } from './config.ts';

export type InHoursDial = {
  shop: string[];
  mike: string | null;
  voicemail: boolean;
  /** No shop number, but Mike is on. The route dials him directly. */
  directToMike: boolean;
};

/**
 * In-hours dial list. Twilio's sequential timeout applies to each `<Number>`,
 * so a second shop number would not reach Mike until about 30 seconds.
 * When Mike is next, only the first shop number rings before him.
 */
export function selectInHoursDial(opts: {
  to: string;
  ring: string | null;
  lineKey: string | null;
  ai: string | null;
  env?: NodeJS.ProcessEnv;
}): InHoursDial {
  const env = opts.env ?? process.env;
  const line = lineFor(opts.to, opts.lineKey);
  const ring = (opts.ring ?? '').split(',').map((s) => s.trim()).filter((x) => /^\+\d{10,15}$/.test(x));
  const targets = (ring.length ? ring : line ? forwardTargets(line, env) : shopNumbers(env)).filter((n) => n !== opts.ai);
  if (line && (!targets.length || targets.includes(line.number))) {
    return { shop: [], mike: null, voicemail: true, directToMike: false };
  }
  if (!targets.length) {
    return { shop: [], mike: null, voicemail: !opts.ai, directToMike: Boolean(opts.ai) };
  }
  const mike = opts.ai;
  return { shop: mike ? targets.slice(0, 1) : targets, mike, voicemail: false, directToMike: false };
}
