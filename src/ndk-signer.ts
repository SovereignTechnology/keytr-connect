/**
 * NDK signer adapter for keytr-connect.
 *
 * Wraps a KeytrProvider into an NDKSigner-compatible object.
 * Requires @nostr-dev-kit/ndk as a peer dependency.
 *
 * Usage:
 *   import { KeytrProvider } from '@sovit.xyz/keytr-connect'
 *   import { KeytrNDKSigner } from '@sovit.xyz/keytr-connect/ndk'
 *   import NDK from '@nostr-dev-kit/ndk'
 *
 *   const provider = new KeytrProvider({ relayUrls: ['wss://relay.damus.io'] })
 *   await provider.login('npub1...')
 *
 *   const ndk = new NDK({ signer: new KeytrNDKSigner(provider) })
 */
import type NDK from '@nostr-dev-kit/ndk'
import type { NDKSigner, NDKUser, NostrEvent, NDKEncryptionScheme } from '@nostr-dev-kit/ndk'
import type { KeytrProvider } from './provider.js'

export class KeytrNDKSigner implements NDKSigner {
  private provider: KeytrProvider
  private _ndk?: NDK
  private _user?: NDKUser

  constructor(provider: KeytrProvider) {
    this.provider = provider
  }

  set ndk(ndk: NDK) {
    this._ndk = ndk
  }

  get ndk(): NDK | undefined {
    return this._ndk
  }

  get pubkey(): string {
    if (!this.provider.isLoggedIn) {
      throw new Error('Not ready')
    }
    // getCachedPubkey is sync and available after login
    const cached = this.provider.getCachedPubkey()
    if (!cached) throw new Error('Not ready')
    return cached
  }

  get userSync(): NDKUser {
    if (!this._user) {
      throw new Error('Not ready — call blockUntilReady() first')
    }
    return this._user
  }

  async blockUntilReady(): Promise<NDKUser> {
    if (!this.provider.isLoggedIn) {
      throw new Error('KeytrProvider is not logged in. Call provider.signup() or provider.login() first.')
    }
    this._user = await this.user()
    return this._user
  }

  async user(): Promise<NDKUser> {
    const pubkey = await this.provider.getPublicKey()
    const { NDKUser: UserClass } = await import('@nostr-dev-kit/ndk')
    const user = new UserClass({ pubkey })
    if (this._ndk) {
      user.ndk = this._ndk
    }
    return user
  }

  async sign(event: NostrEvent): Promise<string> {
    const signed = await this.provider.signEvent({
      kind: event.kind!,
      tags: event.tags,
      content: event.content,
      created_at: event.created_at!,
    })
    return signed.sig
  }

  async encrypt(recipient: NDKUser, value: string, scheme?: NDKEncryptionScheme): Promise<string> {
    const pubkey = recipient.pubkey
    if (scheme === 'nip44') {
      return this.provider.nip44.encrypt(pubkey, value)
    }
    return this.provider.nip04.encrypt(pubkey, value)
  }

  async decrypt(sender: NDKUser, value: string, scheme?: NDKEncryptionScheme): Promise<string> {
    const pubkey = sender.pubkey
    if (scheme === 'nip44') {
      return this.provider.nip44.decrypt(pubkey, value)
    }
    return this.provider.nip04.decrypt(pubkey, value)
  }

  toPayload(): string {
    return JSON.stringify({
      type: 'keytr',
      payload: this.provider.getCachedPubkey() ?? '',
    })
  }
}
