import type { ReactNode } from 'react';
import { SAVE_STATUS, type BrowseSaveStatus as Status } from '../lib/browseSaveStatus';
import { useFocusExplanation } from './useFocusExplanation';

function Icon({ status }: { status: Status }) {
  if (status === 'saved') return <span aria-hidden="true">✓</span>;
  const paths: Partial<Record<Status, ReactNode>> = {
    conflict: <><path d="M5 3v4c0 4 10 2 10 6v4M15 3v4M12 5l3 3 3-3M2 14l3 3 3-3" /></>,
    repair: <><circle cx="7" cy="7" r="4" /><path d="m10 10 7 7m-4-4 2-2m0 4 2-2" /></>,
    recover: <><path d="M3 12v5h14v-5M5 8h9a3 3 0 0 1 0 6h-2M5 8l3-3M5 8l3 3" /></>,
  };
  const busy = ['saving', 'retrying', 'checking'].includes(status);
  return <svg aria-hidden="true" viewBox="0 0 20 20" className={`w-3.5 h-3.5 shrink-0 ${busy ? 'motion-safe:animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {paths[status] ?? <path d="M16 7a6 6 0 1 0 0 6M16 3v4h-4" />}
  </svg>;
}

export function BrowseSaveStatus({ status, onRecheck, onRetry }: { status: Status; onRecheck: () => void; onRetry: () => void }) {
  const { label, help: description } = SAVE_STATUS[status];
  const help = useFocusExplanation(description);
  const action = status === 'recheck' ? onRecheck : status === 'retry' ? onRetry : undefined;
  const appearance = status === 'saved'
    ? 'bg-ok text-paper border-transparent'
    : status === 'saving' || status === 'retrying'
      ? 'bg-[#dce8d5] text-[#30472b] border-[#849c76] dark:bg-[#34462f] dark:text-[#e0edda] dark:border-[#8ba57d]'
      : status === 'checking' ? 'bg-panel text-inkSoft border-rule'
        : 'bg-[#fff0cb] text-[#684408] border-[#aa7b27] dark:bg-[#49391c] dark:text-[#ffe0a0] dark:border-[#bc964b]';
  const props = {
    'data-save-status': status,
    title: description,
    'aria-label': `Save status: ${label}`,
    'aria-describedby': help.id,
    className: `inline-flex max-w-full items-center justify-center gap-1.5 border px-2.5 h-7 text-[12px] font-body font-[600] whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${appearance} ${action ? 'hover:brightness-95 cursor-pointer' : ''}`,
    style: status === 'saved' ? { clipPath: 'polygon(9px 0, 100% 0, 100% 100%, 9px 100%, 0 50%)', paddingLeft: '14px', paddingRight: '14px' } : undefined,
    ...help.triggerProps,
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => help.show(event.currentTarget),
    onMouseLeave: () => help.hide(),
    onClick: (event: React.MouseEvent<HTMLElement>) => { event.stopPropagation(); if (action) action(); else help.show(event.currentTarget); },
  };
  return <>
    {action ? <button type="button" {...props}><Icon status={status} />{label}</button>
      : <span tabIndex={0} role="status" {...props}><Icon status={status} />{label}</span>}
    {help.explanation}
  </>;
}
