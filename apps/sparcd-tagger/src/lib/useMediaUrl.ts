// The one place that turns a media object key into a URL the DOM can render.
// Today that is always a presigned GET against the connected bucket; keeping
// every <img>/<video> behind this hook means a future local-batch mode can hand
// back an object URL instead without touching a single call site.

import { useQuery } from '@tanstack/react-query';
import { useStore } from '../store';
import { parseCollectionKey, presignImage } from './s3';

export function useMediaUrl(objectKey: string): { url: string | undefined; isError: boolean } {
  const cfg = useStore((s) => s.s3Config);
  const connectionId = useStore((s) => s.connectionId);
  const collectionKey = useStore((s) => s.selectedCollectionKey);

  const { data, isError } = useQuery({
    queryKey: ['presign', connectionId, objectKey],
    queryFn: () => {
      const { bucket } = parseCollectionKey(collectionKey!);
      return presignImage(cfg!, bucket, objectKey);
    },
    enabled: !!cfg && !!collectionKey,
    staleTime: 50 * 60 * 1000, // under the 1h URL TTL
    retry: 1,
  });

  return { url: data, isError };
}
