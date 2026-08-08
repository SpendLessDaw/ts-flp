import { describe, expect, it } from 'vitest';
import {
  createEvent,
  createNumberPayload,
  EVENT_ID,
  findFirstEvent,
  parseFlp,
  readProjectMeta,
  readProjectTimeInfo,
  serializeFlp,
  writeProjectMeta,
  writeProjectTimeInfo,
  type FlpEvent,
  type ParsedFlp,
} from '../index.js';

function createHeader(): Buffer {
  const header = Buffer.alloc(14);
  header.write('FLhd', 0, 'ascii');
  header.writeUInt32LE(6, 4);
  header.writeInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(96, 12);
  return header;
}

function createParsed(events: FlpEvent[] = [], version = '25.1.0', useUnicode = true): ParsedFlp {
  return {
    headerChunkBytes: createHeader(),
    fldtHeaderBytes: Buffer.from('FLdt\0\0\0\0', 'binary'),
    events: [
      createEvent(EVENT_ID.PROJECT_FL_VERSION, Buffer.from(`${version}\0`, 'ascii')),
      ...events,
    ],
    trailingBytes: undefined,
    flVersion: version,
    useUnicode,
  };
}

function roundTrip(parsed: ParsedFlp): ParsedFlp {
  return parseFlp(serializeFlp(parsed));
}

describe('Project API contracts', () => {
  it('creates missing metadata in the project preamble', () => {
    const channelEvent = createEvent(EVENT_ID.CHANNEL_NEW, createNumberPayload(1, 'u16'));
    const original = createParsed([channelEvent]);

    const modified = writeProjectMeta(original, {
      name: 'Missing title',
      genre: 'Electronic',
      artist: 'Artist',
      description: 'Description',
      bpm: 128.125,
    });
    const reparsed = roundTrip(modified);

    expect(readProjectMeta(reparsed)).toEqual({
      name: 'Missing title',
      genre: 'Electronic',
      artist: 'Artist',
      description: 'Description',
      bpm: 128.125,
    });

    const channelIndex = reparsed.events.findIndex((event) => event.id === EVENT_ID.CHANNEL_NEW);
    for (const id of [
      EVENT_ID.PROJECT_TEMPO,
      EVENT_ID.PROJECT_TITLE,
      EVENT_ID.PROJECT_GENRE,
      EVENT_ID.PROJECT_ARTISTS,
      EVENT_ID.PROJECT_COMMENTS,
    ]) {
      expect(reparsed.events.findIndex((event) => event.id === id)).toBeLessThan(channelIndex);
    }
  });

  it('clears nullable text fields and leaves a null BPM unchanged', () => {
    let parsed = createParsed();
    parsed = writeProjectMeta(parsed, { name: 'Title', bpm: 120 });
    parsed = writeProjectMeta(parsed, { name: null, bpm: null });

    expect(readProjectMeta(roundTrip(parsed)).name).toBe('');
    expect(readProjectMeta(roundTrip(parsed)).bpm).toBe(120);
  });

  it('updates legacy coarse and fine BPM events without creating a modern event', () => {
    const parsed = createParsed(
      [
        createEvent(EVENT_ID.PROJECT__TEMPO_COARSE, createNumberPayload(120, 'u16')),
        createEvent(EVENT_ID.PROJECT__TEMPO_FINE, createNumberPayload(0, 'u16')),
      ],
      '10.0.0',
    );
    const modified = roundTrip(writeProjectMeta(parsed, { bpm: 174.375 }));

    expect(readProjectMeta(modified).bpm).toBe(174.375);
    expect(findFirstEvent(modified, EVENT_ID.PROJECT_TEMPO)).toBeUndefined();
  });

  it('creates a missing fine BPM event for a decimal legacy tempo', () => {
    const parsed = createParsed(
      [createEvent(EVENT_ID.PROJECT__TEMPO_COARSE, createNumberPayload(120, 'u16'))],
      '10.0.0',
    );
    const modified = roundTrip(writeProjectMeta(parsed, { bpm: 130.5 }));

    expect(readProjectMeta(modified).bpm).toBe(130.5);
    expect(findFirstEvent(modified, EVENT_ID.PROJECT__TEMPO_FINE)).toBeDefined();
  });

  it.each([0, -120, Number.NaN, Number.POSITIVE_INFINITY, 523])(
    'rejects an invalid modern BPM value: %s',
    (bpm) => {
      expect(() => writeProjectMeta(createParsed(), { bpm })).toThrow(RangeError);
    },
  );

  it('accepts the legacy high-tempo range but rejects decimals before FL 3.4', () => {
    expect(() => writeProjectMeta(createParsed([], '10.0.0'), { bpm: 999 })).not.toThrow();
    expect(() => writeProjectMeta(createParsed([], '3.3.0'), { bpm: 120.5 })).toThrow(TypeError);
  });

  it('creates a missing timestamp and preserves the unspecified component', () => {
    const creationDate = new Date('2024-01-01T12:34:56.000Z');
    let parsed = writeProjectTimeInfo(createParsed(), { creationDate });
    parsed = writeProjectTimeInfo(parsed, { workTimeSeconds: 3_600 });
    const info = readProjectTimeInfo(roundTrip(parsed));

    expect(info.creationDate?.toISOString()).toBe('2024-01-01T12:34:56.000Z');
    expect(info.workTimeSeconds).toBeCloseTo(3_600, 6);
  });

  it('does not create a timestamp when no time field is provided', () => {
    const parsed = createParsed();
    const modified = writeProjectTimeInfo(parsed, {});

    expect(modified).toBe(parsed);
    expect(findFirstEvent(modified, EVENT_ID.PROJECT_TIMESTAMP)).toBeUndefined();
  });

  it('uses the UTC Delphi epoch and resets nullable time fields to zero', () => {
    let parsed = writeProjectTimeInfo(createParsed(), {
      creationDate: new Date('2024-01-01T00:00:00.000Z'),
      workTimeSeconds: 45,
    });
    parsed = writeProjectTimeInfo(parsed, { creationDate: null, workTimeSeconds: null });
    const info = readProjectTimeInfo(roundTrip(parsed));

    expect(info.creationDate?.toISOString()).toBe('1899-12-30T00:00:00.000Z');
    expect(info.workTimeSeconds).toBe(0);
  });

  it('inserts a missing timestamp before the first channel', () => {
    const parsed = createParsed([createEvent(EVENT_ID.CHANNEL_NEW, createNumberPayload(1, 'u16'))]);
    const modified = writeProjectTimeInfo(parsed, { workTimeSeconds: 60 });

    const timestampIndex = modified.events.findIndex(
      (event) => event.id === EVENT_ID.PROJECT_TIMESTAMP,
    );
    const channelIndex = modified.events.findIndex((event) => event.id === EVENT_ID.CHANNEL_NEW);
    expect(timestampIndex).toBeGreaterThan(0);
    expect(timestampIndex).toBeLessThan(channelIndex);
  });

  it('rejects invalid time values', () => {
    expect(() =>
      writeProjectTimeInfo(createParsed(), { creationDate: new Date(Number.NaN) }),
    ).toThrow(RangeError);
    expect(() => writeProjectTimeInfo(createParsed(), { workTimeSeconds: -1 })).toThrow(RangeError);
    expect(() =>
      writeProjectTimeInfo(createParsed(), { workTimeSeconds: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
  });
});
