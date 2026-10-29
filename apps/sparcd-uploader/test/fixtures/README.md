# Recovery media fixture

`recovery-video.mp4` is a generated one-second, 96×64 green H.264 video used to
verify actual playback after recovering a durable directory handle. It contains
no user media. Regenerate with FFmpeg (not needed to run the tests):

```sh
ffmpeg -f lavfi -i color=c=green:s=96x64:r=5 -t 1 -c:v libx264 -pix_fmt yuv420p -metadata creation_time=2026-07-01T12:00:00Z -movflags +faststart recovery-video.mp4
```
