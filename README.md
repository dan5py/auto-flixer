# Auto Flixer

Cloudflare Worker that automatically confirms Netflix household verification emails. When an email arrives via Cloudflare Email Routing, the Worker forwards the original message, parses MIME content, extracts the tokenized confirmation link, opens it in a headless browser (Cloudflare Browser Rendering), and clicks the confirm button.

## Monorepo structure

```
packages/
  auto-flixer/          Cloudflare Worker (email handler + browser automation)
apps/
  mock-app/             Next.js app simulating the Netflix confirmation page
```

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
3. Example: route `*@yourdomain.com` or a specific address to the `auto-flixer` Worker

### 3. Set the forwarding address secret

Set `FORWARD_TO` as a Worker secret using Wrangler:

```bash
bun run --cwd packages/auto-flixer bunx wrangler secret put FORWARD_TO
```

Wrangler will prompt for the destination email address value.

### 4. Verify selectors in source

The Worker currently uses:

- Confirm button: `button[data-uia="set-primary-location-action"]`
- Invalid token marker: `div[data-uia="upl-invalid-token"]`

If Netflix changes their markup, update `NETFLIX_CONFIRM_SELECTOR` / `INVALID_TOKEN_SELECTOR` in `packages/auto-flixer/src/index.ts`.

### 5. Deploy

```bash
bun run deploy
```

## Development

### Test the email handler locally

Run the mock confirmation app, the Worker dev server, and the email test script in three terminals:

```bash
# Terminal 1 — mock Netflix confirmation page (Next.js on port 3000)
bun run mock:confirm-page

# Terminal 2 — Worker dev server (port 8787)
bun run dev

# Terminal 3 — send a test email
bun run test:local-email
```

The test email defaults to a confirmation link pointing at the local mock app. The Worker will open it in its headless browser and click the confirm button.

To simulate an expired/invalid token instead:

```bash
bun run test:local-email --invalid-token
```

Optional arguments:

```bash
bun run test:local-email --help
```

### Run tests

```bash
bun test
```

## Configuration

| Variable      | Location                    | Description                                                         |
| ------------- | --------------------------- | ------------------------------------------------------------------- |
| `FORWARD_TO`  | Wrangler Worker secret      | Destination email that always receives a forwarded copy             |
| `BROWSER`     | `wrangler.toml` `[browser]` | Browser Rendering binding (auto-configured)                         |
| `ENVIRONMENT` | `wrangler.toml` `[vars]`    | The environment the Worker is running in. Defaults to `production`. |

Runtime automation values such as selectors and browser timeout are defined in `packages/auto-flixer/src/index.ts`.

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
