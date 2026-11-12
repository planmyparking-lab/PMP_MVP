import { Skeleton } from "../src/components/ui/primitives";

/** Shown while a page's server loaders run, so navigation feels instant. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div style={{ marginBottom: 24 }}>
        <Skeleton width={120} height={12} />
        <div style={{ height: 10 }} />
        <Skeleton width={280} height={28} />
      </div>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card kpi">
            <Skeleton width="50%" />
            <Skeleton width="40%" height={30} />
            <Skeleton width="70%" height={10} />
          </div>
        ))}
      </div>
      <div className="grid grid-main">
        <div className="card card-body">
          <Skeleton height={180} />
        </div>
        <div className="card card-body">
          <Skeleton height={180} />
        </div>
      </div>
    </div>
  );
}
