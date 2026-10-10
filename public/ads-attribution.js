/**
 * SCWS first-party Ads attribution.
 * Include on scwellservice.com (and the jobs booking pages):
 *   <script src="https://jobs.scwellservice.com/ads-attribution.js"></script>
 *
 * Writes a host-only cookie for 90 days and copies gclid / GA client id / UTM
 * into every form before it submits, including no-JS-looking native POSTs
 * that still have this script on the page. Cookie format matches
 * src/lib/ads/attribution.ts (name scws_ads, Max-Age 7776000).
 */
(function () {
  'use strict';

  var COOKIE = 'scws_ads';
  var MAX_AGE = 7776000;
  var FIELDS = [
    'gclid',
    'gbraid',
    'wbraid',
    'ga_client_id',
    'ga_session_id',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
  ];
  var PAID = { cpc: 1, ppc: 1, paid: 1, paid_search: 1, paidsearch: 1 };
  var LABELS = {
    google_ads: 1,
    googleads: 1,
    'google-ads': 1,
    'google ads': 1,
    adwords: 1,
    cpc: 1,
    ppc: 1,
  };

  function readCookie(name) {
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      var trimmed = parts[i].replace(/^\s+/, '');
      var eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      if (trimmed.slice(0, eq) !== name) continue;
      try {
        return decodeURIComponent(trimmed.slice(eq + 1));
      } catch (error) {
        return trimmed.slice(eq + 1);
      }
    }
    return '';
  }

  function parseStored(raw) {
    if (!raw) return {};
    var text = raw;
    if (text.indexOf('%') !== -1 && text.indexOf('&') === -1 && text.charAt(0) !== '{') {
      try {
        text = decodeURIComponent(text);
      } catch (error) {
        return {};
      }
    }
    var params = new URLSearchParams(text);
    var out = {};
    params.forEach(function (value, key) {
      if (value) out[key] = value;
    });
    return out;
  }

  function gaClientId(gaCookie) {
    if (!gaCookie) return '';
    var match = String(gaCookie).match(/(\d+\.\d+)\s*$/);
    return match ? match[1] : '';
  }

  function gaSessionId(cookie) {
    if (!cookie) return '';
    var gs2 = String(cookie).match(/s(\d{6,})/);
    if (gs2) return gs2[1];
    var gs1 = String(cookie).match(/^GS\d+\.\d+\.(\d+)/);
    return gs1 ? gs1[1] : '';
  }

  function sessionCookie() {
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      var trimmed = parts[i].replace(/^\s+/, '');
      var eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      if (trimmed.slice(0, eq).indexOf('_ga_') !== 0) continue;
      try {
        return decodeURIComponent(trimmed.slice(eq + 1));
      } catch (error) {
        return trimmed.slice(eq + 1);
      }
    }
    return '';
  }

  function clean(value) {
    if (!value) return '';
    var text = String(value).replace(/^\s+|\s+$/g, '');
    return text.length > 256 ? '' : text;
  }

  function read() {
    var stored = parseStored(readCookie(COOKIE));
    var params = new URLSearchParams(window.location.search);
    var next = {};
    var clickChanged = false;
    FIELDS.forEach(function (field) {
      var fromUrl = clean(params.get(field));
      var fromStore = clean(stored[field]);
      var value = fromUrl || fromStore;
      if (field === 'ga_client_id') value = gaClientId(readCookie('_ga')) || value;
      if (field === 'ga_session_id') value = gaSessionId(sessionCookie()) || value;
      if (value) next[field] = value;
      if ((field === 'gclid' || field === 'gbraid' || field === 'wbraid') && fromUrl && fromUrl !== fromStore) {
        clickChanged = true;
      }
    });
    if (clickChanged || (!stored.captured_at && (next.gclid || next.gbraid || next.wbraid))) {
      next.captured_at = new Date().toISOString();
    } else if (stored.captured_at) {
      next.captured_at = stored.captured_at;
    }

    var serialized = new URLSearchParams();
    FIELDS.concat(['captured_at']).forEach(function (field) {
      if (next[field]) serialized.set(field, next[field]);
    });
    var assignment =
      COOKIE +
      '=' +
      encodeURIComponent(serialized.toString()) +
      '; Max-Age=' +
      MAX_AGE +
      '; Path=/; SameSite=Lax' +
      (window.location.protocol === 'https:' ? '; Secure' : '');
    document.cookie = assignment;
    return next;
  }

  function isGoogleAds(data) {
    if (data.gclid || data.gbraid || data.wbraid) return true;
    var medium = (data.utm_medium || '').toLowerCase();
    if (PAID[medium]) return true;
    var label = (data.lead_source || '').toLowerCase();
    return Boolean(LABELS[label]);
  }

  function stamp(form, data) {
    if (!form || !form.querySelector) return;
    var payload = Object.assign({}, data);
    if (isGoogleAds(payload)) payload.lead_source = payload.lead_source || 'google_ads';
    FIELDS.concat(['lead_source']).forEach(function (name) {
      if (!payload[name]) return;
      var input = form.querySelector('input[name="' + name + '"]');
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        form.appendChild(input);
      }
      if (!input.value) input.value = payload[name];
    });
  }

  function stampAll(data) {
    var forms = document.getElementsByTagName('form');
    for (var i = 0; i < forms.length; i++) stamp(forms[i], data);
  }

  var current = read();
  window.scwsAdsAttribution = {
    read: function () {
      current = read();
      return current;
    },
    stamp: function (form) {
      stamp(form, read());
    },
  };

  function boot() {
    current = read();
    stampAll(current);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  document.addEventListener(
    'submit',
    function (event) {
      current = read();
      stamp(event.target, current);
    },
    true
  );
})();
