/**
 * Binary reader for FL Studio .flp files
 * Uses smart-buffer for binary reading and protobufjs for VarInt decoding
 */

import protobuf from "protobufjs/minimal.js";
import { SmartBuffer } from "smart-buffer";

export class BinaryReader {
  private sb: SmartBuffer;
  private source: Buffer;

  constructor(buffer: Buffer) {
    this.source = buffer;
    this.sb = SmartBuffer.fromBuffer(buffer);
  }

  /**
   * Returns current read position
   */
  tell(): number {
    return this.sb.readOffset;
  }

  /**
   * Seeks to an absolute position
   */
  seek(pos: number): void {
    this.sb.readOffset = pos;
  }

  /**
   * Seeks relative to current position
   */
  skip(offset: number): void {
    this.sb.readOffset += offset;
  }

  /**
   * Returns total buffer length
   */
  length(): number {
    return this.sb.length;
  }

  /**
   * Returns remaining bytes to read
   */
  remaining(): number {
    return this.sb.remaining();
  }

  /**
   * Returns true if there are more bytes to read
   */
  hasMore(): boolean {
    return this.sb.remaining() > 0;
  }

  /**
   * Reads an unsigned 8-bit integer
   */
  readU8(): number {
    return this.sb.readUInt8();
  }

  /**
   * Reads a signed 8-bit integer
   */
  readI8(): number {
    return this.sb.readInt8();
  }

  /**
   * Reads an unsigned 16-bit integer (little-endian)
   */
  readU16LE(): number {
    return this.sb.readUInt16LE();
  }

  /**
   * Reads a signed 16-bit integer (little-endian)
   */
  readI16LE(): number {
    return this.sb.readInt16LE();
  }

  /**
   * Reads an unsigned 32-bit integer (little-endian)
   */
  readU32LE(): number {
    return this.sb.readUInt32LE();
  }

  /**
   * Reads a signed 32-bit integer (little-endian)
   */
  readI32LE(): number {
    return this.sb.readInt32LE();
  }

  /**
   * Reads a 32-bit float (little-endian)
   */
  readF32LE(): number {
    return this.sb.readFloatLE();
  }

  /**
   * Reads a 64-bit float (little-endian)
   */
  readF64LE(): number {
    return this.sb.readDoubleLE();
  }

  /**
   * Reads raw bytes
   */
  readBytes(length: number): Buffer {
    return this.sb.readBuffer(length);
  }

  /**
   * Reads a VarInt (variable-length integer) using protobufjs
   * FL Studio uses this encoding for TEXT and DATA event sizes
   */
  readVarInt(): number {
    // Get remaining buffer from current position
    const remainingBuffer = this.source.subarray(this.sb.readOffset);
    const reader = protobuf.Reader.create(remainingBuffer);
    const value = reader.uint32();
    // Advance our position by how many bytes protobufjs consumed
    this.sb.readOffset += reader.pos;
    return value;
  }

  /**
   * Reads an ASCII string (null-terminated)
   */
  readAsciiString(length: number): string {
    const str = this.sb.readString(length, "ascii");
    // Remove null terminator if present
    const nullPos = str.indexOf("\0");
    return nullPos === -1 ? str : str.substring(0, nullPos);
  }

  /**
   * Reads a UTF-16LE string (null-terminated)
   */
  readUtf16LEString(length: number): string {
    const bytes = this.sb.readBuffer(length);
    const str = bytes.toString("utf16le");
    // Remove null terminator if present
    const nullPos = str.indexOf("\0");
    return nullPos === -1 ? str : str.substring(0, nullPos);
  }

  /**
   * Peeks at bytes without advancing position
   */
  peek(length: number): Buffer {
    const pos = this.sb.readOffset;
    const data = this.sb.readBuffer(length);
    this.sb.readOffset = pos;
    return data;
  }

  /**
   * Peeks at a single byte without advancing position
   */
  peekU8(): number {
    const pos = this.sb.readOffset;
    const value = this.sb.readUInt8();
    this.sb.readOffset = pos;
    return value;
  }

  /**
   * Returns the internal buffer
   */
  toBuffer(): Buffer {
    return this.source;
  }
}
