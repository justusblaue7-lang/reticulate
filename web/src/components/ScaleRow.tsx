// A 0–10 leaning drawn from the midpoint, with optional poles. Used for the decision
// dimensions and the Big Five alike.

interface Props {
  name: string;
  value: number;
  low?: string;
  high?: string;
  title?: string;
  onClick?: () => void;
  active?: boolean;
}

export function ScaleRow({ name, value, low, high, title, onClick, active }: Props) {
  const left = Math.min(value, 5) * 10;
  const width = Math.abs(value - 5) * 10;
  return (
    <div title={title}>
      <div className="scale-row">
        {onClick ? (
          <button className="text-button" style={{ justifySelf: "start", textTransform: "none", letterSpacing: 0, fontFamily: "var(--sans)", fontSize: 13, color: active ? "var(--cream)" : undefined }} onClick={onClick}>
            {name}
          </button>
        ) : (
          <span className="name">{name}</span>
        )}
        <span className="track">
          <span className="mid" />
          <span className="span" style={{ left: `${left}%`, width: `${width}%` }} />
          <span className="mark" style={{ left: `${value * 10}%` }} />
        </span>
        <span className="num">{Number.isInteger(value) ? value : value.toFixed(1)}</span>
      </div>
      {(low || high) && (
        <div className="poles">
          <span>{low}</span>
          <span>{high}</span>
        </div>
      )}
    </div>
  );
}
