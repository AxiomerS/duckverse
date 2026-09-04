// Маленькие переиспользуемые UI-компоненты игры.

// Иконка монеты DC (рисуется через CSS, чтобы рендерилась везде — без эмодзи-глифа).
export function Coin() {
  return <span className="sil-coin">DC</span>;
}

export function StatBar({ label, value, color, max = 100, warnLow = false }: { label: string; value: number; color: string; max?: number; warnLow?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const low = warnLow && pct <= 20;
  return (
    <div className="stat">
      <div className="stat-head">
        <span>{label}</span>
        <span className="stat-val">{Math.round(value)}{max !== 100 ? ` / ${max}` : ""}</span>
      </div>
      <div className="stat-track">
        <div className={"stat-fill" + (low ? " stat-fill-low" : "")} style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
