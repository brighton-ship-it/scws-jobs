import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  VILLAGRANDO_JOB_NUMBER,
  VILLAGRANDO_PINHOLE_NOTES,
} from './fixtures/villagrando-pinhole.ts';
import {
  parseEquipment,
  parseTechNoteIntent,
  requireTechNoteIntent,
  TechNoteDoNotQuoteError,
  UnclearTechNoteIntentError,
} from './tech-note-intent.ts';

describe('Villagrando / Doug Pollack pinhole fixture (job 3266)', () => {
  it('is a pressure-tank swap, not a $600 pull-and-eval', () => {
    const parsed = requireTechNoteIntent({
      techNotes: VILLAGRANDO_PINHOLE_NOTES,
      jobTitle: `Job ${VILLAGRANDO_JOB_NUMBER} Gonzalo Villagrando / Doug Pollack`,
    });
    assert.equal(parsed.unclear, false);
    assert.equal(parsed.kind, 'pressure_tank');
    assert.ok(parsed.confidence >= 0.7);
    assert.equal(parsed.equipment.hp, 2);
    assert.equal(parsed.equipment.volts, 230);
    assert.equal(parsed.equipment.phase, 1);
    assert.equal(parsed.equipment.amps, 11.7);
    assert.equal(parsed.equipment.ampsNormal, true);
    assert.equal(parsed.equipment.pulledWell, false);
    assert.ok(!parsed.guesses.some((guess) => guess.kind === 'pull_and_eval' && guess.confidence >= 0.4));
  });

  it('treats 11.7A on 2hp 230 1ph as a normal nameplate, not a failed motor', () => {
    const equipment = parseEquipment(VILLAGRANDO_PINHOLE_NOTES);
    assert.equal(equipment.ampsNormal, true);
  });
});

describe('parseTechNoteIntent', () => {
  it('only classifies pull-and-eval when notes actually say pull/eval or out of the well', () => {
    const pull = parseTechNoteIntent({ techNotes: 'pump noisy, pull and eval' });
    assert.equal(pull.kind, 'pull_and_eval');
    assert.equal(pull.unclear, false);

    const out = parseTechNoteIntent({ techNotes: 'pump is out of the well, evaluate the motor' });
    assert.equal(out.kind, 'pull_and_eval');

    const noisy = parseTechNoteIntent({ techNotes: 'pump noisy' });
    assert.equal(noisy.unclear, true);
  });

  it('does not treat a bare motor replace as set-only without pump-out + GPM + depth', () => {
    const parsed = parseTechNoteIntent({
      techNotes: 'replace 2hp 230 volt single phase motor',
    });
    assert.equal(parsed.unclear, true);
    assert.equal(parsed.equipment.hp, 2);
    assert.equal(parsed.equipment.volts, 230);
    assert.equal(parsed.equipment.phase, 1);
  });

  it('quotes set-only Goulds GS + CentriPro when the pump is already out with HP/GPM/depth', () => {
    const parsed = requireTechNoteIntent({
      techNotes: 'pump is already out of the well, set 2hp 10 gpm 300 ft',
    });
    assert.equal(parsed.kind, 'pump_replace');
    assert.equal(parsed.equipment.pulledWell, true);
    assert.equal(parsed.equipment.hp, 2);
    assert.equal(parsed.equipment.gpm, 10);
    assert.equal(parsed.equipment.depthFt, 300);
  });

  it('does not quote good-to-go / on-site parts — the $200 call is the ticket', () => {
    assert.throws(
      () => requireTechNoteIntent({ techNotes: 'replaced cap and 40/60, good to go' }),
      (error: unknown) => {
        assert.ok(error instanceof TechNoteDoNotQuoteError);
        assert.equal(error.reason, 'service_call_ticket');
        return true;
      }
    );
    const parsed = parseTechNoteIntent({ techNotes: 'gauge replaced, pump saver installed on site' });
    assert.equal(parsed.doNotQuote, 'service_call_ticket');
    assert.notEqual(parsed.kind, 'pull_and_eval');
  });

  it('does not sell a tank for precharge-low-only with normal amps', () => {
    assert.throws(
      () =>
        requireTechNoteIntent({
          techNotes: '2hp 230 volt single phase 11.7 amps precharge low, tank not leaking',
        }),
      (error: unknown) => {
        assert.ok(error instanceof TechNoteDoNotQuoteError);
        assert.equal(error.reason, 'precharge_only');
        return true;
      }
    );
  });

  it('does not quote warranty / no charge notes', () => {
    assert.throws(
      () => requireTechNoteIntent({ techNotes: 'warranty, no charge' }),
      (error: unknown) => {
        assert.ok(error instanceof TechNoteDoNotQuoteError);
        assert.equal(error.reason, 'warranty');
        return true;
      }
    );
  });

  it('treats control box / pump saver with the pump still in as controls, not a pull', () => {
    const parsed = requireTechNoteIntent({
      techNotes: 'needs a new control box and pressure switch',
    });
    assert.equal(parsed.kind, 'controls');
    assert.equal(parsed.equipment.pulledWell, false);
  });

  it('classifies short to ground as pull-and-eval', () => {
    const ramona = parseTechNoteIntent({ techNotes: 'short to ground, needs pull' });
    assert.equal(ramona.kind, 'pull_and_eval');
    assert.equal(ramona.unclear, false);
  });

  it('returns a structured guess list when intent is unclear', () => {
    assert.throws(
      () => requireTechNoteIntent({ techNotes: 'customer wants a quote' }),
      (error: unknown) => {
        assert.ok(error instanceof UnclearTechNoteIntentError);
        assert.ok(error.guesses.length >= 1);
        assert.equal(error.guesses[0]?.kind, 'other');
        return true;
      }
    );
  });
});
