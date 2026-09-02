import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { geocodeCensus, geocodeNominatim, geocodeWellAddress, parseCoord } from './geocode.ts';

describe('well-tools geocode helpers', () => {
  it('parses finite coords and rejects junk', () => {
    assert.equal(parseCoord('33.04'), 33.04);
    assert.equal(parseCoord('0'), 0);
    assert.equal(parseCoord('nope'), null);
    assert.equal(parseCoord(null), null);
  });

  it('reads Nominatim JSON and never calls it from a browser UA path', async () => {
    const geo = await geocodeNominatim('1077 Main Street, Ramona, CA 92065', async (url, init) => {
      assert.match(String(url), /nominatim\.openstreetmap\.org/);
      assert.match(String((init?.headers as Record<string, string>)['User-Agent'] || ''), /SCWS-WellLookup/);
      return new Response(
        JSON.stringify([
          {
            lat: '33.04163',
            lon: '-116.870105',
            display_name: '1077, Main Street, Ramona, San Diego County, California, 92065, United States',
          },
        ]),
        { status: 200 }
      );
    });
    assert.equal(geo?.lat, 33.04163);
    assert.equal(geo?.lng, -116.870105);
    assert.equal(geo?.city, 'Ramona');
    assert.doesNotMatch(geo?.city || '', /County/i);
    assert.equal(geo?.source, 'nominatim');
  });

  it('falls back to Census when Nominatim is empty', async () => {
    const geo = await geocodeWellAddress('57174 CA-371, Anza, CA 92539', async (url) => {
      if (String(url).includes('nominatim')) {
        return new Response('[]', { status: 200 });
      }
      assert.match(String(url), /geocoding\.geo\.census\.gov/);
      return new Response(
        JSON.stringify({
          result: {
            addressMatches: [
              {
                coordinates: { x: -116.65833, y: 33.55516 },
                addressComponents: { city: 'ANZA' },
                matchedAddress: '57174 CA-371, ANZA, CA, 92539',
              },
            ],
          },
        }),
        { status: 200 }
      );
    });
    assert.equal(geo?.source, 'census');
    assert.equal(geo?.city, 'ANZA');
    assert.ok(geo && geo.lat > 33.5);
  });

  it('uses Census helper directly', async () => {
    const geo = await geocodeCensus('1077 Main St, Ramona, CA 92065', async () => {
      return new Response(
        JSON.stringify({
          result: {
            addressMatches: [
              {
                coordinates: { x: -116.87, y: 33.04 },
                addressComponents: { city: 'RAMONA' },
                matchedAddress: '1077 MAIN ST, RAMONA, CA, 92065',
              },
            ],
          },
        }),
        { status: 200 }
      );
    });
    assert.equal(geo?.formatted, '1077 MAIN ST, RAMONA, CA, 92065');
  });
});
