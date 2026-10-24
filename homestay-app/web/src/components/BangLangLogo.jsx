// Hoa bằng lăng: sáu cánh xoè đều quanh nhụy vàng, vẽ bằng SVG để không phụ thuộc ảnh ngoài.
const PETALS = [0, 60, 120, 180, 240, 300];

export default function BangLangLogo({ className = "" }) {
  return (
    <svg viewBox="-32 -32 64 64" className={className} aria-hidden="true">
      <rect x="-32" y="-32" width="64" height="64" rx="18" fill="#ede9fe" />
      {PETALS.map((angle) => (
        <g key={angle} transform={`rotate(${angle})`}>
          <path
            d="M0,0 C-11,-6 -13,-20 -6,-25 C-3,-27.5 3,-27.5 6,-25 C13,-20 11,-6 0,0Z"
            fill="#8b6fd6"
            stroke="#6d4fc0"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />
          <path d="M0,-4 C-4,-10 -4,-17 0,-21 C4,-17 4,-10 0,-4Z" fill="#b4a0ea" opacity="0.7" />
        </g>
      ))}
      <circle r="5.5" fill="#fde68a" stroke="#d4a017" strokeWidth="0.8" />
      {[0, 72, 144, 216, 288].map((a) => (
        <circle key={a} cx={Math.cos((a * Math.PI) / 180) * 3.2} cy={Math.sin((a * Math.PI) / 180) * 3.2} r="0.7" fill="#b7791f" />
      ))}
    </svg>
  );
}
