import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAllowedMotorBrand,
  assignShop,
  drillMethodForSite,
  estimateDriveHours,
  motorBrandForShop,
  soldMotorBrand,
  travelDaysForHole,
} from './shops.ts';

describe('shop assignment and motors', () => {
  it('assigns Ramona shop; sold motor book is CentriPro (165 CP vs 14 FE)', () => {
    assert.equal(assignShop('Ramona'), 'ramona');
    assert.equal(assignShop('Escondido'), 'ramona');
    assert.equal(motorBrandForShop('ramona'), 'CentriPro');
  });

  it('assigns Anza + CentriPro for Anza / Goulds / Riverside', () => {
    assert.equal(assignShop('Anza'), 'anza');
    assert.equal(assignShop('Goulds'), 'anza');
    assert.equal(assignShop('Temecula'), 'anza');
    assert.equal(motorBrandForShop('anza'), 'CentriPro');
  });

  it('uses Franklin only when notes name Franklin/FE', () => {
    assert.equal(soldMotorBrand('2hp CentriPro', 'ramona'), 'CentriPro');
    assert.equal(soldMotorBrand('Franklin FE 2hp', 'ramona'), 'Franklin');
    assert.equal(soldMotorBrand('set 2hp', 'anza'), 'CentriPro');
  });

  it('rejects motor brands other than Franklin or CentriPro', () => {
    assert.equal(assertAllowedMotorBrand('Franklin'), 'Franklin');
    assert.equal(assertAllowedMotorBrand('CentriPro'), 'CentriPro');
    assert.throws(() => assertAllowedMotorBrand('Grundfos'), /Franklin|CentriPro/);
  });

  it('west Escondido granite / hills stay air, not mud', () => {
    assert.equal(drillMethodForSite('Escondido', -117.12), 'air');
    assert.equal(drillMethodForSite('Ramona', -116.86), 'air');
  });
});

describe('travel / per diem', () => {
  it('omits travel when the hole is under 1.5 hours from the shop', () => {
    assert.equal(travelDaysForHole('ramona', { lat: 33.05, lng: -116.87 }), 0);
    assert.ok(estimateDriveHours({ lat: 33.0414, lng: -116.8686 }, { lat: 33.05, lng: -116.87 }) < 1.5);
  });

  it('adds one Travel and Peridium day when the hole is over 1.5 hours', () => {
    // Far east Imperial / desert from Ramona
    assert.equal(travelDaysForHole('ramona', { lat: 32.8, lng: -114.8 }), 1);
    assert.equal(travelDaysForHole('ramona', { lat: 33.05, lng: -116.87 }, 2), 1);
    assert.equal(travelDaysForHole('ramona', { lat: 33.05, lng: -116.87 }, 1.4), 0);
  });
});
