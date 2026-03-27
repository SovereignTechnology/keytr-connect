/** Configuration for the KeytrProvider */
export interface KeytrConnectConfig {
  /** Relay URLs for publishing/fetching keytr events and nostr notes */
  relayUrls: string[]
  /** WebAuthn Relying Party ID. Defaults to "keytr.org" (gateway mode). */
  rpId?: string
  /** WebAuthn Relying Party display name. Defaults to "keytr". */
  rpName?: string
  /** Client name tag added to kind:30079 events */
  clientName?: string
}

/** Options for creating a new nostr identity */
export interface SignupOptions {
  userName: string
  userDisplayName: string
}

/** Minimal unsigned event (NIP-07 signEvent input) */
export interface UnsignedEvent {
  kind: number
  tags: string[][]
  content: string
  created_at: number
}

/** Fully signed nostr event (NIP-07 signEvent output) */
export interface SignedEvent extends UnsignedEvent {
  id: string
  pubkey: string
  sig: string
}

/** NIP-07 window.nostr interface */
export interface Nip07Provider {
  getPublicKey(): Promise<string>
  signEvent(event: UnsignedEvent): Promise<SignedEvent>
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
}

declare global {
  interface Window {
    nostr?: Nip07Provider
  }
}
