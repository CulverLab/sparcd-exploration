export const PREVIEW_EDGE = 640;

type Dims = { w: number; h: number };
type Decoder = {
  decode(): Promise<{ image: VideoFrame }>;
  close(): void;
};
type DecoderCtor = new (init: { data: ReadableStream<Uint8Array>; type: string; desiredWidth?: number; desiredHeight?: number }) => Decoder;

/** `edge`-px-long-edge JPEG q0.7 of an image file plus the source dims, undefined if the file cannot be decoded. */
export async function makePreview(
  file: File | Blob,
  dims?: Dims,
  edge = PREVIEW_EDGE,
): Promise<{ blob: Blob; width: number; height: number } | undefined> {
  let source: VideoFrame | ImageBitmap | undefined;
  let decoder: Decoder | undefined;
  try {
    const ImageDecoder = (globalThis as typeof globalThis & { ImageDecoder?: DecoderCtor }).ImageDecoder;
    if (ImageDecoder) {
      try {
        const scale = dims ? Math.min(1, edge / Math.max(dims.w, dims.h)) : undefined;
        decoder = new ImageDecoder({
          data: file.stream(), type: 'image/jpeg',
          desiredWidth: scale ? Math.max(1, Math.round(dims!.w * scale)) : undefined,
          desiredHeight: scale ? Math.max(1, Math.round(dims!.h * scale)) : undefined,
        });
        source = (await decoder.decode()).image;
      } catch {
        decoder?.close();
        decoder = undefined;
      }
    }
    source ??= await createImageBitmap(file);
    const width = source instanceof ImageBitmap ? source.width : source.displayWidth;
    const height = source instanceof ImageBitmap ? source.height : source.displayHeight;
    const scale = Math.min(1, edge / Math.max(width, height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    return { blob, width: dims?.w ?? width, height: dims?.h ?? height };
  } catch {
    return undefined;
  } finally {
    source?.close();
    decoder?.close();
  }
}
