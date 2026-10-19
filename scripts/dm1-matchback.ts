/**
 * DM1 match-back report (run any time in the 90 days after mailing):
 *   node --experimental-strip-types scripts/dm1-matchback.ts [--csv /path/dm-test-2500.csv] [--ops https://scws-jobs.vercel.app --key $OPS_KEY]
 * Default: reads the live scorecard from /api/ops/direct-mail (needs office key in OPS_DASH_KEY).
 * With --clients file.json (array of {id,name,createdAt,addresses:[{street1,postalCode}]}) it matches offline against the hashed list.
 */
import { readFileSync } from 'node:fs';
import { matchByAddress, dm1Config } from '../src/lib/direct-mail/campaign.ts';
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const cfg = dm1Config();
const clientsFile = arg('--clients');
if (clientsFile) {
  const clients = JSON.parse(readFileSync(clientsFile, 'utf8'));
  const hits = matchByAddress(clients, cfg.mailMs);
  console.log(JSON.stringify({ scanned: clients.length, matchedByAddress: hits.length, matches: hits.map((h) => ({ id: h.id, name: h.name, createdAt: h.createdAt })) }, null, 2));
} else (async () => {
  const base = arg('--ops') || 'https://scws-jobs.vercel.app';
  const key = arg('--key') || process.env.OPS_DASH_KEY;
  const r = await fetch(`${base}/api/ops/direct-mail`, { headers: key ? { 'x-quotes-gp-key': key } : {} });
  console.log(r.status, JSON.stringify(await r.json(), null, 2));
})();
