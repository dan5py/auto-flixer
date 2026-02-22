# flix-auto-confirm

Cloudflare Worker that automatically confirms Netflix household verification emails. When an email arrives via Cloudflare Email Routing, the Worker forwards the original message, parses MIME content, extracts the tokenized confirmation link, opens it in a headless browser (Cloudflare Browser Rendering), and clicks the confirm button.

## Prerequisites

- A Cloudflare account with **Email Routing** enabled on your domain
- **Browser Rendering** enabled on your account
- [Bun](https://bun.sh) installed locally

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Configure Email Routing

In the Cloudflare dashboard:

1. Go to **Email Routing** for your domain
2. Create a routing rule that sends Netflix emails to this Worker
3. Example: route `*@yourdomain.com` or a specific address to the `flix-auto-confirm` Worker

### 3. Set the forwarding address secret

Set `FORWARD_TO` as a Worker secret using Wrangler:

```bash
bunx wrangler secret put FORWARD_TO
```

Wrangler will prompt for the destination email address value.

### 4. Verify selectors in source

The Worker currently uses:

- Confirm button: `button[data-uia="set-primary-location-action"]`
- Invalid token marker: `div[data-uia="upl-invalid-token"]`

If Netflix changes their markup, update `NETFLIX_CONFIRM_SELECTOR` / `INVALID_TOKEN_SELECTOR` in `src/index.ts`.

### 5. Deploy

```bash
bun run deploy
```

## Development

```bash
bun run dev
```

### Test the email handler locally

With the dev server running, execute the local email test script:

```bash
bun run test:local-email
```

Optional arguments:

```bash
bun run test:local-email -- --help
```

Example with custom values:

```bash
bun run test:local-email -- \
  --endpoint "http://localhost:8787/cdn-cgi/handler/email" \
  --from "info@account.netflix.com" \
  --to "you@yourdomain.com" \
  --header-from "Netflix <info@account.netflix.com>" \
  --subject "Netflix Household verification"
```

### Run tests

```bash
bun test
```

## Configuration

| Variable     | Location                    | Description                                             |
| ------------ | --------------------------- | ------------------------------------------------------- |
| `FORWARD_TO` | Wrangler Worker secret      | Destination email that always receives a forwarded copy |
| `BROWSER`    | `wrangler.toml` `[browser]` | Browser Rendering binding (auto-configured)             |

Runtime automation values such as selectors and browser timeout are defined in `src/index.ts`.

## How it works

```
Inbound email (Email Routing)
  -> email() handler
  -> Forward to FORWARD_TO
  -> Parse MIME content (postal-mime)
  -> Validate parsed "From:" header is *@netflix.com
  -> Extract first netflix.com link from HTML body
  -> Launch headless browser (Cloudflare Browser Rendering)
  -> Navigate to tokenized confirmation URL
  -> Click the confirm button
  -> Done
```

## Notes

- Cloudflare `message.from` is the SMTP envelope sender (often Amazon SES), not necessarily the human-visible `From:` header.
- This Worker validates the parsed MIME `From:` header (`parsed.from.address`) to detect Netflix senders.
