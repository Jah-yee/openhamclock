import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBandForFreq, getMarkerPosition, getSegmentClass } from '../utils/bandPlan';
import { getLicenseClass, normalizeLicenseClass, nonPrivilegedSlices } from '../utils/privileges';

/**
 * BandPlanBar — compact horizontal band plan strip for a given frequency.
 *
 * Renders the amateur band containing `freq` (Hz) as colored segments
 * (CW / Data / Phone / FM per bandplan.json), with a needle at the current
 * frequency, tick marks at segment boundaries, and MHz labels at the band
 * edges. Returns null when the frequency is outside any known band, so
 * callers can render it unconditionally.
 *
 * Colors come from the theme CSS variables so the bar tracks all themes.
 */

const SEGMENT_COLORS = {
  cw: 'var(--accent-amber)',
  data: 'var(--accent-cyan)',
  phone: 'var(--accent-green)',
  fm: 'var(--accent-purple)',
};

// Format kHz as a compact MHz label: 1800 → "1.8", 14350 → "14.35", 7000 → "7"
const fmtMHz = (khz) => (khz / 1000).toFixed(3).replace(/\.?0+$/, '');

// Configured US license class ('other' = no restriction UI). Re-reads when
// the settings panel saves (saveConfig dispatches 'openhamclock-config-change').
const useLicenseClass = () => {
  const [licenseClass, setLicenseClass] = useState(getLicenseClass);
  useEffect(() => {
    const onChange = () => setLicenseClass(getLicenseClass());
    window.addEventListener('openhamclock-config-change', onChange);
    return () => window.removeEventListener('openhamclock-config-change', onChange);
  }, []);
  return licenseClass;
};

const BandPlanBar = ({ freq }) => {
  const { t } = useTranslation();
  const licenseClass = useLicenseClass();
  const band = getBandForFreq(freq);
  if (!band) return null;

  const pos = getMarkerPosition(freq, band);
  const span = band.max - band.min;
  const pct = (khz) => ((khz - band.min) / span) * 100;

  const classLabel = (cls) =>
    ({
      cw: t('app.bandPlan.cw'),
      data: t('app.bandPlan.data'),
      phone: t('app.bandPlan.phone'),
      fm: t('app.bandPlan.fm'),
    })[cls] || cls;

  // License-class privilege shading: kHz slices of each segment the configured
  // class may not transmit in. Empty for 'Other' (no restriction UI at all).
  // Each slice remembers the segment's mode: the restriction is about that
  // emission type here, not the class as such — an Extra may run CW/data at
  // 14.105 even though phone there is out for everyone (#1193).
  const restricted = normalizeLicenseClass(licenseClass)
    ? band.segments.flatMap((seg) =>
        nonPrivilegedSlices(licenseClass, seg.min, seg.max, seg.mode).map((slice) => ({
          ...slice,
          mode: classLabel(getSegmentClass(seg.mode)),
        })),
      )
    : [];
  const restrictedTitle = (slice) =>
    t('app.bandPlan.restrictedMode', {
      licenseClass: t(`station.settings.licenseClass.${licenseClass}`),
      mode: slice.mode,
    });

  return (
    <div className="band-plan-bar" aria-label={t('app.bandPlan.aria', { band: band.name })}>
      <div className="bpb-track">
        {band.segments.map((seg) => {
          const cls = getSegmentClass(seg.mode);
          return (
            <div
              key={seg.min}
              className={`bpb-seg bpb-${cls}`}
              style={{
                left: `${pct(seg.min)}%`,
                width: `${pct(seg.max) - pct(seg.min)}%`,
                background: SEGMENT_COLORS[cls],
              }}
              title={`${classLabel(cls)}: ${fmtMHz(seg.min)}–${fmtMHz(seg.max)} ${t('app.units.mhz')}`}
            />
          );
        })}
        {/* Out-of-privilege shading for the configured license class */}
        {restricted.map((slice) => (
          <div
            key={`priv-${slice.min}`}
            className="bpb-restricted"
            style={{
              left: `${pct(slice.min)}%`,
              width: `${pct(slice.max) - pct(slice.min)}%`,
            }}
            title={`${restrictedTitle(slice)}: ${fmtMHz(slice.min)}–${fmtMHz(slice.max)} ${t('app.units.mhz')}`}
          />
        ))}
        {/* Ticks at internal segment boundaries */}
        {band.segments.slice(1).map((seg) => (
          <div key={`tick-${seg.min}`} className="bpb-tick" style={{ left: `${pct(seg.min)}%` }} />
        ))}
        {pos !== null && <div className="bpb-needle" style={{ left: `${pos}%` }} />}
      </div>
      <div className="bpb-labels">
        <span>{fmtMHz(band.min)}</span>
        <span className="bpb-band-name">{band.name}</span>
        <span>{fmtMHz(band.max)}</span>
      </div>
      <style>{`
        .band-plan-bar {
            margin: 0.25rem 0 0.75rem;
            font-family: var(--font-mono, monospace);
        }
        .band-plan-bar .bpb-track {
            position: relative;
            height: 16px;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 3px;
            overflow: hidden;
        }
        .band-plan-bar .bpb-seg {
            position: absolute;
            top: 0;
            bottom: 0;
            opacity: 0.55;
        }
        .band-plan-bar .bpb-seg:hover {
            opacity: 0.9;
        }
        .band-plan-bar .bpb-restricted {
            position: absolute;
            top: 0;
            bottom: 0;
            /* Desaturating wash + subtle hatch over out-of-privilege stretches.
               Built from theme background vars so it dims (rather than hides)
               the segment colors in every theme. Fallback first for browsers
               without color-mix support. */
            background: repeating-linear-gradient(135deg, var(--bg-secondary) 0 3px, transparent 3px 7px);
            background: repeating-linear-gradient(
                135deg,
                var(--bg-secondary) 0 3px,
                color-mix(in srgb, var(--bg-secondary) 55%, transparent) 3px 7px
            );
        }
        .band-plan-bar .bpb-tick {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 1px;
            background: var(--bg-primary);
            pointer-events: none;
        }
        .band-plan-bar .bpb-needle {
            position: absolute;
            top: -1px;
            bottom: -1px;
            width: 2px;
            margin-left: -1px;
            background: var(--accent-red);
            box-shadow: 0 0 4px var(--accent-red);
            pointer-events: none;
        }
        .band-plan-bar .bpb-labels {
            display: flex;
            justify-content: space-between;
            font-size: 0.65rem;
            color: var(--text-muted);
            margin-top: 2px;
            line-height: 1;
        }
        .band-plan-bar .bpb-band-name {
            color: var(--text-secondary);
            text-transform: none;
        }
      `}</style>
    </div>
  );
};

export default BandPlanBar;
