/// <reference types="vite/client" />

// exifr's smallest build: JPEG and TIFF only, which is all thumbnails need.
declare module 'exifr/dist/mini.esm.mjs' {
  export { thumbnail } from 'exifr';
}
