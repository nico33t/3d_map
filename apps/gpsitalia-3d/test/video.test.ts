import { describe, expect, it } from 'vitest';
import { coverCrop, dayLabel, estimateMegabytes, minutesPerSecond, pickVideoType, recordingTime, routeCamera, VIDEO_FORMATS, videoFileName } from '../src/video';

describe('pickVideoType', () => {
  it('prefers MP4 H.264', () => {
    expect(pickVideoType(() => true)).toMatchObject({ extension: 'mp4', label: 'MP4' });
  });
  it('falls back to WebM where MP4 cannot be recorded', () => {
    expect(pickVideoType(t => t.startsWith('video/webm'))).toMatchObject({ mimeType: 'video/webm;codecs=vp9', extension: 'webm' });
  });
  it('returns null when nothing can be recorded, also when the check throws', () => {
    expect(pickVideoType(() => false)).toBeNull();
    expect(pickVideoType(() => { throw new Error('no MediaRecorder'); })).toBeNull();
  });
});

describe('coverCrop', () => {
  it('crops the sides of a wide source for a vertical video', () => {
    const c = coverCrop(2000, 1000, 1080, 1920);
    expect(c.sh).toBeCloseTo(1000);
    expect(c.sw).toBeCloseTo(562.5);
    expect(c.sx).toBeCloseTo(718.75);
    expect(c.sy).toBeCloseTo(0);
  });
  it('crops top and bottom of a tall source for a horizontal video', () => {
    const c = coverCrop(1000, 1000, 1920, 1080);
    expect(c.sw).toBeCloseTo(1000);
    expect(c.sh).toBeCloseTo(562.5);
    expect(c.sy).toBeCloseTo(218.75);
  });
  it('keeps the source when sizes are invalid', () => {
    expect(coverCrop(0, 100, 10, 10)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 100 });
  });
  it('every format is an even pixel size (encoders require it)', () => {
    for (const f of Object.values(VIDEO_FORMATS)) { expect(f.width % 2).toBe(0); expect(f.height % 2).toBe(0); }
  });
});

describe('recordingTime', () => {
  it('maps video time onto the day linearly and clamps', () => {
    expect(recordingTime(1000, 2000, 0, 10)).toBe(1000);
    expect(recordingTime(1000, 2000, 5, 10)).toBe(1500);
    expect(recordingTime(1000, 2000, 50, 10)).toBe(2000);
    expect(recordingTime(1000, 2000, -5, 10)).toBe(1000);
  });
  it('is safe with empty ranges or durations', () => {
    expect(recordingTime(1000, 1000, 5, 10)).toBe(1000);
    expect(recordingTime(1000, 2000, 5, 0)).toBe(1000);
  });
});

describe('labels', () => {
  it('minutes of day per second of video', () => {
    expect(minutesPerSecond(0, 10 * 3_600_000, 60)).toBe(10);
    expect(minutesPerSecond(0, 60_000, 120)).toBe(1);
    expect(minutesPerSecond(0, 0, 60)).toBe(0);
  });
  it('size estimate', () => {
    expect(estimateMegabytes(60)).toBe(60);
    expect(estimateMegabytes(0)).toBe(1);
  });
  it('day label in Italian', () => {
    expect(dayLabel('2026-11-22')).toBe('domenica 22 novembre 2026');
    expect(dayLabel('22/11/2026')).toBe('');
  });
});

describe('videoFileName', () => {
  it('is ASCII, short and without odd characters', () => {
    expect(videoFileName('Camion Nord 3', '2026-11-22', 'mp4')).toBe('timelapse-camion-nord-3-2026-11-22.mp4');
    expect(videoFileName('Furgone «Città» / 12', '2026-11-22', 'webm')).toBe('timelapse-furgone-citta-12-2026-11-22.webm');
  });
  it('never trusts the inputs', () => {
    expect(videoFileName('***', '../etc', 'exe')).toBe('timelapse-mezzo-giorno.webm');
    expect(videoFileName('x'.repeat(200), '2026-11-22', 'mp4').length).toBeLessThan(100);
  });
});

describe('routeCamera', () => {
  it('centres on the track and zooms out for long tracks', () => {
    const short = routeCamera([{ longitude: 12.49, latitude: 41.89 }, { longitude: 12.5, latitude: 41.9 }])!;
    const long = routeCamera([{ longitude: 12, latitude: 41.5 }, { longitude: 13, latitude: 42.5 }])!;
    expect(short.center.longitude).toBeCloseTo(12.495);
    expect(short.zoom).toBeGreaterThan(long.zoom);
    expect(long.zoom).toBeGreaterThanOrEqual(4);
  });
  it('ignores invalid points and returns null without any', () => {
    expect(routeCamera([])).toBeNull();
    expect(routeCamera([{ longitude: Number.NaN, latitude: 1 }])).toBeNull();
  });
});
