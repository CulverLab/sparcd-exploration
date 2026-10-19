import { useLayoutEffect, useRef } from 'react';
import { EffortStrip, MapBand } from './Bands';
import { FilterBar } from './FilterBar';
import { Header } from './Header';
import { TablePanel } from './TablePanel';
import { Toast } from './Toast';

export function Workspace() {
  const sticky = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    scrollTo(0, 0);
    const el = sticky.current!;
    const measure = () => document.documentElement.style.setProperty('--stickyH', `${el.offsetHeight + 8}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div ref={sticky} id="sticky-top" className="stickytop">
        <Header />
        <FilterBar />
      </div>
      <main className="work">
        <MapBand />
        <EffortStrip />
        <TablePanel />
      </main>
      <Toast />
    </>
  );
}
