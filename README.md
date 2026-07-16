# @sovit.xyz/keytr-connect

Drop-in `window.nostr` provider and NDK signer powered by [keytr](https://www.npmjs.com/package/@sovit.xyz/keytr) passkeys. NIP-07 compatible.

`keytr-connect` lets any Nostr web app authenticate users with a WebAuthn passkey instead of a raw `nsec`. The private key is derived from the passkey's PRF extension, encrypted, and stored as a `kind:30079` event on relays. At sign-in time it is decrypted in memory only, used to sign events, and zeroed on logout. Expose it as `window.nostr` for NIP-07 clients, or wrap it as an [NDK](https://github.com/nostr-dev-kit/ndk) signer.

## Install

```bash
npm i @sovit.xyz/keytr-connect
```

`@sovit.xyz/keytr` and `nostr-tools` are regular dependencies and are installed automatically.

NDK support is optional. If you use the `./ndk` entry point, install NDK yourself (it is an optional peer dependency, `>=2.0.0`):

```bash
npm i @nostr-dev-kit/ndk
```

### Requirements

Passkey creation and login rely on the WebAuthn PRF extension. This needs a recent browser and platform authenticator — Chrome 116+, Safari 18+, or Edge 116+. You can probe support at runtime with `checkPrfSupport()` from `@sovit.xyz/keytr`.

## Entry points

The package ships two entry points:

| Import | Export | Purpose |
| --- | --- | --- |
| `@sovit.xyz/keytr-connect` | `KeytrProvider` | NIP-07 `window.nostr` provider |
| `@sovit.xyz/keytr-connect/ndk` | `KeytrNDKSigner` | Adapter that wraps a `KeytrProvider` as an `NDKSigner` |

The main entry point also re-exports the TypeScript types `KeytrConnectConfig`, `SignupOptions`, `UnsignedEvent`, `SignedEvent`, and `Nip07Provider`.

## Usage

### As a NIP-07 provider

```ts
import { KeytrProvider } from '@sovit.xyz/keytr-connect'

const provider = new KeytrProvider({
  relayUrls: ['wss://relay.damus.io', 'wss://nos.lol'],
})

// Create a new passkey-backed identity...
const npub = await provider.signup({
  userName: 'alice',
  userDisplayName: 'Alice',
})

// ...or recover an existing one via passkey.
// Pass an npub/hex pubkey, or omit it to use the cached pubkey from a prior session.
// await provider.login('npub1...')

// Expose the provider as window.nostr so any NIP-07 client can use it.
provider.install()

// window.nostr is now backed by the passkey.
const pubkey = await window.nostr.getPublicKey()
const event = await window.nostr.signEvent({
  kind: 1,
  tags: [],
  content: 'hello nostr',
  created_at: Math.floor(Date.now() / 1000),
})

// Clear the nsec from memory and remove window.nostr.
provider.logout()
```

### As an NDK signer

```ts
import { KeytrProvider } from '@sovit.xyz/keytr-connect'
import { KeytrNDKSigner } from '@sovit.xyz/keytr-connect/ndk'
import NDK from '@nostr-dev-kit/ndk'

const provider = new KeytrProvider({ relayUrls: ['wss://relay.damus.io'] })
await provider.login('npub1...')

const ndk = new NDK({ signer: new KeytrNDKSigner(provider) })
```

The signer requires the provider to be logged in (`signup()` or `login()`) before it is ready. Call `blockUntilReady()` if you need to await the resolved `NDKUser`.

## API

### `new KeytrProvider(config)`

`config` is a `KeytrConnectConfig`:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `relayUrls` | `string[]` | *(required)* | Relays used to publish and fetch keytr `kind:30079` events. |
| `rpId` | `string` | `"keytr.org"` | WebAuthn Relying Party ID (gateway mode). |
| `rpName` | `string` | `"keytr"` | WebAuthn Relying Party display name. |
| `clientName` | `string` | `"keytr-connect"` | Client name tag added to `kind:30079` events. |

Methods and accessors:

- `signup(options: SignupOptions): Promise<string>` — register a passkey, create a new nostr identity, publish the encrypted nsec to the relays, and return the `npub`. `options` is `{ userName, userDisplayName }`.
- `login(npubOrHex?: string): Promise<string>` — recover an identity via passkey. Accepts an `npub` (bech32) or hex pubkey; if omitted, uses the pubkey cached from a prior session. Returns the `npub`.
- `logout(): void` — zero the nsec in memory, remove the cached pubkey, and delete `window.nostr` if this provider installed it.
- `install(): void` — set `window.nostr` to this provider (NIP-07).
- `getCachedPubkey(): string | null` — hex pubkey cached in `localStorage` from a prior session, if any.
- `isLoggedIn: boolean` — whether an nsec is currently held in memory.
- `relayUrls: string[]` — the configured relay URLs.

NIP-07 interface (also reachable via `window.nostr` after `install()`):

- `getPublicKey(): Promise<string>` — hex pubkey.
- `signEvent(event: UnsignedEvent): Promise<SignedEvent>`.
- `nip04.encrypt / nip04.decrypt` — NIP-04 encryption helpers.
- `nip44.encrypt / nip44.decrypt` — NIP-44 (v2) encryption helpers.

All NIP-07 methods throw if the provider is not logged in.

### `new KeytrNDKSigner(provider)`

Wraps a `KeytrProvider` as an `NDKSigner`. Implements `sign`, `encrypt` / `decrypt` (NIP-04 by default, NIP-44 when the scheme is `'nip44'`), `user()` / `blockUntilReady()` / `userSync`, `pubkey`, and `toPayload()`. Requires `@nostr-dev-kit/ndk` as a peer dependency.

## Demo

A small NIP-07 demo app lives in [`demo/`](demo/) — signup/login with a passkey, then sign and publish a `kind:1` note through `window.nostr`. Run it with the Vite dev server:

```bash
npm run dev
```

This serves `demo/index.html` on `http://localhost:5174`.

## Scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `npm run build` | `tsc -p tsconfig.build.json` | Compile `src/` to `dist/` (ESM + `.d.ts`). |
| `npm run dev` | `vite demo` | Run the demo app. |
| `npm run lint` | `tsc --noEmit` | Type-check without emitting. |

`npm publish` runs `build` first via `prepublishOnly`.

## License

AGPL-3.0-or-later.
