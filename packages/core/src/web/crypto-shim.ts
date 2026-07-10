// Browser stand-in for `node:crypto`'s `createHash`, wired in via a build-time alias so the real source files
// (compose/character, derived/persona, derived/session, …) stay unchanged. The engine only uses these hashes for
// STABLE pseudo-random selection and session identity, never for security, so a deterministic non-cryptographic
// hash is sufficient — the only contract that matters is that the same input always yields the same digest.

const FNV_PRIME = 0x0100_0193;
const FNV_OFFSET = 0x811c_9dc5;

/** One 32-bit FNV-1a pass over a seeded string, returned as 8 hex chars. */
function fnvBlock(input: string): string {
	let h = FNV_OFFSET;
	for (let i = 0; i < input.length; i += 1) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, FNV_PRIME);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}

/** A deterministic 64-hex-char digest: 8 independent FNV blocks, each seeded by its index. */
function toHex(input: string): string {
	let out = "";
	for (let block = 0; block < 8; block += 1) out += fnvBlock(`${block} ${input}`);
	return out;
}

/** Byte view of a hex digest, exposing only the `readUInt32BE` the engine calls (compose/character). */
class Digest {
	constructor(private readonly hex: string) {}
	readUInt32BE(offset = 0): number {
		return parseInt(this.hex.slice(offset * 2, offset * 2 + 8), 16) >>> 0;
	}
}

class Hash {
	private data = "";
	constructor(private readonly algo: string) {}
	update(chunk: string): this {
		this.data += typeof chunk === "string" ? chunk : String(chunk);
		return this;
	}
	digest(encoding?: "hex"): string | Digest {
		const hex = toHex(`${this.algo} ${this.data}`);
		return encoding === "hex" ? hex : new Digest(hex);
	}
}

export function createHash(algo: string): Hash {
	return new Hash(algo);
}
