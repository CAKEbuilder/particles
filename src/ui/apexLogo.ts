// The apex icon: a black-void upside-down triangle with a holographic rainbow outline and
// a specular sheen that sweeps across it (clipped to the triangle) to scream "rare/precious".
// CSS animates the rainbow hue + pulse; the sheen sweep is a self-contained SMIL animation.

let uid = 0;

export function apexLogoSVG(size = 148): string {
  const n = uid++;
  const holo = `holo${n}`;
  const clip = `clip${n}`;
  const sheen = `sheen${n}`;
  const tri = "M20 36 L100 36 L60 104 Z";
  return `
  <svg class="apex-logo" viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true">
    <defs>
      <linearGradient id="${holo}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ff3b6b" />
        <stop offset="0.17" stop-color="#ffb13b" />
        <stop offset="0.34" stop-color="#f3ff5b" />
        <stop offset="0.5" stop-color="#3bff9e" />
        <stop offset="0.67" stop-color="#3bdcff" />
        <stop offset="0.84" stop-color="#9a6bff" />
        <stop offset="1" stop-color="#ff5bd0" />
      </linearGradient>
      <linearGradient id="${sheen}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0" />
        <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.7" />
        <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
      </linearGradient>
      <clipPath id="${clip}"><path d="${tri}" /></clipPath>
    </defs>
    <path d="${tri}" fill="#04050a" stroke="url(#${holo})" stroke-width="5" stroke-linejoin="round" />
    <g clip-path="url(#${clip})">
      <rect x="-34" y="0" width="26" height="120" fill="url(#${sheen})">
        <animateTransform attributeName="transform" type="translate"
          from="0 0" to="150 0" dur="3.4s" begin="0s" repeatCount="indefinite" />
      </rect>
    </g>
  </svg>`;
}
