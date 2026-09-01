import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TECH_BRIAN_EADS,
  TECH_COWIN,
  assignShopTech,
  resolveTechUserId,
  userMatchesTech,
} from './tech-assignment.ts';

describe('assignShopTech', () => {
  it('sends Anza / high-desert to Cowin', () => {
    assert.equal(assignShopTech({ city: 'Anza' }).name, TECH_COWIN);
    assert.equal(assignShopTech({ city: 'Aguanga' }).name, TECH_COWIN);
    assert.equal(assignShopTech({ address: '12 Well Rd', zip: '92539' }).name, TECH_COWIN);
    assert.equal(assignShopTech({ city: 'Hemet' }).name, TECH_COWIN);
  });

  it('sends west/central San Diego to Brian Eads', () => {
    assert.equal(assignShopTech({ city: 'Ramona' }).name, TECH_BRIAN_EADS);
    assert.equal(assignShopTech({ city: 'Escondido' }).name, TECH_BRIAN_EADS);
    assert.equal(assignShopTech({ city: 'Poway' }).name, TECH_BRIAN_EADS);
    assert.equal(assignShopTech({ city: 'Valley Center' }).name, TECH_BRIAN_EADS);
    assert.equal(assignShopTech({ zip: '92065' }).name, TECH_BRIAN_EADS);
  });
});

describe('resolveTechUserId', () => {
  const users = [
    { id: 'user-cowin', name: { full: 'Cowin' } },
    { id: 'user-brian', name: { full: 'Brian Eads' } },
  ];

  it('matches Jobber users by name', () => {
    const cowin = assignShopTech({ city: 'Anza' });
    const brian = assignShopTech({ city: 'Ramona' });
    assert.deepEqual(resolveTechUserId(cowin, users, {}), { id: 'user-cowin', name: 'Cowin' });
    assert.deepEqual(resolveTechUserId(brian, users, {}), { id: 'user-brian', name: 'Brian Eads' });
  });

  it('prefers JOBBER_TECH_* env IDs', () => {
    const cowin = assignShopTech({ city: 'Anza' });
    assert.equal(
      resolveTechUserId(cowin, users, { JOBBER_TECH_COWIN_ID: 'env-cowin' })?.id,
      'env-cowin'
    );
  });

  it('userMatchesTech reads name.full', () => {
    assert.equal(userMatchesTech({ id: '1', name: { full: 'Cowin' } }, assignShopTech({ city: 'Anza' })), true);
    assert.equal(
      userMatchesTech({ id: '2', name: { full: 'Brian Eads' } }, assignShopTech({ city: 'Ramona' })),
      true
    );
  });
});
