# API scripts

Run commands from the repository root with a local `DATABASE_URL`.

## Seed development data

```bash
pnpm --filter api seed:dev
pnpm --filter api seed:dev -- --email=user@example.com --name="Local User" --brand="My Brand" --posts=10
```

Options:

| Option       | Default                             |
| ------------ | ----------------------------------- |
| `--email`    | Random `demo+…@example.com` address |
| `--password` | `Test123!@#`                        |
| `--name`     | `Demo User`                         |
| `--brand`    | `Demo Brand`                        |
| `--posts`    | `10`                                |

The script deletes an existing user with the supplied email and their cascading data, then creates a user, brand, Instagram and Facebook account records, a publishing queue, and content. It creates up to three published posts, up to three scheduled posts, and uses the remaining count for drafts. Published posts include publication and metric records.

Platform IDs and profile data are synthetic. They do not connect to live accounts. The script prints the login credentials and IDs when it finishes.

## Generate brand analysis fixtures

```bash
pnpm --filter api exec tsx scripts/generate-brand-analysis.ts --brandId <brand-id> --version 1
```

Generates random voice, visual style, topic, audience, and recommendation data. `--brandId` is required; `--version` defaults to 1.

Set `BRAND_STYLE_PROFILES_TABLE` to store results in DynamoDB. Without it, the script prints the generated profile. These fixtures are for development and do not represent an analysis of the brand's real content.
