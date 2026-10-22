import type { Deployment } from '@sparcd/camtrap';
import type { DraftRecord, TimeOffsetRecord } from './db';
import type { UploadCtx, BulkTimeTarget } from './drafts';

export type EditChange = {
  ctx: UploadCtx;
  before: Record<string, DraftRecord>;
  after: Record<string, DraftRecord>;
  location?: { before: Deployment | null; after: Deployment | null };
};
export type EditLifecycle = {
  canEdit: () => boolean;
  accept: (change: EditChange) => void;
  normalizeLocation?: (location: Deployment | null) => Deployment | null;
  expandOffset: (ctx: UploadCtx, offset: TimeOffsetRecord | null) => BulkTimeTarget[] | null;
};
let lifecycle: EditLifecycle | undefined;
export function installEditLifecycle(value: EditLifecycle): () => void {
  lifecycle = value;
  return () => { if (lifecycle === value) lifecycle = undefined; };
}
export const canAcceptEdit = () => lifecycle?.canEdit() ?? true;
export const acceptEdit = (change: EditChange) => lifecycle?.accept(change);
export const expandUploadOffset = (ctx: UploadCtx, offset: TimeOffsetRecord | null) => lifecycle?.expandOffset(ctx, offset) ?? null;

export const hasEditLifecycle = () => !!lifecycle;

export const normalizeEditLocation = (location: Deployment | null) => lifecycle?.normalizeLocation?.(location) ?? location;
