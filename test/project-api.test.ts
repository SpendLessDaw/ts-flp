import { describe, expect, it } from 'vitest';
import {
  createEvent,
  createNumberPayload,
  EVENT_ID,
  findFirstEvent,
  getEventFixedSize,
  getEventKind,
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

function createFixedEvent(id: number, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([id]), payload]);
}

function createVariableEvent(id: number, payload: Buffer): Buffer {
  let value = payload.length;
  const size: number[] = [];

  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value > 0) byte |= 0x80;
    size.push(byte);
  } while (value > 0);

  return Buffer.concat([Buffer.from([id, ...size]), payload]);
}

function createFlStudio26Fixture(): Buffer {
  const u8 = (value: number): Buffer => Buffer.from([value]);
  const u32 = (value: number): Buffer => {
    const payload = Buffer.alloc(4);
    payload.writeUInt32LE(value);
    return payload;
  };
  const utf16 = (value: string): Buffer => Buffer.from(`${value}\0`, 'utf16le');
  const createdOn = new Date('2026-08-14T20:05:28.860Z');
  const timestamp = Buffer.alloc(16);
  timestamp.writeDoubleLE((createdOn.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000, 0);
  timestamp.writeDoubleLE(8_900.011 / 86_400, 8);

  const events = Buffer.concat([
    createVariableEvent(EVENT_ID.PROJECT_FL_VERSION, Buffer.from('26.1.1.5313\0', 'ascii')),
    createFixedEvent(EVENT_ID.PROJECT_FL_BUILD, u32(5_313)),
    createFixedEvent(0xa9, u32(15)),
    createFixedEvent(EVENT_ID.PROJECT_LICENSED, u8(1)),
    createFixedEvent(0xac, Buffer.from([1, 1, 0])),
    createVariableEvent(0xc0, utf16('FL Studio 26.1.1.5313.5313')),
    createFixedEvent(0x25, u8(2)),
    createVariableEvent(EVENT_ID.PROJECT_LICENSEE, utf16('FL Studio 26 fixture')),
    createFixedEvent(EVENT_ID.PROJECT_TEMPO, u32(174_000)),
    createVariableEvent(EVENT_ID.PROJECT_TITLE, utf16('New project 1')),
    createVariableEvent(EVENT_ID.PROJECT_COMMENTS, utf16('')),
    createVariableEvent(EVENT_ID.PROJECT_GENRE, utf16('Unknown')),
    createVariableEvent(EVENT_ID.PROJECT_ARTISTS, utf16('Unfracted Hollow')),
    createVariableEvent(EVENT_ID.PROJECT_TIMESTAMP, timestamp),
  ]);
  const dataHeader = Buffer.alloc(8);
  dataHeader.write('FLdt', 0, 'ascii');
  dataHeader.writeUInt32LE(events.length, 4);

  return Buffer.concat([createHeader(), dataHeader, events]);
}

describe('Project API contracts', () => {
  it('parses the FL Studio 26 preamble with the 0xAC size exception', () => {
    const fixture = createFlStudio26Fixture();
    const parsed = parseFlp(fixture);

    expect(parsed.events.map((event) => event.id)).toEqual([
      EVENT_ID.PROJECT_FL_VERSION,
      EVENT_ID.PROJECT_FL_BUILD,
      0xa9,
      EVENT_ID.PROJECT_LICENSED,
      0xac,
      0xc0,
      0x25,
      EVENT_ID.PROJECT_LICENSEE,
      EVENT_ID.PROJECT_TEMPO,
      EVENT_ID.PROJECT_TITLE,
      EVENT_ID.PROJECT_COMMENTS,
      EVENT_ID.PROJECT_GENRE,
      EVENT_ID.PROJECT_ARTISTS,
      EVENT_ID.PROJECT_TIMESTAMP,
    ]);

    const unknownDword = parsed.events[2]!;
    expect(unknownDword.header).toEqual(Buffer.from([0xa9]));
    expect(unknownDword.payload.readUInt32LE()).toBe(15);

    const sizeException = parsed.events[4]!;
    expect(getEventFixedSize(0xac)).toBe(3);
    expect(getEventKind(0xac)).toBe('unknown');
    expect(sizeException.kind).toBe('unknown');
    expect(sizeException.header).toEqual(Buffer.from([0xac]));
    expect(sizeException.payload).toEqual(Buffer.from([1, 1, 0]));
    expect(parsed.events[5]!.payload.toString('utf16le').replace(/\0/g, '')).toBe(
      'FL Studio 26.1.1.5313.5313',
    );

    expect(readProjectMeta(parsed)).toEqual({
      name: 'New project 1',
      description: '',
      artist: 'Unfracted Hollow',
      genre: 'Unknown',
      bpm: 174,
    });

    const timeInfo = readProjectTimeInfo(parsed);
    const expectedCreationTime = new Date('2026-08-14T20:05:28.860Z').getTime();
    expect(
      Math.abs((timeInfo.creationDate?.getTime() ?? 0) - expectedCreationTime),
    ).toBeLessThanOrEqual(1);
    expect(timeInfo.workTimeSeconds).toBeCloseTo(8_900.011, 6);
    expect(serializeFlp(parsed)).toEqual(fixture);
  });

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
