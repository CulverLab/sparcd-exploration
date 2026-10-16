`inspect-preview.mp4` is a generated two-second blue 64×48 H.264 clip (no audio).
It contains no external or copyrighted media. Generated with:

```
ffmpeg -f lavfi -i color=c=blue:s=64x48:r=10 -t 2 -c:v libx264 -pix_fmt yuv420p -movflags +faststart inspect-preview.mp4
```

Used to exercise local original-file decoding, playback, and cleanup in Inspect.
