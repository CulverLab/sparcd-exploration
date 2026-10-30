import { useEffect, useLayoutEffect, useRef } from 'react';
import { photoTimeRanks } from '@/lib/tables';
import { useStore } from '@/store';
import { Figures } from './Figures';
import { Header, NarrowActions } from './Header';
import { MapBand } from './MapBand';
import { preloadLater } from './later';
import { Sidebar } from './Sidebar';
import { TablePanel } from './TablePanel';
import { Toast } from './Toast';

/**
 * The top bar, the filter sidebar beside the main area, and in it the
 * figures, the map with the camera effort, then the tables. The page scrolls;
 * the top bar and the sidebar stay put. The map fills the first screen,
 * leaving the tables' tab row in sight at its foot.
 */
export function Workspace() {
  const app = useRef<HTMLDivElement>(null);
  const side = useStore((s) => s.side);
  useLayoutEffect(() => {
    scrollTo(0, 0);
    const root = app.current!;
    const top = document.getElementById('sticky-top')!;
    const map = document.getElementById('map')!;
    const tabs = root.querySelector<HTMLElement>('#table .tabs')!;
    const row = tabs.parentElement!;
    const size = () => {
      const stickyH = top.offsetHeight;
      document.documentElement.style.setProperty('--stickyH', `${stickyH}px`);
      // The tab row as one line: its tools may wrap under the tabs, and that must not move the map.
      const cs = getComputedStyle(row);
      const tabsH = tabs.offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const mapTop = Math.ceil(map.getBoundingClientRect().top + scrollY - 0.01);
      const min = innerWidth < 760 ? 420 : 260;
      root.style.setProperty('--mapH', `${Math.max(min, innerHeight - mapTop - 16 - tabsH - 6)}px`);
    };
    size();
    const observer = new ResizeObserver(size);
    for (const el of [top, document.getElementById('figures')!, row]) observer.observe(el);
    addEventListener('resize', size);
    return () => {
      observer.disconnect();
      removeEventListener('resize', size);
    };
  }, []);
  useEffect(preloadLater, []);
  // The photos' time order, ranked while the page is idle, so the first
  // switch to Photos doesn't wait for it.
  const model = useStore((s) => s.model);
  useEffect(() => {
    if (!model) return;
    const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 300));
    const cancel = window.cancelIdleCallback ?? clearTimeout;
    const id = idle(() => photoTimeRanks(model));
    return () => cancel(id);
  }, [model]);
  return (
    <>
      <div ref={app} className="app" data-side={side ? 'shown' : 'hidden'}>
        <Header />
        <Sidebar />
        <main className="main" id="main">
          <NarrowActions />
          <Figures />
          <MapBand />
          <TablePanel />
        </main>
      </div>
      <Toast />
    </>
  );
}
