import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKED_SERVICE_EMAILS,
  SERVICE_TECH_ROSTER,
  TECH_BRIAN_EADS,
  TECH_COWIN,
  assignShopTech,
  isAllowlistedTechId,
  isBlockedAssignee,
  resolveTechUserId,
  userMatchesTech,
} from './tech-assignment.ts';

const TRAVIS = {
  id: 'user-travis',
  name: { full: 'Travis C Sego' },
  email: { raw: 'travis@scwellservice.com' },
};
const BRIGHTON = {
  id: 'user-brighton',
  name: { full: 'Brighton Scala' },
  email: { raw: 'brighton@scwellservice.com' },
};
const HAZE = {
  id: 'user-haze',
  name: { full: 'Haze Tarbell' },
  email: { raw: 'hazemtarbell@gmail.com' },
};
const CHRIS = {
  id: 'user-chris',
  name: { full: 'Chris Glass' },
  email: { raw: 'christopher@scwellservice.com' },
};
const SCHROEDER = {
  id: 'user-schroeder',
  name: { full: 'Brian Schroeder' },
  email: { raw: 'bschroeder@scwellservice.com' },
};
const BRIAN = {
  id: 'user-brian',
  name: { full: 'Brian Eads' },
  email: { raw: 'brian@scwellservice.com' },
};
const COWIN = {
  id: 'user-cowin',
  name: { full: 'Cowin' },
  email: { raw: 'cowin@scwellservice.com' },
};

describe('assignShopTech', () => {
  it('sends Anza / high-desert to Cowin', () => {
    assert.equal(assignShopTech({ city: 'Anza' }).name, TECH_COWIN);
    assert.equal(assignShopTech({ city: 'Anza' }).email, SERVICE_TECH_ROSTER.cowin.email);
    assert.equal(assignShopTech({ city: 'Aguanga' }).name, TECH_COWIN);
    assert.equal(assignShopTech({ address: '12 Well Rd', zip: '92539' }).name, TECH_COWIN);
    assert.equal(assignShopTech({ city: 'Hemet' }).name, TECH_COWIN);
  });

  it('sends west/central San Diego to Brian Eads', () => {
    assert.equal(assignShopTech({ city: 'Ramona' }).name, TECH_BRIAN_EADS);
    assert.equal(assignShopTech({ city: 'Ramona' }).email, SERVICE_TECH_ROSTER.brian.email);
    assert.equal(assignShopTech({ city: 'Escondido' }).name, TECH_BRIAN_EADS);
    assert.equal(assignShopTech({ city: 'Poway' }).name, TECH_BRIAN_EADS);
    assert.equal(assignShopTech({ city: 'Valley Center' }).name, TECH_BRIAN_EADS);
    assert.equal(assignShopTech({ zip: '92065' }).name, TECH_BRIAN_EADS);
  });
});

describe('service tech identity — roster emails, not name guesses', () => {
  const roster = [TRAVIS, BRIGHTON, HAZE, CHRIS, SCHROEDER, BRIAN, COWIN];

  it('resolves Jobber ids from repo emails brian@ / cowin@', () => {
    const cowin = assignShopTech({ city: 'Anza' });
    const brian = assignShopTech({ city: 'Ramona' });
    assert.deepEqual(resolveTechUserId(cowin, roster, {}), { id: 'user-cowin', name: 'Cowin' });
    assert.deepEqual(resolveTechUserId(brian, roster, {}), { id: 'user-brian', name: 'Brian Eads' });
  });

  it('never matches Travis, Brighton, Haze, Chris, or Brian Schroeder', () => {
    const brian = assignShopTech({ city: 'Ramona' });
    const cowin = assignShopTech({ city: 'Anza' });
    for (const blocked of [TRAVIS, BRIGHTON, HAZE, CHRIS, SCHROEDER]) {
      assert.equal(userMatchesTech(blocked, brian), false);
      assert.equal(userMatchesTech(blocked, cowin), false);
      assert.equal(isBlockedAssignee(blocked), true);
    }
    assert.equal(resolveTechUserId(brian, [TRAVIS, SCHROEDER], {}), null);
    assert.equal(resolveTechUserId(cowin, [TRAVIS, HAZE, CHRIS], {}), null);
  });

  it('rejects an env id that points at Travis instead of the roster tech', () => {
    const cowin = assignShopTech({ city: 'Anza' });
    assert.equal(
      resolveTechUserId(cowin, roster, { JOBBER_TECH_COWIN_ID: TRAVIS.id }),
      null
    );
    assert.equal(
      resolveTechUserId(cowin, roster, { JOBBER_TECH_COWIN_ID: COWIN.id })?.id,
      'user-cowin'
    );
  });

  it('does not treat first-name Brian as Brian Eads', () => {
    const brian = assignShopTech({ city: 'Ramona' });
    assert.equal(
      userMatchesTech({ id: 'x', name: { full: 'Brian' }, email: { raw: '' } }, brian),
      false
    );
    assert.ok(BLOCKED_SERVICE_EMAILS.has('travis@scwellservice.com'));
  });

  it('isAllowlistedTechId requires the resolved Jobber id', () => {
    assert.equal(isAllowlistedTechId('user-travis', 'user-brian'), false);
    assert.equal(isAllowlistedTechId('user-brian', 'user-brian'), true);
    assert.equal(isAllowlistedTechId(null, 'user-brian'), false);
  });
});
