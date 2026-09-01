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

  it('uses named 2hp 230 1ph on a motor replace and does not invent HP', () => {
    const parsed = requireTechNoteIntent({
      techNotes: 'replace 2hp 230 volt single phase motor',
    });
    assert.equal(parsed.kind, 'pump_replace');
    assert.equal(parsed.equipment.hp, 2);
    assert.equal(parsed.equipment.volts, 230);
    assert.equal(parsed.equipment.phase, 1);
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
