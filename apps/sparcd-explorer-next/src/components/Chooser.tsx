import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CollectionRef } from '@sparcd/s3-safe';
import { discoverCollections } from '@/data';
import { checkFiles, checkForUploads, openSelection, sourceFor, type Progress } from '@/lib/opening';
import { readLast, useStore } from '@/store';
import { Stepper } from './Stepper';
import { OpeningPanel } from './OpeningPanel';

const nameOf = (ref: CollectionRef) => ref.name ?? ref.bucket;

const comboName = (refs: CollectionRef[]) =>
  refs.length <= 2 ? refs.map(nameOf).join(' + ') : `${nameOf(refs[0])} + ${refs.length - 1} more`;

const host = (endpoint: string) => endpoint.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

type Opening = { refs: CollectionRef[]; progress: Progress[]; failed: boolean; controller: AbortController };

export function Chooser() {
  const config = useStore((s) => s.config)!;
  const account = useStore((s) => s.account);
  const picks = useStore((s) => s.picks);
  const setPicks = useStore((s) => s.setPicks);
  const signOut = useStore((s) => s.signOut);
  const enterWorkspace = useStore((s) => s.enterWorkspace);
  const beginOpen = useStore((s) => s.beginOpen);
  const cancelOpen = useStore((s) => s.cancelOpen);
  const resumeWorkspace = useStore((s) => s.resumeWorkspace);
  const [search, setSearch] = useState('');
  const [opening, setOpening] = useState<Opening | null>(null);
  const firstBox = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);

  // An open started for one account never lands under another, nor after
  // this screen has gone.
  useEffect(
    () => () => {
      pending.current?.abort();
      cancelOpen();
    },
    [account, cancelOpen],
  );

  const collections = useQuery({
    queryKey: ['collections', account],
    queryFn: () => discoverCollections(sourceFor(config)),
  });
  const all = collections.data ?? [];
  const picked = all.filter((c) => picks.includes(c.key));
  const last = readLast(account)
    .map((key) => all.find((c) => c.key === key))
    .filter((c) => c !== undefined);
  const canContinue = picked.length === 0 && last.length > 0 && last.every((c) => c.cached);
  const q = search.trim().toLowerCase();
  const shown = all.filter((c) => !q || nameOf(c).toLowerCase().includes(q));

  async function open(refs: CollectionRef[]) {
    if (resumeWorkspace(refs)) return;
    pending.current?.abort();
    const controller = (pending.current = new AbortController());
    const stamp = beginOpen();
    // Only this open's own state changes; a newer open may have replaced it.
    const mine =
      (next: Opening | null | ((o: Opening) => Opening | null)) =>
      (o: Opening | null): Opening | null =>
        o?.controller !== controller ? o : typeof next === 'function' ? next(o) : next;
    setOpening({ refs, progress: [], failed: false, controller });
    try {
      const { loaded, registries } = await openSelection(config, refs, {
        signal: controller.signal,
        onProgress: (progress) => setOpening(mine((o) => ({ ...o, progress }))),
      });
      if (!enterWorkspace(stamp, refs, loaded, registries)) return setOpening(mine(null));
      // Anything that came from this device is checked for new uploads now.
      // The photo files are checked at once too, from their cached answers
      // where media.csv is unchanged, and again after any new uploads land.
      if (refs.some((r) => all.find((c) => c.key === r.key)?.cached)) void checkForUploads();
      void checkFiles();
    } catch {
      setOpening(mine((o) => (controller.signal.aborted ? null : { ...o, failed: true })));
    }
  }

  const toggle = (key: string) => setPicks(picks.includes(key) ? picks.filter((k) => k !== key) : [...picks, key]);

  return (
    <main className="page">
      <div className="mx-auto grid max-w-[720px] gap-[18px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="brand">SPARC'd Explorer</div>
          <div className="flex-1" />
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-inkSoft">
            <span>
              Signed in as {config.accessKey} on {host(config.endpoint)}
            </span>
            <span aria-hidden="true">·</span>
            <button type="button" className="linkbtn" onClick={signOut}>
              Sign out
            </button>
          </p>
        </div>
        <Stepper step={2} />
        <div>
          <h1 className="h1">Choose collections</h1>
          <p className="mt-1 text-inkMute">Pick one or more.</p>
        </div>

        {opening && opening.progress.length > 0 ? (
          <OpeningPanel
            refs={opening.refs}
            progress={opening.progress}
            failed={opening.failed}
            onCancel={() => {
              opening.controller.abort();
              cancelOpen();
              setOpening(null);
            }}
          />
        ) : collections.isPending ? (
          <p className="fine" role="status">
            Finding your collections…
          </p>
        ) : collections.isError ? (
          <div className="grid justify-items-start gap-3">
            <p role="alert" className="field-err">
              {collections.error.message}
            </p>
            <button type="button" className="btn" onClick={() => void collections.refetch()}>
              Try again
            </button>
          </div>
        ) : (
          <>
            {canContinue && (
              <button type="button" className="btn primary bigbtn justify-between" onClick={() => void open(last)}>
                <span>Continue with {comboName(last)}</span>
                <span aria-hidden="true" className="text-[20px] leading-none">
                  ›
                </span>
              </button>
            )}
            {all.length > 8 && (
              <>
                <label className="sr" htmlFor="coll-search">
                  Search collections
                </label>
                <input
                  id="coll-search"
                  className="field"
                  type="search"
                  placeholder="Search collections"
                  autoComplete="off"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </>
            )}
            <ul className="m-0 list-none border-t border-rule p-0" aria-label="Collections">
              {shown.map((c, i) => (
                <li key={c.key}>
                  <label className="coll-row">
                    <input
                      ref={i === 0 ? firstBox : undefined}
                      type="checkbox"
                      checked={picks.includes(c.key)}
                      onChange={() => toggle(c.key)}
                    />
                    <span className="nm">{nameOf(c)}</span>
                    {(c.organization || c.cached) && (
                      <span className="meta">
                        {c.organization}
                        {c.organization && c.cached && ' · '}
                        {c.cached && <span className="saved">Opened on this device</span>}
                      </span>
                    )}
                  </label>
                </li>
              ))}
              {shown.length === 0 && (
                <li className="px-3 py-4 text-inkMute">
                  {all.length ? `No collection matches "${search}".` : 'No collections are visible to this account.'}
                </li>
              )}
            </ul>
            <div className="choose-foot">
              <button
                type="button"
                className="selclear"
                style={{ visibility: picked.length ? 'visible' : 'hidden' }}
                aria-label="Clear picked collections"
                onClick={() => {
                  setPicks([]);
                  firstBox.current?.focus();
                }}
              >
                <b aria-hidden="true">×</b>Clear
              </button>
              <button type="button" className="btn primary bigbtn" disabled={!picked.length} onClick={() => void open(picked)}>
                {picked.length === 0
                  ? 'Pick a collection'
                  : picked.length === 1
                    ? `Open ${nameOf(picked[0])}`
                    : `Open ${picked.length} collections together`}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
