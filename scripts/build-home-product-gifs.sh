#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"

ffmpeg_bin="${FFMPEG_BIN:-$(command -v ffmpeg || true)}"
if [[ -z "$ffmpeg_bin" && -x /opt/homebrew/bin/ffmpeg ]]; then
  ffmpeg_bin=/opt/homebrew/bin/ffmpeg
fi

if [[ -z "$ffmpeg_bin" ]]; then
  echo "ffmpeg is required to build the homepage product GIFs." >&2
  exit 1
fi

output_dir="public/academic-home/gifs"
poster_dir="public/academic-home/posters"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
mkdir -p "$output_dir" "$poster_dir"

standard_filter='scale=720:450:force_original_aspect_ratio=increase,crop=720:450,format=yuv420p,fps=10'
sankey_filter='crop=trunc(iw*0.72/2)*2:trunc(ih*0.80/2)*2:0:trunc(ih*0.17/2)*2,scale=720:450,format=yuv420p,fps=10'

render_clip() {
  local source_file="$1"
  local duration="$2"
  local output_file="$3"
  local video_filter="$4"

  "$ffmpeg_bin" -y -loglevel error \
    -loop 1 -framerate 10 -i "$source_file" \
    -vf "$video_filter" -t "$duration" -r 10 "$output_file"
}

build_gif() {
  local name="$1"
  local overview_image="$2"
  local focused_image="$3"
  local video_filter="$4"
  local stage_dir="$work_dir/$name"

  mkdir -p "$stage_dir"
  render_clip "$overview_image" 0.95 "$stage_dir/overview.mp4" "$video_filter"
  render_clip "$focused_image" 2.05 "$stage_dir/focused.mp4" "$video_filter"

  "$ffmpeg_bin" -y -loglevel error \
    -i "$stage_dir/overview.mp4" -frames:v 1 -c:v libwebp -quality 86 \
    "$poster_dir/$name.webp"

  "$ffmpeg_bin" -y -loglevel error \
    -i "$stage_dir/overview.mp4" \
    -i "$stage_dir/focused.mp4" \
    -filter_complex \
      '[0:v][1:v]concat=n=2:v=1:a=0[v];[v]fps=10,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle' \
    -loop -1 \
    "$output_dir/$name.gif"
}

build_gif \
  map-usage \
  public/academic-home/screens/map-interface.webp \
  public/academic-home/screens/map-carbamazepine-selected-20260915.jpg \
  "$standard_filter"

build_gif \
  sankey-usage \
  public/academic-home/screens/sankey-interface.webp \
  public/academic-home/screens/sankey-pathways-20260908.webp \
  "$sankey_filter"

build_gif \
  priority-usage \
  public/academic-home/screens/priority-interface.webp \
  public/academic-home/screens/priority-ranking-20260908.webp \
  "$standard_filter"

echo "Built homepage product GIFs in $output_dir and matching posters in $poster_dir"
