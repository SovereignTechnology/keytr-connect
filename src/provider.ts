import {
  setupKeytr,
  loginWithKeytr,
  fetchKeytrEvents,
  publishKeytrEvent,
  decodeNpub,
} from '@sovit.xyz/keytr'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { encrypt as nip04Encrypt, decrypt as nip04Decrypt } from 'nostr-tools/nip04'
import { v2 as nip44 } from 'nostr-tools/nip44'
import type { KeytrConnectConfig, SignupOptions, UnsignedEvent, SignedEvent, Nip07Provider } from './types.js'

const STORAGE_KEY = 'keytr-connect:pubkey'

/**
 * NIP-07 compatible window.nostr provider backed by keytr passkeys.
 *
 * Usage:
 *   const provider = new KeytrProvider({ relayUrls: ['wss://relay.damus.io'] })
 *   await provider.signup({ userName: 'alice', userDisplayName: 'Alice' })
 *   provider.install() // sets window.nostr
 *
 * Any nostr client that checks window.nostr will now use passkey-backed signing.
 */
export class KeytrProvider implements Nip07Provider {
  private nsecBytes: Uint8Array | null = null
  private pubkeyHex: string | null = null
  private config: Required<KeytrConnectConfig>

  constructor(config: KeytrConnectConfig) {
    this.config = {
      relayUrls: config.relayUrls,
      rpId: config.rpId ?? 'keytr.org',
      rpName: config.rpName ?? 'keytr',
      clientName: config.clientName ?? 'keytr-connect',
    }
  }

  get isLoggedIn(): boolean {
    return this.nsecBytes !== null
  }

  get relayUrls(): string[] {
    return this.config.relayUrls
  }

  /** Get the cached pubkey from a previous session (if any) */
  getCachedPubkey(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  }

  /**
   * Create a new nostr identity protected by a passkey.
   * Registers a passkey, encrypts the nsec, and publishes to relays.
   * @returns The npub of the new identity
   */
  async signup(options: SignupOptions): Promise<string> {
    const { eventTemplate, nsecBytes, npub } = await setupKeytr({
      userName: options.userName,
      userDisplayName: options.userDisplayName,
      rpId: this.config.rpId,
      rpName: this.config.rpName,
      clientName: this.config.clientName,
    })

    // Sign the kind:30079 event with the new key
    const signedEvent = finalizeEvent(eventTemplate, nsecBytes)

    // Publish encrypted nsec to relays
    await publishKeytrEvent(signedEvent, this.config.relayUrls)

    // Store key in memory
    this.nsecBytes = nsecBytes
    this.pubkeyHex = getPublicKey(nsecBytes)

    // Cache pubkey for future logins on this device
    try {
      localStorage.setItem(STORAGE_KEY, this.pubkeyHex)
    } catch {
      // localStorage unavailable — no caching
    }

    return npub
  }

  /**
   * Recover an existing nostr identity via passkey.
   * Fetches kind:30079 events, authenticates with passkey, decrypts nsec.
   *
   * @param npubOrHex - npub (bech32) or hex pubkey. If omitted, uses cached pubkey.
   * @returns The npub of the recovered identity
   */
  async login(npubOrHex?: string): Promise<string> {
    let hexPubkey: string

    if (npubOrHex) {
      if (npubOrHex.startsWith('npub1')) {
        const pubkeyBytes = decodeNpub(npubOrHex)
        hexPubkey = bytesToHex(pubkeyBytes)
      } else {
        hexPubkey = npubOrHex
      }
    } else {
      const cached = this.getCachedPubkey()
      if (!cached) {
        throw new Error('No pubkey provided and no cached pubkey found. Enter your npub to login.')
      }
      hexPubkey = cached
    }

    // Fetch kind:30079 events from relays
    const events = await fetchKeytrEvents(hexPubkey, this.config.relayUrls)
    if (events.length === 0) {
      throw new Error('No keytr events found for this pubkey. Check your npub and relay URLs.')
    }

    // Try the first event (most recent). If the user has multiple passkeys,
    // the browser will show the passkey picker.
    let lastError: Error | null = null
    for (const event of events) {
      try {
        const { nsecBytes, npub } = await loginWithKeytr(event)

        this.nsecBytes = nsecBytes
        this.pubkeyHex = getPublicKey(nsecBytes)

        try {
          localStorage.setItem(STORAGE_KEY, this.pubkeyHex)
        } catch {
          // localStorage unavailable
        }

        return npub
      } catch (err) {
        lastError = err as Error
        // Try next event (might be for a different passkey)
        continue
      }
    }

    throw new Error(`Login failed for all ${events.length} credential(s): ${lastError?.message}`)
  }

  /** Clear nsec from memory and remove cached pubkey */
  logout(): void {
    if (this.nsecBytes) {
      this.nsecBytes.fill(0)
      this.nsecBytes = null
    }
    this.pubkeyHex = null
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // localStorage unavailable
    }

    // Remove from window.nostr if we installed it
    if (window.nostr === (this as unknown as Nip07Provider)) {
      delete window.nostr
    }
  }

  /** Install this provider as window.nostr (NIP-07) */
  install(): void {
    window.nostr = this as unknown as Nip07Provider
  }

  // ── NIP-07 interface ──────────────────────────────────────────────

  async getPublicKey(): Promise<string> {
    this.assertLoggedIn()
    return this.pubkeyHex!
  }

  async signEvent(event: UnsignedEvent): Promise<SignedEvent> {
    this.assertLoggedIn()
    return finalizeEvent(event, this.nsecBytes!) as unknown as SignedEvent
  }

  nip04 = {
    encrypt: async (pubkey: string, plaintext: string): Promise<string> => {
      this.assertLoggedIn()
      return nip04Encrypt(this.nsecBytes!, pubkey, plaintext)
    },
    decrypt: async (pubkey: string, ciphertext: string): Promise<string> => {
      this.assertLoggedIn()
      return nip04Decrypt(this.nsecBytes!, pubkey, ciphertext)
    },
  }

  nip44 = {
    encrypt: async (pubkey: string, plaintext: string): Promise<string> => {
      this.assertLoggedIn()
      const ck = nip44.utils.getConversationKey(this.nsecBytes!, pubkey)
      return nip44.encrypt(plaintext, ck)
    },
    decrypt: async (pubkey: string, ciphertext: string): Promise<string> => {
      this.assertLoggedIn()
      const ck = nip44.utils.getConversationKey(this.nsecBytes!, pubkey)
      return nip44.decrypt(ciphertext, ck)
    },
  }

  // ── Internals ─────────────────────────────────────────────────────

  private assertLoggedIn(): void {
    if (!this.nsecBytes || !this.pubkeyHex) {
      throw new Error('Not logged in. Call signup() or login() first.')
    }
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
