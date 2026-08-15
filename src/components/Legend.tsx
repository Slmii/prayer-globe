export default function Legend() {
  return (
    <div className="legend">
      <div className="legend-title">LINES ON THE GLOBE</div>

      <div className="legend-row">
        <svg width="30" height="6" viewBox="0 0 30 6" aria-hidden="true">
          <line x1="0" y1="3" x2="30" y2="3" stroke="#ffc65c" strokeWidth="1.6" />
        </svg>
        <span className="legend-label legend-dawn">Sunrise</span>
        <span className="legend-angle">−0.8°</span>
      </div>

      <div className="legend-row">
        <svg width="30" height="6" viewBox="0 0 30 6" aria-hidden="true">
          <line x1="0" y1="3" x2="30" y2="3" stroke="#b5abfc" strokeWidth="1.6" />
        </svg>
        <span className="legend-label legend-accent">Sunset</span>
        <span className="legend-angle">−0.8°</span>
      </div>

      <div className="legend-row">
        <span className="legend-swatch-night" />
        <span className="legend-label">Night side</span>
      </div>

      <div className="legend-row">
        <span className="legend-swatch-pulse legend-pulse-sun" aria-hidden="true">
          <span />
        </span>
        <span className="legend-label legend-dawn">Sun overhead</span>
      </div>

      <div className="legend-row">
        <span className="legend-swatch-pulse legend-pulse-moon" aria-hidden="true">
          <span />
        </span>
        <span className="legend-label">Moon overhead</span>
      </div>

      <p className="legend-note">
        One boundary, two limbs: gold where the sun is coming up, lavender where it is going down.
        They meet at the far north and south. The pulses mark the exact points the sun and moon
        stand over; their glyphs ride outside the earth.
      </p>
    </div>
  )
}
