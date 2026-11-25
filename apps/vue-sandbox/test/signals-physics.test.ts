import { describe, expect, it } from "vitest";
import {
  C_NM_THZ,
  ITU_G694_1_C_BAND_100GHZ,
  LOG_SIGNAL_Y_AXES,
  LOG_Y_AXES,
  buildDwdmCollection,
  computeWindowOpticalMetrics,
  createSignalPool,
  mwToDbm,
  populateFbgScenario,
  populateLiveGridX,
  populateLogPowerScenario,
  stepLiveSpectrum,
} from "../src/signals.ts";

describe("OSA-1550 optical physics and ITU-T G.694.1 compliance", () => {
  it("computes the exact ITU-T G.694.1 100 GHz C-band grid anchored at 193.10 THz", () => {
    expect(ITU_G694_1_C_BAND_100GHZ).toHaveLength(40);
    const ch21 = ITU_G694_1_C_BAND_100GHZ[0]!;
    const ch31 = ITU_G694_1_C_BAND_100GHZ.find((c) => c.channel === 31)!;
    const ch60 = ITU_G694_1_C_BAND_100GHZ[39]!;

    expect(ch21.channel).toBe(21);
    expect(ch21.freqThz).toBe(192.1);
    expect(ch21.lambdaNm).toBeCloseTo(C_NM_THZ / 192.1, 6);

    // Official ITU anchor: Ch 31 = 193.10 THz -> 1552.5244 nm
    expect(ch31.freqThz).toBe(193.1);
    expect(ch31.lambdaNm).toBeCloseTo(1552.5244, 4);

    expect(ch60.channel).toBe(60);
    expect(ch60.freqThz).toBe(196.0);
    expect(ch60.lambdaNm).toBeCloseTo(1529.5534, 4);

    // Non-uniform wavelength spacing (Δλ = λ²/c * Δf increases with λ)
    const spacingLowLambda =
      ITU_G694_1_C_BAND_100GHZ[38]!.lambdaNm - ITU_G694_1_C_BAND_100GHZ[39]!.lambdaNm;
    const spacingHighLambda =
      ITU_G694_1_C_BAND_100GHZ[0]!.lambdaNm - ITU_G694_1_C_BAND_100GHZ[1]!.lambdaNm;
    expect(spacingHighLambda).toBeGreaterThan(spacingLowLambda + 0.025);
  });

  it("models a π-phase-shifted FBG with >25 dB notch at 1550.000100 nm and dBm ↔ mW consistency", () => {
    const pool = createSignalPool();
    populateFbgScenario(pool.fbgDbm, 120_000, "dbm");
    populateFbgScenario(pool.fbgMw, 120_000, "mw-log");

    expect(pool.fbgDbm.yUnit).toBe("dBm");
    expect(pool.fbgMw.yUnit).toBe("mW");

    const notchWindowDbm = computeWindowOpticalMetrics(pool.fbgDbm, 1549.984, 1550.016, false);
    const notchWindowMw = computeWindowOpticalMetrics(pool.fbgMw, 1549.984, 1550.016, true);

    expect(notchWindowDbm.peakY).toBeGreaterThan(-3.0);
    expect(notchWindowDbm.peakY).toBeLessThan(-1.0);
    expect(notchWindowDbm.dynamicRangeDb).toBeGreaterThan(25);

    // Exact linear-to-dBm conversion agreement at the Bragg stopband peak
    expect(mwToDbm(notchWindowMw.peakY)).toBeCloseTo(notchWindowDbm.peakY, 2);

    // Confirm zero NaN/Infinity across the full buffer without 240k Chai assertion allocations
    let nonFiniteCount = 0;
    let nonPositiveCount = 0;
    for (let i = 0; i < pool.fbgDbm.sampleCount; i += 1) {
      if (!Number.isFinite(pool.fbgDbm.y[i]!)) nonFiniteCount += 1;
      if (!(pool.fbgMw.y[i]! > 0)) nonPositiveCount += 1;
    }
    expect(nonFiniteCount).toBe(0);
    expect(nonPositiveCount).toBe(0);
  });

  it("models DWDM ITU Ch 34 (−10 dB fault) and Ch 48 (+12 GHz drift) in both dBm and mW modes", () => {
    const pool = createSignalPool();
    const colDbm = buildDwdmCollection(pool, 72_000, "dark", "dbm");
    const colMw = buildDwdmCollection(pool, 72_000, "dark", "mw-log");

    expect(colDbm.entries).toHaveLength(2);
    expect(colMw.entries).toHaveLength(2);

    // ITU Ch 34 = 193.40 THz (1550.1161 nm): active trace is ~10 dB below reference
    const ch34Lambda = C_NM_THZ / 193.4;
    const refCh34 = computeWindowOpticalMetrics(
      pool.dwdmRefDbm,
      ch34Lambda - 0.05,
      ch34Lambda + 0.05,
      false,
    );
    const actCh34 = computeWindowOpticalMetrics(
      pool.dwdmActiveDbm,
      ch34Lambda - 0.05,
      ch34Lambda + 0.05,
      false,
    );
    expect(refCh34.peakY - actCh34.peakY).toBeGreaterThan(8.5);
    expect(refCh34.peakY - actCh34.peakY).toBeLessThan(12.5);

    // ITU Ch 48 = 194.80 THz: +12 GHz drift shifts peak wavelength down by ~0.095 nm
    const ch48Lambda = C_NM_THZ / 194.8;
    const refCh48 = computeWindowOpticalMetrics(
      pool.dwdmRefDbm,
      ch48Lambda - 0.25,
      ch48Lambda + 0.25,
      false,
    );
    const actCh48 = computeWindowOpticalMetrics(
      pool.dwdmActiveDbm,
      ch48Lambda - 0.25,
      ch48Lambda + 0.25,
      false,
    );
    expect(refCh48.peakXNm - actCh48.peakXNm).toBeGreaterThan(0.07);
    expect(refCh48.peakXNm - actCh48.peakXNm).toBeLessThan(0.12);
  });

  it("streams Live 60 Hz in place with zero ArrayBuffer reallocation and monotonic revisions", () => {
    const pool = createSignalPool();
    const initialXBuf = pool.liveDbm.x.buffer;
    const initialYBuf = pool.liveDbm.y.buffer;
    populateLiveGridX(pool.liveDbm, 64_000);

    stepLiveSpectrum(pool.liveDbm, 64_000, 0.1, 1, "dbm");
    const rev1 = pool.liveDbm.revision;
    stepLiveSpectrum(pool.liveDbm, 64_000, 0.2, 2, "dbm");
    const rev2 = pool.liveDbm.revision;

    expect(rev2).toBeGreaterThan(rev1);
    expect(pool.liveDbm.x.buffer).toBe(initialXBuf);
    expect(pool.liveDbm.y.buffer).toBe(initialYBuf);

    const metrics = computeWindowOpticalMetrics(pool.liveDbm, 1549.8, 1554.2, false);
    expect(metrics.visibleSamples).toBe(64_000);
    expect(metrics.dynamicRangeDb).toBeGreaterThan(40);
  });

  it("keeps Log-Y (mW) strictly positive and every decade tick non-zero under 3-decimal formatting", () => {
    const pool = createSignalPool();
    populateLogPowerScenario(pool.logMw, 48_000, "mw-log");
    populateLogPowerScenario(pool.logDbm, 48_000, "dbm");

    const mwMetrics = computeWindowOpticalMetrics(pool.logMw, 1549.6, 1570.4, true);
    const dbmMetrics = computeWindowOpticalMetrics(pool.logDbm, 1549.6, 1570.4, false);

    expect(mwMetrics.minY).toBeGreaterThanOrEqual(0.0011);
    expect(mwToDbm(mwMetrics.peakY)).toBeCloseTo(dbmMetrics.peakY, 2);

    // Verify all decade ticks within both log axis presets format strictly > 0
    for (const axes of [LOG_Y_AXES, LOG_SIGNAL_Y_AXES]) {
      const axis = axes[0]!;
      for (let exp = Math.ceil(Math.log10(axis.domainMin)); exp <= Math.floor(Math.log10(axis.domainMax)); exp += 1) {
        const tick = Math.pow(10, exp);
        expect(Math.round(tick * 1000) / 1000).toBeGreaterThan(0);
      }
    }
  });
});
