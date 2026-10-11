# stemmanauhat

Stemmanauhat has moved to https://stemmanauhat.vilpponen.fi. This repo is now
only the old address (https://eero.vilpponen.fi/stemmanauhat/), which forwards
there.

An old link `?user=<choir>&passphrase=<old passphrase>` decrypts
`src/stores/secrets/encrypted/<choir>.json.json` in the browser; it holds that
choir's new sign-in link, and the page goes there. Anything else (no link, a
wrong passphrase, an unknown path) goes to the new site's front page.

To change where a choir's old link goes, write the new links to a local file
(never commit it) and regenerate the encrypted files:

    # links.json: {"jm": "https://stemmanauhat.vilpponen.fi/?user=jm&passphrase=...", ...}
    node scripts/make-redirects.mjs /path/to/links.json src/stores/secrets/raw

`src/stores/secrets/raw/<choir>.json` (git-ignored) holds each choir's old
`passphrase`. A link of `"PENDING"` sends that choir to the front page.
