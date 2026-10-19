import { InView } from './InView';

// The map and the effort strip keep their final size now, so nothing moves
// when they are drawn in a later phase.

export function MapBand() {
  return (
    <section id="map" className="mapband panel" aria-label="Map">
      <div className="bandhead">
        <h2>Map</h2>
      </div>
      <div className="mapwrap placeholder" />
      <InView />
    </section>
  );
}

export function EffortStrip() {
  return (
    <section className="panel" aria-label="Camera effort">
      <div className="bandhead">
        <h2>Camera effort</h2>
      </div>
      <div className="strip placeholder" />
    </section>
  );
}
