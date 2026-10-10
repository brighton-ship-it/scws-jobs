import twilio from 'twilio';
import { publicUrl } from './config.ts';

export type Parsed = { params: Record<string, string>; valid: boolean };

/** Parse a Twilio form POST and validate X-Twilio-Signature against the public URL. */
export async function parseTwilio(req: Request, env: NodeJS.ProcessEnv = process.env): Promise<Parsed> {
  const fd = await req.formData();
  const params: Record<string, string> = {};
  fd.forEach((v, k) => { if (typeof v === 'string') params[k] = v; });
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  const sig = req.headers.get('x-twilio-signature');
  const valid = Boolean(token && sig && twilio.validateRequest(token, sig, publicUrl(req), params));
  return { params, valid };
}
