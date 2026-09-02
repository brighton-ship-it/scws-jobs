'use client';

import { useEffect, useState } from 'react';
import { Calculator, Droplets, Info, Search, MapPin, Loader2, RefreshCw } from 'lucide-react';
import { internalAirRotaryCostBand } from '@/lib/wells/cost';
import type { NearbyWell, NearbyWellsResult } from '@/lib/wells/nearby';
import {
  assertAllowedMotorBrand,
  sizePump,
  type AllowedMotorBrand,
} from '@/lib/wells/pump-sizing';
import type { TrackerWell } from '@/lib/wells/tracker';

export default function WellToolsPage() {
  const [activeTab, setActiveTab] = useState<'well-lookup' | 'pump-sizing' | 'well-depth'>('well-lookup');

  const [lookupAddress, setLookupAddress] = useState('');
  const [lookupRadius, setLookupRadius] = useState('2');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResults, setLookupResults] = useState<NearbyWellsResult | null>(null);

  const [wellDepth, setWellDepth] = useState('');
  const [staticLevel, setStaticLevel] = useState('');
  const [drawdown, setDrawdown] = useState('');
  const [desiredGPM, setDesiredGPM] = useState('');
  const [desiredPressure, setDesiredPressure] = useState('50');
  const [pipeLength, setPipeLength] = useState('');
  const [pipeDiameter, setPipeDiameter] = useState('1.25');
  const [elevationChange, setElevationChange] = useState('0');
  const [motorBrand, setMotorBrand] = useState<AllowedMotorBrand>('CentriPro');
  const [showResults, setShowResults] = useState(false);
  const [pumpError, setPumpError] = useState<string | null>(null);
  const [pumpResult, setPumpResult] = useState<ReturnType<typeof sizePump> | null>(null);

  const [trackerWells, setTrackerWells] = useState<TrackerWell[] | null>(null);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerMessage, setTrackerMessage] = useState<string | null>(null);
  const [selectedTrackerId, setSelectedTrackerId] = useState<string | null>(null);
  const [trackerSearch, setTrackerSearch] = useState('');

  const handleCalculate = () => {
    setPumpError(null);
    try {
      const brand = assertAllowedMotorBrand(motorBrand);
      const result = sizePump({
        wellDepthFt: wellDepth ? parseFloat(wellDepth) : null,
        staticLevelFt: parseFloat(staticLevel),
        drawdownFt: parseFloat(drawdown || '0'),
        gpm: parseFloat(desiredGPM),
        pressurePsi: parseFloat(desiredPressure || '50'),
        pipeLengthFt: parseFloat(pipeLength || '0'),
        pipeDiameterIn: parseFloat(pipeDiameter),
        elevationChangeFt: parseFloat(elevationChange || '0'),
        motorBrand: brand,
      });
      setPumpResult(result);
      setShowResults(true);
    } catch (err) {
      setShowResults(false);
      setPumpResult(null);
      setPumpError(err instanceof Error ? err.message : 'Check the well inputs and try again.');
    }
  };

  const handleReset = () => {
    setWellDepth('');
    setStaticLevel('');
    setDrawdown('');
    setDesiredGPM('');
    setDesiredPressure('50');
    setPipeLength('');
    setPipeDiameter('1.25');
    setElevationChange('0');
    setMotorBrand('CentriPro');
    setShowResults(false);
    setPumpResult(null);
    setPumpError(null);
  };

  const handleWellLookup = async () => {
    if (!lookupAddress.trim()) {
      setLookupError('Please enter an address');
      return;
    }

    setLookupLoading(true);
    setLookupError(null);
    setLookupResults(null);

    try {
      const wellsRes = await fetch(
        `/api/wells/nearby?address=${encodeURIComponent(lookupAddress.trim())}&radius=${lookupRadius}`,
        { credentials: 'same-origin' }
      );
      const wellsData = await wellsRes.json();

      if (!wellsRes.ok || wellsData.error) {
        setLookupError(wellsData.error || `Lookup failed (${wellsRes.status})`);
        return;
      }

      setLookupResults(wellsData);
    } catch (err: unknown) {
      setLookupError(err instanceof Error ? err.message : 'Failed to lookup wells');
    } finally {
      setLookupLoading(false);
    }
  };

  const applyWellToPump = (well: NearbyWell) => {
    if (well.total_drill_depth) setWellDepth(String(well.total_drill_depth));
    if (well.static_water_level) setStaticLevel(String(well.static_water_level));
    if (well.well_yield) setDesiredGPM(String(well.well_yield));
    setActiveTab('pump-sizing');
  };

  useEffect(() => {
    if (activeTab !== 'well-depth' || trackerWells !== null) return;
    let cancelled = false;
    setTrackerLoading(true);
    fetch('/api/wells/tracker', { credentials: 'same-origin' })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        const wells = Array.isArray(data.wells) ? data.wells : [];
        setTrackerWells(wells);
        setTrackerMessage(data.message || (wells.length ? null : 'No CRM well records on file.'));
        if (wells[0]?.id) setSelectedTrackerId(wells[0].id);
      })
      .catch(() => {
        if (!cancelled) {
          setTrackerWells([]);
          setTrackerMessage('No CRM well records on file.');
        }
      })
      .finally(() => {
        if (!cancelled) setTrackerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, trackerWells]);

  const filteredTracker = (trackerWells || []).filter((well) => {
    const q = trackerSearch.trim().toLowerCase();
    if (!q) return true;
    return `${well.customerName} ${well.address} ${well.city || ''}`.toLowerCase().includes(q);
  });
  const selectedTracker = filteredTracker.find((well) => well.id === selectedTrackerId) || filteredTracker[0] || null;
  const cost = lookupResults?.cost || (lookupResults?.stats.avgDepth
    ? internalAirRotaryCostBand(lookupResults.stats.domesticMedianDepth || lookupResults.stats.avgDepth)
    : null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Well Tools</h1>
        <p className="text-gray-500">Well depth lookup, pump sizing calculator, and CRM well records</p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab('well-lookup')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'well-lookup'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Search className="h-4 w-4 inline mr-2" />
            Well Depth Lookup
          </button>
          <button
            onClick={() => setActiveTab('pump-sizing')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'pump-sizing'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Calculator className="h-4 w-4 inline mr-2" />
            Pump Sizing Calculator
          </button>
          <button
            onClick={() => setActiveTab('well-depth')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'well-depth'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Droplets className="h-4 w-4 inline mr-2" />
            Well Depth Tracker
          </button>
        </nav>
      </div>

      {activeTab === 'well-lookup' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Find Nearby Wells</h2>
            <p className="text-sm text-gray-500 mb-4">
              Paste an address. The server geocodes it and returns nearby California DWR well completion reports
              (depth, yield, static, WCR, distance).
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Property Address
                </label>
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input
                      type="text"
                      value={lookupAddress}
                      onChange={(e) => setLookupAddress(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleWellLookup()}
                      placeholder="1077 Main Street, Ramona, CA 92065"
                      className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                  <select
                    value={lookupRadius}
                    onChange={(e) => setLookupRadius(e.target.value)}
                    className="px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  >
                    <option value="0.5">0.5 mi</option>
                    <option value="1">1 mi</option>
                    <option value="2">2 mi</option>
                    <option value="5">5 mi</option>
                  </select>
                  <button
                    onClick={handleWellLookup}
                    disabled={lookupLoading}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
                  >
                    {lookupLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    Search
                  </button>
                </div>
              </div>
            </div>

            {lookupError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {lookupError}
              </div>
            )}
          </div>

          {lookupResults && (
            <>
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  Well Data Summary
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    ({lookupResults.stats.totalWells} wells within {lookupResults.stats.radiusMiles} miles
                    {lookupResults.location.formatted ? ` of ${lookupResults.location.formatted}` : ''})
                  </span>
                </h3>
                <p className="text-xs text-gray-400 mb-4">{lookupResults.source}</p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-green-50 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-green-700">
                      {lookupResults.stats.avgDepth || '—'}<span className="text-lg">'</span>
                    </p>
                    <p className="text-sm text-gray-600">Avg Depth</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-gray-700">
                      {lookupResults.stats.minDepth || '—'}<span className="text-lg">'</span>
                    </p>
                    <p className="text-sm text-gray-600">Min Depth</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-gray-700">
                      {lookupResults.stats.maxDepth || '—'}<span className="text-lg">'</span>
                    </p>
                    <p className="text-sm text-gray-600">Max Depth</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-blue-700">
                      {lookupResults.stats.avgYield || '—'}<span className="text-lg"> GPM</span>
                    </p>
                    <p className="text-sm text-gray-600">Avg Yield</p>
                  </div>
                </div>

                {cost && (
                  <div className="mt-6 p-4 bg-slate-800 rounded-lg text-white">
                    <h4 className="font-semibold mb-1">Internal drilling cost band</h4>
                    <p className="text-2xl font-bold">
                      ${cost.low.toLocaleString()} – ${cost.high.toLocaleString()}
                    </p>
                    <p className="text-sm opacity-80 mt-1">{cost.label}</p>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h3 className="font-semibold text-gray-900">Nearby Wells</h3>
                </div>
                <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                  {lookupResults.wells.length === 0 ? (
                    <div className="p-6 text-center text-gray-500">
                      No wells found in this area. Try increasing the search radius.
                    </div>
                  ) : (
                    lookupResults.wells.map((well, i) => (
                      <div key={`${well.wcr_number || i}-${well.distance_feet}`} className="px-6 py-3 hover:bg-gray-50">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="text-lg font-semibold text-gray-900">
                              {well.total_drill_depth || '—'}&apos; deep
                            </span>
                            {well.well_yield && (
                              <span className="ml-3 text-sm text-blue-600">
                                {well.well_yield} {well.well_yield_unit || 'GPM'}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => applyWellToPump(well)}
                              className="ml-3 text-xs text-green-700 hover:underline"
                            >
                              Use in pump sizing
                            </button>
                          </div>
                          <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">
                            {well.distance_miles} mi
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-gray-500 space-x-3">
                          {well.city && <span>📍 {well.city}</span>}
                          {well.drilling_method && <span>🔧 {well.drilling_method}</span>}
                          {well.static_water_level && <span>💧 Static: {well.static_water_level}&apos;</span>}
                          {well.wcr_number && <span className="text-gray-400">#{well.wcr_number}</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          {!lookupResults && !lookupLoading && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-12 text-center">
              <Search className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">Enter an address above to find nearby well data</p>
              <p className="text-sm text-gray-400 mt-2">
                Data from California DWR Well Completion Reports
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'pump-sizing' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Well & System Parameters</h2>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Total Well Depth (ft)</label>
                  <input type="number" value={wellDepth} onChange={(e) => setWellDepth(e.target.value)} placeholder="400"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Static Water Level (ft)</label>
                  <input type="number" value={staticLevel} onChange={(e) => setStaticLevel(e.target.value)} placeholder="100"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Drawdown (ft)</label>
                  <input type="number" value={drawdown} onChange={(e) => setDrawdown(e.target.value)} placeholder="50"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Desired Flow (GPM)</label>
                  <input type="number" value={desiredGPM} onChange={(e) => setDesiredGPM(e.target.value)} placeholder="15"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                </div>
              </div>

              <div className="border-t border-gray-200 pt-4 mt-4">
                <h3 className="text-sm font-medium text-gray-900 mb-3">Piping, pressure, motor</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Desired Pressure (PSI)</label>
                    <select value={desiredPressure} onChange={(e) => setDesiredPressure(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent">
                      <option value="40">40 PSI (30/50)</option>
                      <option value="50">50 PSI (40/60)</option>
                      <option value="60">60 PSI (50/70)</option>
                      <option value="70">70 PSI (60/80)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Pipe Diameter</label>
                    <select value={pipeDiameter} onChange={(e) => setPipeDiameter(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent">
                      <option value="1">1&quot;</option>
                      <option value="1.25">1-1/4&quot;</option>
                      <option value="1.5">1-1/2&quot;</option>
                      <option value="2">2&quot;</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Pipe Run Length (ft)</label>
                    <input type="number" value={pipeLength} onChange={(e) => setPipeLength(e.target.value)} placeholder="100"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Elevation Change (ft)</label>
                    <input type="number" value={elevationChange} onChange={(e) => setElevationChange(e.target.value)} placeholder="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Motor brand</label>
                  <select
                    value={motorBrand}
                    onChange={(e) => setMotorBrand(assertAllowedMotorBrand(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  >
                    <option value="CentriPro">CentriPro (sold book / Goulds CP)</option>
                    <option value="Franklin">Franklin (only when the job calls for FE)</option>
                  </select>
                </div>
              </div>

              {pumpError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {pumpError}
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button onClick={handleCalculate}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 transition-colors">
                  <Calculator className="h-4 w-4" />Calculate
                </button>
                <button onClick={handleReset}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  <RefreshCw className="h-4 w-4" />Reset
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {showResults && pumpResult ? (
              <>
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Total Dynamic Head</h2>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Pumping Level (Static + Drawdown)</span>
                      <span className="font-medium">{pumpResult.pumpingLevelFt.toFixed(0)} ft</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Pressure Head ({desiredPressure} PSI × 2.31)</span>
                      <span className="font-medium">{pumpResult.pressureHeadFt.toFixed(0)} ft</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Friction Loss</span>
                      <span className="font-medium">{pumpResult.frictionLossFt.toFixed(0)} ft</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Elevation Change</span>
                      <span className="font-medium">{pumpResult.elevationChangeFt} ft</span>
                    </div>
                    <div className="border-t border-gray-200 pt-3 flex justify-between">
                      <span className="font-semibold text-gray-900">Total Dynamic Head</span>
                      <span className="font-bold text-green-600 text-lg">{pumpResult.tdhFt.toFixed(0)} ft</span>
                    </div>
                  </div>
                </div>

                <div className="bg-green-50 rounded-xl border border-green-200 p-6">
                  <h2 className="text-lg font-semibold text-green-900 mb-4">Recommendations</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white rounded-lg p-4">
                      <p className="text-sm text-gray-500">{pumpResult.motorBrand} motor</p>
                      <p className="text-2xl font-bold text-gray-900">{pumpResult.recommendedHp} HP</p>
                      <p className="text-xs text-gray-400 mt-1">{pumpResult.requiredHp.toFixed(2)} HP hydraulic</p>
                    </div>
                    <div className="bg-white rounded-lg p-4">
                      <p className="text-sm text-gray-500">Wire Size</p>
                      <p className="text-2xl font-bold text-gray-900">{pumpResult.wireSize}</p>
                    </div>
                    <div className="bg-white rounded-lg p-4">
                      <p className="text-sm text-gray-500">Pressure Tank</p>
                      <p className="text-2xl font-bold text-gray-900">{pumpResult.tankGallons} gal</p>
                      <p className="text-xs text-gray-400 mt-1">{pumpResult.tankDrawdown} gal drawdown</p>
                    </div>
                    <div className="bg-white rounded-lg p-4">
                      <p className="text-sm text-gray-500">Pump Setting</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {pumpResult.pumpSettingFt != null ? `${pumpResult.pumpSettingFt.toFixed(0)} ft` : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 text-center">
                <Calculator className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p className="text-gray-500">Enter static level and GPM, then click Calculate</p>
              </div>
            )}

            <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
              <div className="flex gap-3">
                <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Calculation Notes</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-700">
                    <li>Assumes 60% pump efficiency</li>
                    <li>Wire sizing based on 230V single phase</li>
                    <li>Franklin or CentriPro only — sold book is CentriPro / Goulds CP</li>
                    <li>Always verify with manufacturer curves. No catalog model numbers from this screen.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'well-depth' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900 mb-4">CRM well records</h3>
              <input
                type="text"
                value={trackerSearch}
                onChange={(e) => setTrackerSearch(e.target.value)}
                placeholder="Search customers..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent mb-4"
              />
              {trackerLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-500 p-3">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading CRM wells…
                </div>
              )}
              {!trackerLoading && filteredTracker.length === 0 && (
                <p className="text-sm text-gray-500 p-3">
                  {trackerMessage || 'No CRM well records on file. Use Well Depth Lookup for DWR data — dummy properties are not shown.'}
                </p>
              )}
              <div className="space-y-2">
                {filteredTracker.map((well) => (
                  <button
                    key={well.id}
                    onClick={() => setSelectedTrackerId(well.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedTracker?.id === well.id
                        ? 'border-green-600 bg-green-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <p className="font-medium text-gray-900">{well.customerName}</p>
                    <p className="text-sm text-gray-500">{well.city || well.address}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            {selectedTracker ? (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{selectedTracker.customerName}</h2>
                    <p className="text-sm text-gray-500">{selectedTracker.address}</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-4 mb-6">
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <p className="text-2xl font-bold text-gray-900">{selectedTracker.wellDepth ?? '—'}</p>
                    <p className="text-xs text-gray-500">Total Depth (ft)</p>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <p className="text-2xl font-bold text-gray-900">{selectedTracker.staticLevel ?? '—'}</p>
                    <p className="text-xs text-gray-500">Static Level (ft)</p>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <p className="text-2xl font-bold text-gray-900">{selectedTracker.pumpHp ?? '—'}</p>
                    <p className="text-xs text-gray-500">Pump HP</p>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <p className="text-2xl font-bold text-gray-900 truncate" title={selectedTracker.pumpModel || ''}>
                      {selectedTracker.pumpModel || '—'}
                    </p>
                    <p className="text-xs text-gray-500">Pump on file</p>
                  </div>
                </div>
                {selectedTracker.notes && (
                  <p className="text-sm text-gray-600">{selectedTracker.notes}</p>
                )}
              </div>
            ) : (
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 text-center">
                <Droplets className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p className="text-gray-500">
                  {trackerLoading
                    ? 'Loading CRM well records…'
                    : 'No dummy wells. When a customer has well_info in the CRM, it shows here.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
