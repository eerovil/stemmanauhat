// The old site only forwards to the new one, stemmanauhat.vilpponen.fi.
// Old links look like ?user=<choir>&passphrase=<old passphrase>. Each choir's
// encrypted file holds {"redirect": "<that choir's new sign-in link>"},
// encrypted with the old passphrase (scripts/make-redirects.mjs), so the old
// link unlocks its own new link. Anything else goes to the new site's root.
import { decryptPayload } from './stores/secrets/decrypt'

const NEW_SITE = 'https://stemmanauhat.vilpponen.fi/'

type Payload = { iter: number; salt: string; iv: string; ct: string }
const files = import.meta.glob<Payload>('./stores/secrets/encrypted/*.json.json', { import: 'default' })

async function newLink(): Promise<string> {
  const params = new URLSearchParams(location.search)
  const user = params.get('user')
  const passphrase = params.get('passphrase')
  const load = user && files[`./stores/secrets/encrypted/${user}.json.json`]
  if (!load || !passphrase) return NEW_SITE
  const plain = await (await decryptPayload(await load()))(passphrase)
  const { redirect } = JSON.parse(new TextDecoder().decode(plain)) as { redirect?: unknown }
  // Only ever forward to the new site, whatever the file says.
  return typeof redirect === 'string' && redirect.startsWith(NEW_SITE) ? redirect : NEW_SITE
}

newLink()
  .catch(() => NEW_SITE)
  .then((url) => location.replace(url))
