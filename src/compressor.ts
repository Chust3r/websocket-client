import { deflate, inflate } from 'pako'

/**
 * Interface for data compression and decompression.
 */
export interface ICompressor {
	/**
	 * Compresses the given string data.
	 * @param data - The string data to compress.
	 * @returns The compressed data as a Uint8Array.
	 */
	compress(data: string): Uint8Array

	/**
	 * Decompresses the given Uint8Array data back to a string.
	 * @param data - The compressed data to decompress.
	 * @returns The decompressed string.
	 */
	decompress(data: Uint8Array): string
}

/**
 * Compressor implementation using pako for deflate/inflate operations.
 */
export class PakoCompressor implements ICompressor {
	/**
	 * Compresses the given string data using pako's deflate method.
	 * @param data - The string data to compress.
	 * @returns The compressed data as a Uint8Array.
	 */
	compress(data: string): Uint8Array {
		return deflate(data)
	}

	/**
	 * Decompresses the given Uint8Array data back to a string using pako's inflate method.
	 * @param data - The compressed data to decompress.
	 * @returns The decompressed string.
	 */
	decompress(data: Uint8Array): string {
		return inflate(data, { to: 'string' })
	}
}
