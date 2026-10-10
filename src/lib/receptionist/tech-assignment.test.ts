import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKED_SERVICE_EMAILS,
  SERVICE_TECH_ROSTER,
  TECH_BRIAN_EADS,
  TECH_COWIN,
  TECH_DOUG_POLLACK,
  allowedTechSpokenName,
  allowedTechsForLocation,
  assignShopTech,
  assignShopTerritory,
  formatTechNames,
  isAllowlistedTechId,
  isBlockedAssignee,
  fallbackTechs,
  resolveFallbackTechs,
  resolveTechUserId,
  resolveTechsForLocation,
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
const DOUG = {
  id: 'user-doug',
  name: { full: 'Doug Pollack' },
  email: { raw: '' },
};

describe('assignShopTerritory / allowed techs', () => {
  it('sends Anza / high-desert to Doug Pollack or Cowin (Doug first)', () => {
    assert.equal(assignShopTerritory({ city: 'Anza' }), 'anza');
    assert.deepEqual(
      allowedTechsForLocation({ city: 'Anza' }).map((tech) => tech.name),
      [TECH_DOUG_POLLACK, TECH_COWIN]
    );
    assert.equal(assignShopTech({ city: 'Anza' }).name, TECH_DOUG_POLLACK);
    assert.equal(assignShopTech({ city: 'Aguanga' }).name, TECH_DOUG_POLLACK);
    assert.equal(assignShopTech({ address: '12 Well Rd', zip: '92539' }).name, TECH_DOUG_POLLACK);
    assert.equal(assignShopTech({ city: 'Hemet' }).name, TECH_DOUG_POLLACK);
    assert.equal(allowedTechSpokenName({ city: 'Anza' }), 'Doug Pollack or Cowin');
  });

  it('sends west/central San Diego to Brian Eads only', () => {
    assert.equal(assignShopTerritory({ city: 'Ramona' }), 'ramona');
    assert.deepEqual(
      allowedTechsForLocation({ city: 'Ramona' }).map((tech) => tech.name),
      [TECH_BRIAN_EADS]
    );
    assert.equal(assignShopTech({ city: 'Ramona' }).name, TECH_BRIAN_EADS);
    assert.equal(assignShopTech({ city: 'Ramona' }).email, SERVICE_TECH_ROSTER.brian.email);
    assert.equal(assignShopTech({ city: 'Escondido' }).name, TECH_BRIAN_EADS);
    assert.equal(assignShopTech({ city: 'Poway' }).name, TECH_BRIAN_EADS);
    assert.equal(assignShopTech({ city: 'Valley Center' }).name, TECH_BRIAN_EADS);
    assert.equal(assignShopTech({ zip: '92065' }).name, TECH_BRIAN_EADS);
    assert.equal(allowedTechSpokenName({ city: 'Ramona' }), TECH_BRIAN_EADS);
  });
});

describe('service tech identity — roster emails / Brighton name, not guesses', () => {
  const roster = [TRAVIS, BRIGHTON, HAZE, CHRIS, SCHROEDER, BRIAN, COWIN, DOUG];

  it('resolves Brian and Cowin from repo emails and Doug from exact name', () => {
    const brian = SERVICE_TECH_ROSTER.brian;
    const cowin = SERVICE_TECH_ROSTER.cowin;
    const doug = SERVICE_TECH_ROSTER.doug;
    assert.deepEqual(resolveTechUserId(brian, roster, {}), { id: 'user-brian', name: 'Brian Eads' });
    assert.deepEqual(resolveTechUserId(cowin, roster, {}), { id: 'user-cowin', name: 'Cowin' });
    assert.deepEqual(resolveTechUserId(doug, roster, {}), { id: 'user-doug', name: 'Doug Pollack' });
    assert.equal(userMatchesTech({ id: 'user-doug', name: { full: 'Douglas Pollack' } }, doug), true);
    assert.equal(userMatchesTech({ id: 'x', name: { full: 'Doug' } }, doug), false);
    assert.equal(userMatchesTech(TRAVIS, doug), false);
  });

  it('resolves Anza to Doug then Cowin and never Travis', () => {
    assert.deepEqual(
      resolveTechsForLocation({ city: 'Anza' }, roster, {}).map((tech) => tech.id),
      ['user-doug', 'user-cowin']
    );
    assert.deepEqual(resolveTechsForLocation({ city: 'Ramona' }, roster, {}).map((tech) => tech.id), [
      'user-brian',
    ]);
    assert.deepEqual(resolveTechsForLocation({ city: 'Anza' }, [COWIN, TRAVIS], {}).map((tech) => tech.id), [
      'user-cowin',
    ]);
    assert.deepEqual(resolveTechsForLocation({ city: 'Anza' }, [TRAVIS], {}), []);
  });

  it('never matches Travis, Brighton, or Brian Schroeder to any service tech', () => {
    const brian = SERVICE_TECH_ROSTER.brian;
    const cowin = SERVICE_TECH_ROSTER.cowin;
    const doug = SERVICE_TECH_ROSTER.doug;
    for (const blocked of [TRAVIS, BRIGHTON, SCHROEDER]) {
      assert.equal(userMatchesTech(blocked, brian), false);
      assert.equal(userMatchesTech(blocked, cowin), false);
      assert.equal(userMatchesTech(blocked, doug), false);
      assert.equal(isBlockedAssignee(blocked), true);
    }
    assert.equal(resolveTechUserId(brian, [TRAVIS, SCHROEDER], {}), null);
    assert.equal(resolveTechUserId(cowin, [TRAVIS, HAZE, CHRIS], {}), null);
    assert.equal(userMatchesTech(HAZE, cowin), false);
    assert.equal(resolveTechUserId(doug, [TRAVIS], {}), null);
  });

  it('rejects an env id that points at Travis instead of the roster tech', () => {
    assert.equal(
      resolveTechUserId(SERVICE_TECH_ROSTER.cowin, roster, { JOBBER_TECH_COWIN_ID: TRAVIS.id }),
      null
    );
    assert.equal(
      resolveTechUserId(SERVICE_TECH_ROSTER.doug, roster, { JOBBER_TECH_DOUG_POLLACK_ID: TRAVIS.id }),
      null
    );
    assert.equal(
      resolveTechUserId(SERVICE_TECH_ROSTER.cowin, roster, { JOBBER_TECH_COWIN_ID: COWIN.id })?.id,
      'user-cowin'
    );
    assert.equal(
      resolveTechUserId(SERVICE_TECH_ROSTER.doug, roster, { JOBBER_TECH_DOUG_POLLACK_ID: DOUG.id })?.id,
      'user-doug'
    );
  });

  it('does not treat first-name Brian as Brian Eads', () => {
    const brian = SERVICE_TECH_ROSTER.brian;
    assert.equal(
      userMatchesTech({ id: 'x', name: { full: 'Brian' }, email: { raw: '' } }, brian),
      false
    );
    assert.ok(BLOCKED_SERVICE_EMAILS.has('travis@scwellservice.com'));
  });

  it('isAllowlistedTechId accepts a single id or the allowlisted set', () => {
    assert.equal(isAllowlistedTechId('user-travis', 'user-brian'), false);
    assert.equal(isAllowlistedTechId('user-brian', 'user-brian'), true);
    assert.equal(isAllowlistedTechId('user-cowin', ['user-doug', 'user-cowin']), true);
    assert.equal(isAllowlistedTechId('user-travis', ['user-doug', 'user-cowin']), false);
    assert.equal(isAllowlistedTechId(null, ['user-brian']), false);
    assert.equal(formatTechNames(['Doug Pollack', 'Cowin']), 'Doug Pollack or Cowin');
  });
});

describe('Anza-side desert towns (Borrego Springs)', () => {
  it('assigns Doug, Cowin and Brian so the earliest slot wins across techs', () => {
    for (const city of ['Borrego Springs', 'Ocotillo Wells', 'Shelter Valley']) {
      assert.equal(assignShopTerritory({ city }), 'desert');
      assert.deepEqual(
        allowedTechsForLocation({ city }).map((t) => t.name),
        [TECH_DOUG_POLLACK, TECH_COWIN, TECH_BRIAN_EADS]
      );
    }
    assert.equal(assignShopTerritory({ zip: '92004' }), 'desert');
  });

  it('leaves Ramona and Anza territories unchanged', () => {
    assert.deepEqual(allowedTechsForLocation({ city: 'Ramona' }).map((t) => t.name), [TECH_BRIAN_EADS]);
    assert.deepEqual(allowedTechsForLocation({ city: 'Anza' }).map((t) => t.name), [TECH_DOUG_POLLACK, TECH_COWIN]);
  });

  it('resolves all three allowlisted users and never Travis', () => {
    const ids = resolveTechsForLocation({ city: 'Borrego Springs' }, [TRAVIS, BRIAN, COWIN, DOUG]).map((t) => t.id);
    assert.deepEqual(ids, ['user-doug', 'user-cowin', 'user-brian']);
  });
});

describe('fallback service techs', () => {
  const COLTON = { id: 'user-colton', name: { full: 'Colton Hagler ' }, email: { raw: 'colton@scwellservice.com' } };
  const SERGIO = { id: 'user-sergio', name: { full: 'Sergio Valdovinos Mendez' }, email: { raw: 'sergio@scwellservice.com' } };

  it('lists Chris, Haze, Colton, Sergio and resolves them by exact email', () => {
    assert.deepEqual(fallbackTechs().map((t) => t.name), [
      'Chris Glass',
      'Haze Tarbell',
      'Colton Hagler',
      'Sergio Valdovinos Mendez',
    ]);
    const ids = resolveFallbackTechs([TRAVIS, BRIGHTON, SCHROEDER, CHRIS, HAZE, COLTON, SERGIO], {}).map((t) => t.id);
    assert.deepEqual(ids, ['user-chris', 'user-haze', 'user-colton', 'user-sergio']);
  });

  it('never resolves Travis, Brighton or Brian Schroeder as fallback', () => {
    assert.deepEqual(resolveFallbackTechs([TRAVIS, BRIGHTON, SCHROEDER], {}), []);
  });

  it('does not match first names alone and keeps fallbacks out of the primary pool', () => {
    assert.deepEqual(resolveFallbackTechs([{ id: 'x', name: { full: 'Chris' } }, { id: 'y', name: { full: 'Haze' } }], {}), []);
    for (const city of ['Ramona', 'Anza', 'Borrego Springs']) {
      const ids = resolveTechsForLocation({ city }, [CHRIS, HAZE, COLTON, SERGIO], {});
      assert.deepEqual(ids, []);
    }
  });
});
