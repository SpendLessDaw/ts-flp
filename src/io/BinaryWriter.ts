/**
 * Binary writer for FL Studio .flp files
 * Uses smart-buffer for binary writing and protobufjs for VarInt encoding
 */

import { SmartBuffer } from "smart-buffer";
import * as protobuf from "protobufjs/minimal.js";

export class BinaryWriter {
  private sb: SmartBuffer;

  constructor() {
    this.sb = new SmartBuffer();
  }

  /**
   * Returns current write position (total bytes written)
   */
  tell(): number {
    return this.sb.writeOffset;
  }

  /**
   * Writes an unsigned 8-bit integer
   */
  writeU8(value: number): void {
    this.sb.writeUInt8(value & 0xff);
  }

  /**
   * Writes a signed 8-bit integer
   */
  writeI8(value: number): void {
    this.sb.writeInt8(value);
  }

  /**
   * Writes an unsigned 16-bit integer (little-endian)
   */
  writeU16LE(value: number): void {
    this.sb.writeUInt16LE(value & 0xffff);
  }

  /**
   * Writes a signed 16-bit integer (little-endian)
   */
  writeI16LE(value: number): void {
    this.sb.writeInt16LE(value);
  }

  /**
   * Writes an unsigned 32-bit integer (little-endian)
   */
  writeU32LE(value: number): void {
    this.sb.writeUInt32LE(value >>> 0);
  }

  /**
   * Writes a signed 32-bit integer (little-endian)
   */
  writeI32LE(value: number): void {
    this.sb.writeInt32LE(value);
  }

  /**
   * Writes a 32-bit float (little-endian)
   */
  writeF32LE(value: number): void {
    this.sb.writeFloatLE(value);
  }

  /**
   * Writes a 64-bit float (little-endian)
   */
  writeF64LE(value: number): void {
    this.sb.writeDoubleLE(value);
  }

  /**
   * Writes raw bytes
   */
  writeBytes(data: Buffer): void {
    this.sb.writeBuffer(data);
  }

  /**
   * Writes a VarInt (variable-length integer) using protobufjs
   * FL Studio uses this encoding for TEXT and DATA event sizes
   */
  writeVarInt(value: number): void {
    const writer = protobuf.Writer.create();
    writer.uint32(value);
    const encoded = writer.finish();
    this.sb.writeBuffer(Buffer.from(encoded));
  }

  /**
   * Writes an ASCII string (null-terminated)
   */
  writeAsciiString(str: string): void {
    this.sb.writeString(str + "\0", "ascii");
  }

  /**
   * Writes a UTF-16LE string (null-terminated)
   */
  writeUtf16LEString(str: string): void {
    const buf = Buffer.from(str + "\0", "utf16le");
    this.sb.writeBuffer(buf);
  }

  /**
   * Gets the final buffer
   */
  toBuffer(): Buffer {
    return this.sb.toBuffer();
  }
}

/**
 * Encodes a VarInt to a Buffer using protobufjs (standalone utility)
 */
export function encodeVarInt(value: number): Buffer {
  const writer = protobuf.Writer.create();
  writer.uint32(value);
  return Buffer.from(writer.finish());
}

/**
 * Calculates the byte size needed for a VarInt
 */
export function varIntSize(value: number): number {
  if (value < 0x80) return 1;
  if (value < 0x4000) return 2;
  if (value < 0x200000) return 3;
  if (value < 0x10000000) return 4;
  return 5;
}
