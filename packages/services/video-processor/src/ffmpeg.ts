import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

export interface VideoProbe {
  duration: number;
  width: number;
  height: number;
  codec: string;
  bitrate: number;
  fps: number;
}

/** ffprobe reports frame rates as fractions such as `30000/1001`. */
export function parseFrameRate(rate: string | undefined): number {
  const [numerator, denominator = '1'] = (rate ?? '').split('/');
  const fps = Number(numerator) / Number(denominator);
  return Number.isFinite(fps) ? fps : 0;
}

export async function probeVideo(videoPath: string): Promise<VideoProbe> {
  const { stdout } = await run(FFPROBE, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    videoPath,
  ]);
  const { format, streams } = JSON.parse(stdout) as {
    format?: { duration?: string; bit_rate?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
    }>;
  };
  const video = streams?.find((stream) => stream.codec_type === 'video');
  if (!video) {
    throw new Error('No video stream found');
  }

  return {
    duration: Number(format?.duration) || 0,
    width: video.width || 0,
    height: video.height || 0,
    codec: video.codec_name || 'unknown',
    bitrate: Number(format?.bit_rate) || 0,
    fps: parseFrameRate(video.r_frame_rate),
  };
}

export async function generateThumbnail(
  videoPath: string,
  outputPath: string,
  timestamp: number
): Promise<void> {
  await run(FFMPEG, [
    '-v',
    'error',
    '-ss',
    String(timestamp),
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=1280:720',
    '-y',
    outputPath,
  ]);
}
