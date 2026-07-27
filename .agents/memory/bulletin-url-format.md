---
name: Bulletin URL format
description: How the Medi-Cal site builds bulletin deep-link URLs — use community_name slug, not community_abbrv
---

# Bulletin URL format

**Rule:** Build bulletin links as:
`/publications/bulletin?community=${slugify(community_name)}&issueNumber=${issue_number}`

Where `slugify` = `name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")`.

**Why:** The Medi-Cal bundle.js shows the site itself uses `slugify(community_name).toLowerCase()` — NOT the `community_abbrv` field (PART1, ACU, etc.). Using abbreviations takes users to a generic page or wrong community. Confirmed from bundle: the site does `"/publications/bulletin?community=".concat(slugify(community_name).toLowerCase()).concat("&issueNumber=").concat(issue_number)`.

**How to apply:** In `scraper.ts`, `community` comes from `raw.community?.community_name`. The slug formula strips all non-alphanumeric chars with `-`, then trims leading/trailing hyphens.
