import { KeytrProvider } from '../src/index.js'
import { checkPrfSupport } from '@sovit.xyz/keytr'
import { SimplePool } from 'nostr-tools'

// ── Config ──────────────────────────────────────────────────────────

const RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
]

const provider = new KeytrProvider({ relayUrls: RELAY_URLS })
const pool = new SimplePool()

// ── DOM helpers ─────────────────────────────────────────────────────

const $ = (id: string) => document.getElementById(id)!
const statusEl = $('status')

function log(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  const entry = document.createElement('div')
  entry.className = `entry ${type}`
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
  statusEl.prepend(entry)
}

function showApp(npub: string, hexPubkey: string) {
  $('auth-section').classList.add('hidden')
  $('app-section').style.display = 'block'
  $('btn-logout').style.display = 'inline-block'
  $('user-info').textContent = npub.slice(0, 12) + '...' + npub.slice(-6)
  $('profile-npub').textContent = npub
  $('profile-hex').textContent = hexPubkey
  loadFeed(hexPubkey)
}

// ── PRF support check ───────────────────────────────────────────────

async function init() {
  log('Checking WebAuthn PRF support...')
  const support = await checkPrfSupport()

  if (!support.supported) {
    $('prf-warning').classList.remove('hidden')
    $('prf-warning').innerHTML = `
      <strong>PRF not available</strong><br>
      ${support.reason || 'Your browser or authenticator does not support the PRF extension.'}<br>
      Try Chrome 116+, Safari 18+, or Edge 116+ with a platform authenticator.
    `
    log(`PRF not supported: ${support.reason}`, 'error')
  } else {
    log('PRF supported', 'success')
  }

  // Pre-fill login with cached pubkey
  const cached = provider.getCachedPubkey()
  if (cached) {
    ;($('login-npub') as HTMLInputElement).placeholder = `Cached: ${cached.slice(0, 12)}...`
    log(`Found cached pubkey: ${cached.slice(0, 12)}...`)
  }
}

// ── Tab switching ───────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
    tab.classList.add('active')
    $(`tab-${(tab as HTMLElement).dataset.tab!}`).classList.add('active')
  })
})

// ── Signup ──────────────────────────────────────────────────────────

$('btn-signup').addEventListener('click', async () => {
  const name = ($('signup-name') as HTMLInputElement).value.trim()
  const username = ($('signup-username') as HTMLInputElement).value.trim()

  if (!name || !username) {
    log('Enter a display name and username', 'error')
    return
  }

  const btn = $('btn-signup') as HTMLButtonElement
  btn.disabled = true
  btn.textContent = 'Creating passkey...'

  try {
    log('Starting passkey registration...')
    const npub = await provider.signup({
      userName: username,
      userDisplayName: name,
    })

    provider.install()
    log(`Account created! npub: ${npub}`, 'success')
    log('window.nostr is now set', 'success')

    const hexPubkey = await provider.getPublicKey()
    showApp(npub, hexPubkey)
  } catch (err) {
    log(`Signup failed: ${(err as Error).message}`, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = 'Create Account with Passkey'
  }
})

// ── Login ───────────────────────────────────────────────────────────

$('btn-login').addEventListener('click', async () => {
  const input = ($('login-npub') as HTMLInputElement).value.trim() || undefined

  const btn = $('btn-login') as HTMLButtonElement
  btn.disabled = true
  btn.textContent = 'Authenticating...'

  try {
    log('Fetching keytr events from relays...')
    const npub = await provider.login(input)

    provider.install()
    log(`Logged in! npub: ${npub}`, 'success')
    log('window.nostr is now set', 'success')

    const hexPubkey = await provider.getPublicKey()
    showApp(npub, hexPubkey)
  } catch (err) {
    log(`Login failed: ${(err as Error).message}`, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = 'Login with Passkey'
  }
})

// ── Logout ──────────────────────────────────────────────────────────

$('btn-logout').addEventListener('click', () => {
  provider.logout()
  $('auth-section').classList.remove('hidden')
  $('app-section').style.display = 'none'
  $('btn-logout').style.display = 'none'
  $('user-info').textContent = ''
  $('feed-list').innerHTML = ''
  log('Logged out — nsec zeroed from memory', 'info')
})

// ── Post a note ─────────────────────────────────────────────────────

$('btn-post').addEventListener('click', async () => {
  const content = ($('note-content') as HTMLTextAreaElement).value.trim()
  if (!content) {
    log('Write something first', 'error')
    return
  }

  const btn = $('btn-post') as HTMLButtonElement
  btn.disabled = true

  try {
    // Sign the event using window.nostr (proving the NIP-07 integration works)
    const event = await window.nostr!.signEvent({
      kind: 1,
      tags: [],
      content,
      created_at: Math.floor(Date.now() / 1000),
    })

    log(`Signed event: ${event.id.slice(0, 12)}...`)

    // Publish to relays
    await Promise.any(
      RELAY_URLS.map(url => pool.publish([url], event as any))
    )

    log('Note published!', 'success')
    ;($('note-content') as HTMLTextAreaElement).value = ''

    // Add to feed immediately
    renderNote(event as any, true)
  } catch (err) {
    log(`Post failed: ${(err as Error).message}`, 'error')
  } finally {
    btn.disabled = false
  }
})

// ── Feed ────────────────────────────────────────────────────────────

interface NostrEvent {
  id: string
  pubkey: string
  kind: number
  tags: string[][]
  content: string
  created_at: number
  sig: string
}

function renderNote(event: NostrEvent, prepend = false) {
  const el = document.createElement('div')
  el.className = 'note'

  const ago = timeAgo(event.created_at)
  const authorShort = event.pubkey.slice(0, 8) + '...' + event.pubkey.slice(-4)

  el.innerHTML = `
    <div class="author">${authorShort}</div>
    <div class="content">${escapeHtml(event.content)}</div>
    <div class="time">${ago}</div>
  `

  const list = $('feed-list')
  if (prepend) {
    list.prepend(el)
  } else {
    list.appendChild(el)
  }
}

function loadFeed(hexPubkey: string) {
  $('feed-list').innerHTML = ''
  log('Loading recent notes...')

  const events: NostrEvent[] = []

  const sub = pool.subscribeMany(
    RELAY_URLS,
    { kinds: [1], authors: [hexPubkey], limit: 20 },
    {
      onevent(event) {
        events.push(event as unknown as NostrEvent)
      },
      oneose() {
        events.sort((a, b) => b.created_at - a.created_at)
        for (const event of events) {
          renderNote(event)
        }
        log(`Loaded ${events.length} note(s)`, 'success')
        sub.close()
      },
    },
  )
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// ── Init ────────────────────────────────────────────────────────────

init()
